/*
 * Quelora — quelora-enterprise
 * Copyright (C) 2026 Germán Zelaya — https://quelora.org
 * SPDX-License-Identifier: AGPL-3.0-only
 *
 * This file is part of Quelora. See the LICENSE file for terms.
 */

const { mongoose } = require('@quelora/common/db');
const Survey = require('../models/Survey');
const { getFilterCids, validateCidAccess, validateResourceAccess } = require('../utils/accessControl');

exports.getSurveys = async (req, res, next) => {
    try {
        const { page = 1, limit = 10, cid, sort = 'created_at', order = 'desc', search, active } = req.query;
        const userId = req.user._id;
        const userRole = req.user.role;

        let allowedCids;
        try {
            allowedCids = await getFilterCids(userId, userRole, cid);
        } catch (e) {
            return res.status(403).json({ success: false, error: e.message });
        }

        const query = {
            cids: { $in: allowedCids },
            isDeleted: false
        };

        if (search) query.question = { $regex: search, $options: 'i' };
        if (active !== undefined) query.isActive = active === 'true';

        const pageNumber = +page;
        const limitNumber = +limit;
        const skip = (pageNumber - 1) * limitNumber;
        const sortOptions = { [sort]: order === 'asc' ? 1 : -1, _id: -1 };

        const pipeline = [
            { $match: query },
            { $addFields: { totalVotes: { $sum: "$options.votesCount" } } },
            { $sort: sortOptions }
        ];

        const [results, countResult] = await Promise.all([
            Survey.aggregate([...pipeline, { $skip: skip }, { $limit: limitNumber }]),
            Survey.aggregate([...pipeline, { $count: "totalItems" }])
        ]);

        res.status(200).json({
            success: true,
            data: {
                surveys: results,
                pagination: {
                    totalItems: countResult[0]?.totalItems || 0,
                    totalPages: Math.ceil((countResult[0]?.totalItems || 0) / limitNumber),
                    currentPage: pageNumber,
                    itemsPerPage: limitNumber
                }
            }
        });
    } catch (error) {
        console.error('Error fetching surveys:', error);
        next(error);
    }
};

exports.getSurvey = async (req, res, next) => {
    try {
        const { surveyId } = req.params;
        const userId = req.user._id;
        const userRole = req.user.role;

        if (!mongoose.Types.ObjectId.isValid(surveyId)) return res.status(400).json({ success: false, error: 'Invalid ID' });

        let allowedCids;
        try {
            allowedCids = await getFilterCids(userId, userRole, null);
        } catch (e) {
            return res.status(403).json({ success: false, error: e.message });
        }

        const survey = await Survey.findOne({
            _id: surveyId,
            isDeleted: false,
            cids: { $in: allowedCids }
        }).populate('posts', '_id title reference entity').lean();

        if (!survey) return res.status(404).json({ success: false, error: 'Not found' });

        if (survey.posts) survey.posts = survey.posts.map(p => ({ _id: p._id.toString(), entity: p.entity.toString(), title: p.title || p.reference }));
        
        res.status(200).json({ success: true, data: survey });
    } catch (error) {
        next(error);
    }
};

exports.upsertSurvey = async (req, res, next) => {
    try {
        const { _id, ...surveyData } = req.body;
        const userId = req.user._id;
        const userRole = req.user.role;
        
        let targetCids = surveyData.cids || [];
        if (!targetCids.length && surveyData.cid) {
            targetCids = [surveyData.cid];
        }

        if (!targetCids || !Array.isArray(targetCids) || targetCids.length === 0) {
            return res.status(400).json({ success: false, error: 'At least one CID is required' });
        }

        try {
            await validateCidAccess(userId, userRole, targetCids);
        } catch (e) {
            return res.status(403).json({ success: false, error: e.message });
        }

        surveyData.cids = targetCids;
        delete surveyData.cid;

        let savedSurvey, message;

        if (_id) {
            surveyData.updated_at = new Date();
            
            const existingSurvey = await Survey.findById(_id).select('cids');
            
            try {
                await validateResourceAccess(existingSurvey, userId, userRole);
            } catch (e) {
                return res.status(404).json({ success: false, error: 'Not found or access denied' });
            }
            
            savedSurvey = await Survey.findOneAndUpdate(
                { _id: _id },
                { $set: surveyData },
                { new: true, runValidators: true }
            );
            
            if (!savedSurvey) return res.status(404).json({ success: false, error: 'Not found or access denied after update attempt' });
            message = 'Survey updated';

        } else {
            savedSurvey = await new Survey(surveyData).save();
            message = 'Survey created';
        }
        res.status(200).json({ success: true, message, data: savedSurvey });
    } catch (error) {
        console.error('Error in upsertSurvey:', error);
        next(error);
    }
};

exports.deleteSurvey = async (req, res, next) => {
    try {
        const { surveyId } = req.params;
        const userId = req.user._id;
        const userRole = req.user.role;

        const survey = await Survey.findById(surveyId);
        
        try {
            await validateResourceAccess(survey, userId, userRole);
        } catch (e) {
            return res.status(404).json({ success: false, error: 'Not found or access denied' });
        }
        
        survey.isDeleted = true;
        survey.isActive = false;
        await survey.save();

        res.status(200).json({ success: true, message: 'Survey deleted' });
    } catch (error) {
        next(error);
    }
};