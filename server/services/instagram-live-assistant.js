const path = require('path');
const InteractionEventStore = require('./interaction-event-store');
const IncidentManager = require('./incident-manager');
const integrationAuthManager = require('./integration-auth-manager');
const instagramApi = require('./instagram-api');
const statsManager = require('./stats-manager');
const instagramDB = require('./instagram-database');
const userManager = require('./user-manager');
const { generateDMResponse } = require('../handlers/dm');
const {
    REJECTION_REASONS,
    TEMPLATE_RESPONSE,
    TEMPLATE_RESPONSE_KZ,
    generateAIResponse,
    isKazakh,
    llmEvaluate,
    quickFilter
} = require('../handlers/comments');
const {
    buildEscalationTriage,
    buildSafeFallback,
    classifyEvent
} = require('./response-policy-engine');

class InstagramLiveAssistant {
    constructor(options = {}) {
        const dataRoot = options.dataRoot || path.join(__dirname, '../../data');

        this.eventStore = options.eventStore || new InteractionEventStore({
            filePath: path.join(dataRoot, 'interaction_events.json')
        });
        this.incidentManager = options.incidentManager || new IncidentManager({
            filePath: path.join(dataRoot, 'incidents.json'),
            notifier: options.notifier
        });
        this.authManager = options.authManager || integrationAuthManager;
        this.instagramApi = options.instagramApi || instagramApi;
        this.statsManager = options.statsManager || statsManager;
        this.instagramDB = options.instagramDB || instagramDB;
        this.userManager = options.userManager || userManager;
        this.generateDMResponse = options.generateDMResponse || generateDMResponse;
        this.generateCommentResponse = options.generateCommentResponse || generateAIResponse;
        this.quickFilter = options.quickFilter || quickFilter;
        this.llmEvaluate = options.llmEvaluate || llmEvaluate;
        this.isKazakh = options.isKazakh || isKazakh;
        this.commentTemplateRu = options.commentTemplateRu || TEMPLATE_RESPONSE;
        this.commentTemplateKz = options.commentTemplateKz || TEMPLATE_RESPONSE_KZ;
        this.rejectionReasons = options.rejectionReasons || REJECTION_REASONS;
        this.policyEngine = options.policyEngine || {
            buildEscalationTriage,
            buildSafeFallback,
            classifyEvent
        };
        this.microWindowMs = options.microWindowMs ?? 2500;
        this.classificationTimeoutMs = options.classificationTimeoutMs ?? 1500;
        this.generationTimeoutMs = options.generationTimeoutMs ?? 5000;
        this.conversationTimers = new Map();
        this.inFlight = new Map();
    }

    shutdown() {
        for (const timer of this.conversationTimers.values()) {
            clearTimeout(timer);
        }

        this.conversationTimers.clear();
    }

    normalizeTimestamp(value) {
        if (typeof value === 'number') {
            return new Date(value).toISOString();
        }

        const parsed = new Date(value || Date.now());
        if (Number.isNaN(parsed.getTime())) {
            return new Date().toISOString();
        }

        return parsed.toISOString();
    }

    normalizeWebhookPayload(payload) {
        const events = [];
        const entries = Array.isArray(payload.entry) ? payload.entry : [payload.entry].filter(Boolean);

        for (const entry of entries) {
            const messaging = Array.isArray(entry.messaging) ? entry.messaging : [entry.messaging].filter(Boolean);
            for (const message of messaging) {
                if (!message?.message?.text || message.message.is_deleted) {
                    continue;
                }

                events.push({
                    platform: 'instagram',
                    channel: 'dm',
                    externalId: message.message.mid,
                    conversationId: message.sender?.id,
                    actorId: message.sender?.id || null,
                    actorUsername: null,
                    text: String(message.message.text || '').trim(),
                    dedupeKey: `instagram:dm:${message.message.mid}`,
                    rawPayload: message,
                    meta: {},
                    receivedAt: this.normalizeTimestamp(message.timestamp)
                });
            }

            const changes = Array.isArray(entry.changes) ? entry.changes : [entry.changes].filter(Boolean);
            for (const change of changes) {
                if (change?.field !== 'comments' || !change.value?.id || !change.value?.text) {
                    continue;
                }

                events.push({
                    platform: 'instagram',
                    channel: 'comment',
                    externalId: change.value.id,
                    conversationId: change.value.media?.id || change.value.id,
                    actorId: change.value.from?.id || null,
                    actorUsername: change.value.from?.username || null,
                    text: String(change.value.text || '').trim(),
                    dedupeKey: `instagram:comment:${change.value.id}`,
                    rawPayload: change,
                    meta: {
                        mediaId: change.value.media?.id || null
                    },
                    receivedAt: new Date().toISOString()
                });
            }
        }

        return events.filter((event) => event.externalId && event.conversationId && event.text);
    }

