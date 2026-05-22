/*
 * Quelora — quelora-enterprise
 * Copyright (C) 2026 Germán Zelaya — https://quelora.org
 * SPDX-License-Identifier: AGPL-3.0-only
 *
 * This file is part of Quelora. See the LICENSE file for terms.
 */

/* filepath: packages/quelora-enterprise/services/peerDiscoveryService.js */

/**
 * @file peerDiscoveryService.js
 * @description Service responsible for discovering and selecting optimal peers for P2P offloading.
 * CORRECTION V2.2.0: Added explicit user registration for Chat/P2P Lookup availability.
 * @module @quelora/enterprise/services/peerDiscoveryService
 */

const crypto = require('crypto');
const { cacheClient } = require('@quelora/common/services/cacheService');

class PeerDiscoveryService {

    /**
     * Generates the Tenant-Specific Key for the Online Users Set.
     * @private
     * @param {string} cid - The Client ID.
     * @returns {string} Redis Key.
     */
    _getCidOnlineKey(cid) {
        return `cid:${cid}:users:online`;
    }

    /**
     * Generates the Tenant-Specific Key for User Metadata.
     * @private
     * @param {string} cid 
     * @param {string} userId 
     * @returns {string} Redis Key.
     */
    _getMetaKey(cid, userId) {
        return `cid:${cid}:meta:user:${userId}`;
    }

    /**
     * Generates the Tenant-Specific Key for Anonymous ID mapping.
     * @private
     * @param {string} cid 
     * @param {string} anonId 
     * @returns {string} Redis Key.
     */
    _getPeerMapKey(cid, anonId) {
        return `cid:${cid}:peer:map:${anonId}`;
    }

    /**
     * Generates the Tenant-Specific Key for Reverse mapping (Real ID -> Anon ID).
     * @private
     * @param {string} cid 
     * @param {string} realId 
     * @returns {string} Redis Key.
     */
    _getReverseMapKey(cid, realId) {
        return `cid:${cid}:peer:reverse:${realId}`;
    }

    /**
     * Resolves the current ephemeral PeerID for a specific real User ID.
     * Used for Direct P2P Chat Handshakes.
     * @param {string} cid - The Client ID.
     * @param {string} targetRealId - The permanent User/Author ID.
     * @returns {Promise<string|null>} The ephemeral PeerID if online, or null.
     */
    async resolveTargetPeer(cid, targetRealId) {
        if (!cid || !targetRealId) return null;

        const reverseKey = this._getReverseMapKey(cid, targetRealId);
        const activePeerId = await cacheClient.get(reverseKey);

        // If found, it means the user has an active SSE session or recent activity
        return activePeerId || null;
    }

    /**
     * Explicitly registers a user as "Online" and accessible for P2P/Chat Lookups.
     * Called by SSE Service on connection establishment.
     * @param {string} cid - Client ID.
     * @param {string} authorId - User ID.
     * @param {Object} metadata - Optional metadata (IP, Geo).
     */
    async ensureUserRegistration(cid, authorId, metadata = {}) {
        if (!cid || !authorId) return;

        try {
            // 1. Ensure Identity Mapping (Real <-> Anon) exists
            const { peerId } = await this._hydrateSingleUser(cid, authorId);

            // 2. Add to Online Set (for random discovery)
            const onlineKey = this._getCidOnlineKey(cid);
            await cacheClient.zadd(onlineKey, Date.now(), authorId);

            // 3. Store Metadata (for scoring)
            if (metadata && Object.keys(metadata).length > 0) {
                const metaKey = this._getMetaKey(cid, authorId);
                // Flatten metadata for HSET
                const flatMeta = {};
                if (metadata.ip) flatMeta.ip = metadata.ip;
                if (metadata.country) flatMeta.country = metadata.country;
                if (metadata.city) flatMeta.city = metadata.city;
                
                if (Object.keys(flatMeta).length > 0) {
                    await cacheClient.hset(metaKey, flatMeta);
                    await cacheClient.expire(metaKey, 1200); // 20 min TTL
                }
            }

            // console.log(`[PeerDiscovery] Registered ${authorId} (Peer: ${peerId}) for CID ${cid}`);
        } catch (error) {
            console.error('[PeerDiscovery] Registration failed:', error);
        }
    }

