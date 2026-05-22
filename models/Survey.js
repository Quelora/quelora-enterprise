/*
 * Quelora — quelora-enterprise
 * Copyright (C) 2026 Germán Zelaya — https://quelora.org
 * SPDX-License-Identifier: AGPL-3.0-only
 *
 * This file is part of Quelora. See the LICENSE file for terms.
 */

const { mongoose } = require('@quelora/common/db');

const GeoTargetingSchema = new mongoose.Schema({
    countries: [{ type: String, maxlength: 2, uppercase: true, default: [] }],
    regions: [{ type: String, maxlength: 50, default: [] }],
    cities: [{ type: String, maxlength: 50, default: [] }]
}, { _id: false });

const SurveyOptionSchema = new mongoose.Schema({
    _id: {
        type: mongoose.Schema.Types.ObjectId,
        default: () => new mongoose.Types.ObjectId()
    },
    text: {
        type: String,
        required: true,
        trim: true,
        maxlength: 255
    },
    votesCount: {
        type: Number,
        default: 0
    }
}, { _id: true });

const SurveySchema = new mongoose.Schema({
    cids: [{
        type: String,
        required: true,
        index: true
    }],
    question: {
        type: String,
        required: true,
        trim: true,
        maxlength: 500
    },
    requiresAuth: {
        type: Boolean,
        default: true
    },
    showResultsAfterVote: {
        type: Boolean,
        default: true
    },
    options: {
        type: [SurveyOptionSchema],
        required: true,
        validate: {
            validator: v => v.length >= 2,
            message: 'A survey must have at least two options.'
        }
    },
    posts: [{
        type: mongoose.Schema.Types.ObjectId,
        ref: 'Post',
        index: true,
        default: []
    }],
    startTime: {
        type: Date,
        default: Date.now
    },
    endTime: {
        type: Date,
        required: true
    },
    geoTargeting: {
        type: GeoTargetingSchema,
        default: {}
    },
    isActive: {
        type: Boolean,
        default: true,
        index: true
    },
    viewsCount: {
        type: Number,
        default: 0
    },
    isDeleted: {
        type: Boolean,
        default: false,
        index: true
    },
    priority: {
        type: Number,
        default: 0,
        index: true
    },
    created_at: {
        type: Date,
        default: Date.now
    },
    updated_at: {
        type: Date,
        default: Date.now
    }
});


SurveySchema.index({ endTime: 1 });
SurveySchema.index({ cids: 1, isDeleted: 1, isActive: 1, priority: -1 });

SurveySchema.statics.decrementOptionCount = async function (surveyId, optionId) {
    return this.findOneAndUpdate(
        { _id: surveyId, 'options._id': optionId },
        { $inc: { 'options.$.votesCount': -1 } },
        { new: true }
    );
};

SurveySchema.statics.incrementOptionCount = async function (surveyId, optionId) {
    return this.findOneAndUpdate(
        { _id: surveyId, 'options._id': optionId },
        { $inc: { 'options.$.votesCount': 1 } },
        { new: true }
    );
};

module.exports = mongoose.model('Survey', SurveySchema);