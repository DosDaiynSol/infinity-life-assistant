// Stats Manager - Persistent stats storage for Instagram and YouTube
const fs = require('fs');
const path = require('path');

const DATA_DIR = path.join(__dirname, '../../data');
const INSTAGRAM_STATS_FILE = path.join(DATA_DIR, 'instagram_stats.json');
const YOUTUBE_STATS_FILE = path.join(DATA_DIR, 'youtube_stats.json');

// Default stats structure
const defaultInstagramStats = {
    totalMessages: 0,
    totalComments: 0,
    responsesSet: 0,
    uniqueDMSenders: [],
    uniqueCommenters: [],
    dailyStats: {},
    createdAt: new Date().toISOString(),
    lastUpdated: null
};

const defaultYouTubeStats = {
    totalComments: 0,
    totalResponses: 0,
    processedVideoIds: [],
    dailyStats: {},
    createdAt: new Date().toISOString(),
    lastUpdated: null
};

class StatsManager {
    constructor() {
        this.instagram = this.loadInstagram();
        this.youtube = this.loadYouTube();

        // In-memory history (too large for persistent storage)
        this.instagramHistory = [];
        this.youtubeHistory = [];

        console.log('[Stats Manager] Loaded stats from files');
        console.log(`  Instagram: ${this.instagram.totalMessages} DMs, ${this.instagram.totalComments} comments, ${this.instagram.responsesSet} responses`);
        console.log(`  YouTube: ${this.youtube.totalComments} comments, ${this.youtube.totalResponses} responses`);
    }

    // ==========================================
    // Instagram Stats
    // ==========================================

    loadInstagram() {
        try {
            if (fs.existsSync(INSTAGRAM_STATS_FILE)) {
                const data = JSON.parse(fs.readFileSync(INSTAGRAM_STATS_FILE, 'utf8'));
                // Convert arrays back to Sets for uniqueness tracking
                data.uniqueDMSendersSet = new Set(data.uniqueDMSenders || []);
                data.uniqueCommentersSet = new Set(data.uniqueCommenters || []);
                return data;
            }
        } catch (error) {
            console.error('[Stats Manager] Error loading Instagram stats:', error.message);
        }
        return { ...defaultInstagramStats, uniqueDMSendersSet: new Set(), uniqueCommentersSet: new Set() };
    }

    saveInstagram() {
        try {
            const toSave = {
                ...this.instagram,
                uniqueDMSenders: [...this.instagram.uniqueDMSendersSet],
                uniqueCommenters: [...this.instagram.uniqueCommentersSet],
                lastUpdated: new Date().toISOString()
            };
            delete toSave.uniqueDMSendersSet;
            delete toSave.uniqueCommentersSet;

            fs.writeFileSync(INSTAGRAM_STATS_FILE, JSON.stringify(toSave, null, 2));
        } catch (error) {
            console.error('[Stats Manager] Error saving Instagram stats:', error.message);
        }
    }

    trackInstagramDM(senderId) {
        this.instagram.totalMessages++;
        this.instagram.uniqueDMSendersSet.add(senderId);
        this.trackInstagramDaily('dms');
        this.saveInstagram();
    }

    trackInstagramComment(username) {
        this.instagram.totalComments++;
        this.instagram.uniqueCommentersSet.add(username);
        this.trackInstagramDaily('comments');
        this.saveInstagram();
    }

    trackInstagramResponse(count = 1) {
        this.instagram.responsesSet += count;
        this.trackInstagramDaily('responses', count);
        this.saveInstagram();
    }

    trackInstagramDaily(type, count = 1) {
        const key = new Date().toISOString().split('T')[0];
        if (!this.instagram.dailyStats[key]) {
            this.instagram.dailyStats[key] = { dms: 0, comments: 0, responses: 0 };
        }
        this.instagram.dailyStats[key][type] += count;
    }

    addInstagramHistory(item) {
        this.instagramHistory.push(item);
        if (this.instagramHistory.length > 100) {
            this.instagramHistory = this.instagramHistory.slice(-100);
        }
    }

    getInstagramStats() {
        return {
            totalMessages: this.instagram.totalMessages,
            totalComments: this.instagram.totalComments,
            responsesSet: this.instagram.responsesSet,
            uniqueDMSenders: this.instagram.uniqueDMSendersSet.size,
            uniqueCommenters: this.instagram.uniqueCommentersSet.size,
            dailyStats: this.instagram.dailyStats,
            lastUpdated: this.instagram.lastUpdated
        };
    }

    getInstagramHistory() {
        return this.instagramHistory;
    }

    // ==========================================
    // YouTube Stats
    // ==========================================

    loadYouTube() {
        try {
            if (fs.existsSync(YOUTUBE_STATS_FILE)) {
                const data = JSON.parse(fs.readFileSync(YOUTUBE_STATS_FILE, 'utf8'));
                data.processedVideoIdsSet = new Set(data.processedVideoIds || []);
                return data;
            }
        } catch (error) {
            console.error('[Stats Manager] Error loading YouTube stats:', error.message);
        }
        return { ...defaultYouTubeStats, processedVideoIdsSet: new Set() };
    }

    saveYouTube() {
        try {
            const toSave = {
                ...this.youtube,
                processedVideoIds: [...this.youtube.processedVideoIdsSet],
                lastUpdated: new Date().toISOString()
            };
            delete toSave.processedVideoIdsSet;

            fs.writeFileSync(YOUTUBE_STATS_FILE, JSON.stringify(toSave, null, 2));
        } catch (error) {
            console.error('[Stats Manager] Error saving YouTube stats:', error.message);
        }
    }

    trackYouTubeComment(videoId) {
        this.youtube.totalComments++;
        this.youtube.processedVideoIdsSet.add(videoId);
        this.trackYouTubeDaily('comments');
        this.saveYouTube();
    }

    trackYouTubeResponse(videoId, count = 1) {
        this.youtube.totalResponses += count;
        if (videoId) {
            this.youtube.processedVideoIdsSet.add(videoId);
        }
        this.trackYouTubeDaily('responses', count);
        this.saveYouTube();
    }

    trackYouTubeDaily(type, count = 1) {
        const key = new Date().toISOString().split('T')[0];
        if (!this.youtube.dailyStats[key]) {
            this.youtube.dailyStats[key] = { comments: 0, responses: 0 };
        }
        this.youtube.dailyStats[key][type] += count;
    }

    addYouTubeHistory(item) {
        this.youtubeHistory.push(item);
        if (this.youtubeHistory.length > 100) {
            this.youtubeHistory = this.youtubeHistory.slice(-100);
        }
    }

    getYouTubeStats() {
        return {
            totalComments: this.youtube.totalComments,
            totalResponses: this.youtube.totalResponses,
            processedVideos: this.youtube.processedVideoIdsSet.size,
            dailyStats: this.youtube.dailyStats,
            lastUpdated: this.youtube.lastUpdated
        };
    }

    getYouTubeHistory() {
        return this.youtubeHistory;
    }
}

module.exports = new StatsManager();
