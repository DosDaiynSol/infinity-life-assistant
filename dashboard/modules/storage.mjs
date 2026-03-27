import { DEFAULT_FILTERS } from './constants.mjs';

function getStorage() {
  try {
    return window.localStorage;
  } catch (error) {
    return null;
  }
}

function buildKey(email) {
  return `infinity-life:filters:${email || 'guest'}`;
}

export function loadSavedFilters(email) {
  const storage = getStorage();
  if (!storage) {
    return null;
  }

  try {
    const raw = storage.getItem(buildKey(email));
    if (!raw) {
      return null;
    }

    const parsed = JSON.parse(raw);
    return Object.keys(DEFAULT_FILTERS).reduce((filters, pageId) => ({
      ...filters,
      [pageId]: {
        ...DEFAULT_FILTERS[pageId],
        ...(parsed[pageId] || {})
      }
    }), {});
  } catch (error) {
    return null;
  }
}

export function saveFilters(email, filtersByPage) {
  const storage = getStorage();
  if (!storage) {
    return;
  }

  try {
    storage.setItem(buildKey(email), JSON.stringify(filtersByPage));
  } catch (error) {
    // Ignore localStorage failures in MVP mode.
  }
}
