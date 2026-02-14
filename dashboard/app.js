// Dashboard App v3 - with User Management
const API_BASE = window.location.origin;

// State
let countdownValue = 60;
let countdownInterval;
let statsChart = null;
let cachedHistory = [];
let cachedUsers = [];
let cachedBuffer = { dms: [], comments: [] };
let activeTab = 'buffer';

// Initialize
document.addEventListener('DOMContentLoaded', () => {
  initChart();
  loadAll();
  startCountdown();

  setInterval(loadStats, 5000);
  setInterval(loadBuffer, 3000);
  setInterval(loadHistory, 10000);
});

// Tabs
function switchTab(tab) {
  activeTab = tab;
  document.querySelectorAll('.tab').forEach(t => t.classList.remove('active'));
  document.querySelectorAll('.tab-content').forEach(c => c.classList.remove('active'));

  document.querySelector(`.tab:nth-child(${['buffer', 'users', 'history', 'chart'].indexOf(tab) + 1})`).classList.add('active');
  document.getElementById(`tab-${tab}`).classList.add('active');

  if (tab === 'users') loadUsers();
  if (tab === 'history') loadHistory();
}

// Countdown
function startCountdown() {
  countdownValue = 60;
  if (countdownInterval) clearInterval(countdownInterval);

  countdownInterval = setInterval(() => {
    countdownValue--;
    document.getElementById('countdown').textContent = countdownValue;
    if (countdownValue <= 0) {
      countdownValue = 60;
      loadAll();
    }
  }, 1000);
}

async function loadAll() {
  await Promise.all([loadStats(), loadBuffer(), loadHistory()]);
}

// Manual run
async function manualRun() {
  const btn = document.getElementById('btnManualRun');
  btn.textContent = '⏳ Обрабатываю...';
  btn.classList.add('loading');

  try {
    await fetch(`${API_BASE}/api/process-now`, { method: 'POST' });
    btn.textContent = '✅ Готово!';
    countdownValue = 60;
    await loadAll();

    setTimeout(() => {
      btn.textContent = '▶️ Запустить сейчас';
      btn.classList.remove('loading');
    }, 1500);
  } catch (error) {
    btn.textContent = '❌ Ошибка';
    setTimeout(() => {
      btn.textContent = '▶️ Запустить сейчас';
      btn.classList.remove('loading');
    }, 2000);
  }
}

// Stats
async function loadStats() {
  try {
    const response = await fetch(`${API_BASE}/api/stats`);
    const stats = await response.json();

    updateText('totalMessages', stats.totalMessages);
    updateText('totalComments', stats.totalComments);
    updateText('responsesSet', stats.responsesSet);
    updateText('dmDetail', `от ${stats.uniqueDMSenders || 0} контактов`);
    updateText('commentDetail', `от ${stats.uniqueCommenters || 0} польз.`);

    const total = stats.totalMessages + stats.totalComments;
    const rate = total > 0 ? Math.round((stats.responsesSet / total) * 100) : 0;
    updateText('responseRate', `${rate}% конверсия`);

    if (stats.lastProcessed) {
      updateText('lastProcessed', new Date(stats.lastProcessed).toLocaleTimeString('ru-RU'));
    }

    if (stats.dailyStats) updateChart(stats.dailyStats);
  } catch (error) {
    console.error('Stats error:', error);
  }
}

// Buffer
async function loadBuffer() {
  try {
    const response = await fetch(`${API_BASE}/api/buffer`);
    const buffer = await response.json();
    cachedBuffer = buffer;

    const dmCount = buffer.dms?.length || 0;
    const commentCount = buffer.comments?.length || 0;

    updateText('bufferTotal', dmCount + commentCount);
    updateText('bufferDMCount', dmCount);
    updateText('bufferCommentCount', commentCount);

    renderBufferList('bufferDMList', buffer.dms || [], 'dm');
    renderBufferList('bufferCommentList', buffer.comments || [], 'comment');
  } catch (error) {
    console.error('Buffer error:', error);
  }
}

function renderBufferList(containerId, items, type) {
  const container = document.getElementById(containerId);
  if (items.length === 0) {
    container.innerHTML = '<div class="buffer-empty">Пусто</div>';
    return;
  }

  container.innerHTML = items.map(item => {
    const user = type === 'dm' ? (item.senderId?.substring(0, 8) + '...') : `@${item.username || 'user'}`;
    return `<div class="buffer-item">
      <div class="buffer-item-user">${escapeHtml(user)}</div>
      <div class="buffer-item-text">${escapeHtml(item.text || '-')}</div>
    </div>`;
  }).join('');
}

// History
async function loadHistory() {
  try {
    const response = await fetch(`${API_BASE}/api/history`);
    const history = await response.json();

    if (JSON.stringify(history) === JSON.stringify(cachedHistory)) return;
    cachedHistory = history;

    const container = document.getElementById('historyList');
    if (history.length === 0) {
      container.innerHTML = '<div class="empty-state">Ожидание первых сообщений...</div>';
      return;
    }

    container.innerHTML = history.slice(0, 20).map(renderHistoryItem).join('');
  } catch (error) {
    console.error('History error:', error);
  }
}

