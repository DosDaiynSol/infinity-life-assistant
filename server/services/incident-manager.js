const path = require('path');
const JsonFileStore = require('./json-file-store');
const TelegramNotifier = require('./telegram-notifier');

const DEFAULT_MAX_INCIDENTS = 500;

function createIncidentId() {
    return `inc_${Date.now()}_${Math.random().toString(36).slice(2, 10)}`;
}

class IncidentManager {
    constructor(options = {}) {
        this.maxIncidents = options.maxIncidents || DEFAULT_MAX_INCIDENTS;
        this.notifier = options.notifier || new TelegramNotifier(options.telegram || {});
        this.store = new JsonFileStore(
            options.filePath || path.join(__dirname, '../../data/incidents.json'),
            () => []
        );
    }

    async openIncident(input) {
        const now = new Date().toISOString();
        const cooldownMs = input.cooldownMs ?? 60_000;
        let incident = null;
        let shouldNotify = false;

        await this.store.update((incidents) => {
            const existing = incidents.find((item) => (
                item.state === 'open'
                && item.service === input.service
                && item.reasonCode === input.reasonCode
                && (item.externalRef || null) === (input.externalRef || null)
            ));

            if (existing) {
                const lastAlertedAt = existing.lastAlertedAt
                    ? new Date(existing.lastAlertedAt).getTime()
                    : 0;
                const withinCooldown = Date.now() - lastAlertedAt < cooldownMs;

                incident = {
                    ...existing,
                    severity: input.severity || existing.severity,
                    title: input.title || existing.title,
                    detail: input.detail || existing.detail,
                    meta: {
                        ...(existing.meta || {}),
                        ...(input.meta || {})
                    },
                    count: (existing.count || 1) + 1,
                    lastSeenAt: now,
                    lastAlertedAt: withinCooldown ? existing.lastAlertedAt : now,
                    updatedAt: now
                };

                shouldNotify = !withinCooldown;

                return incidents.map((item) => (item.id === existing.id ? incident : item));
            }

            incident = {
                id: createIncidentId(),
                service: input.service,
                severity: input.severity || 'warning',
                state: 'open',
                reasonCode: input.reasonCode,
                title: input.title,
                detail: input.detail,
                externalRef: input.externalRef || null,
                openedAt: now,
                resolvedAt: null,
                lastSeenAt: now,
                lastAlertedAt: now,
                updatedAt: now,
                count: 1,
                meta: input.meta || {}
            };

            shouldNotify = true;
            return [incident, ...incidents].slice(0, this.maxIncidents);
        });

        if (shouldNotify) {
            try {
                await this.notifier.sendIncidentAlert(incident);
            } catch (error) {
                console.error('[IncidentManager] Alert failed:', error.message);
            }
        }

        return incident;
    }

    async resolveIncident(incidentId, resolutionDetail = null) {
        const now = new Date().toISOString();
        let resolvedIncident = null;

        await this.store.update((incidents) => incidents.map((incident) => {
            if (incident.id !== incidentId) {
                return incident;
            }

            resolvedIncident = {
                ...incident,
                state: 'resolved',
                detail: resolutionDetail || incident.detail,
                resolvedAt: now,
                updatedAt: now
            };

            return resolvedIncident;
        }));

        return resolvedIncident;
    }

    async listIncidents(options = {}) {
        const incidents = await this.store.read();
        const state = options.state || 'all';
        const byState = state === 'all'
            ? incidents
            : incidents.filter((incident) => incident.state === state);
        const service = options.service || null;
        const filtered = service
            ? byState.filter((incident) => incident.service === service)
            : byState;

        return filtered.slice(0, options.limit || 50);
    }

    async getSummary() {
        const incidents = await this.store.read();
        const open = incidents.filter((incident) => incident.state === 'open');
        const resolved = incidents.filter((incident) => incident.state === 'resolved');

        return {
            open: open.length,
            resolved: resolved.length,
            criticalOpen: open.filter((incident) => incident.severity === 'critical').length,
            warningOpen: open.filter((incident) => incident.severity === 'warning').length
        };
    }
}

module.exports = IncidentManager;
