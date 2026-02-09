/**
 * Google Reviews Database Service
 * Supabase client with caching for Google Business reviews
 */

const { createClient } = require('@supabase/supabase-js');
const NodeCache = require('node-cache');

// Cache configuration: 5 minute TTL
const cache = new NodeCache({
    stdTTL: 300,
    checkperiod: 60,
    useClones: false
});

class GoogleReviewsDatabase {
    constructor() {
        if (!process.env.SUPABASE_URL || !process.env.SUPABASE_SERVICE_KEY) {
            console.error('[Google Reviews DB] Missing Supabase credentials');
            this.supabase = null;
            return;
        }

        try {
            this.supabase = createClient(
                process.env.SUPABASE_URL,
                process.env.SUPABASE_SERVICE_KEY,
                { auth: { persistSession: false } }
            );
            console.log('[Google Reviews DB] Connected to Supabase');
        } catch (error) {
            console.error('[Google Reviews DB] Init error:', error.message);
            this.supabase = null;
        }
    }

    isConnected() {
        return this.supabase !== null;
    }

    /**
     * Check if review has been replied to (cached)
     */
    async isReplied(reviewId) {
        if (!this.isConnected()) return false;

        const cacheKey = `review:${reviewId}`;
        let replied = cache.get(cacheKey);

        if (replied === undefined) {
            const { data } = await this.supabase
                .from('google_replied_reviews')
                .select('id')
                .eq('review_id', reviewId)
                .single();

            replied = !!data;
            cache.set(cacheKey, replied);
        }

        return replied;
    }

    /**
     * Mark review as replied
     */
    async markAsReplied(reviewId, replyText, reviewerName = null, starRating = null) {
        if (!this.isConnected()) return;

        // Check if already exists
        const exists = await this.isReplied(reviewId);
        if (exists) return;

        const { error } = await this.supabase
            .from('google_replied_reviews')
            .insert({
                review_id: reviewId,
                reply_text: replyText,
                reviewer_name: reviewerName,
                star_rating: starRating
            });

        if (!error) {
            cache.set(`review:${reviewId}`, true);
            cache.del('replied_reviews');
        }
    }

    /**
     * Get all replied review IDs (cached)
     */
    async getRepliedReviewIds() {
        if (!this.isConnected()) return [];

        const cacheKey = 'replied_review_ids';
        let ids = cache.get(cacheKey);

        if (!ids) {
            const { data } = await this.supabase
                .from('google_replied_reviews')
                .select('review_id');

            ids = data?.map(r => r.review_id) || [];
            cache.set(cacheKey, ids, 60);
        }

        return ids;
    }

    /**
     * Get recent replies (cached)
     */
    async getRecentReplies(limit = 20) {
        if (!this.isConnected()) return [];

        const cacheKey = 'replied_reviews';
        let replies = cache.get(cacheKey);

        if (!replies) {
            const { data } = await this.supabase
                .from('google_replied_reviews')
                .select('*')
                .order('replied_at', { ascending: false })
                .limit(limit);

            replies = data || [];
            cache.set(cacheKey, replies, 60);
        }

        return replies;
    }

    /**
     * Get reply details for a specific review
     */
    async getReplyDetails(reviewId) {
        if (!this.isConnected()) return null;

        const { data } = await this.supabase
            .from('google_replied_reviews')
            .select('*')
            .eq('review_id', reviewId)
            .single();

        return data;
    }

    /**
     * Get statistics
     */
    async getStats() {
        if (!this.isConnected()) {
            return { totalReplies: 0, todayReplies: 0 };
        }

        const cacheKey = 'google_stats';
        let stats = cache.get(cacheKey);

        if (!stats) {
            // Total replies
            const { count: totalReplies } = await this.supabase
                .from('google_replied_reviews')
                .select('*', { count: 'exact', head: true });

            // Today's replies
            const today = new Date();
            today.setHours(0, 0, 0, 0);

            const { count: todayReplies } = await this.supabase
                .from('google_replied_reviews')
                .select('*', { count: 'exact', head: true })
                .gte('replied_at', today.toISOString());

            stats = {
                totalReplies: totalReplies || 0,
                todayReplies: todayReplies || 0
            };

            cache.set(cacheKey, stats, 60);
        }

        return stats;
    }

    /**
     * Clear all caches
     */
    clearCache() {
        cache.flushAll();
    }
}

module.exports = new GoogleReviewsDatabase();
