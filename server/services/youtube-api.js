const axios = require('axios');
const youtubeOAuth = require('./youtube-oauth');

const YOUTUBE_API_BASE = 'https://www.googleapis.com/youtube/v3';

class YouTubeAPI {
    constructor() {
        this.channelId = process.env.YOUTUBE_CHANNEL_ID;
    }

    // Get authenticated headers
    async getAuthHeaders() {
        const token = await youtubeOAuth.getAccessToken();
        if (!token) {
            throw new Error('YouTube not authorized. Visit /auth/youtube to authorize.');
        }
        return {
            'Authorization': `Bearer ${token}`,
            'Content-Type': 'application/json'
        };
    }

    // Get video information
    async getVideoInfo(videoId) {
        try {
            const headers = await this.getAuthHeaders();
            const response = await axios.get(`${YOUTUBE_API_BASE}/videos`, {
                headers,
                params: {
                    part: 'snippet,statistics',
                    id: videoId
                }
            });

            const video = response.data.items?.[0];
            if (!video) return null;

            return {
                id: video.id,
                title: video.snippet.title,
                description: video.snippet.description,
                publishedAt: video.snippet.publishedAt,
                channelTitle: video.snippet.channelTitle,
                tags: video.snippet.tags || [],
                viewCount: video.statistics.viewCount,
                likeCount: video.statistics.likeCount,
                commentCount: video.statistics.commentCount
            };
        } catch (error) {
            console.error('[YouTube API] Error getting video info:', error.response?.data || error.message);
            throw error;
        }
    }

    // Get channel videos
    async getChannelVideos(maxResults = 10) {
        try {
            const headers = await this.getAuthHeaders();

            // First, get the uploads playlist ID
            const channelResponse = await axios.get(`${YOUTUBE_API_BASE}/channels`, {
                headers,
                params: {
                    part: 'contentDetails',
                    id: this.channelId
                }
            });

            const uploadsPlaylistId = channelResponse.data.items?.[0]?.contentDetails?.relatedPlaylists?.uploads;
            if (!uploadsPlaylistId) {
                throw new Error('Could not find uploads playlist');
            }

            // Get videos from uploads playlist
            const videosResponse = await axios.get(`${YOUTUBE_API_BASE}/playlistItems`, {
                headers,
                params: {
                    part: 'snippet',
                    playlistId: uploadsPlaylistId,
                    maxResults
                }
            });

            return videosResponse.data.items.map(item => ({
                id: item.snippet.resourceId.videoId,
                title: item.snippet.title,
                description: item.snippet.description,
                publishedAt: item.snippet.publishedAt,
                thumbnail: item.snippet.thumbnails?.medium?.url
            }));
        } catch (error) {
            console.error('[YouTube API] Error getting channel videos:', error.response?.data || error.message);
            throw error;
        }
    }

    // Get comments for a video
    async getVideoComments(videoId, publishedAfter = null, maxResults = 100) {
        try {
            const headers = await this.getAuthHeaders();
            const params = {
                part: 'snippet,replies',
                videoId,
                maxResults,
                order: 'time' // Get newest first
            };

            const response = await axios.get(`${YOUTUBE_API_BASE}/commentThreads`, {
                headers,
                params
            });

            let comments = response.data.items.map(item => ({
                threadId: item.id,
                commentId: item.snippet.topLevelComment.id,
                authorDisplayName: item.snippet.topLevelComment.snippet.authorDisplayName,
                authorChannelId: item.snippet.topLevelComment.snippet.authorChannelId?.value,
                text: item.snippet.topLevelComment.snippet.textDisplay,
                textOriginal: item.snippet.topLevelComment.snippet.textOriginal,
                publishedAt: item.snippet.topLevelComment.snippet.publishedAt,
                likeCount: item.snippet.topLevelComment.snippet.likeCount,
                replyCount: item.snippet.totalReplyCount,
                hasReplies: item.snippet.totalReplyCount > 0,
                replies: item.replies?.comments?.map(reply => ({
                    commentId: reply.id,
                    authorDisplayName: reply.snippet.authorDisplayName,
                    authorChannelId: reply.snippet.authorChannelId?.value,
                    text: reply.snippet.textDisplay,
                    publishedAt: reply.snippet.publishedAt
                })) || []
            }));

            // Filter by publishedAfter if provided
            if (publishedAfter) {
                const afterDate = new Date(publishedAfter);
                comments = comments.filter(c => new Date(c.publishedAt) > afterDate);
            }

            return comments;
        } catch (error) {
            console.error('[YouTube API] Error getting comments:', error.response?.data || error.message);
            throw error;
        }
    }

    // Reply to a comment
    async replyToComment(parentId, text) {
        try {
            const headers = await this.getAuthHeaders();

            const response = await axios.post(`${YOUTUBE_API_BASE}/comments`, {
                snippet: {
                    parentId,
                    textOriginal: text
                }
            }, {
                headers,
                params: {
                    part: 'snippet'
                }
            });

            console.log(`[YouTube API] Reply posted to comment ${parentId}`);
            return {
                success: true,
                commentId: response.data.id,
                text: response.data.snippet.textDisplay
            };
        } catch (error) {
            console.error('[YouTube API] Error replying to comment:', error.response?.data || error.message);
            return {
                success: false,
                error: error.response?.data?.error?.message || error.message
            };
        }
    }

    // Check if we've already replied to a comment
    hasOurReply(comment, ourChannelId) {
        if (!comment.hasReplies || !comment.replies) return false;
        return comment.replies.some(reply => reply.authorChannelId === ourChannelId);
    }

    // Get new comments without our reply
    async getNewCommentsNeedingReply(videoId, ourChannelId) {
        const comments = await this.getVideoComments(videoId);

        return comments.filter(comment => {
            // Skip if author is our channel
            if (comment.authorChannelId === ourChannelId) return false;
            // Skip if we already replied
            if (this.hasOurReply(comment, ourChannelId)) return false;
            return true;
        });
    }
}

module.exports = new YouTubeAPI();
