/**
 * YouTube Database Service
 * Supabase client with caching for YouTube data
 */

const { createClient } = require('@supabase/supabase-js');
const NodeCache = require('node-cache');

// Cache configuration: 5 minute TTL
const cache = new NodeCache({
    stdTTL: 300,
    checkperiod: 60,
    useClones: false
});

class YouTubeDatabase {
    constructor() {
        if (!process.env.SUPABASE_URL || !process.env.SUPABASE_SERVICE_KEY) {
            console.error('[YouTube DB] Missing Supabase credentials');
            this.supabase = null;
            return;
        }

        try {
            this.supabase = createClient(
                process.env.SUPABASE_URL,
                process.env.SUPABASE_SERVICE_KEY,
                { auth: { persistSession: false } }
            );
            console.log('[YouTube DB] Connected to Supabase');
        } catch (error) {
            console.error('[YouTube DB] Init error:', error.message);
            this.supabase = null;
        }
    }

    isConnected() {
        return this.supabase !== null;
    }

    // ==========================================
    // Video Tracking
    // ==========================================

    /**
     * Check if video has been processed
     */
    async isVideoProcessed(videoId) {
        if (!this.isConnected()) return false;

        const cacheKey = `video:${videoId}`;
        let processed = cache.get(cacheKey);

        if (processed === undefined) {
            const { data } = await this.supabase
                .from('youtube_processed_videos')
                .select('id')
                .eq('video_id', videoId)
                .single();

            processed = !!data;
            cache.set(cacheKey, processed);
        }

        return processed;
    }

    /**
     * Mark video as processed
     */
    async markVideoProcessed(videoId) {
        if (!this.isConnected()) return;

        const exists = await this.isVideoProcessed(videoId);
        if (!exists) {
            await this.supabase
                .from('youtube_processed_videos')
                .insert({ video_id: videoId });

            cache.set(`video:${videoId}`, true);
        }
    }

    /**
     * Get all processed video IDs (cached)
     */
    async getProcessedVideoIds() {
        if (!this.isConnected()) return [];

        const cacheKey = 'processed_videos';
        let videoIds = cache.get(cacheKey);

        if (!videoIds) {
            const { data } = await this.supabase
                .from('youtube_processed_videos')
                .select('video_id');

            videoIds = data?.map(v => v.video_id) || [];
            cache.set(cacheKey, videoIds, 60);
        }

        return videoIds;
    }

    // ==========================================
    // Statistics
    // ==========================================

    /**
     * Track comment
     */
    async trackComment(videoId, count = 1) {
        if (!this.isConnected()) return;

        // Mark video as processed
        await this.markVideoProcessed(videoId);

        // Update daily stats
        await this._updateDailyStats('comments', count);

        // Update total stats
        await this._updateTotalStats('total_comments', count);

        cache.del('youtube_stats');
    }

    /**
     * Track response sent
     */
    async trackResponse(videoId, count = 1) {
        if (!this.isConnected()) return;

        if (videoId) {
            await this.markVideoProcessed(videoId);
        }

        await this._updateDailyStats('responses', count);
        await this._updateTotalStats('total_responses', count);

        cache.del('youtube_stats');
    }

    /**
     * Update daily stats
     */
    async _updateDailyStats(type, count) {
        const today = new Date().toISOString().split('T')[0];

        const { data: existing } = await this.supabase
            .from('youtube_daily_stats')
            .select('*')
            .eq('date', today)
            .single();

        if (existing) {
            const updates = { updated_at: new Date().toISOString() };
            updates[type] = (existing[type] || 0) + count;

            await this.supabase
                .from('youtube_daily_stats')
                .update(updates)
                .eq('date', today);
        } else {
            const newStats = { date: today, comments: 0, responses: 0 };
            newStats[type] = count;

            await this.supabase
                .from('youtube_daily_stats')
                .insert(newStats);
        }
    }

    /**
     * Update total stats
     */
    async _updateTotalStats(field, count) {
        const { data: existing } = await this.supabase
            .from('youtube_stats')
            .select('*')
            .limit(1)
            .single();

        if (existing) {
            const updates = { updated_at: new Date().toISOString() };
            updates[field] = (existing[field] || 0) + count;

            await this.supabase
                .from('youtube_stats')
                .update(updates)
                .eq('id', existing.id);
        } else {
            const newStats = { total_comments: 0, total_responses: 0 };
            newStats[field] = count;

            await this.supabase
                .from('youtube_stats')
                .insert(newStats);
        }
    }

    /**
     * Get aggregated stats (cached)
     */
    async getStats() {
        if (!this.isConnected()) {
            return {
                totalComments: 0,
                totalResponses: 0,
                processedVideos: 0,
                dailyStats: {}
            };
        }

        const cacheKey = 'youtube_stats';
        let stats = cache.get(cacheKey);

        if (!stats) {
            // Get totals
            const { data: totals } = await this.supabase
                .from('youtube_stats')
                .select('total_comments, total_responses')
                .limit(1)
                .single();

            // Get processed videos count
            const { count: videoCount } = await this.supabase
                .from('youtube_processed_videos')
                .select('*', { count: 'exact', head: true });

            // Get daily stats
            const { data: dailyData } = await this.supabase
                .from('youtube_daily_stats')
                .select('date, comments, responses')
                .order('date', { ascending: false })
                .limit(30);

            const dailyStats = {};
            dailyData?.forEach(d => {
                dailyStats[d.date] = { comments: d.comments, responses: d.responses };
            });

            stats = {
                totalComments: totals?.total_comments || 0,
                totalResponses: totals?.total_responses || 0,
                processedVideos: videoCount || 0,
                dailyStats,
                lastUpdated: new Date().toISOString()
            };

            cache.set(cacheKey, stats, 60);
        }

        return stats;
    }

    /**
     * Get chart data for last 7 days
     */
    async getChartData() {
        if (!this.isConnected()) return {};

        const { data } = await this.supabase
            .from('youtube_daily_stats')
            .select('date, comments, responses')
            .order('date', { ascending: false })
            .limit(7);

        const chartData = {};
        data?.forEach(d => {
            chartData[d.date] = { comments: d.comments, responses: d.responses };
        });

        return chartData;
    }

    /**
     * Clear all caches
     */
    clearCache() {
        cache.flushAll();
    }
}

module.exports = new YouTubeDatabase();
