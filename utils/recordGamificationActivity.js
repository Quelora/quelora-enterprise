/*
 * Quelora — quelora-enterprise
 * Copyright (C) 2026 Germán Zelaya — https://quelora.org
 * SPDX-License-Identifier: AGPL-3.0-only
 *
 * This file is part of Quelora. See the LICENSE file for terms.
 */

/* filepath: packages/quelora-enterprise/utils/recordGamificationActivity.js */
const { cacheClient } = require('@quelora/common/services/cacheService');

/**
 * Pushes a raw user action into the Gamification Queue.
 * This is the entry point for the entire Gamification Engine.
 * * @param {string} cid - Client ID (Tenant)
 * @param {string|ObjectId} profileId - User Profile ID
 * @param {string} actionType - The rule action key (e.g., 'COMMENT_CREATED')
 * @param {object} metadata - Extra context (postId, commentId, etc.)
 */
const recordGamificationActivity = async (cid, profileId, actionType, metadata = {}) => {
    try {
        // Fast validation to avoid cluttering Redis with bad data
        if (!cid || !profileId || !actionType) return;

        // Matches the queue key expected by gamificationProcessorService.js (Step 8)
        const queueKey = `queue:gamification:events:${cid}`;

        const event = {
            cid,
            profileId: profileId.toString(),
            actionType,
            metadata,
            timestamp: Date.now()
        };

        // Push to Redis List (Right Push)
        // Fire-and-forget: We don't await strictly if performance is critical, 
        // but awaiting ensures data safety.
        await cacheClient.rPush(queueKey, JSON.stringify(event));

    } catch (error) {
        // Fail silently so we never block the main User Experience (posting/commenting)
        // just because the gamification engine hiccuped.
        console.error('⚠️ [Gamification] Failed to record activity:', error.message);
    }
};

module.exports = { recordGamificationActivity }; // Exporting as object property to match usage