function renderHistoryItem(item) {
  const time = new Date(item.timestamp).toLocaleTimeString('ru-RU');
  const isComment = item.type === 'comment';

  let statusClass = 'skipped';
  let statusText = 'Пропущено';
  let statusIcon = '⏭️';
  let rejectionInfo = '';

  if (item.responded || item.status === 'sent') {
    statusClass = 'sent';
    statusText = 'Отправлено';
    statusIcon = '✅';
  } else if (item.error || item.status === 'error') {
    statusClass = 'error';
    statusText = 'Ошибка';
    statusIcon = '❌';
  } else if (item.rejection) {
    statusClass = 'skipped';
    statusIcon = item.rejection.icon || '⏭️';
    statusText = item.rejection.label || 'Пропущено';
    rejectionInfo = `<div class="rejection-badge">${item.rejection.icon} ${item.rejection.label}</div>`;
  }

  const messageText = item.text || (item.messages || []).join(' | ');
  const username = item.username || item.senderId?.substring(0, 10) || item.userId?.substring(0, 10) || 'Unknown';

  return `<div class="history-item ${statusClass}">
    <div class="history-header">
      <span class="history-type ${isComment ? 'comment' : 'dm'}">${isComment ? '📝' : '💬'} ${isComment ? 'Comment' : 'DM'}</span>
      <div class="history-meta">
        <span class="history-status ${statusClass}">${statusIcon} ${statusText}</span>
        <span class="history-time">${time}</span>
      </div>
    </div>
    <div class="history-content">
      <div class="history-user">${isComment ? '@' : ''}${escapeHtml(username)}</div>
      <div class="history-text">${escapeHtml(messageText)}</div>
      ${item.response ? `<div class="history-response">↳ ${escapeHtml(item.response)}</div>` : ''}
      ${rejectionInfo}
    </div>
  </div>`;
}

// Users
async function loadUsers() {
  try {
    const response = await fetch(`${API_BASE}/api/users`);
    const users = await response.json();
    cachedUsers = users;

    const container = document.getElementById('usersList');
    if (users.length === 0) {
      container.innerHTML = '<div class="empty-state">Пока нет пользователей</div>';
      return;
    }

    container.innerHTML = users.sort((a, b) => new Date(b.lastSeen) - new Date(a.lastSeen))
      .map(renderUserItem).join('');
  } catch (error) {
    console.error('Users error:', error);
  }
}

function renderUserItem(user) {
  const lastSeen = user.lastSeen ? new Date(user.lastSeen).toLocaleString('ru-RU') : '-';
  const username = user.username || user.id?.substring(0, 12);
  const aiEnabled = user.aiEnabled !== false;
  const dmEnabled = user.dmEnabled !== false;
  const commentEnabled = user.commentEnabled !== false;

  return `<div class="user-item">
    <div class="user-info">
      <div class="user-name">${user.username ? '@' : ''}${escapeHtml(username)}</div>
      <div class="user-stats">
        💬 ${user.messageCount || 0} DM · 📝 ${user.commentCount || 0} комм · ⏰ ${lastSeen}
      </div>
    </div>
    <div class="user-controls">
      <button class="toggle-btn ${dmEnabled && aiEnabled ? 'on' : 'off'}" onclick="toggleAI('${user.id}', 'dm')">
        💬 DM ${dmEnabled && aiEnabled ? 'ВКЛ' : 'ВЫКЛ'}
      </button>
      <button class="toggle-btn ${commentEnabled && aiEnabled ? 'on' : 'off'}" onclick="toggleAI('${user.id}', 'comment')">
        📝 Комм ${commentEnabled && aiEnabled ? 'ВКЛ' : 'ВЫКЛ'}
      </button>
    </div>
  </div>`;
}

async function toggleAI(userId, type) {
  try {
    await fetch(`${API_BASE}/api/users/${userId}/toggle-ai`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ type })
    });
    await loadUsers();
  } catch (error) {
    console.error('Toggle error:', error);
  }
}

// Filter users by search query
function filterUsers(query) {
  const container = document.getElementById('usersList');
  if (!cachedUsers || cachedUsers.length === 0) {
    container.innerHTML = '<div class="empty-state">Пока нет пользователей</div>';
    return;
  }

  const searchTerm = query.toLowerCase().trim();
  const filteredUsers = cachedUsers.filter(user => {
    const username = (user.username || user.id || '').toLowerCase();
    const name = (user.name || '').toLowerCase();
    return username.includes(searchTerm) || name.includes(searchTerm);
  });

  if (filteredUsers.length === 0) {
    container.innerHTML = `<div class="empty-state">Не найдено: "${escapeHtml(query)}"</div>`;
    return;
  }

  container.innerHTML = filteredUsers.sort((a, b) => new Date(b.lastSeen) - new Date(a.lastSeen))
    .map(renderUserItem).join('');
}

