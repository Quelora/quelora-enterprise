/*
 * Quelora — quelora-enterprise
 * Copyright (C) 2026 Germán Zelaya — https://quelora.org
 * SPDX-License-Identifier: AGPL-3.0-only
 *
 * This file is part of Quelora. See the LICENSE file for terms.
 */

/* filepath: quelora-enterprise/routes/p2pRoutes.js */

const express = require('express');
const router = express.Router();
const p2pController = require('../controllers/p2pController');
const AD_ROLES = ['god','admin', 'advertiser'];

module.exports = ({ adminAuthMiddleware, checkRole }) => {
    router.get('/diagnostics', [adminAuthMiddleware, checkRole(AD_ROLES)], p2pController.getDiagnostics);
    return router;
};