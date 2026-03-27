import { cloneDefaultFilters, createEmptyPages } from './constants.mjs';

function createDrawerState() {
  return Object.freeze({
    open: false,
    page: null,
    itemId: null
  });
}

export function createInitialState() {
  return Object.freeze({
    activePage: 'overview',
    loadingPage: null,
    lastSync: null,
    toast: null,
    errors: Object.freeze({}),
    pages: createEmptyPages(),
    drawer: createDrawerState(),
    filtersByPage: cloneDefaultFilters(),
    pendingAction: null,
    authReady: false,
    appUser: null,
    csrfToken: null
  });
}

export function reduceState(state, action) {
  if (!action || !action.type) {
    return state;
  }

  if (action.type === 'AUTH_SUCCESS') {
    return Object.freeze({
      ...state,
      authReady: true,
      appUser: action.user,
      csrfToken: action.csrfToken || state.csrfToken
    });
  }

  if (action.type === 'AUTH_FAILURE') {
    return Object.freeze({
      ...state,
      authReady: true,
      appUser: null,
      csrfToken: null
    });
  }

  if (action.type === 'NAVIGATE') {
    return Object.freeze({
      ...state,
      activePage: action.page
    });
  }

  if (action.type === 'LOAD_PAGE_START') {
    return Object.freeze({
      ...state,
      loadingPage: action.page,
      errors: Object.freeze({
        ...state.errors,
        [action.page]: null
      })
    });
  }

  if (action.type === 'LOAD_PAGE_SUCCESS') {
    return Object.freeze({
      ...state,
      loadingPage: state.loadingPage === action.page ? null : state.loadingPage,
      lastSync: action.receivedAt || new Date().toISOString(),
      pages: Object.freeze({
        ...state.pages,
        [action.page]: action.payload
      }),
      errors: Object.freeze({
        ...state.errors,
        [action.page]: null
      })
    });
  }

  if (action.type === 'LOAD_PAGE_ERROR') {
    return Object.freeze({
      ...state,
      loadingPage: state.loadingPage === action.page ? null : state.loadingPage,
      errors: Object.freeze({
        ...state.errors,
        [action.page]: action.message
      })
    });
  }

  if (action.type === 'SET_FILTER') {
    const pageFilters = state.filtersByPage[action.page] || Object.freeze({});

    return Object.freeze({
      ...state,
      filtersByPage: Object.freeze({
        ...state.filtersByPage,
        [action.page]: Object.freeze({
          ...pageFilters,
          [action.key]: action.value
        })
      })
    });
  }

  if (action.type === 'HYDRATE_FILTERS') {
    return Object.freeze({
      ...state,
      filtersByPage: Object.freeze({
        ...state.filtersByPage,
        ...(action.filtersByPage || {})
      })
    });
  }

  if (action.type === 'OPEN_DRAWER') {
    return Object.freeze({
      ...state,
      drawer: Object.freeze({
        open: true,
        page: action.page,
        itemId: action.itemId
      })
    });
  }

  if (action.type === 'CLOSE_DRAWER') {
    return Object.freeze({
      ...state,
      drawer: createDrawerState()
    });
  }

  if (action.type === 'SET_PENDING_ACTION') {
    return Object.freeze({
      ...state,
      pendingAction: action.value
    });
  }

  if (action.type === 'SET_TOAST') {
    return Object.freeze({
      ...state,
      toast: action.toast
    });
  }

  return state;
}

export function createStore(initialState = createInitialState()) {
  let state = initialState;
  const listeners = new Set();

  return {
    getState() {
      return state;
    },
    dispatch(action) {
      state = reduceState(state, action);
      listeners.forEach((listener) => listener(state));
    },
    subscribe(listener) {
      listeners.add(listener);

      return function unsubscribe() {
        listeners.delete(listener);
      };
    }
  };
}
