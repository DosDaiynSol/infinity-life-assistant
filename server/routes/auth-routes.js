const express = require('express');
const {
  clearCsrfCookie,
  ensureCsrfCookie
} = require('../services/csrf-protection');

function validateEmail(value) {
  return typeof value === 'string' && /\S+@\S+\.\S+/.test(value);
}

function createAuthRouter({ authService, telegramNotifier }) {
  const router = express.Router();

  router.post('/login', async (req, res) => {
    const email = typeof req.body?.email === 'string' ? req.body.email.trim() : '';
    const password = typeof req.body?.password === 'string' ? req.body.password : '';

    if (!validateEmail(email) || password.length < 8) {
      return res.status(400).json({
        error: 'Проверьте email и пароль'
      });
    }

    try {
      const result = await authService.signInWithPassword(email, password);
      authService.applySessionCookies(res, result.session);
      const csrfToken = ensureCsrfCookie(req, res, {
        secure: authService.secureCookies
      });

      return res.json({
        data: {
          user: result.user,
          csrfToken,
          telegramConfigured: Boolean(telegramNotifier?.isConfigured?.())
        }
      });
    } catch (error) {
      return res.status(401).json({
        error: 'Неверный email или пароль'
      });
    }
  });

  router.post('/register', async (req, res) => {
    const email = typeof req.body?.email === 'string' ? req.body.email.trim() : '';
    const password = typeof req.body?.password === 'string' ? req.body.password : '';

    if (!validateEmail(email) || password.length < 8) {
      return res.status(400).json({
        error: 'Проверьте email и пароль'
      });
    }

    try {
      const result = await authService.signUpWithPassword(email, password);

      if (result.session) {
        authService.applySessionCookies(res, result.session);
      }

      const csrfToken = ensureCsrfCookie(req, res, {
        secure: authService.secureCookies
      });

      return res.json({
        data: {
          user: result.user,
          csrfToken,
          requiresEmailConfirmation: result.requiresEmailConfirmation,
          message: result.requiresEmailConfirmation
            ? 'Проверьте почту и подтвердите регистрацию.'
            : 'Регистрация завершена.'
        }
      });
    } catch (error) {
      return res.status(400).json({
        error: 'Не удалось зарегистрировать пользователя'
      });
    }
  });

  router.post('/forgot-password', async (req, res) => {
    const email = typeof req.body?.email === 'string' ? req.body.email.trim() : '';

    if (validateEmail(email)) {
      try {
        await authService.sendResetEmail(email);
      } catch (error) {
        console.error('[Auth] Forgot password error:', error.message);
      }
    }

    return res.json({
      data: {
        message: 'Если такой email существует, мы отправили инструкцию для сброса пароля.'
      }
    });
  });

  router.post('/reset-password', async (req, res) => {
    const accessToken = typeof req.body?.accessToken === 'string' ? req.body.accessToken.trim() : '';
    const refreshToken = typeof req.body?.refreshToken === 'string' ? req.body.refreshToken.trim() : '';
    const password = typeof req.body?.password === 'string' ? req.body.password : '';

    if (!accessToken || !refreshToken || password.length < 8) {
      return res.status(400).json({
        error: 'Недостаточно данных для смены пароля'
      });
    }

    try {
      const result = await authService.updatePasswordWithRecoveryTokens({
        accessToken,
        refreshToken,
        password
      });

      if (result.session) {
        authService.applySessionCookies(res, result.session);
      }

      const csrfToken = ensureCsrfCookie(req, res, {
        secure: authService.secureCookies
      });

      return res.json({
        data: {
          user: result.user,
          csrfToken
        }
      });
    } catch (error) {
      return res.status(400).json({
        error: 'Не удалось обновить пароль'
      });
    }
  });

  router.get('/me', async (req, res) => {
    try {
      const session = await authService.resolveSessionFromRequest(req, res);
      if (!session?.user) {
        return res.status(401).json({
          error: 'Требуется авторизация'
        });
      }

      const csrfToken = ensureCsrfCookie(req, res, {
        secure: authService.secureCookies
      });

      return res.json({
        data: {
          user: session.user,
          csrfToken,
          telegramConfigured: Boolean(telegramNotifier?.isConfigured?.())
        }
      });
    } catch (error) {
      return res.status(500).json({
        error: 'Не удалось проверить сессию'
      });
    }
  });

  router.post('/logout', async (req, res) => {
    authService.clearSessionCookies(res);
    clearCsrfCookie(res, {
      secure: authService.secureCookies
    });

    return res.json({
      data: {
        ok: true
      }
    });
  });

  return router;
}

function createRequireAppSessionApi({ authService }) {
  return async function requireAppSessionApi(req, res, next) {
    try {
      const session = await authService.resolveSessionFromRequest(req, res);
      if (!session?.user) {
        return res.status(401).json({
          error: 'Требуется авторизация'
        });
      }

      req.appUser = session.user;
      return next();
    } catch (error) {
      return res.status(401).json({
        error: 'Требуется авторизация'
      });
    }
  };
}

function createRequireAppSessionPage({ authService }) {
  return async function requireAppSessionPage(req, res, next) {
    try {
      const session = await authService.resolveSessionFromRequest(req, res);
      if (!session?.user) {
        return res.redirect('/login');
      }

      req.appUser = session.user;
      return next();
    } catch (error) {
      return res.redirect('/login');
    }
  };
}

module.exports = {
  createAuthRouter,
  createRequireAppSessionApi,
  createRequireAppSessionPage
};
