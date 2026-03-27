const os = require('os');
const path = require('path');
const test = require('node:test');
const assert = require('node:assert/strict');
const InteractionEventStore = require('../server/services/interaction-event-store');

function makeStore() {
    return new InteractionEventStore({
        filePath: path.join(os.tmpdir(), `interaction-events-${Date.now()}-${Math.random()}.json`)
    });
}

test('recordInboundEvent deduplicates by dedupe key', async () => {
    const store = makeStore();

    const first = await store.recordInboundEvent({
        platform: 'instagram',
        channel: 'dm',
        externalId: 'mid-1',
        conversationId: 'user-1',
        actorId: 'user-1',
        text: 'Привет',
        dedupeKey: 'instagram:dm:mid-1',
        receivedAt: new Date().toISOString()
    });

    const second = await store.recordInboundEvent({
        platform: 'instagram',
        channel: 'dm',
        externalId: 'mid-1',
        conversationId: 'user-1',
        actorId: 'user-1',
        text: 'Привет',
        dedupeKey: 'instagram:dm:mid-1',
        receivedAt: new Date().toISOString()
    });

    const events = await store.listEvents();

    assert.equal(first.isDuplicate, false);
    assert.equal(second.isDuplicate, true);
    assert.equal(events.length, 1);
});

test('appendStage updates status and activity trail', async () => {
    const store = makeStore();
    const created = await store.recordInboundEvent({
        platform: 'instagram',
        channel: 'comment',
        externalId: 'comment-1',
        conversationId: 'media-1',
        actorId: 'user-2',
        actorUsername: 'aliya',
        text: 'Есть МРТ?',
        dedupeKey: 'instagram:comment:comment-1',
        receivedAt: new Date().toISOString()
    });

    const updated = await store.appendStage(created.event.id, 'sent', 'Reply delivered', {
        status: 'sent',
        deliveryStatus: 'sent',
        processedAt: new Date().toISOString()
    });

    assert.equal(updated.status, 'sent');
    assert.equal(updated.deliveryStatus, 'sent');
    assert.equal(updated.stages.at(-1).name, 'sent');
});
