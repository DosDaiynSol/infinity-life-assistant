import { reauthorizeService, resolveIncident, loadPageData } from './modules/api.mjs';
import { buildDrawerModel } from './modules/drawer.mjs';
import { renderApp } from './modules/render/shell.mjs';
import { createStore } from './modules/state.mjs';

const AUTO_REFRESH_MS = 60_000;

const store = createStore();

let toastTimer = null;
let autoRefreshTimer = null;

function getRoot() {
  return document.querySelector('[data-app-root]');
}

function render() {
  const root = getRoot();
  if (!root) {
    return;
  }

  root.innerHTML = renderApp(store.getState());
}

function setToast(message, tone = 'neutral') {
  if (toastTimer) {
    window.clearTimeout(toastTimer);
  }

  store.dispatch({
    type: 'SET_TOAST',
    toast: message ? { message, tone } : null
  });

  if (message) {
    toastTimer = window.setTimeout(() => {
      store.dispatch({
        type: 'SET_TOAST',
        toast: null
      });
    }, 3200);
  }
}

async function loadPage(page = store.getState().activePage, options = {}) {
  const { background = false } = options;

  if (!background) {
    store.dispatch({
      type: 'LOAD_PAGE_START',
      page
    });
  }

  try {
    const payload = await loadPageData(page);

    store.dispatch({
      type: 'LOAD_PAGE_SUCCESS',
      page,
      payload,
      receivedAt: payload.generatedAt || new Date().toISOString()
    });

    const currentState = store.getState();
    if (currentState.drawer.open && currentState.drawer.page === page) {
      const drawerModel = buildDrawerModel(currentState.pages, currentState.drawer);
      if (!drawerModel) {
        store.dispatch({
          type: 'CLOSE_DRAWER'
        });
      }
    }
  } catch (error) {
    store.dispatch({
      type: 'LOAD_PAGE_ERROR',
      page,
      message: error.message || 'Unexpected error'
    });

    if (!background) {
      setToast(error.message || 'Unable to load the page.', 'critical');
    }
  }
}

function navigate(page) {
  store.dispatch({
    type: 'NAVIGATE',
    page
  });

  if (!store.getState().pages[page]) {
    void loadPage(page);
  }
}

async function refreshLinkedPages(pageIds) {
  const uniquePages = [...new Set(pageIds)].filter(Boolean);

  await Promise.all(uniquePages.map((page) => loadPage(page, {
    background: page !== store.getState().activePage
  })));
}

async function handleResolveIncident(incidentId) {
  const pendingKey = `resolve:${incidentId}`;

  store.dispatch({
    type: 'SET_PENDING_ACTION',
    value: pendingKey
  });

  try {
    await resolveIncident(incidentId);
    store.dispatch({
      type: 'CLOSE_DRAWER'
    });
    setToast('Incident resolved.', 'healthy');

    const currentState = store.getState();
    await refreshLinkedPages([
      'overview',
      'incidents',
      currentState.activePage
    ]);
  } catch (error) {
    setToast(error.message || 'Unable to resolve incident.', 'critical');
  } finally {
    store.dispatch({
      type: 'SET_PENDING_ACTION',
      value: null
    });
  }
}

async function handleReauthorize(service) {
  const pendingKey = `reauthorize:${service}`;

  store.dispatch({
    type: 'SET_PENDING_ACTION',
    value: pendingKey
  });

  try {
    const result = await reauthorizeService(service);
    if (result.url) {
      window.open(result.url, '_blank', 'noopener');
    }

    setToast(result.message || 'Reauthorization flow opened.', result.status === 'ok' ? 'healthy' : 'warning');

    const currentState = store.getState();
    await refreshLinkedPages([
      'overview',
      'incidents',
      'integrations',
      currentState.activePage
    ]);
  } catch (error) {
    setToast(error.message || 'Unable to open reauthorization.', 'critical');
  } finally {
    store.dispatch({
      type: 'SET_PENDING_ACTION',
      value: null
    });
  }
}

async function handleOpenContext(page, itemId) {
  if (!page || !itemId) {
    return;
  }

  if (store.getState().activePage !== page) {
    store.dispatch({
      type: 'NAVIGATE',
      page
    });
  }

  if (!store.getState().pages[page]) {
    await loadPage(page);
  }

  store.dispatch({
    type: 'OPEN_DRAWER',
    page,
    itemId
  });
}

function handleDocumentClick(event) {
  const closeDrawerButton = event.target.closest('[data-close-drawer]');
  if (closeDrawerButton) {
    store.dispatch({
      type: 'CLOSE_DRAWER'
    });
    return;
  }

  const navButton = event.target.closest('[data-nav]');
  if (navButton) {
    navigate(navButton.dataset.nav);
    return;
  }

  const refreshButton = event.target.closest('[data-refresh-current]');
  if (refreshButton) {
    void loadPage();
    return;
  }

  const reauthorizeButton = event.target.closest('[data-integration-reauth]');
  if (reauthorizeButton) {
    void handleReauthorize(reauthorizeButton.dataset.integrationReauth);
    return;
  }

  const resolveButton = event.target.closest('[data-resolve-incident]');
  if (resolveButton) {
    void handleResolveIncident(resolveButton.dataset.resolveIncident);
    return;
  }

  const contextButton = event.target.closest('[data-open-context-page][data-open-context-id]');
  if (contextButton) {
    void handleOpenContext(
      contextButton.dataset.openContextPage,
      contextButton.dataset.openContextId
    );
    return;
  }

  const drawerTarget = event.target.closest('[data-open-drawer-page][data-open-drawer-id]');
  if (drawerTarget) {
    store.dispatch({
      type: 'OPEN_DRAWER',
      page: drawerTarget.dataset.openDrawerPage,
      itemId: drawerTarget.dataset.openDrawerId
    });
  }
}

function handleDocumentChange(event) {
  const filterInput = event.target.closest('[data-filter-page][data-filter-key]');
  if (!filterInput) {
    return;
  }

  store.dispatch({
    type: 'SET_FILTER',
    page: filterInput.dataset.filterPage,
    key: filterInput.dataset.filterKey,
    value: filterInput.value
  });
}

function handleDocumentKeydown(event) {
  if (event.key !== 'Escape') {
    return;
  }

  if (store.getState().drawer.open) {
    store.dispatch({
      type: 'CLOSE_DRAWER'
    });
  }
}

function startAutoRefresh() {
  if (autoRefreshTimer) {
    window.clearInterval(autoRefreshTimer);
  }

  autoRefreshTimer = window.setInterval(() => {
    void loadPage();
  }, AUTO_REFRESH_MS);
}

function bootstrap() {
  store.subscribe(render);
  render();

  document.addEventListener('click', handleDocumentClick);
  document.addEventListener('change', handleDocumentChange);
  document.addEventListener('keydown', handleDocumentKeydown);

  void loadPage();
  startAutoRefresh();
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', bootstrap, { once: true });
} else {
  bootstrap();
}