// Chart
function initChart() {
  const ctx = document.getElementById('statsChart').getContext('2d');
  statsChart = new Chart(ctx, {
    type: 'line',
    data: {
      labels: [],
      datasets: [
        { label: 'DM', data: [], borderColor: '#3b82f6', backgroundColor: 'rgba(59,130,246,0.1)', tension: 0.3, fill: true },
        { label: 'Комментарии', data: [], borderColor: '#8b5cf6', backgroundColor: 'rgba(139,92,246,0.1)', tension: 0.3, fill: true },
        { label: 'Ответы', data: [], borderColor: '#22c55e', backgroundColor: 'rgba(34,197,94,0.1)', tension: 0.3, fill: true }
      ]
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      plugins: { legend: { position: 'top' } },
      scales: { y: { beginAtZero: true } }
    }
  });
}

function updateChart(dailyStats) {
  if (!statsChart || !dailyStats) return;

  const labels = Object.keys(dailyStats).sort();
  statsChart.data.labels = labels.map(d => new Date(d).toLocaleDateString('ru-RU', { day: 'numeric', month: 'short' }));
  statsChart.data.datasets[0].data = labels.map(d => dailyStats[d]?.dms || 0);
  statsChart.data.datasets[1].data = labels.map(d => dailyStats[d]?.comments || 0);
  statsChart.data.datasets[2].data = labels.map(d => dailyStats[d]?.responses || 0);
  statsChart.update('none');
}

// Modal
function showList(type) {
  const modal = document.getElementById('modal');
  const title = document.getElementById('modalTitle');
  const body = document.getElementById('modalBody');

  let items = [];
  if (type === 'dms') { title.textContent = '💬 Direct Messages'; items = cachedHistory.filter(h => h.type === 'dm'); }
  else if (type === 'comments') { title.textContent = '📝 Комментарии'; items = cachedHistory.filter(h => h.type === 'comment'); }
  else if (type === 'responses') { title.textContent = '✅ Ответы'; items = cachedHistory.filter(h => h.responded); }

  body.innerHTML = items.length === 0 ? '<div class="empty-list">Пусто</div>' :
    items.map(item => `<div class="list-item">
      <div class="list-item-header">
        <span class="list-item-user">${item.username ? '@' + item.username : item.senderId?.substring(0, 10)}</span>
        <span class="list-item-time">${item.timestamp ? new Date(item.timestamp).toLocaleString('ru-RU') : ''}</span>
      </div>
      <div class="list-item-text">${escapeHtml(item.text || (item.messages || []).join(' | '))}</div>
      ${item.response ? `<div style="color:var(--accent);margin-top:0.5rem">↳ ${escapeHtml(item.response)}</div>` : ''}
    </div>`).join('');

  modal.classList.add('active');
}

function closeModal(event) {
  if (event && event.target !== event.currentTarget) return;
  document.getElementById('modal').classList.remove('active');
}

// Helpers
function updateText(id, value) {
  const el = document.getElementById(id);
  if (el && el.textContent !== String(value)) el.textContent = value;
}

function escapeHtml(text) {
  const div = document.createElement('div');
  div.textContent = text || '';
  return div.innerHTML;
}

document.addEventListener('keydown', e => { if (e.key === 'Escape') closeModal(); });

// ==========================================
// Platform Switching
// ==========================================
let activePlatform = 'instagram';

function switchPlatform(platform) {
  activePlatform = platform;

  // Update tabs
  document.querySelectorAll('.platform-tab').forEach(t => t.classList.remove('active'));
  document.getElementById(`platform${platform.charAt(0).toUpperCase() + platform.slice(1)}`).classList.add('active');

  // Update content
  document.querySelectorAll('.platform-content').forEach(c => c.classList.remove('active'));
  document.getElementById(`platform-${platform}`).classList.add('active');

  // Load data for YouTube if switching to it
  if (platform === 'youtube') {
    loadYouTubeData();
  }
}

// ==========================================
// YouTube Dashboard
// ==========================================
let ytCachedHistory = [];
let ytCachedVideos = [];

async function loadYouTubeData() {
  await Promise.all([loadYouTubeStatus(), loadYouTubeHistory(), loadYouTubeVideos()]);
}

