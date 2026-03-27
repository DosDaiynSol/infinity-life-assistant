const { createClient } = require('@supabase/supabase-js');
const {
  appendSetCookie,
  parseCookies,
  serializeCookie
} = require('./http-cookies');

const ACCESS_COOKIE_NAME = 'infinity_access_token';
const REFRESH_COOKIE_NAME = 'infinity_refresh_token';

function normalizeUser(user) {
  if (!user) {
    return null;
  }

  return {
    id: user.id,
    email: user.email || null,
    role: user.role || 'authenticated',
    createdAt: user.created_at || null
  };
}

class AppAuthService {
  constructor(options = {}) {
    this.supabaseUrl = options.supabaseUrl || process.env.SUPABASE_URL || null;
    this.supabaseAnonKey = options.supabaseAnonKey
      || process.env.SUPABASE_ANON_KEY
      || process.env.SUPABASE_SERVICE_KEY
      || null;
    this.redirectBaseUrl = options.redirectBaseUrl
      || process.env.APP_BASE_URL
      || `http://localhost:${process.env.PORT || 3000}`;
    this.secureCookies = options.secureCookies ?? process.env.NODE_ENV === 'production';
    this.clientFactory = options.clientFactory || ((accessToken = null) => createClient(
      this.supabaseUrl,
      this.supabaseAnonKey,
      {
        auth: {
          persistSession: false,
          autoRefreshToken: false
        },
        global: accessToken
          ? {
            headers: {
              Authorization: `Bearer ${accessToken}`
            }
          }
          : undefined
      }
    ));
  }

  isConfigured() {
    return Boolean(this.supabaseUrl && this.supabaseAnonKey);
  }

  createClient(accessToken = null) {
    if (!this.isConfigured()) {
      throw new Error('APP_AUTH_NOT_CONFIGURED');
    }

    return this.clientFactory(accessToken);
  }

  parseRequestCookies(req) {
    return parseCookies(req.headers.cookie || '');
  }

  createSessionCookies(session) {
    const expiresIn = Number(session?.expires_in || 3600);
    const refreshMaxAge = 60 * 60 * 24 * 30;

    return [
      serializeCookie(ACCESS_COOKIE_NAME, session.access_token, {
        path: '/',
        httpOnly: true,
        sameSite: 'Strict',
        secure: this.secureCookies,
        maxAge: expiresIn
      }),
      serializeCookie(REFRESH_COOKIE_NAME, session.refresh_token, {
        path: '/',
        httpOnly: true,
        sameSite: 'Strict',
        secure: this.secureCookies,
        maxAge: refreshMaxAge
      })
    ];
  }

  applySessionCookies(res, session) {
    this.createSessionCookies(session).forEach((cookieValue) => appendSetCookie(res, cookieValue));
  }

  clearSessionCookies(res) {
    [ACCESS_COOKIE_NAME, REFRESH_COOKIE_NAME].forEach((cookieName) => {
      appendSetCookie(res, serializeCookie(cookieName, '', {
        path: '/',
        httpOnly: true,
        sameSite: 'Strict',
        secure: this.secureCookies,
        maxAge: 0
      }));
    });
  }

  async signInWithPassword(email, password) {
    const client = this.createClient();
    const { data, error } = await client.auth.signInWithPassword({
      email,
      password
    });

    if (error || !data?.session || !data?.user) {
      throw new Error(error?.message || 'AUTH_INVALID_CREDENTIALS');
    }

    return {
      user: normalizeUser(data.user),
      session: data.session
    };
  }

  async signUpWithPassword(email, password) {
    const client = this.createClient();
    const { data, error } = await client.auth.signUp({
      email,
      password,
      options: {
        emailRedirectTo: `${this.redirectBaseUrl}/login`
      }
    });

    if (error || !data?.user) {
      throw new Error(error?.message || 'AUTH_SIGNUP_FAILED');
    }

    return {
      user: normalizeUser(data.user),
      session: data.session || null,
      requiresEmailConfirmation: !data.session
    };
  }

  async sendResetEmail(email) {
    const client = this.createClient();
    const { error } = await client.auth.resetPasswordForEmail(email, {
      redirectTo: `${this.redirectBaseUrl}/reset-password`
    });

    if (error) {
      throw new Error(error.message || 'AUTH_RESET_FAILED');
    }

    return {
      ok: true
    };
  }

  async updatePasswordWithRecoveryTokens({ accessToken, refreshToken, password }) {
    const client = this.createClient();
    const { error: sessionError } = await client.auth.setSession({
      access_token: accessToken,
      refresh_token: refreshToken
    });

    if (sessionError) {
      throw new Error(sessionError.message || 'AUTH_RECOVERY_INVALID');
    }

    const { data, error } = await client.auth.updateUser({
      password
    });

    if (error || !data?.user) {
      throw new Error(error?.message || 'AUTH_PASSWORD_UPDATE_FAILED');
    }

    const {
      data: { session }
    } = await client.auth.getSession();

    return {
      user: normalizeUser(data.user),
      session
    };
  }

  async getUserFromAccessToken(accessToken) {
    if (!accessToken) {
      return null;
    }

    const client = this.createClient();
    const { data, error } = await client.auth.getUser(accessToken);

    if (error || !data?.user) {
      return null;
    }

    return normalizeUser(data.user);
  }

  async refreshSession(refreshToken) {
    if (!refreshToken) {
      return null;
    }

    const client = this.createClient();
    const { data, error } = await client.auth.refreshSession({
      refresh_token: refreshToken
    });

    if (error || !data?.session || !data?.user) {
      return null;
    }

    return {
      user: normalizeUser(data.user),
      session: data.session
    };
  }

  async resolveSessionFromRequest(req, res = null) {
    const cookies = this.parseRequestCookies(req);
    const accessToken = cookies[ACCESS_COOKIE_NAME];
    const refreshToken = cookies[REFRESH_COOKIE_NAME];

    const user = await this.getUserFromAccessToken(accessToken);
    if (user) {
      return {
        user,
        sessionRefreshed: false
      };
    }

    const refreshed = await this.refreshSession(refreshToken);
    if (!refreshed) {
      if (res) {
        this.clearSessionCookies(res);
      }

      return null;
    }

    if (res) {
      this.applySessionCookies(res, refreshed.session);
    }

    return {
      user: refreshed.user,
      sessionRefreshed: true
    };
  }
}

module.exports = {
  ACCESS_COOKIE_NAME,
  AppAuthService,
  REFRESH_COOKIE_NAME,
  normalizeUser
};
