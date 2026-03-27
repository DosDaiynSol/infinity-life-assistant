function normalizeOptionalEnv(value) {
  if (value === null || value === undefined) {
    return null;
  }

  const normalized = String(value).trim();
  if (!normalized) {
    return null;
  }

  const invalidValues = new Set(['undefined', 'null', 'false', '0']);
  if (invalidValues.has(normalized.toLowerCase())) {
    return null;
  }

  return normalized;
}

module.exports = {
  normalizeOptionalEnv
};
