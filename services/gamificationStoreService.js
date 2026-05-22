/*
 * Quelora — quelora-enterprise
 * Copyright (C) 2026 Germán Zelaya — https://quelora.org
 * SPDX-License-Identifier: AGPL-3.0-only
 *
 * This file is part of Quelora. See the LICENSE file for terms.
 */

/* filepath: packages/quelora-enterprise/services/gamificationStoreService.js */

const { mongoose } = require('@quelora/common/db');
const GamificationShopItem = require('../models/GamificationShopItem');
const GamificationInventory = require('../models/GamificationInventory');
const GamificationProfile = require('../models/GamificationProfile');
const GamificationLedger = require('../models/GamificationLedger');
const GamificationConfig = require('../models/GamificationConfig');
const { cacheService } = require('@quelora/common/services/cacheService');

/**
 * Retrieves currency configuration with caching strategy.
 */
const getCurrencyConfig = async (cid) => {
    try {
        if (!cacheService) return { name: 'Queloros', symbol: '🪙', singularName: 'Queloro' };
        
        const cacheKey = `config:currency:${cid}`;
        const cached = await cacheService.get(cacheKey);
        if (cached) return cached;

        const config = await GamificationConfig.findOne({ cid }).select('currency').lean();
        const currency = config?.currency || { name: 'Queloros', symbol: '🪙', singularName: 'Queloro' };

        await cacheService.set(cacheKey, currency, 3600);
        return currency;
    } catch (error) {
        console.warn('Error fetching currency config', error.message);
        return { name: 'Queloros', symbol: '🪙', singularName: 'Queloro' };
    }
};

const runInTransaction = async (operation) => {
    const session = await mongoose.startSession();
    try {
        session.startTransaction();
        const result = await operation(session);
        await session.commitTransaction();
        return result;
    } catch (error) {
        await session.abortTransaction();
        if (error.message && (
            error.message.includes('Transaction numbers are only allowed') || 
            error.code === 20
        )) {
            console.warn('⚠️ [Gamification] MongoDB Replica Set not detected. Falling back to non-transactional write.');
            return await operation(null);
        }
        throw error;
    } finally {
        session.endSession();
    }
};

const refreshUserCapabilities = async (cid, profileId) => {
    const activeItems = await GamificationInventory.find({ 
        cid, 
        profile_id: profileId, 
        isActive: true 
    }).populate('item_id');

    const capabilities = {};
    
    activeItems.forEach(inv => {
        if(inv.item_id) {
            const effectType = inv.item_id.effectType;
            const meta = inv.item_id.metadata || {};
            const quantity = inv.quantity || 1;

            if (effectType === 'CHAR_LIMIT_INCREASE') {
                const currentVal = capabilities[effectType]?.value || 0;
                const itemValue = parseInt(meta.value || 0, 10);
                capabilities[effectType] = {
                    value: currentVal + (itemValue * quantity)
                };
            } else {
                capabilities[effectType] = Object.keys(meta).length > 0 ? meta : true;
                
                if (effectType === 'PROFILE_FRAME' && meta.shape) {
                    capabilities[effectType].shape = meta.shape;
                }
            }
        }
    });

    try {
        if (cacheService) {
            const cacheKey = `user:capabilities:${cid}:${profileId}`;
            await cacheService.set(cacheKey, capabilities, 86400); 
        }
    } catch (error) {
        console.error('⚠️ [Gamification] Failed to update capability cache:', error.message);
    }
    
    return capabilities;
};

const getShopItems = async (cid, onlyActive = true) => {
    const query = { cid };
    if (onlyActive) query.active = true;
    
    const [items, currency] = await Promise.all([
        GamificationShopItem.find(query).sort({ order: 1, priceCoins: 1 }).lean(),
        getCurrencyConfig(cid)
    ]);

    return { items, currency };
};

const getUserInventory = async (cid, profileId) => {
    return await GamificationInventory.find({ cid, profile_id: profileId })
        .populate('item_id')
        .lean();
};

