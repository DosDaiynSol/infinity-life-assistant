const os = require('os');
const path = require('path');
const test = require('node:test');
const assert = require('node:assert/strict');
const InstagramLiveAssistant = require('../server/services/instagram-live-assistant');
const InteractionEventStore = require('../server/services/interaction-event-store');
const IncidentManager = require('../server/services/incident-manager');

function createAssistant(overrides = {}) {
    const suffix = `${Date.now()}-${Math.random()}`;
    const eventStore = new InteractionEventStore({
        filePath: path.join(os.tmpdir(), `assistant-events-${suffix}.json`)
    });
    const incidentManager = new IncidentManager({
        filePath: path.join(os.tmpdir(), `assistant-incidents-${suffix}.json`),
        notifier: {
            sendIncidentAlert: async () => ({ sent: false })
        }
    });

    const sentDms = [];
    const generatedPayloads = [];

    const assistant = new InstagramLiveAssistant({
        eventStore,
        incidentManager,
        microWindowMs: 20,
        generationTimeoutMs: 100,
        classificationTimeoutMs: 50,
        instagramApi: {
            sendDirectMessage: async (recipientId, text) => {
                sentDms.push({ recipientId, text });
                return true;
            },
            replyToComment: async () => true,
            getUserProfile: async () => ({ username: 'aliya' })
        },
        authManager: {
            getInstagramMessagingAuth: () => ({ status: 'healthy', accessToken: 'dm-token' }),
            getInstagramCommentAuth: () => ({ status: 'healthy', accessToken: 'reply-token' }),
            getInstagramIntegrationSnapshot: () => ({ status: 'healthy' })
        },
        statsManager: {
            trackInstagramDM: async () => {},
            trackInstagramComment: async () => {},
            trackInstagramResponse: async () => {}
        },
        instagramDB: {
            addHistory: async () => {}
        },
        userManager: {
            getUser: async (userId) => ({ user_id: userId, username: null }),
            updateUser: async () => {},
            trackActivity: async () => {},
            isAIEnabled: async () => true,
            addMessage: async () => {}
        },
        generateDMResponse: async (_senderId, messages) => {
            generatedPayloads.push(messages);
            return overrides.generatedReply || 'Готово';
        },
        generateCommentResponse: async () => 'Комментарий принят',
        llmEvaluate: async () => true,
        quickFilter: () => ({ pass: true }),
        isKazakh: () => false,
        ...overrides
    });

    return {
        assistant,
        sentDms,
        generatedPayloads,
        incidentManager
    };
}

test('groups DM fragments inside micro-window into a single reply', async () => {
    const { assistant, sentDms, generatedPayloads } = createAssistant();

    await assistant.ingestWebhookPayload({
        object: 'instagram',
        entry: [{
            messaging: [
                {
                    sender: { id: 'user-1' },
                    timestamp: Date.now(),
                    message: { mid: 'mid-1', text: 'Здравствуйте' }
                }
            ]
        }]
    });

    await assistant.ingestWebhookPayload({
        object: 'instagram',
        entry: [{
            messaging: [
                {
                    sender: { id: 'user-1' },
                    timestamp: Date.now(),
                    message: { mid: 'mid-2', text: 'Сколько стоит прием?' }
                }
            ]
        }]
    });

    await new Promise((resolve) => setTimeout(resolve, 80));

    assert.equal(generatedPayloads.length, 1);
    assert.equal(generatedPayloads[0].length, 2);
    assert.equal(sentDms.length, 1);

    assistant.shutdown();
});

test('suppresses duplicate webhook deliveries by dedupe key', async () => {
    const { assistant, sentDms } = createAssistant();

    const first = await assistant.ingestWebhookPayload({
        object: 'instagram',
        entry: [{
            messaging: [
                {
                    sender: { id: 'user-2' },
                    timestamp: Date.now(),
                    message: { mid: 'mid-dup', text: 'Привет' }
                }
            ]
        }]
    });

    const second = await assistant.ingestWebhookPayload({
        object: 'instagram',
        entry: [{
            messaging: [
                {
                    sender: { id: 'user-2' },
                    timestamp: Date.now(),
                    message: { mid: 'mid-dup', text: 'Привет' }
                }
            ]
        }]
    });

    await new Promise((resolve) => setTimeout(resolve, 60));

    assert.equal(first.accepted, 1);
    assert.equal(second.duplicates, 1);
    assert.equal(sentDms.length, 1);

    assistant.shutdown();
});

test('escalates risky DM conversations without calling the normal generator', async () => {
    const { assistant, sentDms, generatedPayloads, incidentManager } = createAssistant();

    await assistant.ingestWebhookPayload({
        object: 'instagram',
        entry: [{
            messaging: [
                {
                    sender: { id: 'user-3' },
                    timestamp: Date.now(),
                    message: { mid: 'mid-risk', text: 'После вашего приема стало хуже, хочу подать жалобу.' }
                }
            ]
        }]
    });

    await new Promise((resolve) => setTimeout(resolve, 80));
    const incidents = await incidentManager.listIncidents({ state: 'open', limit: 10 });

    assert.equal(generatedPayloads.length, 0);
    assert.equal(sentDms.length, 1);
    assert.match(sentDms[0].text, /старшему администратору/i);
    assert.equal(incidents.length, 1);

    assistant.shutdown();
});
