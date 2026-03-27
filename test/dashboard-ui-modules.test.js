const path = require('path');
const test = require('node:test');
const assert = require('node:assert/strict');
const { pathToFileURL } = require('node:url');

async function importModule(relativePath) {
    const fileUrl = pathToFileURL(path.join(__dirname, '..', relativePath));
    return import(fileUrl.href);
}

test('dashboard state reducer tracks page loading, drawer state, and immutable filters', async () => {
    const { createInitialState, reduceState } = await importModule('dashboard/modules/state.mjs');

    const initial = createInitialState();
    const loading = reduceState(initial, {
        type: 'LOAD_PAGE_START',
        page: 'overview'
    });
    const loaded = reduceState(loading, {
        type: 'LOAD_PAGE_SUCCESS',
        page: 'overview',
        payload: { generatedAt: '2026-03-27T09:00:00.000Z' },
        receivedAt: '2026-03-27T09:00:00.000Z'
    });
    const filtered = reduceState(loaded, {
        type: 'SET_FILTER',
        page: 'incidents',
        key: 'severity',
        value: 'critical'
    });
    const withDrawer = reduceState(filtered, {
        type: 'OPEN_DRAWER',
        page: 'incidents',
        itemId: 'inc_1'
    });
    const withoutDrawer = reduceState(withDrawer, {
        type: 'CLOSE_DRAWER'
    });

    assert.equal(initial.loadingPage, null);
    assert.equal(loading.loadingPage, 'overview');
    assert.equal(loaded.pages.overview.generatedAt, '2026-03-27T09:00:00.000Z');
    assert.equal(loaded.lastSync, '2026-03-27T09:00:00.000Z');
    assert.equal(filtered.filtersByPage.incidents.severity, 'critical');
    assert.equal(initial.filtersByPage.incidents.severity, 'all');
    assert.equal(withDrawer.drawer.open, true);
    assert.equal(withDrawer.drawer.itemId, 'inc_1');
    assert.equal(withoutDrawer.drawer.open, false);
});

test('dashboard filters narrow incidents and live feed collections', async () => {
    const { filterIncidents, filterLiveFeed } = await importModule('dashboard/modules/filters.mjs');

    const incidents = [
        { id: 'inc_1', severity: 'critical', source: 'Instagram DM', state: 'open', updatedAt: '2026-03-27T09:02:00.000Z' },
        { id: 'inc_2', severity: 'warning', source: 'Google Reviews', state: 'open', updatedAt: '2026-03-27T08:59:00.000Z' },
        { id: 'inc_3', severity: 'warning', source: 'Instagram DM', state: 'resolved', updatedAt: '2026-03-27T08:50:00.000Z' }
    ];

    const feedItems = [
        { id: 'evt_1', channel: 'dm', decision: 'escalate', status: 'escalated', updatedAt: '2026-03-27T09:01:00.000Z' },
        { id: 'evt_2', channel: 'comment', decision: 'auto_reply', status: 'sent', updatedAt: '2026-03-27T08:55:00.000Z' }
    ];

    const filteredIncidents = filterIncidents(incidents, {
        severity: 'warning',
        source: 'all',
        state: 'open',
        sort: 'recent'
    });
    const filteredFeed = filterLiveFeed(feedItems, {
        channel: 'dm',
        decision: 'escalate',
        status: 'all'
    });

    assert.deepEqual(filteredIncidents.map((item) => item.id), ['inc_2']);
    assert.deepEqual(filteredFeed.map((item) => item.id), ['evt_1']);
});

test('drawer model resolves incident and live-feed details from page payloads', async () => {
    const { buildDrawerModel } = await importModule('dashboard/modules/drawer.mjs');

    const pages = {
        overview: {
            triage: {
                items: [
                    {
                        id: 'inc_1',
                        title: 'Risky DM requires operator review',
                        detail: 'Patient complaint',
                        actions: [{ kind: 'resolve', label: 'Resolve incident', service: null, page: null, itemId: null }]
                    }
                ]
            },
            liveFeed: {
                items: [
                    {
                        id: 'evt_1',
                        title: 'DM @aliya',
                        text: 'Мне стало хуже',
                        responseText: 'Передали оператору'
                    }
                ]
            }
        },
        incidents: {
            items: [
                {
                    id: 'inc_1',
                    title: 'Risky DM requires operator review',
                    detail: 'Patient complaint',
                    actions: [{ kind: 'resolve', label: 'Resolve incident', service: null, page: null, itemId: null }]
                }
            ]
        },
        'live-feed': {
            items: [
                {
                    id: 'evt_1',
                    title: 'DM @aliya',
                    text: 'Мне стало хуже',
                    responseText: 'Передали оператору'
                }
            ]
        }
    };

    const incidentDrawer = buildDrawerModel(pages, { page: 'incidents', itemId: 'inc_1' });
    const feedDrawer = buildDrawerModel(pages, { page: 'live-feed', itemId: 'evt_1' });

    assert.equal(incidentDrawer.kind, 'incident');
    assert.equal(incidentDrawer.item.id, 'inc_1');
    assert.equal(feedDrawer.kind, 'live-feed');
    assert.equal(feedDrawer.item.id, 'evt_1');
});
