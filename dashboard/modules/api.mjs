const API_BASE = window.location.origin;

async function requestJson(path, options) {
  const response = await fetch(`${API_BASE}${path}`, options);
  const payload = await response.json().catch(() => ({}));

  if (!response.ok) {
    throw new Error(payload.error || payload.message || 'Request failed');
  }

  return payload;
}

export async function loadPageData(page) {
  if (page === 'overview') {
    return requestJson('/api/overview');
  }

  if (page === 'incidents') {
    return requestJson('/api/incidents');
  }

  if (page === 'live-feed') {
    return requestJson('/api/live-feed');
  }

  if (page === 'channels') {
    return requestJson('/api/channels');
  }

  if (page === 'integrations') {
    return requestJson('/api/integrations');
  }

  if (page === 'activity') {
    return requestJson('/api/activity');
  }

  throw new Error(`Unknown page: ${page}`);
}

export async function resolveIncident(incidentId, resolutionDetail = null) {
  return requestJson(`/api/incidents/${encodeURIComponent(incidentId)}/resolve`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      resolutionDetail
    })
  });
}

export async function reauthorizeService(service) {
  return requestJson(`/api/integrations/${encodeURIComponent(service)}/reauthorize`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json'
    }
  });
}
