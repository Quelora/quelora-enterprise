/*
 * Quelora — quelora-enterprise
 * Copyright (C) 2026 Germán Zelaya — https://quelora.org
 * SPDX-License-Identifier: AGPL-3.0-only
 *
 * This file is part of Quelora. See the LICENSE file for terms.
 */

/* filepath: packages/quelora-enterprise/routes/p2pRoutes.js */

const express = require('express');
const router = express.Router();
const p2pController = require('../controllers/p2pController');
const validateClientHeader = require('@quelora/common/middlewares/validateClientHeaderMiddleware');
const optionalAuth = require('@quelora/common/middlewares/optionalAuthMiddleware'); 
const authMiddleware = require('@quelora/common/middlewares/authMiddleware');
const sseAuthMiddleware = require('../middlewares/sseAuthMiddleware');

/**
 * Hybrid Authentication Middleware.
 * Routes the request to the appropriate authenticator based on available credentials.
 * - If `Authorization` header is present -> `authMiddleware` (JWT).
 * - If `ticket` query param is present -> `sseAuthMiddleware` (Ephemeral Ticket).
 */
const hybridAuth = (req, res, next) => {
    if (req.headers.authorization) {
        return authMiddleware(req, res, next);
    }
    if (req.query.ticket || req.body.ticket) {
        // Map body ticket to query for sseAuthMiddleware compatibility if needed, 
        // or ensure sseAuthMiddleware checks both. 
        // For strictness with sseAuthMiddleware implementation, we ensure it's in query if that's what it expects.
        if (req.body.ticket && !req.query.ticket) req.query.ticket = req.body.ticket;
        return sseAuthMiddleware(req, res, next);
    }
    return res.status(401).json({ error: 'Authentication required (Bearer Token or SSE Ticket)' });
};

// Endpoint: POST /p2p/signal
// Routes signaling messages between peers (mesh networking).
// Requires Client ID. Optional Auth allows anonymous/guest peers if configured.
router.post('/signal', validateClientHeader, optionalAuth, p2pController.routeSignal);

// Endpoint: POST /p2p/lookup (QCM 2.0)
// Resolves Real Author ID -> Ephemeral Peer ID.
// Strict Auth: Only registered users can lookup others to prevent enumeration.
router.post('/lookup', validateClientHeader, authMiddleware, p2pController.lookupPeer);

// Endpoint: GET /p2p/turn
// Provisions ephemeral TURN/STUN credentials (ICE Servers).
// Secured via Hybrid Auth (JWT for Users, Ticket for Guests).
router.get('/turn', validateClientHeader, hybridAuth, p2pController.getTurnCredentials);

// Endpoint: POST /p2p/turn
// Post alias for /turn to support clients that prefer POST for credential fetching.
router.post('/turn', validateClientHeader, hybridAuth, p2pController.getTurnCredentials);

module.exports = router;