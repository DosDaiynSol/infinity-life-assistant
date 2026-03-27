const MAX_RESOLUTION_DETAIL_LENGTH = 1000;

function getSeverityWeight(severity) {
    if (severity === 'critical') return 0;
    if (severity === 'warning') return 1;
    return 2;
}

function getStatusWeight(status) {
    if (status === 'reauth_required') return 0;
    if (status === 'degraded') return 1;
    return 2;
}

function normalizeAction(action) {
    if (!action || typeof action !== 'object') {
        return null;
    }

    if (!action.kind || !action.label) {
        return null;
    }

    return {
        kind: action.kind,
        label: action.label,
        service: action.service || null,
        page: action.page || null,
        itemId: action.itemId || null
    };
}

function uniqueActions(actions) {
    const seen = new Set();

    return actions.filter((action) => {
        const key = `${action.kind}:${action.service || ''}:${action.page || ''}:${action.itemId || ''}`;
        if (seen.has(key)) {
            return false;
        }

        seen.add(key);
        return true;
    });
}

function createDashboardIncident(input = {}) {
    const actions = uniqueActions(
        (Array.isArray(input.actions) ? input.actions : [])
            .map(normalizeAction)
            .filter(Boolean)
    );
    const recommendedAction = normalizeAction(input.recommendedAction) || actions[0] || null;
    const openedAt = input.openedAt || input.updatedAt || null;
    const updatedAt = input.updatedAt || input.openedAt || null;
    const count = Number.isFinite(input.count) ? input.count : 1;

    return {
        id: input.id,
        severity: input.severity || 'warning',
        source: input.source || input.service || 'Unknown',
        service: input.service || null,
        title: input.title || '',
        detail: input.detail || '',
        state: input.state || 'open',
        openedAt,
        updatedAt,
        resolvedAt: input.resolvedAt || null,
        count,
        reasonCode: input.reasonCode || null,
        meta: input.meta && typeof input.meta === 'object' ? { ...input.meta } : {},
        recommendedAction,
        actions,
        relatedContext: input.relatedContext
            ? {
                page: input.relatedContext.page || null,
                itemId: input.relatedContext.itemId || null
            }
            : null
    };
}

function sortIncidents(incidents) {
    return incidents
        .slice()
        .sort((left, right) => {
            const severityDiff = getSeverityWeight(left.severity) - getSeverityWeight(right.severity);
            if (severityDiff !== 0) {
                return severityDiff;
            }

            const leftTime = left.updatedAt ? new Date(left.updatedAt).getTime() : 0;
            const rightTime = right.updatedAt ? new Date(right.updatedAt).getTime() : 0;
            return rightTime - leftTime;
        });
}

function buildOverviewCards({ incidents, instagramRealtime, integrations, responsesDelivered }) {
    const openIncidents = incidents.filter((incident) => incident.state !== 'resolved');
    const criticalIncidents = openIncidents.filter((incident) => incident.severity === 'critical');
    const healthyIntegrations = integrations.filter((service) => service.status === 'healthy').length;
    const p95ReplySeconds = instagramRealtime.metrics.p95ReplySeconds;

    return [
        {
            id: 'incidents',
            label: 'Инциденты',
            value: openIncidents.length,
            detail: criticalIncidents.length > 0
                ? `${criticalIncidents.length} critical`
                : 'Critical incidents clear',
            tone: criticalIncidents.length > 0 ? 'critical' : 'healthy'
        },
        {
            id: 'latency',
            label: 'P95 reply',
            value: p95ReplySeconds === null || p95ReplySeconds === undefined
                ? 'n/a'
                : `${p95ReplySeconds.toFixed(1)}s`,
            detail: 'Instagram live reply latency',
            tone: p95ReplySeconds !== null && p95ReplySeconds !== undefined && p95ReplySeconds > 5
                ? 'warning'
                : 'healthy'
        },
        {
            id: 'delivery',
            label: 'Responses delivered',
            value: responsesDelivered,
            detail: `${instagramRealtime.metrics.failed || 0} Instagram failures in window`,
            tone: (instagramRealtime.metrics.failed || 0) > 0 ? 'warning' : 'healthy'
        },
        {
            id: 'integrations',
            label: 'Integrations healthy',
            value: `${healthyIntegrations}/${integrations.length}`,
            detail: `${integrations.length - healthyIntegrations} need attention`,
            tone: healthyIntegrations === integrations.length ? 'healthy' : 'warning'
        }
    ];
}

