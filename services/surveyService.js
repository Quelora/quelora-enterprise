/*
 * Quelora — quelora-enterprise
 * Copyright (C) 2026 Germán Zelaya — https://quelora.org
 * SPDX-License-Identifier: AGPL-3.0-only
 *
 * This file is part of Quelora. See the LICENSE file for terms.
 */

const { mongoose } = require('@quelora/common/db');
const Survey = require('../models/Survey');
const SurveyResponse = require('../models/SurveyResponse');
const profileService = require('@quelora/common/services/profileService');
const Post = require('@quelora/common/models/Post');
const { cacheService, cacheClient } = require('@quelora/common/services/cacheService');

const FINGERPRINT_TTL_SECONDS = 30 * 24 * 3600;
const MEMBER_VOTE_TTL_SECONDS = 90 * 24 * 3600;

const getMemberVoteCacheKey = (profileId, surveyId) => `survey:vote:member:${profileId}:${surveyId}`;

function isSurveyActive(surveyDoc) {
    const now = Date.now();
    return surveyDoc.isActive && now >= surveyDoc.startTime.getTime() && now <= surveyDoc.endTime.getTime();
}

function isGeoAllowed(surveyGeoTargeting, geoData) {
    if (!surveyGeoTargeting) return true;
    const countryCode = (geoData.clientCountryCode || geoData.countryCode || geoData.country || '').toString().toUpperCase();
    const region = (geoData.clientRegion || geoData.region || '').toString();
    const city = (geoData.clientCity || geoData.city || '').toString();
    const countries = (surveyGeoTargeting.countries || []).map(c => c.toString().toUpperCase());
    const regions = (surveyGeoTargeting.regions || []).map(r => r.toString());
    const cities = (surveyGeoTargeting.cities || []).map(c => c.toString());
    if (countries.length === 0 && regions.length === 0 && cities.length === 0) return true;
    if (countries.length > 0 && !countries.includes(countryCode)) return false;
    if (regions.length > 0) {
        return regions.some(r => r.toLowerCase() === region?.toLowerCase());
    }
    if (cities.length > 0) {
        return cities.some(c => c.toLowerCase() === city?.toLowerCase());
    }
    return true;
}

async function registerMemberVote(profileDoc, surveyId, optionId) {
    try {
        await SurveyResponse.create({
            surveyId: surveyId,
            profileId: profileDoc._id,
            optionId: optionId,
            votedAt: new Date()
        });
        return true;
    } catch (error) {
        if (error.code === 11000) {
            return false;
        }
        throw error;
    }
}

async function registerAnonymousVote(cid, surveyId, fingerprint, optionId) {
    const redisKey = `survey:vote:fp:${cid}:${surveyId}:${fingerprint}`;
    const setSuccess = await cacheClient.set(
        redisKey,
        optionId.toString(),
        'EX', 
        FINGERPRINT_TTL_SECONDS,
        'NX'
    );
    return setSuccess === 'OK';
}

exports.voteInSurvey = async ({ cid, surveyId, optionId, author = null, fingerprint = null, geoData = {} }) => {
    if (!mongoose.Types.ObjectId.isValid(surveyId) || !mongoose.Types.ObjectId.isValid(optionId)) {
        throw new Error('Invalid Survey or Option ID format.');
    }

    // IMPORTANT: Verify the survey includes the specific CID where the interaction is happening
    // Mongoose finds the doc if 'cid' exists in the 'cids' array
    const surveyDoc = await Survey.findOne({ _id: surveyId, cids: cid });
    
    if (!surveyDoc || surveyDoc.isDeleted) {
        return { status: 'error', message: 'Survey not found or access denied.' };
    }

    const optionExists = surveyDoc.options.some(opt => opt._id.toString() === optionId.toString());
    if (!optionExists) {
        console.error(`Logic Error: optionId [${optionId}] not found in surveyId [${surveyId}]`);
        return { status: 'error', message: 'Invalid vote option for this survey.' };
    }

    if (!isSurveyActive(surveyDoc)) {
        return { status: 'error', message: 'Survey is not currently active.' };
    }
    if (!isGeoAllowed(surveyDoc.geoTargeting, geoData)) {
        return { status: 'error', message: 'Your location is restricted from participating in this survey.' };
    }

    const isMember = !!author;
    let isVoteUnique = false;
    let profileDoc = null;

    if (isMember) {
        try {
            profileDoc = await profileService.getProfile(author, cid);
        } catch (error) {
            return { status: 'error', message: 'Profile not found.' };
        }
        const redisKeyCheck = getMemberVoteCacheKey(profileDoc._id, surveyId);
        const cachedVote = await cacheClient.get(redisKeyCheck);

        if (cachedVote) {
            isVoteUnique = false;
        } else {
            isVoteUnique = await registerMemberVote(profileDoc, surveyId, optionId);
            if (isVoteUnique) {
                await cacheClient.set(redisKeyCheck, "1", 'EX', MEMBER_VOTE_TTL_SECONDS);
            }
        }
    } else {
        if (surveyDoc.requiresAuth) {
            return { status: 'error', message: 'Authentication required to vote in this survey.' };
        }
        if (!fingerprint) {
            return { status: 'error', message: 'Fingerprint required for anonymous voting.' };
        }
        isVoteUnique = await registerAnonymousVote(cid, surveyId, fingerprint, optionId);
    }

    if (!isVoteUnique) {
        return { status: 'info', message: 'You have already voted in this survey.', survey: await exports.getSurveyResults(surveyId) };
    }

    try {
        const updatedSurvey = await Survey.incrementOptionCount(surveyId, optionId);
        if (!updatedSurvey) {
            console.warn(`Increment failed: surveyId [${surveyId}] or optionId [${optionId}] not found.`);
            return { status: 'error', message: 'Invalid vote option.' };
        }

        const responseData = {
            status: 'success',
            message: 'Vote successfully registered.'
        };

        if (updatedSurvey.showResultsAfterVote) {
            responseData.survey = await exports.getSurveyResults(surveyId);
        } else {
            responseData.message = 'Thank you for your vote!';
        }
        return responseData;
    } catch (error) {
        console.error('Error registering vote:', error);
        return { status: 'error', message: 'An error occurred while registering your vote.' };
    }
};

