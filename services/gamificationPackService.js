/*
 * Quelora — quelora-enterprise
 * Copyright (C) 2026 Germán Zelaya — https://quelora.org
 * SPDX-License-Identifier: AGPL-3.0-only
 *
 * This file is part of Quelora. See the LICENSE file for terms.
 */

/**
 * @fileoverview Gamification Pack Service.
 * Handles the secure extraction, validation, and processing of .gpack archives.
 */

const fs = require('fs').promises;
const path = require('path');
const os = require('os');
const crypto = require('crypto');
const tar = require('tar');
const GamificationShopItem = require('../models/GamificationShopItem');

/**
 * Processes a .gpack archive safely, extracting assets, applying cryptographic
 * file renaming, and upserting the shop items to the database.
 *
 * @param {string} cid - The client identifier.
 * @param {string} packPath - Absolute path to the uploaded .gpack file.
 * @param {string} destination - Base destination directory for the client's assets.
 * @returns {Promise<Object>} An object containing the summary and errors.
 * @throws {Error} If the archive extraction or manifest parsing fails fatally.
 */
exports.processPack = async (cid, packPath, destination) => {
    const summary = { total: 0, inserted: 0, updated: 0, failed: 0 };
    const errors = [];
    let tmpDir = null;

    try {
        // 1. Create a secure temporary directory
        tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'gpack-'));

        // 2. Extract tarball securely to the temporary directory
        await tar.x({
            file: packPath,
            cwd: tmpDir
        });

        // 3. Locate and parse manifest.json
        const manifestPath = path.join(tmpDir, 'manifest.json');
        const manifestData = await fs.readFile(manifestPath, 'utf8');
        
        let manifest;
        try {
            manifest = JSON.parse(manifestData);
        } catch (err) {
            throw new Error('Invalid manifest.json format: ' + err.message);
        }

        if (!manifest.items || !Array.isArray(manifest.items)) {
            throw new Error('Manifest is missing the "items" array.');
        }

        // Ensure destination directory for this client exists
        const cidDir = path.join(destination, cid);
        await fs.mkdir(cidDir, { recursive: true });

        // 4. Process each item with strict validation and cryptographic renaming
        for (const item of manifest.items) {
            summary.total++;
            try {
                if (!item.name || !item.assetFile || !item.thumbFile) {
                    throw new Error('Missing required fields: name, assetFile, or thumbFile');
                }

                // Strict Zip Slip mitigation
                const assetsDir = path.resolve(tmpDir, 'assets');
                const assetSrc = path.resolve(assetsDir, item.assetFile);
                const thumbSrc = path.resolve(assetsDir, item.thumbFile);

                if (!assetSrc.startsWith(assetsDir) || !thumbSrc.startsWith(assetsDir)) {
                    throw new Error('Path traversal violation detected in asset paths.');
                }

                // Verify files actually exist in the extracted structure
                try {
                    await fs.access(assetSrc);
                    await fs.access(thumbSrc);
                } catch (err) {
                    throw new Error('Referenced asset or thumbnail file not found in the archive.');
                }

                // Cryptographic renaming
                const assetExt = path.extname(item.assetFile);
                const thumbExt = path.extname(item.thumbFile);
                const assetRandomName = crypto.randomBytes(16).toString('hex') + assetExt;
                const thumbRandomName = crypto.randomBytes(16).toString('hex') + thumbExt;

                const assetDest = path.join(cidDir, assetRandomName);
                const thumbDest = path.join(cidDir, thumbRandomName);

                // Move files to public serving directory
                await fs.copyFile(assetSrc, assetDest);
                await fs.copyFile(thumbSrc, thumbDest);

                // Data Mapping (UX/Data Mismatch resolution)
                const metadata = item.metadata || {};
                metadata.assetUrl = `/assets/gamification/${cid}/${assetRandomName}`;
                metadata.thumbnailUrl = `/assets/gamification/${cid}/${thumbRandomName}`;

                const updatePayload = {
                    description: item.description,
                    category: item.category,
                    effectType: item.effectType,
                    priceCoins: item.priceCoins,
                    type: item.type,
                    active: item.active !== false,
                    order: item.order || 0,
                    metadata
                };

                // Upsert into Database using compound index
                const dbResult = await GamificationShopItem.updateOne(
                    { cid, name: item.name },
                    { $set: updatePayload },
                    { upsert: true }
                );

                if (dbResult.upsertedCount > 0) {
                    summary.inserted++;
                } else {
                    summary.updated++;
                }

            } catch (itemError) {
                summary.failed++;
                errors.push({ name: item.name || 'Unknown', error: itemError.message });
            }
        }

        return { success: true, summary, errors };

    } catch (error) {
        throw new Error(`Pack processing failed: ${error.message}`);
    } finally {
        // 5. Cleanup temporary and uploaded files
        if (tmpDir) {
            try {
                await fs.rm(tmpDir, { recursive: true, force: true });
            } catch (err) {
                console.error('[gamificationPackService] Temp cleanup failed:', err);
            }
        }
        if (packPath) {
            try {
                await fs.unlink(packPath);
            } catch (err) {
                console.error('[gamificationPackService] Uploaded file cleanup failed:', err);
            }
        }
    }
};