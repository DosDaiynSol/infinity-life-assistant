require('dotenv').config();
const express = require('express');
const cors = require('cors');
const path = require('path');
const InstagramLiveAssistant = require('./services/instagram-live-assistant');
const { AppAuthService } = require('./services/app-auth-service');
const { createRequireCsrfMiddleware } = require('./services/csrf-protection');
const { InteractionReadModel } = require('./services/interaction-read-model');
const InteractionOverrideStore = require('./services/interaction-overrides');
const userManager = require('./services/user-manager');
const statsManager = require('./services/stats-manager');
const { createAuthRouter, createRequireAppSessionApi, createRequireAppSessionPage } = require('./routes/auth-routes');
const {
  buildOverviewPayload,
  buildProfilePayload,
  buildServiceCards,
  buildServicesPayload
} = require('./services/command-center-payloads');

// YouTube services
const youtubeOAuth = require('./services/youtube-oauth');
const youtubeAPI = require('./services/youtube-api');
const youtubeHandler = require('./handlers/youtube');

// Google Business Profile services
const googleBusinessOAuth = require('./services/google-business-oauth');
const googleBusinessAPI = require('./services/google-business-api');
const googleReviewsHandler = require('./handlers/google-reviews');

// Threads Keyword Search services
const threadsKeywordSearch = require('./services/threads-keyword-search');
const threadsAPI = require('./services/threads-api');
const threadsDB = require('./services/threads-database');
const schedule = require('node-schedule');
const {
  createDashboardIncident,
  buildCommandCenterOverviewPayload,
  buildCommandCenterIncidentsPayload,
  parseIncidentResolutionInput
} = require('./dashboard/contracts');

const app = express();
const PORT = process.env.PORT || 3000;

// Middleware
app.use(cors());
// Allow text/plain payloads (e.g., n8n forwards) to be parsed manually
app.use(express.text({ type: 'text/*' }));
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(express.static(path.join(__dirname, '../dashboard'), {
  index: false
}));

const assistantRuntime = new InstagramLiveAssistant();
const authService = new AppAuthService();
const interactionOverrideStore = new InteractionOverrideStore();
const requireCsrf = createRequireCsrfMiddleware();
const requireAppSessionPage = createRequireAppSessionPage({ authService });

// Legacy queue endpoints are deprecated, but we keep an empty shape so older
// helpers do not crash while the dashboard is being migrated.
const buffer = Object.freeze({
  comments: Object.freeze([]),
  dms: Object.freeze([]),
  flush() {
    return {
      comments: [],
      dms: [],
      commentsByUser: {},
      dmsByUser: {}
    };
  }
});

async function processBuffer() {
  return {
    comments: 0,
    dms: 0,
    responses: 0
  };
}

// YouTube daily check at 10:00 AM (instead of 5-min polling)
let youtubeLastProcessed = null;

async function processYouTubeComments(videoCount = 10) {
  if (!youtubeOAuth.isAuthorized()) {
    console.log('[YouTube Check] Not authorized, skipping...');
    return { processed: 0, responded: 0 };
  }

  console.log(`[${new Date().toISOString()}] [YouTube Check] Starting (${videoCount} videos)...`);

  try {
    const result = await youtubeHandler.processChannelComments(videoCount);
    youtubeLastProcessed = new Date().toISOString();

    // Stats are tracked inside youtube handler (saved to youtube_processed_comments)
    // Just log summary here
    const totalProcessed = result.results?.reduce((sum, r) => (r.processedCount || 0) + sum, 0) || 0;
    const totalReplied = result.totalReplied || 0;
    console.log(`[YouTube Check] Done. Processed ${totalProcessed} comments, replied to ${totalReplied}.`);
    return result;
  } catch (error) {
    console.error('[YouTube Check] Error:', error.message);
    return { error: error.message };
  }
}

// Schedule YouTube checks 3 times per day: 10:00, 14:00, 20:00
schedule.scheduleJob('0 10 * * *', async () => {
  console.log('[YouTube Schedule] Running comment check (10:00)');
  await processYouTubeComments(0);
});
schedule.scheduleJob('0 14 * * *', async () => {
  console.log('[YouTube Schedule] Running comment check (14:00)');
  await processYouTubeComments(0);
});
schedule.scheduleJob('0 20 * * *', async () => {
  console.log('[YouTube Schedule] Running comment check (20:00)');
  await processYouTubeComments(0);
});
// No auto-run on server start — first run at 10:00

function tryParseJson(value) {
  if (typeof value !== 'string') return value;
  try {
    return JSON.parse(value);
  } catch (error) {
    return value;
  }
}

function getSeverityWeight(severity) {
  if (severity === 'critical') return 0;
  if (severity === 'warning') return 1;
  return 2;
}

function getStatusWeight(status) {
  if (status === 'reauth_required') return 0;
  if (status === 'degraded') return 1;
  return 2;
}

function parseStarRating(starRating) {
  const ratingMap = {
    ONE: 1,
    TWO: 2,
    THREE: 3,
    FOUR: 4,
    FIVE: 5
  };

  return ratingMap[starRating] || 0;
}

function truncateText(value, maxLength = 140) {
  if (!value) return '';
  if (value.length <= maxLength) return value;
  return `${value.slice(0, maxLength - 1).trimEnd()}...`;
}

function getOperationalStatusLabel(status) {
  const statusMap = {
    pending: 'ожидает',
    validated: 'проверено',
    replied: 'с ответом',
    sent: 'отправлено',
    processed: 'обработано',
    failed: 'ошибка',
    skipped: 'пропущено',
    posted: 'опубликовано'
  };

  return statusMap[status] || status;
}

function createIncident(input) {
  return createDashboardIncident(input);
}

function createQueueItem({
  id,
  source,
  queue,
  title,
  body,
  status = 'pending',
  priority = 'normal',
  createdAt = null,
  meta = null,
  link = null
}) {
  return {
    id,
    source,
    queue,
    title,
    body,
    status,
    priority,
    createdAt,
    meta,
    link
  };
}

function getServiceReauthConfig(service) {
  const configs = {
    youtube: {
      status: 'ok',
      url: '/auth/youtube',
      message: 'Открыт сценарий Google OAuth для YouTube.'
    },
    google_business: {
      status: 'ok',
      url: '/auth/google',
      message: 'Открыт сценарий Google Business OAuth.'
    },
    instagram_meta: {
      status: 'manual_required',
      url: 'https://developers.facebook.com/apps/',
      message: 'Токены Meta для Instagram нужно обновить вручную в настройках приложения Meta.'
    },
    instagram_messaging: {
      status: 'manual_required',
      url: 'https://developers.facebook.com/apps/',
      message: 'Токены Meta Messaging нужно обновить вручную в настройках приложения Meta.'
    },
    facebook_page: {
      status: 'manual_required',
      url: 'https://developers.facebook.com/apps/',
      message: 'Доступ к Facebook Page нужно переавторизовать в Meta.'
    },
    threads: {
      status: 'manual_required',
      url: 'https://developers.facebook.com/apps/',
      message: 'Long-lived токены Threads нужно заново выпустить в Meta, если обновление не сработало.'
    }
  };

  return configs[service] || {
    status: 'manual_required',
    url: null,
    message: 'Для этого сервиса ещё не настроен сценарий переавторизации.'
  };
}

function createResolveAction() {
  return {
    kind: 'resolve',
    label: 'Resolve incident'
  };
}

