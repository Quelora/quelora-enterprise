/*
 * Quelora — quelora-enterprise
 * Copyright (C) 2026 Germán Zelaya — https://quelora.org
 * SPDX-License-Identifier: AGPL-3.0-only
 *
 * This file is part of Quelora. See the LICENSE file for terms.
 */

// quelora-enterprise/index.js
/**
 * QUELORA ENTERPRISE
 * Central Export Barrel
 */

module.exports = {
    // ================= GAMIFICATION =================
    
    // Controllers
    gamificationController:          require('./controllers/gamificationController'),
    gamificationDashboardController: require('./controllers/gamificationDashboardController'),
    gamificationStoreController:     require('./controllers/gamificationStoreController'),

    // Services
    gamificationService:             require('./services/gamificationService'),
    gamificationProcessorService:    require('./services/gamificationProcessorService'),
    gamificationStoreService:        require('./services/gamificationStoreService'),
    gamificationPackService:         require('./services/gamificationPackService'),
    
    // Models
    GamificationProfile:       require('./models/GamificationProfile'),
    GamificationLevel:         require('./models/GamificationLevel'),
    GamificationRule:          require('./models/GamificationRule'),
    GamificationLedger:        require('./models/GamificationLedger'),
    GamificationConfig:        require('./models/GamificationConfig'),
    GamificationQuest:         require('./models/GamificationQuest'),
    GamificationQuestProgress: require('./models/GamificationQuestProgress'),
    GamificationShopItem:      require('./models/GamificationShopItem'),
    GamificationInventory:     require('./models/GamificationInventory'),

    // Routes
    gamificationRoutes:          require('./routes/gamificationRoutes'),
    gamificationDashboardRoutes: require('./routes/gamificationDashboardRoutes'),
    gamificationStoreRoutes:     require('./routes/gamificationStoreRoutes'),

    // Utils
    recordGamificationActivity: require('./utils/recordGamificationActivity').recordGamificationActivity,

    // ================= LEGACY MODULES (ADS & SURVEYS) =================
    
    // Survey Controllers
    surveyController:          require('./controllers/surveyController'),
    surveyDashboardController: require('./controllers/surveyDashboardController'),

    // Ads/Survey Models
    AdCampaign:        require('./models/AdCampaign'),
    AdCreative:        require('./models/AdCreative'),
    AdStats:           require('./models/AdDailyStats'),
    AdvertiserProfile: require('./models/AdvertiserProfile'),
    AdClickLog:        require('./models/AdClickLog'),
    Placement:         require('./models/Placement'),
    PlacementPricing:  require('./models/PlacementPricing'),
    Survey:            require('./models/Survey'),
    SurveyResponse:    require('./models/SurveyResponse'),

    // Ads/Survey Services
    adsService:        require('./services/adsService'),
    adCampaignService: require('./services/adCampaignService'),
    adStatsService:    require('./services/adStatsService'),
    surveyService:     require('./services/surveyService'),
    webSocketService:  require('./services/webSocketService'),
    sseService:        require('./services/sseService'),

    // Ads/Survey Routes
    adRoutes:                require('./routes/adRoutes'),
    adCampaignRoutes:        require('./routes/adCampaignRoutes'),
    advertiserProfileRoutes: require('./routes/advertiserProfileRoutes'),
    placementRoutes:         require('./routes/placementRoutes'),
    placementPricingRoutes:  require('./routes/placementPricingRoutes'),
    surveyRoutes:            require('./routes/surveyRoutes'),
    surveyDashboardRoutes:   require('./routes/surveyDashboardRoutes'),
    sseRoutes:               require('./routes/sseRoutes'),
    p2pRoutes:               require('./routes/p2pRoutes'),
    
    // ============================================================
    //  JOB PLUGIN DEFINITION
    // ============================================================
    
    jobs: [
        { 
            key: 'gamification', 
            queueName: 'enterprise-jobs',
            cronExpression: '*/15 * * * * *', 
            enabled: true 
        },
        { 
            key: 'ad-stats', 
            queueName: 'enterprise-jobs',
            cronExpression: '*/5 * * * * *', 
            enabled: true 
        }
    ],

    processors: {
        'gamification': require('./processors/gamificationJobProcessor'),
        'ad-stats': require('./processors/adStatsJobProcessor'),
    },

    resilienceService:               require('./services/resilienceService'),
    resilienceBootstrapMiddleware:   require('./middlewares/resilienceBootstrapMiddleware'),
    captureAnonymousPeerMiddleware:  require('./middlewares/captureAnonymousPeerMiddleware'),
};

console.log('🚀 @quelora/enterprise loaded successfully.');