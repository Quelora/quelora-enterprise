/*
 * Quelora — quelora-enterprise
 * Copyright (C) 2026 Germán Zelaya — https://quelora.org
 * SPDX-License-Identifier: AGPL-3.0-only
 *
 * This file is part of Quelora. See the LICENSE file for terms.
 */

// filepath: quelora-enterprise/models/GamificationRule.js
const { mongoose } = require('@quelora/common/db');

const GamificationRuleSchema = new mongoose.Schema({
    cid: { type: String, required: true, index: true },
    actionType: { 
        type: String, 
        required: true,
        enum: [
            // --- Content Creation (Core) ---
            'COMMENT_CREATED',   // Comment on a post
            'POST_CREATED',      // Create a new post
            'REPLY_CREATED',     // Reply to another user
            'MEDIA_UPLOADED',    // Upload an image/video

            // --- Social Interaction (Engagement) ---
            'LIKE_RECEIVED',     // Receive a like
            'LIKE_GIVEN',        // Give a like
            'POST_SHARED',       // Share on social networks
            'USER_MENTIONED',    // Tag another user

            // --- Retention and Loyalty (Sticky) ---
            'DAILY_LOGIN',       // Log into the platform
            'PROFILE_COMPLETED', // Complete avatar, bio, etc.
            'ACCOUNT_VERIFIED',  // Verify email/phone
            'STREAK_BONUS',      // Consecutive days streak

            // --- Quality and Moderation ---
            'POST_FEATURED',     // Post featured by admin/algorithm
            'REPORT_APPROVED',   // User reported spam and was validated
            
            // --- Quelora-Specific Modules ---
            'QUEST_COMPLETED',   // Gamification/missions module
            'SURVEY_VOTED',      // Vote in surveys
            'VIDEO_WATCHED'      // Watch an advertisement
        ] 
    },
    
    // Visible Rewards
    xpReward: { type: Number, default: 0 },   
    coinReward: { type: Number, default: 0 }, 
    
    // --- NEW: Hidden Reputation Configuration ---
    // Allows standard actions to grant reputation silently
    reputation: { type: Number, default: 0 }, 

    // --- NEW: Content Quality Gate ---
    // If enabled, standard actions (like creating a comment) will also be audited
    // before granting the hidden reputation.
    qualityCheck: {
        enabled: { type: Boolean, default: false },
        contentType: { type: String, enum: ['COMMENT', 'POST', 'NONE'], default: 'NONE' },
        minScore: { type: Number, default: 0.1 }
    },

    dailyLimit: { type: Number, default: 0 }, // Daily cap to prevent spam
    active: { type: Boolean, default: true }
});

// A client can have only one active rule per action type
GamificationRuleSchema.index({ cid: 1, actionType: 1 }, { unique: true });

module.exports = mongoose.model('GamificationRule', GamificationRuleSchema);