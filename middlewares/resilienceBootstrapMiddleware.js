/*
 * Quelora — quelora-enterprise
 * Copyright (C) 2026 Germán Zelaya — https://quelora.org
 * SPDX-License-Identifier: AGPL-3.0-only
 *
 * This file is part of Quelora. See the LICENSE file for terms.
 */

/* filepath: packages/quelora-enterprise/middlewares/resilienceBootstrapMiddleware.js */
const crypto               = require('crypto');
const { monitorEventLoopDelay } = require('perf_hooks');
const peerDiscoveryService = require('../services/peerDiscoveryService');
const { getClientResilienceConfig } = require('@quelora/common/services/clientConfigService');
const Profile              = require('@quelora/common/models/Profile');

/**
 * Global Event Loop Delay Monitor.
 * Samples the event loop continuously to provide near real-time lag metrics
 * without introducing synchronous measurement blocks during HTTP request processing.
 */
const eldMonitor = monitorEventLoopDelay({ resolution: 10 });
eldMonitor.enable();

/**
 * Asynchronously retrieves the current number of active concurrent connections
 * on the underlying Node.js HTTP/TCP server.
 *
 * @param {import('net').Server} server - The network server instance from the request socket.
 * @returns {Promise<number>} Resolves with the active connection count, defaults to 0 on error.
 */
const getServerConnections = (server) => {
    return new Promise((resolve) => {
        if (!server || typeof server.getConnections !== 'function') {
            return resolve(0);
        }
        server.getConnections((err, count) => {
            resolve(err ? 0 : count);
        });
    });
};

/**
 * Generates a stateless relay auth token valid for the current UTC hour slot.
 *
 * Token = HMAC-SHA256(RELAY_AUTH_SECRET, authorId:slot)
 *
 * The relay accepts the current slot and the previous one, giving a minimum
 * TTL of 60 minutes and a maximum of ~90 minutes without requiring clock
 * synchronisation between server and relay.
 *
 * Only generated for authenticated users (req.user.author present and not a guest).
 * Guests receive relayToken: null and the client falls back to public relays only.
 *
 * @param {string} authorId - req.user.author from the authenticated session.
 * @returns {{ token: string, slot: number }}
 * @throws {Error} If RELAY_AUTH_SECRET env var is not set.
 */
const generateRelayToken = (authorId) => {
    const relaySecret = process.env.RELAY_AUTH_SECRET;

    if (!relaySecret) {
        throw new Error('[RelayAuth] RELAY_AUTH_SECRET env var is not set.');
    }

    const slot  = Math.floor(Date.now() / 3_600_000);
    const token = crypto
        .createHmac('sha256', relaySecret)
        .update(`${authorId}:${slot}`)
        .digest('hex');

    return { token, slot };
};

/**
 * @module Middleware/ResilienceBootstrap
 * @description
 * Injects cryptographic anchors (E2EE) and optionally P2P configuration into the response via HTTP headers.
 * Strictly gates P2P topology calculation, mode injection, and Relay token generation behind multi-vector 
 * emergency triggers (Memory Heap, Event Loop Lag, TCP Connections) or explicit forceMode configurations 
 * to avoid unnecessary cryptographic and network overhead during nominal operations.
 *
 * Header: X-Resilience-Bootstrap (base64 JSON)
 *
 * @param {Object}   req           - Express request object.
 * @param {string}   req.cid       - Context ID (Tenant Identifier).
 * @param {Object}   [req.user]    - Authenticated user payload.
 * @param {Object}   [req.geoData] - Geo-location data from upstream.
 * @param {Object}   res           - Express response object.
 * @param {Function} next          - Express next middleware function.
 * @returns {Promise<void>}
 */
