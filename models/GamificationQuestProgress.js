/*
 * Quelora — quelora-enterprise
 * Copyright (C) 2026 Germán Zelaya — https://quelora.org
 * SPDX-License-Identifier: AGPL-3.0-only
 *
 * This file is part of Quelora. See the LICENSE file for terms.
 */

// filepath: quelora-enterprise/models/GamificationQuestProgress.js
const { mongoose } = require('@quelora/common/db');

const GamificationQuestProgressSchema = new mongoose.Schema({
    cid: { type: String, required: true },
    profile_id: { type: mongoose.Schema.Types.ObjectId, ref: 'Profile', required: true },
    quest_id: { type: mongoose.Schema.Types.ObjectId, ref: 'GamificationQuest', required: true },
    periodId: { type: String, required: true, index: true },
    
    currentCount: { type: Number, default: 0 }, 
    targetCount: { type: Number, required: true },
    
    status: {
        type: String,
        enum: ['IN_PROGRESS', 'COMPLETED'],
        default: 'IN_PROGRESS'
    },
    
    isClaimed: { type: Boolean, default: false },
    claimedAt: { type: Date },

    updated_at: { type: Date, default: Date.now }
});


GamificationQuestProgressSchema.index({ cid: 1, profile_id: 1, quest_id: 1, periodId: 1 }, { unique: true });

module.exports = mongoose.model('GamificationQuestProgress', GamificationQuestProgressSchema);