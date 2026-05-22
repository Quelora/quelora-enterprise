/*
 * Quelora — quelora-enterprise
 * Copyright (C) 2026 Germán Zelaya — https://quelora.org
 * SPDX-License-Identifier: AGPL-3.0-only
 *
 * This file is part of Quelora. See the LICENSE file for terms.
 */

const express = require('express');
const router = express.Router();

const sseController = require('../controllers/sseController');
const sseAuthMiddleware = require('../middlewares/sseAuthMiddleware');
const commonAuthMiddleware = require('@quelora/common/middlewares/authMiddleware');
const { globalRateLimiter } = require('@quelora/common/middlewares/rateLimiterMiddleware');
const validateClientHeader = require('@quelora/common/middlewares/validateClientHeaderMiddleware');
const extractGeoData = require('@quelora/common/middlewares/extractGeoDataMiddleware');
const optionalAuth = require('@quelora/common/middlewares/optionalAuthMiddleware'); 

router.post('/ticket', 
    [validateClientHeader, globalRateLimiter, optionalAuth, extractGeoData], 
    sseController.getTicket
);

router.get('/stream',  
    [globalRateLimiter, sseAuthMiddleware, extractGeoData], 
    sseController.streamNotifications
);

module.exports = router;