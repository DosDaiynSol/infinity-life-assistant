require('dotenv').config();
const express = require('express');
const cors = require('cors');
const path = require('path');
const InstagramLiveAssistant = require('./services/instagram-live-assistant');
const userManager = require('./services/user-manager');
const statsManager = require('./services/stats-manager');

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
const crossPostService = require('./services/crosspost-service');
const schedule = require('node-schedule');

const app = express();
const PORT = process.env.PORT || 3000;

// Middleware
app.use(cors());
// Allow text/plain payloads (e.g., n8n forwards) to be parsed manually
app.use(express.text({ type: 'text/*' }));
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(express.static(path.join(__dirname, '../dashboard')));

const assistantRuntime = new InstagramLiveAssistant();

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

function createIncident({
  id,
  severity,
  source,
  title,
  detail,
  actionLabel = null,
  actionType = null,
  actionPlatform = null,
  actionName = null,
  actionService = null,
  actionUrl = null
}) {
  return {
    id,
    severity,
    source,
    title,
    detail,
    actionLabel,
    actionType,
    actionPlatform,
    actionName,
    actionService,
    actionUrl
  };
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
    },
    crosspost: {
      status: 'manual_required',
      url: 'https://developers.facebook.com/apps/',
      message: 'Кросспост зависит от авторизации Meta, которая используется для Instagram и Facebook.'
    }
  };

  return configs[service] || {
    status: 'manual_required',
    url: null,
    message: 'Для этого сервиса ещё не настроен сценарий переавторизации.'
  };
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

async function loadCrosspostOperationalData() {
  const queueStatus = await crossPostService.getQueueStatus();
  return {
    id: 'crosspost',
    name: 'Кросспост',
    ...queueStatus
  };
}

function buildIntegrationServices({ instagram, youtube, google, threads, crosspost }) {
  const now = new Date().toISOString();
  const crosspostFailed = (crosspost.counts?.facebook?.failed || 0)
    + (crosspost.counts?.youtube?.failed || 0)
    + (crosspost.counts?.vk?.failed || 0);

  const services = [
    {
      id: 'instagram_messaging',
      name: 'Instagram Direct',
      provider: 'Meta',
      status: instagram.authorized ? (instagram.queue.total > 8 ? 'degraded' : 'healthy') : 'reauth_required',
      summary: instagram.authorized
        ? `${instagram.queue.total} задач ждут обработки в буфере`
        : 'В активном окружении нет рабочего токена Instagram',
      lastCheckedAt: now,
      lastError: instagram.authorized ? null : 'Токен Instagram Messaging не настроен.',
      actions: ['process', 'reauthorize']
    },
    {
      id: 'youtube',
      name: 'YouTube доступ',
      provider: 'Google',
      status: youtube.authorized ? 'healthy' : 'reauth_required',
      summary: youtube.authorized
        ? `${youtube.stats.totalResponses || 0} ответов уже отправлено`
        : 'Для доступа к каналу нужна новая авторизация',
      lastCheckedAt: now,
      lastError: youtube.authorized ? null : 'Токен YouTube OAuth недоступен.',
      actions: ['process-channel', 'reauthorize']
    },
    {
      id: 'google_business',
      name: 'Google Business',
      provider: 'Google',
      status: google.authorized ? (google.reviewsError ? 'degraded' : 'healthy') : 'reauth_required',
      summary: google.authorized
        ? `${google.stats.pendingReviews} отзывов без ответа, ${google.stats.escalationReviews} требуют эскалации`
        : 'Для доступа к карточке нужна новая авторизация',
      lastCheckedAt: now,
      lastError: google.reviewsError || (google.authorized ? null : 'Refresh token для Google Business не настроен.'),
      actions: ['preview', 'reauthorize']
    },
    {
      id: 'threads',
      name: 'Threads токен',
      provider: 'Meta',
      status: threads.tokenStatus.hasToken
        ? (threads.tokenStatus.expired ? 'reauth_required' : 'healthy')
        : 'reauth_required',
      summary: threads.tokenStatus.expired
        ? 'Токен Threads истёк, автообновление не помогло'
        : `${threads.stats.validated || 0} подходящих публикаций ждут решения`,
      lastCheckedAt: now,
      lastError: threads.tokenStatus.error || null,
      actions: ['search', 'reauthorize']
    },
    {
      id: 'crosspost',
      name: 'Кросспост',
      provider: 'Meta / VK / YouTube',
      status: crosspostFailed > 0 ? 'degraded' : 'healthy',
      summary: `Ошибки доставки по недавним публикациям: ${crosspostFailed}`,
      lastCheckedAt: now,
      lastError: crosspostFailed > 0 ? 'В очереди кросспоста есть каналы с ошибкой доставки.' : null,
      actions: ['poll', 'retry']
    }
  ];

  return services.sort((left, right) => getStatusWeight(left.status) - getStatusWeight(right.status));
}

