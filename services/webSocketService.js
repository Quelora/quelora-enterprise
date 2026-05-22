/*
 * Quelora — quelora-enterprise
 * Copyright (C) 2026 Germán Zelaya — https://quelora.org
 * SPDX-License-Identifier: AGPL-3.0-only
 *
 * This file is part of Quelora. See the LICENSE file for terms.
 */

const { WebSocketServer } = require('ws');
const { mongoose } = require('@quelora/common/db');
const { validateToken } = require('@quelora/common/services/authService');
const Profile = require('@quelora/common/models/Profile');
const Comment = require('@quelora/common/models/Comment');
const Post = require('@quelora/common/models/Post');
const formatComment = require('@quelora/common/utils/formatComment');
const { cacheService } = require('@quelora/common/services/cacheService');
const { processCommentLogic } = require('@quelora/common/services/commentProcessingService');

const entitySubscriptions = new Map();
const typingUsers = new Map();

const LIVE_FULL_MESSAGE = {
    action: 'ERROR',
    code: 'LIVE_FULL',
    message: 'The live chat has reached its maximum capacity. Please try again later.'
};

const LIVE_NOT_STARTED_MESSAGE = {
    action: 'ERROR',
    code: 'NOT_STARTED',
    message: 'The live stream has not started yet.'
};

const LIVE_MODE_INACTIVE_MESSAGE = {
    action: 'ERROR',
    code: 'LIVE_INACTIVE',
    message: 'The live chat feature is not active for this post.'
};

const SUBSCRIPTION_REJECTED_MESSAGE = {
    action: 'ERROR',
    code: 'SUBSCRIPTION_REJECTED',
    message: 'Subscription rejected: Live session is full or inactive.'
};

const authenticateSocket = (token, clientIp) => {
    try {
        if (!token || token === 'anonymous') return null;
        return validateToken(token, clientIp);
    } catch (error) {
        return null;
    }
};

const broadcastToEntity = (entityId, message) => {
    const clients = entitySubscriptions.get(entityId);
    if (!clients) return;

    const stringMessage = JSON.stringify(message);

    clients.forEach((user, ws) => {
        if (ws.readyState === ws.OPEN) {
            ws.send(stringMessage);
        }
    });
};

const broadcastLiveStats = (entityId) => {
    const clients = entitySubscriptions.get(entityId) || new Map();
    const typersMap = typingUsers.get(entityId) || new Map();

    broadcastToEntity(entityId, {
        action: 'LIVE_STATS',
        entityId: entityId,
        watchers: clients.size,
        typingUsers: Array.from(typersMap.values())
    });
};

