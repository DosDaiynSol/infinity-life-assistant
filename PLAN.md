# INFINITY LIFE Assistant 2.0 — Implementation Plan

## Summary
Пересобираем проект как **единый operational assistant platform** для клиники: удаляем legacy Django-контур, строим отказоустойчивый слой интеграций с авто-refresh токенов и Telegram-оповещениями, а dashboard переделываем из “набора вкладок” в настоящий **operations cockpit**.

Цели первой реализации:
- полностью убрать неиспользуемый Django-контур из репозитория;
- перевести все сервисные интеграции на единый token lifecycle manager;
- автоматически обновлять токены там, где это поддерживается провайдером;
- при невозможности silent re-auth сразу уведомлять в Telegram и показывать критический инцидент в UI;
- заменить текущий multi-tab dashboard на более правильный UX для операторской системы.

## Implementation Changes
### 1. Repo Reset and Legacy Removal
- Полностью удалить [backend/](/Users/dos/Desktop/infinity%20life%20assistant/backend), так как он представляет отдельный marketplace/OLX-подобный DRF-проект и не используется текущим assistant runtime.
- Удалить или заменить связанные legacy-артефакты:
  - `docker-compose.yml`, если он остается только для Django/Postgres-контура;
  - `backend/.env`, `backend/Dockerfile`, старые README-фрагменты про Django.
- Обновить документацию проекта под один runtime: Node assistant через [server/server.js](/Users/dos/Desktop/infinity%20life%20assistant/server/server.js).
- Одновременно убрать из репозитория секреты и bearer-токены из tracked-файлов; все обнаруженные токены считать скомпрометированными и подлежащими ротации.

### 2. Unified Integration and Token Resilience Layer
- Вынести единый `IntegrationAuthManager`, который станет единственной точкой получения токена для `youtube`, `google_business`, `threads`, `instagram_messaging`, `facebook_page`, `crosspost`.
- Расширить хранилище `oauth_tokens` до одного общего контракта:
  - `service`
  - `access_token`
  - `refresh_token`
  - `token_type`
  - `expires_at`
  - `status` (`healthy`, `expiring`, `refreshing`, `reauth_required`, `degraded`)
  - `last_error`
  - `last_checked_at`
  - `updated_at`
  - `meta` JSON для provider-specific полей
- Оставить три режима работы токенов:
  - proactive refresh по расписанию;
  - reactive refresh при первом невалидном запросе;
  - escalation path при невозможности refresh.
- Для Google/YouTube и Google Business сохранить текущую модель refresh token, но перевести ее из разрозненных service-классов в общий provider adapter.
- Для Threads сохранить long-lived refresh flow, но также перевести его в общий manager и добавить health-state.
- Для Instagram/Facebook убрать прямое чтение `INSTAGRAM_DM_TOKEN` и `INSTAGRAM_REPLY_TOKEN` из runtime-сервисов. Вместо этого:
  - хранить основной Meta auth state централизованно;
  - получать рабочий token через manager;
  - для Page/API flows, где возможен derivation из user token, делать это централизованно и кэшировать результат;
  - при invalidation переводить сервис в `reauth_required`.
- Важный default: система **автоматически обновляет токены только там, где провайдер это разрешает**. Если refresh token отозван, consent сброшен или нужен новый ручной OAuth grant, система не пытается “логиниться как человек”, а генерирует re-auth incident.

### 3. Reauth Recovery and Telegram Alerts
- Добавить `telegram-notifier` сервис с env-конфигом:
  - `TELEGRAM_BOT_TOKEN`
  - `TELEGRAM_CHAT_ID`
  - опционально `TELEGRAM_THREAD_ID`
- Отправлять Telegram alert при событиях:
  - refresh failed;
  - сервис перешел в `reauth_required`;
  - webhook auth/signature invalid repeatedly;
  - repeated 401/403/190 от внешнего API;
  - critical integration disabled.
- Делать dedupe и cooldown, чтобы не спамить: один активный alert на сервис + повтор не чаще заданного окна.
- В каждом критическом alert включать:
  - сервис;
  - причина;
  - время;
  - impact;
  - прямую re-auth ссылку;
  - текущий статус.
- Добавить scheduled health-check loop, который каждые 10–15 минут проверяет интеграции и заранее обновляет expiring tokens.
- Добавить admin endpoint `POST /api/alerts/test` для тестового Telegram-сообщения и `GET /api/integrations` для статусов интеграций.
- Для OAuth callback routes сохранить текущие публичные пути, но после успешной reauth обновлять central token state и закрывать инцидент автоматически.

### 4. Backend Architecture Refactor
- Разрезать [server/server.js](/Users/dos/Desktop/infinity%20life%20assistant/server/server.js) на:
  - `app bootstrap`
  - `shared middleware`
  - `shared config`
  - `shared auth/validation/http`
  - `modules/instagram`
  - `modules/youtube`
  - `modules/threads`
  - `modules/google`
  - `modules/integrations`
  - `modules/alerts`