    /**
     * Finds the optimal peers using a randomized sliding window on the TENANT specific set.
     * @param {string} currentUserAuthor - The ID of the user requesting peers.
     * @param {string} cid - The Client ID (Tenant).
     * @param {Object} geoData - Geolocation data for proximity scoring.
     * @param {number} [limit=5] - Max number of peers to return.
     * @param {Object} [weights] - Custom scoring weights.
     * @returns {Promise<Object>} Object containing the hydrated peer list and self identity.
     */
    async findOptimalPeers(currentUserAuthor, cid, geoData, limit = 5, weights = {}) {
        try {
            if (!cid) {
                console.warn('[PeerDiscovery] Missing CID, cannot find peers.');
                return { peers: [], self: null };
            }

            const now = Date.now();
            
            // 1. Hydrate Self Identity (Scoped to CID)
            const selfIdentity = await this._hydrateSingleUser(cid, currentUserAuthor);

            const w = {
                trust: weights.trust ?? 0.4,
                activity: weights.activity ?? 0.4,
                geo: weights.geo ?? 0.2
            };

            // 2. Target the specific Tenant Set
            const targetKey = this._getCidOnlineKey(cid);
            const fiveMinutesAgo = now - (300 * 1000);
            const batchSize = 50; 

            // 3. Sliding Window Logic (Tenant Scoped)
            const totalActiveEstimate = await cacheClient.zcount(targetKey, fiveMinutesAgo, '+inf');
            
            // Cap search depth to top 200 active users of this client
            const searchDepth = Math.min(totalActiveEstimate, 200); 
            let offset = 0;

            if (searchDepth > batchSize) {
                // Random start index to ensure rotation within the client's pool
                offset = Math.floor(Math.random() * (searchDepth - batchSize));
            }
            
            // Fetch candidates strictly from this CID
            const candidates = await cacheClient.zrevrangebyscore(
                targetKey, 
                '+inf', 
                fiveMinutesAgo, 
                'LIMIT', 
                offset, 
                batchSize
            );

            if (!candidates || candidates.length === 0) {
                return { peers: [], self: selfIdentity };
            }

            const candidateIds = candidates.filter(id => id !== currentUserAuthor);
            
            if (candidateIds.length === 0) {
                return { peers: [], self: selfIdentity };
            }

            // 4. Hydrate Metadata & Score
            // Using strictly CID-scoped keys to avoid cross-tenant pollution
            const scoredPeers = [];
            const pipeline = cacheClient.pipeline();
            
            candidateIds.forEach(id => pipeline.hgetall(this._getMetaKey(cid, id)));
            const results = await pipeline.exec();

            results.forEach((result, index) => {
                const [err, meta] = result;
                // Verify meta belongs to the correct context (IP check is secondary validation)
                if (!err && meta && meta.ip) {
                    const score = this._calculatePeerScore(meta, geoData, w);
                    scoredPeers.push({ id: candidateIds[index], meta, score });
                }
            });

            // 5. Select Peers (Weighted Random)
            const selectedCandidates = this._weightedRandomSelection(scoredPeers, limit);

            // 6. Anonymize (Pass CID to ensure isolation)
            const hydratedPeers = await this._hydrateAnonymousPeers(cid, selectedCandidates);

            return {
                peers: hydratedPeers,
                self: selfIdentity
            };

        } catch (error) {
            console.error('[PeerDiscovery] Error:', error);
            return { peers: [], self: null }; 
        }
    }