function createReauthorizeAction(service) {
  return {
    kind: 'reauthorize',
    label: 'Reauthorize',
    service
  };
}

function createContextAction(page, itemId) {
  if (!page || !itemId) {
    return null;
  }

  return {
    kind: 'open_context',
    label: 'Open related context',
    page,
    itemId
  };
}

function getInstagramIncidentSource(incident) {
  if (incident.service === 'instagram_meta') {
    return 'Instagram Auth';
  }

  if (incident.meta?.channel === 'comment') {
    return 'Instagram Comment';
  }

  return 'Instagram DM';
}

function findRelatedLiveFeedContext(liveFeed, incidentId) {
  const relatedItem = (liveFeed || []).find((item) => item.incidentId === incidentId);

  if (!relatedItem) {
    return null;
  }

  return {
    page: 'live-feed',
    itemId: relatedItem.id
  };
}

function mapStoredIncidentToDashboardIncident(incident, liveFeed) {
  const relatedContext = findRelatedLiveFeedContext(liveFeed, incident.id);
  const actions = [];
  const recommendedAction = incident.service === 'instagram_meta'
    ? createReauthorizeAction('instagram_meta')
    : createResolveAction();

  actions.push(recommendedAction);

  const contextAction = createContextAction(relatedContext?.page, relatedContext?.itemId);
  if (contextAction) {
    actions.push(contextAction);
  }

  return createIncident({
    id: incident.id,
    severity: incident.severity,
    source: getInstagramIncidentSource(incident),
    service: incident.service,
    title: incident.title,
    detail: incident.detail,
    state: incident.state || 'open',
    openedAt: incident.openedAt || incident.updatedAt || null,
    updatedAt: incident.updatedAt || incident.openedAt || null,
    resolvedAt: incident.resolvedAt || null,
    count: incident.count || 1,
    reasonCode: incident.reasonCode || null,
    meta: incident.meta || {},
    relatedContext,
    recommendedAction,
    actions
  });
}

function mapReauthIncident(service) {
  const relatedContext = {
    page: 'integrations',
    itemId: service.id
  };
  const reauthorizeAction = createReauthorizeAction(service.id);
  const contextAction = createContextAction(relatedContext.page, relatedContext.itemId);

  return createIncident({
    id: `${service.id}-reauth`,
    severity: 'critical',
    source: service.name,
    service: service.id,
    title: `Reauthorization required: ${service.name}`,
    detail: service.lastError || service.summary,
    state: 'open',
    openedAt: service.lastCheckedAt || new Date().toISOString(),
    updatedAt: service.lastCheckedAt || new Date().toISOString(),
    count: 1,
    reasonCode: `${service.id}_reauth_required`,
    meta: {
      provider: service.provider,
      lastError: service.lastError || null
    },
    relatedContext,
    recommendedAction: reauthorizeAction,
    actions: [reauthorizeAction, contextAction].filter(Boolean)
  });
}

function mapEscalationIncident({ id, service, source, title, detail, severity = 'critical', reasonCode, meta, relatedContext }) {
  const contextAction = createContextAction(relatedContext?.page, relatedContext?.itemId);

  return createIncident({
    id,
    severity,
    source,
    service,
    title,
    detail,
    state: 'open',
    openedAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    count: 1,
    reasonCode,
    meta,
    relatedContext,
    recommendedAction: contextAction,
    actions: contextAction ? [contextAction] : []
  });
}

async function getYouTubeStatsSnapshot() {
  const supabase = youtubeHandler.supabase;
  let totalComments = 0;
  let totalResponses = 0;
  let processedVideos = 0;

  if (supabase) {
    const [{ count: commentsCount }, { count: respondedCount }, { data: videos }] = await Promise.all([
      supabase.from('youtube_processed_comments').select('*', { count: 'exact', head: true }),
      supabase.from('youtube_processed_comments').select('*', { count: 'exact', head: true }).eq('responded', true),
      supabase.from('youtube_processed_comments').select('video_id').not('video_id', 'is', null)
    ]);

    totalComments = commentsCount || 0;
    totalResponses = respondedCount || 0;
    processedVideos = new Set((videos || []).map((video) => video.video_id)).size;
  }

  return {
    ...youtubeHandler.getStats(),
    totalComments,
    totalResponses,
    processedVideos,
    lastProcessed: youtubeLastProcessed
  };
}

function normalizeGoogleReview(review) {
  const rating = parseStarRating(review.starRating);
  const replied = Boolean(review.reviewReply?.comment);
  const isEscalation = !replied && rating > 0 && rating <= 3;

  return {
    id: review.reviewId || review.name,
    reviewName: review.name,
    reviewer: review.reviewer?.displayName || 'Аноним',
    rating,
    comment: review.comment || '',
    reply: review.reviewReply?.comment || null,
    status: replied ? 'replied' : (isEscalation ? 'escalation' : 'pending'),
    createdAt: review.updateTime || review.createTime || null
  };
}

async function loadInstagramOperationalData() {
  const [stats, history, users] = await Promise.all([
    statsManager.getInstagramStats(),
    statsManager.getInstagramHistory(),
    userManager.getAllUsers()
  ]);

  const queueItems = [
    ...buffer.dms.map((item, index) => createQueueItem({
      id: `instagram-dm-${index}-${item.senderId || 'unknown'}`,
      source: 'instagram',
      queue: 'direct_messages',
      title: `Диалог с ${item.senderId ? item.senderId.slice(0, 10) : 'неизвестным пользователем'}`,
      body: truncateText(item.text || 'Текст сообщения отсутствует'),
      status: 'pending',
      priority: 'high',
      createdAt: item.timestamp || null,
      meta: 'Сообщение ещё лежит в буфере'
    })),
    ...buffer.comments.map((item, index) => createQueueItem({
      id: `instagram-comment-${index}-${item.commentId || 'unknown'}`,
      source: 'instagram',
      queue: 'comments',
      title: `Комментарий от @${item.username || 'неизвестно'}`,
      body: truncateText(item.text || 'Текст комментария отсутствует'),
      status: 'pending',
      priority: 'normal',
      createdAt: item.timestamp || null,
      meta: item.mediaId ? `Публикация ${item.mediaId}` : 'Комментарий ещё лежит в буфере'
    }))
  ];

  return {
    id: 'instagram',
    name: 'Instagram',
    authorized: Boolean(process.env.INSTAGRAM_PAGE_ID && (process.env.INSTAGRAM_DM_TOKEN || process.env.INSTAGRAM_REPLY_TOKEN)),
    stats,
    history: history.slice(0, 20),
    users: users.slice(0, 8),
    queue: {
      total: queueItems.length,
      dms: buffer.dms.length,
      comments: buffer.comments.length,
      items: queueItems.slice(0, 12)
    },
    lastProcessed: history[0]?.timestamp || null
  };
}

async function loadYouTubeOperationalData() {
  const [stats, history] = await Promise.all([
    getYouTubeStatsSnapshot(),
    (async () => {
      const supabase = youtubeHandler.supabase;
      if (!supabase) return [];

      const { data } = await supabase
        .from('youtube_processed_comments')
        .select('*')
        .eq('responded', true)
        .order('processed_at', { ascending: false })
        .limit(12);

      return (data || []).map((row) => ({
        id: `${row.video_id}-${row.processed_at}`,
        title: row.video_id || 'Видео YouTube',
        author: row.author,
        comment: row.comment_text,
        response: row.response_text,
        timestamp: row.processed_at
      }));
    })()
  ]);

  return {
    id: 'youtube',
    name: 'YouTube',
    authorized: youtubeOAuth.isAuthorized(),
    schedule: '10:00, 14:00, 20:00',
    stats,
    history,
    lastProcessed: stats.lastProcessed || history[0]?.timestamp || null
  };
}

