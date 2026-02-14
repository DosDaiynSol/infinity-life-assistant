const axios = require('axios');
const { createClient } = require('@supabase/supabase-js');

class GoogleBusinessOAuth {
    constructor() {
        this.clientId = process.env.GOOGLE_CLIENT_ID;
        this.clientSecret = process.env.GOOGLE_CLIENT_SECRET;
        this.redirectUri = process.env.GOOGLE_REDIRECT_URI || 'http://localhost:3000/auth/google/callback';
        this.tokens = null;
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

        this.tokens = await this._loadTokens();
        if (this.tokens) {
            console.log('[Google Business OAuth] Tokens loaded successfully');
        } else {
            console.log('[Google Business OAuth] No tokens found - authorization required');
        }
    }

    async _loadTokens() {
        try {
            // 1. Try Supabase first
            if (this.supabase) {
                const { data } = await this.supabase
                    .from('oauth_tokens')
                    .select('*')
                    .eq('service', 'google_business')
                    .single();

                if (data && data.refresh_token) {
                    console.log('[Google Business OAuth] Tokens loaded from Supabase');
                    return {
                        access_token: data.access_token,
                        refresh_token: data.refresh_token,
                        expires_at: data.expires_at || 0
                    };
                }
            }

            // 2. Fallback to environment variables
            if (process.env.GOOGLE_REFRESH_TOKEN) {
                console.log('[Google Business OAuth] Tokens loaded from environment variables');
                const tokens = {
                    access_token: process.env.GOOGLE_ACCESS_TOKEN || null,
                    refresh_token: process.env.GOOGLE_REFRESH_TOKEN,
                    expires_at: 0
                };
                await this._saveToSupabase(tokens);
                return tokens;
            }

            // 3. Try legacy file (migrate to Supabase)
            const fs = require('fs');
            const path = require('path');
            const tokenFile = path.join(__dirname, '../../data/google_business_tokens.json');
            if (fs.existsSync(tokenFile)) {
                const fileTokens = JSON.parse(fs.readFileSync(tokenFile, 'utf8'));
                if (fileTokens.refresh_token) {
                    console.log('[Google Business OAuth] Tokens migrated from file to Supabase');
                    await this._saveToSupabase(fileTokens);
                    return fileTokens;
                }
            }
        } catch (error) {
            console.error('[Google Business OAuth] Error loading tokens:', error.message);
        }
        return null;
    }

    async _saveToSupabase(tokens) {
        if (!this.supabase) return;

        try {
            const record = {
                service: 'google_business',
                access_token: tokens.access_token,
                refresh_token: tokens.refresh_token || this.tokens?.refresh_token,
                expires_at: tokens.expires_in
                    ? Date.now() + (tokens.expires_in * 1000)
                    : tokens.expires_at,
                scope: tokens.scope || 'https://www.googleapis.com/auth/business.manage',
                updated_at: new Date().toISOString()
            };

            const { error } = await this.supabase
                .from('oauth_tokens')
                .upsert(record, { onConflict: 'service' });

            if (error) {
                console.error('[Google Business OAuth] Supabase save error:', error.message);
            } else {
                console.log('[Google Business OAuth] Tokens saved to Supabase');
            }
        } catch (error) {
            console.error('[Google Business OAuth] Error saving tokens:', error.message);
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

        this._saveToSupabase(this.tokens);
    }

    // Generate OAuth URL for user authorization
    getAuthUrl() {
        const scopes = [
            'https://www.googleapis.com/auth/business.manage'
        ].join(' ');

        const params = new URLSearchParams({
            client_id: this.clientId,
            redirect_uri: this.redirectUri,
            response_type: 'code',
            scope: scopes,
            access_type: 'offline',
            prompt: 'consent',
            login_hint: 'gassanov2030@gmail.com'
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
            console.log('[Google Business OAuth] Authorization successful');
            return { success: true, tokens: this.tokens };
        } catch (error) {
            console.error('[Google Business OAuth] Token exchange error:', error.response?.data || error.message);
            return { success: false, error: error.response?.data || error.message };
        }
    }

    // Refresh access token
    async refreshAccessToken() {
        await this._initPromise;

        if (!this.tokens?.refresh_token) {
            console.error('[Google Business OAuth] No refresh token available');
            return null;
        }

        try {
            console.log('[Google Business OAuth] Refreshing access token...');
            const response = await axios.post('https://oauth2.googleapis.com/token', {
                client_id: this.clientId,
                client_secret: this.clientSecret,
                refresh_token: this.tokens.refresh_token,
                grant_type: 'refresh_token'
            });

            this.saveTokens(response.data);
            console.log('[Google Business OAuth] Token refreshed successfully');
            return this.tokens.access_token;
        } catch (error) {
            const errorData = error.response?.data;
            console.error('[Google Business OAuth] Token refresh error:', errorData || error.message);

            if (errorData?.error === 'invalid_grant') {
                console.error('[Google Business OAuth] ⚠️ Refresh token is invalid. Re-authorization required at /auth/google');
                this.tokens = null;
                if (this.supabase) {
                    await this.supabase
                        .from('oauth_tokens')
                        .update({ access_token: null, expires_at: 0, updated_at: new Date().toISOString() })
                        .eq('service', 'google_business');
                }
            }
            return null;
        }
    }

    // Get valid access token (auto-refresh if needed)
    async getAccessToken() {
        await this._initPromise;

        if (!this.tokens) {
            console.log('[Google Business OAuth] No tokens - authorization required at /auth/google');
            return null;
        }

        const isExpired = !this.tokens.expires_at || Date.now() > this.tokens.expires_at - 300000;
        const needsRefresh = !this.tokens.access_token || isExpired;

        if (needsRefresh && this.tokens.refresh_token) {
            return await this.refreshAccessToken();
        }

        return this.tokens.access_token;
    }

    // Check if authorized
    isAuthorized() {
        return !!(this.tokens?.refresh_token);
    }
}

module.exports = new GoogleBusinessOAuth();
