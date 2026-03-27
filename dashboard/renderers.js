(function () {
  const {
    capitalize,
    escapeHtml,
    formatDateTime,
    formatNumber,
    getStatusLabel,
    toneFromStatus,
    toArray
  } = window.DashboardUtils;

  const pageLabels = {
    overview: 'Сводка',
    'live-feed': 'Live Feed',
    incidents: 'Incidents',
    integrations: 'Integrations',
    channels: 'Channels',
    activity: 'Журнал'
  };

  function renderStatusBadge(status, label) {
    const tone = toneFromStatus(status);
    return `<span class="status-badge status-${escapeHtml(status)} tone-${escapeHtml(tone)}">${escapeHtml(label || getStatusLabel(status))}</span>`;
  }

  function renderMetricCards(metrics) {
    return `
      <section class="metric-grid">
        ${toArray(metrics).map((metric) => `
          <article class="metric-card tone-${escapeHtml(metric.tone || 'neutral')}">
            <span class="metric-card__label">${escapeHtml(metric.label)}</span>
            <strong class="metric-card__value">${escapeHtml(formatNumber(metric.value))}</strong>
            <p class="metric-card__detail">${escapeHtml(metric.detail || '')}</p>
          </article>
        `).join('')}
      </section>
    `;
  }

  function renderActionButton(action) {
    if (action.kind === 'refresh') {
      return `
        <button class="${escapeHtml(action.variant || 'secondary-button')}" type="button" data-refresh-current>
          ${escapeHtml(action.label)}
        </button>
      `;
    }

    if (action.kind === 'service') {
      return `
        <button class="${escapeHtml(action.variant || 'secondary-button')}" type="button" data-integration-reauth="${escapeHtml(action.service)}">
          ${escapeHtml(action.label)}
        </button>
      `;
    }

    if (action.url) {
      return `
        <a class="link-button" href="${escapeHtml(action.url)}" target="_blank" rel="noreferrer">
          ${escapeHtml(action.label)}
        </a>
      `;
    }

    return '';
  }

  function renderEmptyState(title, text) {
    return `
      <div class="empty-state">
        <h3 class="panel__title">${escapeHtml(title)}</h3>
        <p class="empty-state__text">${escapeHtml(text)}</p>
      </div>
    `;
  }

  function renderTimelineEntry(item) {
    const decision = item.decision
      ? `<span class="tone-pill tone-${escapeHtml(toneFromStatus(item.decision))}">${escapeHtml(getStatusLabel(item.decision))}</span>`
      : '';

    const responseBlock = item.responseText
      ? `<div class="timeline-entry__body">Ответ: ${escapeHtml(item.responseText)}</div>`
      : '';

    return `
      <article class="timeline-entry">
        <div class="timeline-entry__header">
          <h4 class="timeline-entry__title">${escapeHtml(item.title)}</h4>
          ${renderStatusBadge(item.status)}
        </div>
        <div class="timeline-entry__body">${escapeHtml(item.text || item.detail || item.stageDetail || '')}</div>
        ${responseBlock}
        <div class="timeline-entry__foot">
          <span class="timeline-card__meta">${escapeHtml(item.source || item.stage || '')}</span>
          ${decision}
          <span class="timeline-card__meta mono">${escapeHtml(formatDateTime(item.updatedAt || item.timestamp))}</span>
        </div>
      </article>
    `;
  }

  function renderIncidentCard(incident) {
    const action = incident.actionLabel
      ? renderActionButton({
          kind: incident.actionType === 'reauthorize' ? 'service' : null,
          service: incident.actionService,
          label: incident.actionLabel,
          url: incident.actionUrl,
          variant: 'secondary-button'
        })
      : '';

    return `
      <article class="incident-card">
        <div class="incident-card__header">
          <h4 class="incident-card__title">${escapeHtml(incident.title)}</h4>
          ${renderStatusBadge(incident.severity)}
        </div>
        <div class="incident-card__text">${escapeHtml(incident.detail)}</div>
        <div class="queue-card__meta mono">${escapeHtml(incident.source)}</div>
        ${action ? `<div class="incident-card__actions">${action}</div>` : ''}
      </article>
    `;
  }

  function renderIntegrationCard(service) {
    const actions = toArray(service.actions).includes('reauthorize')
      ? [renderActionButton({
          kind: 'service',
          service: service.id,
          label: 'Reauthorize',
          variant: 'secondary-button'
        })]
      : [];

    return `
      <article class="integration-card">
        <div class="integration-card__header">
          <h3 class="integration-card__title">${escapeHtml(service.name)}</h3>
          ${renderStatusBadge(service.status)}
        </div>
        <p class="integration-card__summary">${escapeHtml(service.summary)}</p>
        <div class="integration-card__meta mono">${escapeHtml(service.provider || '')} | ${escapeHtml(formatDateTime(service.lastCheckedAt))}</div>
        ${service.lastError ? `<div class="queue-card__meta">${escapeHtml(service.lastError)}</div>` : ''}
        <div class="integration-card__actions">${actions.join('')}</div>
      </article>
    `;
  }

  function renderStatChips(metrics) {
    return `
      <div class="stats-row">
        ${toArray(metrics).map((metric) => `
          <div class="stat-chip">
            <span class="stat-chip__label">${escapeHtml(metric.label)}</span>
            <strong class="stat-chip__value">${escapeHtml(formatNumber(metric.value))}</strong>
          </div>
        `).join('')}
      </div>
    `;
  }

  function renderRecentList(items) {
    if (!items.length) {
      return renderEmptyState('Пока пусто', 'Список начнёт заполняться по мере работы канала.');
    }

    return `
      <div class="list-stack">
        ${items.map((item) => `
          <div class="list-item">
            <div class="list-item__header">
              <h4 class="list-item__title">${escapeHtml(item.title)}</h4>
              ${renderStatusBadge(item.status)}
            </div>
            <div class="list-item__body">${escapeHtml(item.detail || '')}</div>
            <div class="list-item__meta mono">${escapeHtml(formatDateTime(item.timestamp))}</div>
          </div>
        `).join('')}
      </div>
    `;
  }

  function renderOverviewPage(data) {
    return `
      <div class="page-stack">
        ${renderMetricCards(data.metrics)}
        <section class="panel-grid">
          <article class="panel">
            <div class="panel__header">
              <div>
                <p class="panel__overline">Инциденты</p>
                <h3 class="panel__title">Что требует внимания</h3>
                <p class="panel__subtitle">Здесь только реальные исключения: риски, auth-сбои и delivery failures.</p>
              </div>
            </div>
            <div class="incident-stack">
              ${data.incidents.length
                ? data.incidents.map(renderIncidentCard).join('')
                : renderEmptyState('Сейчас спокойно', 'Открытых инцидентов нет.')}
            </div>
          </article>

          <article class="panel">
            <div class="panel__header">
              <div>
                <p class="panel__overline">Live Feed</p>
                <h3 class="panel__title">Последние входящие и ответы</h3>
                <p class="panel__subtitle">Мгновенный поток Instagram-событий и решений policy engine.</p>
              </div>
            </div>
            <section class="timeline-card">
              <div class="activity-list">
                ${data.liveFeed.length
                  ? data.liveFeed.map(renderTimelineEntry).join('')
                  : renderEmptyState('Live feed пуст', 'Новые события появятся сразу после webhook.')}
              </div>
            </section>
          </article>
        </section>

        <section class="panel">
          <div class="panel__header">
            <div>
              <p class="panel__overline">Integrations</p>
              <h3 class="panel__title">Состояние сервисов</h3>
              <p class="panel__subtitle">Быстрый срез по auth и health, без ручных queue-действий.</p>
            </div>
          </div>
          <div class="list-stack">
            ${data.integrations.map((service) => `
              <div class="list-item">
                <div class="list-item__header">
                  <h4 class="list-item__title">${escapeHtml(service.name)}</h4>
                  ${renderStatusBadge(service.status)}
                </div>
                <div class="list-item__body">${escapeHtml(service.summary)}</div>
                <div class="list-item__meta">${escapeHtml(service.provider)}</div>
              </div>
            `).join('')}
          </div>
        </section>
      </div>
    `;
  }

  function renderLiveFeedPage(data) {
    return `
      <div class="page-stack">
        <section class="timeline-card">
          <div class="activity-list">
            ${data.items.length
              ? data.items.map(renderTimelineEntry).join('')
              : renderEmptyState('Событий пока нет', 'Feed начнёт заполняться сразу после новых webhook-событий.')}
          </div>
        </section>
      </div>
    `;
  }

  function renderIncidentsPage(data) {
    const metrics = [
      { label: 'Всего', value: data.summary.total, detail: 'Открытые инциденты', tone: data.summary.total > 0 ? 'warning' : 'healthy' },
      { label: 'Критичные', value: data.summary.critical, detail: 'Нужны первыми', tone: data.summary.critical > 0 ? 'critical' : 'healthy' },
      { label: 'Warning', value: data.summary.warning, detail: 'Нужно разобраться', tone: data.summary.warning > 0 ? 'warning' : 'healthy' }
    ];

    return `
      <div class="page-stack">
        ${renderMetricCards(metrics)}
        <section class="panel">
          <div class="panel__header">
            <div>
              <p class="panel__overline">Incident Board</p>
              <h3 class="panel__title">Открытые инциденты</h3>
              <p class="panel__subtitle">Детали по рисковым кейсам, деградации интеграций и доставке.</p>
            </div>
          </div>
          <div class="incident-stack">
            ${data.items.length
              ? data.items.map(renderIncidentCard).join('')
              : renderEmptyState('Инцидентов нет', 'Система сейчас работает без открытых проблем.')}
          </div>
        </section>
      </div>
    `;
  }

  function renderIntegrationsPage(data) {
    return `
      <div class="page-stack">
        <section class="integration-grid">
          ${data.services.length
            ? data.services.map(renderIntegrationCard).join('')
            : renderEmptyState('Интеграции не найдены', 'Для этого экрана не удалось получить данные сервисов.')}
        </section>
      </div>
    `;
  }

  function renderChannelsPage(data) {
    return `
      <div class="page-stack">
        <section class="section-grid">
          ${data.items.map((channel) => `
            <article class="panel">
              <div class="panel__header">
                <div>
                  <p class="panel__overline">Канал</p>
                  <h3 class="panel__title">${escapeHtml(channel.name)}</h3>
                  <p class="panel__subtitle">${escapeHtml(channel.summary)}</p>
                </div>
                ${renderStatusBadge(channel.status)}
              </div>
              ${renderStatChips(channel.metrics)}
              ${renderRecentList(channel.recent || [])}
            </article>
          `).join('')}
        </section>
      </div>
    `;
  }

  function renderActivityPage(data) {
    return `
      <div class="page-stack">
        <section class="timeline-card">
          <div class="activity-list">
            ${data.items.length
              ? data.items.map((item) => `
                <article class="timeline-entry">
                  <div class="timeline-entry__header">
                    <h4 class="timeline-entry__title">${escapeHtml(item.title)}</h4>
                    ${renderStatusBadge(item.status)}
                  </div>
                  <div class="timeline-entry__body">${escapeHtml(item.detail)}</div>
                  <div class="timeline-entry__foot">
                    <span class="timeline-card__meta">${escapeHtml(item.source)}</span>
                    <span class="timeline-card__meta mono">${escapeHtml(formatDateTime(item.timestamp))}</span>
                  </div>
                </article>
              `).join('')
              : renderEmptyState('Журнал пуст', 'Сервисные события появятся здесь автоматически.')}
          </div>
        </section>
      </div>
    `;
  }

  function renderLoadingState(page) {
    return renderEmptyState('Загрузка', `Получаю данные для раздела «${pageLabels[page] || page}».`);
  }

  function renderErrorState(message) {
    return renderEmptyState('Не удалось загрузить экран', message);
  }

  function getHeroConfig(state) {
    const { activePage, pages, loadingPage } = state;

    if (activePage === 'overview' && pages.overview) {
      const summary = pages.overview.summary;
      return {
        title: 'Сводка',
        summary: `${formatNumber(summary.openIncidents)} инцидентов, ${formatNumber(summary.liveEvents)} Instagram-событий за окно и p95 ответа ${summary.p95ReplySeconds === null ? 'n/a' : `${summary.p95ReplySeconds.toFixed(1)}s`}.${loadingPage === activePage ? ' Обновляю данные...' : ''}`,
        actions: [{ kind: 'refresh', label: 'Обновить сводку', variant: 'action-button' }]
      };
    }

    if (activePage === 'live-feed' && pages['live-feed']) {
      return {
        title: 'Live Feed',
        summary: `В потоке ${formatNumber(pages['live-feed'].items.length)} последних Instagram-событий.${loadingPage === activePage ? ' Обновляю данные...' : ''}`,
        actions: [{ kind: 'refresh', label: 'Обновить feed', variant: 'action-button' }]
      };
    }

    if (activePage === 'incidents' && pages.incidents) {
      return {
        title: 'Incidents',
        summary: `${formatNumber(pages.incidents.summary.critical)} критичных и ${formatNumber(pages.incidents.summary.warning)} warning-инцидентов.${loadingPage === activePage ? ' Обновляю данные...' : ''}`,
        actions: [{ kind: 'refresh', label: 'Обновить incidents', variant: 'action-button' }]
      };
    }

    if (activePage === 'integrations' && pages.integrations) {
      const needsAttention = pages.integrations.services.filter((service) => service.status !== 'healthy').length;
      return {
        title: 'Integrations',
        summary: `${formatNumber(needsAttention)} сервисов требуют внимания из ${formatNumber(pages.integrations.services.length)}.${loadingPage === activePage ? ' Обновляю данные...' : ''}`,
        actions: [{ kind: 'refresh', label: 'Обновить integrations', variant: 'action-button' }]
      };
    }

    if (activePage === 'channels' && pages.channels) {
      return {
        title: 'Channels',
        summary: `Собраны данные по ${formatNumber(pages.channels.items.length)} рабочим каналам.${loadingPage === activePage ? ' Обновляю данные...' : ''}`,
        actions: [{ kind: 'refresh', label: 'Обновить channels', variant: 'action-button' }]
      };
    }

    if (activePage === 'activity' && pages.activity) {
      return {
        title: 'Журнал',
        summary: `В журнале ${formatNumber(pages.activity.items.length)} последних событий.${loadingPage === activePage ? ' Обновляю данные...' : ''}`,
        actions: [{ kind: 'refresh', label: 'Обновить журнал', variant: 'action-button' }]
      };
    }

    return {
      title: 'Пульт ассистента',
      summary: 'Собираю данные из сервисов ассистента.',
      actions: [{ kind: 'refresh', label: 'Обновить экран', variant: 'action-button' }]
    };
  }

  function renderActivePage(state) {
    const { activePage, pages, errors } = state;
    const pageData = pages[activePage];
    const pageError = errors[activePage];

    if (pageError && !pageData) {
      return renderErrorState(pageError);
    }

    if (!pageData) {
      return renderLoadingState(activePage);
    }

    if (activePage === 'overview') {
      return renderOverviewPage(pageData);
    }

    if (activePage === 'live-feed') {
      return renderLiveFeedPage(pageData);
    }

    if (activePage === 'incidents') {
      return renderIncidentsPage(pageData);
    }

    if (activePage === 'integrations') {
      return renderIntegrationsPage(pageData);
    }

    if (activePage === 'channels') {
      return renderChannelsPage(pageData);
    }

    if (activePage === 'activity') {
      return renderActivityPage(pageData);
    }

    return renderErrorState('Неизвестный раздел');
  }

  function renderToast(toast) {
    const toastNode = document.querySelector('[data-toast]');
    if (!toastNode) {
      return;
    }

    if (!toast || !toast.message) {
      toastNode.hidden = true;
      toastNode.textContent = '';
      toastNode.className = 'toast';
      return;
    }

    toastNode.hidden = false;
    toastNode.className = `toast tone-${escapeHtml(toast.tone || 'neutral')}`;
    toastNode.textContent = toast.message;
  }

  function render(state) {
    const navButtons = document.querySelectorAll('[data-nav]');
    navButtons.forEach((button) => {
      button.classList.toggle('is-active', button.dataset.nav === state.activePage);
    });

    const hero = getHeroConfig(state);
    const heroTitle = document.querySelector('[data-hero-title]');
    const heroSummary = document.querySelector('[data-hero-summary]');
    const lastSync = document.querySelector('[data-last-sync]');
    const quickActions = document.querySelector('[data-quick-actions]');
    const pageRoot = document.querySelector('[data-page-root]');

    if (heroTitle) {
      heroTitle.textContent = hero.title;
    }

    if (heroSummary) {
      heroSummary.textContent = hero.summary;
    }

    if (lastSync) {
      lastSync.textContent = state.lastSync ? formatDateTime(state.lastSync) : 'Ожидание...';
    }

    if (quickActions) {
      quickActions.innerHTML = hero.actions.map(renderActionButton).join('');
    }

    if (pageRoot) {
      pageRoot.innerHTML = renderActivePage(state);
    }

    renderToast(state.toast);
  }

  window.DashboardRenderers = {
    render
  };
})();
