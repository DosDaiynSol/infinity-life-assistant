import {
  renderBanner,
  renderEmptyState,
  renderFilterInput,
  renderFilterSelect,
  renderInstagramGroupCard,
  renderInteractionCard,
  renderMetricCards,
  renderPanelHeader,
  renderServiceCard
} from './components.mjs';

function renderOverviewPage(data, state) {
  return `
    <div class="page-stack">
      ${renderMetricCards(data.summary.cards || [])}
      ${renderBanner(data.degradedBanner)}
      <section class="page-grid page-grid--command">
        <article class="surface-panel">
          ${renderPanelHeader({
            eyebrow: 'Срочные обращения',
            title: 'Что требует реакции сейчас',
            subtitle: 'Новые, просроченные и проблемные обращения из всех сервисов.'
          })}
          <div class="stack-list">
            ${(data.urgent?.items || []).length
              ? data.urgent.items.map((item) => renderInteractionCard(item, {
                page: 'overview',
                pendingAction: state.pendingAction
              })).join('')
              : renderEmptyState('Новых обращений нет', 'Каналы подключены. Как только появятся новые события, они окажутся здесь.')}
          </div>
        </article>
        <article class="surface-panel">
          ${renderPanelHeader({
            eyebrow: 'Статус каналов',
            title: 'Контроль интеграций',
            subtitle: 'Быстрый срез по каналам, ошибкам и ручным действиям.'
          })}
          <div class="summary-grid">
            ${(data.services?.items || []).length
              ? data.services.items.map((service) => renderServiceCard(service, {
                page: 'overview',
                pendingAction: state.pendingAction
              })).join('')
              : renderEmptyState('Интеграции пока не найдены', 'Подключите сервисы, чтобы видеть их статус и статистику.')}
          </div>
        </article>
      </section>
    </div>
  `;
}

function renderInteractionsPage(data, state) {
  const filters = state.filtersByPage.interactions;
  const items = data.data || [];
  const grouped = data.meta?.grouped;

  return `
    <div class="page-stack">
      <article class="surface-panel">
        ${renderPanelHeader({
          eyebrow: 'Фильтры',
          title: 'Лог обращений',
          subtitle: 'Единый журнал по Instagram, Threads, Google Reviews и YouTube.'
        })}
        <div class="filters-row">
          ${renderFilterSelect({
            page: 'interactions',
            key: 'service',
            value: filters.service,
            label: 'Сервис',
            options: [
              { value: 'all', label: 'Все сервисы' },
              { value: 'instagram_dm', label: 'Сообщения Instagram' },
              { value: 'instagram_comment', label: 'Комментарии Instagram' },
              { value: 'google_reviews', label: 'Google Reviews' },
              { value: 'threads', label: 'Threads' },
              { value: 'youtube', label: 'YouTube' }
            ]
          })}
          ${renderFilterSelect({
            page: 'interactions',
            key: 'status',
            value: filters.status,
            label: 'Статус',
            options: [
              { value: 'all', label: 'Все статусы' },
              { value: 'new', label: 'Новое' },
              { value: 'ai_processed', label: 'Обработано ИИ' },
              { value: 'needs_attention', label: 'Требует внимания' },
              { value: 'closed', label: 'Закрыто' },
              { value: 'error', label: 'Ошибка' }
            ]
          })}
          ${renderFilterSelect({
            page: 'interactions',
            key: 'sla',
            value: filters.sla,
            label: 'SLA',
            options: [
              { value: 'all', label: 'Все' },
              { value: 'breached', label: 'SLA нарушен' }
            ]
          })}
          ${renderFilterSelect({
            page: 'interactions',
            key: 'onlyUnprocessed',
            value: filters.onlyUnprocessed,
            label: 'Необработанные',
            options: [
              { value: 'false', label: 'Все обращения' },
              { value: 'true', label: 'Только необработанные' }
            ]
          })}
          ${renderFilterSelect({
            page: 'interactions',
            key: 'view',
            value: filters.view,
            label: 'Вид',
            options: [
              { value: 'list', label: 'Список' },
              { value: 'grouped', label: 'По пользователям' }
            ]
          })}
          ${renderFilterInput({
            page: 'interactions',
            key: 'query',
            value: filters.query,
            label: 'Поиск',
            placeholder: 'Имя, текст, id, ссылка'
          })}
        </div>
      </article>
      <article class="surface-panel">
        ${renderPanelHeader({
          eyebrow: grouped ? 'Группировка Instagram' : 'Журнал событий',
          title: grouped ? 'Диалоги по пользователям' : 'Все обращения',
          subtitle: grouped
            ? 'Для Instagram DM показана сгруппированная лента по контактам.'
            : 'Каждое обращение отображается отдельной карточкой.'
        })}
        <div class="stack-list">
          ${items.length
            ? items.map((item) => grouped
              ? renderInstagramGroupCard(item, {
                page: 'interactions',
                pendingAction: state.pendingAction
              })
              : renderInteractionCard(item, {
                page: 'interactions',
                pendingAction: state.pendingAction
              })).join('')
            : renderEmptyState('Ничего не найдено', 'Попробуйте изменить фильтры или снять часть ограничений.')}
        </div>
      </article>
    </div>
  `;
}

