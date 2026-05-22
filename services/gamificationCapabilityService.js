/*
 * Quelora — quelora-enterprise
 * Copyright (C) 2026 Germán Zelaya — https://quelora.org
 * SPDX-License-Identifier: AGPL-3.0-only
 *
 * This file is part of Quelora. See the LICENSE file for terms.
 */

const { redisClient } = require('./cacheService');

const getUserCapabilities = async (cid, profileId) => {
    try {
        const cacheKey = `user:capabilities:${cid}:${profileId}`;
        const cached = await redisClient.get(cacheKey);
        
        if (cached) {
            return JSON.parse(cached);
        }
        
        return {};
    } catch (error) {
        console.error('Error fetching user capabilities from cache:', error);
        return {};
    }
};

const hasCapability = async (cid, profileId, capabilityKey) => {
    const capabilities = await getUserCapabilities(cid, profileId);
    return !!capabilities[capabilityKey];
};

module.exports = {
    getUserCapabilities,
    hasCapability
};