import {
  getSession,
  loadPageData,
  logout,
  markInteractionAttention,
  reprocessInteraction,
  runServiceAction,
  sendPasswordResetEmail,
  updateInstagramAutomation
} from './modules/api.mjs';
import { renderApp } from './modules/render/shell.mjs';
import { createStore } from './modules/state.mjs';
import { loadSavedFilters, saveFilters } from './modules/storage.mjs';

const store = createStore();

let toastTimer = null;
let authBootstrapPromise = null;

function getRoot() {
  return document.querySelector('[data-app-root]');
}

function getPageFromLocation() {
  const match = window.location.hash.match(/^#\/([^/]+)/);
  return match?.[1] || 'overview';
}

function setLocationPage(page) {
  window.history.replaceState(null, '', `#/${page}`);
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

async function bootstrapAuth() {
  if (authBootstrapPromise) {
    return authBootstrapPromise;
  }

  authBootstrapPromise = getSession()
    .then((payload) => {
      const user = payload.data?.user || null;
      const csrfToken = payload.data?.csrfToken || null;

      store.dispatch({
        type: 'AUTH_SUCCESS',
        user,
        csrfToken
      });

      const savedFilters = loadSavedFilters(user?.email);
      if (savedFilters) {
        store.dispatch({
          type: 'HYDRATE_FILTERS',
          filtersByPage: savedFilters
        });
      }
    })
    .catch(() => {
      store.dispatch({
        type: 'AUTH_FAILURE'
      });
      window.location.replace('/login');
    });

  return authBootstrapPromise;
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
    const filters = store.getState().filtersByPage[page] || {};
    const payload = await loadPageData(page, filters);

    store.dispatch({
      type: 'LOAD_PAGE_SUCCESS',
      page,
      payload,
      receivedAt: payload.generatedAt || new Date().toISOString()
    });
  } catch (error) {
    store.dispatch({
      type: 'LOAD_PAGE_ERROR',
      page,
      message: error.message || 'Unexpected error'
    });

    if (!background) {
      setToast(error.message || 'Не удалось загрузить раздел', 'critical');
    }
  }
}

function persistFilters() {
  const state = store.getState();
  saveFilters(state.appUser?.email, state.filtersByPage);
}

function navigate(page) {
  store.dispatch({
    type: 'NAVIGATE',
    page
  });
  setLocationPage(page);
  void loadPage(page);
}

async function refreshPages(pageIds) {
  const uniquePages = [...new Set(pageIds)].filter(Boolean);
  await Promise.all(uniquePages.map((page) => loadPage(page, {
    background: page !== store.getState().activePage
  })));
}

async function handleInteractionAttention(interactionId) {
  const pendingKey = `attention:${interactionId}`;
  store.dispatch({
    type: 'SET_PENDING_ACTION',
    value: pendingKey
  });

  try {
    await markInteractionAttention(interactionId, store.getState().csrfToken);
    setToast('Обращение помечено как требующее внимания', 'warning');
    await refreshPages(['overview', 'interactions']);
  } catch (error) {
    setToast(error.message || 'Не удалось обновить статус', 'critical');
  } finally {
    store.dispatch({
      type: 'SET_PENDING_ACTION',
      value: null
    });
  }
}

async function handleInteractionReprocess(interactionId) {
  const pendingKey = `reprocess:${interactionId}`;
  store.dispatch({
    type: 'SET_PENDING_ACTION',
    value: pendingKey
  });

  try {
    const payload = await reprocessInteraction(interactionId, store.getState().csrfToken);
    setToast(payload.data?.message || 'Повторная обработка запущена', 'healthy');
    await refreshPages(['overview', 'interactions', 'integrations']);
  } catch (error) {
    setToast(error.message || 'Не удалось запустить обработку', 'critical');
  } finally {
    store.dispatch({
      type: 'SET_PENDING_ACTION',
      value: null
    });
  }
}

async function handleServiceAction(serviceId, action) {
  const pendingKey = `service:${serviceId}:${action}`;
  store.dispatch({
    type: 'SET_PENDING_ACTION',
    value: pendingKey
  });

  try {
    const payload = await runServiceAction(serviceId, action, store.getState().csrfToken);
    const result = payload.data || {};
    if (action === 'reauthorize' && result.url) {
      window.open(result.url, '_blank', 'noopener');
    }
    setToast(result.message || 'Действие выполнено', result.status === 'ok' ? 'healthy' : 'warning');
    await refreshPages(['overview', 'integrations', 'interactions']);
  } catch (error) {
    setToast(error.message || 'Не удалось выполнить действие', 'critical');
  } finally {
    store.dispatch({
      type: 'SET_PENDING_ACTION',
      value: null
    });
  }
}

async function handleContactAutomation(contactId, key, currentValue) {
  const pendingKey = `automation:${contactId}:${key}`;
  store.dispatch({
    type: 'SET_PENDING_ACTION',
    value: pendingKey
  });

  try {
    const nextValue = currentValue !== 'true';
    await updateInstagramAutomation(contactId, {
      [key]: nextValue
    }, store.getState().csrfToken);
    setToast('Настройки ИИ обновлены', 'healthy');
    await refreshPages(['overview', 'interactions']);
  } catch (error) {
    setToast(error.message || 'Не удалось сохранить настройки ИИ', 'critical');
  } finally {
    store.dispatch({
      type: 'SET_PENDING_ACTION',
      value: null
    });
  }
}

async function handleLogout() {
  try {
    await logout(store.getState().csrfToken);
  } catch (error) {
    // Ignore logout transport issues and redirect anyway.
  }

  window.location.replace('/login');
}

async function handlePasswordReset() {
  try {
    await sendPasswordResetEmail(store.getState().appUser?.email || '');
    setToast('Ссылка для смены пароля отправлена на email', 'healthy');
  } catch (error) {
    setToast(error.message || 'Не удалось отправить письмо', 'critical');
  }
}

function handleDocumentClick(event) {
  const closeDrawerButton = event.target.closest('[data-close-drawer]');
  if (closeDrawerButton) {
    store.dispatch({ type: 'CLOSE_DRAWER' });
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

  const markAttentionButton = event.target.closest('[data-mark-attention]');
  if (markAttentionButton) {
    void handleInteractionAttention(markAttentionButton.dataset.markAttention);
    return;
  }

  const reprocessButton = event.target.closest('[data-reprocess-interaction]');
  if (reprocessButton) {
    void handleInteractionReprocess(reprocessButton.dataset.reprocessInteraction);
    return;
  }

  const serviceButton = event.target.closest('[data-service-action][data-service-id]');
  if (serviceButton) {
    void handleServiceAction(serviceButton.dataset.serviceId, serviceButton.dataset.serviceAction);
    return;
  }

  const serviceLogButton = event.target.closest('[data-open-service-log]');
  if (serviceLogButton) {
    const mappedService = serviceLogButton.dataset.openServiceLog === 'instagram'
      ? 'instagram_dm'
      : serviceLogButton.dataset.openServiceLog;
    store.dispatch({
      type: 'SET_FILTER',
      page: 'interactions',
      key: 'service',
      value: mappedService
    });
    persistFilters();
    navigate('interactions');
    return;
  }

  const automationButton = event.target.closest('[data-contact-automation][data-automation-key][data-automation-value]');
  if (automationButton) {
    void handleContactAutomation(
      automationButton.dataset.contactAutomation,
      automationButton.dataset.automationKey,
      automationButton.dataset.automationValue
    );
    return;
  }

  const logoutButton = event.target.closest('[data-logout]');
  if (logoutButton) {
    void handleLogout();
    return;
  }

  const passwordResetButton = event.target.closest('[data-send-password-reset]');
  if (passwordResetButton) {
    void handlePasswordReset();
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

function updateFilter(target) {
  const filterInput = target.closest('[data-filter-page][data-filter-key]');
  if (!filterInput) {
    return;
  }

  store.dispatch({
    type: 'SET_FILTER',
    page: filterInput.dataset.filterPage,
    key: filterInput.dataset.filterKey,
    value: filterInput.value
  });
  persistFilters();

  if (filterInput.dataset.filterPage === store.getState().activePage) {
    void loadPage(filterInput.dataset.filterPage);
  }
}

function handleDocumentChange(event) {
  updateFilter(event.target);
}

function handleDocumentInput(event) {
  updateFilter(event.target);
}

async function init() {
  store.subscribe(render);
  render();

  await bootstrapAuth();

  const page = getPageFromLocation();
  store.dispatch({
    type: 'NAVIGATE',
    page
  });
  setLocationPage(page);
  await loadPage(page);

  document.addEventListener('click', handleDocumentClick);
  document.addEventListener('change', handleDocumentChange);
  document.addEventListener('input', handleDocumentInput);
  window.addEventListener('hashchange', () => {
    const nextPage = getPageFromLocation();
    if (nextPage !== store.getState().activePage) {
      navigate(nextPage);
    }
  });
}

void init();