    async ingestWebhookPayload(payload) {
        const normalized = this.normalizeWebhookPayload(payload);
        let accepted = 0;
        let duplicates = 0;

        for (const event of normalized) {
            const result = await this.eventStore.recordInboundEvent(event);

            if (result.isDuplicate) {
                duplicates += 1;
                continue;
            }

            accepted += 1;

            if (result.event.channel === 'dm') {
                this.scheduleConversation(result.event.conversationId);
            } else {
                this.processCommentEvent(result.event.id).catch((error) => {
                    console.error('[InstagramLiveAssistant] Comment processing failed:', error.message);
                });
            }
        }

        return {
            accepted,
            duplicates,
            queued: accepted
        };
    }

    scheduleConversation(conversationId) {
        const currentTimer = this.conversationTimers.get(conversationId);
        if (currentTimer) {
            clearTimeout(currentTimer);
        }

        const timer = setTimeout(() => {
            this.conversationTimers.delete(conversationId);
            this.processDMConversation(conversationId).catch((error) => {
                console.error('[InstagramLiveAssistant] DM processing failed:', error.message);
            });
        }, this.microWindowMs);

        this.conversationTimers.set(conversationId, timer);
    }

    async withTimeout(promise, timeoutMs, label) {
        let timerId = null;

        return Promise.race([
            promise,
            new Promise((_, reject) => {
                timerId = setTimeout(() => {
                    const error = new Error(`${label} timed out`);
                    error.code = 'timeout';
                    reject(error);
                }, timeoutMs);
            })
        ]).finally(() => {
            if (timerId) {
                clearTimeout(timerId);
            }
        });
    }

    runWithLock(key, task) {
        if (this.inFlight.has(key)) {
            return this.inFlight.get(key);
        }

        const promise = Promise.resolve()
            .then(task)
            .finally(() => {
                if (this.inFlight.get(key) === promise) {
                    this.inFlight.delete(key);
                }
            });

        this.inFlight.set(key, promise);
        return promise;
    }

    async openIncident(input) {
        return this.incidentManager.openIncident(input);
    }

    async ensureAuth(channel, externalRef) {
        const auth = channel === 'comment'
            ? this.authManager.getInstagramCommentAuth()
            : this.authManager.getInstagramMessagingAuth();

        if (auth.status === 'healthy') {
            return auth;
        }

        await this.openIncident({
            service: 'instagram_meta',
            severity: 'critical',
            reasonCode: channel === 'comment' ? 'comment_auth_missing' : 'dm_auth_missing',
            title: channel === 'comment'
                ? 'Instagram comment replies are degraded'
                : 'Instagram direct messages are degraded',
            detail: auth.lastError || 'Instagram token is missing.',
            externalRef
        });

        return null;
    }

    async fetchUsernameIfNeeded(userId) {
        let user = await this.userManager.getUser(userId);

        if (user?.username) {
            return user;
        }

        const profile = await this.instagramApi.getUserProfile(userId);
        if (profile?.username) {
            await this.userManager.updateUser(userId, {
                username: profile.username,
                name: profile.name || null
            });
            user = await this.userManager.getUser(userId, profile.username);
        }

        return user || { user_id: userId, username: profile?.username || null };
    }

    async saveHistory(entry) {
        await this.instagramDB.addHistory(entry);
    }

    async markMergedEvents(events, leadEventId, patch = {}) {
        const mergedIds = events
            .filter((event) => event.id !== leadEventId)
            .map((event) => event.id);

        if (!mergedIds.length) {
            return;
        }

        await this.eventStore.appendStageToEvents(
            mergedIds,
            patch.deliveryStatus === 'failed' ? 'failed' : 'merged',
            patch.deliveryStatus === 'failed'
                ? 'Shared delivery failed for grouped conversation'
                : 'Merged into grouped live reply',
            {
                ...patch,
                status: patch.deliveryStatus === 'failed' ? 'failed' : 'merged',
                meta: {
                    ...(patch.meta || {}),
                    mergedInto: leadEventId
                }
            }
        );
    }

