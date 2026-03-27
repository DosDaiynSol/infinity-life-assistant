const { applySlaState, buildSlaDeadline } = require('./sla-policy');

const DEFAULT_LIMIT = 200;

const SERVICE_LABELS = Object.freeze({
  instagram_dm: 'Сообщения Instagram',
  instagram_comment: 'Комментарии Instagram',
  google_reviews: 'Google Reviews',
  youtube: 'YouTube',
  threads: 'Threads'
});

const STATUS_LABELS = Object.freeze({
  new: 'Новое',
  ai_processed: 'Обработано ИИ',
  needs_attention: 'Требует внимания',
  closed: 'Закрыто',
  error: 'Ошибка'
});

const STAGE_LABELS = Object.freeze({
  received: 'Получено',
  processing: 'В обработке',
  classified: 'Проверено ИИ',
  generated: 'Ответ сгенерирован',
  sent: 'Отправлено',
  failed: 'Ошибка отправки',
  merged: 'Объединено',
  skipped: 'Закрыто',
  reviewed: 'Проверено человеком',
  handed_off: 'Передано человеку',
  validated: 'Подтверждено'
});

function mapStage(stage) {
  return {
    code: stage.name,
    label: STAGE_LABELS[stage.name] || stage.name,
    at: stage.at || null,
    detail: stage.detail || ''
  };
}

function normalizeInteractionStatus(rawStatus, fallback = 'new') {
  return STATUS_LABELS[rawStatus] ? rawStatus : fallback;
}

function sortByRecent(left, right) {
  const leftTime = new Date(left.updatedAt || left.receivedAt || 0).getTime() || 0;
  const rightTime = new Date(right.updatedAt || right.receivedAt || 0).getTime() || 0;
  return rightTime - leftTime;
}

function includesQuery(item, query) {
  if (!query) {
    return true;
  }

  const normalized = String(query).trim().toLowerCase();
  if (!normalized) {
    return true;
  }

  const haystack = [
    item.title,
    item.previewText,
    item.contactLabel,
    item.contactId,
    item.sourceUrl,
    item.serviceLabel
  ]
    .filter(Boolean)
    .join(' ')
    .toLowerCase();

  return haystack.includes(normalized);
}

function applyOverride(item, override) {
  if (!override) {
    return item;
  }

  const nextStatus = override.status
    ? normalizeInteractionStatus(override.status, item.status)
    : item.status;

  return {
    ...item,
    status: nextStatus,
    manualAttention: override.manualAttention || false,
    overrideUpdatedAt: override.updatedAt || null
  };
}

function buildInstagramInteraction(event, contact) {
  const service = event.channel === 'comment' ? 'instagram_comment' : 'instagram_dm';
  const status = (() => {
    if (event.deliveryStatus === 'failed' || event.status === 'failed') {
      return 'error';
    }

    if (event.decision === 'escalate' || event.status === 'escalated') {
      return 'needs_attention';
    }

    if (['sent', 'processed', 'replied'].includes(event.status) || event.deliveryStatus === 'sent') {
      return 'ai_processed';
    }

    if (['skipped', 'merged'].includes(event.status)) {
      return 'closed';
    }

    return 'new';
  })();

  return {
    id: event.id,
    service,
    serviceLabel: SERVICE_LABELS[service],
    rawStatus: event.status,
    status,
    statusLabel: STATUS_LABELS[status],
    title: service === 'instagram_dm'
      ? `Диалог с ${contact?.username || event.actorUsername || event.actorId || 'пользователем'}`
      : `Комментарий @${contact?.username || event.actorUsername || 'пользователя'}`,
    previewText: event.text || '',
    responseText: event.responseText || null,
    contactId: event.actorId || null,
    contactLabel: contact?.username || event.actorUsername || event.actorId || 'Неизвестно',
    conversationId: event.conversationId,
    sourceUrl: event.meta?.sourceUrl || null,
    handlingMode: ['auto_reply', 'safe_fallback'].includes(event.decision) ? 'ai' : 'human',
    receivedAt: event.receivedAt || null,
    updatedAt: event.updatedAt || event.processedAt || event.receivedAt || null,
    processedAt: event.processedAt || null,
    decision: event.decision || null,
    onlyUnprocessed: ['new', 'needs_attention'].includes(status),
    timeline: (event.stages || []).map(mapStage),
    serviceMeta: {
      channel: event.channel,
      deliveryStatus: event.deliveryStatus,
      decision: event.decision || null
    },
    relatedConversation: {
      id: event.conversationId,
      contactId: event.actorId || null
    },
    automation: {
      dmEnabled: contact ? contact.dm_enabled !== false : true,
      commentEnabled: contact ? contact.comment_enabled !== false : true
    }
  };
}

