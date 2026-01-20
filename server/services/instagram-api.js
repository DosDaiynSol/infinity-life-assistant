/**
 * Instagram API Service
 * Handles sending messages and replying to comments
 */

const INSTAGRAM_PAGE_ID = process.env.INSTAGRAM_PAGE_ID || '17841448174425966';
const DM_TOKEN = process.env.INSTAGRAM_DM_TOKEN;
const REPLY_TOKEN = process.env.INSTAGRAM_REPLY_TOKEN;

/**
 * Send Direct Message via Instagram Graph API
 * POST https://graph.instagram.com/v24.0/{page_id}/messages
 */
async function sendDirectMessage(recipientId, text) {
    const url = `https://graph.instagram.com/v24.0/${INSTAGRAM_PAGE_ID}/messages`;

    const body = {
        recipient: { id: recipientId },
        message: { text }
    };

    try {
        const response = await fetch(url, {
            method: 'POST',
            headers: {
                'Authorization': `Bearer ${DM_TOKEN}`,
                'Content-Type': 'application/json'
            },
            body: JSON.stringify(body)
        });

        const data = await response.json();

        if (!response.ok) {
            console.error('[Instagram API Error] Send DM:', data);
            return false;
        }

        console.log('[Instagram API] DM sent successfully:', data);
        return true;

    } catch (error) {
        console.error('[Instagram API Error] Send DM:', error.message);
        return false;
    }
}

/**
 * Reply to Comment via Facebook Graph API
 * POST https://graph.facebook.com/v21.0/{comment_id}/replies
 */
async function replyToComment(commentId, message) {
    const url = `https://graph.facebook.com/v21.0/${commentId}/replies`;

    const body = { message };

    try {
        const response = await fetch(url, {
            method: 'POST',
            headers: {
                'Authorization': `Bearer ${REPLY_TOKEN}`,
                'Content-Type': 'application/json'
            },
            body: JSON.stringify(body)
        });

        const data = await response.json();

        if (!response.ok) {
            console.error('[Instagram API Error] Reply:', data);
            return false;
        }

        console.log('[Instagram API] Comment reply sent:', data);
        return true;

    } catch (error) {
        console.error('[Instagram API Error] Reply:', error.message);
        return false;
    }
}
/**
 * Get User Profile (username) via Instagram Graph API
 * GET https://graph.instagram.com/v24.0/{user_id}?fields=username,name
 */
async function getUserProfile(userId) {
    const url = `https://graph.instagram.com/v24.0/${userId}?fields=username,name`;

    try {
        const response = await fetch(url, {
            method: 'GET',
            headers: {
                'Authorization': `Bearer ${DM_TOKEN}`
            }
        });

        const data = await response.json();

        if (!response.ok) {
            console.log('[Instagram API] Could not fetch user profile:', userId);
            return null;
        }

        console.log('[Instagram API] User profile:', data);
        return {
            username: data.username || null,
            name: data.name || null
        };

    } catch (error) {
        console.error('[Instagram API Error] Get profile:', error.message);
        return null;
    }
}

module.exports = {
    sendDirectMessage,
    replyToComment,
    getUserProfile
};
