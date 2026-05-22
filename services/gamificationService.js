/*
 * Quelora — quelora-enterprise
 * Copyright (C) 2026 Germán Zelaya — https://quelora.org
 * SPDX-License-Identifier: AGPL-3.0-only
 *
 * This file is part of Quelora. See the LICENSE file for terms.
 */

/* filepath: packages/quelora-enterprise/services/gamificationService.js */

const GamificationProfile = require('../models/GamificationProfile');
const GamificationLevel = require('../models/GamificationLevel');
const GamificationLedger = require('../models/GamificationLedger');
const GamificationQuest = require('../models/GamificationQuest');
const GamificationQuestProgress = require('../models/GamificationQuestProgress');
const GamificationRule = require('../models/GamificationRule');
const GamificationConfig = require('../models/GamificationConfig');
const GameficationStoreService = require('./gamificationStoreService');
const Profile = require('@quelora/common/models/Profile');
const { cacheService } = require('@quelora/common/services/cacheService');

/**
 * Retrieves currency configuration with caching strategy.
 * @param {string} cid - The client ID.
 * @returns {Promise<Object>} The currency configuration object.
 */
const getCurrencyConfig = async (cid) => {
    try {
        const cacheKey = `config:currency:${cid}`;
        const cached = await cacheService.get(cacheKey);
        if (cached) return cached;

        const config = await GamificationConfig.findOne({ cid }).select('currency').lean();
        
        const currency = config?.currency || { 
            name: 'Queloros', 
            singularName: 'Queloro', 
            symbol: '🪙' 
        };

        await cacheService.set(cacheKey, currency, 3600); 
        return currency;
    } catch (error) {
        console.error('Error fetching currency config', error);
        return { name: 'Queloros', symbol: '🪙', singularName: 'Queloro' };
    }
};

/**
 * Calculates the period ID for quests based on frequency.
 */
const getPeriodId = (frequency, date = new Date()) => {
    if (frequency === 'ONETIME' || frequency === 'INFINITE') return 'LIFETIME';
    
    const d = new Date(date);
    
    if (frequency === 'MONTHLY') {
        return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
    }
    
    if (frequency === 'WEEKLY') {
        const dateClone = new Date(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()));
        dateClone.setUTCDate(dateClone.getUTCDate() + 4 - (dateClone.getUTCDay() || 7));
        const yearStart = new Date(Date.UTC(dateClone.getUTCFullYear(), 0, 1));
        const weekNo = Math.ceil((((dateClone - yearStart) / 86400000) + 1) / 7);
        return `${dateClone.getUTCFullYear()}-W${weekNo}`;
    }

    return d.toISOString().slice(0, 10);
};

const getInitialLevel = async (cid) => {
    return await GamificationLevel.findOne({ cid }).sort({ minPoints: 1 }).lean();
};

/**
 * Retrieves the full gamification status for a user including currency info.
 */