async function loadGoogleOperationalData({ includeReviews = true } = {}) {
  const auth = {
    authorized: googleBusinessOAuth.isAuthorized(),
    locationId: process.env.GOOGLE_LOCATION_ID || 'not set',
    accountId: process.env.GOOGLE_ACCOUNT_ID || 'not set'
  };

  const reviewStats = await googleReviewsHandler.getStats();
  let reviews = [];
  let reviewsError = null;

  if (includeReviews && auth.authorized) {
    try {
      const payload = await googleBusinessAPI.getAllReviews();
      reviews = (payload.reviews || []).map(normalizeGoogleReview);
    } catch (error) {
      reviewsError = error.message;
    }
  }

  const repliedReviews = reviews.filter((review) => review.status === 'replied');
  const escalationReviews = reviews.filter((review) => review.status === 'escalation');
  const pendingReviews = reviews.filter((review) => review.status === 'pending');

  return {
    id: 'google',
    name: 'Google Отзывы',
    ...auth,
    reviews,
    reviewsError,
    stats: {
      totalReviews: reviews.length,
      pendingReviews: pendingReviews.length,
      repliedReviews: repliedReviews.length,
      escalationReviews: escalationReviews.length,
      totalReplied: reviewStats.totalReplied || 0,
      todayReplied: reviewStats.todayReplied || 0
    }
  };
}

async function loadThreadsOperationalData({ includePosts = true } = {}) {
  const [stats, chartData] = await Promise.all([
    threadsDB.getStats(),
    threadsDB.getChartData()
  ]);

  let posts = [];

  if (includePosts) {
    const [newPosts, skippedPosts, validatedPosts, repliedPosts] = await Promise.all([
      threadsDB.getPostsByStatus('new', 25),
      threadsDB.getPostsByStatus('skipped', 25),
      threadsDB.getPostsByStatus('validated', 25),
      threadsDB.getPostsByStatus('replied', 25)
    ]);

    posts = [...newPosts, ...skippedPosts, ...validatedPosts, ...repliedPosts];
  }

  return {
    id: 'threads',
    name: 'Threads',
    schedule: ['08:00', '14:00', '20:00'],
    isSearching: threadsKeywordSearch.isSearching,
    tokenStatus: threadsAPI.getTokenStatus(),
    stats,
    chartData,
    posts
  };
}

function unwrapPayload(payload) {
  if (!payload || typeof payload !== 'object') return payload;

  const candidates = ['body', 'data', 'payload'];
  for (const key of candidates) {
    if (payload[key]) {
      const parsed = tryParseJson(payload[key]);
      if (parsed && typeof parsed === 'object') {
        return parsed;
      }
    }
  }

  return payload;
}

function toArray(value) {
  if (!value) return [];
  return Array.isArray(value) ? value : [value];
}

function buildRealtimeIntegrationServices({ instagramRealtime, youtube, google, threads }) {
  const now = new Date().toISOString();

  const services = [
    {
      ...instagramRealtime.integration,
      lastCheckedAt: instagramRealtime.integration.lastCheckedAt || now,
      actions: ['reauthorize']
    },
    {
      id: 'youtube',
      name: 'YouTube',
      provider: 'Google',
      status: youtube.authorized ? 'healthy' : 'reauth_required',
      summary: youtube.authorized
        ? `${youtube.stats.totalResponses || 0} ответов отправлено, sync идёт по расписанию`
        : 'Для доступа к каналу нужна новая авторизация',
      lastCheckedAt: now,
      lastError: youtube.authorized ? null : 'Токен YouTube OAuth недоступен.',
      actions: ['reauthorize']
    },
    {
      id: 'google_business',
      name: 'Google Business',
      provider: 'Google',
      status: google.authorized ? (google.reviewsError ? 'degraded' : 'healthy') : 'reauth_required',
      summary: google.authorized
        ? `${google.stats.pendingReviews || 0} отзывов без ответа, ${google.stats.escalationReviews || 0} рискованных`
        : 'Нужна повторная авторизация Google Business',
      lastCheckedAt: now,
      lastError: google.reviewsError || (google.authorized ? null : 'Refresh token для Google Business не настроен.'),
      actions: ['reauthorize']
    },
    {
      id: 'threads',
      name: 'Threads',
      provider: 'Meta',
      status: threads.tokenStatus.hasToken
        ? (threads.tokenStatus.expired ? 'reauth_required' : 'healthy')
        : 'reauth_required',
      summary: threads.tokenStatus.expired
        ? 'Токен Threads истёк, нужен новый consent'
        : `${threads.stats.postsFound || 0} сигналов найдено, ${threads.stats.replied || 0} ответов отправлено`,
      lastCheckedAt: now,
      lastError: threads.tokenStatus.error || (threads.tokenStatus.hasToken ? null : 'Токен Threads не найден.'),
      actions: ['reauthorize']
    }
  ];

  return services.sort((left, right) => getStatusWeight(left.status) - getStatusWeight(right.status));
}

function buildRealtimeDashboardIncidents({ instagramRealtime, integrations, google }) {
  const incidents = instagramRealtime.incidents.map((incident) => (
    mapStoredIncidentToDashboardIncident(incident, instagramRealtime.liveFeed)
  ));

  integrations
    .filter((service) => service.status === 'reauth_required' && service.id !== 'instagram_meta')
    .forEach((service) => {
      incidents.push(mapReauthIncident(service));
    });

  if ((google.stats.escalationReviews || 0) > 0) {
    incidents.push(mapEscalationIncident({
      id: 'google-escalation-reviews',
      source: 'Google Отзывы',
      service: 'google_business',
      title: `${google.stats.escalationReviews} отзывов требуют эскалации`,
      detail: 'Найдены отзывы с повышенным репутационным риском.',
      reasonCode: 'google_escalation_reviews',
      meta: {
        escalationReviews: google.stats.escalationReviews || 0,
        pendingReviews: google.stats.pendingReviews || 0
      },
      relatedContext: {
        page: 'channels',
        itemId: 'google'
      }
    }));
  }

  return incidents
    .sort((left, right) => getSeverityWeight(left.severity) - getSeverityWeight(right.severity))
    .slice(0, 20);
}

function buildRealtimeOverviewPayload({ instagramRealtime, youtube, google, threads, integrations, incidents }) {
  return buildCommandCenterOverviewPayload({
    instagramRealtime,
    youtube,
    google,
    threads,
    integrations,
    incidents
  });
}

function buildLiveFeedPayload(instagramRealtime) {
  return {
    generatedAt: new Date().toISOString(),
    items: instagramRealtime.liveFeed
  };
}

function buildIncidentsPayload(incidents) {
  return buildCommandCenterIncidentsPayload(incidents);
}

