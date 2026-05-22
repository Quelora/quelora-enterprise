/*
 * Quelora — quelora-enterprise
 * Copyright (C) 2026 Germán Zelaya — https://quelora.org
 * SPDX-License-Identifier: AGPL-3.0-only
 *
 * This file is part of Quelora. See the LICENSE file for terms.
 */

// ./controllers/surveyController.js
const surveyService = require('../services/surveyService');
const profileService = require('@quelora/common/services/profileService');
const userEventService = require('@quelora/common/services/userEventService');

exports.registerVote = async (req, res, next) => {
    try {
        const { surveyId, optionId } = req.params;
        const { 'x-survey-fingerprint': fingerprint } = req.headers;
        const cid = req.cid;
        
        const author = req.user?.author || null;
        const isMember = !!author;

        const geoData = req.geoData || {}; 

        if (!isMember && (!fingerprint || typeof fingerprint !== 'string' || fingerprint.length < 10)) {
             return res.status(400).json({ status: 'error', message: 'Authentication token or valid X-Survey-Fingerprint header is required.' });
        }

        const result = await surveyService.voteInSurvey({ 
            cid, 
            surveyId, 
            optionId, 
            author, 
            fingerprint,
            geoData 
        });

        if (result.status === 'ok') {
            let profile = null;
            if (isMember) {
                profile = await profileService.getProfile(author, cid);
            }

            userEventService.onSurveyVoted({
                req,
                surveyId,
                optionId,
                profile
            });
        }

        if (result.status === 'error' || result.status === 'info') {
            return res.status(200).json(result);
        }

        res.status(201).json(result);

    } catch (error) {
        console.error('❌ Error registering survey vote:', error);
        if (error.message.includes('ID format')) {
            return res.status(400).json({ status: 'error', message: error.message });
        }
        next(error);
    }
};

exports.getSurveyByEntity = async (req, res, next) => {
    try {
        const cid = req.cid;
        const author = req.user?.author || null;
        const geoData = req.geoData || {};
        const { entityId } = req.params; 

        if (!entityId) {
            return res.status(400).json({ status: 'error', message: 'entityId parameter is required.' });
        }
        const survey = await surveyService.getSurveyByEntity(cid, entityId, author, geoData);

        res.status(200).json({ status: 'ok', survey: survey });

    } catch (error) {
        console.error('❌ Error fetching survey by entity:', error);
        if (error.message.includes('ID format')) {
            return res.status(400).json({ status: 'error', message: error.message });
        }
        next(error);
    }
};