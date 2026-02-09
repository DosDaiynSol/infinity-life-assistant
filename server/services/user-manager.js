/**
 * User Management Service
 * Wrapper for Instagram Database - maintains backward compatibility
 */

const instagramDB = require('./instagram-database');

/**
 * Get or create user settings
 */
async function getUser(userId, username = null) {
    return instagramDB.getUser(userId, username);
}

/**
 * Update user settings
 */
async function updateUser(userId, updates) {
    return instagramDB.updateUser(userId, updates);
}

/**
 * Toggle AI for user
 */
async function toggleAI(userId, type = 'all') {
    return instagramDB.toggleAI(userId, type);
}

/**
 * Get all users
 */
async function getAllUsers() {
    return instagramDB.getAllUsers();
}

/**
 * Check if AI is enabled for user
 */
async function isAIEnabled(userId, type = 'dm') {
    return instagramDB.isAIEnabled(userId, type);
}

/**
 * Track user activity
 */
async function trackActivity(userId, type, username = null) {
    return instagramDB.trackActivity(userId, type, username);
}

// === CONVERSATION MEMORY ===

/**
 * Add message to conversation history
 */
async function addMessage(userId, role, text) {
    return instagramDB.addMessage(userId, role, text);
}

/**
 * Get conversation history for user
 */
async function getConversation(userId, limit = 10) {
    return instagramDB.getConversation(userId, limit);
}

/**
 * Clear conversation for user
 */
async function clearConversation(userId) {
    return instagramDB.clearConversation(userId);
}

module.exports = {
    getUser,
    updateUser,
    toggleAI,
    getAllUsers,
    isAIEnabled,
    trackActivity,
    addMessage,
    getConversation,
    clearConversation
};
