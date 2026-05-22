/*
 * Quelora — quelora-enterprise
 * Copyright (C) 2026 Germán Zelaya — https://quelora.org
 * SPDX-License-Identifier: AGPL-3.0-only
 *
 * This file is part of Quelora. See the LICENSE file for terms.
 */

/* filepath: packages/quelora-enterprise/services/adStatsService.js */
const { cacheClient } = require('@quelora/common/services/cacheService');
const { mongoose } = require('@quelora/common/db');
const AdCreative = require('../models/AdCreative');
const AdCampaign = require('../models/AdCampaign');
const AdDailyStats = require('../models/AdDailyStats');

/**
 * Rounds a monetary value to 6 decimal places to avoid floating point drift
 * when updating budgets and spend values.
 */
const roundCost = (num) => {
    return Math.round((num + Number.EPSILON) * 1_000_000) / 1_000_000;
};

/**
 * Processes and persists ad statistics stored in Redis for a specific client (CID).
 *
 * Flow:
 * 1. Atomically read and delete Redis stats for the client.
 * 2. Aggregate impressions, clicks and geo data per creative.
 * 3. Update lifetime counters on AdCreative.
 * 4. Aggregate costs and counters per campaign.
 * 5. Update daily/hourly stats using bulk writes.
 * 6. Update campaign budgets and pause exhausted campaigns.
 *
 * @param {string} cid - Client identifier
 * @returns {number} Total number of creatives processed
 */
const saveAdStats = async (cid) => {
    if (!cid) throw new Error('CID is required for ad statistics processing.');

    const statsKey = `ad_stats:${cid}`;

    // Atomic read + delete to avoid double processing
    const multi = cacheClient.multi();
    multi.hgetall(statsKey);
    multi.del(statsKey);
    const results = await multi.exec();

    const rawData = results?.[0]?.[1] || {};
    if (Object.keys(rawData).length === 0) return 0;

    const creativeUpdates = {};
    const campaignAggregates = {};
    let totalProcessed = 0;

    // Parse Redis keys and aggregate stats per creative
    for (const [key, count] of Object.entries(rawData)) {
        const parts = key.split(':');
        const creativeIdStr = parts[0];
        const countInt = parseInt(count, 10);

        if (!mongoose.Types.ObjectId.isValid(creativeIdStr) || countInt <= 0) {
            continue;
        }

        if (!creativeUpdates[creativeIdStr]) {
            creativeUpdates[creativeIdStr] = {
                impressions: 0,
                clicks: 0,
                geoImpressions: {}
            };
        }

        if (key.endsWith(':impression') && parts.length === 2) {
            creativeUpdates[creativeIdStr].impressions += countInt;
        } else if (key.includes(':impression:geo:')) {
            const geoKey = parts[3];
            creativeUpdates[creativeIdStr].impressions += countInt;
            creativeUpdates[creativeIdStr].geoImpressions[geoKey] =
                (creativeUpdates[creativeIdStr].geoImpressions[geoKey] || 0) + countInt;
        } else if (key.endsWith(':click')) {
            creativeUpdates[creativeIdStr].clicks += countInt;
        }
    }

    const creativeIdsToUpdate = Object.keys(creativeUpdates);

    // Load creatives and related placements
    const creatives = await AdCreative.find({ _id: { $in: creativeIdsToUpdate } })
        .select('_id campaignId placementId maxBidCPM maxBidCPC')
        .populate('placementId', 'floorPriceCPM floorPriceCPC')
        .lean();

    const creativeMap = new Map(creatives.map(c => [c._id.toString(), c]));
    const dailyStatsOps = [];

    const now = new Date();
    const todayStr = now.toISOString().slice(0, 10);
    const currentHour = now.getHours().toString();

    // Process each creative
    for (const creativeId of creativeIdsToUpdate) {
        const counts = creativeUpdates[creativeId];
        const creative = creativeMap.get(creativeId);

        if (!creative || !creative.campaignId) continue;

        const campaignId = creative.campaignId.toString();
        const placement = creative.placementId;

        const costCPM = creative.maxBidCPM || placement?.floorPriceCPM || 0;
        const costCPC = creative.maxBidCPC || placement?.floorPriceCPC || 0;

        let totalCostForThisBatch = 0;

        if (counts.impressions > 0) {
            totalCostForThisBatch += (counts.impressions / 1000) * costCPM;
        }
        if (counts.clicks > 0) {
            totalCostForThisBatch += counts.clicks * costCPC;
        }

        const updateCreative = {};
        if (counts.impressions > 0) {
            updateCreative.$inc = { impressionsCount: counts.impressions };
        }
        if (counts.clicks > 0) {
            updateCreative.$inc = updateCreative.$inc || {};
            updateCreative.$inc.clicksCount = counts.clicks;
        }

        if (Object.keys(updateCreative).length === 0) continue;

        await AdCreative.findByIdAndUpdate(creativeId, updateCreative);
        totalProcessed++;

        if (!campaignAggregates[campaignId]) {
            campaignAggregates[campaignId] = { impressions: 0, clicks: 0, cost: 0 };
        }

        campaignAggregates[campaignId].impressions += counts.impressions;
        campaignAggregates[campaignId].clicks += counts.clicks;
        campaignAggregates[campaignId].cost += totalCostForThisBatch;

        const hourlyInc = {};
        if (counts.impressions > 0) hourlyInc[`hourly.${currentHour}.impressions`] = counts.impressions;
        if (counts.clicks > 0) hourlyInc[`hourly.${currentHour}.clicks`] = counts.clicks;
        if (totalCostForThisBatch > 0) hourlyInc[`hourly.${currentHour}.spend`] = totalCostForThisBatch;

        const geoIncrements = Object.fromEntries(
            Object.entries(counts.geoImpressions).map(([geo, value]) => [
                `geoImpressions.${geo}`,
                value
            ])
        );

        dailyStatsOps.push({
            updateOne: {
                filter: { creativeId, date: todayStr },
                update: {
                    $inc: {
                        impressions: counts.impressions,
                        clicks: counts.clicks,
                        spend: totalCostForThisBatch,
                        ...hourlyInc,
                        ...geoIncrements
                    },
                    $setOnInsert: { campaignId: creative.campaignId }
                },
                upsert: true
            }
        });
    }

    // Update campaigns (lifetime counters and budget)
    let campaignsUpdated = 0;
    let campaignsPaused = 0;

    for (const [campaignId, data] of Object.entries(campaignAggregates)) {
        const campaign = await AdCampaign.findById(campaignId);
        if (!campaign) continue;

        campaign.impressionsCount = (campaign.impressionsCount || 0) + data.impressions;
        campaign.clicksCount = (campaign.clicksCount || 0) + data.clicks;

        campaign.budgetSpent = roundCost((campaign.budgetSpent || 0) + data.cost);

        if (campaign.budgetSpent >= campaign.budgetTotal) {
            campaign.budgetStatus = 'exhausted';
            campaignsPaused++;
        }

        await campaign.save();
        campaignsUpdated++;
    }

    if (dailyStatsOps.length > 0) {
        await AdDailyStats.bulkWrite(dailyStatsOps);
    }

    console.log(`Ad stats processed for CID ${cid}: ${totalProcessed} creatives, ${campaignsUpdated} campaigns, ${campaignsPaused} paused.`);

    return totalProcessed;
};

module.exports = { saveAdStats };