function buildOperationalIncidents({ instagram, youtube, google, threads, crosspost, integrations }) {
  const incidents = [];
  const crosspostFailed = (crosspost.counts?.facebook?.failed || 0)
    + (crosspost.counts?.youtube?.failed || 0)
    + (crosspost.counts?.vk?.failed || 0);

  integrations.forEach((service) => {
    if (service.status === 'reauth_required') {
      incidents.push(createIncident({
        id: `${service.id}-reauth`,
        severity: 'critical',
        source: service.name,
        title: `Нужно заново авторизовать: ${service.name}`,
        detail: service.lastError || service.summary,
        actionLabel: 'Открыть авторизацию',
        actionType: 'reauthorize',
        actionService: service.id
      }));
    } else if (service.status === 'degraded' && service.lastError) {
      incidents.push(createIncident({
        id: `${service.id}-degraded`,
        severity: 'warning',
        source: service.name,
        title: `${service.name}: состояние нестабильно`,
        detail: service.lastError
      }));
    }
  });

  if (google.stats.escalationReviews > 0) {
    incidents.push(createIncident({
      id: 'google-negative-reviews',
      severity: 'critical',
      source: 'Google Отзывы',
      title: `${google.stats.escalationReviews} негативных отзывов ждут эскалации`,
      detail: 'Есть низкие оценки без ответа клиники.'
    }));
  }

  if (instagram.queue.total > 0) {
    incidents.push(createIncident({
      id: 'instagram-backlog',
      severity: instagram.queue.total > 8 ? 'critical' : 'warning',
      source: 'Очередь Instagram',
      title: `${instagram.queue.total} задач в Instagram ждут обработки`,
      detail: `${instagram.queue.dms} сообщений и ${instagram.queue.comments} комментариев всё ещё лежат в буфере.`,
      actionLabel: 'Запустить очередь Instagram',
      actionType: 'platform_action',
      actionPlatform: 'instagram',
      actionName: 'process'
    }));
  }

  if ((threads.stats.validated || 0) > 0) {
    incidents.push(createIncident({
      id: 'threads-validated-backlog',
      severity: 'warning',
      source: 'Threads',
      title: `${threads.stats.validated} публикаций в Threads ждут решения`,
      detail: 'Эти публикации прошли фильтр, но ответ по ним ещё не принят.'
    }));
  }

  if (crosspostFailed > 0) {
    incidents.push(createIncident({
      id: 'crosspost-failures',
      severity: 'warning',
      source: 'Кросспост',
      title: `Ошибки доставки кросспоста: ${crosspostFailed}`,
      detail: 'Нужен повтор или ручная проверка последних публикаций.',
      actionLabel: 'Повторить ошибки',
      actionType: 'platform_action',
      actionPlatform: 'crosspost',
      actionName: 'retry'
    }));
  }

  return incidents
    .sort((left, right) => getSeverityWeight(left.severity) - getSeverityWeight(right.severity))
    .slice(0, 10);
}

function buildOverviewPayload({ instagram, youtube, google, threads, crosspost, integrations, incidents }) {
  const healthyIntegrations = integrations.filter((service) => service.status === 'healthy').length;
  const responsesDelivered = (instagram.stats.responsesSet || 0)
    + (youtube.stats.totalResponses || 0)
    + (google.stats.totalReplied || 0)
    + (threads.stats.replied || 0);
  const queueTotal = instagram.queue.total
    + (threads.stats.validated || 0)
    + (google.stats.pendingReviews || 0)
    + ((crosspost.counts?.facebook?.failed || 0) + (crosspost.counts?.youtube?.failed || 0) + (crosspost.counts?.vk?.failed || 0));

  return {
    generatedAt: new Date().toISOString(),
    summary: {
      activeIncidents: incidents.length,
      queuedWork: queueTotal,
      healthyIntegrations,
      totalIntegrations: integrations.length,
      responsesDelivered
    },
    metrics: [
      {
        id: 'incidents',
        label: 'Проблемы',
        value: incidents.length,
        detail: incidents.filter((incident) => incident.severity === 'critical').length > 0
          ? `${incidents.filter((incident) => incident.severity === 'critical').length} критично`
          : 'Критичных проблем нет',
        tone: incidents.some((incident) => incident.severity === 'critical') ? 'critical' : 'healthy'
      },
      {
        id: 'queues',
        label: 'Задачи в работе',
        value: queueTotal,
        detail: `${instagram.queue.total} в Instagram, ${threads.stats.validated || 0} в Threads, ${google.stats.pendingReviews || 0} в Google`,
        tone: queueTotal > 0 ? 'warning' : 'healthy'
      },
      {
        id: 'integrations',
        label: 'Интеграции',
        value: `${healthyIntegrations}/${integrations.length}`,
        detail: `${integrations.length - healthyIntegrations} требуют внимания`,
        tone: healthyIntegrations === integrations.length ? 'healthy' : 'warning'
      },
      {
        id: 'throughput',
        label: 'Ответов отправлено',
        value: responsesDelivered,
        detail: 'Суммарно по активным каналам',
        tone: 'healthy'
      }
    ],
    incidents,
    integrations: integrations.map((service) => ({
      id: service.id,
      name: service.name,
      status: service.status,
      provider: service.provider,
      summary: service.summary
    })),
    attention: [
      {
        id: 'queues',
        title: 'Где копятся задачи',
        items: [
          { label: 'Instagram', value: instagram.queue.total, tone: instagram.queue.total > 0 ? 'warning' : 'healthy' },
          { label: 'Threads', value: threads.stats.validated || 0, tone: (threads.stats.validated || 0) > 0 ? 'warning' : 'healthy' },
          { label: 'Google', value: google.stats.pendingReviews || 0, tone: (google.stats.pendingReviews || 0) > 0 ? 'warning' : 'healthy' }
        ]
      },
      {
        id: 'reviews',
        title: 'Отзывы и репутация',
        items: [
          { label: 'Негативные отзывы', value: google.stats.escalationReviews || 0, tone: (google.stats.escalationReviews || 0) > 0 ? 'critical' : 'healthy' },
          { label: 'Ответы сегодня', value: google.stats.todayReplied || 0, tone: 'healthy' },
          { label: 'Ответы в Threads', value: threads.stats.replied || 0, tone: 'healthy' }
        ]
      },
      {
        id: 'delivery',
        title: 'Автоматизации и доставка',
        items: [
          { label: 'Ответы в YouTube', value: youtube.stats.totalResponses || 0, tone: youtube.authorized ? 'healthy' : 'warning' },
          { label: 'Ошибки кросспоста', value: (crosspost.counts?.facebook?.failed || 0) + (crosspost.counts?.youtube?.failed || 0) + (crosspost.counts?.vk?.failed || 0), tone: ((crosspost.counts?.facebook?.failed || 0) + (crosspost.counts?.youtube?.failed || 0) + (crosspost.counts?.vk?.failed || 0)) > 0 ? 'warning' : 'healthy' },
          { label: 'Ответы из буфера', value: instagram.stats.responsesSet || 0, tone: 'healthy' }
        ]
      }
    ]
  };
}