const initializeWebSocketServer = (server) => {
    const wss = new WebSocketServer({ server, path: '/ws/live' });

    const cleanupSubscription = (ws, entityId) => {
        if (!entityId) return;

        const clients = entitySubscriptions.get(entityId);
        if (clients) {
            clients.delete(ws);
            if (clients.size === 0) {
                entitySubscriptions.delete(entityId);
            }
        }

        if (ws.isAuthenticated && ws.user) {
            const typers = typingUsers.get(entityId);
            if (typers) {
                typers.delete(ws.user.author);
            }
        }

        broadcastLiveStats(entityId);
    };

    const checkAndBroadcastLiveEnd = async () => {
        for (const entityId of Array.from(entitySubscriptions.keys())) {
            const clients = entitySubscriptions.get(entityId);
            if (!clients || clients.size === 0) continue;

            try {
                const post = await Post.findOne({ entity: entityId, 'deletion.status': 'active' }).select('config.liveMode');
                const isLiveActive = post?.config?.liveMode?.isLiveActive;
                const endTime = post?.config?.liveMode?.endTime ? new Date(post.config.liveMode.endTime).getTime() : null;
                const liveEnded = !isLiveActive || (endTime && Date.now() >= endTime);

                if (liveEnded) {
                    broadcastToEntity(entityId, {
                        action: 'LIVE_END',
                        entityId: entityId,
                        message: 'The live chat session has concluded.'
                    });

                    clients.forEach((user, ws) => {
                        ws.terminate();
                    });
                }

            } catch (error) {
                console.error(`Error checking live end for ${entityId}:`, error.message);
            }
        }
    };

    wss.on('connection', (ws, req) => {
        ws.isAlive = true;
        ws.isAuthenticated = false;
        ws.user = null;
        ws.entityId = null;
        ws.cid = null;
        ws.clientIp = req.socket.remoteAddress;

        ws.on('pong', () => { ws.isAlive = true; });

        ws.on('message', async (message) => {
            try {
                const data = JSON.parse(message.toString());
                const { action, entityId, auth, cid, geoData, text, isTyping } = data;

                if (action === 'SUBSCRIBE') {
                    const oldEntityId = ws.entityId;
                    const newEntityId = entityId;

                    if (oldEntityId && oldEntityId !== newEntityId) {
                        cleanupSubscription(ws, oldEntityId);
                    }

                    const post = await Post.findOne({ entity: newEntityId, 'deletion.status': 'active' }).select('config.liveMode');
                    const maxClients = post?.config?.liveMode?.maxClients || 300;
                    const currentClients = entitySubscriptions.get(newEntityId)?.size || 0;

                    if (currentClients >= maxClients) {
                        ws.send(JSON.stringify(SUBSCRIPTION_REJECTED_MESSAGE));
                        ws.terminate();
                        return;
                    }

                    ws.entityId = newEntityId;
                    ws.user = authenticateSocket(auth, ws.clientIp);
                    ws.isAuthenticated = !!ws.user;
                    ws.cid = cid;

                    if (!entitySubscriptions.has(entityId)) {
                        entitySubscriptions.set(entityId, new Map());
                    }

                    entitySubscriptions.get(entityId).set(ws, ws.user);

                    ws.send(JSON.stringify({ action: 'AUTH_SUCCESS', entityId }));
                    broadcastLiveStats(entityId);
                    return;
                }

                if (!ws.isAuthenticated || !ws.user) {
                    return ws.send(JSON.stringify({ error: 'Authentication required' }));
                }

                const author = ws.user.author;
                const authorProfile = await Profile.ensureProfileExists(ws.user, ws.cid, geoData);

                if (!authorProfile) {
                    throw new Error('Failed to ensure profile exists for authenticated user');
                }

                switch (action) {
                    case 'NEW_MESSAGE':
                        const post = await Post.findOne({ entity: entityId, cid: ws.cid, 'deletion.status': 'active' });
                        if (!post) throw new Error('Post not found');

                        if (!post.config?.liveMode?.isLiveActive) {
                            return ws.send(JSON.stringify(LIVE_MODE_INACTIVE_MESSAGE));
                        }

                        const startTime = new Date(post.config.liveMode.startTime).getTime();
                        if (Date.now() < startTime) {
                            return ws.send(JSON.stringify(LIVE_NOT_STARTED_MESSAGE));
                        }

                        const commentCount = await Comment.countDocuments({ post: post._id, isLive: true });
                        if (commentCount >= 300) {
                             throw new Error('Live chat message limit reached.');
                        }

                        const { text: processedText, defaultLanguage } = await processCommentLogic({
                            author: ws.user.author,
                            locale: ws.user.locale || 'es',
                            cid: ws.cid,
                            text: text,
                            entity: entityId,
                            isReply: false,
                            clientConfig: {}
                        });

                        const newComment = new Comment({
                            _id: new mongoose.Types.ObjectId(),
                            entity: entityId,
                            post: post._id,
                            profile_id: authorProfile._id,
                            author: author,
                            text: processedText,
                            language: defaultLanguage,
                            created_at: new Date(),
                            updated_at: new Date(),
                            visible: true,
                            isLive: true,
                            hasAudio: false
                        });

                        await newComment.save();
                        await Post.incrementComment(post._id);

                        const profileMap = { [author]: authorProfile };
                        const formattedComment = formatComment(newComment.toObject(), profileMap[author], author);

                        broadcastToEntity(entityId, {
                            action: 'NEW_MESSAGE',
                            comment: formattedComment
                        });

                        cacheService.deleteByPattern(`cid:${ws.cid}:thread:${entityId}:*`);
                        break;

                    case 'TYPING':
                        if (!typingUsers.has(entityId)) {
                            typingUsers.set(entityId, new Map());
                        }
                        const typers = typingUsers.get(entityId);

                        if (isTyping) {
                            typers.set(author, { name: authorProfile.name });
                        } else {
                            typers.delete(author);
                        }
                        broadcastLiveStats(entityId);
                        break;
                }

            } catch (error) {
                ws.send(JSON.stringify({ error: error.message }));
            }
        });

        ws.on('close', () => {
            cleanupSubscription(ws, ws.entityId);
        });
    });

    const healthInterval = setInterval(() => {
        wss.clients.forEach(ws => {
            if (!ws.isAlive) return ws.terminate();
            ws.isAlive = false;
            ws.ping();
        });
    }, 30000);

    const liveEndInterval = setInterval(() => {
        if (entitySubscriptions.size > 0) {
            checkAndBroadcastLiveEnd();
        }
    }, 5000);

    wss.on('close', () => {
        clearInterval(healthInterval);
        clearInterval(liveEndInterval);
    });
};

module.exports = initializeWebSocketServer;