/**
 * User Management Service
 * Handles user settings (AI toggle) and conversation memory
 */

const fs = require('fs');
const path = require('path');

const USERS_FILE = path.join(__dirname, '../../data/users.json');
const CONVERSATIONS_FILE = path.join(__dirname, '../../data/conversations.json');

// Load data from files
function loadUsers() {
    try {
        return JSON.parse(fs.readFileSync(USERS_FILE, 'utf8'));
    } catch {
        return { users: {}, version: 1 };
    }
}

function saveUsers(data) {
    fs.writeFileSync(USERS_FILE, JSON.stringify(data, null, 2));
}

function loadConversations() {
    try {
        return JSON.parse(fs.readFileSync(CONVERSATIONS_FILE, 'utf8'));
    } catch {
        return { conversations: {}, version: 1 };
    }
}

function saveConversations(data) {
    fs.writeFileSync(CONVERSATIONS_FILE, JSON.stringify(data, null, 2));
}

/**
 * Get or create user settings
 */
function getUser(userId, username = null) {
    const data = loadUsers();

    if (!data.users[userId]) {
        data.users[userId] = {
            id: userId,
            username: username,
            aiEnabled: true,
            dmEnabled: true,
            commentEnabled: true,
            createdAt: new Date().toISOString(),
            lastSeen: new Date().toISOString(),
            messageCount: 0,
            commentCount: 0
        };
        saveUsers(data);
    } else if (username && !data.users[userId].username) {
        data.users[userId].username = username;
        saveUsers(data);
    }

    return data.users[userId];
}

/**
 * Update user settings
 */
function updateUser(userId, updates) {
    const data = loadUsers();

    if (data.users[userId]) {
        data.users[userId] = { ...data.users[userId], ...updates };
        saveUsers(data);
    }

    return data.users[userId];
}

/**
 * Toggle AI for user
 */
function toggleAI(userId, type = 'all') {
    const data = loadUsers();
    const user = data.users[userId];

    if (!user) return null;

    if (type === 'dm') {
        user.dmEnabled = !user.dmEnabled;
    } else if (type === 'comment') {
        user.commentEnabled = !user.commentEnabled;
    } else {
        user.aiEnabled = !user.aiEnabled;
    }

    saveUsers(data);
    return user;
}

/**
 * Get all users
 */
function getAllUsers() {
    const data = loadUsers();
    return Object.values(data.users);
}

/**
 * Check if AI is enabled for user
 */
function isAIEnabled(userId, type = 'dm') {
    const data = loadUsers();
    const user = data.users[userId];

    if (!user) return true; // Default enabled for new users

    if (!user.aiEnabled) return false;

    if (type === 'dm') return user.dmEnabled !== false;
    if (type === 'comment') return user.commentEnabled !== false;

    return true;
}

/**
 * Track user activity
 */
function trackActivity(userId, type, username = null) {
    const data = loadUsers();

    if (!data.users[userId]) {
        data.users[userId] = {
            id: userId,
            username: username,
            aiEnabled: true,
            dmEnabled: true,
            commentEnabled: true,
            createdAt: new Date().toISOString(),
            lastSeen: new Date().toISOString(),
            messageCount: 0,
            commentCount: 0
        };
    }

    data.users[userId].lastSeen = new Date().toISOString();

    if (type === 'dm') {
        data.users[userId].messageCount = (data.users[userId].messageCount || 0) + 1;
    } else if (type === 'comment') {
        data.users[userId].commentCount = (data.users[userId].commentCount || 0) + 1;
    }

    if (username) {
        data.users[userId].username = username;
    }

    saveUsers(data);
    return data.users[userId];
}

// === CONVERSATION MEMORY ===

/**
 * Add message to conversation history
 */
function addMessage(userId, role, text) {
    const data = loadConversations();

    if (!data.conversations[userId]) {
        data.conversations[userId] = [];
    }

    data.conversations[userId].push({
        role,
        text,
        timestamp: new Date().toISOString()
    });

    // Keep only last 20 messages per user
    if (data.conversations[userId].length > 20) {
        data.conversations[userId] = data.conversations[userId].slice(-20);
    }

    saveConversations(data);
}

/**
 * Get conversation history for user
 */
function getConversation(userId, limit = 10) {
    const data = loadConversations();

    if (!data.conversations[userId]) {
        return [];
    }

    return data.conversations[userId].slice(-limit);
}

/**
 * Clear conversation for user
 */
function clearConversation(userId) {
    const data = loadConversations();

    if (data.conversations[userId]) {
        data.conversations[userId] = [];
        saveConversations(data);
    }
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
