/*
 * Quelora — quelora-enterprise
 * Copyright (C) 2026 Germán Zelaya — https://quelora.org
 * SPDX-License-Identifier: AGPL-3.0-only
 *
 * This file is part of Quelora. See the LICENSE file for terms.
 */

const { mongoose } = require('@quelora/common/db');
const PlacementPricing = require('../models/PlacementPricing');
const Placement = require('../models/Placement');
const { getFilterCids, validateCidAccess } = require('../utils/accessControl');

exports.getPlacementPricing = async (req, res, next) => {
    try {
        const { page = 1, limit = 100, sort = 'cid', order = 'asc', search, cid } = req.query;
        const userId = req.user._id;
        const userRole = req.user.role;

        let cidsToUse;
        try {
            cidsToUse = await getFilterCids(userId, userRole, cid);
        } catch (e) {
            return res.status(403).json({ success: false, error: e.message });
        }

        const query = {
            cid: { $in: cidsToUse }
        };
        
        if (search) {
            query.$or = [
                { cid: { $regex: search, $options: 'i' } }
            ];
        }

        const pageNumber = +page;
        const limitNumber = +limit;
        const skip = (pageNumber - 1) * limitNumber;
        const sortOrder = order === 'asc' ? 1 : -1;
        const sortOptions = { [sort]: sortOrder, _id: 1 };

        const [pricingRules, totalItems] = await Promise.all([
            PlacementPricing.find(query)
                .sort(sortOptions)
                .skip(skip)
                .limit(limitNumber)
                .lean(),
            PlacementPricing.countDocuments(query)
        ]);

        const totalPages = Math.ceil(totalItems / limitNumber);

        res.status(200).json({
            success: true,
            data: pricingRules,
            pagination: {
                totalItems,
                totalPages,
                currentPage: pageNumber,
                itemsPerPage: limitNumber
            },
            cids: cidsToUse
        });
    } catch (error) {
        next(error);
    }
};

exports.upsertPlacementPricing = async (req, res, next) => {
    try {
        const {
            _id,
            placementId,
            cid,
            floorPriceCPM,
            floorPriceCPC,
            geoPricing
        } = req.body;
        
        const userId = req.user._id;
        const userRole = req.user.role;

        if (!cid) {
             return res.status(400).json({ success: false, error: 'CID is required' });
        }

        try {
            await validateCidAccess(userId, userRole, cid);
        } catch (e) {
            return res.status(403).json({ success: false, error: e.message });
        }

        if (!mongoose.Types.ObjectId.isValid(placementId)) {
            return res.status(400).json({ success: false, error: 'Invalid Placement ID' });
        }
        
        const placement = await Placement.findById(placementId);
        if (!placement) {
            return res.status(404).json({ success: false, error: 'Placement not found' });
        }
        
        if (_id && !mongoose.Types.ObjectId.isValid(_id)) {
             return res.status(400).json({ success: false, error: 'Invalid Placement Pricing ID' });
        }

        const payload = {
            placementId,
            cid,
            floorPriceCPM,
            floorPriceCPC,
            geoPricing: geoPricing || []
        };

        let pricingRule;

        if (_id) {
            const existingRule = await PlacementPricing.findById(_id);
            if (!existingRule) {
                return res.status(404).json({ success: false, error: 'Pricing rule not found for update' });
            }
            
            if (existingRule.cid !== cid) {
                 return res.status(400).json({ success: false, error: 'Cannot change CID on an existing pricing rule' });
            }
            
            pricingRule = await PlacementPricing.findByIdAndUpdate(_id, payload, { new: true, runValidators: true });
        } else {
            const existingPricing = await PlacementPricing.findOne({ placementId, cid });
            if (existingPricing) {
                return res.status(409).json({ 
                    success: false, 
                    error: 'Pricing rule already exists for this placement and client.' 
                });
            }
            pricingRule = await PlacementPricing.create(payload);
        }

        res.status(201).json({ success: true, data: pricingRule });
    } catch (error) {
        if (error.code === 11000) {
            return res.status(409).json({ 
                success: false, 
                error: 'Pricing rule already exists for this placement and client.' 
            });
        }
        next(error);
    }
};

exports.deletePlacementPricing = async (req, res, next) => {
    try {
        const { id } = req.params;
        const userId = req.user._id;
        const userRole = req.user.role;

        if (!mongoose.Types.ObjectId.isValid(id)) {
            return res.status(400).json({ success: false, error: 'Invalid Pricing rule ID' });
        }

        const pricingRule = await PlacementPricing.findById(id);
        
        if (!pricingRule) {
            return res.status(404).json({ success: false, error: 'Pricing rule not found' });
        }

        try {
            await validateCidAccess(userId, userRole, pricingRule.cid);
        } catch (e) {
            return res.status(403).json({ success: false, error: 'Access denied: You do not have permission to delete rules for this Client' });
        }

        await PlacementPricing.deleteOne({ _id: id });
        res.status(200).json({ success: true, message: 'Pricing rule deleted' });
    } catch (error) {
        next(error);
    }
};