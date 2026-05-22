/*
 * Quelora — quelora-enterprise
 * Copyright (C) 2026 Germán Zelaya — https://quelora.org
 * SPDX-License-Identifier: AGPL-3.0-only
 *
 * This file is part of Quelora. See the LICENSE file for terms.
 */

const express = require('express');
const router = express.Router();
const storeController = require('../controllers/gamificationStoreController');
const authMiddleware = require('@quelora/common/middlewares/authMiddleware');
const { globalRateLimiter, strictRateLimiter } = require('@quelora/common/middlewares/rateLimiterMiddleware');

router.get('/shop', [globalRateLimiter, authMiddleware], storeController.getShop);
router.get('/inventory', [globalRateLimiter, authMiddleware], storeController.getInventory);
router.post('/buy', [strictRateLimiter, authMiddleware], storeController.buyItem);
router.post('/equip', [strictRateLimiter, authMiddleware], storeController.equipItem);
router.post('/use', [strictRateLimiter, authMiddleware], storeController.useItem);
router.post('/unequip', [strictRateLimiter, authMiddleware], storeController.unequipItem); 

module.exports = router;