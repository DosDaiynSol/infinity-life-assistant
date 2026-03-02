/**
 * Cross-Posting Service
 * Polls Instagram for new posts and cross-posts them to other platforms.
 * 
 * Phase 1: Instagram polling + Supabase queue
 * Phase 2: Facebook cross-posting
 */

const { createClient } = require('@supabase/supabase-js');
const axios = require('axios');

class CrossPostService {
    constructor() {
        this.supabase = createClient(
            process.env.SUPABASE_URL,
            process.env.SUPABASE_SERVICE_KEY
        );

        // Instagram tokens
        this.instagramPageId = process.env.INSTAGRAM_PAGE_ID;
        this.userToken = process.env.INSTAGRAM_REPLY_TOKEN; // Facebook User token

        // Facebook Page config
        // Target page: Infinity_life.kz (105221775099742)
        this.facebookPageId = process.env.FACEBOOK_PAGE_ID || '105221775099742';
        this.facebookPageToken = null; // Will be fetched from /me/accounts

        // VK config
        this.vkAccessToken = process.env.VK_ACCESS_TOKEN;
        this.vkGroupId = process.env.VK_GROUP_ID; // Without minus sign, e.g. '233499872'

        // State
        this.isPolling = false;
        this.lastPollTime = null;
        this.stats = {
            totalPolled: 0,
            newPostsFound: 0,
            crossPosted: { facebook: 0, youtube: 0, vk: 0 },
            errors: 0
        };
    }

    // ==========================================
    // Phase 1: Instagram Polling
    // ==========================================

    /**
     * Fetch recent posts from Instagram using Graph API
     * GET /{ig-user-id}/media?fields=id,caption,media_type,media_url,permalink,timestamp,children{media_url,media_type}
     */
    async fetchInstagramPosts(limit = 10) {
        try {
            const fields = 'id,caption,media_type,media_url,permalink,timestamp,children{media_url,media_type}';
            const url = `https://graph.facebook.com/v21.0/${this.instagramPageId}/media`;

            const response = await axios.get(url, {
                params: {
                    fields,
                    limit,
                    access_token: this.userToken
                }
            });

            console.log(`[CrossPost] Fetched ${response.data.data?.length || 0} Instagram posts`);
            return response.data.data || [];
        } catch (error) {
            console.error('[CrossPost] Error fetching Instagram posts:', error.response?.data || error.message);
            this.stats.errors++;
            return [];
        }
    }

    /**
     * Check which posts are new (not yet in crosspost_queue)
     */
    async filterNewPosts(posts) {
        if (posts.length === 0) return [];

        const postIds = posts.map(p => p.id);

        const { data: existing } = await this.supabase
            .from('crosspost_queue')
            .select('instagram_post_id')
            .in('instagram_post_id', postIds);

        const existingIds = new Set((existing || []).map(e => e.instagram_post_id));
        const newPosts = posts.filter(p => !existingIds.has(p.id));

        if (newPosts.length > 0) {
            console.log(`[CrossPost] Found ${newPosts.length} new posts out of ${posts.length}`);
        }

        return newPosts;
    }

    /**
     * Save new posts to the crosspost queue
     */
    async saveToQueue(posts) {
        const records = posts.map(post => {
            // Build media URLs array
            let mediaUrls = [];

            if (post.media_type === 'CAROUSEL_ALBUM' && post.children?.data) {
                mediaUrls = post.children.data.map(child => ({
                    url: child.media_url,
                    type: child.media_type
                }));
            } else if (post.media_url) {
                mediaUrls = [{ url: post.media_url, type: post.media_type }];
            }

            return {
                instagram_post_id: post.id,
                media_type: post.media_type,
                caption: post.caption || '',
                media_urls: mediaUrls,
                permalink: post.permalink,
                posted_at: post.timestamp,
                // All platforms start as 'pending'
                facebook_status: 'pending',
                youtube_status: 'pending',
                vk_status: 'pending',
                tiktok_status: 'skipped',    // Skipped for now
                yandex_status: 'skipped'     // Skipped for now
            };
        });

        const { data, error } = await this.supabase
            .from('crosspost_queue')
            .upsert(records, { onConflict: 'instagram_post_id' })
            .select();

        if (error) {
            console.error('[CrossPost] Error saving to queue:', error.message);
            return [];
        }

        console.log(`[CrossPost] Saved ${records.length} posts to queue`);
        this.stats.newPostsFound += records.length;
        return data || [];
    }

