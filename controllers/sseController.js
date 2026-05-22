/*
 * Quelora — quelora-enterprise
 * Copyright (C) 2026 Germán Zelaya — https://quelora.org
 * SPDX-License-Identifier: AGPL-3.0-only
 *
 * This file is part of Quelora. See the LICENSE file for terms.
 */

/* filepath: packages/quelora-enterprise/controllers/sseController.js */
const sseService = require('../services/sseService');
const crypto = require('crypto');

/**
 * @file sseController.js
 * @description Controller for SSE Ticket generation and Stream handling.
 * Implements the "Ephemeral Signaling Window" for guest users.
 * @module @quelora/enterprise/controllers/sseController
 */

/**
 * Timeout in milliseconds for Guest/Anonymous SSE connections.
 * Set to 60 seconds (60000ms) to allow sufficient time for WebRTC signaling (Offer/Answer/Candidates)
 * before forcibly releasing server resources.
 * @constant {number}
 */
const GUEST_SESSION_TIMEOUT_MS = 60000;

/**
 * Generates a one-time authentication ticket for SSE.
 * Supports both Authenticated Users and Anonymous Guests.
 * Use the 'X-Guest-ID' header to maintain identity consistency across requests.
 * * @param {import('express').Request} req
 * @param {import('express').Response} res
 */
exports.getTicket = async (req, res) => {
    try {
        let userId = req.user?.author;
        const cid = req.cid; 

        // --- GUEST HANDLING ---
        // If no logged user, check for Guest ID header or generate one.
        // This enables P2P signaling for anonymous users.
        if (!userId) {
            const guestIdHeader = req.headers['x-guest-id'] || req.headers['x-peer-id'];
            if (guestIdHeader) {
                // Use provided Guest ID (Client-side generated UUID)
                userId = guestIdHeader;
            } else {
                // Auto-generate guest ID if missing to ensure uniqueness
                userId = `guest_${crypto.randomBytes(8).toString('hex')}`;
            }
        }

        // Security/Audit Check: Ensure we are in a valid Tenant Context
        if (!cid) {
             console.error('[SSE Controller] Missing CID in request context.');
             return res.status(400).json({ error: 'Missing Client Context (CID)' });
        }

        // Generate Ticket (Valid for both User and Guest)
        // The ticket is scoped to the CID to prevent cross-tenant access.
        const ticket = await sseService.generateTicket(cid, userId);

        return res.json({
            status: 'success',
            ticket,
            identity: userId, // Return identity so client knows its assigned ID
            expires_in: 10
        });
    } catch (error) {
        console.error('SSE Ticket Error:', error);
        res.status(500).json({ error: 'Failed to generate ticket' });
    }
};

/**
 * Establishes the SSE stream connection.
 * Requires a valid ticket verified by sseAuthMiddleware.
 * * Enforces the "Ephemeral Signaling Window" policy:
 * - Authenticated Users: Persistent connection (0 timeout).
 * - Guest Users: Ephemeral connection (60s timeout).
 * * @param {import('express').Request} req
 * @param {import('express').Response} res
 */
exports.streamNotifications = (req, res) => {
    // Disable default socket timeout to allow persistent streams
    req.socket.setTimeout(0);

    // Identity is guaranteed by sseAuthMiddleware (User or Guest)
    const userId = req.user.author;
    const isGuest = req.user.isGuest === true;

    // Delegate connection setup to the service
    sseService.addClient(req, res, userId);

    // --- EPHEMERAL WINDOW ENFORCEMENT ---
    // If the connected client is a Guest (Anonymous), we enforce a hard limit on the connection duration.
    // This allows enough time for the P2P handshake (WebRTC Offer/Answer) but prevents
    // anonymous users from occupying server sockets indefinitely.
    if (isGuest) {
        const timeoutId = setTimeout(() => {
            if (!res.writableEnded) {
                // Inform client of intentional shutdown
                res.write('event: shutdown\ndata: {"reason": "ephemeral_timeout"}\n\n');
                res.end();
            }
        }, GUEST_SESSION_TIMEOUT_MS);

        // Cleanup: If the client disconnects manually before the timeout, clear the timer
        req.on('close', () => {
            clearTimeout(timeoutId);
        });
    }
};