exports.getSurveyResults = async (surveyId) => {
    const surveyDoc = await Survey.findById(surveyId).lean();
    if (!surveyDoc) return null;
    return {
        surveyId: surveyDoc._id,
        question: surveyDoc.question,
        options: surveyDoc.options.map(opt => ({
            optionId: opt._id,
            text: opt.text,
            votesCount: opt.votesCount
        })),
        totalVotes: surveyDoc.options.reduce((sum, opt) => sum + opt.votesCount, 0),
        endTime: surveyDoc.endTime
    };
};

exports.getSurveyByEntity = async (cid, entityId, author, geoData) => {
    const post = await Post.findOne({ entity: entityId, cid: cid }).select('_id').lean();
    if (!post) return null;

    const postId = post._id;
    const now = new Date();

    // Filter: Must match current CID (in cids array), contain the post, and be active
    const query = {
        cids: cid,
        posts: postId,
        startTime: { $lte: now },
        endTime: { $gte: now },
        isActive: true,
        isDeleted: false
    };

    const surveys = await Survey.find(query).sort({ priority: -1 }).lean();
    if (!surveys.length) return null;

    let profileId = null;
    if (author) {
        try {
            const profile = await profileService.getProfile(author, cid);
            profileId = profile?._id;
        } catch (error) {
            profileId = null;
        }
    }

    const geoAllowedSurveys = surveys.filter(s => isGeoAllowed(s.geoTargeting, geoData));
    if (!geoAllowedSurveys.length) return null;

    let votedSurveyIds = new Set();
    if (profileId) {
        const surveyIds = geoAllowedSurveys.map(s => s._id);
        const redisKeys = surveyIds.map(id => getMemberVoteCacheKey(profileId, id));
        const redisVotes = await cacheClient.mGet(redisKeys);
        const surveysToCheckInMongo = [];

        redisVotes.forEach((vote, index) => {
            if (vote === "1") {
                votedSurveyIds.add(surveyIds[index].toString());
            } else {
                surveysToCheckInMongo.push(surveyIds[index]);
            }
        });

        if (surveysToCheckInMongo.length > 0) {
            const mongoVotes = await SurveyResponse.find({
                profileId: profileId,
                surveyId: { $in: surveysToCheckInMongo }
            }).select('surveyId').lean();

            if (mongoVotes.length > 0) {
                const cacheWarmPromises = mongoVotes.map(vote => {
                    votedSurveyIds.add(vote.surveyId.toString());
                    const redisKey = getMemberVoteCacheKey(profileId, vote.surveyId);
                    return cacheClient.set(redisKey, "1", 'EX', MEMBER_VOTE_TTL_SECONDS);
                });
                await Promise.all(cacheWarmPromises);
            }
        }
    }

    let surveyToShow = null;
    let hasVoted = false;

    surveyToShow = geoAllowedSurveys.find(s => !votedSurveyIds.has(s._id.toString()));

    if (surveyToShow) {
        hasVoted = false;
    } else {
        surveyToShow = geoAllowedSurveys[0];
        hasVoted = true;
    }

    if (!surveyToShow) return null;

    await Survey.updateOne({ _id: surveyToShow._id }, { $inc: { viewsCount: 1 } });

    let results = null;
    if (hasVoted || now > surveyToShow.endTime) {
        results = await exports.getSurveyResults(surveyToShow._id);
    }

    return {
        surveyId: surveyToShow._id,
        question: surveyToShow.question,
        requiresAuth: surveyToShow.requiresAuth,
        showResultsAfterVote: surveyToShow.showResultsAfterVote,
        options: surveyToShow.options.map(opt => ({
            optionId: opt._id,
            text: opt.text
        })),
        hasVoted,
        results
    };
};