function buildSyntheticTimeline({ receivedAt, status, responseText }) {
  const stages = [
    {
      code: 'received',
      label: STAGE_LABELS.received,
      at: receivedAt,
      detail: 'Событие принято системой'
    }
  ];

  if (status === 'ai_processed') {
    stages.push({
      code: 'generated',
      label: STAGE_LABELS.generated,
      at: receivedAt,
      detail: 'Ответ подготовлен ИИ'
    });
    stages.push({
      code: 'sent',
      label: STAGE_LABELS.sent,
      at: receivedAt,
      detail: responseText ? 'Ответ отправлен' : 'Обработка завершена'
    });
  }

  if (status === 'needs_attention') {
    stages.push({
      code: 'handed_off',
      label: STAGE_LABELS.handed_off,
      at: receivedAt,
      detail: 'Нужно ручное внимание'
    });
  }

  if (status === 'closed') {
    stages.push({
      code: 'skipped',
      label: STAGE_LABELS.skipped,
      at: receivedAt,
      detail: 'Сценарий закрыт без ответа'
    });
  }

  if (status === 'error') {
    stages.push({
      code: 'failed',
      label: STAGE_LABELS.failed,
      at: receivedAt,
      detail: 'Во время обработки произошла ошибка'
    });
  }

  return stages;
}

function buildGoogleInteraction(review) {
  const status = review.status === 'replied'
    ? 'ai_processed'
    : (review.status === 'escalation' ? 'needs_attention' : 'new');

  return {
    id: `google:${review.id}`,
    service: 'google_reviews',
    serviceLabel: SERVICE_LABELS.google_reviews,
    rawStatus: review.status,
    status,
    statusLabel: STATUS_LABELS[status],
    title: `${review.rating || 0}★ ${review.reviewer}`,
    previewText: review.comment || '',
    responseText: review.reply || null,
    contactId: null,
    contactLabel: review.reviewer || 'Аноним',
    conversationId: `google:${review.id}`,
    sourceUrl: null,
    handlingMode: review.reply ? 'ai' : 'human',
    receivedAt: review.createdAt || null,
    updatedAt: review.createdAt || null,
    processedAt: review.createdAt || null,
    decision: status === 'needs_attention' ? 'escalate' : null,
    onlyUnprocessed: ['new', 'needs_attention'].includes(status),
    timeline: buildSyntheticTimeline({
      receivedAt: review.createdAt,
      status,
      responseText: review.reply
    }),
    serviceMeta: {
      rating: review.rating
    },
    relatedConversation: null,
    automation: null
  };
}