    // ==========================================
    // Phase 2: Facebook Cross-Posting
    // ==========================================

    /**
     * Get Facebook Page token from /me/accounts
     * The User token has access to pages — we need the Page-specific access_token
     */
    async getFacebookPageToken() {
        // Return cached token if available
        if (this.facebookPageToken) {
            return this.facebookPageToken;
        }

        try {
            const response = await axios.get('https://graph.facebook.com/v21.0/me/accounts', {
                params: {
                    access_token: this.userToken,
                    fields: 'id,name,access_token'
                }
            });

            const pages = response.data.data || [];
            const targetPage = pages.find(p => p.id === this.facebookPageId);

            if (!targetPage) {
                console.error(`[CrossPost] Facebook Page ${this.facebookPageId} not found. Available pages:`,
                    pages.map(p => `${p.id} (${p.name})`).join(', '));
                return null;
            }

            this.facebookPageToken = targetPage.access_token;
            console.log(`[CrossPost] Got Page token for: ${targetPage.name} (${targetPage.id})`);
            return this.facebookPageToken;
        } catch (error) {
            console.error('[CrossPost] Error getting Facebook Page token:', error.response?.data || error.message);
            return null;
        }
    }

    /**
     * Post a photo to Facebook Page
     */
    async postPhotoToFacebook(pageId, pageToken, imageUrl, caption) {
        try {
            const response = await axios.post(
                `https://graph.facebook.com/v21.0/${pageId}/photos`,
                null,
                {
                    params: {
                        url: imageUrl,
                        caption: caption || '',
                        access_token: pageToken
                    }
                }
            );

            console.log(`[CrossPost → Facebook] Photo posted: ${response.data.id}`);
            return { success: true, postId: response.data.id };
        } catch (error) {
            console.error('[CrossPost → Facebook] Photo error:', error.response?.data || error.message);
            return { success: false, error: error.response?.data?.error?.message || error.message };
        }
    }

    /**
     * Post a video/reel to Facebook Page
     */
    async postVideoToFacebook(pageId, pageToken, videoUrl, caption) {
        try {
            const response = await axios.post(
                `https://graph.facebook.com/v21.0/${pageId}/videos`,
                null,
                {
                    params: {
                        file_url: videoUrl,
                        description: caption || '',
                        access_token: pageToken
                    }
                }
            );

            console.log(`[CrossPost → Facebook] Video posted: ${response.data.id}`);
            return { success: true, postId: response.data.id };
        } catch (error) {
            console.error('[CrossPost → Facebook] Video error:', error.response?.data || error.message);
            return { success: false, error: error.response?.data?.error?.message || error.message };
        }
    }

    /**
     * Post a carousel (multiple photos) to Facebook Page
     */
    async postCarouselToFacebook(pageId, pageToken, mediaItems, caption) {
        try {
            // Step 1: Upload each photo as unpublished
            const photoIds = [];
            for (const item of mediaItems) {
                if (item.type !== 'IMAGE') continue;

                const response = await axios.post(
                    `https://graph.facebook.com/v21.0/${pageId}/photos`,
                    null,
                    {
                        params: {
                            url: item.url,
                            published: false,
                            access_token: pageToken
                        }
                    }
                );
                photoIds.push(response.data.id);
            }

            if (photoIds.length === 0) {
                return { success: false, error: 'No images found in carousel' };
            }

            // Step 2: Create feed post with attached media
            const attachedMedia = photoIds.map(id => ({ media_fbid: id }));
            const response = await axios.post(
                `https://graph.facebook.com/v21.0/${pageId}/feed`,
                null,
                {
                    params: {
                        message: caption || '',
                        attached_media: JSON.stringify(attachedMedia),
                        access_token: pageToken
                    }
                }
            );

            console.log(`[CrossPost → Facebook] Carousel posted: ${response.data.id} (${photoIds.length} photos)`);
            return { success: true, postId: response.data.id };
        } catch (error) {
            console.error('[CrossPost → Facebook] Carousel error:', error.response?.data || error.message);
            return { success: false, error: error.response?.data?.error?.message || error.message };
        }
    }

