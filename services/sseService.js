/*
 * Quelora — quelora-enterprise
 * Copyright (C) 2026 Germán Zelaya — https://quelora.org
 * SPDX-License-Identifier: AGPL-3.0-only
 *
 * This file is part of Quelora. See the LICENSE file for terms.
 */

/* filepath: packages/quelora-enterprise/services/sseService.js */

/**
 * @file sseService.js
 * @description Manages Server-Sent Events (SSE) for real-time client communication.
 * @module @quelora/enterprise/services/sseService
 * @version 4.3.0
 */

const Redis = require('ioredis');
const crypto = require('crypto');
const { cacheService } = require('@quelora/common/services/cacheService');
const resilienceService = require('./resilienceService');
const peerDiscoveryService = require('./peerDiscoveryService');

/**
 * Redis connection URL.
 */
const redisUrl = process.env.CACHE_REDIS_URL || process.env.CACHE_URL;

// Initialize Redis clients for Pub/Sub mechanism
// Publisher needs its own connection, Subscriber needs its own blocking connection
const redisPublisher = new Redis(redisUrl);
const redisSubscriber = new Redis(redisUrl);

/**
 * In-memory map of active local connections.
 * Maps User ID to a Set of Response objects to support multiple tabs/devices per user.
 * @type {Map<string, Set<http.ServerResponse>>}
 */
const localConnections = new Map();

/**
 * Time-To-Live for the SSE authentication ticket (in seconds).
 * Short TTL strictly for the handshake process.
 */
const TICKET_TTL = 10; 

// =============================================================================
//  SCALABILITY CONFIGURATION (GLOBAL TICK PATTERN)
// =============================================================================

const SCALING_CONFIG = {
    GLOBAL_TICK_MS: 1000,       // Run the loop every 1 second
    BATCH_SIZE: 50,             // Max connections to refresh per tick (prevents CPU lock)
    BASE_REFRESH_MS: 4.3 * 60 * 1000, // Target: 4.3 Minutes
    JITTER_MS: 30 * 1000        // Random variance (0-30s) to desync users
};

// =============================================================================
//  GLOBAL ORCHESTRATION LOGIC
// =============================================================================

/**
 * Helper to write SSE data safely to the response stream.
 * @param {import('http').ServerResponse} res 
 * @param {Object} data 
 */
const sendSSE = (res, data) => {
    if (res.writableEnded || res.finished) return; 
    try {
        res.write(`data: ${JSON.stringify(data)}\n\n`);
    } catch (e) {
        console.error('Error writing to stream', e);
    }
};

/**
 * Performs the actual Peer Handshake/Refresh for a specific connection.
 * Reads context attached to the response object during initialization.
 * @param {import('http').ServerResponse} res
 */
const performPeerHandshake = (res) => {
    // Context is attached during addClient
    if (!res.sseContext || !res.sseContext.cid) return;

    resilienceService.getPublicConfig(res.sseContext.cid, {
        author: res.sseContext.userId,
        geoData: res.sseContext.geoData
    })
    .then(handshakeData => {
        if (handshakeData && !res.finished) {
            sendSSE(res, handshakeData);
        }
    })
    .catch(err => console.error(`[SSE] Refresh Error for ${res.sseContext.userId}:`, err));
};

/**
 * The Global Loop. 
 * Iterates through connections and triggers refresh for those whose time has come.
 * This runs in memory and avoids creating individual timers for thousands of users.
 */
setInterval(() => {
    processGlobalRefreshes();
}, SCALING_CONFIG.GLOBAL_TICK_MS);

function processGlobalRefreshes() {
    const now = Date.now();
    let processedCount = 0;

    // Iterate over all users connected to this instance
    for (const [userId, connectionSet] of localConnections.entries()) {
        for (const res of connectionSet) {
            
            // Check if this connection is dead but not cleaned up yet
            if (res.finished || res.writableEnded) continue;

            // Check if it's time to refresh peers for this user
            if (res.nextPeerRefresh && res.nextPeerRefresh <= now) {
                
                // 1. Execute Refresh Logic (Uses CID from context)
                performPeerHandshake(res);

                // 2. Schedule Next Refresh with Jitter
                // New Time = Now + 4.3min + Random(0-30s)
                res.nextPeerRefresh = now + SCALING_CONFIG.BASE_REFRESH_MS + (Math.random() * SCALING_CONFIG.JITTER_MS);
                
                processedCount++;
            }
        }

        // Circuit Breaker: If we processed too many this second, stop.
        // The remaining users will be picked up in the next second (Tick).
        if (processedCount >= SCALING_CONFIG.BATCH_SIZE) {
            break; 
        }
    }
}

// =============================================================================
//  REDIS PUB/SUB (MULTI-TENANT ISOLATION)
// =============================================================================

/**
 * Subscribes to the notification pattern for all Client IDs.
 * Pattern: notifications:cid:*
 */
redisSubscriber.psubscribe('notifications:cid:*', (err) => {
    if (err) console.error('❌ SSE Redis PSubscribe Error:', err);
    else console.log('✅ SSE Service listening on notifications:cid:*');
});

