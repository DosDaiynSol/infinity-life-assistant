export const PAGE_CONFIG = Object.freeze([
  {
    id: 'overview',
    label: 'Command Center',
    hint: 'Executive summary and triage board'
  },
  {
    id: 'incidents',
    label: 'Incidents',
    hint: 'Critical, warning, and resolved operator cases'
  },
  {
    id: 'live-feed',
    label: 'Live Feed',
    hint: 'Realtime decisions, responses, and latency'
  },
  {
    id: 'channels',
    label: 'Channels',
    hint: 'Operational scorecards by channel'
  },
  {
    id: 'integrations',
    label: 'Integrations',
    hint: 'Tokens, auth posture, and service health'
  },
  {
    id: 'activity',
    label: 'Activity',
    hint: 'Audit trail across the assistant'
  }
]);

export const PAGE_IDS = PAGE_CONFIG.map((page) => page.id);

export const DEFAULT_FILTERS = Object.freeze({
  incidents: Object.freeze({
    severity: 'all',
    source: 'all',
    state: 'all',
    sort: 'urgency'
  }),
  'live-feed': Object.freeze({
    channel: 'all',
    decision: 'all',
    status: 'all'
  }),
  channels: Object.freeze({
    status: 'all'
  }),
  integrations: Object.freeze({
    status: 'all'
  }),
  activity: Object.freeze({
    status: 'all'
  })
});

export function createEmptyPages() {
  return Object.freeze(
    PAGE_IDS.reduce((pages, pageId) => ({
      ...pages,
      [pageId]: null
    }), {})
  );
}

export function cloneDefaultFilters() {
  return Object.freeze(
    Object.entries(DEFAULT_FILTERS).reduce((filters, [pageId, config]) => ({
      ...filters,
      [pageId]: Object.freeze({ ...config })
    }), {})
  );
}
