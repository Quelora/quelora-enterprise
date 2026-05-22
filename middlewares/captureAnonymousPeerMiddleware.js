/*
 * Quelora — quelora-enterprise
 * Copyright (C) 2026 Germán Zelaya — https://quelora.org
 * SPDX-License-Identifier: AGPL-3.0-only
 *
 * This file is part of Quelora. See the LICENSE file for terms.
 */

/* filepath: quelora-enterprise/middlewares/captureAnonymousPeerMiddleware.js */

const { cacheClient } = require('@quelora/common/services/cacheService');

/**
 * Middleware to capture 'X-Peer-ID' from anonymous requests
 * and register them transiently in Redis for P2P routing visibility.
 */
const captureAnonymousPeerMiddleware = async (req, res, next) => {
    try {
        const cid = req.cid; // Must run AFTER validateClientHeader
        const peerId = req.headers['x-peer-id'];

        // Solo procesamos si hay CID, hay PeerID y NO hay usuario logueado (req.user)
        // (Aunque si quisieras permitir pares efímeros para logueados, podrías quitar el !req.user)
        if (cid && peerId && !req.user) {
            
            // Validación básica de formato para evitar inyección de basura en Redis
            if (typeof peerId === 'string' && peerId.length < 128) {
                
                const mapKey = `cid:${cid}:peer:map:${peerId}`;
                
                // Estrategia "Fire & Forget": No esperamos el await para no latencia a la API.
                // Registramos como 'anonymous' con 5 minutos de vida (300s).
                // Cada petición renueva el TTL.
                cacheClient.set(mapKey, 'anonymous', 'EX', 300)
                    .catch(err => console.warn('[P2P Middleware] Redis write failed', err));
            }
        }
        
        next();
    } catch (error) {
        console.error('[P2P Middleware] Error:', error);
        next(); // No bloqueamos el request si falla esto
    }
};

module.exports = captureAnonymousPeerMiddleware;