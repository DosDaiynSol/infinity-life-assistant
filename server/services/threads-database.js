/**
 * Supabase Client for Threads Keyword Search
 * Database operations for processed posts and logs
 */

const { createClient } = require('@supabase/supabase-js');

class ThreadsDatabase {
    constructor() {
        if (!process.env.SUPABASE_URL || !process.env.SUPABASE_SERVICE_KEY) {
            console.error('[Threads DB] Missing Supabase credentials');
            this.supabase = null;
            return;
        }

        try {
            this.supabase = createClient(
                process.env.SUPABASE_URL,
                process.env.SUPABASE_SERVICE_KEY,
                {
                    auth: { persistSession: false },
                    global: {
                        fetch: (...args) => {
                            return fetch(...args).catch(err => {
                                console.error('[Threads DB] Fetch error:', err.message);
                                throw err;
                            });
                        }
                    }
                }
            );
            console.log('[Threads DB] Connected to Supabase');
        } catch (error) {
            console.error('[Threads DB] Init error:', error.message);
            this.supabase = null;
        }
    }

    isConnected() {
        return this.supabase !== null;
    }

    /**
     * Check if post already exists in database
     * @param {string} postId - Threads post ID
     * @returns {Promise<boolean>}
     */
    async postExists(postId) {
        const { data } = await this.supabase
            .from('threads_processed_posts')
            .select('id')
            .eq('post_id', postId)
            .single();

        return !!data;
    }

    /**
     * Save new posts to database
     * @param {Array} posts - Array of posts from API
     * @param {string} keyword - Matched keyword
     * @returns {Promise<number>} - Number of new posts saved
     */
    async saveNewPosts(posts, keyword) {
        let newCount = 0;

        for (const post of posts) {
            const exists = await this.postExists(post.id);
            if (exists) continue;

            const { error } = await this.supabase
                .from('threads_processed_posts')
                .insert({
                    post_id: post.id,
                    text: post.text,
                    username: post.username,
                    permalink: post.permalink,
                    post_timestamp: post.timestamp,
                    keyword_matched: keyword,
                    status: 'new'
                });

            if (!error) newCount++;
        }

        return newCount;
    }

    /**
     * Get posts by status
     * @param {string} status - Post status
     * @param {number} limit - Max results
     * @returns {Promise<Array>}
     */
    async getPostsByStatus(status, limit = 50) {
        const { data, error } = await this.supabase
            .from('threads_processed_posts')
            .select('*')
            .eq('status', status)
            .order('created_at', { ascending: true })
            .limit(limit);

        if (error) {
            console.error('[Threads DB] Get posts error:', error);
            return [];
        }

        return data || [];
    }

    /**
     * Update post status
     * @param {string} id - Database record ID
     * @param {string} status - New status
     * @param {Object} extra - Extra fields to update
     */
    async updatePostStatus(id, status, extra = {}) {
        const updates = {
            status,
            processed_at: new Date().toISOString(),
            ...extra
        };

        if (status === 'replied') {
            updates.replied_at = new Date().toISOString();
        }

        const { error } = await this.supabase
            .from('threads_processed_posts')
            .update(updates)
            .eq('id', id);

        if (error) {
            console.error('[Threads DB] Update status error:', error);
        }
    }

    /**
     * Log API request
     * @param {string} keyword - Searched keyword
     * @param {number} resultsCount - Total results from API
     * @param {number} newPostsCount - New posts saved
     */
    async logApiRequest(keyword, resultsCount, newPostsCount) {
        await this.supabase
            .from('threads_api_logs')
            .insert({
                keyword,
                results_count: resultsCount,
                new_posts_count: newPostsCount
            });
    }

    /**
     * Get count of replies sent today
     * @returns {Promise<number>}
     */
    async getRepliesCountToday() {
        const today = new Date();
        today.setHours(0, 0, 0, 0);

        const { count, error } = await this.supabase
            .from('threads_processed_posts')
            .select('*', { count: 'exact', head: true })
            .eq('status', 'replied')
            .gte('replied_at', today.toISOString());

        if (error) {
            console.error('[Threads DB] Get replies count error:', error);
            return 0;
        }

        return count || 0;
    }

    /**
     * Get all-time statistics
     * @returns {Promise<Object>}
     */
    async getStats() {
        if (!this.isConnected()) {
            console.log('[Threads DB] Not connected, returning zeros');
            return {
                apiRequests: 0,
                postsFound: 0,
                newPosts: 0,
                validated: 0,
                replied: 0,
                skipped: 0,
                conversionRate: 0
            };
        }

        // Total counts from processed posts
        const { count: totalPosts } = await this.supabase
            .from('threads_processed_posts')
            .select('*', { count: 'exact', head: true });

        const { count: newCount } = await this.supabase
            .from('threads_processed_posts')
            .select('*', { count: 'exact', head: true })
            .eq('status', 'new');

        const { count: validatedCount } = await this.supabase
            .from('threads_processed_posts')
            .select('*', { count: 'exact', head: true })
            .eq('status', 'validated');

        const { count: repliedCount } = await this.supabase
            .from('threads_processed_posts')
            .select('*', { count: 'exact', head: true })
            .eq('status', 'replied');

        const { count: skippedCount } = await this.supabase
            .from('threads_processed_posts')
            .select('*', { count: 'exact', head: true })
            .eq('status', 'skipped');

        // API requests count
        const { count: apiRequests } = await this.supabase
            .from('threads_api_logs')
            .select('*', { count: 'exact', head: true });

        // Calculate conversion rate
        const conversionRate = totalPosts > 0
            ? Math.round((repliedCount / totalPosts) * 100)
            : 0;

        return {
            apiRequests: apiRequests || 0,
            postsFound: totalPosts || 0,
            newPosts: newCount || 0,
            validated: validatedCount || 0,
            replied: repliedCount || 0,
            skipped: skippedCount || 0,
            conversionRate
        };
    }

    /**
     * Get daily breakdown for charts (last 7 days)
     * @returns {Promise<Object>}
     */
    async getChartData() {
        if (!this.isConnected()) {
            return {};
        }

        const days = {};
        const now = new Date();

        // Initialize last 7 days
        for (let i = 6; i >= 0; i--) {
            const date = new Date(now);
            date.setDate(date.getDate() - i);
            const key = date.toISOString().split('T')[0];
            days[key] = { posts: 0, validated: 0, replied: 0 };
        }

        // Get posts from last 7 days
        const weekAgo = new Date(now);
        weekAgo.setDate(weekAgo.getDate() - 7);

        const { data: posts } = await this.supabase
            .from('threads_processed_posts')
            .select('created_at, status, replied_at')
            .gte('created_at', weekAgo.toISOString());

        // Aggregate by day
        for (const post of (posts || [])) {
            const day = post.created_at?.split('T')[0];
            if (days[day]) {
                days[day].posts++;
                if (post.status === 'validated') days[day].validated++;
                if (post.status === 'replied') {
                    days[day].validated++;
                    days[day].replied++;
                }
            }
        }

        return days;
    }

    // Alias for backward compatibility
    async getDailyStats() {
        return this.getStats();
    }
}

module.exports = new ThreadsDatabase();