function buildYouTubeInteraction(entry) {
  const status = entry.responded === false || entry.error ? 'error' : 'ai_processed';

  return {
    id: `youtube:${entry.commentId || entry.id}`,
    service: 'youtube',
    serviceLabel: SERVICE_LABELS.youtube,
    rawStatus: entry.responded === false ? 'failed' : 'replied',
    status,
    statusLabel: STATUS_LABELS[status],
    title: entry.author ? `Комментарий ${entry.author}` : 'Комментарий YouTube',
    previewText: entry.comment || entry.text || '',
    responseText: entry.response || null,
    contactId: null,
    contactLabel: entry.author || 'Пользователь YouTube',
    conversationId: `youtube:${entry.videoId || entry.id}`,
    sourceUrl: null,
    handlingMode: 'ai',
    receivedAt: entry.timestamp || null,
    updatedAt: entry.timestamp || null,
    processedAt: entry.timestamp || null,
    decision: null,
    onlyUnprocessed: ['new', 'needs_attention'].includes(status),
    timeline: buildSyntheticTimeline({
      receivedAt: entry.timestamp,
      status,
      responseText: entry.response
    }),
    serviceMeta: {
      videoId: entry.videoId || null
    },
    relatedConversation: null,
    automation: null
  };
}

function buildThreadsInteraction(post) {
  const status = (() => {
    if (post.status === 'replied') return 'ai_processed';
    if (post.status === 'validated') return 'needs_attention';
    if (post.status === 'skipped') return 'closed';
    return 'new';
  })();

  return {
    id: `threads:${post.id || post.post_id}`,
    service: 'threads',
    serviceLabel: SERVICE_LABELS.threads,
    rawStatus: post.status,
    status,
    statusLabel: STATUS_LABELS[status],
    title: `@${post.username || 'неизвестно'}`,
    previewText: post.text || '',
    responseText: post.reply_text || null,
    contactId: null,
    contactLabel: post.username || 'Пользователь Threads',
    conversationId: `threads:${post.id || post.post_id}`,
    sourceUrl: post.permalink || null,
    handlingMode: post.reply_text ? 'ai' : 'human',
    receivedAt: post.created_at || post.post_timestamp || null,
    updatedAt: post.replied_at || post.processed_at || post.created_at || null,
    processedAt: post.processed_at || null,
    decision: null,
    onlyUnprocessed: ['new', 'needs_attention'].includes(status),
    timeline: buildSyntheticTimeline({
      receivedAt: post.created_at || post.post_timestamp,
      status,
      responseText: post.reply_text
    }),
    serviceMeta: {
      keyword: post.keyword_matched || null
    },
    relatedConversation: null,
    automation: null
  };
}

class InteractionReadModel {
  constructor(options = {}) {
    this.assistantRuntime = options.assistantRuntime;
    this.loadGoogleOperationalData = options.loadGoogleOperationalData || (async () => ({ reviews: [] }));
    this.loadYouTubeOperationalData = options.loadYouTubeOperationalData || (async () => ({ history: [] }));
    this.loadThreadsOperationalData = options.loadThreadsOperationalData || (async () => ({ posts: [] }));
    this.contactManager = options.contactManager;
    this.overrideStore = options.overrideStore;
    this.now = options.now || (() => new Date());
  }

  async loadBaseInteractions(limit = DEFAULT_LIMIT) {
    const [
      events,
      google,
      youtube,
      threads,
      contacts,
      overrides
    ] = await Promise.all([
      this.assistantRuntime?.eventStore?.listEvents(limit) || [],
      this.loadGoogleOperationalData({ includeReviews: true }),
      this.loadYouTubeOperationalData(),
      this.loadThreadsOperationalData({ includePosts: true }),
      this.contactManager?.getAllUsers?.() || [],
      this.overrideStore?.getAll?.() || {}
    ]);

    const contactsMap = new Map((contacts || []).map((contact) => [contact.user_id || contact.id, contact]));

    const items = [
      ...(events || []).map((event) => applyOverride(
        applySlaState(buildInstagramInteraction(event, contactsMap.get(event.actorId))),
        overrides[event.id]
      )),
      ...((google.reviews || []).map((review) => applyOverride(
        applySlaState(buildGoogleInteraction(review)),
        overrides[`google:${review.id}`]
      ))),
      ...((youtube.history || []).map((entry) => applyOverride(
        applySlaState(buildYouTubeInteraction(entry)),
        overrides[`youtube:${entry.commentId || entry.id}`]
      ))),
      ...((threads.posts || []).map((post) => applyOverride(
        applySlaState(buildThreadsInteraction(post)),
        overrides[`threads:${post.id || post.post_id}`]
      )))
    ];

    return items.sort(sortByRecent);
  }

