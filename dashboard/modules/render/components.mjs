import {
  escapeHtml,
  formatDateTime,
  formatLatency,
  formatNumber,
  getStatusLabel,
  toneFromStatus,
  truncate
} from '../format.mjs';

function renderActionButton(action, { itemId, pendingAction } = {}) {
  if (!action || !action.kind) {
    return '';
  }

  if (action.kind === 'resolve') {
    const pendingKey = `resolve:${itemId}`;
    const isPending = pendingAction === pendingKey;

    return `
      <button class="chip-button" type="button" data-resolve-incident="${escapeHtml(itemId)}" ${isPending ? 'disabled' : ''}>
        ${escapeHtml(isPending ? 'Resolving...' : action.label)}
      </button>
    `;
  }

  if (action.kind === 'reauthorize') {
    const pendingKey = `reauthorize:${action.service}`;
    const isPending = pendingAction === pendingKey;

    return `
      <button class="chip-button" type="button" data-integration-reauth="${escapeHtml(action.service || '')}" ${isPending ? 'disabled' : ''}>
        ${escapeHtml(isPending ? 'Opening...' : action.label)}
      </button>
    `;
  }

  if (action.kind === 'open_context') {
    return `
      <button class="chip-button chip-button--ghost" type="button" data-open-context-page="${escapeHtml(action.page || '')}" data-open-context-id="${escapeHtml(action.itemId || '')}">
        ${escapeHtml(action.label)}
      </button>
    `;
  }

  return '';
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

export function renderIncidentCard(incident, context = {}) {
  const actions = (incident.actions || [])
    .map((action) => renderActionButton(action, {
      itemId: incident.id,
      pendingAction: context.pendingAction
    }))
    .join('');
  const frequency = incident.count > 1 ? `${formatNumber(incident.count)}x seen` : 'Single occurrence';
  const updatedAt = incident.updatedAt ? formatDateTime(incident.updatedAt) : 'No update time';

  return `
    <article class="incident-card" data-open-drawer-page="${escapeHtml(context.page)}" data-open-drawer-id="${escapeHtml(incident.id)}">
      <div class="incident-card__header">
        <div>
          <p class="eyebrow eyebrow--muted">${escapeHtml(incident.source)}</p>
          <h4 class="card-title">${escapeHtml(incident.title)}</h4>
        </div>
        ${renderStatusBadge(incident.severity)}
      </div>
      <p class="card-copy">${escapeHtml(truncate(incident.detail, 220))}</p>
      <div class="detail-grid detail-grid--compact">
        <span>${renderStatusBadge(incident.state)}</span>
        <span class="detail-chip">${escapeHtml(frequency)}</span>
        <span class="detail-chip">${escapeHtml(updatedAt)}</span>
      </div>
      ${actions ? `<div class="card-actions">${actions}</div>` : ''}
    </article>
  `;
}

export function renderLiveFeedItem(item, context = {}) {
  return `
    <article class="timeline-card" data-open-drawer-page="${escapeHtml(context.page)}" data-open-drawer-id="${escapeHtml(item.id)}">
      <div class="timeline-card__header">
        <div>
          <p class="eyebrow eyebrow--muted">${escapeHtml(item.source || item.channel || 'Event')}</p>
          <h4 class="card-title">${escapeHtml(item.title)}</h4>
        </div>
        ${renderStatusBadge(item.status)}
      </div>
      <p class="card-copy">${escapeHtml(truncate(item.text || item.detail || item.stageDetail || '', 220))}</p>
      ${item.responseText ? `<div class="response-block">${escapeHtml(truncate(item.responseText, 220))}</div>` : ''}
      <div class="detail-grid detail-grid--compact">
        ${item.decision ? `<span class="detail-chip">${escapeHtml(getStatusLabel(item.decision))}</span>` : ''}
        <span class="detail-chip">${escapeHtml(formatLatency(item.latencySeconds))}</span>
        <span class="detail-chip">${escapeHtml(formatDateTime(item.updatedAt || item.timestamp))}</span>
      </div>
    </article>
  `;
}

export function renderChannelHealthCard(channel) {
  return `
    <article class="summary-card" data-open-drawer-page="channels" data-open-drawer-id="${escapeHtml(channel.id)}">
      <div class="summary-card__header">
        <h4 class="card-title">${escapeHtml(channel.name)}</h4>
        ${renderStatusBadge(channel.status)}
      </div>
      <p class="card-copy">${escapeHtml(channel.topRisk || channel.summary || '')}</p>
      <div class="detail-grid">
        ${(channel.metrics || []).map((metric) => `
          <div class="detail-stat">
            <span class="detail-stat__label">${escapeHtml(metric.label)}</span>
            <strong class="detail-stat__value">${escapeHtml(formatNumber(metric.value))}</strong>
          </div>
        `).join('')}
      </div>
    </article>
  `;
}

export function renderIntegrationCard(service, context = {}) {
  const actionButtons = (service.actions || [])
    .filter((action) => action === 'reauthorize')
    .map(() => renderActionButton({
      kind: 'reauthorize',
      label: 'Reauthorize',
      service: service.id
    }, {
      itemId: service.id,
      pendingAction: context.pendingAction
    }))
    .join('');

  return `
    <article class="summary-card" data-open-drawer-page="${escapeHtml(context.page || 'integrations')}" data-open-drawer-id="${escapeHtml(service.id)}">
      <div class="summary-card__header">
        <div>
          <p class="eyebrow eyebrow--muted">${escapeHtml(service.provider || 'Integration')}</p>
          <h4 class="card-title">${escapeHtml(service.name)}</h4>
        </div>
        ${renderStatusBadge(service.status)}
      </div>
      <p class="card-copy">${escapeHtml(service.summary || '')}</p>
      <div class="detail-grid detail-grid--compact">
        <span class="detail-chip">${escapeHtml(formatDateTime(service.lastCheckedAt))}</span>
        ${service.lastError ? `<span class="detail-chip tone-critical">${escapeHtml(truncate(service.lastError, 120))}</span>` : ''}
      </div>
      ${actionButtons ? `<div class="card-actions">${actionButtons}</div>` : ''}
    </article>
  `;
}

export function renderActivityItem(item) {
  return `
    <article class="activity-row">
      <div class="activity-row__header">
        <div>
          <p class="eyebrow eyebrow--muted">${escapeHtml(item.source || 'Activity')}</p>
          <h4 class="card-title">${escapeHtml(item.title)}</h4>
        </div>
        ${renderStatusBadge(item.status)}
      </div>
      <p class="card-copy">${escapeHtml(truncate(item.detail || '', 220))}</p>
      <span class="detail-chip">${escapeHtml(formatDateTime(item.timestamp))}</span>
    </article>
  `;
}

export function renderDrawer(drawerModel, pendingAction) {
  if (!drawerModel) {
    return '';
  }

  if (drawerModel.kind === 'incident') {
    const incident = drawerModel.item;
    const actions = (incident.actions || [])
      .map((action) => renderActionButton(action, {
        itemId: incident.id,
        pendingAction
      }))
      .join('');

    return `
      <aside class="drawer drawer--open" aria-label="Details drawer">
        <div class="drawer__backdrop" data-close-drawer></div>
        <div class="drawer__panel">
          <button class="drawer__close" type="button" data-close-drawer aria-label="Close details">Close</button>
          <p class="eyebrow">Incident</p>
          <h3 class="drawer__title">${escapeHtml(incident.title)}</h3>
          <p class="drawer__text">${escapeHtml(incident.detail)}</p>
          <div class="detail-grid">
            <div class="detail-stat">
              <span class="detail-stat__label">Severity</span>
              <strong class="detail-stat__value">${escapeHtml(getStatusLabel(incident.severity))}</strong>
            </div>
            <div class="detail-stat">
              <span class="detail-stat__label">State</span>
              <strong class="detail-stat__value">${escapeHtml(getStatusLabel(incident.state))}</strong>
            </div>
            <div class="detail-stat">
              <span class="detail-stat__label">Service</span>
              <strong class="detail-stat__value">${escapeHtml(incident.service || 'n/a')}</strong>
            </div>
            <div class="detail-stat">
              <span class="detail-stat__label">Reason code</span>
              <strong class="detail-stat__value">${escapeHtml(incident.reasonCode || 'n/a')}</strong>
            </div>
            <div class="detail-stat">
              <span class="detail-stat__label">Opened</span>
              <strong class="detail-stat__value">${escapeHtml(formatDateTime(incident.openedAt))}</strong>
            </div>
            <div class="detail-stat">
              <span class="detail-stat__label">Updated</span>
              <strong class="detail-stat__value">${escapeHtml(formatDateTime(incident.updatedAt))}</strong>
            </div>
          </div>
          <div class="detail-meta">
            <pre class="detail-meta__code">${escapeHtml(JSON.stringify(incident.meta || {}, null, 2))}</pre>
          </div>
          ${actions ? `<div class="card-actions">${actions}</div>` : ''}
        </div>
      </aside>
    `;
  }

  if (drawerModel.kind === 'live-feed') {
    const item = drawerModel.item;

    return `
      <aside class="drawer drawer--open" aria-label="Details drawer">
        <div class="drawer__backdrop" data-close-drawer></div>
        <div class="drawer__panel">
          <button class="drawer__close" type="button" data-close-drawer aria-label="Close details">Close</button>
          <p class="eyebrow">Live decision</p>
          <h3 class="drawer__title">${escapeHtml(item.title)}</h3>
          <div class="detail-grid detail-grid--compact">
            ${item.channel ? `<span class="detail-chip">${escapeHtml(item.channel)}</span>` : ''}
            ${item.decision ? `<span class="detail-chip">${escapeHtml(getStatusLabel(item.decision))}</span>` : ''}
            <span class="detail-chip">${escapeHtml(formatLatency(item.latencySeconds))}</span>
            <span class="detail-chip">${escapeHtml(formatDateTime(item.updatedAt || item.timestamp))}</span>
          </div>
          <div class="drawer-section">
            <h4 class="drawer-section__title">Incoming text</h4>
            <p class="drawer__text">${escapeHtml(item.text || 'No text')}</p>
          </div>
          <div class="drawer-section">
            <h4 class="drawer-section__title">Response</h4>
            <p class="drawer__text">${escapeHtml(item.responseText || 'No response captured')}</p>
          </div>
        </div>
      </aside>
    `;
  }

  const item = drawerModel.item;
  const title = item?.name || item?.title || 'Details';
  const summary = item?.summary || item?.detail || item?.topRisk || '';

  return `
    <aside class="drawer drawer--open" aria-label="Details drawer">
      <div class="drawer__backdrop" data-close-drawer></div>
      <div class="drawer__panel">
        <button class="drawer__close" type="button" data-close-drawer aria-label="Close details">Close</button>
        <p class="eyebrow">${escapeHtml(drawerModel.kind)}</p>
        <h3 class="drawer__title">${escapeHtml(title)}</h3>
        <p class="drawer__text">${escapeHtml(summary)}</p>
      </div>
    </aside>
  `;
}