    /**
     * Cross-post a single queue item to Facebook
     */
    async crossPostToFacebook(queueItem) {
        const pageToken = await this.getFacebookPageToken();
        if (!pageToken) {
            return { success: false, error: 'Could not get Facebook Page token. Check permissions: pages_read_engagement, pages_manage_posts' };
        }

        const pageId = this.facebookPageId;
        let result;

        switch (queueItem.media_type) {
            case 'IMAGE':
                result = await this.postPhotoToFacebook(
                    pageId,
                    pageToken,
                    queueItem.media_urls[0]?.url,
                    queueItem.caption
                );
                break;

            case 'VIDEO':
            case 'REELS':
                result = await this.postVideoToFacebook(
                    pageId,
                    pageToken,
                    queueItem.media_urls[0]?.url,
                    queueItem.caption
                );
                break;

            case 'CAROUSEL_ALBUM':
                result = await this.postCarouselToFacebook(
                    pageId,
                    pageToken,
                    queueItem.media_urls,
                    queueItem.caption
                );
                break;

            default:
                result = { success: false, error: `Unknown media type: ${queueItem.media_type}` };
        }

        // Update queue status
        const updateData = {
            facebook_status: result.success ? 'posted' : 'failed',
            facebook_post_id: result.postId || null,
            updated_at: new Date().toISOString()
        };

        if (!result.success) {
            updateData.error_log = {
                ...queueItem.error_log,
                facebook: { error: result.error, timestamp: new Date().toISOString() }
            };
        }

        await this.supabase
            .from('crosspost_queue')
            .update(updateData)
            .eq('id', queueItem.id);

        if (result.success) {
            this.stats.crossPosted.facebook++;
        }

        return result;
    }

    // ==========================================
    // Phase 3: VK Cross-Posting
    // ==========================================

    /**
     * Upload a photo to VK servers (required before posting)
     * VK requires uploading photos to their server first, then attaching to a wall post
     */
    async uploadPhotoToVK(imageUrl) {
        try {
            // Step 1: Get upload server URL
            const uploadServerRes = await axios.get('https://api.vk.com/method/photos.getWallUploadServer', {
                params: {
                    group_id: this.vkGroupId,
                    access_token: this.vkAccessToken,
                    v: '5.199'
                }
            });

            if (uploadServerRes.data.error) {
                throw new Error(uploadServerRes.data.error.error_msg);
            }

            const uploadUrl = uploadServerRes.data.response.upload_url;

            // Step 2: Download image from Instagram
            const imageResponse = await axios.get(imageUrl, { responseType: 'arraybuffer' });
            const imageBuffer = Buffer.from(imageResponse.data);

            // Step 3: Upload to VK using multipart/form-data
            const FormData = require('form-data');
            const formData = new FormData();
            formData.append('photo', imageBuffer, { filename: 'photo.jpg', contentType: 'image/jpeg' });

            const uploadRes = await axios.post(uploadUrl, formData, {
                headers: formData.getHeaders(),
                maxContentLength: Infinity,
                maxBodyLength: Infinity
            });

            // Step 4: Save uploaded photo on VK
            const saveRes = await axios.get('https://api.vk.com/method/photos.saveWallPhoto', {
                params: {
                    group_id: this.vkGroupId,
                    photo: uploadRes.data.photo,
                    server: uploadRes.data.server,
                    hash: uploadRes.data.hash,
                    access_token: this.vkAccessToken,
                    v: '5.199'
                }
            });

            if (saveRes.data.error) {
                throw new Error(saveRes.data.error.error_msg);
            }

            const savedPhoto = saveRes.data.response[0];
            return `photo${savedPhoto.owner_id}_${savedPhoto.id}`;
        } catch (error) {
            console.error('[CrossPost → VK] Photo upload error:', error.message);
            return null;
        }
    }