  filterInteractions(items, filters = {}) {
    const service = filters.service || 'all';
    const status = filters.status || 'all';
    const onlyUnprocessed = String(filters.only_unprocessed || filters.onlyUnprocessed || '') === 'true';
    const sla = filters.sla || 'all';
    const contactId = filters.contact_id || filters.contactId || null;

    return items
      .filter((item) => service === 'all' || item.service === service)
      .filter((item) => status === 'all' || item.status === status)
      .filter((item) => !onlyUnprocessed || item.onlyUnprocessed)
      .filter((item) => sla === 'all' || (sla === 'breached' ? item.slaBreached : !item.slaBreached))
      .filter((item) => !contactId || item.contactId === contactId)
      .filter((item) => includesQuery(item, filters.query));
  }

  buildInstagramGroups(items) {
    const groups = new Map();

    items
      .filter((item) => item.service === 'instagram_dm')
      .forEach((item) => {
        const key = item.contactId || item.conversationId || item.id;
        const existing = groups.get(key);

        if (!existing) {
          groups.set(key, {
            id: key,
            contactId: item.contactId,
            contactLabel: item.contactLabel,
            service: 'instagram_dm',
            serviceLabel: SERVICE_LABELS.instagram_dm,
            status: item.status,
            statusLabel: item.statusLabel,
            previewText: item.previewText,
            lastMessageAt: item.updatedAt || item.receivedAt,
            totalInteractions: 1,
            pendingCount: item.onlyUnprocessed ? 1 : 0,
            automation: item.automation,
            latestInteractionId: item.id
          });
          return;
        }

        const existingTime = new Date(existing.lastMessageAt || 0).getTime() || 0;
        const nextTime = new Date(item.updatedAt || item.receivedAt || 0).getTime() || 0;
        const shouldReplace = nextTime >= existingTime;

        groups.set(key, {
          ...existing,
          status: shouldReplace ? item.status : existing.status,
          statusLabel: shouldReplace ? item.statusLabel : existing.statusLabel,
          previewText: shouldReplace ? item.previewText : existing.previewText,
          lastMessageAt: shouldReplace ? (item.updatedAt || item.receivedAt) : existing.lastMessageAt,
          totalInteractions: existing.totalInteractions + 1,
          pendingCount: existing.pendingCount + (item.onlyUnprocessed ? 1 : 0),
          automation: item.automation || existing.automation,
          latestInteractionId: shouldReplace ? item.id : existing.latestInteractionId
        });
      });

    return Array.from(groups.values()).sort((left, right) => sortByRecent(
      { updatedAt: left.lastMessageAt },
      { updatedAt: right.lastMessageAt }
    ));
  }

  async listInteractions(filters = {}) {
    const items = this.filterInteractions(await this.loadBaseInteractions(filters.limit || DEFAULT_LIMIT), filters);
    const view = filters.view || 'list';

    if (view === 'grouped') {
      return {
        data: this.buildInstagramGroups(items),
        meta: {
          view,
          total: items.length,
          grouped: true
        },
        filters
      };
    }

    return {
      data: items,
      meta: {
        view,
        total: items.length,
        grouped: false
      },
      filters
    };
  }

  async getInteraction(interactionId) {
    const items = await this.loadBaseInteractions(DEFAULT_LIMIT);
    const item = items.find((entry) => entry.id === interactionId) || null;

    if (!item) {
      return null;
    }

    let relatedConversation = null;
    if (item.contactId && this.contactManager?.getConversation) {
      relatedConversation = await this.contactManager.getConversation(item.contactId, 20);
    }

    return {
      ...item,
      relatedConversation
    };
  }
}

module.exports = {
  InteractionReadModel,
  SERVICE_LABELS,
  STATUS_LABELS,
  buildSlaDeadline
};
