/*
 * Quelora — quelora-enterprise
 * Copyright (C) 2026 Germán Zelaya — https://quelora.org
 * SPDX-License-Identifier: AGPL-3.0-only
 *
 * This file is part of Quelora. See the LICENSE file for terms.
 */

/**
 * @fileoverview Gamification dashboard routes configuration.
 * Exposes administrative endpoints for gamification entities including
 * the secure .gpack import mechanism with distinct upload limits.
 */

const express = require('express');
const router = express.Router();
const gamificationController = require('../controllers/gamificationDashboardController');
const createUploadMiddleware = require('../middlewares/uploadMiddlewareFactory');
const { globalRateLimiter, strictRateLimiter } = require('@quelora/common/middlewares/rateLimiterMiddleware');

const SETTINGS_ROLES = ['god', 'admin'];

/**
 * Initializes and returns the gamification dashboard router.
 *
 * @param {Object} dependencies - Injected dependencies.
 * @param {Function} dependencies.adminAuthMiddleware - Middleware to authenticate administrative users.
 * @param {Function} dependencies.checkRole - Middleware factory to authorize specific roles.
 * @param {string} dependencies.publicPath - Absolute path to the public assets directory.
 * @returns {import('express').Router} The configured Express router instance.
 * @throws {Error} If required dependencies are missing.
 */
module.exports = ({ adminAuthMiddleware, checkRole, publicPath }) => {

    if (!adminAuthMiddleware || !checkRole || !publicPath) {
        throw new Error('gamificationDashboardRoutes requires adminAuthMiddleware, checkRole, and publicPath');
    }

    const assetUpload = createUploadMiddleware(publicPath, 'assets/gamification', {
        fileSizeLimit: 25 * 1024 * 1024,
        allowedMimeTypes: ['image/']
    });

    const packUpload = createUploadMiddleware(publicPath, 'assets/gamification', {
        fileSizeLimit: 1024 * 1024 * 1024,
        allowedMimeTypes: [
            'application/gzip',
            'application/x-gzip',
            'application/x-tar',
            'application/octet-stream'
        ]
    });

    const protect = [
        globalRateLimiter, 
        strictRateLimiter, 
        adminAuthMiddleware, 
        checkRole(SETTINGS_ROLES)
    ];

    router.get('/config', protect, gamificationController.getConfig);
    router.put('/config', protect, gamificationController.upsertConfig);

    router.get('/economy', protect, gamificationController.getEconomyStats);

    router.get('/rules', protect, gamificationController.getRules);
    router.put('/rules', protect, gamificationController.upsertRule);

    router.get('/levels', protect, gamificationController.getLevels);
    router.post('/levels', protect, gamificationController.upsertLevel);
    router.delete('/levels/:id', protect, gamificationController.deleteLevel);

    router.get('/quests', protect, gamificationController.getQuests);
    router.post('/quests', protect, gamificationController.createQuest);
    router.put('/quests/:id', protect, gamificationController.updateQuest);
    router.delete('/quests/:id', protect, gamificationController.deleteQuest);

    router.get('/ledger/:author', protect, gamificationController.getUserLedger);
    router.post('/adjustment', protect, gamificationController.manualAdjustment);
    router.post('/level/assign', protect, gamificationController.manualLevelAssign);
    router.get('/status/:author', protect, gamificationController.getUserStatus);
    
    router.post('/test/notify', protect, gamificationController.sendTestNotification);
    
    router.get('/shop/items', protect, gamificationController.getShopItems);
    router.post('/shop/items', protect, gamificationController.createShopItem);
    router.put('/shop/items/:id', protect, gamificationController.updateShopItem);
    router.delete('/shop/items/:id', protect, gamificationController.deleteShopItem);
    
    router.post(
        '/upload/asset',
        [
            globalRateLimiter, 
            strictRateLimiter, 
            adminAuthMiddleware, 
            checkRole(SETTINGS_ROLES),
            assetUpload.single('media')
        ], 
        gamificationController.uploadAsset
    );

    router.post(
        '/shop/import',
        [
            globalRateLimiter,
            strictRateLimiter,
            adminAuthMiddleware,
            checkRole(SETTINGS_ROLES),
            packUpload.single('pack')
        ],
        gamificationController.importPack
    );

    return router;
};