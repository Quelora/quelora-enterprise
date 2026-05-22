/*
 * Quelora — quelora-enterprise
 * Copyright (C) 2026 Germán Zelaya — https://quelora.org
 * SPDX-License-Identifier: AGPL-3.0-only
 *
 * This file is part of Quelora. See the LICENSE file for terms.
 */

const express = require('express');
const router = express.Router();
const placementController = require('../controllers/placementController');

const AD_ROLES = ['god','admin', 'advertiser'];

module.exports = ({ adminAuthMiddleware, checkRole }) => {
    if (!adminAuthMiddleware || !checkRole) throw new Error('placementRoutes missing dependencies');

    router.get('/', adminAuthMiddleware, checkRole(AD_ROLES), placementController.getPlacements);
    router.post('/', adminAuthMiddleware, checkRole(AD_ROLES), placementController.upsertPlacement);
    router.delete('/:id', adminAuthMiddleware, checkRole(AD_ROLES), placementController.deletePlacement);

    return router;
};