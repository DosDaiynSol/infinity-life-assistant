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
      const payload = await api.loadPageData(page, store.getState());
      setPageData(page, payload);
    } catch (error) {
      setPageError(page, error);
      setToast(error.message || 'Не удалось загрузить страницу.', 'critical');
    }
  }

  async function loadSelectedPlatformDetail(platformId) {
    store.setState((state) => ({
      ...state,
      loadingPage: 'platforms'
    }));

    try {
      const detail = await api.loadPlatformDetail(platformId);
      store.setState((state) => ({
        ...state,
        loadingPage: null,
        lastSync: new Date().toISOString(),
        errors: Object.freeze({
          ...state.errors,
          platforms: null
        }),
        pages: Object.freeze({
          ...state.pages,
          platforms: state.pages.platforms
            ? {
                ...state.pages.platforms,
                detail
              }
            : {
                generatedAt: new Date().toISOString(),
                items: [],
                detail
              }
        })
      }));
    } catch (error) {
      setPageError('platforms', error);
      setToast(error.message || 'Не удалось загрузить детали канала.', 'critical');
    }
  }

  function switchPage(page) {
    store.setState((state) => ({
      ...state,
      activePage: page
    }));

    loadCurrentPage();
  }

  function switchQueueFilter(filter) {
    store.setState((state) => ({
      ...state,
      queueFilter: filter
    }));
  }

  function switchPlatform(platformId) {
    store.setState((state) => ({
      ...state,
      selectedPlatform: platformId
    }));

    if (store.getState().activePage === 'platforms') {
      loadSelectedPlatformDetail(platformId);
    }
  }

  async function handlePlatformAction(platform, action) {
    try {
      const result = await api.runPlatformAction(platform, action);
      setToast(result.message || 'Действие выполнено.', result.status === 'ok' ? 'healthy' : 'warning');
      await loadCurrentPage();
    } catch (error) {
      setToast(error.message || 'Действие завершилось ошибкой.', 'critical');
    }
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

    const filterButton = event.target.closest('[data-queue-filter]');
    if (filterButton) {
      event.preventDefault();
      switchQueueFilter(filterButton.dataset.queueFilter);
      return;
    }

    const platformCard = event.target.closest('[data-platform-select]');
    if (platformCard) {
      event.preventDefault();
      switchPlatform(platformCard.dataset.platformSelect);
      return;
    }

    const actionButton = event.target.closest('[data-action-platform][data-action-name]');
    if (actionButton) {
      event.preventDefault();
      handlePlatformAction(actionButton.dataset.actionPlatform, actionButton.dataset.actionName);
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
