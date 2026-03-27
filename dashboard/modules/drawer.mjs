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

function findItem(items, itemId) {
  return (items || []).find((item) => item.id === itemId) || null;
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

    const urgent = findItem(overview.urgent?.items, drawer.itemId);
    if (urgent) {
      return buildModel('interaction', urgent, 'overview');
    }

    const service = findItem(overview.services?.items, drawer.itemId);
    if (service) {
      return buildModel('service', service, 'overview');
    }

    return null;
  }

  if (drawer.page === 'interactions') {
    const item = findItem(pages.interactions?.data, drawer.itemId);
    if (!item) {
      return null;
    }

    if (item.totalInteractions) {
      return buildModel('contact-group', item, drawer.page);
    }

    return buildModel('interaction', item, drawer.page);
  }

  if (drawer.page === 'integrations') {
    return buildModel(
      'service',
      findItem(pages.integrations?.services, drawer.itemId),
      drawer.page
    );
  }

  return null;
}
