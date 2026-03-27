function getSeverityWeight(severity) {
  if (severity === 'critical') return 0;
  if (severity === 'warning') return 1;
  return 2;
}

function byRecent(left, right) {
  const leftTime = left.updatedAt ? new Date(left.updatedAt).getTime() : 0;
  const rightTime = right.updatedAt ? new Date(right.updatedAt).getTime() : 0;
  return rightTime - leftTime;
}

export function filterIncidents(items, filters = {}) {
  return items
    .filter((item) => filters.severity === 'all' || !filters.severity || item.severity === filters.severity)
    .filter((item) => filters.source === 'all' || !filters.source || item.source === filters.source)
    .filter((item) => {
      if (filters.state === 'all' || !filters.state) {
        return true;
      }

      return item.state === filters.state;
    })
    .slice()
    .sort((left, right) => {
      if (filters.sort === 'recent') {
        return byRecent(left, right);
      }

      const severityDiff = getSeverityWeight(left.severity) - getSeverityWeight(right.severity);
      if (severityDiff !== 0) {
        return severityDiff;
      }

      return byRecent(left, right);
    });
}

export function filterLiveFeed(items, filters = {}) {
  return items
    .filter((item) => filters.channel === 'all' || !filters.channel || item.channel === filters.channel)
    .filter((item) => filters.decision === 'all' || !filters.decision || item.decision === filters.decision)
    .filter((item) => filters.status === 'all' || !filters.status || item.status === filters.status)
    .slice()
    .sort(byRecent);
}