const getUserStatus = async (cid, profileId) => {
    const currency = await getCurrencyConfig(cid);

    let gamProfile = await GamificationProfile.findOne({ profile_id: profileId, cid })
        .populate('currentLevel')
        .lean();

    let currentLevelObj = gamProfile?.currentLevel;
    
    if (!currentLevelObj) {
        currentLevelObj = await getInitialLevel(cid);
    }

    if (!gamProfile) {
        return {
            isGuest: false,
            walletBalance: 0,
            currency,
            lifetimePoints: 0, 
            monthlyPoints: 0,
            level: currentLevelObj || null,
            nextLevel: null,
            progress: 0,
            streak: 0,
            streakClaimable: false,
            dailyQuests: []
        };
    }

    let nextLevel = null;
    let progressPercentage = 0;

    if (currentLevelObj) {
        nextLevel = await GamificationLevel.findOne({ 
            cid, 
            minPoints: { $gt: currentLevelObj.minPoints } 
        })
        .sort({ minPoints: 1 })
        .lean();

        if (nextLevel) {
            const currentBase = currentLevelObj.minPoints;
            const target = nextLevel.minPoints;
            const current = gamProfile.lifetimePoints;
            
            if (target - currentBase > 0) {
                const rawProgress = ((current - currentBase) / (target - currentBase)) * 100;
                progressPercentage = Math.min(100, Math.max(0, Math.floor(rawProgress)));
            } else {
                progressPercentage = 100;
            }
        } else {
            progressPercentage = 100;
        }
    }

    const activeQuests = await GamificationQuest.find({ cid, active: true }).sort({ order: 1 }).lean();
    
    const progressMap = new Map();
    if (activeQuests.length > 0) {
        const orConditions = activeQuests.map(q => ({
            quest_id: q._id,
            periodId: getPeriodId(q.frequency)
        }));

        const progressDocs = await GamificationQuestProgress.find({
            cid,
            profile_id: profileId,
            $or: orConditions
        }).lean();
        
        progressDocs.forEach(p => progressMap.set(p.quest_id.toString(), p));
    }

    const dailyQuests = activeQuests.map(quest => {
        const userProgress = progressMap.get(quest._id.toString());
        const current = userProgress?.currentCount || 0;
        const target = quest.criteria.targetCount;
        const isClaimed = userProgress?.isClaimed || false;
        
        let status = 'active';
        if (isClaimed) {
            status = 'completed';
        } else if (current >= target) {
            status = 'claimable';
        }

        return {
            id: quest._id,
            title: quest.title,
            icon: quest.icon,
            target: target,
            progress: current,
            reward: quest.rewards.coins || quest.rewards.xp,
            status
        };
    });

    const activeEffects = await GameficationStoreService.getActiveEffects(cid, profileId);
    
    const today = new Date().toISOString().slice(0, 10);
    const yesterdayDate = new Date();
    yesterdayDate.setDate(yesterdayDate.getDate() - 1);
    const yesterday = yesterdayDate.toISOString().slice(0, 10);

    const lastAction = gamProfile.streaks.lastActionDate;
    const lastClaim = gamProfile.streaks.lastClaimDate;
    const currentStreak = gamProfile.streaks.current || 0;

    const canClaimDaily = (lastAction === today && lastClaim !== today);
    const canRecoverYesterday = (lastAction === yesterday && lastClaim !== today && lastClaim !== yesterday);
    const isWeeklyFull = currentStreak >= 7;
    const canClaimWeekly = isWeeklyFull && lastClaim !== today;

    const isStreakClaimable = canClaimDaily || canRecoverYesterday || canClaimWeekly;

    return {
        isGuest: false,
        walletBalance: gamProfile.walletBalance,
        currency,
        lifetimePoints: gamProfile.lifetimePoints,
        monthlyPoints: gamProfile.monthlyPoints,
        level: currentLevelObj,
        nextLevel,
        progress: progressPercentage,
        streak: currentStreak,
        streakClaimable: isStreakClaimable,
        dailyQuests,
        activeEffects
    };
};

/**
 * Claims a reward (Streak or Quest) and returns updated currency info.
 */
const claimReward = async (cid, profileId, type, id) => {
    const currency = await getCurrencyConfig(cid);

    if (type === 'streak') {
        const profile = await GamificationProfile.findOne({ cid, profile_id: profileId });
        if (!profile) throw new Error('Profile not found');

        const today = new Date().toISOString().slice(0, 10);
        const yesterdayDate = new Date();
        yesterdayDate.setDate(yesterdayDate.getDate() - 1);
        const yesterday = yesterdayDate.toISOString().slice(0, 10);
        
        const isWeeklyMilestone = profile.streaks.current >= 7;

        if (!isWeeklyMilestone) {
            const isValidStreakDate = (profile.streaks.lastActionDate === today) || 
                                      (profile.streaks.lastActionDate === yesterday);
            
            if (!isValidStreakDate) {
                throw new Error('No streak action recorded recently');
            }
        }

        if (profile.streaks.lastClaimDate === today) {
            throw new Error('Streak already claimed today');
        }

        const rules = await GamificationRule.findOne({ cid, actionType: 'STREAK_BONUS' }).lean();
        
        const coins = isWeeklyMilestone ? (rules?.coinReward || 10) * 5 : (rules?.coinReward || 10); 
        const xp = isWeeklyMilestone ? (rules?.xpReward || 50) * 2 : (rules?.xpReward || 50);

        profile.walletBalance += coins;
        profile.lifetimePoints += xp;
        profile.monthlyPoints += xp;
        profile.streaks.lastClaimDate = today;

        if (isWeeklyMilestone) {
            profile.streaks.current = 0; 
        }

        const ledgerEntry = new GamificationLedger({
            cid,
            profile_id: profileId,
            amount: coins,
            xpAmount: xp,
            type: 'STREAK_BONUS',
            source: 'USER_ACTION',
            description: isWeeklyMilestone ? `Weekly Streak Claim: Cycle Reset` : `Streak Claim: ${profile.streaks.current} days`,
            created_at: new Date()
        });

        await Promise.all([profile.save(), ledgerEntry.save()]);

        return { success: true, rewardAmount: coins, rewardXp: xp, currency };
    } 
    
    if (type === 'quest') {
        const quest = await GamificationQuest.findById(id);
        if (!quest) throw new Error('Quest definition not found');

        const targetPeriodId = getPeriodId(quest.frequency);
        
        const progress = await GamificationQuestProgress.findOne({
            cid,
            profile_id: profileId,
            quest_id: id,
            periodId: targetPeriodId
        });

        if (!progress) throw new Error('Quest progress not found');
        if (progress.isClaimed) throw new Error('Quest already claimed');
        if (progress.currentCount < progress.targetCount) throw new Error('Quest not completed');

        const coins = quest.rewards.coins || 0;
        const xp = quest.rewards.xp || 0;

        progress.isClaimed = true;
        progress.claimedAt = new Date();
        progress.status = 'COMPLETED';

        const profile = await GamificationProfile.findOne({ cid, profile_id: profileId });
        profile.walletBalance += coins;
        profile.lifetimePoints += xp;
        profile.monthlyPoints += xp;

        const ledgerEntry = new GamificationLedger({
            cid,
            profile_id: profileId,
            amount: coins,
            xpAmount: xp,
            type: 'QUEST_REWARD',
            source: 'USER_ACTION',
            reference_id: id,
            description: `Quest: ${quest.title}`,
            created_at: new Date()
        });

        await Promise.all([progress.save(), profile.save(), ledgerEntry.save()]);

        return { success: true, rewardAmount: coins, rewardXp: xp, currency };
    }

    throw new Error('Invalid claim type');
};