    /**
     * Upload a video to VK servers using video.save API
     * VK requires: 1) call video.save to get upload URL, 2) POST video file to that URL
     */
    async uploadVideoToVK(videoUrl, caption = '') {
        try {
            // Step 1: Call video.save to get upload URL
            const saveRes = await axios.get('https://api.vk.com/method/video.save', {
                params: {
                    group_id: this.vkGroupId,
                    name: (caption || 'Video').substring(0, 128),
                    description: caption || '',
                    wallpost: 0,  // We'll attach to wall.post manually
                    is_private: 0,
                    access_token: this.vkAccessToken,
                    v: '5.199'
                }
            });

            if (saveRes.data.error) {
                throw new Error(saveRes.data.error.error_msg);
            }

            const { upload_url, owner_id, video_id } = saveRes.data.response;
            console.log(`[CrossPost → VK] Video slot created: video${owner_id}_${video_id}`);

            // Step 2: Download video from Instagram
            console.log(`[CrossPost → VK] Downloading video...`);
            const videoResponse = await axios.get(videoUrl, {
                responseType: 'arraybuffer',
                maxContentLength: Infinity,
                maxBodyLength: Infinity,
                timeout: 120000  // 2 min timeout for large videos
            });
            const videoBuffer = Buffer.from(videoResponse.data);
            const sizeMB = (videoBuffer.length / 1024 / 1024).toFixed(1);
            console.log(`[CrossPost → VK] Downloaded ${sizeMB} MB, uploading to VK...`);

            // Step 3: Upload video file to VK
            const FormData = require('form-data');
            const formData = new FormData();
            formData.append('video_file', videoBuffer, {
                filename: 'video.mp4',
                contentType: 'video/mp4'
            });

            await axios.post(upload_url, formData, {
                headers: formData.getHeaders(),
                maxContentLength: Infinity,
                maxBodyLength: Infinity,
                timeout: 180000  // 3 min timeout for upload
            });

            console.log(`[CrossPost → VK] Video uploaded successfully`);
            return `video${owner_id}_${video_id}`;
        } catch (error) {
            console.error('[CrossPost → VK] Video upload error:', error.message);
            return null;
        }
    }

    /**
     * Post to VK community wall
     */
    async postToVK(caption, attachments = '') {
        try {
            const response = await axios.get('https://api.vk.com/method/wall.post', {
                params: {
                    owner_id: `-${this.vkGroupId}`,
                    from_group: 1,
                    message: caption || '',
                    attachments: attachments,
                    access_token: this.vkAccessToken,
                    v: '5.199'
                }
            });

            if (response.data.error) {
                throw new Error(response.data.error.error_msg);
            }

            const postId = response.data.response.post_id;
            console.log(`[CrossPost → VK] Posted: ${postId}`);
            return { success: true, postId: String(postId) };
        } catch (error) {
            console.error('[CrossPost → VK] Post error:', error.response?.data || error.message);
            return { success: false, error: error.message };
        }
    }