async function loadYouTubeStatus() {
  try {
    const response = await fetch(`${API_BASE}/api/youtube/status`);
    const data = await response.json();

    const dot = document.getElementById('ytAuthDot');
    const status = document.getElementById('ytAuthStatus');

    if (data.authorized) {
      dot.classList.add('authorized');
      status.textContent = 'Авторизован ✅';
    } else {
      dot.classList.remove('authorized');
      status.textContent = 'Не авторизован ❌';
    }

    updateText('ytPollingInterval', data.pollingInterval || '5 мин');
    updateText('ytLastProcessed', data.stats?.lastProcessed
      ? new Date(data.stats.lastProcessed).toLocaleTimeString('ru-RU')
      : '-');
    updateText('ytVideosCount', data.stats?.processedVideos || 0);
    updateText('ytCommentsCount', data.stats?.totalComments || 0);
    updateText('ytResponsesCount', data.stats?.totalResponses || 0);
  } catch (error) {
    console.error('YouTube status error:', error);
  }
}

async function loadYouTubeHistory() {
  try {
    const response = await fetch(`${API_BASE}/api/youtube/history`);
    const history = await response.json();
    ytCachedHistory = history;

    const container = document.getElementById('ytHistoryList');
    if (history.length === 0) {
      container.innerHTML = '<div class="empty-state">Ожидание ответов...</div>';
      return;
    }

    container.innerHTML = history.slice(0, 20).map(item => `
      <div class="yt-history-item">
        <div class="yt-history-header">
          <span class="yt-video-title">${escapeHtml(item.videoTitle || 'Видео')}</span>
          <span class="yt-time">${item.timestamp ? new Date(item.timestamp).toLocaleTimeString('ru-RU') : ''}</span>
        </div>
        <div class="yt-comment-author">${escapeHtml(item.author)}</div>
        <div class="yt-comment-text">💬 ${escapeHtml(item.comment)}</div>
        <div class="yt-response-text">↳ ${escapeHtml(item.response)}</div>
      </div>
    `).join('');
  } catch (error) {
    console.error('YouTube history error:', error);
  }
}

async function loadYouTubeVideos() {
  try {
    const response = await fetch(`${API_BASE}/api/youtube/videos`);
    const data = await response.json();
    ytCachedVideos = data.videos || [];

    const container = document.getElementById('ytVideosList');
    if (ytCachedVideos.length === 0) {
      container.innerHTML = '<div class="empty-state">Нет видео</div>';
      return;
    }

    container.innerHTML = ytCachedVideos.slice(0, 6).map(video => `
      <div class="yt-video-card" onclick="ytShowVideo('${video.id}')">
        <img class="yt-video-thumb" src="${video.thumbnail}" alt="${escapeHtml(video.title)}" onerror="this.style.display='none'">
        <div class="yt-video-info">
          <div class="yt-video-card-title">${escapeHtml(video.title)}</div>
          <div class="yt-video-date">${new Date(video.publishedAt).toLocaleDateString('ru-RU')}</div>
          <div class="yt-video-actions">
            <button class="yt-process-btn" onclick="event.stopPropagation(); ytProcessVideo('${video.id}')">
              ▶️ Обработать
            </button>
          </div>
        </div>
      </div>
    `).join('');
  } catch (error) {
    console.error('YouTube videos error:', error);
  }
}

async function ytProcessChannel() {
  const btn = document.getElementById('btnYtProcess');
  btn.textContent = '⏳ Обрабатываю...';
  btn.classList.add('loading');

  try {
    await fetch(`${API_BASE}/api/youtube/process-channel`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ videoCount: 5 })
    });
    btn.textContent = '✅ Готово!';
    await loadYouTubeData();

    setTimeout(() => {
      btn.textContent = '▶️ Обработать канал';
      btn.classList.remove('loading');
    }, 2000);
  } catch (error) {
    btn.textContent = '❌ Ошибка';
    setTimeout(() => {
      btn.textContent = '▶️ Обработать канал';
      btn.classList.remove('loading');
    }, 2000);
  }
}

async function ytProcessVideo(videoId) {
  try {
    await fetch(`${API_BASE}/api/youtube/process-video`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ videoId })
    });
    await loadYouTubeData();
  } catch (error) {
    console.error('Process video error:', error);
  }
}

function ytShowVideo(videoId) {
  window.open(`https://youtube.com/watch?v=${videoId}`, '_blank');
}

function ytAuthorize() {
  window.open('/auth/youtube', '_blank');
}

// Refresh YouTube data periodically when on YouTube tab
setInterval(() => {
  if (activePlatform === 'youtube') {
    loadYouTubeStatus();
    loadYouTubeHistory();
  }
}, 60000);

// ==========================================
// Threads Dashboard
// ==========================================
let threadsCachedPosts = { new: [], validated: [], replied: [] };
let threadsActiveTab = 'new';

// Load Threads data when switching to tab
function loadThreadsData() {
  loadThreadsStatus();
  loadThreadsPosts();
  loadThreadsKeywords();
}

