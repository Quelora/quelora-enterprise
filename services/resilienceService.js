/*
 * Quelora — quelora-enterprise
 * Copyright (C) 2026 Germán Zelaya — https://quelora.org
 * SPDX-License-Identifier: AGPL-3.0-only
 *
 * This file is part of Quelora. See the LICENSE file for terms.
 */

/* filepath: packages/quelora-enterprise/services/resilienceService.js */

/**
 * @file resilienceService.js
 * @description Core service for the Ephemeral Resilience Protocol (PRE).
 * Handles Ed25519 cryptography, binary packing, and centralized transport for signed artifacts.
 * Refactored to expose invalidation logic and standardize cache clients.
 * @module @quelora/enterprise/services/resilienceService
 */

const crypto = require('crypto');
const Client = require('@quelora/common/models/Client');
const { getClientCached } = require('@quelora/common/services/clientConfigService');
const { encrypt } = require('@quelora/common/utils/cipher');
// Switched to cacheClient to ensure namespace consistency with profileService
const { cacheClient } = require('@quelora/common/services/cacheService'); 
const peerDiscoveryService = require('./peerDiscoveryService');

const ENCRYPTION_KEY = process.env.ENCRYPTION_KEY;
const RESILIENCE_TTL = 1200; 
const ALGORITHM = 'ed25519';
const PROTOCOL_VERSION = 0x01;

// Centralized Key Generator to prevent logic drift across services
const getArtifactKey = (cid, identifier, type = 'profile') => `cid:${cid}:${type}:${identifier}:binary`;

/**
 * Retrieves and decrypts the Resilience Keys for a specific Client.
 * Uses the centralized cache strategy to avoid hitting the DB on every signature.
 * @async
 * @param {string} cid - Client ID.
 * @returns {Promise<Object|null>} Keys object or null.
 */
async function getResilienceKeys(cid) {
    try {
        // Defense Line 2: Use Cached Document
        const clientData = await getClientCached(cid);
        if (!clientData) return null;

        // Hydrate lightweight model to use instance methods without DB call
        const clientDoc = new Client(clientData);
        const resilienceConfig = clientDoc.decryptResilience();

        if (!resilienceConfig || !resilienceConfig.enabled || !resilienceConfig.privateKey) {
            return null;
        }

        return {
            privateKey: resilienceConfig.privateKey,
            publicKey: resilienceConfig.publicKey,
            keyId: resilienceConfig.keyId
        };
    } catch (error) {
        console.error(`[Resilience] Error fetching keys for ${cid}:`, error);
        return null;
    }
}

/**
 * Generates and stores new Ed25519 keys for a client.
 * Writes directly to DB; Invalidation is handled by Client Model Hooks.
 * @async
 * @param {string} cid - Client ID.
 */
async function generateAndStoreKeys(cid) {
    try {
        const { privateKey, publicKey } = crypto.generateKeyPairSync(ALGORITHM, {
            publicKeyEncoding: { type: 'spki', format: 'pem' },
            privateKeyEncoding: { type: 'pkcs8', format: 'pem' }
        });

        const keyId = `kid_${crypto.randomBytes(4).toString('hex')}_${Date.now()}`;
        const privateKeyCipher = encrypt(privateKey, ENCRYPTION_KEY);

        // Atomic update. The Model's post-hook will invalidate the cache.
        await Client.findOneAndUpdate(
            { cid: cid },
            {
                $set: {
                    'resilience': {
                        enabled: true,
                        algorithm: ALGORITHM,
                        keyId: keyId,
                        publicKey: publicKey,
                        privateKeyCipher: privateKeyCipher,
                        updatedAt: new Date()
                    }
                }
            }
        );

        return { privateKey, publicKey, keyId };
    } catch (error) {
        console.error(`[Resilience] Failed to generate keys for ${cid}:`, error);
        return null;
    }
}

/**
 * Packs data into a signed binary artifact.
 * Structure: [Version (1B)] + [Signature (64B)] + [JSON Payload (NB)]
 * @async
 * @param {Object} data - Payload to sign.
 * @param {string} cid - Client ID.
 * @returns {Promise<Buffer|null>} Signed Buffer.
 */
async function packBinaryArtifact(data, cid) {
    if (!data) return null;
    try {
        const keys = await getResilienceKeys(cid);
        if (!keys) return null;

        const payloadBuffer = Buffer.from(JSON.stringify({ ...data, _gen_ts: Date.now() }), 'utf8');
        const signatureBuffer = crypto.sign(null, payloadBuffer, keys.privateKey);
        const versionBuffer = Buffer.from([PROTOCOL_VERSION]);

        return Buffer.concat([versionBuffer, signatureBuffer, payloadBuffer]);
    } catch (error) {
        console.error(`[Resilience] Packing error for ${cid}:`, error);
        return null;
    }
}

