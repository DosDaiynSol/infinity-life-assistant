import { PAGE_CONFIG } from '../constants.mjs';
import { buildDrawerModel } from '../drawer.mjs';
import { escapeHtml, formatDateTime, formatNumber, formatLatency } from '../format.mjs';
import { renderDrawer } from './components.mjs';
import { renderPage } from './pages.mjs';

function getHero(state) {
  const page = state.activePage;
  const data = state.pages[page];
  const loadingSuffix = state.loadingPage === page ? ' Refreshing data...' : '';

  if (page === 'overview' && data?.summary) {
    return {
      title: 'Clinical Command Center',
      summary: `${formatNumber(data.summary.openIncidents)} open incidents, P95 reply ${formatLatency(data.summary.p95ReplySeconds)}, ${formatNumber(data.summary.responsesDelivered)} responses delivered.${loadingSuffix}`,
      actions: [
        { kind: 'refresh', label: 'Refresh view' },
        { kind: 'navigate', page: 'incidents', label: 'Open incident board' }
      ]
    };
  }

  if (page === 'incidents' && data?.summary) {
    return {
      title: 'Incident Board',
      summary: `${formatNumber(data.summary.open)} open, ${formatNumber(data.summary.critical)} critical, ${formatNumber(data.summary.resolved)} resolved.${loadingSuffix}`,
      actions: [
        { kind: 'refresh', label: 'Refresh incidents' },
        { kind: 'navigate', page: 'live-feed', label: 'Open live feed' }
      ]
    };
  }

  if (page === 'live-feed' && data?.items) {
    return {
      title: 'Live Decisions Feed',
      summary: `${formatNumber(data.items.length)} recent events with source text, decision, response, and latency.${loadingSuffix}`,
      actions: [
        { kind: 'refresh', label: 'Refresh feed' },
        { kind: 'navigate', page: 'overview', label: 'Back to command center' }
      ]
    };
  }

  if (page === 'channels' && data?.items) {
    return {
      title: 'Channel Scorecards',
      summary: `${formatNumber(data.items.length)} channels tracked for workload and operational risk.${loadingSuffix}`,
      actions: [
        { kind: 'refresh', label: 'Refresh channels' }
      ]
    };
  }

  if (page === 'integrations' && data?.services) {
    return {
      title: 'Integration Health',
      summary: `${formatNumber(data.services.filter((item) => item.status !== 'healthy').length)} services need attention.${loadingSuffix}`,
      actions: [
        { kind: 'refresh', label: 'Refresh integrations' }
      ]
    };
  }

  if (page === 'activity' && data?.items) {
    return {
      title: 'Activity Log',
      summary: `${formatNumber(data.items.length)} recent assistant events across channels and services.${loadingSuffix}`,
      actions: [
        { kind: 'refresh', label: 'Refresh activity' }
      ]
    };
  }

  return {
    title: 'Clinical Command Center',
    summary: `Loading the operator cockpit.${loadingSuffix}`,
    actions: [
      { kind: 'refresh', label: 'Refresh view' }
    ]
  };
}

function renderHeroActions(actions) {
  return actions.map((action) => {
    if (action.kind === 'refresh') {
      return `<button class="header-action header-action--primary" type="button" data-refresh-current>${escapeHtml(action.label)}</button>`;
    }

    if (action.kind === 'navigate') {
      return `<button class="header-action" type="button" data-nav="${escapeHtml(action.page)}">${escapeHtml(action.label)}</button>`;
    }

    return '';
  }).join('');
}

function renderToast(toast) {
  if (!toast?.message) {
    return '';
  }

  return `
    <div class="toast tone-${escapeHtml(toast.tone || 'neutral')}">
      ${escapeHtml(toast.message)}
    </div>
  `;
}

export function renderApp(state) {
  const hero = getHero(state);
  const drawerModel = buildDrawerModel(state.pages, state.drawer);

  return `
    <div class="command-shell">
      <aside class="sidebar">
        <div class="brand-card">
          <p class="eyebrow">Infinity Life</p>
          <h1 class="brand-card__title">Clinical Command Center</h1>
          <p class="brand-card__copy">Triage-first cockpit for incidents, live decisions, channels, and integrations.</p>
        </div>
        <nav class="nav-stack" aria-label="Primary navigation">
          ${PAGE_CONFIG.map((page) => `
            <button class="nav-link ${page.id === state.activePage ? 'is-active' : ''}" type="button" data-nav="${escapeHtml(page.id)}">
              <span class="nav-link__label">${escapeHtml(page.label)}</span>
              <span class="nav-link__hint">${escapeHtml(page.hint)}</span>
            </button>
          `).join('')}
        </nav>
        <section class="sidebar-panel">
          <p class="eyebrow">Connected surfaces</p>
          <div class="pill-row">
            <span class="surface-pill">Instagram</span>
            <span class="surface-pill">Google</span>
            <span class="surface-pill">Threads</span>
            <span class="surface-pill">YouTube</span>
          </div>
        </section>
      </aside>
      <main class="workspace">
        <header class="hero">
          <div class="hero__copy">
            <p class="eyebrow">Operator cockpit</p>
            <h2 class="hero__title">${escapeHtml(hero.title)}</h2>
            <p class="hero__summary">${escapeHtml(hero.summary)}</p>
          </div>
          <div class="hero__meta">
            <div class="meta-card">
              <span class="meta-card__label">Last sync</span>
              <strong class="meta-card__value">${escapeHtml(state.lastSync ? formatDateTime(state.lastSync) : 'Waiting...')}</strong>
            </div>
            <div class="hero__actions">
              ${renderHeroActions(hero.actions)}
            </div>
          </div>
        </header>
        <section class="page-root">
          ${renderPage(state)}
        </section>
      </main>
      ${renderDrawer(drawerModel, state.pendingAction)}
      ${renderToast(state.toast)}
    </div>
  `;
}
