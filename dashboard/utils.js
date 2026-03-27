(function () {
  const numberFormatter = new Intl.NumberFormat('ru-RU');
  const dateTimeFormatter = new Intl.DateTimeFormat('ru-RU', {
    day: '2-digit',
    month: 'short',
    hour: '2-digit',
    minute: '2-digit'
  });

  const statusLabels = {
    critical: 'Критично',
    warning: 'Внимание',
    healthy: 'Норма',
    neutral: 'Справка',
    pending: 'Ожидает',
    degraded: 'Сбой',
    reauth_required: 'Нужна авторизация',
    sent: 'Отправлено',
    processed: 'Обработано',
    replied: 'Есть ответ',
    failed: 'Ошибка',
    escalation: 'Эскалация',
    escalated: 'Эскалировано',
    skipped: 'Пропущено',
    merged: 'Склеено',
    auto_reply: 'Автоответ',
    safe_fallback: 'Safe fallback'
  };

  const toneLabels = {
    critical: 'Срочно',
    warning: 'Нужно внимание',
    healthy: 'Стабильно',
    neutral: 'Справка'
  };

  function formatNumber(value) {
    if (value === null || value === undefined || value === '') {
      return '-';
    }

    if (typeof value === 'string') {
      return value;
    }

    return numberFormatter.format(value);
  }

  function formatDateTime(value) {
    if (!value) {
      return 'Нет времени';
    }

    const parsed = new Date(value);
    if (Number.isNaN(parsed.getTime())) {
      return 'Некорректная дата';
    }

    return dateTimeFormatter.format(parsed);
  }

  function escapeHtml(value) {
    return String(value ?? '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }

  function toneFromStatus(status) {
    if (status === 'critical' || status === 'reauth_required' || status === 'failed' || status === 'escalation' || status === 'escalated') {
      return 'critical';
    }

    if (status === 'warning' || status === 'degraded' || status === 'pending' || status === 'safe_fallback') {
      return 'warning';
    }

    if (status === 'healthy' || status === 'sent' || status === 'processed' || status === 'merged' || status === 'auto_reply') {
      return 'healthy';
    }

    return 'neutral';
  }

  function capitalize(value) {
    if (!value) {
      return '';
    }

    return `${value.charAt(0).toUpperCase()}${value.slice(1)}`;
  }

  function getStatusLabel(status) {
    return statusLabels[status] || capitalize(String(status || '').replace(/_/g, ' '));
  }

  function getToneLabel(tone) {
    return toneLabels[tone] || capitalize(String(tone || '').replace(/_/g, ' '));
  }

  function toArray(value) {
    return Array.isArray(value) ? value : [];
  }

  window.DashboardUtils = {
    capitalize,
    escapeHtml,
    formatDateTime,
    formatNumber,
    getStatusLabel,
    getToneLabel,
    toneFromStatus,
    toArray
  };
})();
