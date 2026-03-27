export const PAGE_CONFIG = Object.freeze([
  {
    id: 'overview',
    label: 'Главная',
    hint: 'Сводка и срочные обращения'
  },
  {
    id: 'interactions',
    label: 'Лог обращений',
    hint: 'Все каналы и фильтры'
  },
  {
    id: 'integrations',
    label: 'Интеграции',
    hint: 'Статусы, авторизация, запуск'
  },
  {
    id: 'profile',
    label: 'Профиль',
    hint: 'Аккаунт и уведомления'
  }
]);

export const PAGE_IDS = PAGE_CONFIG.map((page) => page.id);

export const DEFAULT_FILTERS = Object.freeze({
  interactions: Object.freeze({
    service: 'all',
    status: 'all',
    query: '',
    onlyUnprocessed: 'false',
    sla: 'all',
    view: 'list'
  })
});

export function createEmptyPages() {
  return Object.freeze(
    PAGE_IDS.reduce((pages, pageId) => ({
      ...pages,
      [pageId]: null
    }), {})
  );
}

export function cloneDefaultFilters() {
  return Object.freeze(
    Object.entries(DEFAULT_FILTERS).reduce((filters, [pageId, config]) => ({
      ...filters,
      [pageId]: Object.freeze({ ...config })
    }), {})
  );
}
