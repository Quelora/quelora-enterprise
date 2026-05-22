/*
 * Quelora — quelora-enterprise
 * Copyright (C) 2026 Germán Zelaya — https://quelora.org
 * SPDX-License-Identifier: AGPL-3.0-only
 *
 * This file is part of Quelora. See the LICENSE file for terms.
 */

const gamificationService = require('../services/gamificationService');
const { getSessionUserId } = require('@quelora/common/utils/profileUtils');

exports.getMyStatus = async (req, res, next) => {
    try {
        const { user } = req;
        const cid = req.cid;
        const author = user?.author;

        if (!author) {
            return res.status(200).json({ isGuest: true, walletBalance: 0, level: null });
        }

        const profileId = await getSessionUserId(author, cid);
        if (!profileId) return res.status(404).json({ message: 'Profile not found' });

        const status = await gamificationService.getUserStatus(cid, profileId);

        res.status(200).json(status);
    } catch (error) {
        console.error('❌ Error fetching gamification status:', error);
        next(error);
    }
};

exports.getLeaderboard = async (req, res, next) => {
    try {
        const cid = req.cid;
        const { period, limit } = req.query;

        const leaderboard = await gamificationService.getLeaderboard(
            cid, 
            period || 'monthly', 
            parseInt(limit) || 10
        );

        res.status(200).json({ leaderboard });
    } catch (error) {
        console.error('❌ Error fetching leaderboard:', error);
        next(error);
    }
};

exports.claimReward = async (req, res, next) => {
    try {
        const { user } = req;
        const cid = req.cid;
        const author = user?.author;
        const { type, id } = req.body; 

        if (!author) return res.status(401).json({ message: 'Unauthorized' });

        const profileId = await getSessionUserId(author, cid);
        if (!profileId) return res.status(404).json({ message: 'Profile not found' });

        const result = await gamificationService.claimReward(cid, profileId, type, id);
        
        const newState = await gamificationService.getUserStatus(cid, profileId);

        res.status(200).json({
            success: true,
            rewardAmount: result.rewardAmount,
            rewardXp: result.rewardXp,
            newState
        });
    } catch (error) {
        console.error('❌ Error claiming reward:', error);
        res.status(400).json({ success: false, message: error.message });
    }
};

exports.getPublicStats = async (req, res, next) => {
    try {
        const cid = req.cid;
        const { memberId } = req.params;

        if (!memberId) {
            return res.status(400).json({ message: 'Member ID required' });
        }

        const stats = await gamificationService.getPublicUserStats(cid, memberId);

        if (!stats) {
            return res.status(404).json({ message: 'User stats not found' });
        }

        res.status(200).json(stats);
    } catch (error) {
        console.error('❌ Error fetching public stats:', error);
        next(error);
    }
};