const buyItem = async (cid, profileId, itemId) => {
    const currency = await getCurrencyConfig(cid);

    const result = await runInTransaction(async (session) => {
        const item = await GamificationShopItem.findOne({ _id: itemId, cid, active: true }).session(session);
        if (!item) throw new Error('Item not found or inactive');

        const profileUpdate = await GamificationProfile.findOneAndUpdate(
            { 
                cid, 
                profile_id: profileId, 
                walletBalance: { $gte: item.priceCoins } 
            },
            { $inc: { walletBalance: -item.priceCoins } },
            { new: true, session }
        );

        if (!profileUpdate) {
            throw new Error('Insufficient funds or profile not found');
        }

        const existingItem = await GamificationInventory.findOne({ 
            cid, profile_id: profileId, item_id: itemId 
        }).session(session);

        const isStackable = item.effectType === 'CHAR_LIMIT_INCREASE' || item.type === 'CONSUMABLE';

        if (item.type === 'PERMANENT' && existingItem && !isStackable) {
            throw new Error('You already own this item');
        }

        if (existingItem && isStackable) {
            existingItem.quantity += 1;
            if (item.effectType === 'CHAR_LIMIT_INCREASE') {
                existingItem.isActive = true;
            }
            await existingItem.save({ session });
        } else {
            await GamificationInventory.create([{
                cid,
                profile_id: profileId,
                item_id: itemId,
                quantity: 1,
                isActive: item.effectType === 'CHAR_LIMIT_INCREASE',
                metadata: item.metadata
            }], { session });
        }

        await GamificationLedger.create([{
            cid,
            profile_id: profileId,
            amount: -item.priceCoins,
            xpAmount: 0,
            type: 'SPEND',
            source: 'SHOP',
            reference_id: itemId,
            description: `Bought: ${item.name}`,
            created_at: new Date()
        }], { session });

        return { success: true, balance: profileUpdate.walletBalance, item, currency };
    });

    await refreshUserCapabilities(cid, profileId);
    return result;
};

const useItem = async (cid, profileId, inventoryId) => {
    const result = await runInTransaction(async (session) => {
        const inventoryItem = await GamificationInventory.findOne({ 
            _id: inventoryId, cid, profile_id: profileId 
        }).populate('item_id').session(session);

        if (!inventoryItem || inventoryItem.quantity < 1) {
            throw new Error('Item not available');
        }

        const shopItem = inventoryItem.item_id;
        if (shopItem.type !== 'CONSUMABLE') {
            throw new Error('This item is not consumable');
        }

        inventoryItem.quantity -= 1;
        
        if (inventoryItem.quantity === 0) {
             await GamificationInventory.deleteOne({ _id: inventoryId }).session(session);
        } else {
            await inventoryItem.save({ session });
        }

        if (shopItem.effectType === 'STREAK_FREEZE') {
            await GamificationProfile.updateOne(
                { cid, profile_id: profileId },
                { $inc: { "streaks.freezeInventory": 1 } }
            ).session(session);
        }
        
        return { success: true, remaining: inventoryItem.quantity, effect: shopItem.effectType };
    });

    await refreshUserCapabilities(cid, profileId);
    return result;
};

const equipItem = async (cid, profileId, inventoryId) => {
    const result = await runInTransaction(async (session) => {
        const targetInvItem = await GamificationInventory.findOne({ _id: inventoryId, cid, profile_id: profileId })
            .populate('item_id')
            .session(session);

        if (!targetInvItem) throw new Error('Item not found in inventory');
        if (targetInvItem.item_id.type === 'CONSUMABLE') throw new Error('Cannot equip a consumable item');

        const targetEffect = targetInvItem.item_id.effectType;

        const activeItems = await GamificationInventory.find({
            cid,
            profile_id: profileId,
            isActive: true,
            _id: { $ne: inventoryId }
        }).populate('item_id').session(session);

        for (const inv of activeItems) {
            if (inv.item_id && inv.item_id.effectType === targetEffect) {
                inv.isActive = false;
                await inv.save({ session });
            }
        }

        targetInvItem.isActive = true;
        await targetInvItem.save({ session });

        if (targetEffect === 'PROFILE_FRAME') {
            await GamificationProfile.updateOne(
                { cid, profile_id: profileId },
                { 
                    $set: { 
                        equippedFrame: {
                            assetUrl: targetInvItem.item_id.metadata?.assetUrl,
                            shape: targetInvItem.item_id.metadata?.shape
                        }
                    }
                }
            ).session(session);
        }

        return { success: true, equipped: targetInvItem };
    });

    await refreshUserCapabilities(cid, profileId);
    return result;
};

const unequipItem = async (cid, profileId, inventoryId) => {
    const result = await runInTransaction(async (session) => {
        const targetInvItem = await GamificationInventory.findOne({ _id: inventoryId, cid, profile_id: profileId })
            .populate('item_id')
            .session(session);

        if (!targetInvItem) throw new Error('Item not found in inventory');
        targetInvItem.isActive = false;
        await targetInvItem.save({ session });

        if (targetInvItem.item_id.effectType === 'PROFILE_FRAME') {
            await GamificationProfile.updateOne(
                { cid, profile_id: profileId },
                { $unset: { equippedFrame: "" } }
            ).session(session);
        }

        return { success: true, unequipped: targetInvItem };
    });
    await refreshUserCapabilities(cid, profileId);
    return result;
};

const getActiveEffects = async (cid, profileId) => {
    return await refreshUserCapabilities(cid, profileId);
};

module.exports = {
    getShopItems,
    getUserInventory,
    buyItem,
    useItem,
    equipItem,
    unequipItem,
    getActiveEffects,
    refreshUserCapabilities
};