function buildQueuesPayload({ instagram, google, threads, crosspost }) {
  const googlePendingItems = google.reviews
    .filter((review) => review.status === 'pending' || review.status === 'escalation')
    .sort((left, right) => left.rating - right.rating)
    .slice(0, 12)
    .map((review) => createQueueItem({
      id: `google-${review.id}`,
      source: 'google',
      queue: 'reviews',
      title: `${review.rating || 0}-звёздочный отзыв от ${review.reviewer}`,
      body: truncateText(review.comment || 'Текст отзыва отсутствует'),
      status: review.status,
      priority: review.status === 'escalation' ? 'critical' : 'normal',
      createdAt: review.createdAt,
      meta: review.status === 'escalation' ? 'Нужна эскалация' : 'Ответ ещё не отправлен'
    }));

  const threadItems = threads.posts
    .filter((post) => post.status === 'validated' || post.status === 'new' || post.status === 'skipped')
    .slice(0, 12)
    .map((post) => createQueueItem({
      id: `threads-${post.id}`,
      source: 'threads',
      queue: 'candidates',
      title: `@${post.username || 'неизвестно'}: найден сигнал «${post.keyword_matched || 'совпадение'}»`,
      body: truncateText(post.text || 'Текст публикации отсутствует'),
      status: post.status,
      priority: post.status === 'validated' ? 'high' : 'normal',
      createdAt: post.created_at,
      meta: post.reply_text ? truncateText(post.reply_text, 80) : 'Ждёт решения оператора',
      link: post.permalink || null
    }));

  const crosspostItems = (crosspost.recentPosts || [])
    .filter((post) => Object.values(post.statuses || {}).some((status) => status === 'failed' || status === 'pending'))
    .slice(0, 12)
    .map((post) => {
      const failedDestinations = Object.entries(post.statuses || {})
        .filter(([, status]) => status === 'failed')
        .map(([platform]) => platform);

      return createQueueItem({
        id: `crosspost-${post.id}`,
        source: 'crosspost',
        queue: 'delivery',
        title: `Публикация Instagram ${post.instagramId}`,
        body: truncateText(post.caption || 'Подпись к публикации отсутствует'),
        status: failedDestinations.length > 0 ? 'failed' : 'pending',
        priority: failedDestinations.length > 0 ? 'high' : 'normal',
        createdAt: post.createdAt || post.postedAt,
        meta: failedDestinations.length > 0
          ? `Ошибка в каналах: ${failedDestinations.join(', ')}`
          : 'Доставка по каналам ещё не завершена',
        link: post.permalink || null
      });
    });

  const sections = [
    {
      id: 'instagram',
      label: 'Instagram',
      description: 'Сообщения и комментарии, которые ещё не ушли в обработку.',
      tone: instagram.queue.total > 0 ? 'warning' : 'healthy',
      total: instagram.queue.total,
      items: instagram.queue.items
    },
    {
      id: 'threads',
      label: 'Threads',
      description: 'Найденные публикации, которые требуют решения или ответа.',
      tone: (threads.stats.validated || 0) > 0 ? 'warning' : 'healthy',
      total: threadItems.length,
      items: threadItems
    },
    {
      id: 'google',
      label: 'Google Отзывы',
      description: 'Отзывы без ответа, включая низкие оценки с риском для репутации.',
      tone: google.stats.escalationReviews > 0 ? 'critical' : (google.stats.pendingReviews > 0 ? 'warning' : 'healthy'),
      total: googlePendingItems.length,
      items: googlePendingItems
    },
    {
      id: 'crosspost',
      label: 'Кросспост',
      description: 'Ошибки доставки и публикации, которые надо повторить.',
      tone: crosspostItems.some((item) => item.status === 'failed') ? 'warning' : 'healthy',
      total: crosspostItems.length,
      items: crosspostItems
    }
  ];

  return {
    generatedAt: new Date().toISOString(),
    total: sections.reduce((sum, section) => sum + section.total, 0),
    sections
  };
}

