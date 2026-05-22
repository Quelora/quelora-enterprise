/*
 * Quelora — quelora-enterprise
 * Copyright (C) 2026 Germán Zelaya — https://quelora.org
 * SPDX-License-Identifier: AGPL-3.0-only
 *
 * This file is part of Quelora. See the LICENSE file for terms.
 */

// ./models/SurveyResponse.js
const { mongoose } = require('@quelora/common/db');

const SurveyResponseSchema = new mongoose.Schema({
    surveyId: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'Survey',
        required: true
    },
    profileId: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'Profile',
        default: null
    },
    optionId: {
        type: mongoose.Schema.Types.ObjectId,
        required: true
    },
    votedAt: {
        type: Date,
        default: Date.now
    }
});


SurveyResponseSchema.index({ surveyId: 1, profileId: 1 }, { unique: true, partialFilterExpression: { profileId: { $ne: null } } });

module.exports = mongoose.model('SurveyResponse', SurveyResponseSchema);