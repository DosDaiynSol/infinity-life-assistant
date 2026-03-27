(function () {
  const API_BASE = window.location.origin;

  async function requestJson(path, options) {
    const response = await fetch(`${API_BASE}${path}`, options);
    const payload = await response.json().catch(() => ({}));

    if (!response.ok) {
      throw new Error(payload.error || payload.message || 'Request failed');
    }

    return payload;
  }

  async function loadPageData(page) {
    if (page === 'overview') {
      return requestJson('/api/overview');
    }

    if (page === 'live-feed') {
      return requestJson('/api/live-feed');
    }

    if (page === 'incidents') {
      return requestJson('/api/incidents');
    }

    if (page === 'integrations') {
      return requestJson('/api/integrations');
    }

    if (page === 'channels') {
      return requestJson('/api/channels');
    }

    if (page === 'activity') {
      return requestJson('/api/activity');
    }

    throw new Error(`Unknown page: ${page}`);
  }

  async function reauthorizeService(service) {
    return requestJson(`/api/integrations/${encodeURIComponent(service)}/reauthorize`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      }
    });
  }

  window.DashboardApi = {
    loadPageData,
    reauthorizeService
  };
})();
