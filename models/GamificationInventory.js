/*
 * Quelora — quelora-enterprise
 * Copyright (C) 2026 Germán Zelaya — https://quelora.org
 * SPDX-License-Identifier: AGPL-3.0-only
 *
 * This file is part of Quelora. See the LICENSE file for terms.
 */

const { mongoose } = require('@quelora/common/db');

const GamificationInventorySchema = new mongoose.Schema({
    cid: { type: String, required: true },
    profile_id: { type: mongoose.Schema.Types.ObjectId, ref: 'Profile', required: true, index: true },
    item_id: { type: mongoose.Schema.Types.ObjectId, ref: 'GamificationShopItem', required: true },
    quantity: { type: Number, default: 1 },
    isActive: { type: Boolean, default: false },
    metadata: { type: mongoose.Schema.Types.Mixed, default: {} },
    expiresAt: { type: Date },
    created_at: { type: Date, default: Date.now }
});

GamificationInventorySchema.index({ cid: 1, profile_id: 1, isActive: 1 });

module.exports = mongoose.model('GamificationInventory', GamificationInventorySchema);