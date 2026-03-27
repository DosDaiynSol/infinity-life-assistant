# Event-Driven Assistant Redesign

## Summary
- План опирается на skills `backend-patterns`, `api-design`, `security-review`, `tdd-workflow` и `frontend-patterns`, на текущее состояние репо и на ограничения провайдеров.
- Главная переделка: убрать минутный batching, ручной `process now`, пользовательские очереди и cron-driven Instagram flow; заменить их на event-driven обработку с мгновенным ответом по входящему событию.
- Основание в коде: сейчас webhook складывает события в буфер в [server/server.js](/Users/dos/Desktop/infinity%20life%20assistant/server/server.js), сам буфер живёт в памяти в [server/buffer.js](/Users/dos/Desktop/infinity%20life%20assistant/server/buffer.js), а Instagram токены берутся напрямую из env в [server/services/instagram-api.js](/Users/dos/Desktop/infinity%20life%20assistant/server/services/instagram-api.js).
- Зафиксированные продуктовые решения: `Hybrid best-practice`, `Escalate risky`, `Pause + alerts`.
- Целевые SLA первой волны: `POST /webhook` подтверждается за `<=2s`, Instagram ответ уходит в `p95 <= 5s`, нет пользовательских кнопок “обработать очередь/запустить вручную”, auth-сбой становится инцидентом и уходит в alert максимум за `1 минуту`.

## Implementation Changes
- Удалить из основного Instagram пути `MessageBuffer`, `setInterval(processBuffer, 60000)`, `/api/process-now`, `/api/buffer` и все UI-сценарии, где событие “ждёт запуска”.
- Ввести `InboundEventStore`: каждый входящий webhook сначала нормализуется, получает `dedupe_key`, сохраняется в БД и только потом немедленно передаётся в worker; это не операторская очередь, а durable event log для идемпотентности и восстановления после рестарта.
- Разделить pipeline на `ingest -> classify -> generate -> deliver -> observe`, чтобы webhook, Google Pub/Sub и фоновые sync-задачи вызывали один и тот же движок решений.
- Для Instagram DM добавить короткое `conversation micro-window` в `2–3s` только на уровень одного sender/thread, чтобы склеивать подряд отправленные фразы без минутного ожидания; комментарии отвечаются сразу без batching.
- Ввести `ResponsePolicyEngine` с тремя решениями: `auto_reply`, `safe_fallback`, `escalate`.
- `auto_reply` покрывает FAQ, запись, цены, адреса, врачей, обычные комментарии и безопасные отзывы.
- `safe_fallback` срабатывает при таймауте/ошибке LLM и отправляет заранее одобренный шаблон по каналу.
- `escalate` покрывает жалобы, острые симптомы, опасные медицинские формулировки, претензии к врачу, юридически рискованные кейсы и неоднозначные публичные отзывы.
- Для `escalate` система не создаёт очередь на ручную отправку; она либо отправляет безопасный triage-ответ там, где это допустимо по политике канала, либо только создаёт incident и alert.
- Добавить `single-flight lock` на conversation/review key, чтобы при дублях webhook и повторных доставках не было двух ответов.
- Добавить `timeout budget`: классификация и генерация ограничены по времени, после чего включается fallback, а не зависание запроса.
- Добавить structured logging и activity trail на каждом шаге: `received`, `deduped`, `classified`, `generated`, `sent`, `failed`, `escalated`.

## Integrations and Token Resilience
- Вынести единый `IntegrationAuthManager` и запретить прямое чтение токенов в platform-сервисах; каждый adapter получает токен только через manager.
- Привести `oauth_tokens` к общему контракту: `service`, `access_token`, `refresh_token`, `token_type`, `expires_at`, `status`, `last_error`, `last_checked_at`, `last_refreshed_at`, `updated_at`, `meta`.
- Для Google Business и YouTube использовать полноценный offline OAuth flow с сохранением refresh token, proactive refresh до expiry, reactive refresh на `401/403`, единый backoff и переход в `reauth_required` при `invalid_grant`.
- Для Threads сохранить long-lived refresh flow, но перевести его в тот же manager, с ранним refresh и health-state.
- Для Meta/Instagram перевести текущие `INSTAGRAM_DM_TOKEN` и `INSTAGRAM_REPLY_TOKEN` в централизованный Meta adapter: единая загрузка, валидация, derivation/rotation там, где это поддерживается текущим типом токена, и единый incident path при invalidation.
- Система не пытается “логиниться как человек” через браузер. Если провайдер требует новый consent, affected channel переводится в `degraded/reauth_required`, а в Telegram и dashboard уходит actionable alert с ссылкой на reauth.
- Добавить `IncidentManager` с dedupe/cooldown, чтобы repeated `401/403/190` не спамили алертами.
- Добавить `TelegramNotifier` и обязательные alert-сценарии: auth refresh failed, repeated delivery failure, webhook signature failure, Google Pub/Sub verification failure, degraded channel.
- Оставить небольшой background health worker только для задач, где push невозможен: proactive token refresh, YouTube comments sync и Threads discovery sync. В Instagram и Google reviews scheduled batching больше не используется.

