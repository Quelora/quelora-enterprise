/*
 * Quelora — quelora-enterprise
 * Copyright (C) 2026 Germán Zelaya — https://quelora.org
 * SPDX-License-Identifier: AGPL-3.0-only
 *
 * This file is part of Quelora. See the LICENSE file for terms.
 */

/* filepath: packages/quelora-enterprise/services/gamificationProcessorService.js */

const { cacheClient } = require('@quelora/common/services/cacheService');
const GamificationProfile = require('../models/GamificationProfile');
const GamificationLedger = require('../models/GamificationLedger');
const GamificationRule = require('../models/GamificationRule');
const GamificationLevel = require('../models/GamificationLevel');
const GamificationQuest = require('../models/GamificationQuest');
const GamificationQuestProgress = require('../models/GamificationQuestProgress');
const Profile = require('@quelora/common/models/Profile');
const { mongoose } = require('@quelora/common/db');
const { dispatchGamificationNotification } = require('../utils/gamificationNotificationUtils');

const { queueReputationEvent } = require('@quelora/common/services/reputationService');
const { aggregateNotification } = require('@quelora/common/services/notificationAggregatorService');
const { auditContentQuality } = require('@quelora/common/services/contentQualityService');

const BATCH_SIZE = 500;
const CACHE_TTL = 60000;

let configCache = { rules: {}, levels: [], quests: {}, lastUpdate: 0 };

const getPeriodId = (frequency, date = new Date()) => {
    if (frequency === 'ONETIME' || frequency === 'INFINITE') return 'LIFETIME';
    const d = new Date(date);
    if (frequency === 'MONTHLY') return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
    if (frequency === 'WEEKLY') {
        const dateClone = new Date(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()));
        dateClone.setUTCDate(dateClone.getUTCDate() + 4 - (dateClone.getUTCDay() || 7));
        const yearStart = new Date(Date.UTC(dateClone.getUTCFullYear(), 0, 1));
        const weekNo = Math.ceil((((dateClone - yearStart) / 86400000) + 1) / 7);
        return `${dateClone.getUTCFullYear()}-W${weekNo}`;
    }
    return d.toISOString().slice(0, 10);
};

const isValidObjectId = (id) => mongoose.Types.ObjectId.isValid(id);
const getTodayString = () => new Date().toISOString().slice(0, 10).replace(/-/g, '');
const getYesterdayString = () => { 
    const d = new Date(); 
    d.setDate(d.getDate() - 1); 
    return d.toISOString().slice(0, 10).replace(/-/g, ''); 
};

const calculateLevel = (currentPoints, levels) => {
    let earnedLevel = null;
    for (const lvl of levels) {
        if (currentPoints >= lvl.minPoints) earnedLevel = lvl;
        else break;
    }
    return earnedLevel;
};

const loadConfig = async (cid) => {
    const now = Date.now();
    if (configCache.lastUpdate && (now - configCache.lastUpdate < CACHE_TTL) && configCache.rules[cid]) {
        return { rules: configCache.rules[cid], levels: configCache.levels[cid], quests: configCache.quests[cid] };
    }
    
    const [rulesDocs, levelsDocs, questsDocs] = await Promise.all([
        GamificationRule.find({ cid, active: true }).lean(),
        GamificationLevel.find({ cid }).sort({ minPoints: 1 }).lean(),
        GamificationQuest.find({ cid, active: true }).lean()
    ]);
    
    const rulesMap = {};
    rulesDocs.forEach(r => { rulesMap[r.actionType] = r; });
    
    const questsMap = {};
    questsDocs.forEach(q => {
        const action = q.criteria?.actionType;
        if (action) {
            if (!questsMap[action]) questsMap[action] = [];
            questsMap[action].push(q);
        }
    });

    configCache.rules[cid] = rulesMap;
    configCache.levels[cid] = levelsDocs;
    configCache.quests[cid] = questsMap;
    configCache.lastUpdate = now;
    
    return { rules: rulesMap, levels: levelsDocs, quests: questsMap };
};

