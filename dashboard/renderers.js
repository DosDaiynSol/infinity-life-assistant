(function () {
  const { escapeHtml, formatDateTime, formatNumber, getStatusLabel, getToneLabel, toneFromStatus, toArray } = window.DashboardUtils;

  const pageLabels = {
    overview: 'Сводка',
    queues: 'Очереди',
    platforms: 'Площадки',
    reviews: 'Отзывы',
    integrations: 'Доступы',
    activity: 'Журнал'
  };

  const sectionLabels = {
    queue: 'Очередь',
    activity: 'Активность',
    history: 'История',
    validated: 'Кандидаты',
    escalations: 'Риск',
    positive: 'С ответом',
    recent: 'Недавнее'
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
            <span class="tone-pill tone-${escapeHtml(metric.tone || 'neutral')}">${escapeHtml(getToneLabel(metric.tone || 'neutral'))}</span>
          </article>
        `).join('')}
      </section>
    `;
  }

  function renderOverviewGuide(summary) {
    return `
      <section class="guide-grid">
        <article class="guide-card tone-critical">
          <span class="guide-card__label">Сначала проверить</span>
          <h3 class="guide-card__title">Что может остановить работу</h3>
          <p class="guide-card__text">${escapeHtml(`${formatNumber(summary.activeIncidents)} проблем влияют на ответы, репутацию или доставку. Начинайте с красных карточек.`)}</p>
        </article>
        <article class="guide-card tone-warning">
          <span class="guide-card__label">Потом разобрать</span>
          <h3 class="guide-card__title">Где копится ручная работа</h3>
          <p class="guide-card__text">${escapeHtml(`${formatNumber(summary.queuedWork)} задач ждут решения оператора, повторного запуска или ответа.`)}</p>
        </article>
        <article class="guide-card tone-healthy">
          <span class="guide-card__label">Держать в норме</span>
          <h3 class="guide-card__title">Что работает стабильно</h3>
          <p class="guide-card__text">${escapeHtml(`${formatNumber(summary.healthyIntegrations)} из ${formatNumber(summary.totalIntegrations)} интеграций сейчас в норме.`)}</p>
        </article>
      </section>
    `;
  }

  function renderIncidentCard(incident) {
    const action = incident.actionLabel
      ? renderActionButton({
          label: incident.actionLabel,
          platform: incident.actionPlatform,
          action: incident.actionName,
          service: incident.actionService,
          actionType: incident.actionType,
          url: incident.actionUrl
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

  function renderActionButton(action) {
    if (action.actionType === 'reauthorize' && action.service) {
      return `
        <button class="secondary-button" type="button" data-integration-reauth="${escapeHtml(action.service)}">
          ${escapeHtml(action.label)}
        </button>
      `;
    }

    if (action.actionType === 'platform_action' && action.platform && action.action) {
      return `
        <button class="secondary-button" type="button" data-action-platform="${escapeHtml(action.platform)}" data-action-name="${escapeHtml(action.action)}">
          ${escapeHtml(action.label)}
        </button>
      `;
    }

    if (action.kind === 'refresh') {
      return `
        <button class="secondary-button" type="button" data-refresh-current>
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

    if (action.kind === 'platform') {
      return `
        <button class="${escapeHtml(action.variant || 'secondary-button')}" type="button" data-action-platform="${escapeHtml(action.platform)}" data-action-name="${escapeHtml(action.action)}">
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

  function renderAttentionBoard(board) {
    return `
      <article class="panel">
        <div class="panel__header">
          <div>
            <p class="panel__overline">Фокус</p>
            <h3 class="panel__title">${escapeHtml(board.title)}</h3>
          </div>
        </div>
        <div class="list-stack">
          ${toArray(board.items).map((item) => `
            <div class="list-item">
              <div class="list-item__header">
                <h4 class="list-item__title">${escapeHtml(item.label)}</h4>
                <span class="tone-pill tone-${escapeHtml(item.tone || 'neutral')}">${escapeHtml(getToneLabel(item.tone || 'neutral'))}</span>
              </div>
              <div class="list-item__body">${escapeHtml(formatNumber(item.value))}</div>
            </div>
          `).join('')}
        </div>
      </article>
    `;
  }

  function renderOverviewPage(data) {
    return `
      <div class="page-stack">
        ${renderMetricCards(data.metrics)}
        ${renderOverviewGuide(data.summary)}
        <section class="panel-grid">
          <article class="panel">
            <div class="panel__header">
              <div>
                <p class="panel__overline">Сейчас важно</p>
                <h3 class="panel__title">Критические и проблемные зоны</h3>
                <p class="panel__subtitle">Сверху то, что может сорвать ответы, репутацию или доставку контента.</p>
              </div>
            </div>
            <div class="incident-stack">
              ${data.incidents.length > 0
                ? data.incidents.map(renderIncidentCard).join('')
                : renderEmptyState('Сейчас всё спокойно', 'На этой минуте критичных ситуаций не обнаружено.')}
            </div>
          </article>

          <article class="panel">
            <div class="panel__header">
              <div>
                <p class="panel__overline">Подключения</p>
                <h3 class="panel__title">Состояние интеграций</h3>
                <p class="panel__subtitle">Показывает, где всё в норме, а где нужны повторная авторизация или ручное внимание.</p>
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
          </article>
        </section>

        <section class="attention-grid">
          ${data.attention.map(renderAttentionBoard).join('')}
        </section>
      </div>
    `;
  }

  function renderQueueItem(item) {
    const link = item.link
      ? `<a class="inline-link mono" href="${escapeHtml(item.link)}" target="_blank" rel="noreferrer">Открыть источник</a>`
      : '';

    return `
      <article class="queue-card">
        <div class="queue-card__header">
          <h4 class="queue-card__title">${escapeHtml(item.title)}</h4>
          ${renderStatusBadge(item.status)}
        </div>
        <div class="queue-card__body">${escapeHtml(item.body)}</div>
        <div class="queue-card__foot">
          <span class="queue-card__meta">${escapeHtml(item.meta || 'Без дополнительного контекста')}</span>
          <span class="queue-card__meta mono">${escapeHtml(formatDateTime(item.createdAt))}</span>
        </div>
        ${link}
      </article>
    `;
  }

  function renderQueuesPage(data, state) {
    const allFilters = [{ id: 'all', label: `Все (${formatNumber(data.total)})` }]
      .concat(data.sections.map((section) => ({
        id: section.id,
        label: `${section.label} (${formatNumber(section.total)})`
      })));

    const sections = state.queueFilter === 'all'
      ? data.sections
      : data.sections.filter((section) => section.id === state.queueFilter);

    return `
      <div class="page-stack">
        <section class="panel">
          <div class="toolbar">
            <div>
              <p class="panel__overline">Рабочая зона</p>
              <h3 class="panel__title">Что ждёт действия</h3>
              <p class="panel__subtitle">Здесь собраны очереди, которые требуют ответа, проверки или повторного запуска.</p>
            </div>
            <div class="toolbar__group">
              ${allFilters.map((filter) => `
                <button class="filter-chip ${filter.id === state.queueFilter ? 'is-active' : ''}" type="button" data-queue-filter="${escapeHtml(filter.id)}">
                  ${escapeHtml(filter.label)}
                </button>
              `).join('')}
            </div>
          </div>
        </section>

        <section class="section-grid">
          ${sections.map((section) => `
            <article class="queue-section">
              <div class="queue-section__header">
                <div>
                  <p class="panel__overline">${escapeHtml(section.label)}</p>
                  <h3 class="queue-section__title">${escapeHtml(formatNumber(section.total))} задач</h3>
                  <p class="queue-section__description">${escapeHtml(section.description)}</p>
                </div>
                <span class="tone-pill tone-${escapeHtml(section.tone || 'neutral')}">${escapeHtml(getToneLabel(section.tone || 'neutral'))}</span>
              </div>
              <div class="queue-card-list">
                ${section.items.length > 0
                  ? section.items.map(renderQueueItem).join('')
                  : renderEmptyState('Очередь пустая', 'В этом блоке сейчас нет задач.')}
              </div>
            </article>
          `).join('')}
        </section>
      </div>
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

  function renderDetailSection(section) {
    return `
      <article class="panel">
        <div class="panel__header">
          <div>
            <p class="panel__overline">${escapeHtml(sectionLabels[section.id] || 'Раздел')}</p>
            <h3 class="panel__title">${escapeHtml(section.title)}</h3>
          </div>
        </div>
        <div class="list-stack">
          ${section.items.length > 0
            ? section.items.map((item) => `
              <div class="list-item">
                <div class="list-item__header">
                  <h4 class="list-item__title">${escapeHtml(item.title)}</h4>
                  <span class="list-item__meta mono">${escapeHtml(formatDateTime(item.createdAt))}</span>
                </div>
                <div class="list-item__body">${escapeHtml(item.body)}</div>
                <div class="list-item__meta">${escapeHtml(item.meta || 'Без дополнительного контекста')}</div>
              </div>
            `).join('')
            : renderEmptyState('Пока пусто', 'В этом разделе сейчас нечего показывать.')}
        </div>
      </article>
    `;
  }

  function renderPlatformsPage(data, state) {
    const detail = data.detail;

    return `
      <div class="page-stack">
        <section class="platform-grid">
          ${data.items.map((platform) => `
            <article class="platform-card ${platform.id === state.selectedPlatform ? 'is-active' : ''}" data-platform-select="${escapeHtml(platform.id)}">
              <div class="platform-card__header">
                <h3 class="platform-card__title">${escapeHtml(platform.name)}</h3>
                ${renderStatusBadge(platform.status)}
              </div>
              <p class="platform-card__summary">${escapeHtml(platform.summary)}</p>
              ${renderStatChips(platform.metrics)}
            </article>
          `).join('')}
        </section>

        <section class="platform-detail">
          <div class="platform-detail__header">
            <div>
              <p class="panel__overline">Детали площадки</p>
              <h3 class="platform-detail__title">${escapeHtml(detail.name)}</h3>
              <p class="panel__subtitle">${escapeHtml(detail.summary)}</p>
            </div>
            ${renderStatusBadge(detail.status)}
          </div>
          ${renderStatChips(detail.metrics)}
          <div class="platform-detail__sections">
            ${detail.sections.map(renderDetailSection).join('')}
          </div>
        </section>
      </div>
    `;
  }

  function renderReviewsPage(detail) {
    return `
      <div class="page-stack">
        <section class="review-band">
          <div class="review-band__header">
            <div>
              <p class="panel__overline">Репутация</p>
              <h3 class="review-band__title">${escapeHtml(detail.name)}</h3>
              <p class="panel__subtitle">${escapeHtml(detail.summary)}</p>
            </div>
            <div class="review-band__actions">
              <button class="action-button" type="button" data-action-platform="google" data-action-name="preview">Показать черновики ответов</button>
              <button class="secondary-button" type="button" data-action-platform="google" data-action-name="send-test">Отправить один тестовый ответ</button>
            </div>
          </div>
          ${renderStatChips(detail.metrics)}
        </section>

        <section class="section-grid">
          ${detail.sections.map((section) => `
            <article class="review-band">
              <div class="review-band__header">
                <div>
                  <p class="panel__overline">${escapeHtml(sectionLabels[section.id] || 'Раздел')}</p>
                  <h3 class="review-band__title">${escapeHtml(section.title)}</h3>
                </div>
              </div>
              <div class="review-card-list">
                ${section.items.length > 0
                  ? section.items.map((item) => `
                    <div class="review-card">
                      <div class="review-card__title">${escapeHtml(item.title)}</div>
                      <div class="review-card__body">${escapeHtml(item.body)}</div>
                      <div class="review-card__reply">${escapeHtml(item.meta || 'Без дополнительного контекста')}</div>
                    </div>
                  `).join('')
                  : renderEmptyState('Здесь пусто', 'В этой группе отзывов сейчас ничего нет.')}
              </div>
            </article>
          `).join('')}
        </section>
      </div>
    `;
  }

  function renderIntegrationCard(service) {
    const actions = [];
    if (service.actions.includes('reauthorize')) {
      actions.push({
        kind: 'service',
        service: service.id,
        label: 'Открыть авторизацию',
        variant: 'secondary-button'
      });
    }

    if (service.id === 'youtube' && service.actions.includes('process-channel')) {
      actions.push({
        kind: 'platform',
        platform: 'youtube',
        action: 'process-channel',
        label: 'Проверить YouTube',
        variant: 'secondary-button'
      });
    }

    if (service.id === 'instagram_messaging' && service.actions.includes('process')) {
      actions.push({
        kind: 'platform',
        platform: 'instagram',
        action: 'process',
        label: 'Разобрать Instagram',
        variant: 'secondary-button'
      });
    }

    if (service.id === 'google_business' && service.actions.includes('preview')) {
      actions.push({
        kind: 'platform',
        platform: 'google',
        action: 'preview',
        label: 'Открыть черновики',
        variant: 'secondary-button'
      });
    }

    if (service.id === 'threads' && service.actions.includes('search')) {
      actions.push({
        kind: 'platform',
        platform: 'threads',
        action: 'search',
        label: 'Проверить Threads',
        variant: 'secondary-button'
      });
    }

    if (service.id === 'crosspost' && service.actions.includes('retry')) {
      actions.push({
        kind: 'platform',
        platform: 'crosspost',
        action: 'retry',
        label: 'Повторить доставку',
        variant: 'secondary-button'
      });
    }

    return `
      <article class="integration-card">
        <div class="integration-card__header">
          <h3 class="integration-card__title">${escapeHtml(service.name)}</h3>
          ${renderStatusBadge(service.status)}
        </div>
        <p class="integration-card__summary">${escapeHtml(service.summary)}</p>
        <div class="integration-card__meta mono">${escapeHtml(service.provider)} | ${escapeHtml(formatDateTime(service.lastCheckedAt))}</div>
        ${service.lastError ? `<div class="queue-card__meta">${escapeHtml(service.lastError)}</div>` : ''}
        <div class="integration-card__actions">
          ${actions.map(renderActionButton).join('')}
        </div>
      </article>
    `;
  }

  function renderIntegrationsPage(data) {
    return `
      <div class="page-stack">
        <section class="panel">
          <div class="panel__header">
            <div>
              <p class="panel__overline">Авторизация и доступы</p>
              <h3 class="panel__title">Что подключено и что сломалось</h3>
              <p class="panel__subtitle">Экран для проверки токенов, ошибок авторизации и быстрых действий по восстановлению.</p>
            </div>
          </div>
        </section>
        <section class="integration-grid">
          ${data.services.map(renderIntegrationCard).join('')}
        </section>
      </div>
    `;
  }

  function renderActivityPage(data) {
    return `
      <div class="page-stack">
        <section class="panel">
          <div class="panel__header">
            <div>
              <p class="panel__overline">Хронология</p>
              <h3 class="panel__title">Последние события</h3>
              <p class="panel__subtitle">Здесь видно, что система ответила, что повторила и где изменилось состояние очередей.</p>
            </div>
          </div>
        </section>
        <section class="timeline-card">
          <div class="activity-list">
            ${data.items.length > 0
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
              : renderEmptyState('Событий пока нет', 'Журнал начнёт наполняться по мере работы сервисов.')}
          </div>
        </section>
      </div>
    `;
  }

  function renderEmptyState(title, text) {
    return `
      <div class="empty-state">
        <h3 class="panel__title">${escapeHtml(title)}</h3>
        <p class="empty-state__text">${escapeHtml(text)}</p>
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
        summary: `${formatNumber(summary.activeIncidents)} проблем требуют внимания, ${formatNumber(summary.queuedWork)} задач ждут обработки, ${formatNumber(summary.healthyIntegrations)} из ${formatNumber(summary.totalIntegrations)} интеграций в норме.${loadingPage === activePage ? ' Обновляю данные...' : ''}`,
        actions: [
          { kind: 'refresh', label: 'Обновить сводку' },
          { kind: 'platform', platform: 'instagram', action: 'process', label: 'Разобрать Instagram', variant: 'action-button' },
          { kind: 'platform', platform: 'threads', action: 'search', label: 'Проверить Threads', variant: 'secondary-button' }
        ]
      };
    }

    if (activePage === 'queues' && pages.queues) {
      return {
        title: 'Очереди',
        summary: `Сейчас ${formatNumber(pages.queues.total)} задач требуют внимания оператора.${loadingPage === activePage ? ' Обновляю данные...' : ''}`,
        actions: [
          { kind: 'refresh', label: 'Обновить очереди' },
          { kind: 'platform', platform: 'instagram', action: 'process', label: 'Разобрать Instagram', variant: 'action-button' },
          { kind: 'platform', platform: 'crosspost', action: 'retry', label: 'Повторить ошибки кросспоста', variant: 'secondary-button' }
        ]
      };
    }

    if (activePage === 'platforms' && pages.platforms?.detail) {
      return {
        title: 'Площадки',
        summary: `${pages.platforms.detail.name}: ${pages.platforms.detail.summary}${loadingPage === activePage ? ' Обновляю данные...' : ''}`,
        actions: [
          { kind: 'refresh', label: 'Обновить площадки' },
          { kind: 'platform', platform: state.selectedPlatform, action: state.selectedPlatform === 'youtube' ? 'process-channel' : (state.selectedPlatform === 'threads' ? 'search' : (state.selectedPlatform === 'google' ? 'preview' : (state.selectedPlatform === 'crosspost' ? 'retry' : 'process'))), label: state.selectedPlatform === 'youtube' ? 'Проверить YouTube' : (state.selectedPlatform === 'threads' ? 'Проверить Threads' : (state.selectedPlatform === 'google' ? 'Открыть черновики' : (state.selectedPlatform === 'crosspost' ? 'Повторить доставку' : 'Разобрать Instagram'))), variant: 'action-button' }
        ]
      };
    }

    if (activePage === 'reviews' && pages.reviews) {
      return {
        title: 'Отзывы',
        summary: `${pages.reviews.metrics.map((metric) => `${metric.label}: ${formatNumber(metric.value)}`).join(' | ')}${loadingPage === activePage ? ' Обновляю данные...' : ''}`,
        actions: [
          { kind: 'refresh', label: 'Обновить отзывы' },
          { kind: 'platform', platform: 'google', action: 'preview', label: 'Показать черновики ответов', variant: 'action-button' },
          { kind: 'platform', platform: 'google', action: 'send-test', label: 'Отправить тестовый ответ', variant: 'secondary-button' }
        ]
      };
    }

    if (activePage === 'integrations' && pages.integrations) {
      const needsAttention = pages.integrations.services.filter((service) => service.status !== 'healthy').length;
      return {
        title: 'Доступы',
        summary: `${formatNumber(needsAttention)} подключений требуют внимания из ${formatNumber(pages.integrations.services.length)}.${loadingPage === activePage ? ' Обновляю данные...' : ''}`,
        actions: [
          { kind: 'refresh', label: 'Обновить доступы' },
          { kind: 'service', service: 'google_business', label: 'Открыть авторизацию Google', variant: 'secondary-button' },
          { kind: 'service', service: 'youtube', label: 'Открыть авторизацию YouTube', variant: 'secondary-button' }
        ]
      };
    }

    if (activePage === 'activity' && pages.activity) {
      return {
        title: 'Журнал',
        summary: `В журнале видно ${formatNumber(pages.activity.items.length)} последних событий.${loadingPage === activePage ? ' Обновляю данные...' : ''}`,
        actions: [
          { kind: 'refresh', label: 'Обновить журнал' },
          { kind: 'platform', platform: 'crosspost', action: 'poll', label: 'Запустить цикл кросспоста', variant: 'secondary-button' }
        ]
      };
    }

    return {
      title: 'Пульт ассистента',
      summary: 'Собираю данные из сервисов ассистента.',
      actions: [{ kind: 'refresh', label: 'Обновить экран' }]
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

    if (activePage === 'queues') {
      return renderQueuesPage(pageData, state);
    }

    if (activePage === 'platforms') {
      return renderPlatformsPage(pageData, state);
    }

    if (activePage === 'reviews') {
      return renderReviewsPage(pageData);
    }

    if (activePage === 'integrations') {
      return renderIntegrationsPage(pageData);
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
