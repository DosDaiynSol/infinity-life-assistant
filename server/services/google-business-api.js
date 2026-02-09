const axios = require('axios');
const googleBusinessOAuth = require('./google-business-oauth');

const BASE_URL = 'https://mybusinessbusinessinformation.googleapis.com/v1';
const ACCOUNT_MANAGEMENT_URL = 'https://mybusinessaccountmanagement.googleapis.com/v1';

class GoogleBusinessAPI {
    constructor() {
        this.locationId = process.env.GOOGLE_LOCATION_ID;
        this.accountId = process.env.GOOGLE_ACCOUNT_ID;
    }

    /**
     * Get authorization headers
     */
    async getHeaders() {
        const accessToken = await googleBusinessOAuth.getAccessToken();
        if (!accessToken) {
            throw new Error('Not authorized. Please complete OAuth flow first.');
        }
        return {
            'Authorization': `Bearer ${accessToken}`,
            'Content-Type': 'application/json'
        };
    }

    /**
     * List all accounts (to find Account ID)
     */
    async listAccounts() {
        try {
            const headers = await this.getHeaders();
            const response = await axios.get(`${ACCOUNT_MANAGEMENT_URL}/accounts`, { headers });
            console.log('[Google Business] Accounts:', response.data);
            return response.data.accounts || [];
        } catch (error) {
            console.error('[Google Business] List accounts error:', error.response?.data || error.message);
            throw error;
        }
    }

    /**
     * List all locations for an account
     */
    async listLocations(accountId) {
        try {
            const headers = await this.getHeaders();
            const url = `${BASE_URL}/accounts/${accountId}/locations`;
            const response = await axios.get(url, { headers });
            console.log('[Google Business] Locations:', response.data);
            return response.data.locations || [];
        } catch (error) {
            console.error('[Google Business] List locations error:', error.response?.data || error.message);
            throw error;
        }
    }

    /**
     * Get reviews for a location
     * @param {string} locationName - Format: accounts/{account_id}/locations/{location_id}
     * @param {number} pageSize - Number of reviews to fetch (max 50)
     * @param {string} pageToken - Token for pagination
     */
    async getReviews(locationName, pageSize = 50, pageToken = null) {
        try {
            const headers = await this.getHeaders();

            // Use v4 API for reviews (still operational)
            const url = `https://mybusiness.googleapis.com/v4/${locationName}/reviews`;
            const params = { pageSize };
            if (pageToken) params.pageToken = pageToken;

            const response = await axios.get(url, { headers, params });
            console.log(`[Google Business] Fetched ${response.data.reviews?.length || 0} reviews`);
            return response.data;
        } catch (error) {
            console.error('[Google Business] Get reviews error:', error.response?.data || error.message);
            throw error;
        }
    }

    /**
     * Get a specific review
     */
    async getReview(reviewName) {
        try {
            const headers = await this.getHeaders();
            const url = `https://mybusiness.googleapis.com/v4/${reviewName}`;
            const response = await axios.get(url, { headers });
            return response.data;
        } catch (error) {
            console.error('[Google Business] Get review error:', error.response?.data || error.message);
            throw error;
        }
    }

    /**
     * Reply to a review
     * @param {string} reviewName - Format: accounts/{account_id}/locations/{location_id}/reviews/{review_id}
     * @param {string} comment - Reply text
     */
    async replyToReview(reviewName, comment) {
        try {
            const headers = await this.getHeaders();
            const url = `https://mybusiness.googleapis.com/v4/${reviewName}/reply`;

            const response = await axios.put(url, { comment }, { headers });
            console.log(`[Google Business] Replied to review: ${reviewName}`);
            return response.data;
        } catch (error) {
            console.error('[Google Business] Reply error:', error.response?.data || error.message);
            throw error;
        }
    }

    /**
     * Delete a reply from a review
     */
    async deleteReply(reviewName) {
        try {
            const headers = await this.getHeaders();
            const url = `https://mybusiness.googleapis.com/v4/${reviewName}/reply`;

            await axios.delete(url, { headers });
            console.log(`[Google Business] Deleted reply from review: ${reviewName}`);
            return { success: true };
        } catch (error) {
            console.error('[Google Business] Delete reply error:', error.response?.data || error.message);
            throw error;
        }
    }

    /**
     * Get all reviews for INFINITY LIFE locations
     * Uses stored location ID from env
     */
    async getAllReviews() {
        try {
            // First, list accounts to get account ID if not set
            if (!this.accountId || this.accountId === 'YOUR_ACCOUNT_ID_HERE') {
                console.log('[Google Business] Account ID not set, fetching accounts...');
                const accounts = await this.listAccounts();
                if (accounts.length > 0) {
                    // Extract account ID from name (format: accounts/12345)
                    this.accountId = accounts[0].name.split('/')[1];
                    console.log(`[Google Business] Using account ID: ${this.accountId}`);
                }
            }

            if (!this.accountId) {
                throw new Error('Could not determine account ID');
            }

            const locationName = `accounts/${this.accountId}/locations/${this.locationId}`;
            return await this.getReviews(locationName);
        } catch (error) {
            console.error('[Google Business] Get all reviews error:', error.message);
            throw error;
        }
    }

    /**
     * Check if OAuth is configured
     */
    isAuthorized() {
        return googleBusinessOAuth.isAuthorized();
    }

    /**
     * Get OAuth authorization URL
     */
    getAuthUrl() {
        return googleBusinessOAuth.getAuthUrl();
    }
}

module.exports = new GoogleBusinessAPI();
