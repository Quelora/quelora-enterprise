/*
 * Quelora — quelora-enterprise
 * Copyright (C) 2026 Germán Zelaya — https://quelora.org
 * SPDX-License-Identifier: AGPL-3.0-only
 *
 * This file is part of Quelora. See the LICENSE file for terms.
 */

const express = require('express');
const router = express.Router();
const surveyDashboardController = require('../controllers/surveyDashboardController');

const AD_ROLES = ['god','admin', 'advertiser'];

module.exports = ({ adminAuthMiddleware, checkRole }) => {
    router.get('/surveys', [adminAuthMiddleware, checkRole(AD_ROLES)], surveyDashboardController.getSurveys);
    router.post('/surveys', [adminAuthMiddleware, checkRole(AD_ROLES)], surveyDashboardController.upsertSurvey);
    router.get('/surveys/:surveyId', [adminAuthMiddleware, checkRole(AD_ROLES)], surveyDashboardController.getSurvey);
    router.delete('/surveys/:surveyId', [adminAuthMiddleware, checkRole(AD_ROLES)], surveyDashboardController.deleteSurvey);
    return router;
};