// Status
async function loadThreadsStatus() {
  try {
    const response = await fetch(`${API_BASE}/api/threads/status`);
    const data = await response.json();

    updateText('threadsSchedule', data.schedule?.join(', ') || '08:00, 14:00, 20:00');
    updateText('threadsMaxReplies', data.maxRepliesPerDay || 10);
    updateText('threadsApiRequests', data.stats?.apiRequests || 0);
    updateText('threadsPostsFound', data.stats?.postsFound || 0);
    updateText('threadsValidated', data.stats?.validated || 0);
    updateText('threadsReplied', data.stats?.replied || 0);

    // Update conversion rate if element exists
    const convEl = document.getElementById('threadsConversion');
    if (convEl) {
      convEl.textContent = `${data.stats?.conversionRate || 0}% конверсия`;
    }

    // Update chart if data available
    if (data.chartData) {
      updateThreadsChart(data.chartData);
    }
  } catch (error) {
    console.error('Threads status error:', error);
  }
}

// Posts
async function loadThreadsPosts() {
  try {
    const response = await fetch(`${API_BASE}/api/threads/posts`);
    const data = await response.json();

    // Categorize posts
    threadsCachedPosts = { new: [], validated: [], replied: [] };
    (data.posts || []).forEach(post => {
      if (post.status === 'new') threadsCachedPosts.new.push(post);
      else if (post.status === 'validated') threadsCachedPosts.validated.push(post);
      else if (post.status === 'replied') threadsCachedPosts.replied.push(post);
    });

    // Update counts
    updateText('threadsNewCount', threadsCachedPosts.new.length);
    updateText('threadsValidatedCount', threadsCachedPosts.validated.length);
    updateText('threadsRepliedCount', threadsCachedPosts.replied.length);

    // Render current tab
    renderThreadsPosts(threadsActiveTab);
  } catch (error) {
    console.error('Threads posts error:', error);
  }
}

function renderThreadsPosts(status) {
  const containerId = `threads${status.charAt(0).toUpperCase() + status.slice(1)}List`;
  const container = document.getElementById(containerId);
  const posts = threadsCachedPosts[status] || [];

  if (posts.length === 0) {
    container.innerHTML = '<div class="empty-state">Нет постов</div>';
    return;
  }

  container.innerHTML = posts.map(post => {
    const time = post.created_at ? new Date(post.created_at).toLocaleString('ru-RU') : '';
    const replyHtml = post.reply_text ? `
      <div class="threads-post-reply">
        <div class="threads-reply-label">💬 Наш ответ:</div>
        <div class="threads-reply-text">${escapeHtml(post.reply_text)}</div>
      </div>
    ` : '';

    return `
      <div class="threads-post-item ${post.status}">
        <div class="threads-post-header">
          <span class="threads-post-user">@${escapeHtml(post.username || 'unknown')}</span>
          <span class="threads-post-keyword">${escapeHtml(post.keyword_matched || '')}</span>
        </div>
        <div class="threads-post-text">${escapeHtml(post.text || '')}</div>
        <div class="threads-post-footer">
          <span class="threads-post-time">${time}</span>
          ${post.permalink ? `<a href="${post.permalink}" target="_blank" class="threads-post-link">Открыть →</a>` : ''}
        </div>
        ${replyHtml}
      </div>
    `;
  }).join('');
}

// Keywords
async function loadThreadsKeywords() {
  try {
    // Load from static file or use predefined list
    const keywords = [
      'остеопат астана', 'ищу остеопата', 'посоветуйте остеопата',
      'невролог астана', 'невропатолог астана', 'детский невролог астана',
      'мануальный терапевт астана', 'мануальная терапия астана',
      'боль в спине астана', 'болит спина', 'болит поясница',
      'грыжа позвоночника', 'межпозвоночная грыжа', 'лечение грыжи',
      'сколиоз астана', 'сколиоз лечение', 'искривление позвоночника',
      'артроз астана', 'боль в суставах', 'артрит лечение',
      'зрр астана', 'зпр астана', 'задержка речи', 'аутизм астана',
      'мрт астана', 'узи астана', 'кт астана',
      'посоветуйте врача астана', 'посоветуйте клинику астана'
    ];

    const container = document.getElementById('threadsKeywordsList');
    container.innerHTML = keywords.map(kw =>
      `<span class="threads-keyword-tag">${escapeHtml(kw)}</span>`
    ).join('');
  } catch (error) {
    console.error('Threads keywords error:', error);
  }
}

// Tab switching
function switchThreadsTab(tab) {
  threadsActiveTab = tab;

  // Update tab buttons
  document.querySelectorAll('#platform-threads .tab').forEach(t => t.classList.remove('active'));
  const tabIndex = ['new', 'validated', 'replied', 'keywords'].indexOf(tab);
  document.querySelectorAll('#platform-threads .tab')[tabIndex]?.classList.add('active');

  // Update content
  document.querySelectorAll('.threads-tab-content').forEach(c => c.classList.remove('active'));
  document.getElementById(`threads-tab-${tab}`)?.classList.add('active');

  // Render posts if needed
  if (tab !== 'keywords') {
    renderThreadsPosts(tab);
  }
}

