const googleBusinessAPI = require('../services/google-business-api');
const googleReviewsResponder = require('../services/google-reviews-responder');
const googleReviewsDB = require('../services/google-reviews-database');

class GoogleReviewsHandler {
    constructor() {
        console.log('[Google Reviews Handler] Initialized with Supabase backend');
    }

    // Check if review already has a reply (from API response)
    hasReplyFromAPI(review) {
        return !!review.reviewReply;
    }

    // Check if we already replied to this review
    async hasReplied(reviewId) {
        return googleReviewsDB.isReplied(reviewId);
    }

    // Process all reviews for a location
    async processReviews(options = {}) {
        const { dryRun = false, forceReply = false, limit = null } = options;
        const results = [];
        let repliedCount = 0;

        try {
            console.log('[Google Reviews Handler] Fetching reviews...');
            const reviewsData = await googleBusinessAPI.getAllReviews();
            const reviews = reviewsData.reviews || [];

            console.log(`[Google Reviews Handler] Found ${reviews.length} reviews`);

            for (const review of reviews) {
                // Check if we've reached the limit
                if (limit && repliedCount >= limit) {
                    console.log(`[Google Reviews Handler] Reached limit of ${limit} replies`);
                    break;
                }
                const reviewId = review.reviewId;
                const reviewerName = review.reviewer?.displayName || 'Аноним';

                // Skip if already has reply (unless forced)
                if (!forceReply && this.hasReplyFromAPI(review)) {
                    results.push({
                        reviewId,
                        reviewer: reviewerName,
                        starRating: review.starRating,
                        responded: false,
                        reason: 'already_has_reply',
                        existingReply: review.reviewReply?.comment
                    });
                    continue;
                }

                // Skip if we already processed this review
                const alreadyReplied = await this.hasReplied(reviewId);
                if (!forceReply && alreadyReplied) {
                    results.push({
                        reviewId,
                        reviewer: reviewerName,
                        starRating: review.starRating,
                        responded: false,
                        reason: 'already_processed'
                    });
                    continue;
                }

                // Check if should respond
                const shouldRespondCheck = googleReviewsResponder.shouldRespond(review);
                if (!shouldRespondCheck.respond) {
                    results.push({
                        reviewId,
                        reviewer: reviewerName,
                        starRating: review.starRating,
                        responded: false,
                        reason: shouldRespondCheck.reason
                    });
                    continue;
                }

                try {
                    // Generate AI response
                    const responseText = await googleReviewsResponder.generateResponse(review);
                    console.log(`[Google Reviews Handler] Generated reply for ${reviewerName}: "${responseText.substring(0, 50)}..."`);

                    if (dryRun) {
                        results.push({
                            reviewId,
                            reviewer: reviewerName,
                            starRating: review.starRating,
                            comment: review.comment?.substring(0, 100),
                            generatedReply: responseText,
                            responded: false,
                            reason: 'dry_run'
                        });
                        continue;
                    }

                    // Post reply
                    await googleBusinessAPI.replyToReview(review.name, responseText);

                    // Mark as replied in Supabase
                    await googleReviewsDB.markAsReplied(
                        reviewId,
                        responseText,
                        reviewerName,
                        review.starRating
                    );

                    results.push({
                        reviewId,
                        reviewer: reviewerName,
                        starRating: review.starRating,
                        comment: review.comment?.substring(0, 100),
                        reply: responseText,
                        responded: true
                    });

                    repliedCount++;
                    console.log(`[Google Reviews Handler] ✅ Replied to review from ${reviewerName} (${repliedCount}/${limit || '∞'})`);

                    // Delay between replies to avoid rate limiting
                    await new Promise(resolve => setTimeout(resolve, 2000));

                } catch (error) {
                    console.error(`[Google Reviews Handler] Error replying to review ${reviewId}:`, error.message);
                    results.push({
                        reviewId,
                        reviewer: reviewerName,
                        starRating: review.starRating,
                        responded: false,
                        error: error.message
                    });
                }
            }

            const finalRepliedCount = results.filter(r => r.responded).length;
            console.log(`[Google Reviews Handler] Done. Replied to ${finalRepliedCount}/${reviews.length} reviews.`);

            return {
                totalReviews: reviews.length,
                repliedCount: finalRepliedCount,
                results
            };

        } catch (error) {
            console.error('[Google Reviews Handler] Error processing reviews:', error.message);
            throw error;
        }
    }

    // Get stats from Supabase
    async getStats() {
        const stats = await googleReviewsDB.getStats();
        const recentReplies = await googleReviewsDB.getRecentReplies(20);

        return {
            totalReplied: stats.totalReplies,
            todayReplied: stats.todayReplies,
            repliedReviews: recentReplies.reduce((acc, r) => {
                acc[r.review_id] = {
                    repliedAt: r.replied_at,
                    reply: r.reply_text,
                    reviewer: r.reviewer_name,
                    starRating: r.star_rating
                };
                return acc;
            }, {})
        };
    }

    // Clear cache
    clearCache() {
        googleReviewsDB.clearCache();
    }
}

module.exports = new GoogleReviewsHandler();
