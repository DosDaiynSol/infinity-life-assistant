const test = require('node:test');
const assert = require('node:assert/strict');

const {
    createDashboardIncident,
    buildCommandCenterOverviewPayload,
    buildCommandCenterIncidentsPayload,
    parseIncidentResolutionInput
} = require('../server/dashboard/contracts');

test('buildCommandCenterOverviewPayload returns command-center sections and preserves key metrics', () => {
    const integrations = [
        {
            id: 'instagram_meta',
            name: 'Instagram',
            provider: 'Meta',
            status: 'healthy',
            summary: 'Realtime replies active',
            lastCheckedAt: '2026-03-27T08:10:00.000Z',
            lastError: null,
            actions: ['reauthorize']
        },
        {
            id: 'google_business',
            name: 'Google Business',
            provider: 'Google',
            status: 'reauth_required',
            summary: 'Refresh token missing',
            lastCheckedAt: '2026-03-27T08:11:00.000Z',
            lastError: 'Refresh token missing',
            actions: ['reauthorize']
        }
    ];

    const incidents = [
        createDashboardIncident({
            id: 'inc_1',
            severity: 'critical',
            source: 'Instagram',
            service: 'instagram',
            title: 'Risky DM requires operator review',
            detail: 'Пациент жалуется на ухудшение после процедуры.',
            state: 'open',
            openedAt: '2026-03-27T07:55:00.000Z',
            updatedAt: '2026-03-27T08:00:00.000Z',
            count: 2,
            reasonCode: 'medical_risk',
            meta: { channel: 'dm', username: 'aliya' },
            recommendedAction: { kind: 'resolve', label: 'Resolve incident' },
            actions: [{ kind: 'resolve', label: 'Resolve incident' }]
        }),
        createDashboardIncident({
            id: 'google_business-reauth',
            severity: 'critical',
            source: 'Google Business',
            service: 'google_business',
            title: 'Google Business needs reauthorization',
            detail: 'Refresh token missing',
            state: 'open',
            openedAt: '2026-03-27T08:01:00.000Z',
            updatedAt: '2026-03-27T08:01:00.000Z',
            count: 1,
            reasonCode: 'google_business_reauth_required',
            meta: {},
            recommendedAction: {
                kind: 'reauthorize',
                label: 'Reauthorize',
                service: 'google_business'
            },
            actions: [{
                kind: 'reauthorize',
                label: 'Reauthorize',
                service: 'google_business'
            }]
        })
    ];

    const payload = buildCommandCenterOverviewPayload({
        instagramRealtime: {
            metrics: {
                inbound: 12,
                delivered: 10,
                failed: 1,
                escalations: 1,
                autoReplies: 7,
                safeFallbacks: 1,
                p95ReplySeconds: 4.6
            },
            liveFeed: [
                {
                    id: 'evt_1',
                    source: 'Instagram DM',
                    channel: 'dm',
                    title: 'DM @aliya',
                    text: 'Мне стало хуже',
                    responseText: 'Передали старшему администратору.',
                    status: 'escalated',
                    decision: 'escalate',
                    incidentId: 'inc_1',
                    updatedAt: '2026-03-27T08:00:00.000Z',
                    latencySeconds: 3.2
                }
            ]
        },
        youtube: {
            authorized: true,
            stats: {
                totalResponses: 3,
                totalComments: 8,
                processedVideos: 2
            },
            history: []
        },
        google: {
            stats: {
                totalReplied: 5,
                pendingReviews: 2,
                escalationReviews: 1,
                totalReviews: 10
            },
            reviews: [],
            reviewsError: null
        },
        threads: {
            stats: {
                replied: 4,
                validated: 1,
                postsFound: 6
            },
            posts: []
        },
        integrations,
        incidents
    });

    assert.ok(payload.generatedAt);
    assert.equal(payload.summary.openIncidents, 2);
    assert.equal(payload.summary.responsesDelivered, 22);
    assert.equal(payload.summary.healthyIntegrations, 1);
    assert.equal(payload.summary.totalIntegrations, 2);
    assert.equal(payload.triage.items.length, 2);
    assert.equal(payload.liveFeed.items.length, 1);
    assert.equal(payload.channelHealth.items.length, 4);
    assert.equal(payload.integrationHealth.items.length, 2);
    assert.equal(payload.summary.cards.length, 4);
});

test('buildCommandCenterIncidentsPayload preserves lifecycle fields and recommended actions', () => {
    const incidents = [
        createDashboardIncident({
            id: 'inc_2',
            severity: 'warning',
            source: 'Instagram',
            service: 'instagram',
            title: 'Fallback reply was used',
            detail: 'LLM timed out, safe fallback sent.',
            state: 'open',
            openedAt: '2026-03-27T08:05:00.000Z',
            updatedAt: '2026-03-27T08:06:00.000Z',
            count: 3,
            reasonCode: 'dm_generation_timeout',
            meta: { channel: 'dm' },
            recommendedAction: { kind: 'resolve', label: 'Resolve incident' },
            actions: [{ kind: 'resolve', label: 'Resolve incident' }]
        })
    ];

    const payload = buildCommandCenterIncidentsPayload(incidents);

    assert.equal(payload.summary.total, 1);
    assert.equal(payload.summary.open, 1);
    assert.equal(payload.items[0].state, 'open');
    assert.equal(payload.items[0].count, 3);
    assert.equal(payload.items[0].service, 'instagram');
    assert.equal(payload.items[0].reasonCode, 'dm_generation_timeout');
    assert.deepEqual(payload.items[0].meta, { channel: 'dm' });
    assert.deepEqual(payload.items[0].recommendedAction, {
        kind: 'resolve',
        label: 'Resolve incident',
        service: null,
        page: null,
        itemId: null
    });
});

test('parseIncidentResolutionInput validates optional resolution detail', () => {
    assert.deepEqual(parseIncidentResolutionInput({}), {
        resolutionDetail: null
    });

    assert.deepEqual(parseIncidentResolutionInput({
        resolutionDetail: 'Оператор связался с пациентом.'
    }), {
        resolutionDetail: 'Оператор связался с пациентом.'
    });

    assert.throws(() => parseIncidentResolutionInput({
        resolutionDetail: 42
    }), /resolutionDetail/i);

    assert.throws(() => parseIncidentResolutionInput({
        resolutionDetail: 'x'.repeat(1001)
    }), /resolutionDetail/i);
});
