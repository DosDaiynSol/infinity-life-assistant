/**
 * Supabase Client for Threads Keyword Search
 * Database operations for processed posts and logs
 */

const { createClient } = require('@supabase/supabase-js');

class ThreadsDatabase {
    constructor() {
        this.supabase = createClient(
            process.env.SUPABASE_URL,
            process.env.SUPABASE_SERVICE_KEY
        );
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
     * Get daily statistics
     * @returns {Promise<Object>}
     */
    async getDailyStats() {
        const today = new Date();
        today.setHours(0, 0, 0, 0);

        const { data: logs } = await this.supabase
            .from('threads_api_logs')
            .select('results_count, new_posts_count')
            .gte('created_at', today.toISOString());

        const { count: repliesCount } = await this.supabase
            .from('threads_processed_posts')
            .select('*', { count: 'exact', head: true })
            .eq('status', 'replied')
            .gte('replied_at', today.toISOString());

        const { count: validatedCount } = await this.supabase
            .from('threads_processed_posts')
            .select('*', { count: 'exact', head: true })
            .eq('status', 'validated')
            .gte('processed_at', today.toISOString());

        return {
            apiRequests: logs?.length || 0,
            postsFound: logs?.reduce((sum, l) => sum + l.results_count, 0) || 0,
            newPosts: logs?.reduce((sum, l) => sum + l.new_posts_count, 0) || 0,
            validated: validatedCount || 0,
            replied: repliesCount || 0
        };
    }
}

module.exports = new ThreadsDatabase();
