require('dotenv').config();
const express = require('express');
const cors = require('cors');
const path = require('path');
const MessageBuffer = require('./buffer');
const { handleCommentBatch } = require('./handlers/comments');
const { handleDMBatch } = require('./handlers/dm');
const userManager = require('./services/user-manager');

const app = express();
const PORT = process.env.PORT || 3000;

// Middleware
app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, '../dashboard')));

// Initialize message buffer
const buffer = new MessageBuffer();

// Stats storage
const stats = {
  totalMessages: 0,
  totalComments: 0,
  responsesSet: 0,
  lastProcessed: null,
  history: [],
  uniqueDMSenders: new Set(),
  uniqueCommenters: new Set(),
  dailyStats: {} // { 'YYYY-MM-DD': { dms: 0, comments: 0, responses: 0 } }
};

// Helper to get today's date key
function getTodayKey() {
  return new Date().toISOString().split('T')[0];
}

// Update daily stats
function trackDaily(type, count = 1) {
  const key = getTodayKey();
  if (!stats.dailyStats[key]) {
    stats.dailyStats[key] = { dms: 0, comments: 0, responses: 0 };
  }
  stats.dailyStats[key][type] += count;
}

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
    stats.responsesSet += responded;
    trackDaily('responses', responded);
    stats.history.push(...commentResults.map(r => ({
      type: 'comment',
      ...r,
      timestamp: new Date().toISOString()
    })));
  }

  // Process DMs
  if (batch.dms.length > 0) {
    const dmResults = await handleDMBatch(batch.dms);
    const responded = dmResults.filter(r => r.responded).length;
    responsesCount += responded;
    stats.responsesSet += responded;
    trackDaily('responses', responded);
    stats.history.push(...dmResults.map(r => ({
      type: 'dm',
      ...r,
      timestamp: new Date().toISOString()
    })));
  }

  stats.lastProcessed = new Date().toISOString();

  // Keep only last 100 history items
  if (stats.history.length > 100) {
    stats.history = stats.history.slice(-100);
  }

  return {
    comments: batch.comments.length,
    dms: batch.dms.length,
    responses: responsesCount
  };
}

// Auto-process buffer every minute
setInterval(processBuffer, 60000);

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
            stats.totalMessages++;
            stats.uniqueDMSenders.add(msg.sender.id);
            trackDaily('dms');
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
            stats.totalComments++;
            if (val.from?.id) stats.uniqueCommenters.add(val.from.id);
            trackDaily('comments');
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
  res.json({
    totalMessages: stats.totalMessages,
    totalComments: stats.totalComments,
    responsesSet: stats.responsesSet,
    lastProcessed: stats.lastProcessed,
    uniqueDMSenders: stats.uniqueDMSenders.size,
    uniqueCommenters: stats.uniqueCommenters.size,
    dailyStats: stats.dailyStats,
    bufferSize: {
      comments: buffer.comments.length,
      dms: buffer.dms.length
    }
  });
});

app.get('/api/history', (req, res) => {
  res.json(stats.history.slice().reverse());
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

// Dashboard route
app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, '../dashboard/index.html'));
});

app.listen(PORT, () => {
  console.log(`\n🚀 Instagram Assistant Server running on http://localhost:${PORT}`);
  console.log(`📊 Dashboard: http://localhost:${PORT}`);
  console.log(`🔗 Webhook endpoint: http://localhost:${PORT}/webhook`);
  console.log(`⏱️  Buffer processing: every 60 seconds\n`);
});
