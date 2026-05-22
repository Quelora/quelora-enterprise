/*
 * Quelora — quelora-enterprise
 * Copyright (C) 2026 Germán Zelaya — https://quelora.org
 * SPDX-License-Identifier: AGPL-3.0-only
 *
 * This file is part of Quelora. See the LICENSE file for terms.
 */

const { hasCapability } = require('../services/gamificationCapabilityService');

/**
 * Middleware para requerir una capacidad específica (ítem activo)
 * @param {string} capabilityKey - El 'effectType' del ítem (ej: 'GHOST_MODE', 'UNLOCK_MEDIA_GIF')
 */
const requireCapability = (capabilityKey) => {
    return async (req, res, next) => {
        try {
            const cid = req.cid;
            const user = req.user;

            if (!user || !user.author) {
                return res.status(401).json({ message: 'Unauthorized' });
            }

            const hasPermission = await hasCapability(cid, user.author, capabilityKey);

            if (!hasPermission) {
                return res.status(403).json({ 
                    message: `Feature locked. You need to equip an item with effect: ${capabilityKey}`,
                    requiredCapability: capabilityKey
                });
            }

            next();
        } catch (error) {
            console.error('❌ Gamification Capability Check Error:', error);
            res.status(500).json({ message: 'Internal Server Error verifying capabilities' });
        }
    };
};

module.exports = { requireCapability };