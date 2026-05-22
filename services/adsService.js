/*
 * Quelora — quelora-enterprise
 * Copyright (C) 2026 Germán Zelaya — https://quelora.org
 * SPDX-License-Identifier: AGPL-3.0-only
 *
 * This file is part of Quelora. See the LICENSE file for terms.
 */

/* filepath: packages/quelora-public-api/services/adsService.js */
const { mongoose } = require('@quelora/common/db');
const AdCampaign = require('../models/AdCampaign');
const AdCreative = require('../models/AdCreative');
const AdvertiserProfile = require('../models/AdvertiserProfile');
const Placement = require('../models/Placement');
const PlacementPricing = require('../models/PlacementPricing');
const AdClickLog = require('../models/AdClickLog');
const Post = require('@quelora/common/models/Post');
const { cacheClient, cacheService } = require('@quelora/common/services/cacheService');

// --- Cache Constants ---
const AD_FREQ_CACHE_PREFIX = 'ad_freq:'; 

/**
 * Generates the Redis hash key for ad statistics specific to a client (tenant).
 * @param {string} cid - The Client ID.
 */
const getAdStatsKey = (cid) => `ad_stats:${cid}`;

/**
 * Checks if the user's geographical data is allowed by the ad's geo-targeting rules.
 * @param {object} adGeoTargeting - The geo-targeting rules from the AdCampaign.
 * @param {object} geoData - The user's geo-location data.
 * @returns {boolean} True if allowed, false otherwise.
 */
function isGeoAllowed(adGeoTargeting, geoData = {}) {
    if (!adGeoTargeting) return true;

    const countryCode = (geoData.countryCode || geoData.country || '').toString().toUpperCase();
    const region = (geoData.region || '').toString();
    const city = (geoData.city || '').toString();

    const countries = (adGeoTargeting.countries || []).map(c => c.toString().toUpperCase());
    const regions = (adGeoTargeting.regions || []).map(r => r.toString());
    const cities = (adGeoTargeting.cities || []).map(c => c.toString());

    // If no targeting is defined, it's allowed worldwide
    if (countries.length === 0 && regions.length === 0 && cities.length === 0) {
        return true;
    }
    
    if (countries.length > 0 && !countries.includes(countryCode)) return false;
    if (regions.length > 0 && !regions.some(r => r.toLowerCase() === region?.toLowerCase())) return false;
    if (cities.length > 0 && !cities.some(c => c.toLowerCase() === city?.toLowerCase())) return false;
    return true;
}

/**
 * Determines the floor price (CPM/CPC) for a given placement, considering geo-specific or CID overrides.
 */
async function _getPlacementPricingForGeoAndCid(placement, cid, geoData) {
    const cidPricing = await PlacementPricing.findOne({ placementId: placement._id, cid: cid });
    const countryCode = (geoData.countryCode || geoData.country || '').toString().toUpperCase();

    let basePricing = { cpm: placement.floorPriceCPM || 0, cpc: placement.floorPriceCPC || 0 };
    if (cidPricing) {
        basePricing = { cpm: cidPricing.floorPriceCPM, cpc: cidPricing.floorPriceCPC };
    }

    const geoPricingList = cidPricing?.geoPricing || placement.geoPricing || [];
    if (geoPricingList.length > 0 && countryCode) {
        const geoPrice = geoPricingList.find(p => p.country === countryCode);
        if (geoPrice) return { cpm: geoPrice.floorPriceCPM, cpc: geoPrice.floorPriceCPC };
    }
    return basePricing;
}

/**
 * Selects multiple ads based on weighted random selection.
 * Used primarily for feed placements where multiple ads are needed.
 */
function _selectMultipleWeightedAds(ads, limit = 5) {
    if (!ads || ads.length === 0) return [];
    const candidates = [...ads].sort((a, b) => {
        const weightA = (a.weight || 1) * Math.random();
        const weightB = (b.weight || 1) * Math.random();
        return weightB - weightA;
    });
    return candidates.slice(0, limit);
}

/**
 * Selects a single ad using weighted random selection (Roulette Wheel selection).
 */
function _selectWeightedAd(ads) {
    if (!ads || ads.length === 0) return null;
    const totalWeight = ads.reduce((sum, ad) => sum + (ad.weight || 1), 0);
    let random = Math.random() * totalWeight; 
    for (const ad of ads) {
        random -= (ad.weight || 1);
        if (random <= 0) return ad;
    }
    return ads[0];
}

/**
 * Generates the cache key for Frequency Capping.
 */
function _getFreqCapKey(campaignId, author, ip) {
    const authorKey = author ? `user:${author}` : `ip:${ip || 'unknown_ip'}`;
    return `${AD_FREQ_CACHE_PREFIX}${campaignId}:${authorKey}`;
}

/**
 * Checks if the frequency cap for a campaign has been reached for a specific user/IP.
 */
