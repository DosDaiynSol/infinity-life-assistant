import {
  escapeHtml,
  formatDateTime,
  formatNumber,
  getStatusLabel,
  toneFromStatus,
  truncate
} from '../format.mjs';

function renderChipButton({ label, attrs = '', pending = false, ghost = false }) {
  return `
    <button class="chip-button ${ghost ? 'chip-button--ghost' : ''}" type="button" ${attrs} ${pending ? 'disabled' : ''}>
      ${escapeHtml(label)}
    </button>
  `;
}

export function renderStatusBadge(status, label) {
  const tone = toneFromStatus(status);

  return `
    <span class="status-badge tone-${escapeHtml(tone)}">
      ${escapeHtml(label || getStatusLabel(status))}
    </span>
  `;
}

export function renderMetricCards(cards) {
  return `
    <div class="metric-grid">
      ${cards.map((card) => `
        <article class="metric-card tone-${escapeHtml(card.tone || 'neutral')}">
          <span class="eyebrow eyebrow--card">${escapeHtml(card.label)}</span>
          <strong class="metric-card__value">${escapeHtml(formatNumber(card.value))}</strong>
          <p class="metric-card__detail">${escapeHtml(card.detail || '')}</p>
        </article>
      `).join('')}
    </div>
  `;
}

export function renderEmptyState(title, text) {
  return `
    <div class="empty-state">
      <h3 class="panel__title">${escapeHtml(title)}</h3>
      <p class="panel__subtitle">${escapeHtml(text)}</p>
    </div>
  `;
}

export function renderFilterSelect({ page, key, value, label, options }) {
  return `
    <label class="filter-control">
      <span class="filter-control__label">${escapeHtml(label)}</span>
      <select class="filter-control__input" data-filter-page="${escapeHtml(page)}" data-filter-key="${escapeHtml(key)}">
        ${options.map((option) => {
          const normalized = typeof option === 'string'
            ? { value: option, label: option }
            : option;

          return `
            <option value="${escapeHtml(normalized.value)}" ${normalized.value === value ? 'selected' : ''}>
              ${escapeHtml(normalized.label)}
            </option>
          `;
        }).join('')}
      </select>
    </label>
  `;
}

export function renderFilterInput({ page, key, value, label, placeholder }) {
  return `
    <label class="filter-control filter-control--wide">
      <span class="filter-control__label">${escapeHtml(label)}</span>
      <input
        class="filter-control__input"
        type="search"
        value="${escapeHtml(value || '')}"
        placeholder="${escapeHtml(placeholder || '')}"
        data-filter-page="${escapeHtml(page)}"
        data-filter-key="${escapeHtml(key)}">
    </label>
  `;
}

export function renderPanelHeader({ eyebrow, title, subtitle, meta }) {
  return `
    <header class="panel__header">
      <div>
        ${eyebrow ? `<p class="eyebrow">${escapeHtml(eyebrow)}</p>` : ''}
        <h3 class="panel__title">${escapeHtml(title)}</h3>
        ${subtitle ? `<p class="panel__subtitle">${escapeHtml(subtitle)}</p>` : ''}
      </div>
      ${meta || ''}
    </header>
  `;
}

export function renderBanner(banner) {
  if (!banner) {
    return '';
  }

  return `
    <section class="surface-panel tone-${escapeHtml(banner.tone || 'warning')}">
      <p class="eyebrow">Состояние системы</p>
      <h3 class="panel__title">${escapeHtml(banner.title)}</h3>
      <p class="panel__subtitle">${escapeHtml(banner.detail || '')}</p>
    </section>
  `;
}

