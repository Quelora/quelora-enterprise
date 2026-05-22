/*
 * Quelora — quelora-enterprise
 * Copyright (C) 2026 Germán Zelaya — https://quelora.org
 * SPDX-License-Identifier: AGPL-3.0-only
 *
 * This file is part of Quelora. See the LICENSE file for terms.
 */

// filepath: quelora-enterprise/models/GamificationQuest.js
const { mongoose } = require('@quelora/common/db');

const GamificationQuestSchema = new mongoose.Schema({
    cid: { type: String, required: true, index: true },

    title: { type: String, required: true },
    description: { type: String },
    icon: { type: String, default: 'star' },

    frequency: { 
        type: String, 
        enum: ['DAILY', 'WEEKLY', 'ONETIME', 'INFINITE'], 
        default: 'DAILY',
        index: true
    },
    active: { type: Boolean, default: true, index: true },
    startDate: { type: Date },
    endDate: { type: Date },
    criteria: {
        actionType: { type: String, required: true },
        targetCount: { type: Number, required: true, default: 1 },
        metadataFilter: { type: mongoose.Schema.Types.Mixed }
    },

    // Rewards Structure
    rewards: {
        // Visible Rewards (Feedback to user)
        xp: { type: Number, default: 0 },
        coins: { type: Number, default: 0 },
        badgeId: { type: mongoose.Schema.Types.ObjectId, ref: 'GamificationBadge' },

        // This value is never shown to the frontend user.
        // It accepts decimals (e.g., 0.5, 1.25).
        reputation: { type: Number, default: 0 }, 
        
        // Defines behavior for recurring quests (e.g., DAILY)
        reputationStrategy: {
            type: String,
            enum: [
                'ALWAYS',           // Grant reputation every time the quest is completed
                'DIMINISHING',      // Reduce reputation on subsequent completions (Not yet implemented logic, placeholder)
                'ONCE_PER_PERIOD',  // Grant only once per period (Week/Month) even if quest is daily
                'ONE_TIME_ONLY'     // Grant only the very first time, never again
            ],
            default: 'ALWAYS'
        },

        // If enabled, the system will audit the user's recent content.
        // The 'reputation' reward will be multiplied by the quality factor (0.1 - 1.0).
        qualityCheck: {
            enabled: { type: Boolean, default: false },
            contentType: { type: String, enum: ['COMMENT', 'POST', 'NONE'], default: 'NONE' },
            minScore: { type: Number, default: 0.1 } // Minimum quality factor required to get ANY reputation
        }
    },

    order: { type: Number, default: 0 }, 
    created_at: { type: Date, default: Date.now }
});

GamificationQuestSchema.index({ cid: 1, active: 1, frequency: 1 });

module.exports = mongoose.model('GamificationQuest', GamificationQuestSchema);