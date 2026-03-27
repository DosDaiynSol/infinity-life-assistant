(function () {
  const store = window.DashboardStore;
  const api = window.DashboardApi;
  const renderers = window.DashboardRenderers;

  let toastTimer = null;
  let autoRefreshTimer = null;

  function setToast(message, tone) {
    if (toastTimer) {
      window.clearTimeout(toastTimer);
    }

    store.setState((state) => ({
      ...state,
      toast: message ? { message, tone } : null
    }));

    if (message) {
      toastTimer = window.setTimeout(() => {
        store.setState((state) => ({
          ...state,
          toast: null
        }));
      }, 3200);
    }
  }

  function setPageData(page, payload) {
    store.setState((state) => ({
      ...state,
      loadingPage: null,
      lastSync: new Date().toISOString(),
      errors: Object.freeze({
        ...state.errors,
        [page]: null
      }),
      pages: Object.freeze({
        ...state.pages,
        [page]: payload
      })
    }));
  }

  function setPageError(page, error) {
    store.setState((state) => ({
      ...state,
      loadingPage: null,
      errors: Object.freeze({
        ...state.errors,
        [page]: error.message || 'Непредвиденная ошибка'
      })
    }));
  }

  async function loadCurrentPage() {
    const currentState = store.getState();
    const page = currentState.activePage;

    store.setState((state) => ({
      ...state,
      loadingPage: page
    }));

    try {
      const payload = await api.loadPageData(page);
      setPageData(page, payload);
    } catch (error) {
      setPageError(page, error);
      setToast(error.message || 'Не удалось загрузить страницу.', 'critical');
    }
  }

  function switchPage(page) {
    store.setState((state) => ({
      ...state,
      activePage: page
    }));

    loadCurrentPage();
  }

  async function handleReauthorize(service) {
    try {
      const result = await api.reauthorizeService(service);
      if (result.url) {
        window.open(result.url, '_blank', 'noopener');
      }

      setToast(result.message || 'Сценарий повторной авторизации открыт.', result.status === 'ok' ? 'healthy' : 'warning');
      if (store.getState().activePage === 'integrations' || store.getState().activePage === 'overview') {
        await loadCurrentPage();
      }
    } catch (error) {
      setToast(error.message || 'Не удалось открыть повторную авторизацию.', 'critical');
    }
  }

  function handleDocumentClick(event) {
    const navButton = event.target.closest('[data-nav]');
    if (navButton) {
      event.preventDefault();
      switchPage(navButton.dataset.nav);
      return;
    }

    const refreshButton = event.target.closest('[data-refresh-current]');
    if (refreshButton) {
      event.preventDefault();
      loadCurrentPage();
      return;
    }

    const serviceButton = event.target.closest('[data-integration-reauth]');
    if (serviceButton) {
      event.preventDefault();
      handleReauthorize(serviceButton.dataset.integrationReauth);
    }
  }

  function startAutoRefresh() {
    if (autoRefreshTimer) {
      window.clearInterval(autoRefreshTimer);
    }

    autoRefreshTimer = window.setInterval(() => {
      loadCurrentPage();
    }, 60000);
  }

  document.addEventListener('DOMContentLoaded', () => {
    store.subscribe(renderers.render);
    renderers.render(store.getState());
    document.addEventListener('click', handleDocumentClick);
    loadCurrentPage();
    startAutoRefresh();
  });
})();