function buildChannelHealth({ instagramRealtime, youtube, google, threads, integrations }) {
    const integrationMap = new Map(integrations.map((service) => [service.id, service]));

    return {
        summary: {
            totalChannels: 4,
            degradedChannels: [
                integrationMap.get('instagram_meta')?.status,
                integrationMap.get('youtube')?.status,
                integrationMap.get('google_business')?.status,
                integrationMap.get('threads')?.status
            ].filter((status) => status && status !== 'healthy').length
        },
        items: [
            {
                id: 'instagram',
                name: 'Instagram',
                status: integrationMap.get('instagram_meta')?.status || 'healthy',
                workload: instagramRealtime.metrics.inbound || 0,
                topRisk: `${instagramRealtime.metrics.escalations || 0} escalations in window`,
                recentActivity: `${instagramRealtime.metrics.delivered || 0} replies delivered`,
                metrics: [
                    { label: 'Inbound 24h', value: instagramRealtime.metrics.inbound || 0 },
                    { label: 'Delivered', value: instagramRealtime.metrics.delivered || 0 },
                    { label: 'Escalations', value: instagramRealtime.metrics.escalations || 0 }
                ]
            },
            {
                id: 'youtube',
                name: 'YouTube',
                status: integrationMap.get('youtube')?.status || 'healthy',
                workload: youtube.stats.totalComments || 0,
                topRisk: youtube.authorized ? 'Scheduled sync healthy' : 'Authorization missing',
                recentActivity: `${youtube.stats.totalResponses || 0} replies sent`,
                metrics: [
                    { label: 'Comments', value: youtube.stats.totalComments || 0 },
                    { label: 'Replies', value: youtube.stats.totalResponses || 0 },
                    { label: 'Videos', value: youtube.stats.processedVideos || 0 }
                ]
            },
            {
                id: 'google',
                name: 'Google Reviews',
                status: integrationMap.get('google_business')?.status || 'healthy',
                workload: google.stats.pendingReviews || 0,
                topRisk: `${google.stats.escalationReviews || 0} risky reviews`,
                recentActivity: `${google.stats.totalReplied || 0} replies posted`,
                metrics: [
                    { label: 'Pending', value: google.stats.pendingReviews || 0 },
                    { label: 'Escalations', value: google.stats.escalationReviews || 0 },
                    { label: 'Total', value: google.stats.totalReviews || 0 }
                ]
            },
            {
                id: 'threads',
                name: 'Threads',
                status: integrationMap.get('threads')?.status || 'healthy',
                workload: threads.stats.validated || 0,
                topRisk: `${threads.stats.validated || 0} posts await a decision`,
                recentActivity: `${threads.stats.replied || 0} replies posted`,
                metrics: [
                    { label: 'Signals', value: threads.stats.postsFound || 0 },
                    { label: 'Validated', value: threads.stats.validated || 0 },
                    { label: 'Replies', value: threads.stats.replied || 0 }
                ]
            }
        ]
    };
}

function buildIntegrationHealth(integrations) {
    const sorted = integrations
        .slice()
        .sort((left, right) => getStatusWeight(left.status) - getStatusWeight(right.status));

    return {
        summary: {
            totalIntegrations: integrations.length,
            healthyIntegrations: integrations.filter((service) => service.status === 'healthy').length,
            degradedIntegrations: integrations.filter((service) => service.status === 'degraded').length,
            reauthRequired: integrations.filter((service) => service.status === 'reauth_required').length
        },
        riskSummary: sorted
            .filter((service) => service.status !== 'healthy')
            .slice(0, 3)
            .map((service) => ({
                id: service.id,
                name: service.name,
                status: service.status,
                detail: service.lastError || service.summary
            })),
        items: sorted
    };
}

function buildCommandCenterOverviewPayload({ instagramRealtime, youtube, google, threads, integrations, incidents }) {
    const responsesDelivered = (instagramRealtime.metrics.delivered || 0)
        + (youtube.stats.totalResponses || 0)
        + (google.stats.totalReplied || 0)
        + (threads.stats.replied || 0);
    const openIncidents = incidents.filter((incident) => incident.state !== 'resolved');
    const healthyIntegrations = integrations.filter((service) => service.status === 'healthy').length;

    return {
        generatedAt: new Date().toISOString(),
        summary: {
            openIncidents: openIncidents.length,
            criticalIncidents: openIncidents.filter((incident) => incident.severity === 'critical').length,
            p95ReplySeconds: instagramRealtime.metrics.p95ReplySeconds ?? null,
            responsesDelivered,
            healthyIntegrations,
            totalIntegrations: integrations.length,
            cards: buildOverviewCards({
                incidents,
                instagramRealtime,
                integrations,
                responsesDelivered
            })
        },
        triage: {
            totalOpen: openIncidents.length,
            critical: openIncidents.filter((incident) => incident.severity === 'critical').length,
            warning: openIncidents.filter((incident) => incident.severity === 'warning').length,
            items: sortIncidents(openIncidents).slice(0, 10)
        },
        liveFeed: {
            total: instagramRealtime.liveFeed.length,
            items: instagramRealtime.liveFeed.slice(0, 10)
        },
        channelHealth: buildChannelHealth({
            instagramRealtime,
            youtube,
            google,
            threads,
            integrations
        }),
        integrationHealth: buildIntegrationHealth(integrations)
    };
}

function buildCommandCenterIncidentsPayload(incidents) {
    const normalized = sortIncidents(incidents);
    const openCount = normalized.filter((incident) => incident.state !== 'resolved').length;
    const sourceOptions = [...new Set(normalized.map((incident) => incident.source).filter(Boolean))];

    return {
        generatedAt: new Date().toISOString(),
        summary: {
            total: normalized.length,
            open: openCount,
            resolved: normalized.length - openCount,
            critical: normalized.filter((incident) => incident.severity === 'critical').length,
            warning: normalized.filter((incident) => incident.severity === 'warning').length
        },
        filters: {
            severity: ['all', 'critical', 'warning'],
            state: ['all', 'open', 'resolved'],
            source: ['all', ...sourceOptions]
        },
        items: normalized
    };
}

function parseIncidentResolutionInput(body) {
    if (!body || body.resolutionDetail === undefined || body.resolutionDetail === null) {
        return {
            resolutionDetail: null
        };
    }

    if (typeof body.resolutionDetail !== 'string') {
        throw new Error('resolutionDetail must be a string');
    }

    const resolutionDetail = body.resolutionDetail.trim();

    if (resolutionDetail.length > MAX_RESOLUTION_DETAIL_LENGTH) {
        throw new Error(`resolutionDetail must be at most ${MAX_RESOLUTION_DETAIL_LENGTH} characters`);
    }

    return {
        resolutionDetail: resolutionDetail || null
    };
}

module.exports = {
    MAX_RESOLUTION_DETAIL_LENGTH,
    createDashboardIncident,
    buildCommandCenterOverviewPayload,
    buildCommandCenterIncidentsPayload,
    parseIncidentResolutionInput
};