/**
 * Packs multiple items into a single binary batch.
 * @async
 * @param {Array<Object>} dataArray - Items to pack.
 * @param {string} cid - Client ID.
 * @returns {Promise<Buffer|null>} Batched Buffer.
 */
async function packBinaryBatch(dataArray, cid) {
    if (!Array.isArray(dataArray) || dataArray.length === 0) return null;
    try {
        const artifacts = [];
        for (const item of dataArray) {
            const signed = await packBinaryArtifact(item, cid);
            if (signed) {
                const len = Buffer.alloc(4);
                len.writeUInt32BE(signed.length, 0);
                artifacts.push(len, signed);
            }
        }
        if (artifacts.length === 0) return null;

        const count = Buffer.alloc(4);
        count.writeUInt32BE(artifacts.length / 2, 0);
        return Buffer.concat([count, ...artifacts]);
    } catch (error) {
        console.error(`[Resilience] Batch packing error:`, error);
        return null;
    }
}

/**
 * Attempts to serve a binary artifact from cache.
 * @async
 * @param {Object} res - Express Response.
 * @param {Object} options - { key, scope, sidecarGen }.
 * @returns {Promise<boolean>} True if served.
 */
async function tryServeBinary(res, { key, scope = 'public', sidecarGen = null }) {
    try {
        if (!cacheClient) return false;
        
        const cached = await cacheClient.get(key);
        if (!cached) return false;

        if (sidecarGen) {
            const sidecar = await sidecarGen();
            if (sidecar) res.setHeader('X-Sidecar', Buffer.from(JSON.stringify(sidecar)).toString('base64'));
        }

        res.setHeader('Content-Type', 'application/octet-stream');
        res.setHeader('X-Cache-Bin', 'HIT');
        res.setHeader('X-Resilience-Scope', scope);
        res.send(Buffer.from(cached, 'base64'));
        return true;
    } catch (err) {
        console.warn('[Resilience] Binary serve failed:', err.message);
        return false;
    }
}

/**
 * Explicitly invalidates a binary artifact.
 * Used by ProfileService and other controllers to ensure consistency.
 * @param {string} cid 
 * @param {string} identifier (e.g., author)
 * @param {string} type 
 */
async function invalidateArtifact(cid, identifier, type = 'profile') {
    try {
        const key = getArtifactKey(cid, identifier, type);
        if (cacheClient) {
            await cacheClient.del(key);
        }
    } catch (error) {
        console.error(`[Resilience] Failed to invalidate artifact ${identifier}:`, error.message);
    }
}

/**
 * Packs, signs, caches, and sends a binary response.
 * @async
 * @param {Object} res - Express Response.
 * @param {Object} params - { data, cid, key, scope, sidecarData, isBatch }.
 * @returns {Promise<Object|boolean>} Express response or false.
 */
async function sendArtifact(res, { data, cid, key, scope = 'public', sidecarData = null, isBatch = false }) {
    try {
        const artifact = isBatch ? await packBinaryBatch(data, cid) : await packBinaryArtifact(data, cid);
        if (!artifact) return false;

        // Use cacheClient directly. Key is usually passed by controller, but we validate strictly.
        if (cacheClient && key) {
            await cacheClient.set(key, artifact.toString('base64'), 'EX', isBatch ? 60 : 300);
        }

        if (sidecarData) {
            res.setHeader('X-Sidecar', Buffer.from(JSON.stringify(sidecarData)).toString('base64'));
        }

        res.setHeader('Content-Type', 'application/octet-stream');
        res.setHeader('X-Cache-Bin', 'MISS');
        res.setHeader('X-Resilience-Scope', scope);
        if (isBatch) res.setHeader('X-Resilience-Mode', 'batch-signed');
        
        return res.send(artifact);
    } catch (err) {
        console.error('[Resilience] Send artifact failed:', err);
        return false;
    }
}

/**
 * Generates the configuration for the SSE Handshake.
 * @async
 */
async function getPublicConfig(cid, context = {}) {
    const keys = await getResilienceKeys(cid);
    if (!keys) return null;

    let discoveryResult = { peers: [], self: null };
    if (context?.author) {
        discoveryResult = await peerDiscoveryService.findOptimalPeers(context.author, cid, context.geoData || {}, 5);
    }

    return {
        type: 'resilience_handshake',
        data: { /*
            publicKey: keys.publicKey,
            keyId: keys.keyId,
            ttl: RESILIENCE_TTL,
            expiresAt: Math.floor(Date.now() / 1000) + RESILIENCE_TTL,
           peers: discoveryResult.peers || [],
            self: discoveryResult.self || null*/
        }
    };
}

module.exports = {
    getArtifactKey,
    packBinaryArtifact,
    packBinaryBatch,
    getPublicConfig,
    generateAndStoreKeys,
    tryServeBinary,
    sendArtifact,
    invalidateArtifact,
    getResilienceKeys
};