function renderIntegrationsPage(data, state) {
  return `
    <div class="page-stack">
      ${renderMetricCards([
        {
          label: 'Всего интеграций',
          value: data.summary.total,
          detail: `${data.summary.healthy} в норме`,
          tone: 'neutral'
        },
        {
          label: 'Требуют авторизации',
          value: data.summary.reauthRequired,
          detail: 'Нужно повторное подключение',
          tone: data.summary.reauthRequired ? 'warning' : 'healthy'
        },
        {
          label: 'Ограничено',
          value: data.summary.degraded,
          detail: 'Есть ошибки или устаревшие данные',
          tone: data.summary.degraded ? 'warning' : 'healthy'
        }
      ])}
      <article class="surface-panel">
        ${renderPanelHeader({
          eyebrow: 'Контроль каналов',
          title: 'Интеграции и ручной запуск',
          subtitle: 'Статусы, ошибки, авторизация и запуск обработки по каждому сервису.'
        })}
        <div class="summary-grid">
          ${(data.services || []).length
            ? data.services.map((service) => renderServiceCard(service, {
              page: 'integrations',
              pendingAction: state.pendingAction
            })).join('')
            : renderEmptyState('Интеграции не найдены', 'Когда сервисы будут подключены, они появятся в этом разделе.')}
        </div>
      </article>
    </div>
  `;
}

function renderProfilePage(data) {
  return `
    <div class="page-stack">
      <article class="surface-panel">
        ${renderPanelHeader({
          eyebrow: 'Профиль',
          title: 'Аккаунт и уведомления',
          subtitle: 'MVP рассчитан на одного пользователя без ролей.'
        })}
        <div class="detail-grid">
          <div class="detail-stat">
            <span class="detail-stat__label">Email</span>
            <strong class="detail-stat__value">${data.user?.email || 'Не указан'}</strong>
          </div>
          <div class="detail-stat">
            <span class="detail-stat__label">Клиника</span>
            <strong class="detail-stat__value">${data.clinic?.name || 'INFINITY LIFE'}</strong>
          </div>
          <div class="detail-stat">
            <span class="detail-stat__label">Telegram</span>
            <strong class="detail-stat__value">${data.notifications?.telegramConfigured ? 'Подключен' : 'Не настроен'}</strong>
          </div>
        </div>
        <p class="panel__subtitle">${data.notifications?.summary || ''}</p>
        <div class="card-actions">
          <button class="chip-button" type="button" data-send-password-reset>Отправить ссылку для смены пароля</button>
          <button class="chip-button chip-button--ghost" type="button" data-logout>Выйти</button>
        </div>
      </article>
    </div>
  `;
}

function renderLoadingState() {
  return renderEmptyState('Загрузка', 'Собираем актуальные данные командного центра.');
}

function renderErrorState(message) {
  return renderEmptyState('Не удалось загрузить раздел', message);
}

export function renderPage(state) {
  const page = state.activePage;
  const data = state.pages[page];
  const error = state.errors[page];

  if (error && !data) {
    return renderErrorState(error);
  }

  if (!data) {
    return renderLoadingState();
  }

  if (page === 'overview') {
    return renderOverviewPage(data, state);
  }

  if (page === 'interactions') {
    return renderInteractionsPage(data, state);
  }

  if (page === 'integrations') {
    return renderIntegrationsPage(data, state);
  }

  if (page === 'profile') {
    return renderProfilePage(data, state);
  }

  return renderErrorState('Неизвестный раздел');
}
