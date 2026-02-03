const youtubeAPI = require('../services/youtube-api');
const youtubeResponder = require('../services/youtube-responder');

class YouTubeHandler {
    constructor() {
        this.channelId = process.env.YOUTUBE_CHANNEL_ID;
        this.processedComments = new Set(); // Track processed comments in memory
    }

    // Process comments for a specific video
    async processVideoComments(videoId) {
        const results = [];

        try {
            // Get video info for context
            const videoInfo = await youtubeAPI.getVideoInfo(videoId);
            console.log(`[YouTube Handler] Processing video: "${videoInfo?.title || videoId}"`);

            // Get comments needing reply
            const comments = await youtubeAPI.getNewCommentsNeedingReply(videoId, this.channelId);
            console.log(`[YouTube Handler] Found ${comments.length} comments potentially needing reply`);

            for (const comment of comments) {
                // Skip if already processed this session
                if (this.processedComments.has(comment.commentId)) {
                    continue;
                }

                // Check if should respond
                if (!youtubeResponder.shouldRespond(comment)) {
                    results.push({
                        commentId: comment.commentId,
                        author: comment.authorDisplayName,
                        text: comment.textOriginal,
                        responded: false,
                        reason: 'filtered'
                    });
                    continue;
                }

                try {
                    // Generate AI response
                    const responseText = await youtubeResponder.generateResponse(
                        comment.textOriginal || comment.text,
                        videoInfo
                    );

                    // Post reply
                    const replyResult = await youtubeAPI.replyToComment(comment.commentId, responseText);

                    this.processedComments.add(comment.commentId);

                    results.push({
                        commentId: comment.commentId,
                        author: comment.authorDisplayName,
                        text: comment.textOriginal || comment.text,
                        response: responseText,
                        responded: replyResult.success,
                        replyId: replyResult.commentId,
                        error: replyResult.error
                    });

                    console.log(`[YouTube Handler] Replied to @${comment.authorDisplayName}: "${responseText.substring(0, 50)}..."`);

                    // Small delay between replies to avoid rate limiting
                    await new Promise(resolve => setTimeout(resolve, 1000));

                } catch (error) {
                    console.error(`[YouTube Handler] Error processing comment ${comment.commentId}:`, error.message);
                    results.push({
                        commentId: comment.commentId,
                        author: comment.authorDisplayName,
                        text: comment.textOriginal,
                        responded: false,
                        error: error.message
                    });
                }
            }

            return {
                videoId,
                videoTitle: videoInfo?.title,
                processedCount: comments.length,
                repliedCount: results.filter(r => r.responded).length,
                results
            };

        } catch (error) {
            console.error('[YouTube Handler] Error processing video:', error.message);
            throw error;
        }
    }

    // Process comments for all recent videos on channel
    async processChannelComments(videoCount = 5) {
        const allResults = [];

        try {
            // Get recent videos
            const videos = await youtubeAPI.getChannelVideos(videoCount);
            console.log(`[YouTube Handler] Processing ${videos.length} recent videos`);

            for (const video of videos) {
                try {
                    const result = await this.processVideoComments(video.id);
                    allResults.push(result);
                } catch (error) {
                    console.error(`[YouTube Handler] Error processing video ${video.id}:`, error.message);
                    allResults.push({
                        videoId: video.id,
                        videoTitle: video.title,
                        error: error.message
                    });
                }
            }

            return {
                videosProcessed: videos.length,
                totalReplied: allResults.reduce((sum, r) => sum + (r.repliedCount || 0), 0),
                results: allResults
            };

        } catch (error) {
            console.error('[YouTube Handler] Error processing channel:', error.message);
            throw error;
        }
    }

    // Get stats
    getStats() {
        return {
            processedCommentsCount: this.processedComments.size,
            channelId: this.channelId
        };
    }

    // Clear processed cache (for testing)
    clearCache() {
        this.processedComments.clear();
    }
}

module.exports = new YouTubeHandler();