function buildPlatformSummary(platform) {
  return {
    id: platform.id,
    name: platform.name,
    status: platform.status,
    summary: platform.summary,
    metrics: platform.metrics
  };
}

function buildPlatformsPayload({ instagram, youtube, google, threads, crosspost, integrations }) {
  const integrationMap = new Map(integrations.map((service) => [service.id, service]));
  const crosspostFailures = (crosspost.counts?.facebook?.failed || 0)
    + (crosspost.counts?.youtube?.failed || 0)
    + (crosspost.counts?.vk?.failed || 0);

  return {
    generatedAt: new Date().toISOString(),
    items: [
      buildPlatformSummary({
        id: 'instagram',
        name: 'Instagram',
        status: integrationMap.get('instagram_messaging')?.status || 'healthy',
        summary: `${instagram.queue.total} задач в очереди и ${instagram.stats.responsesSet || 0} уже зафиксированных ответов`,
        metrics: [
          { label: 'В буфере', value: instagram.queue.total },
          { label: 'Ответов', value: instagram.stats.responsesSet || 0 },
          { label: 'Контактов', value: instagram.stats.uniqueDMSenders || 0 }
        ]
      }),
      buildPlatformSummary({
        id: 'youtube',
        name: 'YouTube',
        status: integrationMap.get('youtube')?.status || 'healthy',
        summary: `${youtube.stats.totalComments || 0} комментариев обработано, ${youtube.stats.totalResponses || 0} ответов отправлено`,
        metrics: [
          { label: 'Видео', value: youtube.stats.processedVideos || 0 },
          { label: 'Комментарии', value: youtube.stats.totalComments || 0 },
          { label: 'Ответы', value: youtube.stats.totalResponses || 0 }
        ]
      }),
      buildPlatformSummary({
        id: 'threads',
        name: 'Threads',
        status: integrationMap.get('threads')?.status || 'healthy',
        summary: `${threads.stats.validated || 0} публикаций ждут решения, ${threads.stats.replied || 0} ответов уже отправлено`,
        metrics: [
          { label: 'Найдено', value: threads.stats.postsFound || 0 },
          { label: 'Проверено', value: threads.stats.validated || 0 },
          { label: 'С ответом', value: threads.stats.replied || 0 }
        ]
      }),
      buildPlatformSummary({
        id: 'google',
        name: 'Google Отзывы',
        status: integrationMap.get('google_business')?.status || 'healthy',
        summary: `${google.stats.pendingReviews || 0} отзывов без ответа и ${google.stats.escalationReviews || 0} на эскалации`,
        metrics: [
          { label: 'Всего отзывов', value: google.stats.totalReviews || 0 },
          { label: 'Без ответа', value: google.stats.pendingReviews || 0 },
          { label: 'Эскалации', value: google.stats.escalationReviews || 0 }
        ]
      }),
      buildPlatformSummary({
        id: 'crosspost',
        name: 'Кросспост',
        status: integrationMap.get('crosspost')?.status || 'healthy',
        summary: `Ошибки доставки по последним публикациям: ${crosspostFailures}`,
        metrics: [
          { label: 'В очереди', value: crosspost.counts?.total || 0 },
          { label: 'Ошибки', value: crosspostFailures },
          { label: 'Цикл', value: crosspost.isPolling ? 'Активен' : 'Пауза' }
        ]
      })
    ]
  };
}

