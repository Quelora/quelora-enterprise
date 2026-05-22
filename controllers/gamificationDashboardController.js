/*
 * Quelora — quelora-enterprise
 * Copyright (C) 2026 Germán Zelaya — https://quelora.org
 * SPDX-License-Identifier: AGPL-3.0-only
 *
 * This file is part of Quelora. See the LICENSE file for terms.
 */

/**
 * @fileoverview Controller for Gamification Dashboard operations.
 */

const GamificationConfig = require('../models/GamificationConfig');
const GamificationRule = require('../models/GamificationRule');
const GamificationLevel = require('../models/GamificationLevel');
const GamificationLedger = require('../models/GamificationLedger');
const GamificationQuest = require('../models/GamificationQuest');
const GamificationShopItem = require('../models/GamificationShopItem');

const gamificationService = require('../services/gamificationService');
const gamificationPackService = require('../services/gamificationPackService');
const Profile = require('@quelora/common/models/Profile');
const { dispatchGamificationNotification } = require('../utils/gamificationNotificationUtils');

const getCid = (req) => req.headers['x-client-id'];

/**
 * Retrieves the gamification configuration for the client.
 *
 * @param {import('express').Request} req - The Express request object.
 * @param {import('express').Response} res - The Express response object.
 * @returns {Promise<void>}
 */
exports.getConfig = async (req, res) => {
    try {
        const cid = getCid(req);
        let config = await GamificationConfig.findOne({ cid });
        if (!config) {
            config = { cid, enabled: false, currency: { name: 'Queloros', symbol: '🪙' }, resetStrategy: 'NEVER' };
        }
        res.json(config);
    } catch (error) { res.status(500).json({ success: false, message: error.message }); }
};

/**
 * Updates or inserts the gamification configuration for the client.
 *
 * @param {import('express').Request} req - The Express request object.
 * @param {import('express').Response} res - The Express response object.
 * @returns {Promise<void>}
 */
exports.upsertConfig = async (req, res) => {
    try {
        const cid = getCid(req);
        const config = await GamificationConfig.findOneAndUpdate(
            { cid }, req.body, { new: true, upsert: true, setDefaultsOnInsert: true }
        );
        res.json({ success: true, config });
    } catch (error) { res.status(500).json({ success: false, message: error.message }); }
};

/**
 * Retrieves economy statistics.
 *
 * @param {import('express').Request} req - The Express request object.
 * @param {import('express').Response} res - The Express response object.
 * @returns {Promise<void>}
 */
