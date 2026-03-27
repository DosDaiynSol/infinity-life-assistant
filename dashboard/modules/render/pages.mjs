import { filterIncidents, filterLiveFeed } from '../filters.mjs';
import { formatNumber, getStatusLabel } from '../format.mjs';
import {
  renderActivityItem,
  renderEmptyState,
  renderFilterSelect,
  renderIncidentCard,
  renderIntegrationCard,
  renderLiveFeedItem,
  renderMetricCards,
  renderPanelHeader,
  renderChannelHealthCard
} from './components.mjs';

function renderOverviewPage(data, state) {
  return `
    <div class="page-stack">
      ${renderMetricCards(data.summary.cards || [])}
      <section class="page-grid page-grid--command">
        <article class="surface-panel">
          ${renderPanelHeader({
            eyebrow: 'Triage board',
            title: 'Actionable incidents',
            subtitle: 'Critical and warning cases sorted for operator attention first.'
          })}
          <div class="stack-list">
            ${(data.triage?.items || []).length
              ? data.triage.items.map((incident) => renderIncidentCard(incident, {
                page: 'overview',
                pendingAction: state.pendingAction
              })).join('')
              : renderEmptyState('No open incidents', 'The system has no active operator-facing incidents right now.')}
          </div>
        </article>
        <article class="surface-panel">
          ${renderPanelHeader({
            eyebrow: 'Live decisions',
            title: 'Recent DM and comment handling',
            subtitle: 'Latest policy decisions, responses, and latency snapshots.'
          })}
          <div class="stack-list">
            ${(data.liveFeed?.items || []).length
              ? data.liveFeed.items.map((item) => renderLiveFeedItem(item, {
                page: 'overview'
              })).join('')
              : renderEmptyState('Feed is quiet', 'New webhook events will appear here in realtime.')}
          </div>
        </article>
      </section>
      <section class="page-grid page-grid--support">
        <article class="surface-panel">
          ${renderPanelHeader({
            eyebrow: 'Channel health',
            title: 'Operational scorecards',
            subtitle: 'Workload, top risk, and recent delivery by channel.'
          })}
          <div class="summary-grid">
            ${(data.channelHealth?.items || []).map(renderChannelHealthCard).join('')}
          </div>
        </article>
        <article class="surface-panel">
          ${renderPanelHeader({
            eyebrow: 'Integration risk',
            title: 'Auth posture and failure surface',
            subtitle: 'What is degraded, what needs consent again, and what remains healthy.'
          })}
          <div class="stack-list">
            ${(data.integrationHealth?.riskSummary || []).length
              ? data.integrationHealth.riskSummary.map((risk) => `
                <div class="risk-row">
                  <div>
                    <h4 class="card-title">${risk.name}</h4>
                    <p class="card-copy">${risk.detail}</p>
                  </div>
                  <span class="detail-chip">${getStatusLabel(risk.status)}</span>
                </div>
              `).join('')
              : renderEmptyState('All integrations healthy', 'No auth or runtime risks are currently surfaced.')}
          </div>
          <div class="summary-grid summary-grid--narrow">
            ${(data.integrationHealth?.items || []).map((service) => renderIntegrationCard(service, {
              page: 'overview',
              pendingAction: state.pendingAction
            })).join('')}
          </div>
        </article>
      </section>
    </div>
  `;
}

function renderIncidentsPage(data, state) {
  const filters = state.filtersByPage.incidents;
  const items = filterIncidents(data.items || [], filters);

  return `
    <div class="page-stack">
      ${renderMetricCards([
        {
          label: 'Open incidents',
          value: data.summary.open,
          detail: `${formatNumber(data.summary.critical)} critical / ${formatNumber(data.summary.warning)} warning`,
          tone: data.summary.critical > 0 ? 'critical' : (data.summary.warning > 0 ? 'warning' : 'healthy')
        },
        {
          label: 'Resolved',
          value: data.summary.resolved,
          detail: 'Lifecycle closed cases',
          tone: 'healthy'
        }
      ])}
      <article class="surface-panel">
        ${renderPanelHeader({
          eyebrow: 'Board controls',
          title: 'Filter the incident board',
          subtitle: 'Slice by severity, source, state, or switch between urgency and recent ordering.'
        })}
        <div class="filters-row">
          ${renderFilterSelect({
            page: 'incidents',
            key: 'severity',
            value: filters.severity,
            label: 'Severity',
            options: (data.filters?.severity || ['all', 'critical', 'warning']).map((value) => ({
              value,
              label: value === 'all' ? 'All' : getStatusLabel(value)
            }))
          })}
          ${renderFilterSelect({
            page: 'incidents',
            key: 'source',
            value: filters.source,
            label: 'Source',
            options: (data.filters?.source || ['all']).map((value) => ({
              value,
              label: value === 'all' ? 'All sources' : value
            }))
          })}
          ${renderFilterSelect({
            page: 'incidents',
            key: 'state',
            value: filters.state,
            label: 'State',
            options: (data.filters?.state || ['all', 'open', 'resolved']).map((value) => ({
              value,
              label: value === 'all' ? 'All states' : getStatusLabel(value)
            }))
          })}
          ${renderFilterSelect({
            page: 'incidents',
            key: 'sort',
            value: filters.sort,
            label: 'Sort',
            options: [
              { value: 'urgency', label: 'Urgency' },
              { value: 'recent', label: 'Recent' }
            ]
          })}
        </div>
      </article>
      <article class="surface-panel">
        ${renderPanelHeader({
          eyebrow: 'Incident board',
          title: 'Resolve or reauthorize from one place',
          subtitle: 'Open the drawer for context, then close the loop without navigating away.'
        })}
        <div class="stack-list">
          ${items.length
            ? items.map((incident) => renderIncidentCard(incident, {
              page: 'incidents',
              pendingAction: state.pendingAction
            })).join('')
            : renderEmptyState('No incidents match the filters', 'Try widening the filters or switch to recent ordering.')}
        </div>
      </article>
    </div>
  `;
}