function buildPlatformDetail(platformId, snapshots) {
  const { instagram, youtube, google, threads, crosspost, integrations } = snapshots;
  const integrationMap = new Map(integrations.map((service) => [service.id, service]));

  if (platformId === 'instagram') {
    return {
      id: 'instagram',
      name: 'Instagram',
      status: integrationMap.get('instagram_messaging')?.status || 'healthy',
      summary: 'Живой входящий поток сообщений и комментариев аккаунта клиники.',
      metrics: [
        { label: 'В буфере', value: instagram.queue.total },
        { label: 'Отправители DM', value: instagram.stats.uniqueDMSenders || 0 },
        { label: 'Комментаторы', value: instagram.stats.uniqueCommenters || 0 }
      ],
      sections: [
        {
          id: 'queue',
          title: 'Живой входящий поток',
          items: instagram.queue.items
        },
        {
          id: 'activity',
          title: 'Последние ответы',
          items: instagram.history.slice(0, 10).map((item, index) => ({
            id: `instagram-history-${index}`,
            title: item.username ? `@${item.username}` : (item.senderId || 'Неизвестный отправитель'),
            body: truncateText(item.text || (item.messages || []).join(' | ') || ''),
            meta: item.response ? `Ответ: ${truncateText(item.response, 80)}` : (item.status === 'processed' ? 'Обработано' : (item.status || 'Обработано')),
            createdAt: item.timestamp || null
          }))
        }
      ]
    };
  }

  if (platformId === 'youtube') {
    return {
      id: 'youtube',
      name: 'YouTube',
      status: integrationMap.get('youtube')?.status || 'healthy',
      summary: 'Плановая обработка комментариев под последними видео.',
      metrics: [
        { label: 'Видео', value: youtube.stats.processedVideos || 0 },
        { label: 'Комментарии', value: youtube.stats.totalComments || 0 },
        { label: 'Ответы', value: youtube.stats.totalResponses || 0 }
      ],
      sections: [
        {
          id: 'history',
          title: 'Последние ответы',
          items: youtube.history.slice(0, 10).map((item) => ({
            id: item.id,
            title: item.author || 'Неизвестный автор',
            body: truncateText(item.comment || ''),
            meta: item.response ? `Ответ: ${truncateText(item.response, 80)}` : item.title,
            createdAt: item.timestamp || null
          }))
        }
      ]
    };
  }

  if (platformId === 'threads') {
    return {
      id: 'threads',
      name: 'Threads',
      status: integrationMap.get('threads')?.status || 'healthy',
      summary: 'Поиск публикаций по ключевым словам и отбор тем для ответа.',
      metrics: [
        { label: 'API-запросы', value: threads.stats.apiRequests || 0 },
        { label: 'Проверено', value: threads.stats.validated || 0 },
        { label: 'Конверсия', value: `${threads.stats.conversionRate || 0}%` }
      ],
      sections: [
        {
          id: 'validated',
          title: 'Очередь кандидатов',
          items: threads.posts
            .filter((post) => post.status === 'validated' || post.status === 'new' || post.status === 'skipped')
            .slice(0, 12)
            .map((post) => ({
              id: `threads-detail-${post.id}`,
              title: `@${post.username || 'неизвестно'}`,
              body: truncateText(post.text || ''),
              meta: post.keyword_matched ? `Ключевое слово: ${post.keyword_matched}` : getOperationalStatusLabel(post.status),
              createdAt: post.created_at || null
            }))
        }
      ]
    };
  }

  if (platformId === 'google') {
    const positive = google.reviews.filter((review) => review.status === 'replied').slice(0, 8);
    const escalations = google.reviews.filter((review) => review.status === 'escalation').slice(0, 8);

    return {
      id: 'google',
      name: 'Google Отзывы',
      status: integrationMap.get('google_business')?.status || 'healthy',
      summary: 'Отзывы с отдельным приоритетом для негатива и ответов от клиники.',
      metrics: [
        { label: 'Без ответа', value: google.stats.pendingReviews || 0 },
        { label: 'Эскалации', value: google.stats.escalationReviews || 0 },
        { label: 'Ответы сегодня', value: google.stats.todayReplied || 0 }
      ],
      sections: [
        {
          id: 'escalations',
          title: 'Негативные отзывы',
          items: escalations.map((review) => ({
            id: `google-escalation-${review.id}`,
            title: `${review.rating}-звёздочный отзыв от ${review.reviewer}`,
            body: truncateText(review.comment || ''),
            meta: 'Нужна эскалация или ручное решение',
            createdAt: review.createdAt
          }))
        },
        {
          id: 'positive',
          title: 'Отзывы с ответом',
          items: positive.map((review) => ({
            id: `google-positive-${review.id}`,
            title: `${review.rating}-звёздочный отзыв от ${review.reviewer}`,
            body: truncateText(review.comment || ''),
            meta: review.reply ? `Ответ: ${truncateText(review.reply, 80)}` : 'Ответ уже зафиксирован',
            createdAt: review.createdAt
          }))
        }
      ]
    };
  }

  if (platformId === 'crosspost') {
    return {
      id: 'crosspost',
      name: 'Кросспост',
      status: integrationMap.get('crosspost')?.status || 'healthy',
      summary: 'Состояние доставки публикаций в Facebook, YouTube и VK.',
      metrics: [
        { label: 'В очереди', value: crosspost.counts?.total || 0 },
        { label: 'Ошибки Facebook', value: crosspost.counts?.facebook?.failed || 0 },
        { label: 'Ошибки VK', value: crosspost.counts?.vk?.failed || 0 }
      ],
      sections: [
        {
          id: 'recent',
          title: 'Последние попытки доставки',
          items: (crosspost.recentPosts || []).slice(0, 12).map((post) => ({
            id: `crosspost-detail-${post.id}`,
            title: `Публикация ${post.instagramId}`,
            body: truncateText(post.caption || ''),
            meta: Object.entries(post.statuses || {})
              .map(([channel, status]) => `${channel}: ${getOperationalStatusLabel(status)}`)
              .join(' | '),
            createdAt: post.createdAt || post.postedAt || null
          }))
        }
      ]
    };
  }

  return null;
}

