const test = require('node:test');
const assert = require('node:assert/strict');

const integrationAuthManager = require('../server/services/integration-auth-manager');

function withEnv(envPatch, fn) {
  const previous = {
    INSTAGRAM_PAGE_ID: process.env.INSTAGRAM_PAGE_ID,
    INSTAGRAM_DM_TOKEN: process.env.INSTAGRAM_DM_TOKEN,
    INSTAGRAM_REPLY_TOKEN: process.env.INSTAGRAM_REPLY_TOKEN
  };

  Object.entries(envPatch).forEach(([key, value]) => {
    if (value === undefined) {
      delete process.env[key];
      return;
    }

    process.env[key] = value;
  });

  try {
    return fn();
  } finally {
    Object.entries(previous).forEach(([key, value]) => {
      if (value === undefined) {
        delete process.env[key];
        return;
      }

      process.env[key] = value;
    });
  }
}

test('instagram integration requires reauth when env tokens are missing or invalid strings', () => {
  withEnv({
    INSTAGRAM_PAGE_ID: '17841448174425966',
    INSTAGRAM_DM_TOKEN: 'undefined',
    INSTAGRAM_REPLY_TOKEN: 'null'
  }, () => {
    const snapshot = integrationAuthManager.getInstagramIntegrationSnapshot({
      delivered: 0,
      failed: 5
    }, [{
      severity: 'critical',
      detail: 'Delivery failed'
    }]);

    assert.equal(snapshot.status, 'reauth_required');
    assert.equal(snapshot.tokenState.hasDmToken, false);
    assert.equal(snapshot.tokenState.hasReplyToken, false);
    assert.match(snapshot.summary, /повторная авторизация/i);
  });
});

test('instagram integration becomes degraded only when auth is healthy but delivery has issues', () => {
  withEnv({
    INSTAGRAM_PAGE_ID: '17841448174425966',
    INSTAGRAM_DM_TOKEN: 'dm-token',
    INSTAGRAM_REPLY_TOKEN: 'reply-token'
  }, () => {
    const snapshot = integrationAuthManager.getInstagramIntegrationSnapshot({
      delivered: 12,
      failed: 2
    }, [{
      severity: 'critical',
      detail: 'Ошибка доставки'
    }]);

    assert.equal(snapshot.status, 'degraded');
    assert.equal(snapshot.tokenState.hasDmToken, true);
    assert.equal(snapshot.tokenState.hasReplyToken, true);
    assert.match(snapshot.summary, /проблемы с доставкой/i);
  });
});
