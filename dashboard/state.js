(function () {
  const listeners = new Set();

  let state = Object.freeze({
    activePage: 'overview',
    selectedPlatform: 'instagram',
    queueFilter: 'all',
    loadingPage: null,
    lastSync: null,
    toast: null,
    errors: Object.freeze({}),
    pages: Object.freeze({
      overview: null,
      queues: null,
      platforms: null,
      reviews: null,
      integrations: null,
      activity: null,
      platformDetails: Object.freeze({})
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
