/*
 * Quelora — quelora-enterprise
 * Copyright (C) 2026 Germán Zelaya — https://quelora.org
 * SPDX-License-Identifier: AGPL-3.0-only
 *
 * This file is part of Quelora. See the LICENSE file for terms.
 */

// filepath: quelora-dashboard-api/services/adCampaignService.js
const AdCampaign = require('../models/AdCampaign');
const AdCreative = require('../models/AdCreative');
const { mongoose } = require('@quelora/common/db');

const upsertCreative = async (creativeData, campaignId) => {
    const data = { ...creativeData, campaignId };
    let id = creativeData._id;

    if (id && (String(id).startsWith('new_') || String(id).startsWith('temp_'))) {
        id = null;
    }

    if (data.creativeType === 'media') {
        data.htmlContent = null;
        data.nativeText = null;
        data.title = null;
        data.advertiserProfileId = null;
    } else if (data.creativeType === 'html') {
        data.media = null;
        data.nativeText = null;
        data.advertiserProfileId = null;
    } else if (data.creativeType === 'native') {
        data.media = null;
        data.htmlContent = null;
        data.title = null;
    }

    const processKeywords = (keywords) => {
        if (!keywords) return [];
        if (Array.isArray(keywords)) {
            return keywords.map(s => String(s).trim().toUpperCase()).filter(s => s.length > 0);
        }
        if (typeof keywords === 'string') {
            return keywords.split(',').map(s => s.trim().toUpperCase()).filter(s => s.length > 0);
        }
        return [];
    };

    data.postKeywords = processKeywords(data.postKeywords);
    data.contextualKeywords = processKeywords(data.contextualKeywords);

    if (id && mongoose.Types.ObjectId.isValid(id)) {
        return AdCreative.findByIdAndUpdate(id, data, { new: true, upsert: true, runValidators: true });
    } else {
        delete data._id;
        return AdCreative.create(data);
    }
};

exports.getCampaignsByClient = async (allowedCids, filters = {}) => {
    const { page = 1, limit = 10, sort = 'created_at', order = 'desc', search = '', status } = filters;
    const query = {
        cids: { $in: allowedCids }
    };

    if (search) {
        query.name = { $regex: search, $options: 'i' };
    }

    if (status) {
        query.status = status;
    }

    const sortOrder = order === 'asc' ? 1 : -1;
    const sortOptions = { [sort]: sortOrder, _id: -1 };

    const [campaigns, totalItems] = await Promise.all([
        AdCampaign.find(query)
            .sort(sortOptions)
            .skip((page - 1) * limit)
            .limit(limit)
            .lean(),
        AdCampaign.countDocuments(query)
    ]);

    return {
        campaigns,
        pagination: {
            totalItems,
            totalPages: Math.ceil(totalItems / limit),
            currentPage: page,
            itemsPerPage: limit
        }
    };
};

exports.getCampaignById = async (campaignId) => {
    const campaign = await AdCampaign.findOne({ _id: campaignId }).lean();
    if (!campaign) {
        return null;
    }

    const creatives = await AdCreative.find({ campaignId: campaign._id })
        .populate('placementId', 'name key width height device renderType floorPriceCPM floorPriceCPC')
        .populate('posts', '_id title reference entity')
        .populate('advertiserProfileId', 'name avatarUrl')
        .lean();

    return { ...campaign, creatives };
};

exports.upsertCampaign = async (campaignData) => {
    const { creatives = [], _id, ...campaignFields } = campaignData;

    if (campaignFields.cids && Array.isArray(campaignFields.cids)) {
        campaignFields.cids = [...new Set(campaignFields.cids)];
    }

    if (campaignFields.budgetTotal !== undefined) {
        const spent = Number(campaignFields.budgetSpent || 0);
        const total = Number(campaignFields.budgetTotal);
        if (total > spent) {
            if (campaignFields.budgetStatus === 'exhausted') {
                campaignFields.budgetStatus = 'active';
            }
        } else if (total <= spent) {
            campaignFields.budgetStatus = 'exhausted';
        }
    }

    const campaignPayload = { ...campaignFields };

    let savedCampaign;
    if (_id) {
        savedCampaign = await AdCampaign.findOneAndUpdate({ _id }, campaignPayload, { new: true, runValidators: true });
        if (!savedCampaign) {
            throw new Error('Campaign not found or access denied');
        }
    } else {
        savedCampaign = await AdCampaign.create(campaignPayload);
    }

    const campaignId = savedCampaign._id;
    const savedCreatives = await Promise.all(creatives.map(creative => upsertCreative(creative, campaignId)));

    const savedCreativeIds = savedCreatives.map(c => c._id);
    await AdCreative.deleteMany({ campaignId, _id: { $nin: savedCreativeIds } });

    return exports.getCampaignById(campaignId);
};

exports.deleteCampaign = async (campaignId) => {
    const campaign = await AdCampaign.findOneAndDelete({ _id: campaignId });
    if (!campaign) {
        throw new Error('Campaign not found or access denied');
    }

    await AdCreative.deleteMany({ campaignId: campaign._id });

    return { success: true, message: 'Campaign deleted successfully' };
};