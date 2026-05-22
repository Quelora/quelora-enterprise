/*
 * Quelora — quelora-enterprise
 * Copyright (C) 2026 Germán Zelaya — https://quelora.org
 * SPDX-License-Identifier: AGPL-3.0-only
 *
 * This file is part of Quelora. See the LICENSE file for terms.
 */

// filepath: packages/quelora-enterprise/routes/advertiserProfileRoutes.js
const express = require('express');
const router = express.Router();
const createAdvertiserController = require('../controllers/advertiserProfileController');

module.exports = ({ adminAuthMiddleware, publicPath }) => {
    if (!adminAuthMiddleware) {
        throw new Error('advertiserProfileRoutes missing adminAuthMiddleware');
    }

    const advertiserProfileController = createAdvertiserController(publicPath);

    if (!advertiserProfileController.getAdvertiserProfiles) {
        console.error('❌ CRITICAL ERROR: Advertiser Controller initialized but methods are missing!', Object.keys(advertiserProfileController));
        throw new Error('Advertiser Controller Initialization Failed');
    }

    router.get('/', adminAuthMiddleware, advertiserProfileController.getAdvertiserProfiles);
    router.post('/', adminAuthMiddleware, advertiserProfileController.upsertAdvertiserProfile);
    router.delete('/:id', adminAuthMiddleware, advertiserProfileController.deleteAdvertiserProfile);

    return router;
};