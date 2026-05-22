/*
 * Quelora — quelora-enterprise
 * Copyright (C) 2026 Germán Zelaya — https://quelora.org
 * SPDX-License-Identifier: AGPL-3.0-only
 *
 * This file is part of Quelora. See the LICENSE file for terms.
 */

// filepath: quelora-dashboard-api/controllers/placementController.js
const Placement = require('../models/Placement');
const AdCreative = require('../models/AdCreative');

exports.getPlacements = async (req, res, next) => {
    try {
        const { page = 1, limit = 100, sort = 'name', order = 'asc' } = req.query;

        const query = {};
        const pageNumber = +page;
        const limitNumber = +limit;
        const skip = (pageNumber - 1) * limitNumber;
        const sortOrder = order === 'asc' ? 1 : -1;
        const sortOptions = { [sort]: sortOrder, _id: 1 };

        const [placements, totalItems] = await Promise.all([
            Placement.find(query)
                .sort(sortOptions)
                .skip(skip)
                .limit(limitNumber)
                .lean(),
            Placement.countDocuments(query)
        ]);

        const totalPages = Math.ceil(totalItems / limitNumber);

        res.status(200).json({
            success: true,
            data: {
                placements,
                pagination: {
                    totalItems,
                    totalPages,
                    currentPage: pageNumber,
                    itemsPerPage: limitNumber
                }
            }
        });
    } catch (error) {
        next(error);
    }
};

exports.upsertPlacement = async (req, res, next) => {
    try {
        if (req.user.role !== 'god') {
            return res.status(403).json({ success: false, error: 'Access denied' });
        }

        const {
            _id,
            name,
            key,
            width,
            height,
            device,
            pricingModel,
            floorPrice,
            renderType,
            floorPriceCPM,
            floorPriceCPC,
            geoPricing
        } = req.body;

        const payload = {
            name,
            key,
            width,
            height,
            device,
            pricingModel,
            floorPrice,
            renderType,
            floorPriceCPM,
            floorPriceCPC,
            geoPricing
        };

        let placement;

        if (_id) {
            placement = await Placement.findByIdAndUpdate(_id, payload, { new: true, runValidators: true });
        } else {
            placement = await Placement.create(payload);
        }

        res.status(201).json({ success: true, data: placement });
    } catch (error) {
        if (error.code === 11000) {
            return res.status(409).json({ success: false, error: 'Placement key already exists.' });
        }
        next(error);
    }
};

exports.deletePlacement = async (req, res, next) => {
    try {
        if (req.user.role !== 'admin') {
            return res.status(403).json({ success: false, error: 'Access denied' });
        }

        const { id } = req.params;

        const placement = await Placement.findById(id);
        if (!placement) {
            return res.status(404).json({ success: false, error: 'Placement not found' });
        }

        const inUse = await AdCreative.findOne({ placementId: id }).limit(1);
        if (inUse) {
            return res.status(400).json({ success: false, error: 'Cannot delete: Placement is in use by one or more creatives.' });
        }

        await Placement.deleteOne({ _id: id });
        res.status(200).json({ success: true, message: 'Placement deleted' });
    } catch (error) {
        next(error);
    }
};