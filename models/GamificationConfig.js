/*
 * Quelora — quelora-enterprise
 * Copyright (C) 2026 Germán Zelaya — https://quelora.org
 * SPDX-License-Identifier: AGPL-3.0-only
 *
 * This file is part of Quelora. See the LICENSE file for terms.
 */

const { mongoose } = require('@quelora/common/db');

const GamificationConfigSchema = new mongoose.Schema({
    cid: { type: String, required: true, unique: true, index: true },
    enabled: { type: Boolean, default: false },
    currency: {
        name: { type: String, default: 'queloros' },
        singularName: { type: String, default: 'queloro' },
        symbol: { type: String, default: '🪙' },
    },
    resetStrategy: {
        type: String,
        enum: ['NEVER', 'MONTHLY', 'YEARLY'],
        default: 'NEVER'
    },
    updated_at: { type: Date, default: Date.now }
});

module.exports = mongoose.model('GamificationConfig', GamificationConfigSchema);