function renderLiveFeedPage(data, state) {
  const channelOptions = ['all', ...new Set((data.items || []).map((item) => item.channel).filter(Boolean))];
  const decisionOptions = ['all', ...new Set((data.items || []).map((item) => item.decision).filter(Boolean))];
  const statusOptions = ['all', ...new Set((data.items || []).map((item) => item.status).filter(Boolean))];
  const filters = state.filtersByPage['live-feed'];
  const items = filterLiveFeed(data.items || [], filters);

  return `
    <div class="page-stack">
      <article class="surface-panel">
        ${renderPanelHeader({
          eyebrow: 'Feed controls',
          title: 'Filter the live decisions stream',
          subtitle: 'Inspect only DMs, only escalations, or only items with a specific delivery state.'
        })}
        <div class="filters-row">
          ${renderFilterSelect({
            page: 'live-feed',
            key: 'channel',
            value: filters.channel,
            label: 'Channel',
            options: channelOptions.map((value) => ({
              value,
              label: value === 'all' ? 'All channels' : value
            }))
          })}
          ${renderFilterSelect({
            page: 'live-feed',
            key: 'decision',
            value: filters.decision,
            label: 'Decision',
            options: decisionOptions.map((value) => ({
              value,
              label: value === 'all' ? 'All decisions' : getStatusLabel(value)
            }))
          })}
          ${renderFilterSelect({
            page: 'live-feed',
            key: 'status',
            value: filters.status,
            label: 'Status',
            options: statusOptions.map((value) => ({
              value,
              label: value === 'all' ? 'All statuses' : getStatusLabel(value)
            }))
          })}
        </div>
      </article>
      <article class="surface-panel">
        ${renderPanelHeader({
          eyebrow: 'Timeline',
          title: 'Realtime webhook handling',
          subtitle: 'Every item keeps the source text, response text, decision, latency, and last update.'
        })}
        <div class="stack-list">
          ${items.length
            ? items.map((item) => renderLiveFeedItem(item, {
              page: 'live-feed'
            })).join('')
            : renderEmptyState('No events match the filters', 'Try widening the channel, decision, or status filters.')}
        </div>
      </article>
    </div>
  `;
}

function renderChannelsPage(data) {
  return `
    <div class="page-stack">
      <article class="surface-panel">
        ${renderPanelHeader({
          eyebrow: 'Channel scorecards',
          title: 'Operational posture by destination',
          subtitle: 'Each card shows status, workload, recent movement, and the main risk to watch.'
        })}
        <div class="summary-grid">
          ${(data.items || []).map(renderChannelHealthCard).join('')}
        </div>
      </article>
    </div>
  `;
}

function renderIntegrationsPage(data, state) {
  return `
    <div class="page-stack">
      <article class="surface-panel">
        ${renderPanelHeader({
          eyebrow: 'Auth and health',
          title: 'Integration control surface',
          subtitle: 'Status, last check, errors, and reauthorization entry points.'
        })}
        <div class="summary-grid">
          ${(data.services || []).map((service) => renderIntegrationCard(service, {
            page: 'integrations',
            pendingAction: state.pendingAction
          })).join('')}
        </div>
      </article>
    </div>
  `;
}

function renderActivityPage(data) {
  return `
    <div class="page-stack">
      <article class="surface-panel">
        ${renderPanelHeader({
          eyebrow: 'Audit trail',
          title: 'Recent assistant activity',
          subtitle: 'A simplified log of service stages, decisions, and delivery outcomes.'
        })}
        <div class="stack-list">
          ${(data.items || []).length
            ? data.items.map(renderActivityItem).join('')
            : renderEmptyState('No recent activity', 'Service events will appear here automatically.')}
        </div>
      </article>
    </div>
  `;
}

function renderLoadingState(page) {
  return renderEmptyState('Loading', `Collecting the latest data for ${page}.`);
}

function renderErrorState(message) {
  return renderEmptyState('Unable to load this view', message);
}

export function renderPage(state) {
  const page = state.activePage;
  const data = state.pages[page];
  const error = state.errors[page];

  if (error && !data) {
    return renderErrorState(error);
  }

  if (!data) {
    return renderLoadingState(page);
  }

  if (page === 'overview') {
    return renderOverviewPage(data, state);
  }

  if (page === 'incidents') {
    return renderIncidentsPage(data, state);
  }

  if (page === 'live-feed') {
    return renderLiveFeedPage(data, state);
  }

  if (page === 'channels') {
    return renderChannelsPage(data, state);
  }

  if (page === 'integrations') {
    return renderIntegrationsPage(data, state);
  }

  if (page === 'activity') {
    return renderActivityPage(data, state);
  }

  return renderErrorState('Unknown page');
}
