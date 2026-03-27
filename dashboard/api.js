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

  async function loadPageData(page, state) {
    if (page === 'overview') {
      return requestJson('/api/overview');
    }

    if (page === 'queues') {
      return requestJson('/api/queues');
    }

    if (page === 'platforms') {
      const [platforms, detail] = await Promise.all([
        requestJson('/api/platforms'),
        requestJson(`/api/platforms/${encodeURIComponent(state.selectedPlatform)}`)
      ]);

      return {
        ...platforms,
        detail
      };
    }

    if (page === 'reviews') {
      return requestJson('/api/platforms/google');
    }

    if (page === 'integrations') {
      return requestJson('/api/integrations');
    }

    if (page === 'activity') {
      return requestJson('/api/activity');
    }

    throw new Error(`Unknown page: ${page}`);
  }

  async function loadPlatformDetail(platformId) {
    return requestJson(`/api/platforms/${encodeURIComponent(platformId)}`);
  }

  async function runPlatformAction(platform, action) {
    return requestJson(`/api/platforms/${encodeURIComponent(platform)}/actions/${encodeURIComponent(action)}`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      }
    });
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
    loadPlatformDetail,
    reauthorizeService,
    runPlatformAction
  };
})();