function buildChannelsPayload({ instagramRealtime, youtube, google, threads, integrations }) {
  const integrationMap = new Map(integrations.map((service) => [service.id, service]));

  return {
    generatedAt: new Date().toISOString(),
    items: [
      {
        id: 'instagram',
        name: 'Instagram',
        status: integrationMap.get('instagram_meta')?.status || 'healthy',
        summary: 'Webhook-driven flow для DM и комментариев без ручной очереди.',
        metrics: [
          { label: 'Входящих 24ч', value: instagramRealtime.metrics.inbound || 0 },
          { label: 'Доставлено', value: instagramRealtime.metrics.delivered || 0 },
          { label: 'Эскалации', value: instagramRealtime.metrics.escalations || 0 }
        ],
        recent: instagramRealtime.liveFeed.slice(0, 5).map((item) => ({
          id: item.id,
          title: item.title,
          detail: truncateText(item.responseText || item.text || '', 96),
          status: item.status,
          timestamp: item.updatedAt || item.timestamp
        }))
      },
      {
        id: 'youtube',
        name: 'YouTube',
        status: integrationMap.get('youtube')?.status || 'healthy',
        summary: 'Гибридный канал: фоновый sync комментариев по расписанию.',
        metrics: [
          { label: 'Видео', value: youtube.stats.processedVideos || 0 },
          { label: 'Комментарии', value: youtube.stats.totalComments || 0 },
          { label: 'Ответы', value: youtube.stats.totalResponses || 0 }
        ],
        recent: youtube.history.slice(0, 5).map((item) => ({
          id: item.id,
          title: item.author || 'Неизвестный автор',
          detail: truncateText(item.response || item.comment || '', 96),
          status: 'sent',
          timestamp: item.timestamp
        }))
      },
      {
        id: 'google',
        name: 'Google Отзывы',
        status: integrationMap.get('google_business')?.status || 'healthy',
        summary: 'Отзывы и репутационные инциденты клиники.',
        metrics: [
          { label: 'Всего отзывов', value: google.stats.totalReviews || 0 },
          { label: 'Без ответа', value: google.stats.pendingReviews || 0 },
          { label: 'Эскалации', value: google.stats.escalationReviews || 0 }
        ],
        recent: google.reviews.slice(0, 5).map((review) => ({
          id: review.id,
          title: `${review.rating || 0}★ ${review.reviewer}`,
          detail: truncateText(review.reply || review.comment || '', 96),
          status: review.status,
          timestamp: review.createdAt
        }))
      },
      {
        id: 'threads',
        name: 'Threads',
        status: integrationMap.get('threads')?.status || 'healthy',
        summary: 'Discovery-канал со фоновым поиском и policy engine.',
        metrics: [
          { label: 'Найдено', value: threads.stats.postsFound || 0 },
          { label: 'Проверено', value: threads.stats.validated || 0 },
          { label: 'Ответы', value: threads.stats.replied || 0 }
        ],
        recent: threads.posts.slice(0, 5).map((post) => ({
          id: `threads-${post.id}`,
          title: `@${post.username || 'неизвестно'}`,
          detail: truncateText(post.reply_text || post.text || '', 96),
          status: post.status,
          timestamp: post.replied_at || post.created_at
        }))
      }
    ]
  };
}

function buildRealtimeActivityPayload({ instagramActivity, youtube, google, threads }) {
  const items = [
    ...instagramActivity.map((item) => ({
      id: item.id,
      source: item.source,
      title: item.title,
      detail: truncateText(item.detail || '', 120),
      status: item.status,
      timestamp: item.timestamp
    })),
    ...youtube.history.slice(0, 8).map((item) => ({
      id: `activity-youtube-${item.id}`,
      source: 'YouTube',
      title: `Ответ для ${item.author || 'зрителя'}`,
      detail: truncateText(item.response || item.comment || '', 120),
      status: 'sent',
      timestamp: item.timestamp
    })),
    ...google.reviews
      .filter((review) => review.status === 'replied')
      .slice(0, 8)
      .map((review) => ({
        id: `activity-google-${review.id}`,
        source: 'Google Отзывы',
        title: `Ответ для ${review.reviewer}`,
        detail: truncateText(review.reply || review.comment || '', 120),
        status: 'sent',
        timestamp: review.createdAt
      })),
    ...threads.posts
      .filter((post) => post.status === 'replied')
      .slice(0, 8)
      .map((post) => ({
        id: `activity-threads-${post.id}`,
        source: 'Threads',
        title: `Ответ для @${post.username || 'неизвестно'}`,
        detail: truncateText(post.reply_text || post.text || '', 120),
        status: 'sent',
        timestamp: post.replied_at || post.created_at
      }))
  ];

  return {
    generatedAt: new Date().toISOString(),
    items: items
      .sort((left, right) => {
        const leftTime = left.timestamp ? new Date(left.timestamp).getTime() : 0;
        const rightTime = right.timestamp ? new Date(right.timestamp).getTime() : 0;
        return rightTime - leftTime;
      })
      .slice(0, 50)
  };
}

async function loadRealtimeDashboardSnapshots({ includeGoogleReviews = true, includeThreadPosts = true } = {}) {
  const [instagramRealtime, youtube, google, threads] = await Promise.all([
    assistantRuntime.getInstagramSummary(),
    loadYouTubeOperationalData(),
    loadGoogleOperationalData({ includeReviews: includeGoogleReviews }),
    loadThreadsOperationalData({ includePosts: includeThreadPosts })
  ]);

  const integrations = buildRealtimeIntegrationServices({
    instagramRealtime,
    youtube,
    google,
    threads
  });

  return {
    instagramRealtime,
    youtube,
    google,
    threads,
    integrations
  };
}

const interactionReadModel = new InteractionReadModel({
  assistantRuntime,
  contactManager: userManager,
  overrideStore: interactionOverrideStore,
  loadGoogleOperationalData,
  loadThreadsOperationalData,
  loadYouTubeOperationalData
});

function getLocalizedServiceName(serviceId, fallbackName) {
  const labels = {
    instagram_meta: 'Instagram',
    youtube: 'YouTube',
    google_business: 'Google Reviews',
    threads: 'Threads'
  };

  return labels[serviceId] || fallbackName || serviceId;
}

function getRussianServiceId(serviceId) {
  if (serviceId === 'instagram_meta') {
    return 'instagram';
  }

  if (serviceId === 'google_business') {
    return 'google_reviews';
  }

  return serviceId;
}

async function buildServicesControlPayload() {
  const snapshots = await loadRealtimeDashboardSnapshots({
    includeGoogleReviews: true,
    includeThreadPosts: true
  });

  const services = buildServiceCards(snapshots.integrations.map((service) => ({
    id: getRussianServiceId(service.id),
    integrationId: service.id,
    name: getLocalizedServiceName(service.id, service.name),
    provider: service.provider,
    status: service.status,
    summary: service.summary,
    lastCheckedAt: service.lastCheckedAt,
    lastError: service.lastError,
    unprocessedCount: service.id === 'instagram_meta'
      ? (snapshots.instagramRealtime.metrics.pending || 0)
      : (service.id === 'google_business'
        ? (snapshots.google.stats.pendingReviews || 0)
        : (service.id === 'youtube'
          ? Math.max(0, (snapshots.youtube.stats.totalComments || 0) - (snapshots.youtube.stats.totalResponses || 0))
          : (snapshots.threads.stats.newPosts || snapshots.threads.stats.validated || 0))),
    errorCount: service.status === 'healthy'
      ? 0
      : 1,
    processed24h: service.id === 'instagram_meta'
      ? (snapshots.instagramRealtime.metrics.delivered || 0)
      : (service.id === 'google_business'
        ? (snapshots.google.stats.totalReplied || 0)
        : (service.id === 'youtube'
          ? (snapshots.youtube.stats.totalResponses || 0)
          : (snapshots.threads.stats.replied || 0))),
    actions: [
      'process-pending',
      'check-health',
      ...(service.status === 'reauth_required' ? ['reauthorize'] : [])
    ]
  })));

  return buildServicesPayload({
    services
  });
}

