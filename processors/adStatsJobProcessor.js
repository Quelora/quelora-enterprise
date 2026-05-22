/*
 * Quelora — quelora-enterprise
 * Copyright (C) 2026 Germán Zelaya — https://quelora.org
 * SPDX-License-Identifier: AGPL-3.0-only
 *
 * This file is part of Quelora. See the LICENSE file for terms.
 */

/* filepath: packages/quelora-enterprise/processors/adStatsJobProcessor.js */
const adStatsService = require('../services/adStatsService');

module.exports = async (job) => {
    const { cid } = job.data;
    console.log(`📢 [Enterprise]  Ads Stats tick for ${cid}`);
    if (adStatsService.saveAdStats) {
        await adStatsService.saveAdStats(cid);
    } else {
        throw new Error('AdStats service saveAdStats not found');
    }
};