const resolveAuthorsBatch = async (events, cid) => {
    const authorsToFind = [];
    events.forEach(ev => {
        if (ev.profileId && !isValidObjectId(ev.profileId)) {
            authorsToFind.push(ev.profileId);
        }
    });
    
    if (authorsToFind.length === 0) return new Map();

    const profiles = await Profile.find({
        author: { $in: authorsToFind },
        cid: cid 
    }).select('_id author').lean();

    const resolutionMap = new Map();
    profiles.forEach(p => resolutionMap.set(p.author, p._id.toString()));
    return resolutionMap;
};

const processGamification = async (targetCid) => {
    if (!targetCid) return false;

    const queueKey = `queue:gamification:events:${targetCid}`;
    
    try {
        const rawEvents = await cacheClient.lRange(queueKey, 0, BATCH_SIZE - 1);
        if (!rawEvents || rawEvents.length === 0) return false;

        const parsedEvents = [];
        for (const item of rawEvents) {
            try { 
                const ev = JSON.parse(item);
                if (ev && ev.profileId && ev.cid === targetCid) {
                    parsedEvents.push(ev);
                }
            } catch (e) { console.error('Error parsing event', item); }
        }

        if (parsedEvents.length === 0) {
            await cacheClient.lTrim(queueKey, rawEvents.length, -1);
            return false;
        }

        const { rules, levels, quests } = await loadConfig(targetCid);
        const profileResolutionMap = await resolveAuthorsBatch(parsedEvents, targetCid);
        
        const userAggregates = {}; 
        for (const event of parsedEvents) {
            let resolvedId = event.profileId;
            if (!isValidObjectId(resolvedId)) {
                resolvedId = profileResolutionMap.get(event.profileId);
                if (!resolvedId) continue; 
            }
            if (!userAggregates[resolvedId]) {
                userAggregates[resolvedId] = { 
                    cid: targetCid, 
                    profileId: resolvedId,
                    events: [], 
                    actionsCount: {} 
                };
            }
            userAggregates[resolvedId].events.push(event);
        }

        const keys = Object.keys(userAggregates);
        if (keys.length === 0) {
            await cacheClient.lTrim(queueKey, rawEvents.length, -1);
            return false;
        }

        const updates = [];
        const ledgerInserts = [];
        const notificationPromises = [];
        const questUpdates = [];
        const today = getTodayString();
        const yesterday = getYesterdayString();

        const existingProfiles = await GamificationProfile.find({ 
            cid: targetCid, 
            profile_id: { $in: keys } 
        });
        const profilesMap = new Map();
        existingProfiles.forEach(p => profilesMap.set(p.profile_id.toString(), p));

        for (const profileId of keys) {
            const aggregate = userAggregates[profileId];
            const events = aggregate.events;

            let gamProfile = profilesMap.get(profileId);
            let isNewProfile = false;

            if (!gamProfile) {
                gamProfile = {
                    cid: targetCid,
                    profile_id: profileId,
                    walletBalance: 0,
                    lifetimePoints: 0,
                    monthlyPoints: 0,
                    currentLevel: null,
                    dailyStats: { date: today, actions: new Map() },
                    streaks: { current: 0, longest: 0, lastActionDate: '', lastClaimDate: null, freezeInventory: 0 }
                };
                isNewProfile = true;
            } else {
                if (gamProfile.dailyStats?.date !== today) {
                    gamProfile.dailyStats = { date: today, actions: new Map() };
                } else if (!(gamProfile.dailyStats.actions instanceof Map)) {
                    gamProfile.dailyStats.actions = new Map(Object.entries(gamProfile.dailyStats.actions || {}));
                }
            }

            let xpDelta = 0;
            let coinDelta = 0;
            const userQuestIncrements = {}; 

            if (events.length > 0) {
                const lastDate = gamProfile.streaks.lastActionDate;
                if (lastDate === today) {
                } else if (lastDate === yesterday) {
                    gamProfile.streaks.current += 1;
                    gamProfile.streaks.lastActionDate = today;
                } else {
                    if (gamProfile.streaks.freezeInventory > 0) {
                        gamProfile.streaks.freezeInventory -= 1; 
                        gamProfile.streaks.current += 1; 
                        gamProfile.streaks.lastActionDate = today;
                        ledgerInserts.push({
                            cid: targetCid, profile_id: profileId,
                            amount: 0, xpAmount: 0, type: 'SPEND', source: 'SYSTEM',
                            description: 'Streak Freeze Used', created_at: new Date()
                        });
                    } else {
                        gamProfile.streaks.current = 1;
                        gamProfile.streaks.lastActionDate = today;
                    }
                }
                if (gamProfile.streaks.current > gamProfile.streaks.longest) {
                    gamProfile.streaks.longest = gamProfile.streaks.current;
                }
            }

            for (const ev of events) {
                if (ev.actionType !== 'LIKE_REMOVED' && ev.actionType !== 'COMMENT_REMOVED') {
                    const activeQuests = quests[ev.actionType];
                    if (activeQuests?.length > 0) {
                        activeQuests.forEach(q => {
                            if (!userQuestIncrements[q._id]) {
                                userQuestIncrements[q._id] = { 
                                    count: 0, 
                                    target: q.criteria.targetCount, 
                                    frequency: q.frequency 
                                };
                            }
                            userQuestIncrements[q._id].count += 1;
                        });
                    }
                }

                let rule = rules[ev.actionType];
                let multiplier = 1;

                if (!rule) {
                    if (ev.actionType === 'LIKE_REMOVED') {
                        const originRule = rules['LIKE_RECEIVED'];
                        if (originRule) { rule = originRule; multiplier = -1; }
                    } else if (ev.actionType === 'COMMENT_REMOVED') {
                        const originRule = rules['COMMENT_CREATED'];
                        if (originRule) { rule = originRule; multiplier = -1; }
                    }
                }

                if (!rule) continue;

                const currentCount = (gamProfile.dailyStats.actions.get(ev.actionType) || 0) + 
                                     (aggregate.actionsCount[ev.actionType] || 0);
                
                if (multiplier > 0 && rule.dailyLimit > 0 && currentCount >= rule.dailyLimit) continue;

                const eventXp = (rule.xpReward || 0) * multiplier;
                const eventCoins = (rule.coinReward || 0) * multiplier;

                xpDelta += eventXp;
                coinDelta += eventCoins;
                aggregate.actionsCount[ev.actionType] = (aggregate.actionsCount[ev.actionType] || 0) + 1;

                if (rule.reputation > 0) {
                    let repDelta = rule.reputation * multiplier;
                    let shouldGrantRep = true;

                    if (rule.qualityCheck?.enabled) {
                        const qualityFactor = await auditContentQuality(
                            targetCid, 
                            profileId, 
                            rule.qualityCheck.contentType || 'COMMENT', 
                            1
                        );
                        
                        repDelta = repDelta * qualityFactor;
                        if (qualityFactor < (rule.qualityCheck.minScore || 0.1)) {
                            shouldGrantRep = false;
                        }
                    }

                    if (shouldGrantRep && repDelta !== 0) {
                        await queueReputationEvent({
                            cid: targetCid,
                            target_profile_id: profileId,
                            source_profile_id: null,
                            event_type: multiplier > 0 ? 'RULE_REWARD_HIDDEN' : 'RULE_PENALTY_HIDDEN',
                            entity_id: ev.metadata?.commentId || ev.metadata?.postId,
                            source_trust_level: 10,
                            custom_delta: repDelta
                        });
                    }
                }

                if (eventXp !== 0 || eventCoins !== 0) {
                    ledgerInserts.push({
                        cid: targetCid,
                        profile_id: profileId,
                        amount: eventCoins,
                        xpAmount: eventXp,
                        type: multiplier > 0 ? 'EARN' : 'PENALTY',
                        source: ev.actionType,
                        reference_id: ev.metadata?.postId || ev.metadata?.commentId,
                        description: multiplier > 0 ? `Reward: ${ev.actionType}` : `Reversal: ${ev.actionType}`,
                        created_at: new Date(ev.timestamp || Date.now())
                    });
                }
            }

            gamProfile.lifetimePoints = (gamProfile.lifetimePoints || 0) + xpDelta; 

            Object.entries(aggregate.actionsCount).forEach(([action, count]) => {
                const prev = gamProfile.dailyStats.actions.get(action) || 0;
                gamProfile.dailyStats.actions.set(action, prev + count);
            });

            if (xpDelta > 0 || coinDelta > 0) {
                 await aggregateNotification({
                    cid: targetCid,
                    recipientId: profileId,
                    entityId: 'gamification_buffer',
                    actionType: 'XP_EARNED',
                    value: xpDelta
                });
                
                if (coinDelta > 0) {
                    await aggregateNotification({
                        cid: targetCid,
                        recipientId: profileId,
                        entityId: 'gamification_buffer',
                        actionType: 'COIN_EARNED',
                        value: coinDelta
                    });
                }
            }

            if (levels && levels.length > 0) {
                const newLevel = calculateLevel(gamProfile.lifetimePoints, levels);
                const currentLvlId = gamProfile.currentLevel?._id?.toString() || gamProfile.currentLevel?.toString();
                const newLvlId = newLevel?._id?.toString();

                if (newLevel && currentLvlId !== newLvlId) {
                    gamProfile.currentLevel = newLevel._id;
                    
                    ledgerInserts.push({
                        cid: targetCid,
                        profile_id: profileId,
                        amount: 0, xpAmount: 0, type: 'LEVEL_UP_REWARD', source: 'SYSTEM',
                        description: `Level Up: ${newLevel.name}`, 
                        reference_id: newLevel._id, 
                        created_at: new Date()
                    });
                    
                    if (dispatchGamificationNotification) {
                        notificationPromises.push(dispatchGamificationNotification({
                            cid: targetCid, 
                            profileId, 
                            type: 'LEVEL_UP',
                            metadata: { levelName: newLevel.name, referenceId: newLevel._id }
                        }));
                    }

                    await queueReputationEvent({
                        cid: targetCid,
                        target_profile_id: profileId,
                        source_profile_id: null,
                        event_type: 'gamification_level_up',
                        entity_id: newLevel._id,
                        source_trust_level: 10
                    });
                }
            }

            if (isNewProfile) {
                gamProfile.walletBalance = coinDelta;
                gamProfile.monthlyPoints = xpDelta;
                
                updates.push({ 
                    updateOne: { 
                        filter: { cid: targetCid, profile_id: profileId }, 
                        update: { $set: gamProfile }, 
                        upsert: true 
                    } 
                });
            } else {
                const incFields = {};
                if (coinDelta !== 0) incFields.walletBalance = coinDelta;
                if (xpDelta !== 0) {
                    incFields.lifetimePoints = xpDelta;
                    incFields.monthlyPoints = xpDelta;
                }
                
                Object.entries(aggregate.actionsCount).forEach(([action, count]) => {
                    incFields[`dailyStats.actions.${action}`] = count;
                });

                const updateOp = {
                    filter: { cid: targetCid, profile_id: profileId },
                    update: { 
                        $set: { 
                            currentLevel: gamProfile.currentLevel,
                            'dailyStats.date': today, 
                            streaks: gamProfile.streaks 
                        }
                    }
                };

                if (Object.keys(incFields).length > 0) {
                    updateOp.update.$inc = incFields;
                }

                updates.push({ updateOne: updateOp });
            }

            Object.entries(userQuestIncrements).forEach(([qId, data]) => {
                const periodId = getPeriodId(data.frequency);
                questUpdates.push({
                    updateOne: {
                        filter: { cid: targetCid, profile_id: profileId, quest_id: qId, periodId },
                        update: { 
                            $inc: { currentCount: data.count },
                            $setOnInsert: { targetCount: data.target, status: 'IN_PROGRESS', isClaimed: false }
                        },
                        upsert: true
                    }
                });
            });
        }

        if (updates.length > 0) await GamificationProfile.bulkWrite(updates);
        if (questUpdates.length > 0) await GamificationQuestProgress.bulkWrite(questUpdates);
        if (ledgerInserts.length > 0) await GamificationLedger.insertMany(ledgerInserts);

        await cacheClient.lTrim(queueKey, rawEvents.length, -1);

        if (notificationPromises.length > 0) {
            await Promise.allSettled(notificationPromises);
        }

        return true;

    } catch (error) {
        console.error(`❌ Gamification Process Error [${targetCid}]:`, error);
        throw error;
    }
};

module.exports = { processGamification };