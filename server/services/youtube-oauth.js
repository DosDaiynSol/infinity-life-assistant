const axios = require('axios');
const { createClient } = require('@supabase/supabase-js');

class YouTubeOAuth {
    constructor() {
        this.clientId = process.env.GOOGLE_CLIENT_ID;
        this.clientSecret = process.env.GOOGLE_CLIENT_SECRET;
        this.redirectUri = process.env.YOUTUBE_REDIRECT_URI || 'http://localhost:3000/auth/youtube/callback';
        this.tokens = null;
        this.supabase = null;
        this._initPromise = this._init();
    }

    async _init() {
        // Initialize Supabase client
        if (process.env.SUPABASE_URL && process.env.SUPABASE_SERVICE_KEY) {
            this.supabase = createClient(
                process.env.SUPABASE_URL,
                process.env.SUPABASE_SERVICE_KEY,
                { auth: { persistSession: false } }
            );
        }

        // Load tokens from Supabase first, then env fallback
        this.tokens = await this._loadTokens();
        if (this.tokens) {
            console.log('[YouTube OAuth] Tokens loaded successfully');
        } else {
            console.log('[YouTube OAuth] No tokens found - authorization required');
        }
    }

    async _loadTokens() {
        try {
            // 1. Try Supabase first
            if (this.supabase) {
                const { data } = await this.supabase
                    .from('oauth_tokens')
                    .select('*')
                    .eq('service', 'youtube')
                    .single();

                if (data && data.refresh_token) {
                    console.log('[YouTube OAuth] Tokens loaded from Supabase');
                    return {
                        access_token: data.access_token,
                        refresh_token: data.refresh_token,
                        expires_at: data.expires_at || 0
                    };
                }
            }

            // 2. Fallback to environment variables (for Railway)
            if (process.env.YOUTUBE_REFRESH_TOKEN) {
                console.log('[YouTube OAuth] Tokens loaded from environment variables');
                const tokens = {
                    access_token: process.env.YOUTUBE_ACCESS_TOKEN || null,
                    refresh_token: process.env.YOUTUBE_REFRESH_TOKEN,
                    expires_at: 0 // Will trigger refresh on first use
                };
                // Migrate to Supabase
                await this._saveToSupabase(tokens);
                return tokens;
            }

            // 3. Try legacy file (migrate to Supabase)
            const fs = require('fs');
            const path = require('path');
            const tokenFile = path.join(__dirname, '../../data/youtube_tokens.json');
            if (fs.existsSync(tokenFile)) {
                const fileTokens = JSON.parse(fs.readFileSync(tokenFile, 'utf8'));
                if (fileTokens.refresh_token) {
                    console.log('[YouTube OAuth] Tokens migrated from file to Supabase');
                    await this._saveToSupabase(fileTokens);
                    return fileTokens;
                }
            }
        } catch (error) {
            console.error('[YouTube OAuth] Error loading tokens:', error.message);
        }
        return null;
    }

    async _saveToSupabase(tokens) {
        if (!this.supabase) return;

        try {
            const record = {
                service: 'youtube',
                access_token: tokens.access_token,
                refresh_token: tokens.refresh_token || this.tokens?.refresh_token,
                expires_at: tokens.expires_in
                    ? Date.now() + (tokens.expires_in * 1000)
                    : tokens.expires_at,
                scope: tokens.scope || 'https://www.googleapis.com/auth/youtube.force-ssl',
                updated_at: new Date().toISOString()
            };

            // Upsert by service name
            const { error } = await this.supabase
                .from('oauth_tokens')
                .upsert(record, { onConflict: 'service' });

            if (error) {
                console.error('[YouTube OAuth] Supabase save error:', error.message);
            } else {
                console.log('[YouTube OAuth] Tokens saved to Supabase');
            }
        } catch (error) {
            console.error('[YouTube OAuth] Error saving tokens:', error.message);
        }
    }

    saveTokens(tokens) {
        this.tokens = {
            access_token: tokens.access_token,
            refresh_token: tokens.refresh_token || this.tokens?.refresh_token,
            expires_at: tokens.expires_in
                ? Date.now() + (tokens.expires_in * 1000)
                : tokens.expires_at
        };

        // Save to Supabase (async, don't block)
        this._saveToSupabase(this.tokens);
    }

    // Generate OAuth URL for user authorization
    getAuthUrl() {
        const scopes = [
            'https://www.googleapis.com/auth/youtube.force-ssl' // Required for comment replies
        ].join(' ');

        const params = new URLSearchParams({
            client_id: this.clientId,
            redirect_uri: this.redirectUri,
            response_type: 'code',
            scope: scopes,
            access_type: 'offline',
            prompt: 'consent', // Force refresh token generation
            login_hint: 'gassanov2030@gmail.com' // Pre-select the correct account
        });

        return `https://accounts.google.com/o/oauth2/v2/auth?${params.toString()}`;
    }

    // Exchange authorization code for tokens
    async exchangeCode(code) {
        try {
            const response = await axios.post('https://oauth2.googleapis.com/token', {
                client_id: this.clientId,
                client_secret: this.clientSecret,
                code,
                grant_type: 'authorization_code',
                redirect_uri: this.redirectUri
            });

            this.saveTokens(response.data);
            console.log('[YouTube OAuth] Authorization successful');
            return { success: true, tokens: this.tokens };
        } catch (error) {
            console.error('[YouTube OAuth] Token exchange error:', error.response?.data || error.message);
            return { success: false, error: error.response?.data || error.message };
        }
    }

    // Refresh access token
    async refreshAccessToken() {
        await this._initPromise; // Ensure init is complete

        if (!this.tokens?.refresh_token) {
            console.error('[YouTube OAuth] No refresh token available');
            return null;
        }

        try {
            console.log('[YouTube OAuth] Refreshing access token...');
            const response = await axios.post('https://oauth2.googleapis.com/token', {
                client_id: this.clientId,
                client_secret: this.clientSecret,
                refresh_token: this.tokens.refresh_token,
                grant_type: 'refresh_token'
            });

            this.saveTokens(response.data);
            console.log('[YouTube OAuth] Token refreshed successfully');
            return this.tokens.access_token;
        } catch (error) {
            const errorData = error.response?.data;
            console.error('[YouTube OAuth] Token refresh error:', errorData || error.message);

            // If refresh token is revoked/invalid, clear tokens
            if (errorData?.error === 'invalid_grant') {
                console.error('[YouTube OAuth] ⚠️ Refresh token is invalid/revoked. Re-authorization required at /auth/youtube');
                this.tokens = null;
                // Update Supabase to clear tokens
                if (this.supabase) {
                    await this.supabase
                        .from('oauth_tokens')
                        .update({ access_token: null, expires_at: 0, updated_at: new Date().toISOString() })
                        .eq('service', 'youtube');
                }
            }
            return null;
        }
    }

    // Get valid access token (auto-refresh if needed)
    async getAccessToken() {
        await this._initPromise; // Ensure init is complete

        if (!this.tokens) {
            console.log('[YouTube OAuth] No tokens - authorization required at /auth/youtube');
            return null;
        }

        // Check if token is expired (with 5 min buffer)
        if (!this.tokens.access_token || (this.tokens.expires_at && Date.now() > this.tokens.expires_at - 300000)) {
            console.log('[YouTube OAuth] Token expired or missing, refreshing...');
            return await this.refreshAccessToken();
        }

        return this.tokens.access_token;
    }

    // Check if authorized
    isAuthorized() {
        return !!(this.tokens?.refresh_token);
    }
}

module.exports = new YouTubeOAuth();
