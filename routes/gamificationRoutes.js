/*
 * Quelora — quelora-enterprise
 * Copyright (C) 2026 Germán Zelaya — https://quelora.org
 * SPDX-License-Identifier: AGPL-3.0-only
 *
 * This file is part of Quelora. See the LICENSE file for terms.
 */

const express = require('express');
const router = express.Router();
const gamificationController = require('../controllers/gamificationController');
const authMiddleware = require('@quelora/common/middlewares/authMiddleware');
const { globalRateLimiter, strictRateLimiter } = require('@quelora/common/middlewares/rateLimiterMiddleware');
const responseCompressor = require('@quelora/common/middlewares/responseCompressor');

router.get('/me', 
    [globalRateLimiter, strictRateLimiter, authMiddleware, responseCompressor], 
    gamificationController.getMyStatus
);

router.get('/leaderboard', 
    [globalRateLimiter, strictRateLimiter, authMiddleware, responseCompressor], 
    gamificationController.getLeaderboard
);

router.post('/claim',
    [globalRateLimiter, strictRateLimiter, authMiddleware, responseCompressor],
    gamificationController.claimReward
);

router.get('/user/:memberId/public',
    [globalRateLimiter, strictRateLimiter, authMiddleware, responseCompressor], 
    gamificationController.getPublicStats
);

module.exports = router;