    async processCommentEvent(eventId) {
        return this.runWithLock(`comment:${eventId}`, async () => {
            const event = await this.eventStore.getEvent(eventId);
            if (!event || event.status !== 'received') {
                return event;
            }

            const comment = {
                commentId: event.externalId,
                userId: event.actorId,
                username: event.actorUsername,
                text: event.text,
                mediaId: event.meta?.mediaId || null
            };

            await this.eventStore.appendStage(event.id, 'processing', 'Comment entered real-time pipeline', {
                status: 'processing'
            });

            await this.userManager.trackActivity(comment.userId, 'comment', comment.username);
            await this.statsManager.trackInstagramComment(comment.username);

            const aiEnabled = await this.userManager.isAIEnabled(comment.userId, 'comment');
            if (!aiEnabled) {
                await this.saveHistory({
                    type: 'comment',
                    commentId: comment.commentId,
                    userId: comment.userId,
                    username: comment.username,
                    text: comment.text,
                    response: null,
                    responded: false,
                    status: 'skipped',
                    rejection: this.rejectionReasons.AI_DISABLED
                });

                return this.eventStore.appendStage(event.id, 'classified', 'Comment skipped because AI is disabled', {
                    status: 'skipped',
                    deliveryStatus: 'skipped',
                    decision: 'skipped',
                    meta: {
                        rejectionCode: this.rejectionReasons.AI_DISABLED.code
                    }
                });
            }

            const filterResult = this.quickFilter(comment);
            if (!filterResult.pass) {
                await this.saveHistory({
                    type: 'comment',
                    commentId: comment.commentId,
                    userId: comment.userId,
                    username: comment.username,
                    text: comment.text,
                    response: null,
                    responded: false,
                    status: 'skipped',
                    rejection: filterResult.reason
                });

                return this.eventStore.appendStage(event.id, 'classified', `Comment skipped: ${filterResult.reason.label}`, {
                    status: 'skipped',
                    deliveryStatus: 'skipped',
                    decision: 'skipped',
                    meta: {
                        rejectionCode: filterResult.reason.code
                    }
                });
            }

            const commentIsKazakh = this.isKazakh(comment.text);
            const policy = this.policyEngine.classifyEvent({
                channel: 'comment',
                text: comment.text
            });

            await this.eventStore.appendStage(event.id, 'classified', `Policy decision: ${policy.decision}`, {
                decision: policy.decision,
                riskLevel: policy.riskLevel
            });

            if (policy.decision === 'escalate') {
                const incident = await this.openIncident({
                    service: 'instagram',
                    severity: policy.riskLevel === 'critical' ? 'critical' : 'warning',
                    reasonCode: policy.reasonCode,
                    title: 'Risky Instagram comment needs attention',
                    detail: comment.text,
                    externalRef: comment.commentId,
                    meta: {
                        channel: 'comment',
                        username: comment.username
                    }
                });

                const triage = this.policyEngine.buildEscalationTriage({
                    channel: 'comment',
                    username: comment.username,
                    isKazakh: commentIsKazakh
                });

                return this.deliverCommentReply(event, comment, triage, {
                    decision: 'escalate',
                    incidentId: incident.id,
                    riskLevel: policy.riskLevel,
                    fallbackUsed: false
                });
            }

            let relevant = null;
            try {
                relevant = await this.withTimeout(
                    this.llmEvaluate(comment.text),
                    this.classificationTimeoutMs,
                    'Comment classification'
                );
            } catch (error) {
                relevant = null;
                await this.openIncident({
                    service: 'instagram',
                    severity: 'warning',
                    reasonCode: 'comment_classification_timeout',
                    title: 'Instagram comment classification timed out',
                    detail: error.message,
                    externalRef: comment.commentId
                });
            }

            if (relevant === false) {
                await this.saveHistory({
                    type: 'comment',
                    commentId: comment.commentId,
                    userId: comment.userId,
                    username: comment.username,
                    text: comment.text,
                    response: null,
                    responded: false,
                    status: 'skipped',
                    rejection: this.rejectionReasons.LLM_NO
                });

                return this.eventStore.appendStage(event.id, 'classified', 'Comment skipped as irrelevant', {
                    status: 'skipped',
                    deliveryStatus: 'skipped',
                    decision: 'skipped',
                    meta: {
                        rejectionCode: this.rejectionReasons.LLM_NO.code
                    }
                });
            }

            let responseText = null;
            let decision = 'auto_reply';
            let fallbackUsed = false;

            if (relevant === null) {
                decision = 'safe_fallback';
                fallbackUsed = true;
                responseText = this.policyEngine.buildSafeFallback({
                    channel: 'comment',
                    username: comment.username,
                    isKazakh: commentIsKazakh
                });
            } else {
                try {
                    responseText = await this.withTimeout(
                        this.generateCommentResponse(comment.username || 'user', comment.text, commentIsKazakh),
                        this.generationTimeoutMs,
                        'Comment generation'
                    );
                } catch (error) {
                    await this.openIncident({
                        service: 'instagram',
                        severity: 'warning',
                        reasonCode: 'comment_generation_timeout',
                        title: 'Instagram comment response fell back to safe template',
                        detail: error.message,
                        externalRef: comment.commentId
                    });
                }

                if (!responseText) {
                    decision = 'safe_fallback';
                    fallbackUsed = true;
                    responseText = this.policyEngine.buildSafeFallback({
                        channel: 'comment',
                        username: comment.username,
                        isKazakh: commentIsKazakh
                    });
                }
            }

            return this.deliverCommentReply(event, comment, responseText, {
                decision,
                incidentId: null,
                riskLevel: decision === 'safe_fallback' ? 'medium' : 'low',
                fallbackUsed
            });
        });
    }

