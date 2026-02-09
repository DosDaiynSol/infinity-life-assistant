require('dotenv').config();
const express = require('express');
const cors = require('cors');
const path = require('path');
const MessageBuffer = require('./buffer');
const { handleCommentBatch } = require('./handlers/comments');
const { handleDMBatch } = require('./handlers/dm');
const userManager = require('./services/user-manager');
const statsManager = require('./services/stats-manager');

// YouTube services
const youtubeOAuth = require('./services/youtube-oauth');
const youtubeAPI = require('./services/youtube-api');
const youtubeHandler = require('./handlers/youtube');

// Google Business Profile services
const googleBusinessOAuth = require('./services/google-business-oauth');
const googleBusinessAPI = require('./services/google-business-api');

// Threads Keyword Search services
const threadsKeywordSearch = require('./services/threads-keyword-search');
const schedule = require('node-schedule');

const app = express();
const PORT = process.env.PORT || 3000;

// Middleware
app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, '../dashboard')));

// Initialize message buffer
const buffer = new MessageBuffer();

// In-memory history (for current session)
const sessionHistory = [];

// Process buffer function - reusable for auto and manual triggers
async function processBuffer() {
  const batch = buffer.flush();

  if (batch.comments.length === 0 && batch.dms.length === 0) {
    console.log(`[${new Date().toISOString()}] Buffer empty, nothing to process`);
    return { comments: 0, dms: 0, responses: 0 };
  }

  console.log(`[${new Date().toISOString()}] Processing batch: ${batch.comments.length} comments, ${batch.dms.length} DMs`);

  let responsesCount = 0;

  // Process comments
  if (batch.comments.length > 0) {
    const commentResults = await handleCommentBatch(batch.comments);
    const responded = commentResults.filter(r => r.responded).length;
    responsesCount += responded;
    statsManager.trackInstagramResponse(responded);

    commentResults.forEach(r => {
      statsManager.trackInstagramComment(r.username);
      statsManager.addInstagramHistory({
        type: 'comment',
        ...r,
        timestamp: new Date().toISOString()
      });
    });
  }

  // Process DMs
  if (batch.dms.length > 0) {
    const dmResults = await handleDMBatch(batch.dms);
    const responded = dmResults.filter(r => r.responded).length;
    responsesCount += responded;
    statsManager.trackInstagramResponse(responded);

    dmResults.forEach(r => {
      statsManager.trackInstagramDM(r.senderId);
      statsManager.addInstagramHistory({
        type: 'dm',
        ...r,
        timestamp: new Date().toISOString()
      });
    });
  }

  return {
    comments: batch.comments.length,
    dms: batch.dms.length,
    responses: responsesCount
  };
}

// Auto-process buffer every minute (Instagram)
setInterval(processBuffer, 60000);

// YouTube auto-polling - every 5 minutes
const YOUTUBE_POLL_INTERVAL = 5 * 60 * 1000; // 5 minutes
let youtubeLastProcessed = null;

async function processYouTubeComments() {
  if (!youtubeOAuth.isAuthorized()) {
    console.log('[YouTube Polling] Not authorized, skipping...');
    return { processed: 0, responded: 0 };
  }

  console.log(`[${new Date().toISOString()}] [YouTube Polling] Starting...`);

  try {
    const result = await youtubeHandler.processChannelComments(5); // Last 5 videos
    youtubeLastProcessed = new Date().toISOString();

    // Add to persistent stats
    for (const videoResult of result.results || []) {
      if (videoResult.results) {
        for (const comment of videoResult.results) {
          if (comment.responded) {
            statsManager.trackYouTubeResponse(videoResult.videoId, 1);
            statsManager.addYouTubeHistory({
              videoId: videoResult.videoId,
              videoTitle: videoResult.videoTitle,
              author: comment.author,
              comment: comment.text,
              response: comment.response,
              timestamp: new Date().toISOString()
            });
          }
        }
      }
      if (videoResult.videoId) {
        statsManager.trackYouTubeComment(videoResult.videoId);
      }
    }

    console.log(`[YouTube Polling] Done. Replied to ${result.totalReplied || 0} comments.`);
    return result;
  } catch (error) {
    console.error('[YouTube Polling] Error:', error.message);
    return { error: error.message };
  }
}

// Start YouTube polling
setInterval(processYouTubeComments, YOUTUBE_POLL_INTERVAL);
// Also run once after 30 seconds of server start
setTimeout(processYouTubeComments, 30000);