async function _checkFrequencyCapReached(campaignId, freqCap, author, ip) {
    if (!freqCap || !freqCap.impressions || freqCap.impressions === 0) return false;
    const key = _getFreqCapKey(campaignId, author, ip);
    try {
        const currentImpressions = await cacheService.get(key);
        if (currentImpressions === null) return false;
        return parseInt(currentImpressions, 10) >= freqCap.impressions;
    } catch (error) {
        return false;
    }
}

/**
 * Formats the ad creative into a standardized response object for the frontend widget.
 */
function _formatAdForWidget(ad, placementKey) {
    const campaign = ad.campaignId;
    const advertiser = ad.advertiserProfileId;
    if (!campaign) return null;
    return {
        type: 'ad',
        creative: {
            _id: ad._id.toString(),
            placementKey: placementKey,
            creativeType: ad.creativeType,
            destinationUrl: ad.destinationUrl,
            nativeText: ad.nativeText,
            media: ad.media,
            contextualKeywords: ad.contextualKeywords || [],
            advertiser: advertiser ? { _id: advertiser._id, name: advertiser.name, avatarUrl: advertiser.avatarUrl } : null,
            createdAt: ad.createdAt
        },
        campaign: { _id: campaign._id.toString(), frequencyCap: campaign.frequencyCap }
    };
}

/**
 * Determines which posts in a feed are eligible for ads or overlays.
 */
exports.getAdFlagsForPosts = async (cid, posts) => {
    const relevantPlacements = await Placement.find({ key: { $in: ['comment-in-feed', 'comment-sponsored-top', 'thread-overlay'] } }).select('_id key').lean();
    const activeCampaignIds = await AdCampaign.find({ cids: cid, status: 'active', budgetStatus: 'active', startDate: { $lte: new Date() }, $or: [{ endDate: null }, { endDate: { $gte: new Date() } }] }).select('_id').lean();

    const placementIds = relevantPlacements.map(p => p._id);
    const postIds = posts.map(p => p._id);
    const ads = await AdCreative.find({ 
        campaignId: { $in: activeCampaignIds.map(c => c._id) }, 
        status: 'active', 
        placementId: { $in: placementIds }, 
        $or: [{ postTargetingMode: 'all' }, { postTargetingMode: 'keywords' }, { posts: { $in: postIds } }] 
    }).select('posts postTargetingMode placementId').lean();

    const adPostMap = new Set();
    let hasOverlays = false;
    const overlayPlacementIds = relevantPlacements.filter(p => p.key === 'thread-overlay').map(p => p._id.toString());
        
    ads.forEach(ad => {
        const placementIdStr = ad.placementId.toString();
        if (overlayPlacementIds.includes(placementIdStr)) hasOverlays = true;
        
        if (ad.postTargetingMode === 'all' || ad.postTargetingMode === 'keywords') postIds.forEach(pid => adPostMap.add(pid.toString()));
        else if (ad.postTargetingMode === 'specific') ad.posts.forEach(postId => { if (postIds.some(pid => pid.toString() === postId.toString())) adPostMap.add(postId.toString()); });
    });
    return { adPostMap, hasOverlays };
};

/**
 * Main function to fetch winning ads for a request based on context, targeting, and bidding.
 */