async function syncSlaBreaches() {
  const payload = await interactionReadModel.listInteractions({
    service: 'all',
    status: 'all',
    limit: 250
  });
  const breachedItems = payload.data.filter((item) => item.slaBreached);

  await Promise.all(breachedItems.map(async (item) => {
    const currentOverride = await interactionOverrideStore.getOverride(item.id);
    if (currentOverride?.slaEscalatedAt) {
      return;
    }

    await interactionOverrideStore.setOverride(item.id, {
      status: 'needs_attention',
      manualAttention: true,
      slaEscalatedAt: new Date().toISOString()
    });

    await assistantRuntime.incidentManager.openIncident({
      service: item.service,
      severity: 'critical',
      reasonCode: 'sla_breach',
      title: `SLA 30 минут нарушен: ${item.serviceLabel}`,
      detail: item.previewText || item.title,
      externalRef: item.id,
      meta: {
        service: item.service,
        contactId: item.contactId || null
      }
    });
  }));
}

async function executeInstagramPendingProcessing() {
  const pendingEvents = await assistantRuntime.eventStore.listPendingEvents(100);
  const conversationIds = [...new Set(
    pendingEvents
      .filter((event) => event.channel === 'dm')
      .map((event) => event.conversationId)
      .filter(Boolean)
  )];
  const commentIds = pendingEvents
    .filter((event) => event.channel === 'comment')
    .map((event) => event.id);

  await Promise.all([
    ...conversationIds.map((conversationId) => assistantRuntime.processDMConversation(conversationId)),
    ...commentIds.map((eventId) => assistantRuntime.processCommentEvent(eventId))
  ]);

  return {
    status: 'ok',
    processed: pendingEvents.length,
    message: 'Необработанные сообщения Instagram отправлены в обработку.'
  };
}

async function executeServiceAction(serviceId, action) {
  if (serviceId === 'instagram') {
    if (action === 'process-pending') {
      return executeInstagramPendingProcessing();
    }

    if (action === 'check-health') {
      const payload = await buildServicesControlPayload();
      return payload.services.find((service) => service.id === 'instagram') || null;
    }
  }

  if (serviceId === 'google_reviews') {
    if (action === 'process-pending') {
      const result = await googleReviewsHandler.processReviews({
        forceReply: false,
        limit: 10
      });
      return {
        status: 'ok',
        processed: result.repliedCount || 0,
        message: 'Обработка отзывов Google запущена.',
        result
      };
    }

    if (action === 'check-health') {
      const payload = await buildServicesControlPayload();
      return payload.services.find((service) => service.id === 'google_reviews') || null;
    }
  }

  if (serviceId === 'youtube') {
    if (action === 'process-pending') {
      const result = await processYouTubeComments(0);
      return {
        status: 'ok',
        processed: result.totalReplied || 0,
        message: 'Обработка комментариев YouTube завершена.',
        result
      };
    }

    if (action === 'check-health') {
      const payload = await buildServicesControlPayload();
      return payload.services.find((service) => service.id === 'youtube') || null;
    }
  }

  if (serviceId === 'threads') {
    if (action === 'process-pending') {
      if (threadsKeywordSearch.isSearching) {
        return {
          status: 'already_searching',
          message: 'Поиск в Threads уже выполняется.'
        };
      }

      threadsKeywordSearch.runSearchCycle(0).catch((error) => {
        console.error('[Threads] Manual process error:', error.message);
      });

      return {
        status: 'started',
        processed: 0,
        message: 'Поиск и обработка Threads запущены.'
      };
    }

    if (action === 'check-health') {
      const payload = await buildServicesControlPayload();
      return payload.services.find((service) => service.id === 'threads') || null;
    }
  }

  if (action === 'reauthorize') {
    const normalizedService = serviceId === 'google_reviews'
      ? 'google_business'
      : (serviceId === 'instagram' ? 'instagram_meta' : serviceId);

    return {
      status: 'ok',
      ...getServiceReauthConfig(normalizedService)
    };
  }

  throw new Error(`Unsupported service action: ${serviceId}/${action}`);
}

// Webhook verification (Meta/Instagram)
app.get('/webhook', (req, res) => {
  const mode = req.query['hub.mode'];
  const token = req.query['hub.verify_token'];
  const challenge = req.query['hub.challenge'];
  const verifyToken = process.env.INSTAGRAM_VERIFY_TOKEN || process.env.WEBHOOK_VERIFY_TOKEN;

  if (!verifyToken) {
    console.warn('[Webhook verify] Missing INSTAGRAM_VERIFY_TOKEN/WEBHOOK_VERIFY_TOKEN');
    return res.sendStatus(403);
  }

  if (mode === 'subscribe' && token === verifyToken) {
    console.log('[Webhook verify] Success');
    return res.status(200).send(challenge);
  }

  console.warn('[Webhook verify] Failed');
  return res.sendStatus(403);
});

// Webhook endpoint
app.post('/webhook', async (req, res) => {
  let payload = tryParseJson(req.body);
  payload = unwrapPayload(payload);

  if (!payload || typeof payload !== 'object') {
    console.warn('[Webhook] Invalid payload type');
    return res.status(400).json({ status: 'error', message: 'Invalid payload' });
  }

  console.log('[Webhook received]', JSON.stringify(payload, null, 2));

  if (payload.object === 'instagram') {
    try {
      const result = await assistantRuntime.ingestWebhookPayload(payload);
      return res.status(200).json({
        status: 'accepted',
        ...result
      });
    } catch (error) {
      console.error('[Webhook] Live ingest error:', error.message);
      return res.status(500).json({
        status: 'error',
        message: error.message
      });
    }
  }

  res.status(200).json({ status: 'ok' });
});

app.use('/api/auth', createAuthRouter({
  authService,
  telegramNotifier: assistantRuntime.incidentManager.notifier
}));

app.use('/api', (req, res, next) => {
  if (req.path.startsWith('/auth/')) {
    next();
    return;
  }

  createRequireAppSessionApi({ authService })(req, res, next);
});

app.use('/api', (req, res, next) => {
  if (req.path.startsWith('/auth/')) {
    next();
    return;
  }

  requireCsrf(req, res, next);
});

app.get('/api/interactions', async (req, res) => {
  try {
    await syncSlaBreaches();
    const payload = await interactionReadModel.listInteractions(req.query || {});
    res.json(payload);
  } catch (error) {
    console.error('[API] Interactions error:', error.message);
    res.status(500).json({ error: error.message });
  }
});

app.get('/api/interactions/:id', async (req, res) => {
  try {
    const item = await interactionReadModel.getInteraction(req.params.id);
    if (!item) {
      return res.status(404).json({ error: 'Обращение не найдено' });
    }

    return res.json({
      data: item
    });
  } catch (error) {
    console.error('[API] Interaction detail error:', error.message);
    return res.status(500).json({ error: error.message });
  }
});

