/*
 * Quelora — quelora-enterprise
 * Copyright (C) 2026 Germán Zelaya — https://quelora.org
 * SPDX-License-Identifier: AGPL-3.0-only
 *
 * This file is part of Quelora. See the LICENSE file for terms.
 */

const storeService = require('../services/gamificationStoreService');
const { getSessionUserId } = require('@quelora/common/utils/profileUtils');
const profileService = require('@quelora/common/services/profileService');

/**
 * Retrieves the list of available items in the shop.
 * * @param {import('express').Request} req - The Express request object.
 * @param {import('express').Response} res - The Express response object.
 * @param {import('express').NextFunction} next - The Express next middleware function.
 * @returns {Promise<void>} Returns a JSON object containing the shop items.
 */
exports.getShop = async (req, res, next) => {
    try {
        const cid = req.cid;
        // Fetch shop items (second param 'true' likely indicates active/available items)
        const items = await storeService.getShopItems(cid, true);
        res.status(200).json({ items });
    } catch (error) {
        next(error);
    }
};

/**
 * Retrieves the inventory for the current user's profile.
 * * @param {import('express').Request} req - The Express request object.
 * @param {import('express').Response} res - The Express response object.
 * @param {import('express').NextFunction} next - The Express next middleware function.
 * @returns {Promise<void>} Returns a JSON object containing the user's inventory.
 */
exports.getInventory = async (req, res, next) => {
    try {
        const { user } = req;
        const cid = req.cid;
        const author = user?.author;

        if (!author) return res.status(401).json({ message: 'Unauthorized' });

        // Retrieve the Profile ID directly from the session utility
        const profileId = await getSessionUserId(author, cid);
        if (!profileId) return res.status(404).json({ message: 'Profile not found' });

        const inventory = await storeService.getUserInventory(cid, profileId);
        res.status(200).json({ inventory });
    } catch (error) {
        next(error);
    }
};

/**
 * Handles the purchase of an item from the shop.
 * * @param {import('express').Request} req - The Express request object.
 * @param {import('express').Response} res - The Express response object.
 * @param {import('express').NextFunction} next - The Express next middleware function.
 * @returns {Promise<void>} Returns the result of the purchase transaction.
 */
exports.buyItem = async (req, res, next) => {
    try {
        const { user } = req;
        const cid = req.cid;
        const author = user?.author;
        const { itemId } = req.body;

        if (!author) return res.status(401).json({ message: 'Unauthorized' });

        const profileId = await getSessionUserId(author, cid);
        if (!profileId) return res.status(404).json({ message: 'Profile not found' });

        const result = await storeService.buyItem(cid, profileId, itemId);
        res.status(200).json(result);
    } catch (error) {
        res.status(400).json({ success: false, message: error.message });
    }
};

/**
 * Equips an item from the user's inventory.
 * * @param {import('express').Request} req - The Express request object.
 * @param {import('express').Response} res - The Express response object.
 * @param {import('express').NextFunction} next - The Express next middleware function.
 * @returns {Promise<void>} Returns the result of the equip action.
 */
exports.equipItem = async (req, res, next) => {
    try {
        const { user } = req;
        const cid = req.cid;
        const author = user?.author;
        const { inventoryId } = req.body;

        if (!author) return res.status(401).json({ message: 'Unauthorized' });

        const profileId = await getSessionUserId(author, cid);
        if (!profileId) return res.status(404).json({ message: 'Profile not found' });

        const result = await storeService.equipItem(cid, profileId, inventoryId);
        await profileService.deleteProfileCache(cid, author);
        res.status(200).json(result);
    } catch (error) {
        res.status(400).json({ success: false, message: error.message });
    }
};

/**
 * Uses a consumable item from the user's inventory.
 * * @param {import('express').Request} req - The Express request object.
 * @param {import('express').Response} res - The Express response object.
 * @param {import('express').NextFunction} next - The Express next middleware function.
 * @returns {Promise<void>} Returns the result of the item usage.
 */
exports.useItem = async (req, res, next) => {
    try {
        const { user } = req;
        const cid = req.cid;
        const author = user?.author;
        const { inventoryId } = req.body;

        if (!author) return res.status(401).json({ message: 'Unauthorized' });

        const profileId = await getSessionUserId(author, cid);
        if (!profileId) return res.status(404).json({ message: 'Profile not found' });

        const result = await storeService.useItem(cid, profileId, inventoryId);

        res.status(200).json(result);
    } catch (error) {
        res.status(400).json({ success: false, message: error.message });
    }
};

/**
 * Unequips an item currently equipped by the user.
 * * @param {import('express').Request} req - The Express request object.
 * @param {import('express').Response} res - The Express response object.
 * @param {import('express').NextFunction} next - The Express next middleware function.
 * @returns {Promise<void>} Returns the result of the unequip action.
 */
exports.unequipItem = async (req, res, next) => {
    try {
        const { user } = req;
        const cid = req.cid;
        const author = user?.author;
        const { inventoryId } = req.body;

        if (!author) return res.status(401).json({ message: 'Unauthorized' });

        const profileId = await getSessionUserId(author, cid);
        if (!profileId) return res.status(404).json({ message: 'Profile not found' });

        const result = await storeService.unequipItem(cid, profileId, inventoryId);
        await profileService.deleteProfileCache(cid, author);
        res.status(200).json(result);
    } catch (error) {
        res.status(400).json({ success: false, message: error.message });
    }
};