    /**
     * Calculates a utility score for a peer candidate.
     * @private
     */
    _calculatePeerScore(candidateMeta, requesterGeo, weights) {
        let score = 0;

        // A. Trust (0-1)
        const trustLevel = parseInt(candidateMeta.trust_level || 0, 10);
        score += (Math.min(trustLevel / 5, 1) * weights.trust);

        // B. Geo Match
        let geoScore = 0;
        if (candidateMeta.city && requesterGeo.city && 
            candidateMeta.city.toLowerCase() === requesterGeo.city.toLowerCase()) {
            geoScore = 1.0;
        } else if (candidateMeta.country && requesterGeo.countryCode && 
                   candidateMeta.country === requesterGeo.countryCode) {
            geoScore = 0.5;
        }
        score += (geoScore * weights.geo);

        // C. Activity Volume
        const activityCount = parseInt(candidateMeta.activity_score || 0, 10);
        let activityScore = 0;
        if (activityCount > 0) {
            activityScore = Math.min(Math.log10(activityCount + 1) / 2, 1); 
        }
        score += (activityScore * weights.activity);

        // D. Jitter (Random Noise +/- 10%)
        const jitter = 0.9 + (Math.random() * 0.2); 
        
        return score * jitter;
    }

    /**
     * Selects items based on their score weight.
     * @private
     */
    _weightedRandomSelection(scoredItems, limit) {
        if (scoredItems.length <= limit) return scoredItems;

        const selected = [];
        const pool = [...scoredItems]; 

        while (selected.length < limit && pool.length > 0) {
            const totalWeight = pool.reduce((sum, item) => sum + item.score, 0);
            
            if (totalWeight <= 0) {
                const remaining = limit - selected.length;
                return selected.concat(pool.slice(0, remaining));
            }

            let randomVal = Math.random() * totalWeight;
            let index = -1;

            for (let i = 0; i < pool.length; i++) {
                randomVal -= pool[i].score;
                if (randomVal <= 0) {
                    index = i;
                    break;
                }
            }
            
            if (index === -1) index = pool.length - 1;

            selected.push(pool[index]);
            pool.splice(index, 1); 
        }

        return selected;
    }

    /**
     * Converts selected candidates into anonymous peer objects.
     * @private
     */
    async _hydrateAnonymousPeers(cid, candidates) {
        const result = [];
        for (const c of candidates) {
            const trust = parseInt(c.meta.trust_level || 0, 10);
            const peerData = await this._hydrateSingleUser(cid, c.id, trust);
            if (peerData) {
                peerData.endpoint = c.meta.ip; 
                result.push(peerData);
            }
        }
        return result;
    }

    /**
     * Manages the Real ID <-> Anonymous ID mapping within a specific CID scope.
     * @private
     * @param {string} cid - Client ID.
     * @param {string} authorId - Real User ID.
     * @param {number} [trustLevel=0] 
     * @returns {Promise<Object>}
     */
    async _hydrateSingleUser(cid, authorId, trustLevel = 0) {
        if (!cid || !authorId) return null;

        const reverseKey = this._getReverseMapKey(cid, authorId);
        const existingAnonId = await cacheClient.get(reverseKey);

        if (existingAnonId) {
            const mapKey = this._getPeerMapKey(cid, existingAnonId);
            const pipeline = cacheClient.pipeline();
            pipeline.expire(reverseKey, 1200);
            pipeline.expire(mapKey, 1200);
            await pipeline.exec();

            return { peerId: existingAnonId, trustLevel };
        }

        // Generate a new Anonymous ID specific to this interaction context
        const anonymousId = crypto.createHash('sha256')
            .update(`${authorId}-${cid}-${Date.now()}-${Math.random()}`)
            .digest('hex')
            .substring(0, 16);

        const mapKey = this._getPeerMapKey(cid, anonymousId);
        
        const pipeline = cacheClient.pipeline();
        // Forward Map: Anon -> Real
        pipeline.set(mapKey, authorId, 'EX', 1200);
        // Reverse Map: Real -> Anon
        pipeline.set(reverseKey, anonymousId, 'EX', 1200);
        
        await pipeline.exec();

        return { peerId: anonymousId, trustLevel };
    }
}

module.exports = new PeerDiscoveryService();