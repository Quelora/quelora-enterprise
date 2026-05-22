/*
 * Quelora — quelora-enterprise
 * Copyright (C) 2026 Germán Zelaya — https://quelora.org
 * SPDX-License-Identifier: AGPL-3.0-only
 *
 * This file is part of Quelora. See the LICENSE file for terms.
 */

/* filepath: packages/quelora-enterprise/controllers/p2pController.js */

/**
 * @file p2pController.js
 * @description Controller for routing WebRTC signaling messages and provisioning Network Resources (TURN).
 * @module @quelora/enterprise/controllers/p2pController
 */

const { cacheClient } = require('@quelora/common/services/cacheService');
const sseService = require('../services/sseService');
const peerDiscoveryService = require('../services/peerDiscoveryService');
const turnService = require('../services/turnService');

/**
 * Helper to generate the Tenant-Specific Peer Map Key.
 * @param {string} cid 
 * @param {string} peerId 
 */
const getPeerMapKey = (cid, peerId) => `cid:${cid}:peer:map:${peerId}`;

/**
 * Resolves the online PeerID for a specific Target Author.
 * Used by the Chat Module to decide between P2P Handshake (L2) and Nostr Drop (L4).
 * @param {import('express').Request} req 
 * @param {import('express').Response} res 
 */
exports.lookupPeer = async (req, res) => {
    try {
        const { targetAuthorId } = req.body;
        const cid = req.cid;

        if (!targetAuthorId) {
            return res.status(400).json({ error: 'Target Author ID required' });
        }

        // Resolve using the Discovery Service (checks Reverse Map)
        const peerId = await peerDiscoveryService.resolveTargetPeer(cid, targetAuthorId);

        if (peerId) {
            return res.json({ 
                status: 'online', 
                peerId: peerId 
            });
        } else {
            return res.json({ 
                status: 'offline', 
                peerId: null 
            });
        }

    } catch (error) {
        console.error('[P2P Controller] Lookup Error:', error);
        return res.status(500).json({ error: 'Lookup failed' });
    }
};

/**
 * Generates ephemeral TURN/STUN credentials for the authenticated user.
 * Supports both Registered Users (Bearer Token) and Guests (SSE Ticket).
 * * @param {import('express').Request} req 
 * @param {import('express').Response} res 
 */
exports.getTurnCredentials = async (req, res) => {
    try {
        const cid = req.cid;
        const user = req.user;

        // Security Gate: Ensure request is authenticated.
        // req.user is populated by authMiddleware (Users) or sseAuthMiddleware (Guests)
        if (!user || !user.author) {
            return res.status(401).json({ error: 'Unauthorized. Valid Session Required.' });
        }

        const iceServers = await turnService.generateIceCredentials(cid, user.author);

        return res.json({ iceServers });

    } catch (error) {
        console.error('[P2P Controller] TURN Generation Error:', error);
        return res.status(500).json({ error: 'Failed to provision network resources' });
    }
};

/**
 * Routes a WebRTC signal (Offer/Answer/Candidate) to a target peer.
 * Uses the SSE channel (Persistent for Users, Ephemeral for Guests).
 * UPDATED: Supports Protocol Multiplexing (Chat vs Mesh vs Video).
 * @param {import('express').Request} req 
 * @param {import('express').Response} res 
 */
exports.routeSignal = async (req, res) => {
    try {
        const { targetPeerId, senderPeerId, signalData, protocol } = req.body;
        
        // 1. Resolve Sender Identity
        // Priority: Auth Token (User) > Header Identity (Guest)
        let senderId = req.user?.author; 
        if (!senderId) {
            senderId = req.headers['x-guest-id'] || req.headers['x-identity'];
        }

        const cid = req.cid; 

        if (!targetPeerId || !signalData || !senderPeerId) {
            return res.status(400).json({ error: 'Missing required fields' });
        }

        if (!cid) {
            return res.status(400).json({ error: 'Missing Client Context (CID)' });
        }

        // --- 2. Auto-Register Sender Mapping ---
        // Ensure the sender has a return path mapped in Redis.
        if (senderId) {
            const senderMapKey = getPeerMapKey(cid, senderPeerId);
            // Refresh/Set mapping for 5 minutes (Active Session Window)
            await cacheClient.set(senderMapKey, senderId, 'EX', 300);
        } else {
            console.warn(`[P2P] Signal from unidentified source ${senderPeerId}`);
        }

        // --- 3. Resolve Target Identity ---
        const targetMapKey = getPeerMapKey(cid, targetPeerId);
        const targetRealId = await cacheClient.get(targetMapKey);

        if (!targetRealId) {
            return res.status(404).json({ error: 'Peer unreachable or expired' });
        }

        // --- 4. Anti-Spoofing Check ---
        // Verify sender owns the senderPeerId
        const senderMapKey = getPeerMapKey(cid, senderPeerId);
        const registeredOwner = await cacheClient.get(senderMapKey);

        if (registeredOwner && senderId && registeredOwner !== senderId) {
            console.warn(`[P2P] Spoof attempt: ${senderId} tried to use ${senderPeerId}`);
            return res.status(403).json({ error: 'Identity verification failed' });
        }

        // --- 5. Determine SSE Event Type based on Protocol (Server-Side Routing) ---
        // Default: 'p2p_signal' (Legacy/Mesh)
        // If protocol='CHAT' -> 'p2p_signal_chat'
        // If protocol='VIDEO' -> 'p2p_signal_video'
        let eventType = 'p2p_signal'; 
        
        if (protocol && typeof protocol === 'string') {
            eventType = `p2p_signal_${protocol.trim().toLowerCase()}`;
        }

        // --- 6. Dispatch via SSE ---
        await sseService.sendNotificationToUser(cid, targetRealId, {
            type: eventType,
            senderPeerId: senderPeerId, 
            payload: signalData
        });

        return res.status(200).json({ status: 'delivered', routedAs: eventType });

    } catch (error) {
        console.error('[P2P Controller] Routing Error:', error);
        return res.status(500).json({ error: 'Signaling failed' });
    }
};