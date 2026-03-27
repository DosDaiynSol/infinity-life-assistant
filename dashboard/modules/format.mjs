const numberFormatter = new Intl.NumberFormat('ru-RU');
const dateTimeFormatter = new Intl.DateTimeFormat('ru-RU', {
  day: '2-digit',
  month: 'short',
  hour: '2-digit',
  minute: '2-digit'
});

const statusLabels = Object.freeze({
  critical: 'Критично',
  warning: 'Внимание',
  healthy: 'Норма',
  neutral: 'Нейтрально',
  open: 'Открыто',
  resolved: 'Закрыто',
  pending: 'Ожидает',
  degraded: 'Ограничено',
  reauth_required: 'Требуется авторизация',
  sent: 'Отправлено',
  processed: 'Обработано',
  replied: 'Отвечено',
  failed: 'Ошибка',
  escalation: 'Эскалация',
  escalated: 'Требует внимания',
  skipped: 'Закрыто',
  merged: 'Объединено',
  auto_reply: 'Автоответ',
  safe_fallback: 'Безопасный ответ',
  new: 'Новое',
  ai_processed: 'Обработано ИИ',
  needs_attention: 'Требует внимания',
  closed: 'Закрыто',
  error: 'Ошибка',
  tracking: 'В SLA',
  breached: 'SLA нарушен',
  not_applicable: 'Без SLA',
  list: 'Список',
  grouped: 'По пользователям'
});

export function formatNumber(value) {
  if (value === null || value === undefined || value === '') {
    return '-';
  }

  if (typeof value === 'string') {
    return value;
  }

  return numberFormatter.format(value);
}

export function formatDateTime(value) {
  if (!value) {
    return 'Нет данных';
  }

  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) {
    return 'Неверная дата';
  }

  return dateTimeFormatter.format(parsed);
}

export function formatLatency(seconds) {
  if (seconds === null || seconds === undefined) {
    return 'n/a';
  }

  return `${Number(seconds).toFixed(1)}с`;
}

export function escapeHtml(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

export function capitalize(value) {
  if (!value) {
    return '';
  }

  return `${value.charAt(0).toUpperCase()}${value.slice(1)}`;
}

export function getStatusLabel(status) {
  return statusLabels[status] || capitalize(String(status || '').replace(/_/g, ' '));
}

export function toneFromStatus(status) {
  if (['critical', 'reauth_required', 'failed', 'escalation', 'escalated', 'error', 'breached'].includes(status)) {
    return 'critical';
  }

  if (['warning', 'degraded', 'pending', 'safe_fallback', 'open', 'needs_attention', 'tracking'].includes(status)) {
    return 'warning';
  }

  if (['healthy', 'sent', 'processed', 'merged', 'auto_reply', 'resolved', 'ai_processed', 'closed'].includes(status)) {
    return 'healthy';
  }

  return 'neutral';
}

export function truncate(value, maxLength = 140) {
  if (!value) {
    return '';
  }

  if (value.length <= maxLength) {
    return value;
  }

  return `${value.slice(0, maxLength - 1).trimEnd()}...`;
}

export function toArray(value) {
  return Array.isArray(value) ? value : [];
}