- Перевести внутренний dashboard API на новую структуру:
  - `GET /api/overview`
  - `GET /api/queues`
  - `GET /api/platforms`
  - `GET /api/platforms/:platform`
  - `POST /api/platforms/:platform/actions/:action`
  - `GET /api/integrations`
  - `POST /api/integrations/:service/reauthorize`
  - `POST /api/alerts/test`
- Webhook и OAuth callback routes не переименовывать.
- Вынести ingestion и processing в отдельные application services, чтобы UI, scheduler и webhook вызывали одну и ту же бизнес-логику.
- Централизовать config validation, request validation, structured errors и idempotency по входящим событиям.
- Объединить scattered platform state и logs в единый operational status model, пригодный для overview UI.

### 5. UI/UX Redesign
- Полностью переделать текущий dashboard, потому что сейчас это набор несогласованных экранов с одинаковым визуальным весом для несрочных и критичных задач.
- Новая информационная архитектура:
  - `Overview`
  - `Queues`
  - `Platforms`
  - `Reviews & Replies`
  - `Integrations`
  - `Activity`
- Главный экран `Overview` должен показывать:
  - критические инциденты;
  - токен/интеграционный health;
  - очереди, требующие внимания;
  - негативные отзывы и failed automations;
  - SLA-style counters и последние ошибки.
- `Queues` становится рабочим inbox:
  - pending Instagram items;
  - Threads candidates;
  - Google reviews without reply;
  - failed/retry crosspost items;
  - items requiring manual approval.
- `Integrations` становится отдельным экраном для auth lifecycle:
  - текущий статус каждого сервиса;
  - expiry/refresh info;
  - last refresh attempt;
  - last error;
  - кнопки `Reauthorize`, `Test alert`, `Refresh now`.
- `Platforms` остается для глубокого drill-down, но по общему паттерну, а не как 4 разных mini-app.
- Для Google Reviews UX сделать явное разделение:
  - positive reviews with existing replies;
  - negative reviews requiring escalation;
  - generate-preview-approve-send flow.
- Для Threads UX убрать шумный длинный raw-list в пользу:
  - signal cards;
  - quality buckets;
  - clear “why rejected / why validated” states.
- Для visual direction:
  - уйти от generic white-card dashboard;
  - сделать более серьезный medical-ops интерфейс;
  - сильная иерархия статусов, incident colors, compact tables/cards, быстрые action rails;
  - responsive layout для desktop и tablet.
- Технологический default для первой волны: не мигрировать на React. Новый UI строится в рамках текущего HTML/CSS/JS, но уже по модульной архитектуре с app shell, typed API client, isolated state stores и event delegation.
- [dashboard/app.js](/Users/dos/Desktop/infinity%20life%20assistant/dashboard/app.js) и текущий dashboard markup разбиваются на модули по страницам и shared-компонентам; старые inline actions и глобальные platform overrides удаляются.

## Public Interfaces and Behavioral Changes
- `POST /webhook` и OAuth callback routes сохраняются.
- Dashboard API переводится на новый operations-oriented набор endpoints, старые ad hoc dashboard endpoints удаляются после миграции UI в той же ветке.
- В UI появляется отдельная модель инцидентов и интеграций; “авторизован/не авторизован” больше не будет бинарным текстом без контекста.
- Telegram становится официальным каналом operational alerts.
- Silent re-auth не обещается там, где сам провайдер требует ручной повторный OAuth consent; вместо этого система обязана быстро обнаружить проблему, уведомить и дать re-auth action.

## Test Plan
- Unit:
  - provider adapters для token refresh;
  - auth manager state transitions;
  - alert dedupe/cooldown;
  - config validation;
  - incident mapping;
  - UI state formatters.
- Integration:
  - OAuth callback success/failure;
  - scheduled refresh job;
  - token refresh on demand;
  - Telegram notifier with mocked API;
  - `GET /api/integrations`, `POST /api/integrations/:service/reauthorize`, `POST /api/alerts/test`;
  - webhook behavior when service auth is degraded.
- E2E:
  - overview loads and shows platform health;
  - integrations page displays token states;
  - test Telegram alert action;
  - reauth-required incident appears in UI;
  - queue workflows for Instagram/Threads/Google;
  - negative review escalation flow.
- Verification gates:
  - server start smoke;
  - integration test suite;
  - Playwright smoke;
  - coverage target `>=80%` for shared auth/integration modules and critical UI state modules.

## Assumptions and Defaults
- Django backend удаляется полностью и не сохраняется в legacy-папке.
- Main runtime остается Node/Express.
- Telegram alerts обязательны, потому что “минимум предупредить” — это уже базовое требование.
- Auto-refresh реализуется везде, где это поддерживается провайдером; при revoked/invalid consent система переходит в managed incident, а не в silent failure.
- UI переделывается не косметически, а как новый operations cockpit, потому что текущий dashboard по UX не соответствует задачам реального multi-channel assistant.