## Channel Flows and UI
- Instagram DM/comments становятся полностью real-time: webhook принимает событие, движок отвечает, оператор видит уже не “ожидает обработки”, а “что пришло, что ответили, что эскалировали, что упало”.
- Google Reviews переводятся с pull-only логики на Cloud Pub/Sub notifications; новые отзывы приходят push-событием, безопасные отзывы получают автоответ, рискованные сразу становятся incident without queue.
- YouTube комментарии остаются hybrid: без ручной кнопки “process channel”, с автоматическим background sync и автоответом по найденным новым комментариям; это вынуждено ограничениями YouTube push API.
- Threads остаётся discovery-каналом: фоновый поиск и авто-решение по policy engine, без ручных validated-queues в основном UX.
- Dashboard переделывается из `Queues/Platforms/Manual actions` в `Overview`, `Live Feed`, `Incidents`, `Integrations`, `Channels`, `Activity`.
- `Overview` показывает health, latency, delivered vs failed, escalations, auth incidents и последние внешние ошибки.
- `Live Feed` показывает поток входящих и исходящих событий по времени с их текущим state-machine status.
- `Incidents` показывает только реальные исключения: risky medical cases, auth failures, delivery failures, provider outages.
- `Integrations` показывает токены, срок жизни, last refresh, last error, current status и только сервисные действия `Reauthorize`, `Refresh now`, `Test alert`.
- Удалить из UI все “обработать очередь”, “poll”, “retry backlog”, “manual send approval” как основной workflow. Если recovery-replay нужен, он остаётся только как скрытый admin action в incident detail, не как обычный способ работы.

## Public Interfaces and Data Contracts
- Сохранить `GET /webhook`, `POST /webhook` и существующие OAuth callback URLs, чтобы не ломать внешние интеграции.
- Добавить `POST /webhooks/google-business/notifications` для Google Business Profile Pub/Sub push.
- Пересобрать dashboard API вокруг live/incident модели: `GET /api/overview`, `GET /api/live-feed`, `GET /api/incidents`, `GET /api/integrations`, `GET /api/channels`, `GET /api/activity`.
- Удалить или deprecated: `/api/process-now`, `/api/buffer`, queue-oriented payloads, platform actions `process/poll/retry` как пользовательские сценарии.
- Ввести общую таблицу `interaction_events` с полями `platform`, `channel`, `external_id`, `conversation_id`, `direction`, `decision`, `risk_level`, `response_text`, `delivery_status`, `raw_payload`, `received_at`, `processed_at`, `dedupe_key`.
- Ввести таблицу `incidents` с полями `service`, `severity`, `state`, `reason_code`, `title`, `detail`, `external_ref`, `opened_at`, `resolved_at`, `meta`.
- Сохранить существующую conversation memory для Instagram, но отвязать её от batch-processing и перевести на live-response model.

## Test Plan
- Unit: idempotency, micro-window aggregation, risk classification, fallback selection, auth manager state transitions, incident dedupe/cooldown, provider adapters.
- Integration: Instagram webhook happy path, duplicate webhook suppression, auth refresh on expired token, Google Pub/Sub review flow, Telegram alert emission, state persistence after process restart.
- E2E: новый dashboard без queue actions, live event appears after inbound webhook, incident appears on risky message, integration degrades after forced auth failure, reauth CTA opens correctly.
- Contract tests: provider payload normalizers для Instagram messaging/comments и Google Pub/Sub review notifications.
- Reliability tests: replay saved webhook twice, send burst of DM fragments, simulate OpenAI timeout, simulate provider `401/403/190`, verify single response and correct incident state.
- Coverage target для новой архитектуры: `>=80%` на `auth`, `policy engine`, `event processing`, `incidents`, `dashboard state`.

## Assumptions and Provider Constraints
- Main runtime остаётся Node/Express; legacy `backend/` не трогаем в первой волне, если он не мешает деплою нового assistant flow.
- Нормальный рабочий режим больше не использует операторские очереди и ручные запуски; человеческое участие остаётся только для редких incidents.
- Google Business Profile officially supports real-time notifications via Cloud Pub/Sub, поэтому Google reviews можно перевести на push: [Manage real-time notifications](https://developers.google.com/my-business/content/notification-setup).
- Google OAuth officially supports offline refresh tokens and automatic access-token renewal when refresh token is stored securely: [OAuth 2.0 for Web Server Applications](https://developers.google.com/identity/protocols/oauth2/web-server).
- YouTube official push notifications cover channel/video updates, а не comment events, поэтому YouTube comments остаются hybrid background sync until provider capabilities change: [Subscribe to Push Notifications](https://developers.google.com/youtube/v3/guides/push_notifications).
- Для Meta/Threads сохраняем best-effort silent refresh там, где провайдер это поддерживает; если consent revoked или token invalidated и refresh невозможен, система не “логинится сама”, а переводит канал в managed incident с alert и reauth action.
