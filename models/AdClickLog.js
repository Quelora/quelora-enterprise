/*
 * Quelora — quelora-enterprise
 * Copyright (C) 2026 Germán Zelaya — https://quelora.org
 * SPDX-License-Identifier: AGPL-3.0-only
 *
 * This file is part of Quelora. See the LICENSE file for terms.
 */

const { mongoose } = require('@quelora/common/db');

const adClickLogSchema = new mongoose.Schema({
    creativeId: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'AdCreative',
        required: true,
        index: true
    },
    campaignId: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'AdCampaign',
        required: true,
        index: true
    },
    isMember: {
        type: Boolean,
        default: false,
        index: true
    },
    ip: {
        type: String,
        required: true,
        trim: true
    },
    userAgent: {
        type: String,
        required: true,
        trim: true
    },
    timestamp: {
        type: Date,
        default: Date.now,
        required: true,
        index: true
    },
    geoData: {
        country: { type: String, trim: true },
        region: { type: String, trim: true },
        city: { type: String, trim: true }
    },
    meta: {
        type: mongoose.Schema.Types.Mixed,
        default: {}
    }
});

// 180 days (6 month)
adClickLogSchema.index({ timestamp: 1 }, { expireAfterSeconds: 15552000 });

module.exports = mongoose.model('AdClickLog', adClickLogSchema);