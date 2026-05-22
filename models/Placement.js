/*
 * Quelora — quelora-enterprise
 * Copyright (C) 2026 Germán Zelaya — https://quelora.org
 * SPDX-License-Identifier: AGPL-3.0-only
 *
 * This file is part of Quelora. See the LICENSE file for terms.
 */

    // ./models/Placement.js

    const { mongoose } = require('@quelora/common/db');

    const geoPriceSchema = new mongoose.Schema({
        country: {
            type: String,
            required: true,
            uppercase: true,
            trim: true,
            minlength: 2,
            maxlength: 2
        },
        floorPriceCPM: {
            type: Number,
            required: true,
            min: 0
        },
        floorPriceCPC: {
            type: Number,
            required: true,
            min: 0
        }
    }, { _id: false });

    const placementSchema = new mongoose.Schema({
        name: {
            type: String,
            required: [true, 'Placement name is required'],
            trim: true,
            maxlength: 100
        },
        key: {
            type: String,
            required: [true, 'Placement key is required'],
            trim: true,
            lowercase: true,
            maxlength: 50,
            match: [/^[a-z0-9-]+$/, 'Key must only contain lowercase letters, numbers, and hyphens'],
            unique: true
        },
        width: {
            type: Number,
            required: true
        },
        height: {
            type: Number,
            required: true
        },
        device: {
            type: String,
            enum: ['all', 'desktop', 'mobile'],
            default: 'all'
        },
        renderType: {
            type: String,
            enum: ['display', 'native', 'text'],
            default: 'display',
            required: true
        },
        pricingModel: {
            type: String,
            enum: ['hybrid'],
            default: 'hybrid',
            required: true
        },
        floorPriceCPM: {
            type: Number,
            required: true,
            default: 0.50,
            min: 0
        },
        floorPriceCPC: {
            type: Number,
            required: true,
            default: 0.10,
            min: 0
        },
        geoPricing: [geoPriceSchema],
        floorPrice: {
            type: Number,
            required: true,
            default: 0.01
        }
    }, { timestamps: true });

    placementSchema.index({ key: 1 }, { unique: true });

    module.exports = mongoose.model('Placement', placementSchema);