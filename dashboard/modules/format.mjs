const numberFormatter = new Intl.NumberFormat('ru-RU');
const dateTimeFormatter = new Intl.DateTimeFormat('ru-RU', {
  day: '2-digit',
  month: 'short',
  hour: '2-digit',
  minute: '2-digit'
});

const statusLabels = Object.freeze({
  critical: 'Critical',
  warning: 'Warning',
  healthy: 'Healthy',
  neutral: 'Neutral',
  open: 'Open',
  resolved: 'Resolved',
  pending: 'Pending',
  degraded: 'Degraded',
  reauth_required: 'Reauth required',
  sent: 'Sent',
  processed: 'Processed',
  replied: 'Replied',
  failed: 'Failed',
  escalation: 'Escalation',
  escalated: 'Escalated',
  skipped: 'Skipped',
  merged: 'Merged',
  auto_reply: 'Auto reply',
  safe_fallback: 'Safe fallback'
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
    return 'No timestamp';
  }

  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) {
    return 'Invalid date';
  }

  return dateTimeFormatter.format(parsed);
}

export function formatLatency(seconds) {
  if (seconds === null || seconds === undefined) {
    return 'n/a';
  }

  return `${Number(seconds).toFixed(1)}s`;
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
  if (['critical', 'reauth_required', 'failed', 'escalation', 'escalated'].includes(status)) {
    return 'critical';
  }

  if (['warning', 'degraded', 'pending', 'safe_fallback', 'open'].includes(status)) {
    return 'warning';
  }

  if (['healthy', 'sent', 'processed', 'merged', 'auto_reply', 'resolved'].includes(status)) {
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
