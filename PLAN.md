# Редизайн Dashboard в Command Center

## Summary
Перестроить текущий dashboard в `clinical premium` `Command Center` с `triage first` логикой, сохранив статическую раздачу через Express и текущий стек без React. Первый релиз покрывает все текущие разделы, но главный экран становится рабочим центром: сверху короткая executive-сводка для руководителя, ниже actionable triage-board для оператора.

Ключевые UX-цели:
- за `20 секунд` руководитель понимает, есть ли критические проблемы, какие каналы деградировали и какова общая стабильность;
- за `1-2 клика` оператор может открыть инцидент, увидеть контекст, выполнить `resolve` или `reauthorize`, и перейти к связанному потоку событий;
- интерфейс остаётся `sidebar pages`, но детали открываются в drawer, а не уводят пользователя в отдельные “глухие” страницы.

## Implementation Changes
### 1. Frontend Architecture
- Перевести dashboard с глобальных IIFE-модулей на нативные ES modules без сборщика; точка входа остаётся в [dashboard/index.html](/Users/dos/Desktop/infinity life assistant/dashboard/index.html), bootstrap и router переезжают в [dashboard/app.js](/Users/dos/Desktop/infinity life assistant/dashboard/app.js).
- Разделить UI на `shell`, `components`, `pages`, `state`, `api`; убрать зависимость от одного большого `renderers.js`.
- Разделить стили на дизайн-токены и слои: `tokens`, `base`, `layout`, `components`, `pages`; не держать весь новый UI в одном `styles.css`.
- Оставить `Manrope + IBM Plex Mono` в v1, чтобы не распылять scope на font migration; premium-эффект добрать через иерархию, spacing, контраст, панели и цветовые токены.
- Зафиксировать визуальный язык:
  - фон: тёплый stone/ivory, не чисто белый;
  - accent: глубокий teal/green;
  - warning: muted amber;
  - critical: muted burgundy;
  - без неона, без dark mode, без “security console” эстетики.

### 2. Information Architecture and Page Behavior
- `Overview` превращается в главный `Command Center`:
  - верх: executive strip из 4 KPI-блоков `инциденты`, `p95 reply`, `responses delivered`, `integrations healthy`;
  - основной блок: triage-board с critical/warning карточками, сортировка по срочности;
  - рядом: compact live decisions stream с последними DM/comment решениями;
  - ниже: health strip по каналам и краткий integration risk summary.
- `Incidents` становится полным board-экраном:
  - фильтры `severity`, `source`, `state`;
  - сортировки `urgency` и `recent`;
  - быстрые действия `Resolve`, `Reauthorize`, `Open related context`.
- `Live Feed` показывает timeline событий и решений policy engine:
  - фильтры `channel`, `decision`, `status`;
  - обязательный показ `text`, `responseText`, `decision`, `latency`, `updatedAt`;
  - связь с инцидентом или исходным каналом через drawer/deep link.
- `Channels` показывает каналы как operational scorecards, а не просто набор карточек:
  - health/status, workload, top risk, recent activity.
- `Integrations` показывает auth posture и работоспособность:
  - статус токена, last check, last error, reauth CTA.
- `Activity` остаётся audit-журналом, но визуально упрощается и выравнивается под общую систему компонентов.
- Детали элементов открываются в правом drawer на `Overview`, `Incidents`, `Live Feed`; полноценные отдельные detail-pages не добавлять.

### 3. Backend/API Contract Changes
- Расширить [server/server.js](/Users/dos/Desktop/infinity life assistant/server/server.js) так, чтобы `GET /api/overview` отдавал явные секции для нового экрана:
  - `summary`
  - `triage`
  - `liveFeed`
  - `channelHealth`
  - `integrationHealth`
  - `generatedAt`
- Не ломать существующие route names; новые страницы продолжают работать через текущие `/api/overview`, `/api/live-feed`, `/api/incidents`, `/api/channels`, `/api/integrations`, `/api/activity`.
- Обогатить incident view-model в API:
  - добавить `state`, `openedAt`, `updatedAt`, `count`, `service`, `reasonCode`, `meta`, `recommendedAction`;
  - не сводить инцидент только к `title/detail`.
- Добавить `POST /api/incidents/:id/resolve`:
  - request: `{ resolutionDetail?: string }`
  - response: `{ incident }`
  - реализация через уже существующий `IncidentManager.resolveIncident`.
- Переиспользовать существующий `POST /api/integrations/:service/reauthorize`.
- Не вводить `acknowledge`, `snooze`, `assign` в v1: текущая модель инцидента уже имеет понятный lifecycle `open|resolved`, и этого достаточно для первого actionable board.
- Расширить frontend state:
  - `activePage`, `loadingPage`, `lastSync`, `toast`
  - `pages`
  - `drawer`
  - `filtersByPage`
  - `pendingAction`

## Delivery Plan
1. Подготовить новый shell и дизайн-систему без изменения бизнес-логики.
2. Перепаковать frontend в ES modules и компонентные renderers.
3. Расширить `/api/overview` и incident payloads под triage-first layout.
4. Внедрить новый `Overview` как главный Command Center.
5. Добавить incident drawer и `resolve` action.
6. Перестроить `Incidents`, `Live Feed`, `Channels`, `Integrations`, `Activity` на новой компонентной системе.
7. Удалить мёртвые ветки старых renderer/layout решений после полной миграции страниц.
8. Оставить deprecated queue endpoints как есть, с текущими compatibility-response сообщениями.

## Test Plan
- Backend contract tests:
  - `GET /api/overview` возвращает новые секции и не теряет ключевые summary-метрики.
  - `GET /api/incidents` сохраняет lifecycle-поля и recommended action.
  - `POST /api/incidents/:id/resolve` переводит инцидент в `resolved` и обновляет timestamps.
  - `POST /api/integrations/:service/reauthorize` не регрессирует.
- Frontend tests на `node:test` для чистых renderer/state модулей:
  - active nav state;
  - loading/error/empty states;
  - severity/status rendering;
  - incident action availability;
  - drawer open/close and refresh behavior.
- Smoke scenarios:
  - загрузка всех 6 страниц;
  - resolve incident с обновлением UI;
  - reauthorize flow с toast и refresh;
  - переход из overview в инцидент/контекст live-feed.
- Acceptance criteria:
  - overview читается как executive summary сверху и рабочий triage-board снизу;
  - operator can act from overview without перехода по нескольким страницам;
  - manager can scan health without reading raw event stream;
  - существующий runtime webhook/AI/reply pipeline не меняется и не блокируется UI-работами.

## Assumptions and Defaults
- Первый релиз включает все текущие страницы, не только overview.
- Новый UI остаётся на текущем статическом стеке; React, bundler и полная frontend-platform migration не входят в scope.
- В v1 write-actions появляются только там, где уже есть или легко добавляется доменная опора: `resolve incident` и `reauthorize`.
- Legacy Django backend не участвует в этом редизайне.
- Если в ходе внедрения появится нехватка данных для конкретной карточки, приоритет такой:
  - сначала расширить существующий payload builder;
  - не вводить новый endpoint, если можно безопасно эволюционировать текущий.