/**
 * Handles incoming messages from Redis Pub/Sub.
 * Ensures messages are only delivered to connections matching the channel's CID.
 * @param {string} pattern - The pattern matched (notifications:cid:*)
 * @param {string} channel - The specific channel (e.g., notifications:cid:tenant_123)
 * @param {string} message - The JSON stringified payload
 */
redisSubscriber.on('pmessage', (pattern, channel, message) => {
    try {
        // Extract CID from channel name (format: notifications:cid:{cid})
        const parts = channel.split(':');
        const channelCid = parts[2]; // notifications:cid:ID -> ID is at index 2
        
        if (!channelCid) {
            console.warn(`[SSE] Invalid channel format received: ${channel}`);
            return;
        }

        const parsedData = JSON.parse(message);
        const { targetUserId, payload } = parsedData;

        if (localConnections.has(targetUserId)) {
            const connections = localConnections.get(targetUserId);
            
            connections.forEach(res => {
                // SECURITY GATE: Tenant Isolation
                // Only send if the connection belongs to the same CID as the notification channel
                if (res.sseContext && res.sseContext.cid === channelCid) {
                    sendSSE(res, payload);
                }
            });
        }
    } catch (error) {
        console.error('Error parsing SSE message from Redis:', error);
    }
});

// =============================================================================
//  SERVICE EXPORT
// =============================================================================

const sseService = {
    
    /**
     * Generates a one-time ticket for SSE connection.
     * @param {string} cid - Client ID for isolation.
     * @param {string} userId - User ID to bind.
     */
    generateTicket: async (cid, userId) => {
        if (!cid || !userId) return null;
        const ticket = crypto.randomBytes(16).toString('hex');
        const key = `cid:${cid}:sse_ticket:${ticket}`;
        await cacheService.set(key, userId, TICKET_TTL);
        return ticket;
    },

    /**
     * Validates and consumes a ticket.
     * @param {string} cid - Client ID.
     * @param {string} ticket - The ticket to validate.
     */
    validateTicket: async (cid, ticket) => {
        if (!cid || !ticket) return null;
        const key = `cid:${cid}:sse_ticket:${ticket}`;
        const userId = await cacheService.get(key);
        if (userId) {
            await cacheService.delete(key);
            return userId;
        }
        return null;
    },

    /**
     * Adds a client connection to the local pool.
     * Sets up headers, heartbeats, and cleanup logic.
     * @param {import('express').Request} req 
     * @param {import('express').Response} res 
     * @param {string} userId 
     */
    addClient: (req, res, userId) => {
        // 1. Headers
        res.writeHead(200, {
            'Content-Type': 'text/event-stream',
            'Cache-Control': 'no-cache',
            'Connection': 'keep-alive',
            'X-Accel-Buffering': 'no'
        });

        res.write(': connected\n\n');

        // 2. Attach Context to Response Object (For Global Loop access)
        const cid = req.query.cid || req.cid;
        const geoData = req.geoData || {};

        res.sseContext = {
            userId: userId,
            cid: cid,
            geoData: geoData
        };

        // 3. Initialize Refresh Timer (With Initial Jitter)
        // Spreads out the first refresh so not everyone hits 4.3m at once after a server restart.
        res.nextPeerRefresh = Date.now() + SCALING_CONFIG.BASE_REFRESH_MS + (Math.random() * SCALING_CONFIG.JITTER_MS);

        // 4. Register Connection
        if (!localConnections.has(userId)) {
            localConnections.set(userId, new Set());
        }
        localConnections.get(userId).add(res);

        // Fire-and-forget to avoid blocking the stream initialization.
        peerDiscoveryService.ensureUserRegistration(cid, userId, geoData)
            .catch(err => console.error(`[SSE] Failed to register user ${userId} for discovery:`, err));

        // 5. Send Immediate Initial Handshake (Peers List)
        performPeerHandshake(res);

        // 6. Setup lightweight Keep-Alive (Separate from Peer Logic)
        const heartbeat = setInterval(() => {
            if (res.writableEnded || res.finished) {
                clearInterval(heartbeat);
                return;
            }
            res.write(': keepalive\n\n');
        }, 25000);

        // 7. Cleanup
        // Handles both client-side disconnects and server-side forced timeouts
        req.on('close', () => {
            clearInterval(heartbeat);
            // No need to clear global timer, the Map deletion handles it.
            const userConns = localConnections.get(userId);
            if (userConns) {
                userConns.delete(res);
                if (userConns.size === 0) {
                    localConnections.delete(userId);
                }
            }
        });
    },

    /**
     * Publishes a notification to a specific user within a specific Tenant (CID).
     * @param {string} cid - The Tenant/Client ID.
     * @param {string} targetUserId - The ID of the user to receive the notification.
     * @param {Object} notificationData - The payload data.
     */
    sendNotificationToUser: async (cid, targetUserId, notificationData) => {
        if (!cid) {
            console.error('[SSE] Missing CID for notification dispatch');
            return;
        }
        const channel = `notifications:cid:${cid}`;
        await redisPublisher.publish(channel, JSON.stringify({
            targetUserId,
            payload: notificationData
        }));
    },
};

module.exports = sseService;