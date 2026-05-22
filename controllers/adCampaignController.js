/*
 * Quelora — quelora-enterprise
 * Copyright (C) 2026 Germán Zelaya — https://quelora.org
 * SPDX-License-Identifier: AGPL-3.0-only
 *
 * This file is part of Quelora. See the LICENSE file for terms.
 */

const { mongoose } = require('@quelora/common/db');
const AdCampaignService = require('../services/adCampaignService');
const { getFilterCids, validateCidAccess, validateResourceAccess } = require('../utils/accessControl'); 

exports.getCampaignsByClient = async (req, res, next) => {
    try {
        const { page = 1, limit = 10, cid, search, status, sort = 'createdAt', order = 'desc' } = req.query;
        const userId = req.user._id;
        const userRole = req.user.role; 

        let allowedCids;
        try {
            allowedCids = await getFilterCids(userId, userRole, cid);
        } catch (e) {
            return res.status(403).json({ success: false, error: e.message });
        }

        const filters = {
            page: parseInt(page),
            limit: parseInt(limit),
            sort,
            order,
            search,
            status
        };

        const result = await AdCampaignService.getCampaignsByClient(allowedCids, filters);

        res.json({
            success: true,
            data: result
        });
    } catch (error) {
        console.error('Error getting campaigns:', error);
        next(error);
    }
};

exports.getCampaignById = async (req, res, next) => {
    try {
        const { id } = req.params;
        const userId = req.user._id;
        const userRole = req.user.role;

        if (!mongoose.Types.ObjectId.isValid(id)) {
            return res.status(400).json({ success: false, error: 'Invalid Campaign ID' });
        }

        const campaign = await AdCampaignService.getCampaignById(id);
        if (!campaign) {
            return res.status(404).json({ success: false, error: 'Campaign not found' });
        }

        try {
            await validateResourceAccess(campaign, userId, userRole);
        } catch (e) {
            return res.status(403).json({ success: false, error: 'Access denied' });
        }

        res.json({ success: true, data: campaign });
    } catch (error) {
        console.error('Error getting campaign:', error);
        next(error);
    }
};

exports.upsertCampaign = async (req, res, next) => {
    try {
        const userId = req.user._id;
        const userRole = req.user.role;
        const { cids } = req.body;

        if (!cids || !Array.isArray(cids) || cids.length === 0) {
            return res.status(400).json({ success: false, error: 'At least one CID is required' });
        }

        try {
            await validateCidAccess(userId, userRole, cids);
        } catch (e) {
            return res.status(403).json({ success: false, error: e.message });
        }

        const savedCampaign = await AdCampaignService.upsertCampaign(req.body);

        res.json({ success: true, data: savedCampaign });
    } catch (error) {
        console.error('Error upserting campaign:', error);
        next(error);
    }
};

exports.deleteCampaign = async (req, res, next) => {
    try {
        const { id } = req.params;
        const userId = req.user._id;
        const userRole = req.user.role;

        if (!mongoose.Types.ObjectId.isValid(id)) {
            return res.status(400).json({ success: false, error: 'Invalid Campaign ID' });
        }

        const campaign = await AdCampaignService.getCampaignById(id);
        if (!campaign) {
            return res.status(404).json({ success: false, error: 'Campaign not found' });
        }

        try {
            await validateResourceAccess(campaign, userId, userRole);
        } catch (e) {
            return res.status(403).json({ success: false, error: 'Access denied' });
        }

        const result = await AdCampaignService.deleteCampaign(id);

        res.json({ success: true, ...result });
    } catch (error) {
        console.error('Error deleting campaign:', error);
        next(error);
    }
};