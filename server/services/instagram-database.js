/**
 * Instagram Database Service
 * Supabase client with caching for Instagram data
 */

const { createClient } = require('@supabase/supabase-js');
const NodeCache = require('node-cache');

// Cache configuration: 5 minute TTL, check every 60s
const cache = new NodeCache({
    stdTTL: 300,
    checkperiod: 60,
    useClones: false
});

class InstagramDatabase {
    constructor() {
        if (!process.env.SUPABASE_URL || !process.env.SUPABASE_SERVICE_KEY) {
            console.error('[Instagram DB] Missing Supabase credentials');
            this.supabase = null;
            return;
        }

        try {
            this.supabase = createClient(
                process.env.SUPABASE_URL,
                process.env.SUPABASE_SERVICE_KEY,
                { auth: { persistSession: false } }
            );
            console.log('[Instagram DB] Connected to Supabase');
        } catch (error) {
            console.error('[Instagram DB] Init error:', error.message);
            this.supabase = null;
        }
    }

    isConnected() {
        return this.supabase !== null;
    }

    // ==========================================
    // User Management
    // ==========================================

    /**
     * Get or create user with caching
     */
    async getUser(userId, username = null) {
        if (!this.isConnected()) return this._defaultUser(userId, username);

        const cacheKey = `user:${userId}`;
        let user = cache.get(cacheKey);

        if (!user) {
            const { data } = await this.supabase
                .from('instagram_users')
                .select('*')
                .eq('user_id', userId)
                .single();

            if (data) {
                user = data;
            } else {
                // Create new user
                const newUser = {
                    user_id: userId,
                    username,
                    ai_enabled: true,
                    dm_enabled: true,
                    comment_enabled: true,
                    message_count: 0,
                    comment_count: 0
                };

                const { data: created } = await this.supabase
                    .from('instagram_users')
                    .insert(newUser)
                    .select()
                    .single();

                user = created || newUser;
            }

            cache.set(cacheKey, user);
        }

        // Update username if provided and different
        if (username && user.username !== username) {
            await this.updateUser(userId, { username });
            user.username = username;
        }

        return user;
    }

    /**
     * Update user settings
     */
    async updateUser(userId, updates) {
        if (!this.isConnected()) return null;

        const { data } = await this.supabase
            .from('instagram_users')
            .update({ ...updates, last_seen: new Date().toISOString() })
            .eq('user_id', userId)
            .select()
            .single();

        if (data) {
            cache.set(`user:${userId}`, data);
        }

        return data;
    }

    /**
     * Toggle AI for user
     */
    async toggleAI(userId, type = 'all') {
        const user = await this.getUser(userId);
        if (!user) return null;

        const updates = {};
        if (type === 'dm') {
            updates.dm_enabled = !user.dm_enabled;
        } else if (type === 'comment') {
            updates.comment_enabled = !user.comment_enabled;
        } else {
            updates.ai_enabled = !user.ai_enabled;
        }

        return this.updateUser(userId, updates);
    }

    /**
     * Get all users (cached for 1 minute)
     */
    async getAllUsers() {
        if (!this.isConnected()) return [];

        const cacheKey = 'all_users';
        let users = cache.get(cacheKey);

        if (!users) {
            const { data } = await this.supabase
                .from('instagram_users')
                .select('*')
                .order('last_seen', { ascending: false });

            users = data || [];
            cache.set(cacheKey, users, 60); // 1 minute TTL
        }

        return users;
    }

    /**
     * Check if AI is enabled for user
     */
    async isAIEnabled(userId, type = 'dm') {
        const user = await this.getUser(userId);
        if (!user) return true; // Default enabled

        if (!user.ai_enabled) return false;
        if (type === 'dm') return user.dm_enabled !== false;
        if (type === 'comment') return user.comment_enabled !== false;

        return true;
    }

    /**
     * Track user activity
     */
    async trackActivity(userId, type, username = null) {
        const user = await this.getUser(userId, username);

        const updates = { last_seen: new Date().toISOString() };
        if (type === 'dm') {
            updates.message_count = (user.message_count || 0) + 1;
        } else if (type === 'comment') {
            updates.comment_count = (user.comment_count || 0) + 1;
        }

        return this.updateUser(userId, updates);
    }

    // ==========================================
    // Conversation Memory
    // ==========================================

    /**
     * Add message to conversation history
     */
    async addMessage(userId, role, text) {
        if (!this.isConnected()) return;

        await this.supabase
            .from('instagram_conversations')
            .insert({
                user_id: userId,
                role,
                text
            });

        // Invalidate conversation cache
        cache.del(`conversation:${userId}`);

        // Clean up old messages (keep last 20)
        const { data: oldMessages } = await this.supabase
            .from('instagram_conversations')
            .select('id')
            .eq('user_id', userId)
            .order('created_at', { ascending: true });

        if (oldMessages && oldMessages.length > 20) {
            const toDelete = oldMessages.slice(0, oldMessages.length - 20).map(m => m.id);
            await this.supabase
                .from('instagram_conversations')
                .delete()
                .in('id', toDelete);
        }
    }

