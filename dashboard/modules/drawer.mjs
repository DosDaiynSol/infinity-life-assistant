function buildModel(kind, item, page) {
  if (!item) {
    return null;
  }

  return {
    kind,
    page,
    item
  };
}

export function buildDrawerModel(pages, drawer) {
  if (!drawer || !drawer.page || !drawer.itemId) {
    return null;
  }

  if (drawer.page === 'overview') {
    const overview = pages.overview;
    if (!overview) {
      return null;
    }

    const incident = overview.triage?.items?.find((item) => item.id === drawer.itemId);
    if (incident) {
      return buildModel('incident', incident, 'overview');
    }

    const feedItem = overview.liveFeed?.items?.find((item) => item.id === drawer.itemId);
    if (feedItem) {
      return buildModel('live-feed', feedItem, 'overview');
    }

    const integration = overview.integrationHealth?.items?.find((item) => item.id === drawer.itemId);
    if (integration) {
      return buildModel('integration', integration, 'overview');
    }

    const channel = overview.channelHealth?.items?.find((item) => item.id === drawer.itemId);
    if (channel) {
      return buildModel('channel', channel, 'overview');
    }

    return null;
  }

  if (drawer.page === 'incidents') {
    return buildModel(
      'incident',
      pages.incidents?.items?.find((item) => item.id === drawer.itemId),
      drawer.page
    );
  }

  if (drawer.page === 'live-feed') {
    return buildModel(
      'live-feed',
      pages['live-feed']?.items?.find((item) => item.id === drawer.itemId),
      drawer.page
    );
  }

  if (drawer.page === 'integrations') {
    return buildModel(
      'integration',
      pages.integrations?.services?.find((item) => item.id === drawer.itemId),
      drawer.page
    );
  }

  if (drawer.page === 'channels') {
    return buildModel(
      'channel',
      pages.channels?.items?.find((item) => item.id === drawer.itemId),
      drawer.page
    );
  }

  return null;
}
