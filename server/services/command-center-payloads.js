function toCount(value) {
  return Number.isFinite(value) ? value : 0;
}

function buildOverviewPayload({ interactions, services }) {
  const urgentItems = interactions
    .filter((item) => ['new', 'needs_attention', 'error'].includes(item.status) || item.onlyUnprocessed)
    .slice(0, 12);
  const degradedServices = services.filter((service) => service.status !== 'healthy');
  const processedAi = interactions.filter((item) => item.status === 'ai_processed').length;
  const errors = interactions.filter((item) => item.status === 'error').length;
  const needsAttention = interactions.filter((item) => item.status === 'needs_attention').length;
  const breached = interactions.filter((item) => item.slaBreached).length;

  return {
    generatedAt: new Date().toISOString(),
    summary: {
      cards: [
        {
          id: 'services',
          label: 'Подключенные каналы',
          value: `${services.filter((service) => service.status === 'healthy').length}/${services.length}`,
          detail: `${degradedServices.length} требуют внимания`,
          tone: degradedServices.length ? 'warning' : 'healthy'
        },
        {
          id: 'urgent',
          label: 'Новые обращения',
          value: interactions.filter((item) => item.status === 'new').length,
          detail: `${needsAttention} требуют внимания`,
          tone: needsAttention ? 'warning' : 'neutral'
        },
        {
          id: 'processed',
          label: 'Обработано ИИ',
          value: processedAi,
          detail: `${errors} с ошибкой`,
          tone: errors ? 'warning' : 'healthy'
        },
        {
          id: 'sla',
          label: 'SLA 30 минут',
          value: breached,
          detail: breached ? 'Есть просроченные обращения' : 'Все обращения в срок',
          tone: breached ? 'critical' : 'healthy'
        }
      ]
    },
    degradedBanner: degradedServices.length
      ? {
        tone: 'warning',
        title: 'Часть сервисов недоступна',
        detail: degradedServices.map((service) => service.name).join(', ')
      }
      : null,
    urgent: {
      items: urgentItems
    },
    services: {
      items: services.slice(0, 4)
    }
  };
}

function buildServicesPayload({ services }) {
  return {
    generatedAt: new Date().toISOString(),
    summary: {
      total: services.length,
      healthy: services.filter((service) => service.status === 'healthy').length,
      degraded: services.filter((service) => service.status === 'degraded').length,
      reauthRequired: services.filter((service) => service.status === 'reauth_required').length
    },
    services
  };
}

function buildProfilePayload({ user, telegramConfigured }) {
  return {
    generatedAt: new Date().toISOString(),
    user,
    clinic: {
      name: 'INFINITY LIFE',
      emailBound: Boolean(user?.email)
    },
    notifications: {
      telegramConfigured: Boolean(telegramConfigured),
      summary: telegramConfigured
        ? 'Критичные уведомления уходят в Telegram.'
        : 'Telegram не настроен.'
    }
  };
}

function buildServiceCards(rawServices = []) {
  return rawServices.map((service) => ({
    ...service,
    metrics: [
      {
        label: 'Необработанные',
        value: toCount(service.unprocessedCount)
      },
      {
        label: 'Ошибки',
        value: toCount(service.errorCount)
      },
      {
        label: 'За 24 часа',
        value: toCount(service.processed24h)
      }
    ]
  }));
}

module.exports = {
  buildOverviewPayload,
  buildProfilePayload,
  buildServiceCards,
  buildServicesPayload
};
