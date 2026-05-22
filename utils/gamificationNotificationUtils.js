/*
 * Quelora — quelora-enterprise
 * Copyright (C) 2026 Germán Zelaya — https://quelora.org
 * SPDX-License-Identifier: AGPL-3.0-only
 *
 * This file is part of Quelora. See the LICENSE file for terms.
 */

// filepath: quelora-enterprise/utils/gamificationNotificationUtils.js
const path = require('path');
const Profile = require('@quelora/common/models/Profile');
const { addPushJob } = require('@quelora/common/services/pushService');
const { addEmailJob } = require('@quelora/common/services/emailService');
const { logActivity } = require('@quelora/common/services/activityService');
const { getLocalizedMessage } = require('@quelora/common/services/i18nService');

const notificationTemplate = require('@quelora/common/templates/emails/notificationTemplate');

const ENTERPRISE_LOCALE_PATH = path.join(__dirname, '../locale');


const buildGamificationEmailBody = async (title, message, locale, options = {}) => {
    const { actionUrl, actionTextKey } = options;
    
    let actionText = null;
    if (actionTextKey) {
        actionText = await getLocalizedMessage(actionTextKey, locale);
    }

    return notificationTemplate({
        title,
        body: message,
        actionUrl,
        actionText,
        language: locale
    });
};

const dispatchGamificationNotification = async ({ cid, profileId, type, metadata }) => {
    try {
        const profile = await Profile.findOne({ _id: profileId, cid })
            .select('author name username picture email locale settings.notifications pushSubscriptions');

        if (!profile) return;

        const locale = profile.locale || 'en';
        const userPrefs = profile.settings?.notifications || {};
        
        let title, body;

        // Custom Handling for Admin/Manual Messages
        if (type === 'CUSTOM_MESSAGE') {
            title = metadata.title || 'Notification';
            body = metadata.message || '';
        } else {
            const i18nBase = `gamification.notifications.${type}`; 
            
            // MAPEO DE VARIABLES: Agregamos badgeName para que funcione el template
            const i18nData = { 
                name: profile.name,
                levelName: metadata.levelName || '',
                badgeName: metadata.badgeName || 'Unknown Badge',
                days: metadata.days || 0,
                points: metadata.points || 0
            };

            title = await getLocalizedMessage(`${i18nBase}.title`, locale, i18nData, ENTERPRISE_LOCALE_PATH);
            body = await getLocalizedMessage(`${i18nBase}.message`, locale, i18nData, ENTERPRISE_LOCALE_PATH);
        }

        await logActivity({
            cid,
            author: { 
                _id: profile._id, 
                username: profile.username || profile.name, 
                picture: profile.picture, 
                author: profile.author 
            },
            actionType: type === 'CUSTOM_MESSAGE' ? 'admin_notification' : 'achievement', 
            target: {
                id: metadata.referenceId || profileId,
                type: type === 'LEVEL_UP' ? 'level' : 'badge',
                preview: title,
                author: profile.author
            },
            references: { ...metadata, gamificationType: type }
        });

        if (userPrefs.push !== false && profile.pushSubscriptions?.length > 0) {
            await addPushJob(cid, profile.author, title, body, {
                type: 'gamification_event',
                subType: type,
                ...metadata
            });
        }

        if (userPrefs.email !== false && profile.email) {
            const htmlBody = await buildGamificationEmailBody(title, body, locale);
            await addEmailJob(cid, profile.author, title, htmlBody, profile.email, {
                type: 'gamification_reward'
            });
        }

    } catch (error) {
        console.error(`❌ [GamificationNotifier] Error dispatching for ${profileId}:`, error.message);
    }
};

module.exports = { dispatchGamificationNotification };