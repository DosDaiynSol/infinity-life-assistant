const test = require('node:test');
const assert = require('node:assert/strict');
const {
    buildEscalationTriage,
    buildSafeFallback,
    classifyEvent
} = require('../server/services/response-policy-engine');

test('classifyEvent escalates risky direct messages', () => {
    const result = classifyEvent({
        channel: 'dm',
        text: 'После вашего приема стало хуже, хочу подать жалобу.'
    });

    assert.equal(result.decision, 'escalate');
    assert.equal(result.reasonCode, 'medical_complaint');
    assert.equal(result.riskLevel, 'critical');
});

test('classifyEvent keeps normal booking questions on auto reply', () => {
    const result = classifyEvent({
        channel: 'comment',
        text: 'Сколько стоит консультация невролога?'
    });

    assert.equal(result.decision, 'auto_reply');
    assert.equal(result.riskLevel, 'low');
});

test('buildSafeFallback and buildEscalationTriage return channel-aware templates', () => {
    const fallback = buildSafeFallback({
        channel: 'comment',
        username: 'aliya',
        isKazakh: false
    });
    const triage = buildEscalationTriage({
        channel: 'dm',
        username: 'aliya',
        isKazakh: false
    });

    assert.match(fallback, /@aliya/);
    assert.match(fallback, /87470953952/);
    assert.match(triage, /старшему администратору/i);
});
