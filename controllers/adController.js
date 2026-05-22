/*
 * Quelora — quelora-enterprise
 * Copyright (C) 2026 Germán Zelaya — https://quelora.org
 * SPDX-License-Identifier: AGPL-3.0-only
 *
 * This file is part of Quelora. See the LICENSE file for terms.
 */

/* filepath: quelora-public-api/controllers/adController.js */
const adsService = require('../services/adsService');

exports.requestAds = async (req, res, next) => {
    try {
        const { entityId, placementKeys, isMobile, lastCommentId } = req.body;
        const { cid, ip } = req;
        const author = req.user?.author || null;

        if (!placementKeys || !Array.isArray(placementKeys) || placementKeys.length === 0) {
            return res.status(400).json({ success: false, error: 'PlacementKeys array is required' });
        }

        const ads = await adsService.getAdsForRequest({
            cid,
            placementKeys,
            entityId,
            lastCommentId,
            geoData: { ...req.geoData, isMobile: req.isMobile || isMobile },
            author,
            ip
        });

        res.status(200).json(ads);
    } catch (error) {
        next(error);
    }
};

exports.registerImpression = async (req, res, next) => {
    try {
        const { creativeId, campaignId } = req.body;
        const author = req.user?.author || null;
        const ip = req.ip;
        const cid = req.cid;

        if (!creativeId || !campaignId) {
            return res.status(400).json({ success: false, error: 'Creative ID and Campaign ID are required' });
        }

        await adsService.registerImpression({
            cid,
            creativeId,
            campaignId,
            author,
            ip,
            geoData: req.geoData
        });
        res.status(204).send();
    } catch (error) {
        next(error);
    }
};

exports.registerClick = async (req, res, next) => {
    try {
        const { creativeId } = req.body;
        const ip = req.ip;
        const userAgent = req.get('User-Agent');
        const isMember = !!req.user?.author;
        const cid = req.cid;

        if (!creativeId) {
            return res.status(400).json({ success: false, error: 'Creative ID is required' });
        }

        await adsService.registerClick({ cid, creativeId, ip, userAgent, isMember, geoData: req.geoData });
        
        res.status(204).send();
    } catch (error) {
        next(error);
    }
};