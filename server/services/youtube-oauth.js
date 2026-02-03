const axios = require('axios');
const fs = require('fs');
const path = require('path');

// Token storage file
const TOKEN_FILE = path.join(__dirname, '../../data/youtube_tokens.json');

class YouTubeOAuth {
    constructor() {
        this.clientId = process.env.GOOGLE_CLIENT_ID;
        this.clientSecret = process.env.GOOGLE_CLIENT_SECRET;
        this.redirectUri = process.env.YOUTUBE_REDIRECT_URI || 'http://localhost:3000/auth/youtube/callback';
        this.tokens = this.loadTokens();
    }

    loadTokens() {
        try {
            if (fs.existsSync(TOKEN_FILE)) {
                const data = JSON.parse(fs.readFileSync(TOKEN_FILE, 'utf8'));
                console.log('[YouTube OAuth] Tokens loaded from file');
                return data;
            }
        } catch (error) {
            console.error('[YouTube OAuth] Error loading tokens:', error.message);
        }
        return null;
    }

    saveTokens(tokens) {
        try {
            // Create data directory if it doesn't exist
            const dir = path.dirname(TOKEN_FILE);
            if (!fs.existsSync(dir)) {
                fs.mkdirSync(dir, { recursive: true });
            }

            this.tokens = {
                access_token: tokens.access_token,
                refresh_token: tokens.refresh_token || this.tokens?.refresh_token,
                expires_at: tokens.expires_in
                    ? Date.now() + (tokens.expires_in * 1000)
                    : tokens.expires_at
            };

            fs.writeFileSync(TOKEN_FILE, JSON.stringify(this.tokens, null, 2));
            console.log('[YouTube OAuth] Tokens saved to file');
        } catch (error) {
            console.error('[YouTube OAuth] Error saving tokens:', error.message);
        }
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
        if (!this.tokens?.refresh_token) {
            console.error('[YouTube OAuth] No refresh token available');
            return null;
        }

        try {
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
            console.error('[YouTube OAuth] Token refresh error:', error.response?.data || error.message);
            return null;
        }
    }

    // Get valid access token (refresh if needed)
    async getAccessToken() {
        if (!this.tokens) {
            console.log('[YouTube OAuth] No tokens - authorization required');
            return null;
        }

        // Check if token is expired (with 5 min buffer)
        if (this.tokens.expires_at && Date.now() > this.tokens.expires_at - 300000) {
            console.log('[YouTube OAuth] Token expired, refreshing...');
            return await this.refreshAccessToken();
        }

        return this.tokens.access_token;
    }

    // Check if authorized
    isAuthorized() {
        return !!this.tokens?.access_token;
    }
}

module.exports = new YouTubeOAuth();
