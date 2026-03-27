const DEFAULT_PAGE_ID = '17841448174425966';
const { normalizeOptionalEnv } = require('./env-utils');

class IntegrationAuthManager {
    getMetaConfig() {
        return {
            pageId: normalizeOptionalEnv(process.env.INSTAGRAM_PAGE_ID) || DEFAULT_PAGE_ID,
            dmToken: normalizeOptionalEnv(process.env.INSTAGRAM_DM_TOKEN),
            replyToken: normalizeOptionalEnv(process.env.INSTAGRAM_REPLY_TOKEN)
        };
    }

    getInstagramMessagingAuth() {
        const config = this.getMetaConfig();
        return {
            pageId: config.pageId,
            accessToken: config.dmToken,
            status: config.dmToken ? 'healthy' : 'reauth_required',
            lastCheckedAt: new Date().toISOString(),
            lastError: config.dmToken ? null : 'Отсутствует токен для Instagram DM.'
        };
    }

    getInstagramCommentAuth() {
        const config = this.getMetaConfig();
        return {
            pageId: config.pageId,
            accessToken: config.replyToken,
            status: config.replyToken ? 'healthy' : 'reauth_required',
            lastCheckedAt: new Date().toISOString(),
            lastError: config.replyToken ? null : 'Отсутствует токен для ответов на комментарии Instagram.'
        };
    }

    getInstagramIntegrationSnapshot(runtimeMetrics = {}, openIncidents = []) {
        const messaging = this.getInstagramMessagingAuth();
        const comments = this.getInstagramCommentAuth();
        const authMissing = messaging.status !== 'healthy' || comments.status !== 'healthy';
        const deliveryFailures = runtimeMetrics.failed || 0;
        const criticalIncidents = openIncidents.filter((incident) => incident.severity === 'critical').length;

        let status = 'healthy';
        let summary = `Ответы Instagram работают. Доставлено: ${runtimeMetrics.delivered || 0}`;
        let lastError = null;

        if (authMissing) {
            status = 'reauth_required';
            lastError = messaging.lastError || comments.lastError;
            summary = 'Нужна повторная авторизация Meta, иначе ответы в Instagram не будут отправляться.';
        } else if (deliveryFailures > 0 || criticalIncidents > 0) {
            status = 'degraded';
            lastError = openIncidents[0]?.detail || null;
            summary = `Есть проблемы с доставкой: ${deliveryFailures}. Открытых инцидентов: ${openIncidents.length}.`;
        }

        return {
            id: 'instagram_meta',
            name: 'Instagram',
            provider: 'Meta',
            status,
            summary,
            lastError,
            lastCheckedAt: new Date().toISOString(),
            actions: ['reauthorize'],
            tokenState: {
                pageId: messaging.pageId,
                hasDmToken: Boolean(messaging.accessToken),
                hasReplyToken: Boolean(comments.accessToken)
            }
        };
    }
}

module.exports = new IntegrationAuthManager();
