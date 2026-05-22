/*
 * Quelora — quelora-enterprise
 * Copyright (C) 2026 Germán Zelaya — https://quelora.org
 * SPDX-License-Identifier: AGPL-3.0-only
 *
 * This file is part of Quelora. See the LICENSE file for terms.
 */

const { mongoose } = require('@quelora/common/db');

const GamificationProfileSchema = new mongoose.Schema({
    profile_id: { type: mongoose.Schema.Types.ObjectId, ref: 'Profile', required: true, unique: true },
    cid: { type: String, required: true, index: true },
    walletBalance: { type: Number, default: 0 },
    lifetimePoints: { type: Number, default: 0 },
    monthlyPoints: { type: Number, default: 0 },
    currentLevel: { type: mongoose.Schema.Types.ObjectId, ref: 'GamificationLevel' },
    equippedFrame: {
        assetUrl: { type: String, default: null },
        shape: { type: String, default: 'CIRCULAR' }
    },
    streaks: {
        current: { type: Number, default: 0 },
        longest: { type: Number, default: 0 },
        lastActionDate: { type: String },
        lastClaimDate: { type: String, default: null },
        freezeInventory: { type: Number, default: 0 }
    },
    milestones: { type: Map, of: Boolean, default: {} },
    dailyStats: {
        date: { type: String },
        actions: { type: Map, of: Number, default: {} }
    },
    updated_at: { type: Date, default: Date.now }
});

GamificationProfileSchema.index({ cid: 1, monthlyPoints: -1 });
GamificationProfileSchema.index({ cid: 1, lifetimePoints: -1 });

module.exports = mongoose.model('GamificationProfile', GamificationProfileSchema);