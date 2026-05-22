/*
 * Quelora — quelora-enterprise
 * Copyright (C) 2026 Germán Zelaya — https://quelora.org
 * SPDX-License-Identifier: AGPL-3.0-only
 *
 * This file is part of Quelora. See the LICENSE file for terms.
 */

const { mongoose } = require('@quelora/common/db');

const GamificationShopItemSchema = new mongoose.Schema({
    cid: { type: String, required: true, index: true },
    name: { type: String, required: true },
    description: { type: String },
    icon: { type: String },
    priceCoins: { type: Number, required: true },
    type: { 
        type: String, 
        enum: ['PERMANENT', 'CONSUMABLE'], 
        required: true 
    },
    effectType: {
        type: String,
        enum: [
            'CHAR_LIMIT_INCREASE',
            'UNLOCK_MEDIA_GIF',
            'PROFILE_FRAME',
            'NICKNAME_COLOR',
            'STREAK_FREEZE',
            'POST_BOOST',
            'GHOST_MODE'
        ],
        required: true
    },
    metadata: { type: mongoose.Schema.Types.Mixed, default: {} },
    category: { type: String, enum: ['UTILITY', 'COSMETIC', 'SOCIAL'], default: 'UTILITY' },
    active: { type: Boolean, default: true },
    order: { type: Number, default: 0 },
    created_at: { type: Date, default: Date.now }
});

GamificationShopItemSchema.index({ cid: 1, active: 1, order: 1 });

module.exports = mongoose.model('GamificationShopItem', GamificationShopItemSchema);