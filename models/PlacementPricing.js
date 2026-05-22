/*
 * Quelora — quelora-enterprise
 * Copyright (C) 2026 Germán Zelaya — https://quelora.org
 * SPDX-License-Identifier: AGPL-3.0-only
 *
 * This file is part of Quelora. See the LICENSE file for terms.
 */

// filepath: ./models/PlacementPricing.js
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

const placementPricingSchema = new mongoose.Schema({
    placementId: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'Placement',
        required: true,
        index: true
    },
    cid: {
        type: String,
        required: true,
        index: true,
        trim: true
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
    },
    geoPricing: [geoPriceSchema]
}, { timestamps: true });

placementPricingSchema.index({ placementId: 1, cid: 1 }, { unique: true });

module.exports = mongoose.model('PlacementPricing', placementPricingSchema);