export function renderInteractionCard(item, context = {}) {
  const markPending = context.pendingAction === `attention:${item.id}`;
  const processPending = context.pendingAction === `reprocess:${item.id}`;

  return `
    <article class="timeline-card" data-open-drawer-page="${escapeHtml(context.page)}" data-open-drawer-id="${escapeHtml(item.id)}">
      <div class="timeline-card__header">
        <div>
          <p class="eyebrow eyebrow--muted">${escapeHtml(item.serviceLabel || item.service)}</p>
          <h4 class="card-title">${escapeHtml(item.title)}</h4>
        </div>
        ${renderStatusBadge(item.status, item.statusLabel)}
      </div>
      <p class="card-copy">${escapeHtml(truncate(item.previewText || '', 220))}</p>
      <div class="detail-grid detail-grid--compact">
        ${item.contactLabel ? `<span class="detail-chip">${escapeHtml(item.contactLabel)}</span>` : ''}
        ${item.slaState ? `<span class="detail-chip">${escapeHtml(getStatusLabel(item.slaState))}</span>` : ''}
        <span class="detail-chip">${escapeHtml(formatDateTime(item.updatedAt || item.receivedAt))}</span>
      </div>
      <div class="card-actions">
        ${renderChipButton({
          label: markPending ? 'Сохраняем...' : 'Требует внимания',
          attrs: `data-mark-attention="${escapeHtml(item.id)}"`,
          pending: markPending
        })}
        ${renderChipButton({
          label: processPending ? 'Перезапуск...' : 'Повторить обработку',
          attrs: `data-reprocess-interaction="${escapeHtml(item.id)}"`,
          pending: processPending,
          ghost: true
        })}
      </div>
    </article>
  `;
}

export function renderInstagramGroupCard(group, context = {}) {
  const dmValue = String(group.automation?.dmEnabled !== false);
  const commentValue = String(group.automation?.commentEnabled !== false);
  const dmPending = context.pendingAction === `automation:${group.contactId}:dmEnabled`;
  const commentPending = context.pendingAction === `automation:${group.contactId}:commentEnabled`;

  return `
    <article class="summary-card" data-open-drawer-page="${escapeHtml(context.page)}" data-open-drawer-id="${escapeHtml(group.id)}">
      <div class="summary-card__header">
        <div>
          <p class="eyebrow eyebrow--muted">Instagram DM</p>
          <h4 class="card-title">${escapeHtml(group.contactLabel)}</h4>
        </div>
        ${renderStatusBadge(group.status, group.statusLabel)}
      </div>
      <p class="card-copy">${escapeHtml(truncate(group.previewText || '', 180))}</p>
      <div class="detail-grid detail-grid--compact">
        <span class="detail-chip">${escapeHtml(`Сообщений: ${formatNumber(group.totalInteractions)}`)}</span>
        <span class="detail-chip">${escapeHtml(`В работе: ${formatNumber(group.pendingCount)}`)}</span>
        <span class="detail-chip">${escapeHtml(formatDateTime(group.lastMessageAt))}</span>
      </div>
      <div class="card-actions">
        ${renderChipButton({
          label: dmPending ? 'Сохраняем...' : `ИИ для сообщений: ${group.automation?.dmEnabled === false ? 'Off' : 'On'}`,
          attrs: `data-contact-automation="${escapeHtml(group.contactId)}" data-automation-key="dmEnabled" data-automation-value="${escapeHtml(dmValue)}"`,
          pending: dmPending
        })}
        ${renderChipButton({
          label: commentPending ? 'Сохраняем...' : `ИИ для комментариев: ${group.automation?.commentEnabled === false ? 'Off' : 'On'}`,
          attrs: `data-contact-automation="${escapeHtml(group.contactId)}" data-automation-key="commentEnabled" data-automation-value="${escapeHtml(commentValue)}"`,
          pending: commentPending,
          ghost: true
        })}
      </div>
    </article>
  `;
}

export function renderServiceCard(service, context = {}) {
  const processPending = context.pendingAction === `service:${service.id}:process-pending`;
  const checkPending = context.pendingAction === `service:${service.id}:check-health`;
  const reauthPending = context.pendingAction === `service:${service.id}:reauthorize`;

  return `
    <article class="summary-card" data-open-drawer-page="${escapeHtml(context.page)}" data-open-drawer-id="${escapeHtml(service.id)}">
      <div class="summary-card__header">
        <div>
          <p class="eyebrow eyebrow--muted">${escapeHtml(service.provider || 'Интеграция')}</p>
          <h4 class="card-title">${escapeHtml(service.name)}</h4>
        </div>
        ${renderStatusBadge(service.status)}
      </div>
      <p class="card-copy">${escapeHtml(service.summary || '')}</p>
      <div class="detail-grid">
        ${(service.metrics || []).map((metric) => `
          <div class="detail-stat">
            <span class="detail-stat__label">${escapeHtml(metric.label)}</span>
            <strong class="detail-stat__value">${escapeHtml(formatNumber(metric.value))}</strong>
          </div>
        `).join('')}
      </div>
      <div class="detail-grid detail-grid--compact">
        <span class="detail-chip">${escapeHtml(`Последняя проверка: ${formatDateTime(service.lastCheckedAt)}`)}</span>
        ${service.lastError ? `<span class="detail-chip tone-critical">${escapeHtml(truncate(service.lastError, 120))}</span>` : ''}
      </div>
      <div class="card-actions">
        ${renderChipButton({
          label: processPending ? 'Запуск...' : 'Запустить обработку',
          attrs: `data-service-action="process-pending" data-service-id="${escapeHtml(service.id)}"`,
          pending: processPending
        })}
        ${renderChipButton({
          label: checkPending ? 'Проверяем...' : 'Проверить подключение',
          attrs: `data-service-action="check-health" data-service-id="${escapeHtml(service.id)}"`,
          pending: checkPending,
          ghost: true
        })}
        ${service.status === 'reauth_required' ? renderChipButton({
          label: reauthPending ? 'Открываем...' : 'Авторизоваться',
          attrs: `data-service-action="reauthorize" data-service-id="${escapeHtml(service.id)}"`,
          pending: reauthPending,
          ghost: true
        }) : ''}
        ${renderChipButton({
          label: 'Перейти в лог',
          attrs: `data-open-service-log="${escapeHtml(service.id)}"`,
          ghost: true
        })}
      </div>
    </article>
  `;
}

