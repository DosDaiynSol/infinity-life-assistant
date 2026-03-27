function buildSlaDeadline(receivedAt, minutes = 30) {
  const timestamp = new Date(receivedAt).getTime();
  if (!Number.isFinite(timestamp)) {
    return null;
  }

  return new Date(timestamp + (minutes * 60 * 1000)).toISOString();
}

function isTrackableStatus(status) {
  return ['new', 'needs_attention'].includes(status);
}

function isSlaBreached({ status, receivedAt, slaDeadlineAt }, now = new Date()) {
  if (!isTrackableStatus(status)) {
    return false;
  }

  const deadline = new Date(slaDeadlineAt || buildSlaDeadline(receivedAt)).getTime();
  const current = now instanceof Date ? now.getTime() : new Date(now).getTime();

  if (!Number.isFinite(deadline) || !Number.isFinite(current)) {
    return false;
  }

  return current >= deadline;
}

function applySlaState(item, now = new Date()) {
  const slaDeadlineAt = item.slaDeadlineAt || buildSlaDeadline(item.receivedAt);
  const breached = isSlaBreached({
    status: item.status,
    receivedAt: item.receivedAt,
    slaDeadlineAt
  }, now);

  return {
    ...item,
    slaDeadlineAt,
    slaState: isTrackableStatus(item.status)
      ? (breached ? 'breached' : 'tracking')
      : 'not_applicable',
    slaBreached: breached
  };
}

module.exports = {
  applySlaState,
  buildSlaDeadline,
  isSlaBreached,
  isTrackableStatus
};
