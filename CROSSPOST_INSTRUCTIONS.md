# Инструкция: Кросс-постинг система INFINITY LIFE

## Текущий статус

### ✅ Готово
1. **Supabase таблица** `crosspost_queue` — создана, 19 колонок, RLS включён
2. **`server/services/crosspost-service.js`** — сервис кросс-постинга:
   - Polling Instagram каждые 5 мин (через Graph API `/me/media`)
   - Публикация на Facebook (фото, видео, карусели)
   - Retry для неудавшихся постов
   - Очередь и статистика
3. **API роуты** в `server/server.js`:
   - `GET /api/crosspost/status` — статус очереди
   - `POST /api/crosspost/poll` — ручной запуск
   - `POST /api/crosspost/retry` — повтор неудавшихся
4. **Автоматика**: schedule каждые 5 мин + первый poll через 60 сек после старта
5. **Токены**: `.env` обновлён с долгосрочным (60 дней) `INSTAGRAM_REPLY_TOKEN` + `FACEBOOK_PAGE_ID=105221775099742`
6. **Тест**: пост на Facebook Infinity_life.kz создан и удалён — работает ✅

### 🔲 Нужно сделать

#### 1. Git push + Railway deploy
```bash
cd ~/Desktop/infinity\ life\ assistant
git add -A
git commit -m "Add crosspost service: Instagram → Facebook + YouTube"
git push
```
На Railway обновить переменные:
- `INSTAGRAM_REPLY_TOKEN` = значение из `.env`
- `FACEBOOK_PAGE_ID` = `105221775099742`

#### 2. YouTube Shorts кросс-постинг
Добавить в `crosspost-service.js` функционал загрузки видео (Reels) как YouTube Shorts.

**Что есть в проекте:**
- `server/services/youtube-oauth.js` — OAuth для YouTube (уже работает)
- `server/services/youtube-api.js` — `YouTubeAPI` класс с методами
- YouTube OAuth токены хранятся в Supabase таблице `oauth_tokens`
- Канал: `UC-pRH_5cq2PMBQHV1UVsmLQ`

**Что нужно сделать:**
- В `crosspost-service.js` добавить метод `crossPostToYouTube(queueItem)`:
  1. Скачать видео из `queueItem.media_urls[0].url`
  2. Загрузить на YouTube через YouTube Data API v3 (resumable upload)
  3. Установить `#Shorts` в заголовке чтобы YouTube распознал как Short
  4. Обновить `youtube_status` и `youtube_post_id` в Supabase
- Только для `media_type === 'VIDEO'` или `media_type === 'REELS'` (фото пропускаем → `youtube_status: 'skipped'`)
- Интегрировать вызов в `runPollCycle()` после Facebook

**YouTube Upload API:**
```
POST https://www.googleapis.com/upload/youtube/v3/videos?uploadType=resumable&part=snippet,status
Authorization: Bearer {access_token}
Content-Type: application/json

{
  "snippet": {
    "title": "caption #Shorts",
    "description": "caption",
    "categoryId": "22"
  },
  "status": {
    "privacyStatus": "public",
    "selfDeclaredMadeForKids": false
  }
}
```

#### 3. UI для кросс-публикации (позже)
Добавить вкладку в дашборд (`dashboard/index.html`) с:
- Таблицей очереди из `/api/crosspost/status`
- Кнопками "Запустить poll" и "Retry failed"
- Статусами по платформам

## Архитектура

```
Instagram (Graph API)
    ↓ polling каждые 5 мин
crosspost-service.js
    ↓ новый пост найден
    ├── Supabase: crosspost_queue (сохранить)
    ├── Facebook: /page-id/photos|videos|feed (опубликовать)
    └── YouTube: resumable upload → Shorts (TODO)
```

## Важные файлы
- `/server/services/crosspost-service.js` — основной сервис
- `/server/server.js` — API роуты (строки ~816-875)
- `/server/services/youtube-oauth.js` — OAuth для YouTube
- `/server/services/youtube-api.js` — YouTube API класс
- `/.env` — токены и конфигурация

## Facebook Page Info
- **Страница**: Infinity_life.kz
- **Page ID**: `105221775099742`
- **App**: daiyn inst n8n (ID: `1471279651026305`)
- **App Secret**: `64c311e252868043e25ea9cb0e17b696`
- **Разрешения**: `pages_manage_posts`, `pages_read_engagement`, `instagram_basic`, `instagram_manage_comments`

## Supabase crosspost_queue схема
| Колонка | Тип | Описание |
|---------|-----|----------|
| id | UUID | PK |
| instagram_post_id | TEXT UNIQUE | ID поста Instagram |
| media_type | TEXT | IMAGE/VIDEO/REELS/CAROUSEL_ALBUM |
| caption | TEXT | Текст поста |
| media_urls | JSONB | [{url, type}] |
| permalink | TEXT | Ссылка на Instagram |
| posted_at | TIMESTAMPTZ | Когда опубликован |
| facebook_status | TEXT | pending/posted/failed/skipped |
| facebook_post_id | TEXT | ID поста на Facebook |
| youtube_status | TEXT | pending/posted/failed/skipped |
| youtube_post_id | TEXT | ID видео на YouTube |
| vk_status | TEXT | pending/posted/failed/skipped |
| error_log | JSONB | Ошибки по платформам |