// Run search
async function threadsRunSearch() {
  const btn = document.getElementById('btnThreadsSearch');
  btn.textContent = '⏳ Ищу...';
  btn.classList.add('loading');

  try {
    await fetch(`${API_BASE}/api/threads/search`, { method: 'POST' });
    btn.textContent = '✅ Готово!';
    await loadThreadsData();

    setTimeout(() => {
      btn.textContent = '🔍 Запустить поиск';
      btn.classList.remove('loading');
    }, 2000);
  } catch (error) {
    btn.textContent = '❌ Ошибка';
    setTimeout(() => {
      btn.textContent = '🔍 Запустить поиск';
      btn.classList.remove('loading');
    }, 2000);
  }
}

// Refresh
async function threadsRefresh() {
  await loadThreadsData();
}

// Update switchPlatform to load Threads data
const originalSwitchPlatform = switchPlatform;
window.switchPlatform = function (platform) {
  activePlatform = platform;

  // Update tabs
  document.querySelectorAll('.platform-tab').forEach(t => t.classList.remove('active'));
  document.getElementById(`platform${platform.charAt(0).toUpperCase() + platform.slice(1)}`).classList.add('active');

  // Update content
  document.querySelectorAll('.platform-content').forEach(c => c.classList.remove('active'));
  document.getElementById(`platform-${platform}`).classList.add('active');

  // Load data
  if (platform === 'youtube') {
    loadYouTubeData();
  } else if (platform === 'threads') {
    loadThreadsData();
  }
};

// Refresh Threads data periodically when on Threads tab
setInterval(() => {
  if (activePlatform === 'threads') {
    loadThreadsStatus();
  }
}, 60000);

// Threads Chart
let threadsChart = null;

function updateThreadsChart(chartData) {
  const ctx = document.getElementById('threadsChart');
  if (!ctx) return;

  const labels = Object.keys(chartData).map(d => {
    const date = new Date(d);
    return `${date.getDate()}.${date.getMonth() + 1}`;
  });

  const postsData = Object.values(chartData).map(d => d.posts);
  const validatedData = Object.values(chartData).map(d => d.validated);
  const repliedData = Object.values(chartData).map(d => d.replied);

  if (threadsChart) {
    threadsChart.destroy();
  }

  threadsChart = new Chart(ctx.getContext('2d'), {
    type: 'line',
    data: {
      labels,
      datasets: [
        {
          label: 'Найдено',
          data: postsData,
          borderColor: '#6E7BF4',
          backgroundColor: 'rgba(110, 123, 244, 0.1)',
          fill: true,
          tension: 0.4
        },
        {
          label: 'Валидных',
          data: validatedData,
          borderColor: '#4ECDC4',
          backgroundColor: 'transparent',
          tension: 0.4
        },
        {
          label: 'Ответов',
          data: repliedData,
          borderColor: '#00B894',
          backgroundColor: 'transparent',
          tension: 0.4
        }
      ]
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      plugins: {
        legend: { position: 'bottom' }
      },
      scales: {
        y: { beginAtZero: true }
      }
    }
  });
}

console.log('🚀 INFINITY LIFE Dashboard v3 initialized');
console.log('📺 YouTube Dashboard enabled');
console.log('🧵 Threads Dashboard enabled');

// ==========================================
// Google Reviews Dashboard
// ==========================================
let googleCachedReviews = [];
let googlePreviewData = [];

// Load Google data when switching to tab
function loadGoogleData() {
  loadGoogleStatus();
  loadGoogleReviews();
}

// Status
async function loadGoogleStatus() {
  try {
    const response = await fetch(`${API_BASE}/api/google/status`);
    const data = await response.json();

    const dot = document.getElementById('googleAuthDot');
    const status = document.getElementById('googleAuthStatus');

    if (data.authorized) {
      dot?.classList.add('authorized');
      if (status) status.textContent = 'Авторизован ✅';
    } else {
      dot?.classList.remove('authorized');
      if (status) status.textContent = 'Не авторизован ❌';
    }

    updateText('googleLocationId', data.locationId || '-');

    // Load reply stats
    const statsResponse = await fetch(`${API_BASE}/api/google/reviews/stats`);
    const stats = await statsResponse.json();
    updateText('googleRepliedCount', stats.totalReplied || 0);
  } catch (error) {
    console.error('Google status error:', error);
  }
}

