const test = require('node:test');
const assert = require('node:assert/strict');

const { parseCookies, serializeCookie } = require('../server/services/http-cookies');
const { validateCsrfRequest } = require('../server/services/csrf-protection');
const { applySlaState, buildSlaDeadline } = require('../server/services/sla-policy');

test('cookie helpers parse and serialize auth cookies', () => {
  const cookie = serializeCookie('session', 'token-123', {
    path: '/',
    httpOnly: true,
    sameSite: 'Strict',
    maxAge: 3600
  });

  assert.match(cookie, /session=token-123/);
  assert.match(cookie, /HttpOnly/);
  assert.match(cookie, /SameSite=Strict/);

  const parsed = parseCookies('foo=bar; session=token-123');
  assert.equal(parsed.foo, 'bar');
  assert.equal(parsed.session, 'token-123');
});

test('csrf validation requires matching cookie and header tokens', () => {
  const req = {
    headers: {
      cookie: 'infinity_csrf=csrf-token-1',
      'x-csrf-token': 'csrf-token-1'
    }
  };

  assert.equal(validateCsrfRequest(req), true);
  assert.equal(validateCsrfRequest({
    headers: {
      cookie: 'infinity_csrf=csrf-token-1',
      'x-csrf-token': 'different'
    }
  }), false);
});

test('sla policy tracks and escalates overdue new interactions', () => {
  const receivedAt = '2026-03-27T09:00:00.000Z';
  const deadline = buildSlaDeadline(receivedAt, 30);
  const tracked = applySlaState({
    id: 'evt_1',
    status: 'new',
    receivedAt
  }, new Date('2026-03-27T09:15:00.000Z'));
  const breached = applySlaState({
    id: 'evt_1',
    status: 'new',
    receivedAt,
    slaDeadlineAt: deadline
  }, new Date('2026-03-27T09:45:00.000Z'));

  assert.equal(tracked.slaState, 'tracking');
  assert.equal(tracked.slaBreached, false);
  assert.equal(breached.slaState, 'breached');
  assert.equal(breached.slaBreached, true);
});
