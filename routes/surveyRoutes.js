/*
 * Quelora — quelora-enterprise
 * Copyright (C) 2026 Germán Zelaya — https://quelora.org
 * SPDX-License-Identifier: AGPL-3.0-only
 *
 * This file is part of Quelora. See the LICENSE file for terms.
 */

// ./routes/surveyRoutes.js
const express = require('express');
const router = express.Router();
const surveyController = require('../controllers/surveyController');
const optionalAuthMiddleware = require('@quelora/common/middlewares/optionalAuthMiddleware');
const { globalRateLimiter, strictRateLimiter } = require('@quelora/common/middlewares/rateLimiterMiddleware');
const responseCompressor = require('@quelora/common/middlewares/responseCompressor');

router.get('/post/:entityId', [globalRateLimiter, optionalAuthMiddleware, responseCompressor], surveyController.getSurveyByEntity);
router.post('/vote/:surveyId/:optionId', [globalRateLimiter, strictRateLimiter, optionalAuthMiddleware, responseCompressor], surveyController.registerVote);

module.exports = router;