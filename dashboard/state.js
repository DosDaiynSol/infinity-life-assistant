(function () {
  const listeners = new Set();

  let state = Object.freeze({
    activePage: 'overview',
    loadingPage: null,
    lastSync: null,
    toast: null,
    errors: Object.freeze({}),
    pages: Object.freeze({
      overview: null,
      'live-feed': null,
      incidents: null,
      integrations: null,
      channels: null,
      activity: null
    })
  });

  function getState() {
    return state;
  }

  function setState(updater) {
    const nextState = updater(state);
    state = Object.freeze(nextState);
    listeners.forEach((listener) => listener(state));
  }

  function subscribe(listener) {
    listeners.add(listener);
    return function unsubscribe() {
      listeners.delete(listener);
    };
  }

  window.DashboardStore = {
    getState,
    setState,
    subscribe
  };
})();
