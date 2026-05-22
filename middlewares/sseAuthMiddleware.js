/*
 * Quelora — quelora-enterprise
 * Copyright (C) 2026 Germán Zelaya — https://quelora.org
 * SPDX-License-Identifier: AGPL-3.0-only
 *
 * This file is part of Quelora. See the LICENSE file for terms.
 */

/* filepath: ./middlewares/sseAuthMiddleware.js */
const { getClientConfig } = require('@quelora/common/services/clientConfigService');
const sseService = require('../services/sseService');

/**
 * Middleware for SSE Authentication.
 * Validates the ephemeral ticket provided in the query string.
 * UPDATED: Supports both authenticated Users and ephemeral Guest sessions for P2P signaling.
 * * @param {import('express').Request} req - Express request object.
 * @param {import('express').Response} res - Express response object.
 * @param {import('express').NextFunction} next - Express next function.
 */
const sseAuthMiddleware = async (req, res, next) => {
  const { cid, ticket } = req.query;

  if (!cid) {
    return res.status(400).json({ error: 'Query param "cid" is required' });
  }

  if (!ticket) {
    return res.status(401).json({ message: 'Missing SSE ticket' });
  }

  try {
    // 1. Validate Client Existence
    const clientConfig = await getClientConfig(cid);
    if (!clientConfig) {
      return res.status(403).json({ error: 'Invalid client ID' });
    }

    // 2. Attach Context
    req.cid = cid;
    req.clientConfig = clientConfig;

    // 3. Validate Ticket
    // Returns userId (e.g., "u-123") OR guestId (e.g., "guest_abc")
    const identityId = await sseService.validateTicket(cid, ticket);

    if (!identityId) {
        return res.status(403).json({ message: 'Invalid or expired ticket' });
    }

    // 4. Identity Assignment
    // If it is a guest, we flag it so downstream services know not to look up a Profile
    if (identityId.startsWith('guest_')) {
        req.user = { 
            author: identityId,
            isGuest: true 
        };
    } else {
        req.user = { 
            author: identityId,
            isGuest: false
        };
    }

    next();

  } catch (error) {
    console.error('SSE Handshake Error:', error.message);
    return res.status(500).json({ error: 'Internal Server Error during handshake' });
  }
};

module.exports = sseAuthMiddleware;