const getLeaderboard = async (cid, period = 'monthly', limit = 10) => {
    const sortField = period === 'lifetime' ? { lifetimePoints: -1 } : { monthlyPoints: -1 };
    
    const leaderboard = await GamificationProfile.find({ cid })
        .sort(sortField)
        .limit(limit)
        .populate({
            path: 'profile_id',
            select: 'author name picture username avatar'
        })
        .populate('currentLevel', 'name icon avatarFrameUrl')
        .lean();

    const initialLevel = await getInitialLevel(cid);

    return leaderboard.map((entry, index) => ({
        rank: index + 1,
        profile: entry.profile_id,
        points: period === 'lifetime' ? entry.lifetimePoints : entry.monthlyPoints,
        level: entry.currentLevel || initialLevel
    }));
};

const getEconomyStats = async (cid, fromDate, toDate) => {
    const currency = await getCurrencyConfig(cid);

    const end = toDate ? new Date(toDate) : new Date();
    const start = fromDate ? new Date(fromDate) : new Date();
    
    if (!fromDate) {
        start.setDate(end.getDate() - 30);
    }

    start.setHours(0, 0, 0, 0);
    end.setHours(23, 59, 59, 999);

    const circulationAgg = await GamificationProfile.aggregate([
        { $match: { cid } },
        { $group: { _id: null, totalTokens: { $sum: "$walletBalance" }, totalLifetimeXP: { $sum: "$lifetimePoints" } } }
    ]);

    const totalCirculation = circulationAgg[0]?.totalTokens || 0;
    const totalLifetimeMinted = circulationAgg[0]?.totalLifetimeXP || 0;

    const flowAgg = await GamificationLedger.aggregate([
        { 
            $match: { 
                cid, 
                created_at: { $gte: start, $lte: end },
                amount: { $ne: 0 } 
            } 
        },
        { 
            $group: { 
                _id: "$type", 
                totalAmount: { $sum: "$amount" },
                count: { $sum: 1 }
            } 
        }
    ]);

    const flowStats = {
        minted_period: 0,
        burned_period: 0,
        transactions_period: 0
    };

    flowAgg.forEach(stat => {
        if (['EARN', 'ADJUSTMENT', 'LEVEL_UP_REWARD', 'STREAK_BONUS', 'QUEST_REWARD', 'REFERRAL_REWARD'].includes(stat._id)) {
            if (stat.totalAmount > 0) flowStats.minted_period += stat.totalAmount;
            else flowStats.burned_period += Math.abs(stat.totalAmount);
        } else if (['SPEND', 'FEE', 'PENALTY'].includes(stat._id)) {
            flowStats.burned_period += Math.abs(stat.totalAmount);
        }
        flowStats.transactions_period += stat.count;
    });

    const dailyAgg = await GamificationLedger.aggregate([
        {
            $match: {
                cid,
                created_at: { $gte: start, $lte: end },
                amount: { $ne: 0 }
            }
        },
        {
            $group: {
                _id: { $dateToString: { format: "%Y-%m-%d", date: "$created_at" } },
                minted: {
                    $sum: {
                        $cond: [{ $gt: ["$amount", 0] }, "$amount", 0]
                    }
                },
                burned: {
                    $sum: {
                        $cond: [{ $lt: ["$amount", 0] }, { $abs: "$amount" }, 0]
                    }
                }
            }
        },
        { $sort: { _id: 1 } }
    ]);

    const dailyStats = [];
    const loopDate = new Date(start);
    
    while (loopDate <= end) {
        const dateStr = loopDate.toISOString().slice(0, 10);
        const found = dailyAgg.find(item => item._id === dateStr);
        
        dailyStats.push({
            date: dateStr,
            minted: found ? found.minted : 0,
            burned: found ? found.burned : 0
        });
        
        loopDate.setDate(loopDate.getDate() + 1);
    }

    return {
        currency,
        totalCirculation,
        totalLifetimeMinted,
        flowStats,
        dailyStats
    };
};

