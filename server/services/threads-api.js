/**
 * Threads API Service for INFINITY LIFE
 * Handles all interactions with Threads Graph API
 */

const axios = require('axios');

const THREADS_API_BASE = 'https://graph.threads.net/v1.0';

class ThreadsService {
    constructor() {
        this.userId = process.env.THREADS_USER_ID;
        this.accessToken = process.env.THREADS_ACCESS_TOKEN;
    }

    /**
     * Build authorization headers
     */
    getHeaders() {
        return {
            'Authorization': `Bearer ${this.accessToken}`,
            'Content-Type': 'application/json'
        };
    }

    /**
     * Search posts by keyword
     * @param {string} keyword - Search query
     * @param {Object} options - Search options
     * @returns {Promise<Array>} - Array of posts
     */
    async keywordSearch(keyword, options = {}) {
        const {
            search_type = 'RECENT',
            limit = 50,
            since = null,
            until = null
        } = options;

        try {
            const params = new URLSearchParams({
                q: keyword,
                search_type,
                limit: limit.toString(),
                fields: 'id,text,media_type,permalink,timestamp,username,has_replies,is_quote_post,is_reply',
                access_token: this.accessToken
            });

            if (since) params.append('since', since.toString());
            if (until) params.append('until', until.toString());

            const response = await axios.get(
                `${THREADS_API_BASE}/keyword_search?${params.toString()}`
            );

            return response.data?.data || [];
        } catch (error) {
            console.error(`[Threads API] Keyword search error for "${keyword}":`, error.response?.data || error.message);
            return [];
        }
    }

    /**
     * Create a text post container
     * @param {string} text - Post text
     * @returns {Promise<string|null>} - Creation ID
     */
    async createTextPost(text) {
        try {
            const params = new URLSearchParams({
                media_type: 'TEXT',
                text,
                access_token: this.accessToken
            });

            const response = await axios.post(
                `${THREADS_API_BASE}/${this.userId}/threads?${params.toString()}`
            );

            return response.data?.id || null;
        } catch (error) {
            console.error('[Threads API] Create text post error:', error.response?.data || error.message);
            return null;
        }
    }

    /**
     * Create a reply to a post
     * @param {string} replyToId - ID of post to reply to
     * @param {string} text - Reply text
     * @returns {Promise<string|null>} - Creation ID
     */
    async createReply(replyToId, text) {
        try {
            const params = new URLSearchParams({
                media_type: 'TEXT',
                text,
                reply_to_id: replyToId,
                access_token: this.accessToken
            });

            const response = await axios.post(
                `${THREADS_API_BASE}/${this.userId}/threads?${params.toString()}`
            );

            return response.data?.id || null;
        } catch (error) {
            console.error('[Threads API] Create reply error:', error.response?.data || error.message);
            return null;
        }
    }

    /**
     * Publish a post container
     * @param {string} creationId - Container ID from create methods
     * @returns {Promise<string|null>} - Published post ID
     */
    async publishPost(creationId) {
        try {
            const params = new URLSearchParams({
                creation_id: creationId,
                access_token: this.accessToken
            });

            const response = await axios.post(
                `${THREADS_API_BASE}/${this.userId}/threads_publish?${params.toString()}`
            );

            return response.data?.id || null;
        } catch (error) {
            console.error('[Threads API] Publish post error:', error.response?.data || error.message);
            return null;
        }
    }

    /**
     * Send a reply to a post (create + publish)
     * @param {string} replyToId - ID of post to reply to
     * @param {string} text - Reply text
     * @returns {Promise<string|null>} - Published reply ID
     */
    async sendReply(replyToId, text) {
        // Create reply container
        const creationId = await this.createReply(replyToId, text);
        if (!creationId) return null;

        // Wait 3 seconds before publishing (API recommendation)
        await this.sleep(3000);

        // Publish the reply
        return await this.publishPost(creationId);
    }

    /**
     * Get 24 hours ago timestamp
     * @returns {number} - Unix timestamp
     */
    get24HoursAgo() {
        return Math.floor((Date.now() - 24 * 60 * 60 * 1000) / 1000);
    }

    /**
     * Sleep helper
     * @param {number} ms - Milliseconds to sleep
     */
    sleep(ms) {
        return new Promise(resolve => setTimeout(resolve, ms));
    }
}

module.exports = new ThreadsService();