function renderTimeline(timeline = []) {
  if (!timeline.length) {
    return `<p class="drawer__text">История обработки пока не записана.</p>`;
  }

  return `
    <div class="timeline-list">
      ${timeline.map((stage) => `
        <div class="timeline-list__item">
          <div>
            <h4 class="drawer-section__title">${escapeHtml(stage.label)}</h4>
            <p class="drawer__text">${escapeHtml(stage.detail || '')}</p>
          </div>
          <span class="detail-chip">${escapeHtml(formatDateTime(stage.at))}</span>
        </div>
      `).join('')}
    </div>
  `;
}

export function renderDrawer(drawerModel, pendingAction) {
  if (!drawerModel) {
    return '';
  }

  if (drawerModel.kind === 'interaction') {
    const item = drawerModel.item;
    const markPending = pendingAction === `attention:${item.id}`;
    const processPending = pendingAction === `reprocess:${item.id}`;

    return `
      <aside class="drawer drawer--open" aria-label="Детали обращения">
        <div class="drawer__backdrop" data-close-drawer></div>
        <div class="drawer__panel">
          <button class="drawer__close" type="button" data-close-drawer aria-label="Закрыть">Закрыть</button>
          <p class="eyebrow">${escapeHtml(item.serviceLabel || item.service)}</p>
          <h3 class="drawer__title">${escapeHtml(item.title)}</h3>
          <div class="detail-grid detail-grid--compact">
            ${renderStatusBadge(item.status, item.statusLabel)}
            ${item.contactLabel ? `<span class="detail-chip">${escapeHtml(item.contactLabel)}</span>` : ''}
            <span class="detail-chip">${escapeHtml(formatDateTime(item.updatedAt || item.receivedAt))}</span>
          </div>
          <div class="drawer-section">
            <h4 class="drawer-section__title">Текст обращения</h4>
            <p class="drawer__text">${escapeHtml(item.previewText || 'Нет текста')}</p>
          </div>
          ${item.responseText ? `
            <div class="drawer-section">
              <h4 class="drawer-section__title">Ответ</h4>
              <p class="drawer__text">${escapeHtml(item.responseText)}</p>
            </div>
          ` : ''}
          <div class="drawer-section">
            <h4 class="drawer-section__title">История обработки</h4>
            ${renderTimeline(item.timeline || [])}
          </div>
          <div class="card-actions">
            ${renderChipButton({
              label: markPending ? 'Сохраняем...' : 'Требует внимания',
              attrs: `data-mark-attention="${escapeHtml(item.id)}"`,
              pending: markPending
            })}
            ${renderChipButton({
              label: processPending ? 'Перезапуск...' : 'Повторить обработку',
              attrs: `data-reprocess-interaction="${escapeHtml(item.id)}"`,
              pending: processPending,
              ghost: true
            })}
            ${item.sourceUrl ? `<a class="chip-button chip-button--ghost" href="${escapeHtml(item.sourceUrl)}" target="_blank" rel="noopener">Открыть источник</a>` : ''}
          </div>
        </div>
      </aside>
    `;
  }

  if (drawerModel.kind === 'contact-group') {
    const item = drawerModel.item;
    const dmPending = pendingAction === `automation:${item.contactId}:dmEnabled`;
    const commentPending = pendingAction === `automation:${item.contactId}:commentEnabled`;

    return `
      <aside class="drawer drawer--open" aria-label="Детали контакта">
        <div class="drawer__backdrop" data-close-drawer></div>
        <div class="drawer__panel">
          <button class="drawer__close" type="button" data-close-drawer aria-label="Закрыть">Закрыть</button>
          <p class="eyebrow">Instagram контакт</p>
          <h3 class="drawer__title">${escapeHtml(item.contactLabel)}</h3>
          <p class="drawer__text">${escapeHtml(item.previewText || '')}</p>
          <div class="detail-grid">
            <div class="detail-stat">
              <span class="detail-stat__label">Сообщений</span>
              <strong class="detail-stat__value">${escapeHtml(formatNumber(item.totalInteractions))}</strong>
            </div>
            <div class="detail-stat">
              <span class="detail-stat__label">В работе</span>
              <strong class="detail-stat__value">${escapeHtml(formatNumber(item.pendingCount))}</strong>
            </div>
          </div>
          <div class="card-actions">
            ${renderChipButton({
              label: dmPending ? 'Сохраняем...' : `ИИ для сообщений: ${item.automation?.dmEnabled === false ? 'Off' : 'On'}`,
              attrs: `data-contact-automation="${escapeHtml(item.contactId)}" data-automation-key="dmEnabled" data-automation-value="${escapeHtml(String(item.automation?.dmEnabled !== false))}"`,
              pending: dmPending
            })}
            ${renderChipButton({
              label: commentPending ? 'Сохраняем...' : `ИИ для комментариев: ${item.automation?.commentEnabled === false ? 'Off' : 'On'}`,
              attrs: `data-contact-automation="${escapeHtml(item.contactId)}" data-automation-key="commentEnabled" data-automation-value="${escapeHtml(String(item.automation?.commentEnabled !== false))}"`,
              pending: commentPending,
              ghost: true
            })}
          </div>
        </div>
      </aside>
    `;
  }

  if (drawerModel.kind === 'service') {
    const item = drawerModel.item;
    const processPending = pendingAction === `service:${item.id}:process-pending`;
    const checkPending = pendingAction === `service:${item.id}:check-health`;
    const reauthPending = pendingAction === `service:${item.id}:reauthorize`;

    return `
      <aside class="drawer drawer--open" aria-label="Детали интеграции">
        <div class="drawer__backdrop" data-close-drawer></div>
        <div class="drawer__panel">
          <button class="drawer__close" type="button" data-close-drawer aria-label="Закрыть">Закрыть</button>
          <p class="eyebrow">${escapeHtml(item.provider || 'Интеграция')}</p>
          <h3 class="drawer__title">${escapeHtml(item.name)}</h3>
          <p class="drawer__text">${escapeHtml(item.summary || '')}</p>
          <div class="detail-grid">
            ${(item.metrics || []).map((metric) => `
              <div class="detail-stat">
                <span class="detail-stat__label">${escapeHtml(metric.label)}</span>
                <strong class="detail-stat__value">${escapeHtml(formatNumber(metric.value))}</strong>
              </div>
            `).join('')}
          </div>
          <div class="detail-grid detail-grid--compact">
            <span class="detail-chip">${escapeHtml(formatDateTime(item.lastCheckedAt))}</span>
            ${item.lastError ? `<span class="detail-chip tone-critical">${escapeHtml(item.lastError)}</span>` : ''}
          </div>
          <div class="card-actions">
            ${renderChipButton({
              label: processPending ? 'Запуск...' : 'Запустить обработку',
              attrs: `data-service-action="process-pending" data-service-id="${escapeHtml(item.id)}"`,
              pending: processPending
            })}
            ${renderChipButton({
              label: checkPending ? 'Проверяем...' : 'Проверить подключение',
              attrs: `data-service-action="check-health" data-service-id="${escapeHtml(item.id)}"`,
              pending: checkPending,
              ghost: true
            })}
            ${item.status === 'reauth_required' ? renderChipButton({
              label: reauthPending ? 'Открываем...' : 'Авторизоваться',
              attrs: `data-service-action="reauthorize" data-service-id="${escapeHtml(item.id)}"`,
              pending: reauthPending,
              ghost: true
            }) : ''}
          </div>
        </div>
      </aside>
    `;
  }

  return '';
}
