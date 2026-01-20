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
Authorization: Bearer IGAAMQuAPDdYVBZAGJDcEFoY0Mzbm1UY2ZALeFFvbTNGY2RSeDdKaWItSzRnZADJBREJlSmtXMFlCZAXZAlVHFqRmUxelZA4QjI2Y09HMDJoSVVRa0tGYTdIbWlZAQ0NvMkhoalBaMTNWcDVacExodlFrVVQwYzdJMUV6VjREWVdJMFNYSQZDZD
Content-Type: application/json

{
  "recipient": { "id": "USER_ID" },
  "message": { "text": "Ваше сообщение" }
}
```

### Reply to Comment
```http
POST https://graph.facebook.com/v21.0/{comment_id}/replies
Authorization: Bearer EAAU6Hvz29YEBQcmVm3A0v0DBEmwL29FgDS8DX2XrR5S3lyI17DsfGKdAPaDZCIszX3Hnbl49wHnuSn8ZA30Gngf5TuAmnuZCZBZAagkM06MU5jWN7VhO0jPaQZAl5yUlXZCfqQFJ0DhOyhTTofKAkXjPOQOXfsdIIz0D1FxVLokfA8X2xULAvvbqIc8cKJKZAWittsRaV8ak7qGit7EW
Content-Type: application/json

{
  "message": "@username Ваш ответ"
}
```

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