// Webhook endpoint
app.post('/webhook', (req, res) => {
  const body = req.body;
  console.log('[Webhook received]', JSON.stringify(body, null, 2));

  if (body.object === 'instagram') {
    for (const entry of body.entry || []) {
      // Handle Direct Messages
      if (entry.messaging) {
        for (const msg of entry.messaging) {
          if (msg.message && !msg.message.is_deleted && msg.message.text) {
            buffer.addDM({
              senderId: msg.sender.id,
              messageId: msg.message.mid,
              text: msg.message.text,
              timestamp: msg.timestamp
            });
            console.log(`[DM] From: ${msg.sender.id}, Text: ${msg.message.text}`);
          }
        }
      }

      // Handle Comments
      if (entry.changes) {
        for (const change of entry.changes) {
          if (change.field === 'comments' && change.value) {
            const val = change.value;
            buffer.addComment({
              commentId: val.id,
              userId: val.from?.id,
              username: val.from?.username,
              text: val.text,
              mediaId: val.media?.id
            });
            console.log(`[Comment] From: @${val.from?.username}, Text: ${val.text}`);
          }
        }
      }
    }
  }

  res.status(200).json({ status: 'ok' });
});

// API endpoints for dashboard
app.get('/api/stats', (req, res) => {
  const instagramStats = statsManager.getInstagramStats();
  res.json({
    totalMessages: instagramStats.totalMessages,
    totalComments: instagramStats.totalComments,
    responsesSet: instagramStats.responsesSet,
    lastProcessed: instagramStats.lastUpdated,
    uniqueDMSenders: instagramStats.uniqueDMSenders,
    uniqueCommenters: instagramStats.uniqueCommenters,
    dailyStats: instagramStats.dailyStats,
    bufferSize: {
      comments: buffer.comments.length,
      dms: buffer.dms.length
    }
  });
});

app.get('/api/history', (req, res) => {
  res.json(statsManager.getInstagramHistory().slice().reverse());
});

app.get('/api/buffer', (req, res) => {
  res.json({
    comments: buffer.comments,
    dms: buffer.dms
  });
});

// Manual process trigger
app.post('/api/process-now', async (req, res) => {
  console.log('[Manual trigger] Processing buffer now...');
  try {
    const result = await processBuffer();
    res.json({
      status: 'ok',
      processed: result,
      timestamp: new Date().toISOString()
    });
  } catch (error) {
    console.error('[Manual trigger error]', error);
    res.status(500).json({ status: 'error', message: error.message });
  }
});

// User management API
app.get('/api/users', (req, res) => {
  const users = userManager.getAllUsers();
  res.json(users);
});

app.get('/api/users/:id', (req, res) => {
  const user = userManager.getUser(req.params.id);
  res.json(user);
});

app.post('/api/users/:id/toggle-ai', (req, res) => {
  const { type } = req.body; // 'dm', 'comment', or 'all'
  const user = userManager.toggleAI(req.params.id, type || 'all');
  if (user) {
    console.log(`[Toggle] User ${req.params.id}: AI ${type || 'all'} = ${user.aiEnabled}`);
    res.json({ status: 'ok', user });
  } else {
    res.status(404).json({ status: 'error', message: 'User not found' });
  }
});

app.get('/api/users/:id/conversation', (req, res) => {
  const history = userManager.getConversation(req.params.id);
  res.json(history);
});

app.delete('/api/users/:id/conversation', (req, res) => {
  userManager.clearConversation(req.params.id);
  res.json({ status: 'ok' });
});

// ==========================================
// YouTube API Routes
// ==========================================

// YouTube OAuth - Start authorization
app.get('/auth/youtube', (req, res) => {
  const authUrl = youtubeOAuth.getAuthUrl();
  console.log('[YouTube OAuth] Redirecting to Google authorization');
  res.redirect(authUrl);
});

// YouTube OAuth - Callback handler
app.get('/auth/youtube/callback', async (req, res) => {
  const { code, error } = req.query;

  if (error) {
    console.error('[YouTube OAuth] Authorization error:', error);
    return res.status(400).send(`Authorization failed: ${error}`);
  }

  if (!code) {
    return res.status(400).send('Missing authorization code');
  }

  const result = await youtubeOAuth.exchangeCode(code);

  if (result.success) {
    res.send(`
      <html>
        <head><title>YouTube Authorization Success</title></head>
        <body style="font-family: Arial, sans-serif; text-align: center; padding: 50px;">
          <h1>✅ YouTube авторизация успешна!</h1>
          <p>Токены сохранены. Теперь бот может отвечать на комментарии.</p>
          <a href="/">Вернуться к Dashboard</a>
        </body>
      </html>
    `);
  } else {
    res.status(500).send(`Authorization failed: ${JSON.stringify(result.error)}`);
  }
});