exports.getEconomyStats = async (req, res) => {
    try {
        const cid = getCid(req);
        const { from, to } = req.query;
        const stats = await gamificationService.getEconomyStats(cid, from, to);
        res.json({ success: true, stats });
    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
};

/**
 * Retrieves gamification rules.
 *
 * @param {import('express').Request} req - The Express request object.
 * @param {import('express').Response} res - The Express response object.
 * @returns {Promise<void>}
 */
exports.getRules = async (req, res) => {
    try {
        const cid = getCid(req);
        const possibleActions = GamificationRule.schema.path('actionType').enumValues;
        const existingRules = await GamificationRule.find({ cid });
        const result = possibleActions.map(action => {
            const found = existingRules.find(r => r.actionType === action);
            return found || { actionType: action, xpReward: 0, coinReward: 0, dailyLimit: 0, active: false, cid };
        });
        res.json(result);
    } catch (error) { res.status(500).json({ success: false, message: error.message }); }
};

/**
 * Updates or inserts a gamification rule.
 *
 * @param {import('express').Request} req - The Express request object.
 * @param {import('express').Response} res - The Express response object.
 * @returns {Promise<void>}
 */
exports.upsertRule = async (req, res) => {
    try {
        const cid = getCid(req);
        const rule = await GamificationRule.findOneAndUpdate(
            { cid, actionType: req.body.actionType }, req.body, { new: true, upsert: true }
        );
        res.json({ success: true, rule });
    } catch (error) { res.status(500).json({ success: false, message: error.message }); }
};

/**
 * Retrieves gamification levels.
 *
 * @param {import('express').Request} req - The Express request object.
 * @param {import('express').Response} res - The Express response object.
 * @returns {Promise<void>}
 */
exports.getLevels = async (req, res) => {
    try {
        const levels = await GamificationLevel.find({ cid: getCid(req) }).sort({ minPoints: 1 });
        res.json(levels);
    } catch (error) { res.status(500).json({ success: false, message: error.message }); }
};

/**
 * Updates or inserts a gamification level.
 *
 * @param {import('express').Request} req - The Express request object.
 * @param {import('express').Response} res - The Express response object.
 * @returns {Promise<void>}
 */
exports.upsertLevel = async (req, res) => {
    try {
        const cid = getCid(req);
        const { _id, ...data } = req.body;
        let level;
        if (_id) {
            level = await GamificationLevel.findOneAndUpdate({ _id, cid }, data, { new: true });
        } else {
            if (!data.order) {
                const max = await GamificationLevel.findOne({ cid }).sort({ order: -1 });
                data.order = (max?.order || 0) + 1;
            }
            level = await GamificationLevel.create({ cid, ...data });
        }
        res.json({ success: true, level });
    } catch (error) { res.status(500).json({ success: false, message: error.message }); }
};

/**
 * Deletes a gamification level.
 *
 * @param {import('express').Request} req - The Express request object.
 * @param {import('express').Response} res - The Express response object.
 * @returns {Promise<void>}
 */
exports.deleteLevel = async (req, res) => {
    try {
        await GamificationLevel.findOneAndDelete({ _id: req.params.id, cid: getCid(req) });
        res.json({ success: true });
    } catch (error) { res.status(500).json({ success: false, message: error.message }); }
};

/**
 * Retrieves gamification quests.
 *
 * @param {import('express').Request} req - The Express request object.
 * @param {import('express').Response} res - The Express response object.
 * @returns {Promise<void>}
 */
exports.getQuests = async (req, res) => {
    try {
        const cid = getCid(req);
        const quests = await GamificationQuest.find({ cid }).sort({ active: -1, order: 1 });
        res.json(quests);
    } catch (error) { res.status(500).json({ success: false, message: error.message }); }
};

/**
 * Creates a gamification quest.
 *
 * @param {import('express').Request} req - The Express request object.
 * @param {import('express').Response} res - The Express response object.
 * @returns {Promise<void>}
 */
exports.createQuest = async (req, res) => {
    try {
        const cid = getCid(req);
        const questData = { ...req.body, cid };
        const quest = await GamificationQuest.create(questData);
        res.status(201).json({ success: true, quest });
    } catch (error) { res.status(500).json({ success: false, message: error.message }); }
};

/**
 * Updates a gamification quest.
 *
 * @param {import('express').Request} req - The Express request object.
 * @param {import('express').Response} res - The Express response object.
 * @returns {Promise<void>}
 */
exports.updateQuest = async (req, res) => {
    try {
        const cid = getCid(req);
        const { id } = req.params;
        const quest = await GamificationQuest.findOneAndUpdate(
            { _id: id, cid },
            req.body,
            { new: true }
        );
        if (!quest) return res.status(404).json({ success: false, message: 'Quest not found' });
        res.json({ success: true, quest });
    } catch (error) { res.status(500).json({ success: false, message: error.message }); }
};

/**
 * Deletes a gamification quest.
 *
 * @param {import('express').Request} req - The Express request object.
 * @param {import('express').Response} res - The Express response object.
 * @returns {Promise<void>}
 */
exports.deleteQuest = async (req, res) => {
    try {
        const cid = getCid(req);
        const { id } = req.params;
        await GamificationQuest.deleteOne({ _id: id, cid });
        res.json({ success: true, message: 'Quest deleted' });
    } catch (error) { res.status(500).json({ success: false, message: error.message }); }
};

/**
 * Retrieves gamification status for a user.
 *
 * @param {import('express').Request} req - The Express request object.
 * @param {import('express').Response} res - The Express response object.
 * @returns {Promise<void>}
 */
exports.getUserStatus = async (req, res) => {
    try {
        const cid = getCid(req);
        const { author } = req.params;

        let profileId = author;
        if (author.match(/^[0-9a-fA-F]{24}$/)) {
             const p = await Profile.findOne({ _id: author, cid }).select('_id');
             if (!p) return res.status(404).json({ message: 'User not found' });
             profileId = p._id;
        } else if (author.length > 24) {
             const p = await Profile.findOne({ author, cid }).select('_id');
             if (!p) return res.status(404).json({ message: 'User not found' });
             profileId = p._id;
        }

        const status = await gamificationService.getUserStatus(cid, profileId);
        res.json({ success: true, status });
    } catch (error) {
        console.error(error);
        res.status(500).json({ success: false, message: error.message });
    }
};

/**
 * Handles individual asset uploads.
 *
 * @param {import('express').Request} req - The Express request object.
 * @param {import('express').Response} res - The Express response object.
 * @returns {Promise<void>}
 */
exports.uploadAsset = (req, res) => {
    if (!req.file) return res.status(400).json({ success: false, message: 'No file' });
    const cid = req.headers['x-client-id'];
    res.json({ success: true, mediaUrl: `/assets/gamification/${cid}/${req.file.filename}`, mediaType: 'image' });
};

/**
 * Retrieves the ledger for a user.
 *
 * @param {import('express').Request} req - The Express request object.
 * @param {import('express').Response} res - The Express response object.
 * @returns {Promise<void>}
 */
exports.getUserLedger = async (req, res) => {
    try {
        const cid = getCid(req);
        const { author } = req.params; 
        const { page = 1, limit = 20 } = req.query;
        
        let user = await Profile.findOne({ author, cid }).select('_id');
        if (!user && author.match(/^[0-9a-fA-F]{24}$/)) {
             user = await Profile.findOne({ _id: author, cid }).select('_id');
        }
        if (!user) return res.status(404).json({ success: false, message: 'Profile not found' });

        const skip = (parseInt(page) - 1) * parseInt(limit);
        const query = { cid, profile_id: user._id };

        const ledger = await GamificationLedger.find(query)
            .sort({ created_at: -1 }).skip(skip).limit(parseInt(limit))
            .populate('profile_id', 'username avatar name picture'); 

        const total = await GamificationLedger.countDocuments(query);

        res.json({
            data: ledger,
            pagination: { total, page: parseInt(page), limit: parseInt(limit), pages: Math.ceil(total / parseInt(limit)) }
        });
    } catch (error) { res.status(500).json({ success: false, message: error.message }); }
};

/**
 * Manually adjusts a user's balance.
 *
 * @param {import('express').Request} req - The Express request object.
 * @param {import('express').Response} res - The Express response object.
 * @returns {Promise<void>}
 */
exports.manualAdjustment = async (req, res) => {
    try {
        const cid = getCid(req);
        const { profileId, amount, description } = req.body;

        let targetId = profileId;
        if (typeof profileId === 'string' && profileId.length > 24) { 
             const p = await Profile.findOne({ author: profileId, cid }).select('_id');
             if (!p) return res.status(404).json({ message: 'User not found' });
             targetId = p._id;
        }

        await gamificationService.adjustBalance(cid, targetId, amount, description);
        res.json({ success: true });
    } catch (error) {
        console.error(error);
        res.status(500).json({ success: false, message: error.message });
    }
};

/**
 * Manually assigns a level to a user.
 *
 * @param {import('express').Request} req - The Express request object.
 * @param {import('express').Response} res - The Express response object.
 * @returns {Promise<void>}
 */
exports.manualLevelAssign = async (req, res) => {
    try {
        const cid = getCid(req);
        const { profileId, levelId, reason } = req.body;

        let targetId = profileId;
        if (typeof profileId === 'string' && profileId.length > 24) { 
             const p = await Profile.findOne({ author: profileId, cid }).select('_id');
             if (!p) return res.status(404).json({ message: 'User not found' });
             targetId = p._id;
        }

        await gamificationService.assignLevel(cid, targetId, levelId, reason);
        res.json({ success: true });
    } catch (error) {
        console.error(error);
        res.status(500).json({ success: false, message: error.message });
    }
};

/**
 * Sends a test gamification notification.
 *
 * @param {import('express').Request} req - The Express request object.
 * @param {import('express').Response} res - The Express response object.
 * @returns {Promise<void>}
 */
exports.sendTestNotification = async (req, res) => {
    try {
        const cid = getCid(req);
        const { profileId, type, metadata } = req.body;

        if (!profileId || !type) {
            return res.status(400).json({ success: false, message: 'Missing profileId or type' });
        }

        let targetId = profileId;
        if (typeof profileId === 'string' && profileId.length > 24) { 
             const p = await Profile.findOne({ author: profileId, cid }).select('_id');
             if (!p) return res.status(404).json({ message: 'User not found' });
             targetId = p._id;
        }

        console.log(`Sending TEST notification [${type}] to ${targetId}`);

        await dispatchGamificationNotification({
            cid,
            profileId: targetId,
            type, 
            metadata: metadata || { 
                levelName: 'Test Admin Level', 
                points: 999, 
                days: 7 
            }
        });

        res.json({ success: true, message: 'Notification dispatched to queues' });
    } catch (error) {
        console.error(error);
        res.status(500).json({ success: false, message: error.message });
    }
};

/**
 * Retrieves all shop items.
 *
 * @param {import('express').Request} req - The Express request object.
 * @param {import('express').Response} res - The Express response object.
 * @returns {Promise<void>}
 */
exports.getShopItems = async (req, res) => {
    try {
        const cid = getCid(req);
        const items = await GamificationShopItem.find({ cid }).sort({ order: 1 });
        res.json(items);
    } catch (error) { res.status(500).json({ success: false, message: error.message }); }
};

/**
 * Creates a new shop item.
 *
 * @param {import('express').Request} req - The Express request object.
 * @param {import('express').Response} res - The Express response object.
 * @returns {Promise<void>}
 */
exports.createShopItem = async (req, res) => {
    try {
        const cid = getCid(req);
        const itemData = { ...req.body, cid };
        const item = await GamificationShopItem.create(itemData);
        res.status(201).json({ success: true, item });
    } catch (error) { res.status(500).json({ success: false, message: error.message }); }
};

/**
 * Updates an existing shop item.
 *
 * @param {import('express').Request} req - The Express request object.
 * @param {import('express').Response} res - The Express response object.
 * @returns {Promise<void>}
 */
exports.updateShopItem = async (req, res) => {
    try {
        const cid = getCid(req);
        const { id } = req.params;
        const item = await GamificationShopItem.findOneAndUpdate(
            { _id: id, cid },
            req.body,
            { new: true }
        );
        if (!item) return res.status(404).json({ success: false, message: 'Item not found' });
        res.json({ success: true, item });
    } catch (error) { res.status(500).json({ success: false, message: error.message }); }
};

/**
 * Deletes a shop item.
 *
 * @param {import('express').Request} req - The Express request object.
 * @param {import('express').Response} res - The Express response object.
 * @returns {Promise<void>}
 */
exports.deleteShopItem = async (req, res) => {
    try {
        const cid = getCid(req);
        const { id } = req.params;
        await GamificationShopItem.deleteOne({ _id: id, cid });
        res.json({ success: true, message: 'Item deleted' });
    } catch (error) { res.status(500).json({ success: false, message: error.message }); }
};

/**
 * Processes and imports a .gpack archive containing shop items and assets.
 * Validates the file, offloads processing to the service, and returns a summary.
 *
 * @param {import('express').Request} req - The Express request object.
 * @param {import('express').Response} res - The Express response object.
 * @returns {Promise<void>} JSON summary of the import operation.
 */
exports.importPack = async (req, res) => {
    try {
        const cid = getCid(req);
        if (!req.file) {
            return res.status(400).json({ success: false, message: 'No pack file provided.' });
        }

        const result = await gamificationPackService.processPack(cid, req.file.path, req.file.destination);

        res.status(200).json(result);
    } catch (error) {
        console.error('[gamificationDashboardController] importPack error:', error);
        res.status(500).json({ success: false, message: error.message });
    }
};