    /**
     * Cross-post a single queue item to VK
     */
    async crossPostToVK(queueItem) {
        if (!this.vkAccessToken || !this.vkGroupId) {
            console.log('[CrossPost → VK] No VK credentials configured, skipping');
            await this.supabase
                .from('crosspost_queue')
                .update({ vk_status: 'skipped' })
                .eq('id', queueItem.id);
            return { success: false, error: 'No VK credentials' };
        }

        let result;

        try {
            const caption = queueItem.caption || '';

            switch (queueItem.media_type) {
                case 'IMAGE': {
                    const photoAttachment = await this.uploadPhotoToVK(queueItem.media_urls[0]?.url);
                    if (photoAttachment) {
                        result = await this.postToVK(caption, photoAttachment);
                    } else {
                        // Fallback: post text only
                        result = await this.postToVK(caption);
                    }
                    break;
                }

                case 'CAROUSEL_ALBUM': {
                    // Upload all images (max 10 per VK post)
                    const attachments = [];
                    const items = queueItem.media_urls.slice(0, 10);
                    for (const item of items) {
                        if (item.type === 'IMAGE' && item.url) {
                            const att = await this.uploadPhotoToVK(item.url);
                            if (att) attachments.push(att);
                            await new Promise(resolve => setTimeout(resolve, 500));
                        }
                    }
                    result = await this.postToVK(caption, attachments.join(','));
                    break;
                }

                case 'VIDEO':
                case 'REELS': {
                    // Try to upload actual video to VK
                    const videoUrl = queueItem.media_urls[0]?.url;
                    if (videoUrl) {
                        const videoAttachment = await this.uploadVideoToVK(videoUrl, caption);
                        if (videoAttachment) {
                            result = await this.postToVK(caption, videoAttachment);
                        } else {
                            // Fallback: post text with link to Instagram
                            const textWithLink = `${caption}\n\n📹 Видео: ${queueItem.permalink || ''}`;
                            result = await this.postToVK(textWithLink);
                        }
                    } else {
                        const textWithLink = `${caption}\n\n📹 Видео: ${queueItem.permalink || ''}`;
                        result = await this.postToVK(textWithLink);
                    }
                    break;
                }

                default:
                    result = { success: false, error: `Unknown media type: ${queueItem.media_type}` };
            }
        } catch (error) {
            result = { success: false, error: error.message };
        }

        // Update queue status
        const updateData = {
            vk_status: result.success ? 'posted' : 'failed',
            vk_post_id: result.postId || null,
            updated_at: new Date().toISOString()
        };

        if (!result.success) {
            updateData.error_log = {
                ...queueItem.error_log,
                vk: { error: result.error, timestamp: new Date().toISOString() }
            };
        }

        await this.supabase
            .from('crosspost_queue')
            .update(updateData)
            .eq('id', queueItem.id);

        if (result.success) {
            this.stats.crossPosted.vk++;
        }

        return result;
    }

    // ==========================================
    // Main Orchestration
    // ==========================================

    /**
     * Full polling cycle: fetch Instagram → find new → save → crosspost
     */
    async runPollCycle() {
        if (this.isPolling) {
            console.log('[CrossPost] Already polling, skipping...');
            return { skipped: true };
        }

        this.isPolling = true;
        console.log(`[CrossPost] 🔄 Starting poll cycle...`);

        try {
            // Step 1: Fetch latest Instagram posts
            const posts = await this.fetchInstagramPosts(10);
            this.stats.totalPolled++;

            // Step 2: Filter out already-processed posts
            const newPosts = await this.filterNewPosts(posts);

            if (newPosts.length === 0) {
                console.log('[CrossPost] No new posts found');
                this.lastPollTime = new Date().toISOString();
                return { newPosts: 0 };
            }

            // Step 3: Save new posts to queue
            const savedPosts = await this.saveToQueue(newPosts);

            // Step 4: Cross-post to Facebook + VK
            const fbResults = [];
            const vkResults = [];
            for (const post of savedPosts) {
                // Facebook
                const fbResult = await this.crossPostToFacebook(post);
                fbResults.push({
                    instagramId: post.instagram_post_id,
                    facebook: fbResult
                });

                // VK
                const vkResult = await this.crossPostToVK(post);
                vkResults.push({
                    instagramId: post.instagram_post_id,
                    vk: vkResult
                });

                // Small delay between posts to avoid rate limiting
                await new Promise(resolve => setTimeout(resolve, 2000));
            }

            this.lastPollTime = new Date().toISOString();

            const summary = {
                newPosts: newPosts.length,
                crossPosted: {
                    facebook: fbResults.filter(r => r.facebook.success).length,
                    vk: vkResults.filter(r => r.vk.success).length
                },
                errors: fbResults.filter(r => !r.facebook.success).length + vkResults.filter(r => !r.vk.success).length,
                details: { facebook: fbResults, vk: vkResults }
            };

            console.log(`[CrossPost] ✅ Cycle complete: ${summary.newPosts} new, ${summary.crossPosted.facebook} to Facebook, ${summary.crossPosted.vk} to VK`);
            return summary;

        } catch (error) {
            console.error('[CrossPost] Poll cycle error:', error.message);
            this.stats.errors++;
            return { error: error.message };
        } finally {
            this.isPolling = false;
        }
    }

