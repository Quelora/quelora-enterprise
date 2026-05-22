/*
 * Quelora — quelora-enterprise
 * Copyright (C) 2026 Germán Zelaya — https://quelora.org
 * SPDX-License-Identifier: AGPL-3.0-only
 *
 * This file is part of Quelora. See the LICENSE file for terms.
 */

/* filepath: packages/quelora-enterprise/processors/gamificationJobProcessor.js */
const gamificationProcessorService = require('../services/gamificationProcessorService');

module.exports = async (job) => {
    const { cid } = job.data;
    console.log(`🎮 [Enterprise] Gamification tick for ${cid}`);

    if (gamificationProcessorService.processGamification) {
        await gamificationProcessorService.processGamification(cid);
    } else {
        throw new Error('Gamification service processGamification not found');
    }
};