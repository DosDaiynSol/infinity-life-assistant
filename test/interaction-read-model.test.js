const test = require('node:test');
const assert = require('node:assert/strict');

const { InteractionReadModel } = require('../server/services/interaction-read-model');

function createModel() {
  return new InteractionReadModel({
    assistantRuntime: {
      eventStore: {
        async listEvents() {
          return [
            {
              id: 'evt_dm_1',
              channel: 'dm',
              actorId: 'user-1',
              actorUsername: 'aliya',
              conversationId: 'user-1',
              text: 'Мне нужна консультация',
              status: 'received',
              deliveryStatus: 'pending',
              receivedAt: '2026-03-27T09:00:00.000Z',
              updatedAt: '2026-03-27T09:00:00.000Z',
              stages: [{ name: 'received', at: '2026-03-27T09:00:00.000Z', detail: 'Webhook accepted' }]
            },
            {
              id: 'evt_dm_2',
              channel: 'dm',
              actorId: 'user-1',
              actorUsername: 'aliya',
              conversationId: 'user-1',
              text: 'Спасибо',
              status: 'sent',
              deliveryStatus: 'sent',
              receivedAt: '2026-03-27T08:00:00.000Z',
              updatedAt: '2026-03-27T08:05:00.000Z',
              stages: [{ name: 'sent', at: '2026-03-27T08:05:00.000Z', detail: 'Reply delivered' }]
            }
          ];
        }
      }
    },
    loadGoogleOperationalData: async () => ({
      reviews: [{
        id: 'review-1',
        reviewer: 'Dana',
        rating: 2,
        comment: 'Ответа нет',
        reply: null,
        status: 'escalation',
        createdAt: '2026-03-27T07:00:00.000Z'
      }]
    }),
    loadYouTubeOperationalData: async () => ({
      history: [{
        id: 'yt-1',
        commentId: 'comment-1',
        author: 'Viewer',
        comment: 'Полезное видео',
        response: 'Спасибо за отзыв',
        responded: true,
        timestamp: '2026-03-27T06:00:00.000Z'
      }]
    }),
    loadThreadsOperationalData: async () => ({
      posts: [{
        id: 'thread-1',
        username: 'asker',
        text: 'Кого посоветуете в Астане?',
        status: 'validated',
        created_at: '2026-03-27T05:00:00.000Z'
      }]
    }),
    contactManager: {
      async getAllUsers() {
        return [{
          user_id: 'user-1',
          username: 'aliya',
          dm_enabled: true,
          comment_enabled: false
        }];
      },
      async getConversation() {
        return [
          { role: 'user', text: 'Здравствуйте' },
          { role: 'assistant', text: 'Здравствуйте, чем помочь?' }
        ];
      }
    },
    overrideStore: {
      async getAll() {
        return {
          'threads:thread-1': {
            status: 'needs_attention',
            manualAttention: true
          }
        };
      }
    }
  });
}

test('interaction read model returns normalized cross-service list', async () => {
  const model = createModel();
  const payload = await model.listInteractions({
    service: 'all',
    status: 'all'
  });

  assert.equal(payload.meta.grouped, false);
  assert.equal(payload.data.length, 5);
  assert.equal(payload.data[0].service, 'instagram_dm');
  assert.equal(payload.data[1].service, 'instagram_dm');
  assert.equal(payload.data.find((item) => item.service === 'google_reviews').status, 'needs_attention');
  assert.equal(payload.data.find((item) => item.id === 'threads:thread-1').manualAttention, true);
});

test('interaction read model groups instagram dm records by contact', async () => {
  const model = createModel();
  const payload = await model.listInteractions({
    service: 'instagram_dm',
    view: 'grouped'
  });

  assert.equal(payload.meta.grouped, true);
  assert.equal(payload.data.length, 1);
  assert.equal(payload.data[0].contactLabel, 'aliya');
  assert.equal(payload.data[0].totalInteractions, 2);
  assert.equal(payload.data[0].automation.commentEnabled, false);
});

test('interaction detail includes related conversation history', async () => {
  const model = createModel();
  const payload = await model.getInteraction('evt_dm_1');

  assert.ok(payload);
  assert.equal(payload.relatedConversation.length, 2);
  assert.equal(payload.timeline[0].label, 'Получено');
});
