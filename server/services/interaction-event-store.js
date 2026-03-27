const path = require('path');
const JsonFileStore = require('./json-file-store');

const DEFAULT_MAX_EVENTS = 2000;

function createEventId() {
    return `evt_${Date.now()}_${Math.random().toString(36).slice(2, 10)}`;
}

function percentile(values, ratio) {
    if (!values.length) return null;

    const sorted = values.slice().sort((left, right) => left - right);
    const index = Math.max(0, Math.min(sorted.length - 1, Math.ceil(sorted.length * ratio) - 1));
    return sorted[index];
}

class InteractionEventStore {
    constructor(options = {}) {
        this.maxEvents = options.maxEvents || DEFAULT_MAX_EVENTS;
        this.store = new JsonFileStore(
            options.filePath || path.join(__dirname, '../../data/interaction_events.json'),
            () => []
        );
    }

    _mergeEvent(current, patch) {
        const nextMeta = patch.meta
            ? { ...(current.meta || {}), ...patch.meta }
            : (current.meta || {});

        return {
            ...current,
            ...patch,
            meta: nextMeta,
            updatedAt: patch.updatedAt || new Date().toISOString()
        };
    }

    async recordInboundEvent(event) {
        let storedEvent = null;
        let isDuplicate = false;

        const receivedAt = event.receivedAt || new Date().toISOString();

        await this.store.update((events) => {
            const existing = events.find((item) => item.dedupeKey === event.dedupeKey);
            if (existing) {
                storedEvent = existing;
                isDuplicate = true;
                return events;
            }

            storedEvent = {
                id: createEventId(),
                platform: event.platform,
                channel: event.channel,
                externalId: event.externalId,
                conversationId: event.conversationId,
                actorId: event.actorId || null,
                actorUsername: event.actorUsername || null,
                direction: 'inbound',
                text: event.text || '',
                decision: null,
                riskLevel: null,
                status: 'received',
                deliveryStatus: 'pending',
                responseText: null,
                incidentId: null,
                dedupeKey: event.dedupeKey,
                rawPayload: event.rawPayload || null,
                meta: event.meta || {},
                stages: [
                    {
                        name: 'received',
                        at: receivedAt,
                        detail: 'Webhook accepted'
                    }
                ],
                receivedAt,
                processedAt: null,
                updatedAt: receivedAt
            };

            return [storedEvent, ...events].slice(0, this.maxEvents);
        });

        return { event: storedEvent, isDuplicate };
    }

    async getEvent(eventId) {
        const events = await this.store.read();
        return events.find((event) => event.id === eventId) || null;
    }

    async listEvents(limit = 50) {
        const events = await this.store.read();
        return events.slice(0, limit);
    }

    async listByConversation(conversationId, statuses = null) {
        const events = await this.store.read();
        const allowed = statuses ? new Set(statuses) : null;

        return events
            .filter((event) => event.conversationId === conversationId)
            .filter((event) => !allowed || allowed.has(event.status))
            .sort((left, right) => new Date(left.receivedAt).getTime() - new Date(right.receivedAt).getTime());
    }

    async listPendingEvents(limit = 50) {
        const events = await this.store.read();
        return events
            .filter((event) => ['received', 'processing'].includes(event.status))
            .slice(0, limit);
    }

    async updateEvent(eventId, patchOrUpdater) {
        const updatedEvents = await this.updateEvents([eventId], patchOrUpdater);
        return updatedEvents[0] || null;
    }

    async updateEvents(eventIds, patchOrUpdater) {
        const ids = new Set(eventIds);
        const updatedEvents = [];

        await this.store.update((events) => events.map((event) => {
            if (!ids.has(event.id)) {
                return event;
            }

            const patch = typeof patchOrUpdater === 'function'
                ? patchOrUpdater(event)
                : patchOrUpdater;

            const next = this._mergeEvent(event, patch || {});
            updatedEvents.push(next);
            return next;
        }));

        return updatedEvents;
    }

    async appendStage(eventId, stageName, detail, patch = {}) {
        return this.updateEvent(eventId, (event) => ({
            ...patch,
            stages: [
                ...(event.stages || []),
                {
                    name: stageName,
                    at: patch.updatedAt || new Date().toISOString(),
                    detail
                }
            ]
        }));
    }

    async appendStageToEvents(eventIds, stageName, detail, patch = {}) {
        return this.updateEvents(eventIds, (event) => ({
            ...patch,
            stages: [
                ...(event.stages || []),
                {
                    name: stageName,
                    at: patch.updatedAt || new Date().toISOString(),
                    detail
                }
            ]
        }));
    }

    async getMetrics(hours = 24) {
        const cutoff = Date.now() - (hours * 60 * 60 * 1000);
        const events = await this.store.read();
        const recent = events.filter((event) => {
            const receivedAt = new Date(event.receivedAt).getTime();
            return Number.isFinite(receivedAt) && receivedAt >= cutoff;
        });

        const delivered = recent.filter((event) => event.deliveryStatus === 'sent');
        const latencies = delivered
            .map((event) => {
                if (!event.processedAt) return null;

                const start = new Date(event.receivedAt).getTime();
                const end = new Date(event.processedAt).getTime();
                if (!Number.isFinite(start) || !Number.isFinite(end) || end < start) {
                    return null;
                }

                return (end - start) / 1000;
            })
            .filter((value) => value !== null);

        return {
            inbound: recent.length,
            delivered: delivered.length,
            failed: recent.filter((event) => event.deliveryStatus === 'failed').length,
            pending: recent.filter((event) => ['received', 'processing'].includes(event.status)).length,
            escalations: recent.filter((event) => event.decision === 'escalate').length,
            autoReplies: recent.filter((event) => event.decision === 'auto_reply').length,
            safeFallbacks: recent.filter((event) => event.decision === 'safe_fallback').length,
            p95ReplySeconds: percentile(latencies, 0.95)
        };
    }

    async listActivity(limit = 60) {
        const events = await this.store.read();

        return events
            .flatMap((event) => (event.stages || []).map((stage) => ({
                id: `${event.id}:${stage.name}:${stage.at}`,
                eventId: event.id,
                source: event.channel === 'comment' ? 'Instagram Comment' : 'Instagram DM',
                status: event.status,
                stage: stage.name,
                title: event.channel === 'comment'
                    ? `@${event.actorUsername || 'unknown'}`
                    : (event.actorUsername ? `DM @${event.actorUsername}` : `DM ${event.actorId || 'unknown'}`),
                detail: stage.detail || event.text || '',
                timestamp: stage.at
            })))
            .sort((left, right) => new Date(right.timestamp).getTime() - new Date(left.timestamp).getTime())
            .slice(0, limit);
    }
}

module.exports = InteractionEventStore;