app.post('/api/interactions/:id/actions/mark-attention', async (req, res) => {
  try {
    const item = await interactionReadModel.getInteraction(req.params.id);
    if (!item) {
      return res.status(404).json({ error: 'Обращение не найдено' });
    }

    const override = await interactionOverrideStore.setOverride(item.id, {
      status: 'needs_attention',
      manualAttention: true
    });

    await assistantRuntime.incidentManager.openIncident({
      service: item.service,
      severity: 'critical',
      reasonCode: 'manual_attention',
      title: `Ручная пометка: ${item.serviceLabel}`,
      detail: item.previewText || item.title,
      externalRef: item.id,
      meta: {
        service: item.service
      }
    });

    return res.json({
      data: {
        ok: true,
        override
      }
    });
  } catch (error) {
    console.error('[API] Mark attention error:', error.message);
    return res.status(500).json({ error: error.message });
  }
});

app.post('/api/interactions/:id/actions/reprocess', async (req, res) => {
  try {
    const item = await interactionReadModel.getInteraction(req.params.id);
    if (!item) {
      return res.status(404).json({ error: 'Обращение не найдено' });
    }

    let result;
    if (item.service === 'instagram_dm') {
      await assistantRuntime.processDMConversation(item.conversationId);
      result = {
        status: 'ok',
        message: 'Диалог Instagram отправлен в повторную обработку.'
      };
    } else if (item.service === 'instagram_comment') {
      await assistantRuntime.processCommentEvent(item.id);
      result = {
        status: 'ok',
        message: 'Комментарий Instagram отправлен в повторную обработку.'
      };
    } else {
      result = await executeServiceAction(item.service, 'process-pending');
    }

    return res.json({
      data: result
    });
  } catch (error) {
    console.error('[API] Reprocess interaction error:', error.message);
    return res.status(500).json({ error: error.message });
  }
});

app.get('/api/instagram-contacts/:contactId/conversation', async (req, res) => {
  try {
    const [contact, conversation, interactions] = await Promise.all([
      userManager.getUser(req.params.contactId),
      userManager.getConversation(req.params.contactId, 20),
      interactionReadModel.listInteractions({
        service: 'instagram_dm',
        contact_id: req.params.contactId
      })
    ]);

    return res.json({
      data: {
        contact: {
          id: contact?.user_id || contact?.id || req.params.contactId,
          username: contact?.username || null,
          dmEnabled: contact?.dm_enabled !== false,
          commentEnabled: contact?.comment_enabled !== false
        },
        conversation,
        interactions: interactions.data
      }
    });
  } catch (error) {
    console.error('[API] Instagram contact conversation error:', error.message);
    return res.status(500).json({ error: error.message });
  }
});

app.patch('/api/instagram-contacts/:contactId/automation', async (req, res) => {
  try {
    const updates = {};
    if (typeof req.body?.dmEnabled === 'boolean') {
      updates.dm_enabled = req.body.dmEnabled;
    }
    if (typeof req.body?.commentEnabled === 'boolean') {
      updates.comment_enabled = req.body.commentEnabled;
    }

    if (!Object.keys(updates).length) {
      return res.status(400).json({ error: 'Нет изменений для сохранения' });
    }

    const user = await userManager.updateUser(req.params.contactId, updates);
    return res.json({
      data: {
        id: user?.user_id || user?.id || req.params.contactId,
        username: user?.username || null,
        dmEnabled: user?.dm_enabled !== false,
        commentEnabled: user?.comment_enabled !== false
      }
    });
  } catch (error) {
    console.error('[API] Instagram automation error:', error.message);
    return res.status(500).json({ error: error.message });
  }
});

app.get('/api/services', async (req, res) => {
  try {
    const payload = await buildServicesControlPayload();
    res.json(payload);
  } catch (error) {
    console.error('[API] Services error:', error.message);
    res.status(500).json({ error: error.message });
  }
});

app.post('/api/services/:service/actions/:action', async (req, res) => {
  try {
    const result = await executeServiceAction(req.params.service, req.params.action);
    res.json({
      data: result
    });
  } catch (error) {
    console.error('[API] Service action error:', error.message);
    res.status(500).json({ error: error.message });
  }
});

app.get('/api/profile', async (req, res) => {
  try {
    const payload = buildProfilePayload({
      user: req.appUser,
      telegramConfigured: assistantRuntime.incidentManager.notifier.isConfigured()
    });
    res.json(payload);
  } catch (error) {
    console.error('[API] Profile error:', error.message);
    res.status(500).json({ error: error.message });
  }
});

// API endpoints for dashboard
app.get('/api/stats', async (req, res) => {
  try {
    const instagramStats = await statsManager.getInstagramStats();
    const pendingEvents = await assistantRuntime.eventStore.listPendingEvents(100);
    res.json({
      totalMessages: instagramStats.totalMessages,
      totalComments: instagramStats.totalComments,
      responsesSet: instagramStats.responsesSet,
      lastProcessed: instagramStats.lastUpdated,
      uniqueDMSenders: instagramStats.uniqueDMSenders,
      uniqueCommenters: instagramStats.uniqueCommenters,
      dailyStats: instagramStats.dailyStats,
      bufferSize: {
        comments: pendingEvents.filter((event) => event.channel === 'comment').length,
        dms: pendingEvents.filter((event) => event.channel === 'dm').length
      }
    });
  } catch (error) {
    console.error('[API] Error getting stats:', error.message);
    res.status(500).json({ error: error.message });
  }
});

