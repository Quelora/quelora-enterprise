/*
 * Quelora — quelora-enterprise
 * Copyright (C) 2026 Germán Zelaya — https://quelora.org
 * SPDX-License-Identifier: AGPL-3.0-only
 *
 * This file is part of Quelora. See the LICENSE file for terms.
 */

const { mongoose } = require('@quelora/common/db');

const advertiserProfileSchema = new mongoose.Schema({
    cids: [{
        type: String,
        required: true,
        index: true
    }],
    name: {
        type: String,
        required: true,
        trim: true,
        maxlength: 100
    },
    email: {
        type: String,
        trim: true,
        maxlength: 255
    },
    avatarUrl: {
        type: String,
        trim: true,
        maxlength: 1024
    },
    backgroundUrl: {
        type: String,
        trim: true,
        maxlength: 1024,
        default: null
    },
    profileLink: {
        type: String,
        trim: true,
        maxlength: 1024
    },
    twitterProfile: {
        type: String,
        trim: true,
        maxlength: 1024
    },
    instagramProfile: {
        type: String,
        trim: true,
        maxlength: 1024
    },
    facebookProfile: {
        type: String,
        trim: true,
        maxlength: 1024
    },
    deleted: {
        type: Boolean,
        default: false,
        index: true
    },
    softDeleteVisibility: {
        type: String,
        enum: ['visible', 'archived'],
        default: 'visible'
    }
}, { timestamps: true });

module.exports = mongoose.model('AdvertiserProfile', advertiserProfileSchema);