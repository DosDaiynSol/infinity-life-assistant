/**
 * Message Buffer
 * Collects messages and processes them in batches every minute
 * Groups by message type (DM/Comment) and user
 */
class MessageBuffer {
    constructor() {
        this.comments = [];
        this.dms = [];
    }

    addComment(comment) {
        // Check for duplicate
        if (!this.comments.find(c => c.commentId === comment.commentId)) {
            this.comments.push({
                ...comment,
                receivedAt: new Date().toISOString()
            });
        }
    }

    addDM(dm) {
        // Check for duplicate
        if (!this.dms.find(d => d.messageId === dm.messageId)) {
            this.dms.push({
                ...dm,
                receivedAt: new Date().toISOString()
            });
        }
    }

    /**
     * Flush buffer and return grouped messages
     * Comments: grouped by userId
     * DMs: grouped by senderId
     */
    flush() {
        // Group comments by userId
        const commentsByUser = {};
        for (const comment of this.comments) {
            const key = comment.userId || 'unknown';
            if (!commentsByUser[key]) {
                commentsByUser[key] = [];
            }
            commentsByUser[key].push(comment);
        }

        // Group DMs by senderId
        const dmsByUser = {};
        for (const dm of this.dms) {
            const key = dm.senderId || 'unknown';
            if (!dmsByUser[key]) {
                dmsByUser[key] = [];
            }
            dmsByUser[key].push(dm);
        }

        // Clear buffers
        const result = {
            comments: this.comments.slice(),
            dms: this.dms.slice(),
            commentsByUser,
            dmsByUser
        };

        this.comments = [];
        this.dms = [];

        return result;
    }

    getStats() {
        return {
            pendingComments: this.comments.length,
            pendingDMs: this.dms.length
        };
    }
}

module.exports = MessageBuffer;