    /**
     * Get conversation history (cached)
     */
    async getConversation(userId, limit = 10) {
        if (!this.isConnected()) return [];

        const cacheKey = `conversation:${userId}`;
        let conversation = cache.get(cacheKey);

        if (!conversation) {
            const { data } = await this.supabase
                .from('instagram_conversations')
                .select('role, text, created_at')
                .eq('user_id', userId)
                .order('created_at', { ascending: false })
                .limit(limit);

            conversation = (data || []).reverse();
            cache.set(cacheKey, conversation, 120); // 2 minute TTL
        }

        return conversation.slice(-limit);
    }

    /**
     * Clear conversation for user
     */
    async clearConversation(userId) {
        if (!this.isConnected()) return;

        await this.supabase
            .from('instagram_conversations')
            .delete()
            .eq('user_id', userId);

        cache.del(`conversation:${userId}`);
    }

    // ==========================================
    // Statistics
    // ==========================================

    /**
     * Track daily stats
     */
    async trackStats(type, count = 1) {
        if (!this.isConnected()) return;

        const today = new Date().toISOString().split('T')[0];

        // Upsert today's stats
        const { data: existing } = await this.supabase
            .from('instagram_stats')
            .select('*')
            .eq('date', today)
            .single();

        if (existing) {
            const updates = { updated_at: new Date().toISOString() };
            updates[type] = (existing[type] || 0) + count;

            await this.supabase
                .from('instagram_stats')
                .update(updates)
                .eq('date', today);
        } else {
            const newStats = { date: today, dms: 0, comments: 0, responses: 0 };
            newStats[type] = count;

            await this.supabase
                .from('instagram_stats')
                .insert(newStats);
        }

        // Invalidate stats cache
        cache.del('instagram_stats');
    }

    /**
     * Get aggregated stats (cached)
     */
    async getStats() {
        if (!this.isConnected()) {
            return {
                totalMessages: 0,
                totalComments: 0,
                responsesSet: 0,
                uniqueDMSenders: 0,
                uniqueCommenters: 0,
                dailyStats: {}
            };
        }

        const cacheKey = 'instagram_stats';
        let stats = cache.get(cacheKey);

        if (!stats) {
            // Get totals from users table
            const { data: users } = await this.supabase
                .from('instagram_users')
                .select('message_count, comment_count');

            const totalMessages = users?.reduce((sum, u) => sum + (u.message_count || 0), 0) || 0;
            const totalComments = users?.reduce((sum, u) => sum + (u.comment_count || 0), 0) || 0;
            const uniqueDMSenders = users?.filter(u => u.message_count > 0).length || 0;
            const uniqueCommenters = users?.filter(u => u.comment_count > 0).length || 0;

            // Get daily stats
            const { data: dailyData } = await this.supabase
                .from('instagram_stats')
                .select('date, dms, comments, responses')
                .order('date', { ascending: false })
                .limit(30);

            const dailyStats = {};
            const responsesTotal = dailyData?.reduce((sum, d) => {
                dailyStats[d.date] = { dms: d.dms, comments: d.comments, responses: d.responses };
                return sum + (d.responses || 0);
            }, 0) || 0;

            stats = {
                totalMessages,
                totalComments,
                responsesSet: responsesTotal,
                uniqueDMSenders,
                uniqueCommenters,
                dailyStats
            };

            cache.set(cacheKey, stats, 60); // 1 minute TTL
        }

        return stats;
    }

    // ==========================================
    // Helpers
    // ==========================================

    _defaultUser(userId, username) {
        return {
            user_id: userId,
            username,
            ai_enabled: true,
            dm_enabled: true,
            comment_enabled: true,
            message_count: 0,
            comment_count: 0
        };
    }

    /**
     * Clear all caches
     */
    clearCache() {
        cache.flushAll();
    }

    // ==========================================
    // History (processed items)
    // ==========================================

    /**
     * Add history entry
     */
    async addHistory(entry) {
        if (!this.isConnected()) return;

        await this.supabase
            .from('instagram_history')
            .insert({
                type: entry.type,
                comment_id: entry.commentId,
                user_id: entry.userId || entry.senderId,
                username: entry.username,
                text: entry.text,
                response: entry.response,
                responded: entry.responded || false,
                status: entry.status,
                rejection: entry.rejection,
                created_at: entry.timestamp || new Date().toISOString()
            });

        // Invalidate history cache
        cache.del('instagram_history');
    }

    /**
     * Get history (cached)
     */
    async getHistory(limit = 100) {
        if (!this.isConnected()) return [];

        const cacheKey = 'instagram_history';
        let history = cache.get(cacheKey);

        if (!history) {
            const { data } = await this.supabase
                .from('instagram_history')
                .select('*')
                .order('created_at', { ascending: false })
                .limit(limit);

            history = (data || []).map(item => ({
                type: item.type,
                commentId: item.comment_id,
                userId: item.user_id,
                username: item.username,
                text: item.text,
                response: item.response,
                responded: item.responded,
                status: item.status,
                rejection: item.rejection,
                timestamp: item.created_at
            }));

            cache.set(cacheKey, history, 30); // 30 second TTL
        }

        return history;
    }
}

module.exports = new InstagramDatabase();