// Reviews
async function loadGoogleReviews() {
  try {
    const response = await fetch(`${API_BASE}/api/google/reviews`);
    const data = await response.json();
    googleCachedReviews = data.reviews || [];

    const container = document.getElementById('googleReviewsList');

    // Count stats
    const totalReviews = googleCachedReviews.length;
    const repliedReviews = googleCachedReviews.filter(r => r.reviewReply).length;
    const pendingReviews = totalReviews - repliedReviews;

    updateText('googleTotalReviews', totalReviews);
    updateText('googlePendingReviews', pendingReviews);
    updateText('googleRepliedReviews', repliedReviews);

    if (googleCachedReviews.length === 0) {
      container.innerHTML = '<div class="empty-state">Нет отзывов</div>';
      return;
    }

    container.innerHTML = googleCachedReviews.slice(0, 20).map(review => {
      const hasReply = !!review.reviewReply;
      const stars = getStarsHtml(review.starRating);
      const date = review.createTime ? new Date(review.createTime).toLocaleDateString('ru-RU') : '';
      const avatarUrl = review.reviewer?.profilePhotoUrl || '';

      return `
        <div class="google-review-item ${hasReply ? 'has-reply' : 'no-reply'}">
          <div class="google-review-header">
            <div class="google-review-author">
              ${avatarUrl ? `<img class="google-review-avatar" src="${avatarUrl}" alt="" onerror="this.style.display='none'">` : ''}
              <span class="google-review-name">${escapeHtml(review.reviewer?.displayName || 'Анонимный')}</span>
            </div>
            <div>
              <span class="google-review-stars">${stars}</span>
              <span class="google-review-date">${date}</span>
            </div>
          </div>
          <div class="google-review-text">${escapeHtml(review.comment || '(Без текста)')}</div>
          ${hasReply ? `
            <div class="google-review-reply">
              <div class="google-review-reply-header">💬 Ответ клиники:</div>
              <div class="google-review-reply-text">${escapeHtml(review.reviewReply.comment)}</div>
            </div>
          ` : `
            <button class="google-reply-btn" onclick="googleGenerateOneReply('${review.reviewId}')">
              🤖 Сгенерировать ответ
            </button>
          `}
        </div>
      `;
    }).join('');
  } catch (error) {
    console.error('Google reviews error:', error);
    document.getElementById('googleReviewsList').innerHTML = '<div class="empty-state">Ошибка загрузки</div>';
  }
}

function getStarsHtml(rating) {
  const count = { 'FIVE': 5, 'FOUR': 4, 'THREE': 3, 'TWO': 2, 'ONE': 1 }[rating] || 0;
  return '⭐'.repeat(count);
}

// Dry run - preview generated responses
async function googleDryRun() {
  const btn = document.getElementById('btnGoogleDryRun');
  btn.textContent = '⏳ Генерирую...';
  btn.classList.add('loading');

  try {
    const response = await fetch(`${API_BASE}/api/google/reviews/auto-reply`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ dryRun: true })
    });
    const data = await response.json();
    googlePreviewData = data.results || [];

    // Show preview section
    const previewSection = document.getElementById('googlePreviewSection');
    const previewList = document.getElementById('googlePreviewList');

    // Filter only items that would get a response
    const previewItems = googlePreviewData.filter(r => r.generatedReply);

    if (previewItems.length === 0) {
      previewList.innerHTML = '<div class="empty-state">Нет отзывов для ответа (все уже имеют ответы)</div>';
    } else {
      previewList.innerHTML = previewItems.slice(0, 10).map(item => `
        <div class="google-preview-item">
          <div class="google-preview-header">
            <span><strong>${escapeHtml(item.reviewer)}</strong> ${getStarsHtml(item.starRating)}</span>
            <span class="google-preview-label">PREVIEW</span>
          </div>
          <div class="google-preview-original">"${escapeHtml(item.comment || '')}"</div>
          <div class="google-preview-generated">${escapeHtml(item.generatedReply)}</div>
        </div>
      `).join('');
    }

    previewSection.style.display = 'block';
    btn.textContent = '✅ Готово!';

    setTimeout(() => {
      btn.textContent = '🔍 Preview ответов';
      btn.classList.remove('loading');
    }, 2000);
  } catch (error) {
    console.error('Google dry run error:', error);
    btn.textContent = '❌ Ошибка';
    setTimeout(() => {
      btn.textContent = '🔍 Preview ответов';
      btn.classList.remove('loading');
    }, 2000);
  }
}

// Send one reply (test)
async function googleSendOne() {
  const btn = document.getElementById('btnGoogleSend');
  btn.textContent = '⏳ Отправляю...';
  btn.classList.add('loading');

  try {
    // Find one review without reply
    const reviewWithoutReply = googleCachedReviews.find(r => !r.reviewReply && r.comment);

    if (!reviewWithoutReply) {
      alert('Нет отзывов без ответа!');
      btn.textContent = '✉️ Отправить 1 ответ (тест)';
      btn.classList.remove('loading');
      return;
    }

    // This will process just one review
    const response = await fetch(`${API_BASE}/api/google/reviews/auto-reply`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ dryRun: false, limit: 1 })
    });

    const data = await response.json();

    btn.textContent = `✅ Отправлено! (${data.repliedCount || 0})`;
    await loadGoogleReviews();

    setTimeout(() => {
      btn.textContent = '✉️ Отправить 1 ответ (тест)';
      btn.classList.remove('loading');
    }, 3000);
  } catch (error) {
    console.error('Google send error:', error);
    btn.textContent = '❌ Ошибка';
    setTimeout(() => {
      btn.textContent = '✉️ Отправить 1 ответ (тест)';
      btn.classList.remove('loading');
    }, 2000);
  }
}