const adjustBalance = async (cid, profileId, amount, description) => {
    let gamProfile = await GamificationProfile.findOne({ profile_id: profileId, cid });
    
    if (!gamProfile) {
        gamProfile = new GamificationProfile({ profile_id: profileId, cid });
    }

    gamProfile.walletBalance = (gamProfile.walletBalance || 0) + amount;
    
    const ledgerEntry = new GamificationLedger({
        cid,
        profile_id: profileId,
        amount: amount, 
        xpAmount: 0,
        type: amount >= 0 ? 'ADJUSTMENT' : 'SPEND',
        source: 'ADMIN',
        description: description || 'Manual Balance Adjustment',
        created_at: new Date()
    });

    await Promise.all([gamProfile.save(), ledgerEntry.save()]);
    return gamProfile; 
};

const assignLevel = async (cid, profileId, levelId, reason) => {
    const level = await GamificationLevel.findOne({ _id: levelId, cid });
    if (!level) throw new Error('Level not found');

    let gamProfile = await GamificationProfile.findOne({ profile_id: profileId, cid });
    if (!gamProfile) {
        gamProfile = new GamificationProfile({ profile_id: profileId, cid });
    }

    gamProfile.currentLevel = level._id;

    if (gamProfile.lifetimePoints < level.minPoints) {
        gamProfile.lifetimePoints = level.minPoints;
    }

    const ledgerEntry = new GamificationLedger({
        cid,
        profile_id: profileId,
        amount: 0,
        xpAmount: 0,
        type: 'ADJUSTMENT',
        source: 'ADMIN',
        description: `Level Changed manually: ${reason || 'Admin Override'}`,
        reference_id: level._id
    });

    await Promise.all([gamProfile.save(), ledgerEntry.save()]);
    return gamProfile;
};

const getUserLedger = async (cid, author, page = 1, limit = 5) => {
    let user = await Profile.findOne({ author, cid }).select('_id');
    if (!user) {
        if (author.match(/^[0-9a-fA-F]{24}$/)) {
            user = await Profile.findOne({ _id: author, cid }).select('_id');
        }
    }
    
    if (!user) return { data: [], pagination: { total: 0, page, limit, pages: 0 } };

    const skip = (parseInt(page) - 1) * parseInt(limit);
    const query = { cid, profile_id: user._id };

    const ledger = await GamificationLedger.find(query)
        .sort({ created_at: -1 })
        .skip(skip)
        .limit(parseInt(limit))
        .populate('profile_id', 'username name picture avatar author'); 

    const total = await GamificationLedger.countDocuments(query);

    return {
        data: ledger,
        pagination: { total, page: parseInt(page), limit: parseInt(limit), pages: Math.ceil(total / parseInt(limit)) }
    };
};

const getPublicUserStats = async (cid, memberId) => {
    const cacheKey = `gamification:public:${cid}:${memberId}`;

    try {
        const cached = await cacheService.get(cacheKey);
        if (cached) {
            return cached;
        }
    } catch (err) {
        console.warn('⚠️ Cache read failed for public stats, continuing...', err.message);
    }

    const profile = await Profile.findOne({ author: memberId, cid }).select('_id').lean();

    if (!profile) {
        return null;
    }

    const gamProfile = await GamificationProfile.findOne({ 
        cid, 
        profile_id: profile._id 
    })
    .select('lifetimePoints streaks currentLevel equippedFrame')
    .populate('currentLevel', 'name icon')
    .lean();

    const response = {
        userId: memberId,
        level: {
            icon: gamProfile?.currentLevel?.icon || '⭐',
            name: gamProfile?.currentLevel?.name || 'Novice'
        },
        streak: gamProfile?.streaks?.current || 0,
        lifetimePoints: gamProfile?.lifetimePoints || 0,
        activeFrame: null
    };

    if (gamProfile?.equippedFrame?.assetUrl) {
        response.activeFrame = {
            assetUrl: gamProfile.equippedFrame.assetUrl
        };
    }

    try {
        await cacheService.set(cacheKey, response, 300);
    } catch (err) {
        console.error('⚠️ Failed to cache public stats', err.message);
    }

    return response;
};

module.exports = {
    getUserStatus,
    getPublicUserStats,
    getLeaderboard,
    getEconomyStats,
    adjustBalance,
    assignLevel,
    getUserLedger,
    claimReward
};