/*
 * Quelora — quelora-enterprise
 * Copyright (C) 2026 Germán Zelaya — https://quelora.org
 * SPDX-License-Identifier: AGPL-3.0-only
 *
 * This file is part of Quelora. See the LICENSE file for terms.
 */

// filepath: quelora-dashboard-api/models/GamificationLevel.js
const { mongoose } = require('@quelora/common/db');

const GamificationLevelSchema = new mongoose.Schema({
    cid: { type: String, required: true, index: true },
    name: { type: String, required: true },
    description: { type: String },
    minPoints: { type: Number, required: true },
    avatarFrameUrl: { type: String }, 
    order: { type: Number, required: true },
    perks: { type: mongoose.Schema.Types.Mixed, default: {} },
    created_at: { type: Date, default: Date.now }
});

GamificationLevelSchema.index({ cid: 1, minPoints: 1 });

module.exports = mongoose.model('GamificationLevel', GamificationLevelSchema);