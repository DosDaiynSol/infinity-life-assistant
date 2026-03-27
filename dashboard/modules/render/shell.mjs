import { PAGE_CONFIG } from '../constants.mjs';
import { buildDrawerModel } from '../drawer.mjs';
import { escapeHtml, formatDateTime } from '../format.mjs';
import { renderDrawer } from './components.mjs';
import { renderPage } from './pages.mjs';

function getHero(state) {
  const page = state.activePage;
  const loadingSuffix = state.loadingPage === page ? ' Обновляем данные...' : '';

  if (page === 'overview') {
    return {
      title: 'Главная',
      summary: `Ключевые показатели клиники и список того, что требует реакции прямо сейчас.${loadingSuffix}`
    };
  }

  if (page === 'interactions') {
    return {
      title: 'Лог обращений',
      summary: `Единый журнал по всем сервисам с фильтрами, SLA и grouped view для Instagram.${loadingSuffix}`
    };
  }

  if (page === 'integrations') {
    return {
      title: 'Интеграции',
      summary: `Контроль каналов, авторизация, ручной запуск и ошибки.${loadingSuffix}`
    };
  }

  if (page === 'profile') {
    return {
      title: 'Профиль',
      summary: `Настройки единственного MVP-пользователя и статус уведомлений.${loadingSuffix}`
    };
  }

  return {
    title: 'Command Center',
    summary: `Загрузка интерфейса.${loadingSuffix}`
  };
}

function renderToast(toast) {
  if (!toast?.message) {
    return '';
  }

  return `
    <div class="toast tone-${escapeHtml(toast.tone || 'neutral')}">
      ${escapeHtml(toast.message)}
    </div>
  `;
}

export function renderApp(state) {
  const hero = getHero(state);
  const drawerModel = buildDrawerModel(state.pages, state.drawer);

  return `
    <div class="command-shell">
      <aside class="sidebar">
        <div class="brand-card">
          <p class="eyebrow">INFINITY LIFE</p>
          <h1 class="brand-card__title">Русский Command Center</h1>
          <p class="brand-card__copy">Операционный кабинет для обращений, каналов и ручного контроля ИИ.</p>
        </div>
        <nav class="nav-stack" aria-label="Основная навигация">
          ${PAGE_CONFIG.map((page) => `
            <button class="nav-link ${page.id === state.activePage ? 'is-active' : ''}" type="button" data-nav="${escapeHtml(page.id)}">
              <span class="nav-link__label">${escapeHtml(page.label)}</span>
              <span class="nav-link__hint">${escapeHtml(page.hint)}</span>
            </button>
          `).join('')}
        </nav>
        <section class="sidebar-panel">
          <p class="eyebrow">Пользователь</p>
          <p class="card-copy">${escapeHtml(state.appUser?.email || 'Неизвестный пользователь')}</p>
          <div class="pill-row">
            <span class="surface-pill">Instagram</span>
            <span class="surface-pill">Threads</span>
            <span class="surface-pill">Google</span>
            <span class="surface-pill">YouTube</span>
          </div>
        </section>
      </aside>
      <main class="workspace">
        <header class="hero">
          <div class="hero__copy">
            <p class="eyebrow">Операторский кабинет</p>
            <h2 class="hero__title">${escapeHtml(hero.title)}</h2>
            <p class="hero__summary">${escapeHtml(hero.summary)}</p>
          </div>
          <div class="hero__meta">
            <div class="meta-card">
              <span class="meta-card__label">Последнее обновление</span>
              <strong class="meta-card__value">${escapeHtml(state.lastSync ? formatDateTime(state.lastSync) : 'Ожидание')}</strong>
            </div>
            <div class="hero__actions">
              <button class="header-action header-action--primary" type="button" data-refresh-current>Обновить</button>
            </div>
          </div>
        </header>
        <section class="page-root">
          ${renderPage(state)}
        </section>
      </main>
      ${renderDrawer(drawerModel, state.pendingAction)}
      ${renderToast(state.toast)}
    </div>
  `;
}