    /**
     * Retry failed cross-posts AND posts stuck in 'pending' for over 10 minutes.
     * This fixes the case where posts were added to the queue but never processed
     * (e.g., VK credentials were added after the post was queued).
     */
    async retryFailed() {
        const tenMinutesAgo = new Date(Date.now() - 10 * 60 * 1000).toISOString();

        // Get posts that explicitly failed OR have been pending for too long (stuck)
        const { data: failed } = await this.supabase
            .from('crosspost_queue')
            .select('*')
            .or(
                `facebook_status.eq.failed,vk_status.eq.failed,and(vk_status.eq.pending,created_at.lt.${tenMinutesAgo}),and(facebook_status.eq.pending,created_at.lt.${tenMinutesAgo})`
            )
            .order('created_at', { ascending: false })
            .limit(10);

        if (!failed || failed.length === 0) {
            console.log('[CrossPost] No failed posts to retry');
            return { retried: 0 };
        }

        console.log(`[CrossPost] Retrying ${failed.length} failed posts...`);
        let retried = { facebook: 0, vk: 0 };

        for (const item of failed) {
            if (item.facebook_status === 'failed' || item.facebook_status === 'pending') {
                const fbResult = await this.crossPostToFacebook(item);
                if (fbResult.success) retried.facebook++;
            }
            if (item.vk_status === 'failed' || item.vk_status === 'pending') {
                const vkResult = await this.crossPostToVK(item);
                if (vkResult.success) retried.vk++;
            }
            await new Promise(resolve => setTimeout(resolve, 2000));
        }

        return { retried, total: failed.length };
    }

    /**
     * Get queue status and stats
     */
    async getQueueStatus() {
        const { data: queue } = await this.supabase
            .from('crosspost_queue')
            .select('*')
            .order('created_at', { ascending: false })
            .limit(20);

        // Count by status
        const counts = {
            total: queue?.length || 0,
            facebook: { pending: 0, posted: 0, failed: 0, skipped: 0 },
            youtube: { pending: 0, posted: 0, failed: 0, skipped: 0 },
            vk: { pending: 0, posted: 0, failed: 0, skipped: 0 }
        };

        for (const item of (queue || [])) {
            counts.facebook[item.facebook_status] = (counts.facebook[item.facebook_status] || 0) + 1;
            counts.youtube[item.youtube_status] = (counts.youtube[item.youtube_status] || 0) + 1;
            counts.vk[item.vk_status] = (counts.vk[item.vk_status] || 0) + 1;
        }

        return {
            isPolling: this.isPolling,
            lastPollTime: this.lastPollTime,
            stats: this.stats,
            counts,
            recentPosts: (queue || []).map(q => ({
                id: q.id,
                instagramId: q.instagram_post_id,
                mediaType: q.media_type,
                caption: q.caption?.substring(0, 100) + (q.caption?.length > 100 ? '...' : ''),
                permalink: q.permalink,
                postedAt: q.posted_at,
                statuses: {
                    facebook: q.facebook_status,
                    youtube: q.youtube_status,
                    vk: q.vk_status
                },
                createdAt: q.created_at
            }))
        };
    }
}

module.exports = new CrossPostService();
