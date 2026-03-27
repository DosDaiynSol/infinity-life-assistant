const crypto = require('crypto');
const {
  appendSetCookie,
  parseCookies,
  serializeCookie
} = require('./http-cookies');

const CSRF_COOKIE_NAME = 'infinity_csrf';

function createCsrfToken() {
  return crypto.randomBytes(24).toString('hex');
}

function ensureCsrfCookie(req, res, options = {}) {
  const cookies = parseCookies(req.headers.cookie || '');
  const existing = cookies[CSRF_COOKIE_NAME];
  if (existing) {
    return existing;
  }

  const token = createCsrfToken();
  appendSetCookie(res, serializeCookie(CSRF_COOKIE_NAME, token, {
    path: '/',
    httpOnly: false,
    sameSite: 'Strict',
    secure: options.secure ?? process.env.NODE_ENV === 'production',
    maxAge: 60 * 60 * 24 * 30
  }));

  return token;
}

function clearCsrfCookie(res, options = {}) {
  appendSetCookie(res, serializeCookie(CSRF_COOKIE_NAME, '', {
    path: '/',
    httpOnly: false,
    sameSite: 'Strict',
    secure: options.secure ?? process.env.NODE_ENV === 'production',
    maxAge: 0
  }));
}

function tokensMatch(left, right) {
  if (!left || !right) {
    return false;
  }

  const leftBuffer = Buffer.from(String(left));
  const rightBuffer = Buffer.from(String(right));

  if (leftBuffer.length !== rightBuffer.length) {
    return false;
  }

  return crypto.timingSafeEqual(leftBuffer, rightBuffer);
}

function validateCsrfRequest(req) {
  const cookies = parseCookies(req.headers.cookie || '');
  const cookieToken = cookies[CSRF_COOKIE_NAME];
  const headerToken = req.headers['x-csrf-token'];

  return tokensMatch(cookieToken, headerToken);
}

function createRequireCsrfMiddleware() {
  return function requireCsrf(req, res, next) {
    if (['GET', 'HEAD', 'OPTIONS'].includes(req.method)) {
      next();
      return;
    }

    if (validateCsrfRequest(req)) {
      next();
      return;
    }

    res.status(403).json({
      error: 'Недействительный CSRF-токен'
    });
  };
}

module.exports = {
  CSRF_COOKIE_NAME,
  clearCsrfCookie,
  createCsrfToken,
  createRequireCsrfMiddleware,
  ensureCsrfCookie,
  validateCsrfRequest
};
