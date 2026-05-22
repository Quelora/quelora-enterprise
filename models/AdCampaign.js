/*
 * Quelora — quelora-enterprise
 * Copyright (C) 2026 Germán Zelaya — https://quelora.org
 * SPDX-License-Identifier: AGPL-3.0-only
 *
 * This file is part of Quelora. See the LICENSE file for terms.
 */

// ./models/AdCampaign.js
const { mongoose } = require('@quelora/common/db');

const adCampaignSchema = new mongoose.Schema({
    cids: [{
        type: String,
        required: true,
        index: true,
        trim: true
    }],
    name: {
        type: String,
        required: [true, 'Campaign name is required'],
        trim: true,
        maxlength: 100
    },
    status: {
        type: String,
        enum: ['active', 'paused', 'ended', 'draft'],
        default: 'draft'
    },
    budgetStatus: {
        type: String,
        enum: ['active', 'exhausted'],
        default: 'active'
    },
    budgetTotal: {
        type: Number,
        required: [true, 'Total budget is required'],
        min: 1
    },
    budgetSpent: {
        type: Number,
        default: 0,
        min: 0
    },
    startDate: {
        type: Date,
        default: Date.now,
        required: true
    },
    endDate: {
        type: Date,
        default: null
    },
    geoTargeting: {
        countries: [{ type: String }],
        regions: [{ type: String }],
        cities: [{ type: String }]
    },
    frequencyCap: {
        impressions: { type: Number, default: 0 },
        perHours: { type: Number, default: 24 }
    },
    impressionsCount: {
        type: Number,
        default: 0
    },
    clicksCount: {
        type: Number,
        default: 0
    },
}, { timestamps: true });

adCampaignSchema.index({ cids: 1, status: 1, budgetStatus: 1 });

module.exports = mongoose.model('AdCampaign', adCampaignSchema);