    async deliverCommentReply(event, comment, responseText, options) {
        const auth = await this.ensureAuth('comment', comment.commentId);
        if (!auth) {
            await this.saveHistory({
                type: 'comment',
                commentId: comment.commentId,
                userId: comment.userId,
                username: comment.username,
                text: comment.text,
                response: responseText,
                responded: false,
                status: 'error'
            });

            return this.eventStore.appendStage(event.id, 'failed', 'Comment reply blocked because Instagram auth is unavailable', {
                status: 'failed',
                deliveryStatus: 'failed',
                decision: options.decision,
                riskLevel: options.riskLevel,
                responseText,
                incidentId: options.incidentId || null
            });
        }

        await this.eventStore.appendStage(event.id, 'generated', `Prepared ${options.decision} reply`, {
            decision: options.decision,
            riskLevel: options.riskLevel,
            responseText,
            incidentId: options.incidentId || null,
            meta: {
                fallbackUsed: options.fallbackUsed
            }
        });

        const sent = await this.instagramApi.replyToComment(comment.commentId, responseText);
        if (!sent) {
            await this.openIncident({
                service: 'instagram',
                severity: 'warning',
                reasonCode: 'comment_delivery_failed',
                title: 'Instagram comment reply failed',
                detail: comment.text,
                externalRef: comment.commentId
            });
        }

        await this.saveHistory({
            type: 'comment',
            commentId: comment.commentId,
            userId: comment.userId,
            username: comment.username,
            text: comment.text,
            response: responseText,
            responded: sent,
            status: sent ? 'sent' : 'error'
        });

        if (sent) {
            await this.statsManager.trackInstagramResponse(1);
        }

        return this.eventStore.appendStage(
            event.id,
            sent ? 'sent' : 'failed',
            sent ? 'Comment reply delivered' : 'Instagram comment delivery failed',
            {
                status: sent ? (options.decision === 'escalate' ? 'escalated' : 'sent') : 'failed',
                deliveryStatus: sent ? 'sent' : 'failed',
                processedAt: new Date().toISOString(),
                decision: options.decision,
                riskLevel: options.riskLevel,
                responseText,
                incidentId: options.incidentId || null,
                meta: {
                    fallbackUsed: options.fallbackUsed
                }
            }
        );
    }

