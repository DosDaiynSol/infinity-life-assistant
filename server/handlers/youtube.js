const youtubeAPI = require('../services/youtube-api');
const youtubeResponder = require('../services/youtube-responder');
const { createClient } = require('@supabase/supabase-js');

class YouTubeHandler {
    constructor() {
        this.channelId = process.env.YOUTUBE_CHANNEL_ID;
        this.supabase = null;

        // Initialize Supabase for persistent comment tracking
        if (process.env.SUPABASE_URL && process.env.SUPABASE_SERVICE_KEY) {
            this.supabase = createClient(
                process.env.SUPABASE_URL,
                process.env.SUPABASE_SERVICE_KEY,
                { auth: { persistSession: false } }
            );
            console.log('[YouTube Handler] Connected to Supabase for comment tracking');
        }
    }

    /**
     * Check if comment was already processed (in Supabase)
     */
    async isCommentProcessed(commentId) {
        if (!this.supabase) return false;

        const { data } = await this.supabase
            .from('youtube_processed_comments')
            .select('id')
            .eq('comment_id', commentId)
            .single();

        return !!data;
    }

    /**
     * Save processed comment to Supabase
     */
    async saveProcessedComment(commentData) {
        if (!this.supabase) return;

        try {
            await this.supabase
                .from('youtube_processed_comments')
                .upsert({
                    comment_id: commentData.commentId,
                    video_id: commentData.videoId,
                    author: commentData.author,
                    comment_text: commentData.text,
                    response_text: commentData.response || null,
                    responded: commentData.responded || false,
                    error: commentData.error || null,
                    processed_at: new Date().toISOString()
                }, { onConflict: 'comment_id' });
        } catch (error) {
            console.error('[YouTube Handler] Error saving processed comment:', error.message);
        }
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
                // Skip if already processed (persistent check via Supabase)
                const alreadyProcessed = await this.isCommentProcessed(comment.commentId);
                if (alreadyProcessed) {
                    continue;
                }

                // Check if should respond
                if (!youtubeResponder.shouldRespond(comment)) {
                    const result = {
                        commentId: comment.commentId,
                        author: comment.authorDisplayName,
                        text: comment.textOriginal,
                        responded: false,
                        reason: 'filtered'
                    };
                    results.push(result);
                    // Save even filtered comments so we don't reprocess
                    await this.saveProcessedComment({
                        commentId: comment.commentId,
                        videoId,
                        author: comment.authorDisplayName,
                        text: comment.textOriginal,
                        responded: false,
                        error: 'filtered'
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
                    console.log(`[YouTube Handler] Attempting to reply to @${comment.authorDisplayName}...`);
                    const replyResult = await youtubeAPI.replyToComment(comment.commentId, responseText);

                    const result = {
                        commentId: comment.commentId,
                        author: comment.authorDisplayName,
                        text: comment.textOriginal || comment.text,
                        response: responseText,
                        responded: replyResult.success,
                        replyId: replyResult.commentId,
                        error: replyResult.error
                    };
                    results.push(result);

                    // Save to Supabase
                    await this.saveProcessedComment({
                        commentId: comment.commentId,
                        videoId,
                        author: comment.authorDisplayName,
                        text: comment.textOriginal || comment.text,
                        response: replyResult.success ? responseText : null,
                        responded: replyResult.success,
                        error: replyResult.error || null
                    });

                    if (replyResult.success) {
                        console.log(`[YouTube Handler] ✅ Replied to @${comment.authorDisplayName}: "${responseText.substring(0, 50)}..."`);
                    } else {
                        console.error(`[YouTube Handler] ❌ Failed to reply to @${comment.authorDisplayName}: ${replyResult.error}`);
                    }

                    // Small delay between replies to avoid rate limiting
                    await new Promise(resolve => setTimeout(resolve, 2000));

                } catch (error) {
                    console.error(`[YouTube Handler] Error processing comment ${comment.commentId}:`, error.message);
                    const result = {
                        commentId: comment.commentId,
                        author: comment.authorDisplayName,
                        text: comment.textOriginal,
                        responded: false,
                        error: error.message
                    };
                    results.push(result);

                    await this.saveProcessedComment({
                        commentId: comment.commentId,
                        videoId,
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
            channelId: this.channelId,
            supabaseConnected: !!this.supabase
        };
    }
}

module.exports = new YouTubeHandler();