app.get('/api/history', async (req, res) => {
  try {
    const history = await statsManager.getInstagramHistory();
    res.json(history);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.get('/api/buffer', (req, res) => {
  res.status(410).json({
    status: 'deprecated',
    message: 'Queue buffer endpoint is deprecated. Use /api/live-feed instead.'
  });
});

// Manual process trigger
app.post('/api/process-now', async (req, res) => {
  res.status(410).json({
    status: 'deprecated',
    message: 'Manual queue processing has been removed from the primary workflow.'
  });
});

// User management API
app.get('/api/users', async (req, res) => {
  try {
    const users = await userManager.getAllUsers();
    res.json(users);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.get('/api/users/:id', async (req, res) => {
  try {
    const user = await userManager.getUser(req.params.id);
    res.json(user);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.post('/api/users/:id/toggle-ai', async (req, res) => {
  try {
    const { type } = req.body;
    const user = await userManager.toggleAI(req.params.id, type || 'all');
    if (user) {
      console.log(`[Toggle] User ${req.params.id}: AI ${type || 'all'} = ${user.ai_enabled}`);
      res.json({ status: 'ok', user });
    } else {
      res.status(404).json({ status: 'error', message: 'User not found' });
    }
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.get('/api/users/:id/conversation', async (req, res) => {
  try {
    const history = await userManager.getConversation(req.params.id);
    res.json(history);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.delete('/api/users/:id/conversation', async (req, res) => {
  try {
    await userManager.clearConversation(req.params.id);
    res.json({ status: 'ok' });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// ==========================================
// Operations Cockpit API Routes
// ==========================================

app.get('/api/overview', async (req, res) => {
  try {
    await syncSlaBreaches();
    const [interactions, servicesPayload] = await Promise.all([
      interactionReadModel.listInteractions({
        service: 'all',
        status: 'all',
        limit: 120
      }),
      buildServicesControlPayload()
    ]);

    res.json(buildOverviewPayload({
      interactions: interactions.data,
      services: servicesPayload.services
    }));
  } catch (error) {
    console.error('[API] Overview error:', error.message);
    res.status(500).json({ error: error.message });
  }
});

app.get('/api/queues', async (req, res) => {
  res.status(410).json({
    status: 'deprecated',
    message: 'Queue-oriented API is deprecated. Use /api/live-feed and /api/incidents.'
  });
});

app.get('/api/live-feed', async (req, res) => {
  try {
    const instagramRealtime = await assistantRuntime.getInstagramSummary();
    res.json(buildLiveFeedPayload(instagramRealtime));
  } catch (error) {
    console.error('[API] Live feed error:', error.message);
    res.status(500).json({ error: error.message });
  }
});

app.get('/api/incidents', async (req, res) => {
  try {
    const snapshots = await loadRealtimeDashboardSnapshots({
      includeGoogleReviews: true,
      includeThreadPosts: false
    });
    const incidents = buildRealtimeDashboardIncidents(snapshots);

    res.json(buildIncidentsPayload(incidents));
  } catch (error) {
    console.error('[API] Incidents error:', error.message);
    res.status(500).json({ error: error.message });
  }
});

app.post('/api/incidents/:id/resolve', async (req, res) => {
  const incidentId = typeof req.params.id === 'string'
    ? req.params.id.trim()
    : '';

  if (!incidentId) {
    return res.status(400).json({ error: 'incident id is required' });
  }

  try {
    const { resolutionDetail } = parseIncidentResolutionInput(req.body);
    const resolvedIncident = await assistantRuntime.incidentManager.resolveIncident(incidentId, resolutionDetail);

    if (!resolvedIncident) {
      return res.status(404).json({ error: 'Incident not found' });
    }

    const instagramRealtime = await assistantRuntime.getInstagramSummary();

    return res.json({
      incident: mapStoredIncidentToDashboardIncident(resolvedIncident, instagramRealtime.liveFeed)
    });
  } catch (error) {
    if (error.message && error.message.includes('resolutionDetail')) {
      return res.status(400).json({ error: error.message });
    }

    console.error('[API] Resolve incident error:', error.message);
    return res.status(500).json({ error: error.message });
  }
});

app.get('/api/channels', async (req, res) => {
  try {
    const snapshots = await loadRealtimeDashboardSnapshots({
      includeGoogleReviews: true,
      includeThreadPosts: true
    });

    res.json(buildChannelsPayload(snapshots));
  } catch (error) {
    console.error('[API] Channels error:', error.message);
    res.status(500).json({ error: error.message });
  }
});

app.post('/api/integrations/:service/reauthorize', async (req, res) => {
  try {
    const config = getServiceReauthConfig(req.params.service);
    res.json({
      service: req.params.service,
      ...config
    });
  } catch (error) {
    console.error('[API] Reauthorize error:', error.message);
    res.status(500).json({ error: error.message });
  }
});

app.get('/api/integrations', async (req, res) => {
  try {
    res.json(await buildServicesControlPayload());
  } catch (error) {
    console.error('[API] Integrations error:', error.message);
    res.status(500).json({ error: error.message });
  }
});

app.get('/api/activity', async (req, res) => {
  try {
    const [snapshots, instagramActivity] = await Promise.all([
      loadRealtimeDashboardSnapshots({
        includeGoogleReviews: true,
        includeThreadPosts: true
      }),
      assistantRuntime.listActivity(50)
    ]);

    res.json(buildRealtimeActivityPayload({
      instagramActivity,
      youtube: snapshots.youtube,
      google: snapshots.google,
      threads: snapshots.threads
    }));
  } catch (error) {
    console.error('[API] Activity error:', error.message);
    res.status(500).json({ error: error.message });
  }
});

app.get('/api/platforms', async (req, res) => {
  res.status(410).json({
    status: 'deprecated',
    message: 'Platforms API has been replaced by /api/channels.'
  });
});

app.get('/api/platforms/:platform', async (req, res) => {
  res.status(410).json({
    status: 'deprecated',
    message: 'Platform detail API has been replaced by /api/channels.'
  });
});

app.post('/api/platforms/:platform/actions/:action', async (req, res) => {
  const { platform, action } = req.params;

  try {
    if (platform === 'instagram' && action === 'process') {
      const result = await processBuffer();
      return res.json({
        status: 'ok',
        message: 'Очередь Instagram обработана.',
        result
      });
    }

    if (platform === 'youtube' && action === 'process-channel') {
      const result = await youtubeHandler.processChannelComments(0);
      youtubeLastProcessed = new Date().toISOString();
      return res.json({
        status: 'ok',
        message: 'Проверка YouTube завершена.',
        result
      });
    }

    if (platform === 'threads' && action === 'search') {
      if (threadsKeywordSearch.isSearching) {
        return res.json({
          status: 'already_searching',
          message: 'Поиск в Threads уже запущен.'
        });
      }

      threadsKeywordSearch.runSearchCycle(0).catch((error) => {
        console.error('[Threads] Manual search error:', error.message);
      });

      return res.json({
        status: 'started',
        message: 'Поиск в Threads запущен.'
      });
    }

    if (platform === 'threads' && action === 'validate') {
      await threadsKeywordSearch.processNewPosts();
      return res.json({
        status: 'ok',
        message: 'Проверка публикаций в Threads завершена.'
      });
    }

    if (platform === 'google' && action === 'preview') {
      const result = await googleReviewsHandler.processReviews({ dryRun: true });
      return res.json({
        status: 'ok',
        message: 'Черновики ответов Google подготовлены.',
        result
      });
    }

    if (platform === 'google' && action === 'send-test') {
      const result = await googleReviewsHandler.processReviews({ dryRun: false, limit: 1 });
      return res.json({
        status: 'ok',
        message: 'Один ответ на отзыв Google отправлен.',
        result
      });
    }

    return res.status(404).json({ error: 'Неизвестное действие для площадки' });
  } catch (error) {
    console.error('[API] Platform action error:', error.message);
    res.status(500).json({ error: error.message });
  }
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
app.get('/api/youtube/status', async (req, res) => {
  try {
    // Get real counts from youtube_processed_comments
    const supabase = youtubeHandler.supabase;
    let totalComments = 0, totalResponses = 0, processedVideos = 0;

    if (supabase) {
      const { count: commentsCount } = await supabase
        .from('youtube_processed_comments')
        .select('*', { count: 'exact', head: true });
      totalComments = commentsCount || 0;

      const { count: respondedCount } = await supabase
        .from('youtube_processed_comments')
        .select('*', { count: 'exact', head: true })
        .eq('responded', true);
      totalResponses = respondedCount || 0;

      const { data: videos } = await supabase
        .from('youtube_processed_comments')
        .select('video_id')
        .not('video_id', 'is', null);
      processedVideos = new Set(videos?.map(v => v.video_id) || []).size;
    }

    res.json({
      authorized: youtubeOAuth.isAuthorized(),
      channelId: process.env.YOUTUBE_CHANNEL_ID || 'not set',
      schedule: '3 раза в день: 10:00, 14:00, 20:00',
      stats: {
        ...youtubeHandler.getStats(),
        totalComments,
        totalResponses,
        lastProcessed: youtubeLastProcessed,
        processedVideos
      }
    });
  } catch (error) {
    console.error('[API] Error getting YouTube stats:', error.message);
    res.status(500).json({ error: error.message });
  }
});

// YouTube history (from Supabase)
app.get('/api/youtube/history', async (req, res) => {
  try {
    const supabase = youtubeHandler.supabase;
    if (!supabase) return res.json([]);

    const { data } = await supabase
      .from('youtube_processed_comments')
      .select('*')
      .eq('responded', true)
      .order('processed_at', { ascending: false })
      .limit(50);

    const history = (data || []).map(row => ({
      videoId: row.video_id,
      videoTitle: row.video_id, // we don't store title in this table
      author: row.author,
      comment: row.comment_text,
      response: row.response_text,
      timestamp: row.processed_at
    }));

    res.json(history);
  } catch (error) {
    console.error('[API] YouTube history error:', error.message);
    res.json([]);
  }
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
    const { videoCount = 0 } = req.body;
    console.log(`[YouTube API] Manual trigger: processing ${videoCount === 0 ? 'ALL' : videoCount} videos`);
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

// Auto-reply to all reviews (dry run by default)
app.post('/api/google/reviews/auto-reply', async (req, res) => {
  try {
    const { dryRun = true, forceReply = false, limit = null } = req.body;
    console.log(`[Google Reviews] Auto-reply triggered (dryRun: ${dryRun}, forceReply: ${forceReply}, limit: ${limit})`);

    const result = await googleReviewsHandler.processReviews({ dryRun, forceReply, limit });
    res.json({ status: 'ok', ...result });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Get auto-reply stats
app.get('/api/google/reviews/stats', (req, res) => {
  const stats = googleReviewsHandler.getStats();
  res.json(stats);
});

// Clear replied cache (for testing)
app.post('/api/google/reviews/clear-cache', (req, res) => {
  googleReviewsHandler.clearCache();
  res.json({ status: 'ok', message: 'Cache cleared' });
});

// Reply to single review with AI
app.post('/api/google/reviews/reply-single', async (req, res) => {
  try {
    const { reviewName, review } = req.body;
    if (!reviewName || !review) {
      return res.status(400).json({ error: 'reviewName and review are required' });
    }

    // Import responder to generate reply
    const googleReviewsResponder = require('./services/google-reviews-responder');

    // Generate AI response
    const replyText = await googleReviewsResponder.generateResponse(review);
    console.log(`[Google Reviews] Generated reply for ${review.reviewer?.displayName}: "${replyText.substring(0, 50)}..."`);

    // Post reply
    await googleBusinessAPI.replyToReview(reviewName, replyText);
    console.log(`[Google Reviews] ✅ Reply posted to ${reviewName}`);

    res.json({ status: 'ok', reply: replyText });
  } catch (error) {
    console.error('[Google Reviews] Reply single error:', error.message);
    res.status(500).json({ error: error.message });
  }
});

// ==========================================
// Threads Keyword Search API Routes
// ==========================================

// Threads search status
app.get('/api/threads/status', async (req, res) => {
  try {
    const threadsDB = require('./services/threads-database');
    const threadsAPI = require('./services/threads-api');
    const stats = await threadsDB.getStats();
    const chartData = await threadsDB.getChartData();
    const keywordsInfo = threadsKeywordSearch.getKeywordsInfo();
    const tokenStatus = threadsAPI.getTokenStatus();
    res.json({
      enabled: true,
      schedule: ['08:00', '14:00', '20:00'],
      maxRepliesPerDay: 10,
      isSearching: threadsKeywordSearch.isSearching,
      tokenStatus,
      stats,
      chartData,
      totalKeywords: keywordsInfo.totalMedicalKeywords + 1, // +1 for city
      keywordsPerCycle: keywordsInfo.keywordsPerCycle
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Get keywords info
app.get('/api/threads/keywords', (req, res) => {
  try {
    const info = threadsKeywordSearch.getKeywordsInfo();
    res.json(info);
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
      const newPosts = await threadsDB.getPostsByStatus('new', 100);
      const skipped = await threadsDB.getPostsByStatus('skipped', 100);
      const validated = await threadsDB.getPostsByStatus('validated', 100);
      const replied = await threadsDB.getPostsByStatus('replied', 100);
      posts = [...newPosts, ...skipped, ...validated, ...replied];
    } else if (status === 'new') {
      // Show both new and skipped (LLM rejected) posts
      const newPosts = await threadsDB.getPostsByStatus('new', 100);
      const skipped = await threadsDB.getPostsByStatus('skipped', 100);
      posts = [...newPosts, ...skipped];
    } else {
      posts = await threadsDB.getPostsByStatus(status, 100);
    }
    res.json({ count: posts.length, posts });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// SSE endpoint - real-time search log stream
app.get('/api/threads/search/stream', (req, res) => {
  res.writeHead(200, {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache',
    'Connection': 'keep-alive',
    'X-Accel-Buffering': 'no'
  });

  // Send existing log entries if search is already in progress
  const existingLog = threadsKeywordSearch.getSearchLog();
  for (const entry of existingLog) {
    res.write(`data: ${JSON.stringify(entry)}\n\n`);
  }

  // Listen for new log entries
  const onLog = (entry) => {
    res.write(`data: ${JSON.stringify(entry)}\n\n`);
  };

  threadsKeywordSearch.on('searchLog', onLog);

  // Clean up on client disconnect
  req.on('close', () => {
    threadsKeywordSearch.off('searchLog', onLog);
  });
});

// Get latest search log (for non-SSE clients)
app.get('/api/threads/search/log', (req, res) => {
  res.json({
    isSearching: threadsKeywordSearch.isSearching,
    log: threadsKeywordSearch.getSearchLog()
  });
});

// Manual trigger - run search cycle (non-blocking, returns immediately)
app.post('/api/threads/search', async (req, res) => {
  try {
    if (threadsKeywordSearch.isSearching) {
      return res.json({ status: 'already_searching', message: 'Поиск уже запущен' });
    }

    console.log('[Threads] Manual search triggered');
    res.json({ status: 'started', message: 'Поиск запущен. Следите за логом.' });

    // Run search asynchronously
    threadsKeywordSearch.runSearchCycle(0).then(async () => {
      console.log('[Threads] Manual search completed');
    }).catch(err => {
      console.error('[Threads] Manual search error:', err.message);
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Stop an in-progress search
app.post('/api/threads/search/stop', (req, res) => {
  const stopped = threadsKeywordSearch.stopSearch();
  res.json({ status: stopped ? 'stopping' : 'not_searching', message: stopped ? 'Остановка поиска...' : 'Поиск не запущен' });
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

app.get('/login', (req, res) => {
  res.sendFile(path.join(__dirname, '../dashboard/login.html'));
});

app.get('/forgot-password', (req, res) => {
  res.sendFile(path.join(__dirname, '../dashboard/forgot-password.html'));
});

app.get('/register', (req, res) => {
  res.sendFile(path.join(__dirname, '../dashboard/register.html'));
});

app.get('/reset-password', (req, res) => {
  res.sendFile(path.join(__dirname, '../dashboard/reset-password.html'));
});

// Dashboard route
app.get('/', requireAppSessionPage, (req, res) => {
  res.sendFile(path.join(__dirname, '../dashboard/index.html'));
});

if (require.main === module) {
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
    console.log(`🧵 Threads Search scheduled: 08:00, 14:00, 20:00`);
    console.log('');
  });
}

module.exports = app;
