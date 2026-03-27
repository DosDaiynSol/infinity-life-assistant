const os = require('os');
const path = require('path');
const test = require('node:test');
const assert = require('node:assert/strict');

const IncidentManager = require('../server/services/incident-manager');

function createManager() {
    return new IncidentManager({
        filePath: path.join(os.tmpdir(), `incident-manager-${Date.now()}-${Math.random()}.json`),
        notifier: {
            sendIncidentAlert: async () => ({ sent: false })
        }
    });
}

test('resolveIncident marks incident as resolved and updates timestamps', async () => {
    const manager = createManager();

    const incident = await manager.openIncident({
        service: 'instagram',
        severity: 'warning',
        reasonCode: 'dm_generation_timeout',
        title: 'Fallback reply was used',
        detail: 'LLM timed out'
    });

    const resolved = await manager.resolveIncident(incident.id, 'Handled by operator');

    assert.ok(resolved);
    assert.equal(resolved.state, 'resolved');
    assert.equal(resolved.detail, 'Handled by operator');
    assert.ok(resolved.resolvedAt);
    assert.ok(resolved.updatedAt);
    assert.notEqual(resolved.updatedAt, incident.updatedAt);
});
