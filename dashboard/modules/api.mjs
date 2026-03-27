const API_BASE = window.location.origin;

function buildQuery(params = {}) {
  const searchParams = new URLSearchParams();

  Object.entries(params).forEach(([key, value]) => {
    if (value === undefined || value === null || value === '' || value === 'all') {
      return;
    }

    searchParams.set(key, String(value));
  });

  const query = searchParams.toString();
  return query ? `?${query}` : '';
}

async function requestJson(path, options = {}) {
  const response = await fetch(`${API_BASE}${path}`, options);
  const payload = await response.json().catch(() => ({}));

  if (!response.ok) {
    throw new Error(payload.error || payload.message || 'Request failed');
  }

  return payload;
}

function withJsonHeaders(body, csrfToken) {
  return {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...(csrfToken ? { 'X-CSRF-Token': csrfToken } : {})
    },
    body: JSON.stringify(body || {})
  };
}

export async function getSession() {
  return requestJson('/api/auth/me');
}

export async function login(email, password) {
  return requestJson('/api/auth/login', withJsonHeaders({ email, password }));
}

export async function register(email, password) {
  return requestJson('/api/auth/register', withJsonHeaders({ email, password }));
}

export async function sendPasswordResetEmail(email) {
  return requestJson('/api/auth/forgot-password', withJsonHeaders({ email }));
}

export async function resetPassword({ accessToken, refreshToken, password }) {
  return requestJson('/api/auth/reset-password', withJsonHeaders({
    accessToken,
    refreshToken,
    password
  }));
}

export async function logout(csrfToken) {
  return requestJson('/api/auth/logout', withJsonHeaders({}, csrfToken));
}

export async function loadPageData(page, filters = {}) {
  if (page === 'overview') {
    return requestJson('/api/overview');
  }

  if (page === 'interactions') {
    return requestJson(`/api/interactions${buildQuery({
      service: filters.service,
      status: filters.status,
      query: filters.query,
      only_unprocessed: filters.onlyUnprocessed,
      sla: filters.sla,
      view: filters.view
    })}`);
  }

  if (page === 'integrations') {
    return requestJson('/api/services');
  }

  if (page === 'profile') {
    return requestJson('/api/profile');
  }

  throw new Error(`Unknown page: ${page}`);
}

export async function loadInteractionDetail(interactionId) {
  return requestJson(`/api/interactions/${encodeURIComponent(interactionId)}`);
}

export async function markInteractionAttention(interactionId, csrfToken) {
  return requestJson(
    `/api/interactions/${encodeURIComponent(interactionId)}/actions/mark-attention`,
    withJsonHeaders({}, csrfToken)
  );
}

export async function reprocessInteraction(interactionId, csrfToken) {
  return requestJson(
    `/api/interactions/${encodeURIComponent(interactionId)}/actions/reprocess`,
    withJsonHeaders({}, csrfToken)
  );
}

export async function updateInstagramAutomation(contactId, patch, csrfToken) {
  return requestJson(`/api/instagram-contacts/${encodeURIComponent(contactId)}/automation`, {
    method: 'PATCH',
    headers: {
      'Content-Type': 'application/json',
      ...(csrfToken ? { 'X-CSRF-Token': csrfToken } : {})
    },
    body: JSON.stringify(patch)
  });
}

export async function runServiceAction(serviceId, action, csrfToken) {
  return requestJson(
    `/api/services/${encodeURIComponent(serviceId)}/actions/${encodeURIComponent(action)}`,
    withJsonHeaders({}, csrfToken)
  );
}