// Generate reply for specific review
async function googleGenerateOneReply(reviewId) {
  alert('Функция в разработке. Используйте кнопку "Preview ответов" для генерации.');
}

// Refresh
function googleRefresh() {
  loadGoogleData();
}

// Update switchPlatform to include Google
const platformSwitchOriginal = window.switchPlatform;
window.switchPlatform = function (platform) {
  activePlatform = platform;

  // Update tabs
  document.querySelectorAll('.platform-tab').forEach(t => t.classList.remove('active'));
  document.getElementById(`platform${platform.charAt(0).toUpperCase() + platform.slice(1)}`).classList.add('active');

  // Update content
  document.querySelectorAll('.platform-content').forEach(c => c.classList.remove('active'));
  document.getElementById(`platform-${platform}`).classList.add('active');

  // Load data
  if (platform === 'youtube') {
    loadYouTubeData();
  } else if (platform === 'threads') {
    loadThreadsData();
  } else if (platform === 'google') {
    loadGoogleData();
  }
};

// Refresh Google data periodically when on Google tab
setInterval(() => {
  if (activePlatform === 'google') {
    loadGoogleStatus();
  }
}, 60000);

// Filter reviews by status (clicking on stat cards)
let googleCurrentFilter = 'all';

function googleFilterReviews(filter) {
  googleCurrentFilter = filter;

  const container = document.getElementById('googleReviewsList');
  let filteredReviews = googleCachedReviews;

  if (filter === 'pending') {
    filteredReviews = googleCachedReviews.filter(r => !r.reviewReply);
  } else if (filter === 'replied') {
    filteredReviews = googleCachedReviews.filter(r => r.reviewReply);
  }

  // Update section title
  const titles = {
    'all': '📝 Все отзывы',
    'pending': '⏳ Отзывы без ответа',
    'replied': '✅ Отзывы с ответом'
  };

  const sectionTitle = document.querySelector('#platform-google .section-title');
  if (sectionTitle) {
    sectionTitle.textContent = titles[filter] || '📝 Отзывы Google Maps';
  }

  if (filteredReviews.length === 0) {
    container.innerHTML = '<div class="empty-state">Нет отзывов в этой категории</div>';
    return;
  }

  container.innerHTML = filteredReviews.slice(0, 20).map(review => {
    const hasReply = !!review.reviewReply;
    const stars = getStarsHtml(review.starRating);
    const date = review.createTime ? new Date(review.createTime).toLocaleDateString('ru-RU') : '';
    const avatarUrl = review.reviewer?.profilePhotoUrl || '';

    return `
      <div class="google-review-item ${hasReply ? 'has-reply' : 'no-reply'}">
        <div class="google-review-header">
          <div class="google-review-author">
            ${avatarUrl ? `<img class="google-review-avatar" src="${avatarUrl}" alt="" onerror="this.style.display='none'">` : ''}
            <span class="google-review-name">${escapeHtml(review.reviewer?.displayName || 'Анонимный')}</span>
          </div>
          <div>
            <span class="google-review-stars">${stars}</span>
            <span class="google-review-date">${date}</span>
          </div>
        </div>
        <div class="google-review-text">${escapeHtml(review.comment || '(Без текста)')}</div>
        ${hasReply ? `
          <div class="google-review-reply">
            <div class="google-review-reply-header">💬 Ответ клиники:</div>
            <div class="google-review-reply-text">${escapeHtml(review.reviewReply.comment)}</div>
          </div>
        ` : `
          <button class="google-reply-btn" onclick="googleReplyToReview('${review.name}', '${escapeHtml(review.comment || '')}', '${review.starRating}')">
            🤖 Ответить
          </button>
        `}
      </div>
    `;
  }).join('');
}

// Reply to specific review
async function googleReplyToReview(reviewName, comment, starRating) {
  if (!confirm('Сгенерировать и отправить ответ на этот отзыв?')) return;

  const review = googleCachedReviews.find(r => r.name === reviewName);
  if (!review) {
    alert('Отзыв не найден');
    return;
  }

  try {
    // Generate response via API
    const response = await fetch(`${API_BASE}/api/google/reviews/reply-single`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ reviewName, review })
    });

    if (!response.ok) {
      const err = await response.json();
      throw new Error(err.error || 'Unknown error');
    }

    const data = await response.json();
    alert(`✅ Ответ отправлен!\n\n${data.reply}`);
    await loadGoogleReviews();
  } catch (error) {
    console.error('Reply error:', error);
    alert(`❌ Ошибка: ${error.message}`);
  }
}

console.log('📍 Google Reviews Dashboard enabled');