const resilienceBootstrapMiddleware = async (req, res, next) => {
    const isSsoBypass = req.method === 'POST' && req.originalUrl && req.originalUrl.includes('/verify');

    if (req.method !== 'GET' && !isSsoBypass) {
        return next();
    }

    try {
        const cid = req.cid;

        if (!cid) {
            return next();
        }

        const resConfig = await getClientResilienceConfig(cid);

        if (!resConfig || !resConfig.enabled || !resConfig.publicKey) {
            return next();
        }

        let isEmergency = false;
        const triggers = resConfig.triggers;

        if (triggers) {
            if (!isEmergency && typeof triggers.maxMemoryHeap === 'number' && triggers.maxMemoryHeap > 0) {
                const mem = process.memoryUsage();
                const heapPct = (mem.heapUsed / mem.heapTotal) * 100;
                if (heapPct >= triggers.maxMemoryHeap) {
                    isEmergency = true;
                }
            }

            if (!isEmergency && typeof triggers.maxEventLoopLag === 'number' && triggers.maxEventLoopLag > 0) {
                const lagMs = eldMonitor.mean / 1e6;
                if (lagMs >= triggers.maxEventLoopLag) {
                    isEmergency = true;
                }
            }

            if (!isEmergency && typeof triggers.maxConnections === 'number' && triggers.maxConnections > 0) {
                const connections = await getServerConnections(req.socket.server);
                if (connections >= triggers.maxConnections) {
                    isEmergency = true;
                }
            }
        }

        const isResilienceActive = isEmergency || resConfig.forceMode === true;
        
        let userEntropy    = crypto.createHmac('sha256', process.env.MASTER_PEPPER || '7f8a9d1e-QUELORA-SEC-2b3c-4d5e-6f7g')
                                   .update(cid)
                                   .digest('hex');
                                   
        let isCustomPepper = false;

        if (req.user && req.user.author) {
            const profile = await Profile.findOne({ author: req.user.author, cid }).select('vaultPepper').lean();
            if (profile && profile.vaultPepper) {
                userEntropy    = profile.vaultPepper;
                isCustomPepper = true;
            }
        }

        const ipSanitized  = (req.headers['x-forwarded-for'] || req.socket.remoteAddress || '').replace(/[^0-9a-fA-F]/g, '');
        const tempAuthorId = req.user?.author || `guest_${ipSanitized.substring(0, 16)}`;
        
        const bootstrapPayload = {
            publicKey:      resConfig.publicKey,
            vaultPepper:    userEntropy,
            isCustomPepper: isCustomPepper,
        };

        if (isResilienceActive) {
            const effectiveMode = resConfig.mode || 'HYBRID';
            bootstrapPayload.mode = effectiveMode;
            
            const requiresPeers = effectiveMode === 'HYBRID' || effectiveMode === 'P2P_ONLY';
            
            if (requiresPeers) {
                const isAuthenticatedUser = req.user?.author && !tempAuthorId.startsWith('guest_');

                if (isAuthenticatedUser && process.env.RELAY_AUTH_SECRET) {
                    try {
                        const rt = generateRelayToken(req.user.author);
                        bootstrapPayload.relayToken = rt.token;
                        bootstrapPayload.relaySlot  = rt.slot;
                    } catch (relayTokenError) {
                        console.error('[Resilience] Relay token generation failed:', relayTokenError.message);
                    }
                }

                const geoData = req.geoData || {};
                try {
                    const discoveryResult = await peerDiscoveryService.findOptimalPeers(
                        tempAuthorId,
                        cid,
                        geoData,
                        5
                    );
                    bootstrapPayload.peers = discoveryResult?.peers || [];
                } catch (discoveryError) {
                    console.error(`[Resilience] Peer discovery failed for ${cid}:`, discoveryError.message);
                    bootstrapPayload.peers = [];
                }
            } else {
                bootstrapPayload.peers = [];
            }
        }

        const headerValue = Buffer.from(JSON.stringify(bootstrapPayload)).toString('base64');
        res.setHeader('X-Resilience-Bootstrap', headerValue);

        res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, proxy-revalidate');
        res.setHeader('Pragma',        'no-cache');
        res.setHeader('Expires',       '0');

    } catch (error) {
        console.error('[Resilience] Critical bootstrap middleware error:', error.message);
    }

    return next();
};

module.exports = resilienceBootstrapMiddleware;