    async processDMConversation(conversationId) {
        return this.runWithLock(`dm:${conversationId}`, async () => {
            const events = await this.eventStore.listByConversation(conversationId, ['received']);
            if (!events.length) {
                return null;
            }

            const leadEvent = events[events.length - 1];
            const senderId = leadEvent.actorId || conversationId;
            const aggregatedText = events.map((event) => event.text).join('\n');
            const dmMessages = events.map((event) => ({ text: event.text, messageId: event.externalId }));

            await this.eventStore.appendStageToEvents(
                events.map((event) => event.id),
                'processing',
                'DM entered micro-window pipeline',
                { status: 'processing' }
            );

            const user = await this.fetchUsernameIfNeeded(senderId);
            for (const event of events) {
                await this.userManager.trackActivity(senderId, 'dm', user.username);
                await this.statsManager.trackInstagramDM(senderId);
            }

            const aiEnabled = await this.userManager.isAIEnabled(senderId, 'dm');
            if (!aiEnabled) {
                await this.saveHistory({
                    type: 'dm',
                    senderId,
                    username: user.username,
                    text: aggregatedText,
                    response: null,
                    responded: false,
                    status: 'skipped',
                    rejection: this.rejectionReasons.AI_DISABLED
                });

                await this.eventStore.appendStageToEvents(
                    events.map((event) => event.id),
                    'classified',
                    'DM skipped because AI is disabled',
                    {
                        status: 'skipped',
                        deliveryStatus: 'skipped',
                        decision: 'skipped',
                        meta: {
                            rejectionCode: this.rejectionReasons.AI_DISABLED.code
                        }
                    }
                );

                return events;
            }

            const conversationIsKazakh = this.isKazakh(aggregatedText);
            const policy = this.policyEngine.classifyEvent({
                channel: 'dm',
                text: aggregatedText
            });

            await this.eventStore.appendStageToEvents(
                events.map((event) => event.id),
                'classified',
                `Policy decision: ${policy.decision}`,
                {
                    decision: policy.decision,
                    riskLevel: policy.riskLevel
                }
            );

            if (policy.decision === 'escalate') {
                const incident = await this.openIncident({
                    service: 'instagram',
                    severity: policy.riskLevel === 'critical' ? 'critical' : 'warning',
                    reasonCode: policy.reasonCode,
                    title: 'Risky Instagram direct message needs attention',
                    detail: aggregatedText,
                    externalRef: senderId,
                    meta: {
                        channel: 'dm',
                        username: user.username
                    }
                });

                const triage = this.policyEngine.buildEscalationTriage({
                    channel: 'dm',
                    username: user.username,
                    isKazakh: conversationIsKazakh
                });

                return this.deliverDMReply(events, leadEvent.id, senderId, user.username, aggregatedText, triage, {
                    decision: 'escalate',
                    incidentId: incident.id,
                    riskLevel: policy.riskLevel,
                    fallbackUsed: false,
                    storeConversation: true
                });
            }

            let responseText = null;
            let decision = 'auto_reply';
            let fallbackUsed = false;

            try {
                responseText = await this.withTimeout(
                    this.generateDMResponse(senderId, dmMessages),
                    this.generationTimeoutMs,
                    'DM generation'
                );
            } catch (error) {
                fallbackUsed = true;
                decision = 'safe_fallback';

                await this.openIncident({
                    service: 'instagram',
                    severity: 'warning',
                    reasonCode: 'dm_generation_timeout',
                    title: 'Instagram DM response fell back to safe template',
                    detail: error.message,
                    externalRef: senderId
                });
            }

            if (!responseText) {
                fallbackUsed = true;
                decision = 'safe_fallback';
                responseText = this.policyEngine.buildSafeFallback({
                    channel: 'dm',
                    username: user.username,
                    isKazakh: conversationIsKazakh
                });
            }

            return this.deliverDMReply(events, leadEvent.id, senderId, user.username, aggregatedText, responseText, {
                decision,
                incidentId: null,
                riskLevel: decision === 'safe_fallback' ? 'medium' : 'low',
                fallbackUsed,
                storeConversation: decision !== 'auto_reply'
            });
        });
    }

