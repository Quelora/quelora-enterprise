/*
 * Quelora — quelora-enterprise
 * Copyright (C) 2026 Germán Zelaya — https://quelora.org
 * SPDX-License-Identifier: AGPL-3.0-only
 *
 * This file is part of Quelora. See the LICENSE file for terms.
 */

/* filepath: packages/quelora-enterprise/services/turnService.js */
/**
 * @file turnService.js
 * @description Service for generating ephemeral TURN/STUN credentials.
 * Implements HMAC-SHA1 authentication (Standard TURN REST API).
 * @module @quelora/enterprise/services/turnService
 * @version 1.0.2
 */

const crypto = require('crypto');
const { getClientTurnConfig } = require('@quelora/common/services/clientConfigService');

const ENV_DEFAULTS = {
    SERVER: process.env.TURN_SERVER,
    PORT: process.env.TURN_PORT || 3478,
    SECRET: process.env.TURN_STATIC_AUTH_SECRET,
    TTL: parseInt(process.env.TURN_TTL || 300, 10),
    PROTOCOL: process.env.TURN_PROTOCOL || 'udp',
    TRANSPORT: process.env.TURN_TRANSPORT || 'relay',
    REALM: process.env.TURN_REALM || 'quelora.org'
};

/**
 * Resolves the effective TURN configuration for a given Client ID.
 * Merges Client DB Config on top of System Defaults.
 * @param {string} cid - The Client ID.
 * @returns {Promise<Object>} The resolved configuration object (decrypted).
 */
async function resolveTurnConfig(cid) {
    let dbConfig = {};
    
    if (cid) {
        try {
            const turnConfig = await getClientTurnConfig(cid);
            if (turnConfig) {
                dbConfig = turnConfig;
            }
        } catch (error) {
            console.warn(`[TurnService] Failed to load client TURN config for ${cid}, falling back to env defaults.`, error);
        }
    }

    return {
        server: dbConfig.server || ENV_DEFAULTS.SERVER,
        port: dbConfig.port || ENV_DEFAULTS.PORT,
        secret: dbConfig.staticAuthSecret || ENV_DEFAULTS.SECRET,
        ttl: dbConfig.ttl || ENV_DEFAULTS.TTL,
        protocol: dbConfig.protocol || ENV_DEFAULTS.PROTOCOL,
        transport: dbConfig.transport || ENV_DEFAULTS.TRANSPORT,
        realm: dbConfig.realm || ENV_DEFAULTS.REALM
    };
}

/**
 * Generates ICE Servers configuration with ephemeral credentials.
 * @param {string} cid - The Client ID (Tenant).
 * @param {string} userId - The unique User ID (or Guest ID) requesting access.
 * @returns {Promise<Array<Object>>} Array of RTCIceServer objects ready for frontend use.
 */
exports.generateIceCredentials = async (cid, userId) => {
    const config = await resolveTurnConfig(cid);

    if (!config.server || !config.secret) {
        console.error('[TurnService] TURN Server or Secret not configured globally or for client.');
        return []; 
    }

    const timestamp = Math.floor(Date.now() / 1000) + config.ttl;
    const username = `${timestamp}:${userId}`;
    const password = crypto.createHmac('sha1', config.secret).update(username).digest('base64');

    let networkProtocol = config.protocol.toLowerCase();
    if (networkProtocol === 'tls') networkProtocol = 'tcp'; 
    
    if (!['udp', 'tcp'].includes(networkProtocol)) {
        networkProtocol = 'udp';
    }

    const uriTransport = `?transport=${networkProtocol}`;
    
    const iceServers = [
        {
            urls: `stun:${config.server}:${config.port}`
        },
        {
            urls: `turn:${config.server}:${config.port}${uriTransport}`,
            username: username,
            credential: password
        }
    ];

    if (config.protocol === 'tls') {
        iceServers.push({
            urls: `turns:${config.server}:443?transport=tcp`,
            username: username,
            credential: password
        });
    }

    return iceServers;
};