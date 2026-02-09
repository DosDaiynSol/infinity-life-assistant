/**
 * Stats Manager - Unified stats service using Supabase
 * Provides backward-compatible API for Instagram and YouTube stats
 */

const instagramDB = require('./instagram-database');
const youtubeDB = require('./youtube-database');

class StatsManager {
    constructor() {
        // In-memory history (for real-time dashboard updates)
        this.instagramHistory = [];
        this.youtubeHistory = [];

        console.log('[Stats Manager] Initialized with Supabase backend');
    }

    // ==========================================
    // Instagram Stats
    // ==========================================

    async trackInstagramDM(senderId) {
        await instagramDB.trackStats('dms', 1);
    }

    async trackInstagramComment(username) {
        await instagramDB.trackStats('comments', 1);
    }

    async trackInstagramResponse(count = 1) {
        await instagramDB.trackStats('responses', count);
    }

    async addInstagramHistory(item) {
        await instagramDB.addHistory(item);
    }

    async getInstagramStats() {
        return instagramDB.getStats();
    }

    async getInstagramHistory() {
        return instagramDB.getHistory();
    }

    // ==========================================
    // YouTube Stats
    // ==========================================

    async trackYouTubeComment(videoId) {
        await youtubeDB.trackComment(videoId, 1);
    }

    async trackYouTubeResponse(videoId, count = 1) {
        await youtubeDB.trackResponse(videoId, count);
    }

    addYouTubeHistory(item) {
        this.youtubeHistory.push(item);
        if (this.youtubeHistory.length > 100) {
            this.youtubeHistory = this.youtubeHistory.slice(-100);
        }
    }

    async getYouTubeStats() {
        return youtubeDB.getStats();
    }

    getYouTubeHistory() {
        return this.youtubeHistory;
    }

    async getYouTubeChartData() {
        return youtubeDB.getChartData();
    }
}

module.exports = new StatsManager();
