/*
 * Quelora — quelora-enterprise
 * Copyright (C) 2026 Germán Zelaya — https://quelora.org
 * SPDX-License-Identifier: AGPL-3.0-only
 *
 * This file is part of Quelora. See the LICENSE file for terms.
 */

const express = require('express');
const router = express.Router();
const placementPricingController = require('../controllers/placementPricingController');

const AD_ROLES = ['god','admin', 'advertiser'];

module.exports = ({ adminAuthMiddleware, checkRole }) => {
    if (!adminAuthMiddleware || !checkRole) throw new Error('placementPricingRoutes missing dependencies');

    router.get('/', adminAuthMiddleware, checkRole(AD_ROLES), placementPricingController.getPlacementPricing);
    router.post('/', adminAuthMiddleware, checkRole(AD_ROLES), placementPricingController.upsertPlacementPricing);
    router.delete('/:id', adminAuthMiddleware, checkRole(AD_ROLES), placementPricingController.deletePlacementPricing);

    return router;
};