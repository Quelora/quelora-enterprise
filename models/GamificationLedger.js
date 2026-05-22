/*
 * Quelora — quelora-enterprise
 * Copyright (C) 2026 Germán Zelaya — https://quelora.org
 * SPDX-License-Identifier: AGPL-3.0-only
 *
 * This file is part of Quelora. See the LICENSE file for terms.
 */

const { mongoose } = require('@quelora/common/db');

const GamificationLedgerSchema = new mongoose.Schema({
    cid: { type: String, required: true },
    profile_id: { type: mongoose.Schema.Types.ObjectId, ref: 'Profile', required: true, index: true },
    
    // --- Accumulators (Lane Separation) ---
    amount: { type: Number, required: true }, // COINS: Spendable balance (Wallet Balance)
    xpAmount: { type: Number, default: 0 },   // EXPERIENCE: Level progression (Lifetime Points)
    
    // --- Event Classification ---
    type: { 
        type: String, 
        required: true,
        enum: [
            // --- 1. Core Earnings ---
            'EARN',                // Standard gain for activity (post, like, etc.)
            'STREAK_BONUS',        // Bonus for consecutive-day streak
            'LEVEL_UP_REWARD',     // Monetary reward for leveling up
            
            // --- 2. Missions & Achievements ---
            'QUEST_REWARD',        // Completing a mission or specific task
            'ACHIEVEMENT_UNLOCK',  // Unlocking a unique badge/milestone
            'CAMPAIGN_BONUS',      // Temporary events (e.g., “Double XP on Christmas”)
            
            // --- 3. Growth & Social ---
            'REFERRAL_REWARD',     // Reward for inviting a new user
            'SOCIAL_SHARE',        // Specific reward for sharing on social media
            'GIFT_RECEIVED',       // Receiving coins from another user (P2P In)
            
            // --- 4. Economy Outflows ---
            'SPEND',               // Generic purchase in the shop
            'UNLOCK_CONTENT',      // Paying to access premium content
            'GIFT_SENT',           // Sending coins to another user (P2P Out)
            'FEE',                 // Transaction fees or system taxes
            
            // --- 5. Corrections & System ---
            'ADJUSTMENT',          // Manual positive/negative adjustment (Admin)
            'REFUND',              // Purchase refund (Reversal)
            'PENALTY',             // Penalty for bad behavior (Moderation)
            'EXPIRATION',          // Expiration of points/coins due to inactivity
            'MIGRATION',           // Balance import from legacy systems
            'SYSTEM_ERROR_FIX'     // Automatic error correction
        ] 
    },
    
    source: { type: String, required: true }, // 'SYSTEM', 'ADMIN', 'SHOP', 'USER_ACTION', 'P2P'
    
    // Reference to the entity that generated this (comment ID, post ID, product purchased, etc.)
    reference_id: { type: mongoose.Schema.Types.ObjectId },
    
    description: { type: String }, // Human-readable text for the user's history
    created_at: { type: Date, default: Date.now }
});

// Indexes to optimize history and statistics queries
GamificationLedgerSchema.index({ cid: 1, profile_id: 1, created_at: -1 });
GamificationLedgerSchema.index({ cid: 1, type: 1, created_at: -1 });

module.exports = mongoose.model('GamificationLedger', GamificationLedgerSchema);
