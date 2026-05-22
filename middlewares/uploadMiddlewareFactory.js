/*
 * Quelora — quelora-enterprise
 * Copyright (C) 2026 Germán Zelaya — https://quelora.org
 * SPDX-License-Identifier: AGPL-3.0-only
 *
 * This file is part of Quelora. See the LICENSE file for terms.
 */

/**
 * @fileoverview Factory for generating Multer upload middlewares with dynamic configurations.
 * Allows overriding default file size limits and allowed MIME types per route instantiation.
 */

const multer = require('multer');
const path = require('path');
const fs = require('fs');

/**
 * Creates a customized Multer middleware instance for handling file uploads.
 *
 * @param {string} publicPath - The absolute root public directory path.
 * @param {string} subPath - The relative subdirectory path where files will be stored.
 * @param {Object} [options={}] - Configuration options for the upload instance.
 * @param {number} [options.fileSizeLimit=26214400] - Maximum file size in bytes. Defaults to 25MB.
 * @param {Array<string>|Function} [options.allowedMimeTypes] - Array of allowed mime types or a custom filter function.
 * @returns {import('multer').Multer} The configured Multer instance.
 */
module.exports = (publicPath, subPath, options = {}) => {
    const uploadDir = path.join(publicPath, subPath);

    if (!fs.existsSync(uploadDir)) {
        fs.mkdirSync(uploadDir, { recursive: true });
    }

    const storage = multer.diskStorage({
        destination: function (req, file, cb) {
            cb(null, uploadDir);
        },
        filename: function (req, file, cb) {
            const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1E9);
            // Prefixing with fieldname for easier identification
            cb(null, file.fieldname + '-' + uniqueSuffix + path.extname(file.originalname));
        }
    });

    const fileFilter = (req, file, cb) => {
        // 1. Check if a specific array of allowed mimes was provided (e.g., for .gpack)
        if (Array.isArray(options.allowedMimeTypes)) {
            const isAllowed = options.allowedMimeTypes.some(mime => 
                file.mimetype.startsWith(mime) || file.mimetype === mime
            );
            
            if (isAllowed) {
                return cb(null, true);
            }
            return cb(new Error(`File type not allowed. Received: ${file.mimetype}`), false);
        } 
        
        // 2. Check if a custom filter function was provided
        if (typeof options.allowedMimeTypes === 'function') {
            return options.allowedMimeTypes(req, file, cb);
        }

        // 3. Fallback to default legacy behavior if no specific rule was set
        if (file.mimetype.startsWith('image/') || file.mimetype.startsWith('video/')) {
            cb(null, true);
        } else {
            cb(new Error('Only images and videos are allowed by default'), false);
        }
    };

    const sizeLimit = options.fileSizeLimit || (25 * 1024 * 1024);

    return multer({
        storage: storage,
        fileFilter: fileFilter,
        limits: { fileSize: sizeLimit }
    });
};