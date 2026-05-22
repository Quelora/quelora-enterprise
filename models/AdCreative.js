/*
 * Quelora — quelora-enterprise
 * Copyright (C) 2026 Germán Zelaya — https://quelora.org
 * SPDX-License-Identifier: AGPL-3.0-only
 *
 * This file is part of Quelora. See the LICENSE file for terms.
 */

// ./models/AdCreative.js
const { mongoose } = require('@quelora/common/db');
const AdCampaign = require('./AdCampaign');

const adCreativeSchema = new mongoose.Schema({
    campaignId: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'AdCampaign',
        required: true,
        index: true
    },
    advertiserProfileId: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'AdvertiserProfile',
        default: null
    },
    name: {
        type: String,
        required: [true, 'Creative name is required'],
        trim: true,
        maxlength: 100
    },
    weight: {
        type: Number,
        required: true,
        default: 10,
        min: 1
    },
    creativeType: {
        type: String,
        enum: ['media', 'html', 'native'],
        default: 'media',
        required: true
    },
    title: {
        type: String,
        trim: true,
        maxlength: 100
    },
    nativeText: {
        type: String,
        trim: true,
        maxlength: 500
    },
    media: {
        url: { type: String, trim: true, maxlength: 1024 },
        type: { type: String, enum: ['image', 'video'] },
        dimensions: {
            width: { type: Number },
            height: { type: Number }
        }
    },
    htmlContent: {
        type: String,
        trim: true
    },
    destinationUrl: {
        type: String,
        required: [true, 'Destination URL is required'],
        trim: true,
        maxlength: 1024
    },
    postTargetingMode: {
        type: String,
        enum: ['all', 'specific', 'keywords'],
        default: 'all'
    },
    postKeywords: [{
        type: String,
        trim: true,
        uppercase: true
    }],
    contextualKeywords: [{
        type: String,
        trim: true,
        uppercase: true
    }],
    placementId: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'Placement',
        required: [true, 'Placement is required']
    },
    maxBidCPM: {
        type: Number,
        required: true,
        default: 0.50,
        min: 0
    },
    maxBidCPC: {
        type: Number,
        required: true,
        default: 0.10,
        min: 0
    },
    deviceTargeting: {
        type: String,
        enum: ['all', 'desktop', 'mobile'],
        default: 'all'
    },
    posts: [{
        type: mongoose.Schema.Types.ObjectId,
        ref: 'Post'
    }],
    status: {
        type: String,
        enum: ['active', 'paused'],
        default: 'active'
    },
    impressionsCount: {
        type: Number,
        default: 0
    },
    clicksCount: {
        type: Number,
        default: 0
    },
}, { timestamps: true });

module.exports = mongoose.model('AdCreative', adCreativeSchema);