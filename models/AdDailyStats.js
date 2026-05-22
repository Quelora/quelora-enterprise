/*
 * Quelora — quelora-enterprise
 * Copyright (C) 2026 Germán Zelaya — https://quelora.org
 * SPDX-License-Identifier: AGPL-3.0-only
 *
 * This file is part of Quelora. See the LICENSE file for terms.
 */

const { mongoose } = require('@quelora/common/db');

const hourlyStatSchema = new mongoose.Schema({
    impressions: { type: Number, default: 0 },
    clicks: { type: Number, default: 0 },
    spend: { type: Number, default: 0 }
}, { _id: false });

const adDailyStatsSchema = new mongoose.Schema({
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
    date: {
        type: String,
        required: true,
        index: true
    },
    impressions: {
        type: Number,
        default: 0,
        min: 0
    },
    clicks: {
        type: Number,
        default: 0,
        min: 0
    },
    spend: {
        type: Number,
        default: 0.0,
        min: 0
    },
    geoImpressions: { 
        type: Map,
        of: Number, 
        default: {}
    },
    hourly: {
        type: Map,
        of: hourlyStatSchema,
        default: {}
    }
}, { timestamps: true });

// Índice compuesto para búsquedas rápidas y upserts eficientes
adDailyStatsSchema.index({ creativeId: 1, date: 1 }, { unique: true });
adDailyStatsSchema.index({ campaignId: 1, date: 1 });

module.exports = mongoose.model('AdDailyStats', adDailyStatsSchema);