function buildActivityPayload({ instagram, youtube, google, threads, crosspost }) {
  const activityItems = [
    ...instagram.history.slice(0, 10).map((item, index) => ({
      id: `activity-instagram-${index}`,
      source: 'Instagram',
      title: item.username ? `Ответ для @${item.username}` : `Диалог ${item.senderId || 'неизвестно'}`,
      detail: truncateText(item.response || item.text || ''),
      status: item.error ? 'failed' : (item.responded ? 'sent' : 'processed'),
      timestamp: item.timestamp || null
    })),
    ...youtube.history.slice(0, 8).map((item) => ({
      id: `activity-youtube-${item.id}`,
      source: 'YouTube',
      title: `Ответ пользователю ${item.author || 'зритель'}`,
      detail: truncateText(item.response || item.comment || ''),
      status: 'sent',
      timestamp: item.timestamp || null
    })),
    ...google.reviews
      .filter((review) => review.status === 'replied')
      .slice(0, 8)
      .map((review) => ({
        id: `activity-google-${review.id}`,
        source: 'Google Отзывы',
        title: `Ответ для ${review.reviewer}`,
        detail: truncateText(review.reply || review.comment || ''),
        status: 'sent',
        timestamp: review.createdAt || null
      })),
    ...threads.posts
      .filter((post) => post.status === 'replied')
      .slice(0, 8)
      .map((post) => ({
        id: `activity-threads-${post.id}`,
        source: 'Threads',
        title: `Ответ для @${post.username || 'неизвестно'}`,
        detail: truncateText(post.reply_text || post.text || ''),
        status: 'sent',
        timestamp: post.replied_at || post.created_at || null
      })),
    ...(crosspost.recentPosts || []).slice(0, 8).map((post) => ({
      id: `activity-crosspost-${post.id}`,
      source: 'Кросспост',
      title: `Статус доставки для ${post.instagramId}`,
      detail: Object.entries(post.statuses || {})
        .map(([channel, status]) => `${channel}: ${getOperationalStatusLabel(status)}`)
        .join(' | '),
      status: Object.values(post.statuses || {}).some((status) => status === 'failed') ? 'failed' : 'processed',
      timestamp: post.createdAt || post.postedAt || null
    }))
  ];

  return {
    generatedAt: new Date().toISOString(),
    items: activityItems
      .sort((left, right) => {
        const leftTime = left.timestamp ? new Date(left.timestamp).getTime() : 0;
        const rightTime = right.timestamp ? new Date(right.timestamp).getTime() : 0;
        return rightTime - leftTime;
      })
      .slice(0, 40)
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

function buildRealtimeIntegrationServices({ instagramRealtime, youtube, google, threads, crosspost }) {
  const now = new Date().toISOString();
  const crosspostFailed = (crosspost.counts?.facebook?.failed || 0)
    + (crosspost.counts?.youtube?.failed || 0)
    + (crosspost.counts?.vk?.failed || 0);

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
    },
    {
      id: 'crosspost',
      name: 'Кросспост',
      provider: 'Meta / VK / YouTube',
      status: crosspostFailed > 0 ? 'degraded' : 'healthy',
      summary: crosspostFailed > 0
        ? `${crosspostFailed} последних доставок завершились ошибкой`
        : 'Последние доставки прошли без ошибок',
      lastCheckedAt: now,
      lastError: crosspostFailed > 0 ? 'Есть ошибки в недавних доставках кросспоста.' : null,
      actions: []
    }
  ];

  return services.sort((left, right) => getStatusWeight(left.status) - getStatusWeight(right.status));
}

function buildRealtimeDashboardIncidents({ instagramRealtime, integrations, google, crosspost }) {
  const incidents = instagramRealtime.incidents.map((incident) => createIncident({
    id: incident.id,
    severity: incident.severity,
    source: incident.service,
    title: incident.title,
    detail: incident.detail,
    actionLabel: incident.service === 'instagram_meta' ? 'Открыть авторизацию' : null,
    actionType: incident.service === 'instagram_meta' ? 'reauthorize' : null,
    actionService: incident.service === 'instagram_meta' ? 'instagram_meta' : null
  }));

  integrations
    .filter((service) => service.status === 'reauth_required' && service.id !== 'instagram_meta')
    .forEach((service) => {
      incidents.push(createIncident({
        id: `${service.id}-reauth`,
        severity: 'critical',
        source: service.name,
        title: `Нужна повторная авторизация: ${service.name}`,
        detail: service.lastError || service.summary,
        actionLabel: 'Открыть авторизацию',
        actionType: 'reauthorize',
        actionService: service.id
      }));
    });

  if ((google.stats.escalationReviews || 0) > 0) {
    incidents.push(createIncident({
      id: 'google-escalation-reviews',
      severity: 'critical',
      source: 'Google Отзывы',
      title: `${google.stats.escalationReviews} отзывов требуют эскалации`,
      detail: 'Найдены отзывы с повышенным репутационным риском.'
    }));
  }

  const crosspostFailed = (crosspost.counts?.facebook?.failed || 0)
    + (crosspost.counts?.youtube?.failed || 0)
    + (crosspost.counts?.vk?.failed || 0);

  if (crosspostFailed > 0) {
    incidents.push(createIncident({
      id: 'crosspost-delivery-failures',
      severity: 'warning',
      source: 'Кросспост',
      title: `${crosspostFailed} недавних ошибок доставки`,
      detail: 'Есть публикации, которые не дошли до всех каналов.'
    }));
  }

  return incidents
    .sort((left, right) => getSeverityWeight(left.severity) - getSeverityWeight(right.severity))
    .slice(0, 20);
}