// YouTube status check
app.get('/api/youtube/status', (req, res) => {
  const ytStats = statsManager.getYouTubeStats();
  res.json({
    authorized: youtubeOAuth.isAuthorized(),
    channelId: process.env.YOUTUBE_CHANNEL_ID || 'not set',
    pollingInterval: YOUTUBE_POLL_INTERVAL / 1000 / 60 + ' minutes',
    stats: {
      ...youtubeHandler.getStats(),
      totalComments: ytStats.totalComments,
      totalResponses: ytStats.totalResponses,
      lastProcessed: youtubeLastProcessed || ytStats.lastUpdated,
      processedVideos: ytStats.processedVideos
    }
  });
});

// YouTube history
app.get('/api/youtube/history', (req, res) => {
  res.json(statsManager.getYouTubeHistory().slice().reverse());
});

// Get video comments
app.get('/api/youtube/comments', async (req, res) => {
  try {
    const { videoId } = req.query;
    if (!videoId) {
      return res.status(400).json({ error: 'videoId is required' });
    }

    const comments = await youtubeAPI.getVideoComments(videoId);
    res.json({ videoId, count: comments.length, comments });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Get channel videos
app.get('/api/youtube/videos', async (req, res) => {
  try {
    const videos = await youtubeAPI.getChannelVideos(10);
    res.json({ count: videos.length, videos });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Process comments for a specific video
app.post('/api/youtube/process-video', async (req, res) => {
  try {
    const { videoId } = req.body;
    if (!videoId) {
      return res.status(400).json({ error: 'videoId is required' });
    }

    console.log(`[YouTube API] Manual trigger: processing video ${videoId}`);
    const result = await youtubeHandler.processVideoComments(videoId);
    res.json({ status: 'ok', ...result });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Process comments for all recent videos
app.post('/api/youtube/process-channel', async (req, res) => {
  try {
    const { videoCount = 5 } = req.body;
    console.log(`[YouTube API] Manual trigger: processing ${videoCount} recent videos`);
    const result = await youtubeHandler.processChannelComments(videoCount);
    res.json({ status: 'ok', ...result });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// n8n webhook for YouTube notifications
app.post('/webhook/youtube', async (req, res) => {
  const body = req.body;
  console.log('[YouTube Webhook] Received:', JSON.stringify(body, null, 2));

  // Handle video upload notification from n8n
  if (body.videoId) {
    try {
      const result = await youtubeHandler.processVideoComments(body.videoId);
      res.json({ status: 'ok', ...result });
    } catch (error) {
      console.error('[YouTube Webhook] Error:', error.message);
      res.status(500).json({ error: error.message });
    }
  } else {
    res.json({ status: 'ok', message: 'No videoId provided' });
  }
});

// ==========================================
// Google Business Profile API Routes
// ==========================================

// Google Business OAuth - Start authorization
app.get('/auth/google', (req, res) => {
  const authUrl = googleBusinessOAuth.getAuthUrl();
  console.log('[Google Business OAuth] Redirecting to Google authorization');
  res.redirect(authUrl);
});

// Google Business OAuth - Callback handler
app.get('/auth/google/callback', async (req, res) => {
  const { code, error } = req.query;

  if (error) {
    console.error('[Google Business OAuth] Authorization error:', error);
    return res.status(400).send(`Authorization failed: ${error}`);
  }

  if (!code) {
    return res.status(400).send('Missing authorization code');
  }

  const result = await googleBusinessOAuth.exchangeCode(code);

  if (result.success) {
    res.send(`
      <html>
        <head><title>Google Business Authorization Success</title></head>
        <body style="font-family: Arial, sans-serif; text-align: center; padding: 50px;">
          <h1>✅ Google Business Profile авторизация успешна!</h1>
          <p>Токены сохранены. Теперь можно мониторить отзывы Google Maps.</p>
          <a href="/">Вернуться к Dashboard</a>
        </body>
      </html>
    `);
  } else {
    res.status(500).send(`Authorization failed: ${JSON.stringify(result.error)}`);
  }
});

// Google Business status check
app.get('/api/google/status', (req, res) => {
  res.json({
    authorized: googleBusinessAPI.isAuthorized(),
    locationId: process.env.GOOGLE_LOCATION_ID || 'not set',
    accountId: process.env.GOOGLE_ACCOUNT_ID || 'not set'
  });
});

// Get Google Business accounts (to find account ID)
app.get('/api/google/accounts', async (req, res) => {
  try {
    const accounts = await googleBusinessAPI.listAccounts();
    res.json({ count: accounts.length, accounts });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Get locations for an account
app.get('/api/google/locations', async (req, res) => {
  try {
    const { accountId } = req.query;
    if (!accountId) {
      return res.status(400).json({ error: 'accountId is required' });
    }
    const locations = await googleBusinessAPI.listLocations(accountId);
    res.json({ count: locations.length, locations });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Get all reviews for INFINITY LIFE
app.get('/api/google/reviews', async (req, res) => {
  try {
    const reviews = await googleBusinessAPI.getAllReviews();
    res.json(reviews);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Reply to a review
app.post('/api/google/reviews/reply', async (req, res) => {
  try {
    const { reviewName, comment } = req.body;
    if (!reviewName || !comment) {
      return res.status(400).json({ error: 'reviewName and comment are required' });
    }
    const result = await googleBusinessAPI.replyToReview(reviewName, comment);
    res.json({ status: 'ok', result });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Delete a reply
app.delete('/api/google/reviews/reply', async (req, res) => {
  try {
    const { reviewName } = req.body;
    if (!reviewName) {
      return res.status(400).json({ error: 'reviewName is required' });
    }
    const result = await googleBusinessAPI.deleteReply(reviewName);
    res.json({ status: 'ok', result });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// ==========================================
// Threads Keyword Search API Routes
// ==========================================

// Threads search status
app.get('/api/threads/status', async (req, res) => {
  try {
    const stats = await threadsKeywordSearch.getStats();
    res.json({
      enabled: true,
      schedule: ['08:00', '14:00', '20:00'],
      maxRepliesPerDay: 10,
      stats
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Get found posts
app.get('/api/threads/posts', async (req, res) => {
  try {
    const { status = 'all' } = req.query;
    const threadsDB = require('./services/threads-database');
    let posts;
    if (status === 'all') {
      posts = await threadsDB.getPostsByStatus('new', 100);
      const validated = await threadsDB.getPostsByStatus('validated', 100);
      const replied = await threadsDB.getPostsByStatus('replied', 100);
      posts = [...posts, ...validated, ...replied];
    } else {
      posts = await threadsDB.getPostsByStatus(status, 100);
    }
    res.json({ count: posts.length, posts });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Manual trigger - run search cycle
app.post('/api/threads/search', async (req, res) => {
  try {
    console.log('[Threads] Manual search triggered');
    const stats = await threadsKeywordSearch.runManualCycle();
    res.json({ status: 'ok', stats });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Manual trigger - validate new posts only (no new search)
app.post('/api/threads/validate', async (req, res) => {
  try {
    console.log('[Threads] Manual validation triggered');
    await threadsKeywordSearch.processNewPosts();
    const stats = await threadsKeywordSearch.getStats();
    res.json({ status: 'ok', stats });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Schedule Threads keyword search - 3 cycles per day
// Cycle 1: 08:00
schedule.scheduleJob('0 8 * * *', async () => {
  console.log('[Threads Schedule] Running cycle 1 (08:00)');
  await threadsKeywordSearch.runSearchCycle(0);
});

// Cycle 2: 14:00
schedule.scheduleJob('0 14 * * *', async () => {
  console.log('[Threads Schedule] Running cycle 2 (14:00)');
  await threadsKeywordSearch.runSearchCycle(1);
});

// Cycle 3: 20:00
schedule.scheduleJob('0 20 * * *', async () => {
  console.log('[Threads Schedule] Running cycle 3 (20:00)');
  await threadsKeywordSearch.runSearchCycle(2);
});

// Dashboard route
app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, '../dashboard/index.html'));
});

app.listen(PORT, () => {
  console.log(`\n🚀 INFINITY LIFE Assistant Server running on http://localhost:${PORT}`);
  console.log(`📊 Dashboard: http://localhost:${PORT}`);
  console.log(`📸 Instagram Webhook: http://localhost:${PORT}/webhook`);
  console.log(`📺 YouTube OAuth: http://localhost:${PORT}/auth/youtube`);
  console.log(`📺 YouTube Webhook: http://localhost:${PORT}/webhook/youtube`);
  console.log(`📍 Google Business OAuth: http://localhost:${PORT}/auth/google`);
  console.log(`🧵 Threads Search: /api/threads/status | /api/threads/search`);
  console.log(`⏱️  Buffer processing: every 60 seconds`);
  console.log(`🎬 YouTube authorized: ${youtubeOAuth.isAuthorized() ? 'Yes ✅' : 'No ❌ - visit /auth/youtube'}`);
  console.log(`📍 Google Business authorized: ${googleBusinessOAuth.isAuthorized() ? 'Yes ✅' : 'No ❌ - visit /auth/google'}`);
  console.log(`🧵 Threads Search scheduled: 08:00, 14:00, 20:00\n`);
});
