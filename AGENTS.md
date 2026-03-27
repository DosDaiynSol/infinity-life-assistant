# AGENTS.md - Instagram Assistant для INFINITY LIFE

## Описание проекта

Система автоматического мониторинга и ответа на Direct Messages и комментарии в Instagram аккаунта клиники INFINITY LIFE (@infinity_life.kz).

## Архитектура

```
                   ┌─────────────────────────────────┐
                   │   Instagram Webhook (n8n)       │
                   │   n8n.daiynsolutions.com        │
                   └───────────────┬─────────────────┘
                                   │
                                   ▼
┌──────────────────────────────────────────────────────────────────┐
│                      Backend Server (Node.js)                     │
├──────────────────────────────────────────────────────────────────┤
│  • POST /webhook - прием входящих сообщений                      │
│  • Парсинг Direct Messages                                        │
│  • Парсинг комментариев                                          │
│  • AI генерация ответов                                          │
│  • Отправка ответов через Instagram Graph API                   │
└────────────────────────────┬─────────────────────────────────────┘
                             │
              ┌──────────────┴──────────────┐
              ▼                              ▼
┌─────────────────────────┐    ┌─────────────────────────────────┐
│    Dashboard            │    │     Instagram Graph API          │
│    (мониторинг)         │    ├─────────────────────────────────┤
├─────────────────────────┤    │ Send DM:                        │
│ • Статистика            │    │   POST graph.instagram.com/     │
│ • История сообщений     │    │        v24.0/{page_id}/messages │
│ • Логи ответов          │    │ Reply Comment:                  │
└─────────────────────────┘    │   POST graph.facebook.com/      │
                               │        v21.0/{comment_id}/replies│
                               └─────────────────────────────────┘
```

## Структура файлов

```
/infinity life assistant
├── AGENTS.md              # Этот файл
├── /data
│   └── clinic_data.json   # База знаний о клинике
├── /server
│   ├── server.js          # Express сервер
│   ├── /handlers
│   │   └── instagram.js   # Обработчики вебхуков
│   └── /services
│       └── ai-responder.js # AI генерация ответов
└── /dashboard
    ├── index.html         # Веб-интерфейс
    ├── styles.css         # Стили
    └── app.js             # Клиентская логика
```

## API Конфигурация

### Instagram Page ID
- `17841448174425966`

### Send Direct Message
```http
POST https://graph.instagram.com/v24.0/17841448174425966/messages
Authorization: Bearer <INSTAGRAM_ACCESS_TOKEN_FROM_ENV_OR_SECURE_STORE>
Content-Type: application/json

{
  "recipient": { "id": "USER_ID" },
  "message": { "text": "Ваше сообщение" }
}
```

### Reply to Comment
```http
POST https://graph.facebook.com/v21.0/{comment_id}/replies
Authorization: Bearer <FACEBOOK_PAGE_OR_USER_TOKEN_FROM_ENV_OR_SECURE_STORE>
Content-Type: application/json

{
  "message": "@username Ваш ответ"
}
```

> Важно: рабочие bearer-токены не должны храниться в репозитории. Используйте `.env`, Supabase `oauth_tokens` или другой secure store, а все ранее зафиксированные значения считайте скомпрометированными и подлежащими ротации.

## Формат вебхуков

### Direct Message
```json
{
  "object": "instagram",
  "entry": [{
    "messaging": [{
      "sender": { "id": "sender_id" },
      "message": { "mid": "...", "text": "текст сообщения" }
    }]
  }]
}
```

### Comment
```json
{
  "object": "instagram",
  "entry": [{
    "changes": [{
      "value": {
        "from": { "id": "...", "username": "..." },
        "id": "comment_id",
        "text": "текст комментария"
      },
      "field": "comments"
    }]
  }]
}
```

## Стиль ответов

При ответе на комментарии использовать формат:
> @username добрый вечер. Приглашаем вас на осмотр и консультацию. Записаться можно по номеру 87470953952

## Контакты клиники

- **Телефон**: 87470953952
- **Сайт**: https://infinity-life.kz
- **Instagram**: @infinity_life.kz
- **Филиалы**: 4 отделения в Астане