exports.getAdsForRequest = async ({ cid, placementKeys, entityId, lastCommentId = null, geoData = {}, userId = null, ip = null }) => {
    const now = new Date();

    const placements = await Placement.find({ key: { $in: placementKeys } }).lean();
    const placementMap = new Map(placements.map(p => [p._id.toString(), p]));
    const activeCampaigns = await AdCampaign.find({ cids: cid, status: 'active', budgetStatus: 'active', startDate: { $lte: now }, $or: [{ endDate: null }, { endDate: { $gte: now } }] }).select('_id geoTargeting frequencyCap').lean();
    const activeCampaignIds = activeCampaigns.map(c => c._id);
    const campaignMap = new Map(activeCampaigns.map(c => [c._id.toString(), c]));

    let postKeywords = [];
    let postObjectId = null;
    if (entityId) {
        const post = await Post.findOne({ entity: entityId, cid: cid }).select('_id tags keywords').lean();
        if (post) {
            postObjectId = post._id;
            postKeywords = [...(post.tags || []), ...(post.keywords || [])].map(k => k.toUpperCase());
        }
    }

    const potentialAds = await AdCreative.find({ campaignId: { $in: activeCampaignIds }, status: 'active', placementId: { $in: Array.from(placementMap.keys()).map(id => new mongoose.Types.ObjectId(id)) } }).populate('advertiserProfileId', 'name avatarUrl profileLink').lean();

    const eligibleAdsByPlacement = new Map();
    
    for (const ad of potentialAds) {
        const campaign = campaignMap.get(ad.campaignId.toString());
        const placement = placementMap.get(ad.placementId.toString());
        if (!campaign || !placement) continue;

        if (!isGeoAllowed(campaign.geoTargeting, geoData)) continue;

        const currentGeoPrice = await _getPlacementPricingForGeoAndCid(placement, cid, geoData);
        if ((ad.maxBidCPM || 0) < currentGeoPrice.cpm || (ad.maxBidCPC || 0) < currentGeoPrice.cpc) continue;

        const isMobile = geoData.isMobile || false;
        if (ad.deviceTargeting === 'desktop' && isMobile) continue;
        if (ad.deviceTargeting === 'mobile' && !isMobile) continue;

        let postTargetOK = true;
        if (ad.postTargetingMode === 'specific') {
            if (!postObjectId || !ad.posts.some(pId => pId.toString() === postObjectId.toString())) postTargetOK = false;
        } else if (ad.postTargetingMode === 'keywords') {
            if (ad.postKeywords && ad.postKeywords.length > 0) {
                if (postKeywords.length === 0 || !ad.postKeywords.some(k => postKeywords.includes(k.toUpperCase()))) postTargetOK = false;
            }
        }
        if (!postTargetOK) continue;

        if (await _checkFrequencyCapReached(campaign._id, campaign.frequencyCap, userId, ip)) continue;

        const placementKey = placement.key;
        if (!eligibleAdsByPlacement.has(placementKey)) eligibleAdsByPlacement.set(placementKey, []);
        ad.campaignId = campaign;
        eligibleAdsByPlacement.get(placementKey).push(ad);
    }

    const winningAds = [];
    for (const [placementKey, ads] of eligibleAdsByPlacement.entries()) {
        if (ads.length > 0) {
            if (placementKey === 'comment-in-feed') {
                const candidates = _selectMultipleWeightedAds(ads, 10);
                candidates.forEach(ad => { const formattedAd = _formatAdForWidget(ad, placementKey); if (formattedAd) winningAds.push(formattedAd); });
            } else {
                const winningAd = _selectWeightedAd(ads);
                const formattedAd = _formatAdForWidget(winningAd, placementKey);
                if (formattedAd) winningAds.push(formattedAd);
            }
        }
    }
    return winningAds;
};

/**
 * Registers an ad impression in Redis.
 * Uses a segregated Redis key per Client ID to allow correct processing by the Worker.
 */
exports.registerImpression = async ({ cid, creativeId, campaignId, author, ip, geoData = {} }) => {
    try {
        if (!cid) throw new Error('CID is required for registering impressions');

        const campaign = await AdCampaign.findById(campaignId).select('frequencyCap').lean();
        if (campaign && campaign.frequencyCap && campaign.frequencyCap.impressions !== 0) {
            const freqCap = campaign.frequencyCap;
            const key = _getFreqCapKey(campaignId, author, ip);
            const ttlInSeconds = (freqCap.perHours || 24) * 3600;
            const newCount = await cacheClient.incr(key);
            if (newCount === 1) await cacheClient.expire(key, ttlInSeconds);
        }

        if (creativeId) {
            const statsKey = getAdStatsKey(cid);

            await cacheClient.hIncrBy(statsKey, `${creativeId}:impression`, 1);

            const countryCode = (geoData.countryCode || geoData.country || 'UNKNOWN_COUNTRY').toString().toUpperCase();
            const rawRegion = geoData.region || 'UNKNOWN_REGION';
            const region = rawRegion.toString().toUpperCase().replace(/[^A-Z0-9_]/g, '');
            const geoKeySegment = `${countryCode}__${region}`;
            const geoImpressionKey = `${creativeId}:impression:geo:${geoKeySegment}`;
            
            await cacheClient.hIncrBy(statsKey, geoImpressionKey, 1);
        }
        return { success: true };
    } catch (error) {
        console.error(`AD_BACKEND_DEBUG: Error registerImpression:`, error);
        return { success: false, error: error.message };
    }
};

/**
 * Registers an ad click in Redis and logs it to MongoDB.
 * Uses a segregated Redis key per Client ID.
 */
exports.registerClick = async ({ cid, creativeId, ip, userAgent, isMember, geoData}) => {
    try {
        if (!cid) throw new Error('CID is required for registering clicks');

        const statsKey = getAdStatsKey(cid);
        
        await cacheClient.hIncrBy(statsKey, `${creativeId}:click`, 1);

        const creative = await AdCreative.findById(creativeId).select('destinationUrl campaignId').lean();
        if (creative) {
            await AdClickLog.create({
                creativeId: creative._id,
                campaignId: creative.campaignId,
                isMember: isMember,
                ip: ip,
                geoData,
                userAgent: userAgent,
                timestamp: new Date(),
                cid: cid
            });

            return creative.destinationUrl;
        }
        return null;
    } catch (error) {
        console.error(`AD_BACKEND_DEBUG: Error registerClick:`, error);
        return null;
    }
};