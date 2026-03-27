const DEFAULT_PATH = '/';

function parseCookies(header = '') {
  return String(header || '')
    .split(';')
    .map((chunk) => chunk.trim())
    .filter(Boolean)
    .reduce((cookies, pair) => {
      const separatorIndex = pair.indexOf('=');
      if (separatorIndex === -1) {
        return cookies;
      }

      const key = decodeURIComponent(pair.slice(0, separatorIndex).trim());
      const value = decodeURIComponent(pair.slice(separatorIndex + 1).trim());

      return {
        ...cookies,
        [key]: value
      };
    }, {});
}

function serializeCookie(name, value, options = {}) {
  const parts = [`${encodeURIComponent(name)}=${encodeURIComponent(value ?? '')}`];

  if (options.maxAge !== undefined) {
    parts.push(`Max-Age=${Math.max(0, Math.floor(options.maxAge))}`);
  }

  if (options.expires instanceof Date) {
    parts.push(`Expires=${options.expires.toUTCString()}`);
  }

  parts.push(`Path=${options.path || DEFAULT_PATH}`);

  if (options.domain) {
    parts.push(`Domain=${options.domain}`);
  }

  if (options.httpOnly) {
    parts.push('HttpOnly');
  }

  if (options.secure) {
    parts.push('Secure');
  }

  if (options.sameSite) {
    parts.push(`SameSite=${options.sameSite}`);
  }

  return parts.join('; ');
}

function appendSetCookie(res, cookieValue) {
  const current = res.getHeader('Set-Cookie');
  if (!current) {
    res.setHeader('Set-Cookie', [cookieValue]);
    return;
  }

  const values = Array.isArray(current) ? current.slice() : [current];
  values.push(cookieValue);
  res.setHeader('Set-Cookie', values);
}

module.exports = {
  appendSetCookie,
  parseCookies,
  serializeCookie
};
