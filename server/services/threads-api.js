/**
 * Threads API Service for INFINITY LIFE
 * Handles all interactions with Threads Graph API
 * Supports auto-refresh of long-lived tokens via Supabase
 */

const axios = require('axios');
const { createClient } = require('@supabase/supabase-js');

const THREADS_API_BASE = 'https://graph.threads.net/v1.0';

class ThreadsService {
    constructor() {
        this.userId = process.env.THREADS_USER_ID;
        this.accessToken = process.env.THREADS_ACCESS_TOKEN;
        this.supabase = null;
        this._initPromise = this._init();
    }

    async _init() {
        if (process.env.SUPABASE_URL && process.env.SUPABASE_SERVICE_KEY) {
            this.supabase = createClient(
                process.env.SUPABASE_URL,
                process.env.SUPABASE_SERVICE_KEY,
                { auth: { persistSession: false } }
            );
        }

        // Try loading token from Supabase first
        await this._loadToken();
    }

    async _loadToken() {
        try {
            if (this.supabase) {
                const { data } = await this.supabase
                    .from('oauth_tokens')
                    .select('*')
                    .eq('service', 'threads')
                    .single();

                if (data && data.access_token) {
                    this.accessToken = data.access_token;
                    console.log('[Threads API] Token loaded from Supabase');

                    // Check if token needs refresh (expires within 7 days)
                    if (data.expires_at && data.expires_at - Date.now() < 7 * 24 * 60 * 60 * 1000) {
                        console.log('[Threads API] Token expiring soon, refreshing...');
                        await this.refreshLongLivedToken();
                    }
                    return;
                }
            }

            // If token from env var, save to Supabase
            if (this.accessToken) {
                console.log('[Threads API] Migrating token from env to Supabase');
                await this._saveToken(this.accessToken);
            }
        } catch (error) {
            console.error('[Threads API] Error loading token:', error.message);
        }
    }

    async _saveToken(token, expiresIn = null) {
        if (!this.supabase) return;

        try {
            const record = {
                service: 'threads',
                access_token: token,
                expires_at: expiresIn ? Date.now() + (expiresIn * 1000) : null,
                updated_at: new Date().toISOString()
            };

            const { error } = await this.supabase
                .from('oauth_tokens')
                .upsert(record, { onConflict: 'service' });

            if (error) {
                console.error('[Threads API] Supabase save error:', error.message);
            } else {
                console.log('[Threads API] Token saved to Supabase');
            }
        } catch (error) {
            console.error('[Threads API] Error saving token:', error.message);
        }
    }

    /**
     * Refresh long-lived Threads token
     * Threads tokens last 60 days and can be refreshed before expiry
     * @see https://developers.facebook.com/docs/threads/get-started/long-lived-tokens
     */
    async refreshLongLivedToken() {
        try {
            const response = await axios.get(
                `${THREADS_API_BASE}/refresh_access_token`, {
                params: {
                    grant_type: 'th_refresh_token',
                    access_token: this.accessToken
                }
            }
            );

            if (response.data?.access_token) {
                this.accessToken = response.data.access_token;
                const expiresIn = response.data.expires_in; // seconds
                await this._saveToken(this.accessToken, expiresIn);
                console.log(`[Threads API] ✅ Token refreshed! Expires in ${Math.round(expiresIn / 86400)} days`);
                return true;
            }
        } catch (error) {
            console.error('[Threads API] ❌ Token refresh failed:', error.response?.data || error.message);
            console.error('[Threads API] New token may need to be generated manually via Meta Developer Console');
        }
        return false;
    }

    /**
     * Get current access token (with auto-load from Supabase)
     */
    async getToken() {
        await this._initPromise;
        return this.accessToken;
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
        await this._initPromise;

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
            const errData = error.response?.data;
            const status = error.response?.status;
            console.error(`[Threads API] Keyword search error for "${keyword}":`);
            console.error(`  HTTP ${status}: ${JSON.stringify(errData || error.message)}`);

            // If token expired or invalid
            if (status === 190 || status === 401 || errData?.error?.code === 190) {
                console.error('[Threads API] ⚠️ Token appears expired. Attempting refresh...');
                const refreshed = await this.refreshLongLivedToken();
                if (refreshed) {
                    // Retry the request once
                    return this.keywordSearch(keyword, options);
                }
            }
            return [];
        }
    }

    /**
     * Create a text post container
     * @param {string} text - Post text
     * @returns {Promise<string|null>} - Creation ID
     */
    async createTextPost(text) {
        await this._initPromise;

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
        await this._initPromise;

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
        await this._initPromise;

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