function buildRealtimeOverviewPayload({ instagramRealtime, youtube, google, threads, crosspost, integrations, incidents }) {
  const degradedIntegrations = integrations.filter((service) => service.status !== 'healthy').length;
  const responsesDelivered = (instagramRealtime.metrics.delivered || 0)
    + (youtube.stats.totalResponses || 0)
    + (google.stats.totalReplied || 0)
    + (threads.stats.replied || 0);
  const crosspostFailed = (crosspost.counts?.facebook?.failed || 0)
    + (crosspost.counts?.youtube?.failed || 0)
    + (crosspost.counts?.vk?.failed || 0);

  return {
    generatedAt: new Date().toISOString(),
    summary: {
      openIncidents: incidents.length,
      degradedIntegrations,
      totalIntegrations: integrations.length,
      liveEvents: instagramRealtime.metrics.inbound || 0,
      autoReplies: instagramRealtime.metrics.autoReplies || 0,
      safeFallbacks: instagramRealtime.metrics.safeFallbacks || 0,
      escalations: instagramRealtime.metrics.escalations || 0,
      p95ReplySeconds: instagramRealtime.metrics.p95ReplySeconds,
      responsesDelivered
    },
    metrics: [
      {
        id: 'incidents',
        label: 'Инциденты',
        value: incidents.length,
        detail: incidents.filter((incident) => incident.severity === 'critical').length > 0
          ? `${incidents.filter((incident) => incident.severity === 'critical').length} критичных`
          : 'Критичных нет',
        tone: incidents.some((incident) => incident.severity === 'critical') ? 'critical' : 'healthy'
      },
      {
        id: 'latency',
        label: 'P95 ответ',
        value: instagramRealtime.metrics.p95ReplySeconds === null
          ? 'n/a'
          : `${instagramRealtime.metrics.p95ReplySeconds.toFixed(1)}s`,
        detail: 'Instagram live reply latency',
        tone: instagramRealtime.metrics.p95ReplySeconds !== null && instagramRealtime.metrics.p95ReplySeconds > 5
          ? 'warning'
          : 'healthy'
      },
      {
        id: 'delivery',
        label: 'Доставлено',
        value: responsesDelivered,
        detail: `${instagramRealtime.metrics.failed || 0} ошибок Instagram, ${crosspostFailed} ошибок кросспоста`,
        tone: (instagramRealtime.metrics.failed || 0) > 0 ? 'warning' : 'healthy'
      },
      {
        id: 'integrations',
        label: 'Интеграции',
        value: `${integrations.length - degradedIntegrations}/${integrations.length}`,
        detail: `${degradedIntegrations} требуют внимания`,
        tone: degradedIntegrations > 0 ? 'warning' : 'healthy'
      }
    ],
    incidents: incidents.slice(0, 8),
    liveFeed: instagramRealtime.liveFeed.slice(0, 8),
    integrations: integrations.map((service) => ({
      id: service.id,
      name: service.name,
      provider: service.provider,
      status: service.status,
      summary: service.summary
    }))
  };
}

function buildLiveFeedPayload(instagramRealtime) {
  return {
    generatedAt: new Date().toISOString(),
    items: instagramRealtime.liveFeed
  };
}

function buildIncidentsPayload(incidents) {
  return {
    generatedAt: new Date().toISOString(),
    summary: {
      total: incidents.length,
      critical: incidents.filter((incident) => incident.severity === 'critical').length,
      warning: incidents.filter((incident) => incident.severity === 'warning').length
    },
    items: incidents
  };
}