    async deliverDMReply(events, leadEventId, senderId, username, aggregatedText, responseText, options) {
        const auth = await this.ensureAuth('dm', senderId);
        if (!auth) {
            await this.saveHistory({
                type: 'dm',
                senderId,
                username,
                text: aggregatedText,
                response: responseText,
                responded: false,
                status: 'error'
            });

            await this.eventStore.appendStageToEvents(
                events.map((event) => event.id),
                'failed',
                'DM reply blocked because Instagram auth is unavailable',
                {
                    status: 'failed',
                    deliveryStatus: 'failed',
                    decision: options.decision,
                    riskLevel: options.riskLevel,
                    responseText,
                    incidentId: options.incidentId || null
                }
            );

            return events;
        }

        await this.eventStore.appendStage(
            leadEventId,
            'generated',
            `Prepared ${options.decision} DM reply`,
            {
                decision: options.decision,
                riskLevel: options.riskLevel,
                responseText,
                incidentId: options.incidentId || null,
                meta: {
                    batchedCount: events.length,
                    fallbackUsed: options.fallbackUsed
                }
            }
        );

        if (options.storeConversation) {
            await this.userManager.addMessage(senderId, 'user', aggregatedText);
            await this.userManager.addMessage(senderId, 'assistant', responseText);
        }

        const sent = await this.instagramApi.sendDirectMessage(senderId, responseText);
        if (!sent) {
            await this.openIncident({
                service: 'instagram',
                severity: 'warning',
                reasonCode: 'dm_delivery_failed',
                title: 'Instagram direct reply failed',
                detail: aggregatedText,
                externalRef: senderId
            });
        }

        await this.saveHistory({
            type: 'dm',
            senderId,
            username,
            text: aggregatedText,
            response: responseText,
            responded: sent,
            status: sent ? 'sent' : 'error'
        });

        if (sent) {
            await this.statsManager.trackInstagramResponse(1);
        }

        await this.eventStore.appendStage(
            leadEventId,
            sent ? 'sent' : 'failed',
            sent ? 'DM reply delivered' : 'Instagram direct message delivery failed',
            {
                status: sent ? (options.decision === 'escalate' ? 'escalated' : 'sent') : 'failed',
                deliveryStatus: sent ? 'sent' : 'failed',
                processedAt: new Date().toISOString(),
                decision: options.decision,
                riskLevel: options.riskLevel,
                responseText,
                incidentId: options.incidentId || null,
                meta: {
                    batchedCount: events.length,
                    fallbackUsed: options.fallbackUsed
                }
            }
        );

        await this.markMergedEvents(events, leadEventId, {
            deliveryStatus: sent ? 'merged' : 'failed',
            decision: options.decision,
            riskLevel: options.riskLevel,
            processedAt: new Date().toISOString(),
            incidentId: options.incidentId || null,
            meta: {
                fallbackUsed: options.fallbackUsed
            }
        });

        return events;
    }

    createLiveFeedItem(event) {
        const lastStage = (event.stages || [])[event.stages.length - 1] || null;
        return {
            id: event.id,
            source: event.channel === 'comment' ? 'Instagram Comment' : 'Instagram DM',
            channel: event.channel,
            title: event.channel === 'comment'
                ? `@${event.actorUsername || 'user'}`
                : (event.actorUsername ? `DM @${event.actorUsername}` : `DM ${event.actorId || 'unknown'}`),
            text: event.text,
            responseText: event.responseText,
            status: event.status,
            decision: event.decision,
            riskLevel: event.riskLevel,
            incidentId: event.incidentId || null,
            stage: lastStage?.name || 'received',
            stageDetail: lastStage?.detail || '',
            timestamp: event.receivedAt,
            updatedAt: event.updatedAt,
            latencySeconds: event.processedAt
                ? Math.max(0, (new Date(event.processedAt).getTime() - new Date(event.receivedAt).getTime()) / 1000)
                : null
        };
    }

    async listLiveFeed(limit = 40) {
        const events = await this.eventStore.listEvents(limit);
        return events.map((event) => this.createLiveFeedItem(event));
    }

    async listIncidents(limit = 30) {
        return this.incidentManager.listIncidents({ state: 'open', limit });
    }

    async getInstagramSummary() {
        const [metrics, incidents, liveFeed] = await Promise.all([
            this.eventStore.getMetrics(),
            this.listIncidents(20),
            this.listLiveFeed(12)
        ]);

        const integration = this.authManager.getInstagramIntegrationSnapshot(metrics, incidents);

        return {
            metrics,
            incidents,
            liveFeed,
            integration
        };
    }

    async listActivity(limit = 60) {
        const [eventActivity, incidents] = await Promise.all([
            this.eventStore.listActivity(limit),
            this.incidentManager.listIncidents({ state: 'all', limit })
        ]);

        const incidentActivity = incidents.map((incident) => ({
            id: `${incident.id}:${incident.state}`,
            source: 'Incident',
            status: incident.state === 'open' ? incident.severity : 'processed',
            title: incident.title,
            detail: incident.detail,
            timestamp: incident.updatedAt || incident.openedAt
        }));

        return [...eventActivity, ...incidentActivity]
            .sort((left, right) => new Date(right.timestamp).getTime() - new Date(left.timestamp).getTime())
            .slice(0, limit);
    }
}

module.exports = InstagramLiveAssistant;
