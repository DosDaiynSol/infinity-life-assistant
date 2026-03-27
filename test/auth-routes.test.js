const test = require('node:test');
const assert = require('node:assert/strict');
const { createAuthRouter } = require('../server/routes/auth-routes');

function createFakeAuthService() {
  return {
    secureCookies: false,
    async signInWithPassword(email, password) {
      if (email !== 'operator@infinity-life.kz' || password !== 'very-secret') {
        throw new Error('invalid');
      }

      return {
        user: {
          id: 'user-1',
          email
        },
        session: {
          access_token: 'access-token',
          refresh_token: 'refresh-token',
          expires_in: 3600
        }
      };
    },
    async signUpWithPassword(email, password) {
      if (!email || password.length < 8) {
        throw new Error('invalid');
      }

      return {
        user: {
          id: 'user-2',
          email
        },
        session: null,
        requiresEmailConfirmation: true
      };
    },
    applySessionCookies(res) {
      res.setHeader('Set-Cookie', [
        'infinity_access_token=access-token; Path=/',
        'infinity_refresh_token=refresh-token; Path=/'
      ]);
    },
    clearSessionCookies(res) {
      res.setHeader('Set-Cookie', [
        'infinity_access_token=; Max-Age=0; Path=/',
        'infinity_refresh_token=; Max-Age=0; Path=/'
      ]);
    },
    async sendResetEmail() {
      return { ok: true };
    },
    async updatePasswordWithRecoveryTokens() {
      return {
        user: {
          id: 'user-1',
          email: 'operator@infinity-life.kz'
        },
        session: {
          access_token: 'new-access',
          refresh_token: 'new-refresh',
          expires_in: 3600
        }
      };
    },
    async resolveSessionFromRequest(req) {
      if (!String(req.headers.cookie || '').includes('infinity_access_token=access-token')) {
        return null;
      }

      return {
        user: {
          id: 'user-1',
          email: 'operator@infinity-life.kz'
        }
      };
    }
  };
}

function createRouter() {
  return createAuthRouter({
    authService: createFakeAuthService(),
    telegramNotifier: {
      isConfigured() {
        return true;
      }
    }
  });
}

function createMockResponse() {
  return {
    statusCode: 200,
    headers: {},
    body: null,
    status(code) {
      this.statusCode = code;
      return this;
    },
    setHeader(name, value) {
      this.headers[name] = value;
    },
    getHeader(name) {
      return this.headers[name];
    },
    json(payload) {
      this.body = payload;
      return this;
    }
  };
}

async function invokeRoute(router, method, path, { body = {}, headers = {} } = {}) {
  const layer = router.stack.find((entry) => entry.route?.path === path && entry.route?.methods?.[method.toLowerCase()]);
  assert.ok(layer, `Route ${method} ${path} should exist`);

  const req = {
    method: method.toUpperCase(),
    path,
    body,
    headers
  };
  const res = createMockResponse();

  await layer.route.stack[0].handle(req, res, () => {});
  return res;
}

test('auth routes support login, me, forgot-password and logout flow', async () => {
  const router = createRouter();

  const loginResponse = await invokeRoute(router, 'POST', '/login', {
    body: {
      email: 'operator@infinity-life.kz',
      password: 'very-secret'
    }
  });

  assert.equal(loginResponse.statusCode, 200);
  assert.equal(loginResponse.body.data.user.email, 'operator@infinity-life.kz');
  assert.match(loginResponse.getHeader('Set-Cookie').join('; '), /infinity_access_token=access-token/);

  const registerResponse = await invokeRoute(router, 'POST', '/register', {
    body: {
      email: 'new@infinity-life.kz',
      password: 'very-secret'
    }
  });

  assert.equal(registerResponse.statusCode, 200);
  assert.equal(registerResponse.body.data.user.email, 'new@infinity-life.kz');
  assert.equal(registerResponse.body.data.requiresEmailConfirmation, true);

  const meResponse = await invokeRoute(router, 'GET', '/me', {
    headers: {
      cookie: 'infinity_access_token=access-token'
    }
  });

  assert.equal(meResponse.statusCode, 200);
  assert.equal(meResponse.body.data.user.email, 'operator@infinity-life.kz');
  assert.equal(meResponse.body.data.telegramConfigured, true);

  const forgotResponse = await invokeRoute(router, 'POST', '/forgot-password', {
    body: {
      email: 'operator@infinity-life.kz'
    }
  });

  assert.equal(forgotResponse.statusCode, 200);
  assert.match(forgotResponse.body.data.message, /отправили/i);

  const logoutResponse = await invokeRoute(router, 'POST', '/logout');
  assert.equal(logoutResponse.statusCode, 200);
});