function buildChannelsPayload({ instagramRealtime, youtube, google, threads, crosspost, integrations }) {
  const integrationMap = new Map(integrations.map((service) => [service.id, service]));
  const crosspostFailed = (crosspost.counts?.facebook?.failed || 0)
    + (crosspost.counts?.youtube?.failed || 0)
    + (crosspost.counts?.vk?.failed || 0);

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
      },
      {
        id: 'crosspost',
        name: 'Кросспост',
        status: integrationMap.get('crosspost')?.status || 'healthy',
        summary: 'Состояние доставки публикаций по каналам.',
        metrics: [
          { label: 'В очереди', value: crosspost.counts?.total || 0 },
          { label: 'Ошибки', value: crosspostFailed },
          { label: 'Цикл', value: crosspost.isPolling ? 'Активен' : 'Пауза' }
        ],
        recent: (crosspost.recentPosts || []).slice(0, 5).map((post) => ({
          id: `crosspost-${post.id}`,
          title: `Публикация ${post.instagramId}`,
          detail: Object.entries(post.statuses || {})
            .map(([channel, status]) => `${channel}: ${getOperationalStatusLabel(status)}`)
            .join(' | '),
          status: Object.values(post.statuses || {}).some((status) => status === 'failed') ? 'failed' : 'processed',
          timestamp: post.createdAt || post.postedAt
        }))
      }
    ]
  };
}

function buildRealtimeActivityPayload({ instagramActivity, youtube, google, threads, crosspost }) {
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
      })),
    ...(crosspost.recentPosts || []).slice(0, 8).map((post) => ({
      id: `activity-crosspost-${post.id}`,
      source: 'Кросспост',
      title: `Статус доставки для ${post.instagramId}`,
      detail: Object.entries(post.statuses || {})
        .map(([channel, status]) => `${channel}: ${getOperationalStatusLabel(status)}`)
        .join(' | '),
      status: Object.values(post.statuses || {}).some((status) => status === 'failed') ? 'failed' : 'processed',
      timestamp: post.createdAt || post.postedAt || null
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
  const [instagramRealtime, youtube, google, threads, crosspost] = await Promise.all([
    assistantRuntime.getInstagramSummary(),
    loadYouTubeOperationalData(),
    loadGoogleOperationalData({ includeReviews: includeGoogleReviews }),
    loadThreadsOperationalData({ includePosts: includeThreadPosts }),
    loadCrosspostOperationalData()
  ]);

  const integrations = buildRealtimeIntegrationServices({
    instagramRealtime,
    youtube,
    google,
    threads,
    crosspost
  });

  return {
    instagramRealtime,
    youtube,
    google,
    threads,
    crosspost,
    integrations
  };
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
    const snapshots = await loadRealtimeDashboardSnapshots({
      includeGoogleReviews: true,
      includeThreadPosts: false
    });
    const incidents = buildRealtimeDashboardIncidents(snapshots);

    res.json(buildRealtimeOverviewPayload({
      ...snapshots,
      incidents
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
    const snapshots = await loadRealtimeDashboardSnapshots({
      includeGoogleReviews: false,
      includeThreadPosts: false
    });

    res.json({
      generatedAt: new Date().toISOString(),
      services: snapshots.integrations
    });
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
      threads: snapshots.threads,
      crosspost: snapshots.crosspost
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

    if (platform === 'crosspost' && action === 'poll') {
      if (crossPostService.isPolling) {
        return res.json({
          status: 'already_polling',
          message: 'Цикл кросспоста уже запущен.'
        });
      }

      crossPostService.runPollCycle().catch((error) => {
        console.error('[CrossPost] Manual poll error:', error.message);
      });

      return res.json({
        status: 'started',
        message: 'Цикл кросспоста запущен.'
      });
    }

    if (platform === 'crosspost' && action === 'retry') {
      const result = await crossPostService.retryFailed();
      return res.json({
        status: 'ok',
        message: 'Повторная доставка кросспоста завершена.',
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

// ==========================================
// Cross-Posting API Routes
// ==========================================

// CrossPost status
app.get('/api/crosspost/status', async (req, res) => {
  try {
    const status = await crossPostService.getQueueStatus();
    res.json(status);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Manual trigger - run poll cycle now
app.post('/api/crosspost/poll', async (req, res) => {
  try {
    if (crossPostService.isPolling) {
      return res.json({ status: 'already_polling', message: 'Polling уже запущен' });
    }

    console.log('[CrossPost] Manual poll triggered');
    res.json({ status: 'started', message: 'Polling запущен' });

    // Run async
    crossPostService.runPollCycle().then(result => {
      console.log('[CrossPost] Manual poll result:', JSON.stringify(result));
    }).catch(err => {
      console.error('[CrossPost] Manual poll error:', err.message);
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Retry failed cross-posts
app.post('/api/crosspost/retry', async (req, res) => {
  try {
    const result = await crossPostService.retryFailed();
    res.json({ status: 'ok', ...result });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Schedule CrossPost polling every 5 minutes
schedule.scheduleJob('*/5 * * * *', async () => {
  console.log('[CrossPost Schedule] Running poll cycle...');
  await crossPostService.runPollCycle();
});

// Also run once 60s after server start
setTimeout(() => {
  console.log('[CrossPost] Initial poll after startup...');
  crossPostService.runPollCycle();
}, 60000);

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
  console.log(`🧵 Threads Search scheduled: 08:00, 14:00, 20:00`);
  console.log(`🔄 CrossPost polling: every 5 minutes\n`);
});
