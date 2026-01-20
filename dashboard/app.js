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

  const messageText = isComment ? item.text : (item.messages || []).join(' | ');
  const username = item.username || item.senderId?.substring(0, 10) || 'Unknown';

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

console.log('🚀 INFINITY LIFE Dashboard v3 initialized');
