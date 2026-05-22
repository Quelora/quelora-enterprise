/*
 * Quelora — quelora-enterprise
 * Copyright (C) 2026 Germán Zelaya — https://quelora.org
 * SPDX-License-Identifier: AGPL-3.0-only
 *
 * This file is part of Quelora. See the LICENSE file for terms.
 */

/* filepath: packages/quelora-enterprise/routes/adRoutes.js */
const express = require('express');
const router = express.Router();
const adController = require('../controllers/adController'); // Controlador en Enterprise

// Middlewares de Common (Seguros de importar directo)
const validateClientHeaderMiddleware = require('@quelora/common/middlewares/validateClientHeaderMiddleware');
const optionalAuthMiddleware = require('@quelora/common/middlewares/optionalAuthMiddleware');
const extractGeoDataMiddleware = require('@quelora/common/middlewares/extractGeoDataMiddleware');

router.post(
    '/request',
    validateClientHeaderMiddleware,
    optionalAuthMiddleware, 
    extractGeoDataMiddleware,
    adController.requestAds
);

router.post(
    '/track/impression',
    validateClientHeaderMiddleware,
    optionalAuthMiddleware,
    extractGeoDataMiddleware,
    adController.registerImpression
);

router.post(
    '/track/click',
    validateClientHeaderMiddleware,
    optionalAuthMiddleware,
    extractGeoDataMiddleware,
    adController.registerClick
);

module.exports = router;