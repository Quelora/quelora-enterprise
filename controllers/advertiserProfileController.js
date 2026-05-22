/*
 * Quelora — quelora-enterprise
 * Copyright (C) 2026 Germán Zelaya — https://quelora.org
 * SPDX-License-Identifier: AGPL-3.0-only
 *
 * This file is part of Quelora. See the LICENSE file for terms.
 */

// filepath: packages/quelora-enterprise/controllers/advertiserProfileController.js
const { mongoose } = require('@quelora/common/db');
const AdvertiserProfile = require('../models/AdvertiserProfile');
const fs = require('fs');
const path = require('path');
const { v4: uuidv4 } = require('uuid');
const { getFilterCids, validateCidAccess, validateResourceAccess } = require('../utils/accessControl');

const createController = (publicRoot) => {

    const saveBase64Image = (base64Data, imageType = 'avatar') => {
        try {
            const matches = base64Data.match(/^data:(image\/(png|jpeg|webp));base64,(.+)$/);
            if (!matches || matches.length !== 4) throw new Error('Invalid base64 image data');
            
            const extension = matches[2];
            const data = matches[3];
            const buffer = Buffer.from(data, 'base64');
            const filename = `${imageType}-${uuidv4()}.${extension}`;
            
            const subfolder = imageType === 'avatar' ? 'assets/avatars' : 'assets/backgrounds';

            const root = publicRoot || path.join(__dirname, '..', 'public');
            const imagesDir = path.join(root, subfolder);

            if (!fs.existsSync(imagesDir)) {
                fs.mkdirSync(imagesDir, { recursive: true });
            }
            
            const filePath = path.join(imagesDir, filename);
            fs.writeFileSync(filePath, buffer);
            
            return `/${subfolder}/${filename}`;
        } catch (e) {
            console.error('Error saving base64 image:', e.message);
            throw new Error(`Failed to save ${imageType} image.`);
        }
    };

    return {
        getAdvertiserProfiles: async (req, res, next) => {
            try {
                const { showArchived = 'false', cid } = req.query;
                const userId = req.user._id;
                const userRole = req.user.role;

                let allowedCids;
                try {
                    allowedCids = await getFilterCids(userId, userRole, cid);
                } catch (e) {
                    return res.status(403).json({ success: false, error: e.message });
                }

                const query = { cids: { $in: allowedCids } };
                if (showArchived === 'false') {
                    query.deleted = false;
                }

                const profiles = await AdvertiserProfile.find(query).sort({ name: 1 });
                res.status(200).json({ success: true, data: profiles });
            } catch (error) {
                next(error);
            }
        },

        upsertAdvertiserProfile: async (req, res, next) => {
            try {
                const userId = req.user._id;
                const userRole = req.user.role;
                const { 
                    _id, cids, name, email, avatarUrl, backgroundUrl, 
                    profileLink, twitterProfile, instagramProfile, facebookProfile,
                    softDeleteVisibility = 'visible'
                } = req.body;

                if (!cids || !Array.isArray(cids) || cids.length === 0) {
                    return res.status(400).json({ success: false, error: 'At least one CID is required' });
                }

                try {
                    await validateCidAccess(userId, userRole, cids);
                } catch (e) {
                    return res.status(403).json({ success: false, error: e.message });
                }

                let finalAvatarUrl = avatarUrl;
                if (avatarUrl && avatarUrl.startsWith('data:image/')) {
                    finalAvatarUrl = saveBase64Image(avatarUrl, 'avatar');
                }

                let finalBackgroundUrl = backgroundUrl;
                if (backgroundUrl && backgroundUrl.startsWith('data:image/')) {
                    finalBackgroundUrl = saveBase64Image(backgroundUrl, 'background');
                }

                const payload = { 
                    cids, name, email,
                    avatarUrl: finalAvatarUrl, 
                    backgroundUrl: finalBackgroundUrl,
                    profileLink, twitterProfile, instagramProfile, facebookProfile,
                    softDeleteVisibility
                };

                let profile;
                if (_id) {
                    const existingProfile = await AdvertiserProfile.findById(_id);
                    if (!existingProfile) return res.status(404).json({ success: false, error: 'Profile not found' });

                    try {
                        await validateResourceAccess(existingProfile, userId, userRole);
                    } catch (e) {
                        return res.status(403).json({ success: false, error: 'Access denied' });
                    }

                    profile = await AdvertiserProfile.findByIdAndUpdate(_id, payload, { new: true, runValidators: true });
                } else {
                    profile = await AdvertiserProfile.create(payload);
                }
                
                res.status(201).json({ success: true, data: profile });
            } catch (error) {
                next(error);
            }
        },

        deleteAdvertiserProfile: async (req, res, next) => {
            try {
                const { id } = req.params;
                const userId = req.user._id;
                const userRole = req.user.role;

                if (!mongoose.Types.ObjectId.isValid(id)) return res.status(400).json({ success: false, error: 'Invalid ID' });
                
                const profile = await AdvertiserProfile.findById(id);
                try {
                    await validateResourceAccess(profile, userId, userRole);
                } catch (e) {
                    return res.status(403).json({ success: false, error: 'Access denied' });
                }
                
                const { permanent = 'false' } = req.query;
                if (permanent === 'true') {
                    await AdvertiserProfile.deleteOne({ _id: id });
                } else {
                    profile.deleted = true;
                    profile.softDeleteVisibility = 'archived';
                    await profile.save();
                }

                res.status(200).json({ success: true, message: 'Advertiser Profile deleted' });
            } catch (error) {
                next(error);
            }
        }
    };
};

module.exports = createController;