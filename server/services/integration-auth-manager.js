const DEFAULT_PAGE_ID = '17841448174425966';

class IntegrationAuthManager {
    getMetaConfig() {
        return {
            pageId: process.env.INSTAGRAM_PAGE_ID || DEFAULT_PAGE_ID,
            dmToken: process.env.INSTAGRAM_DM_TOKEN || null,
            replyToken: process.env.INSTAGRAM_REPLY_TOKEN || null
        };
    }

    getInstagramMessagingAuth() {
        const config = this.getMetaConfig();
        return {
            pageId: config.pageId,
            accessToken: config.dmToken,
            status: config.dmToken ? 'healthy' : 'reauth_required',
            lastCheckedAt: new Date().toISOString(),
            lastError: config.dmToken ? null : 'Instagram DM token is missing.'
        };
    }

    getInstagramCommentAuth() {
        const config = this.getMetaConfig();
        return {
            pageId: config.pageId,
            accessToken: config.replyToken,
            status: config.replyToken ? 'healthy' : 'reauth_required',
            lastCheckedAt: new Date().toISOString(),
            lastError: config.replyToken ? null : 'Instagram comment reply token is missing.'
        };
    }

    getInstagramIntegrationSnapshot(runtimeMetrics = {}, openIncidents = []) {
        const messaging = this.getInstagramMessagingAuth();
        const comments = this.getInstagramCommentAuth();
        const authMissing = messaging.status !== 'healthy' || comments.status !== 'healthy';
        const deliveryFailures = runtimeMetrics.failed || 0;
        const criticalIncidents = openIncidents.filter((incident) => incident.severity === 'critical').length;

        let status = 'healthy';
        let summary = `Real-time replies active. Delivered: ${runtimeMetrics.delivered || 0}`;
        let lastError = null;

        if (authMissing) {
            status = 'reauth_required';
            lastError = messaging.lastError || comments.lastError;
            summary = 'Meta tokens need to be reauthorized before live replies can continue.';
        } else if (deliveryFailures > 0 || criticalIncidents > 0) {
            status = 'degraded';
            lastError = openIncidents[0]?.detail || null;
            summary = `Delivery issues: ${deliveryFailures}. Open incidents: ${openIncidents.length}.`;
        }

        return {
            id: 'instagram_meta',
            name: 'Instagram / Meta',
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
