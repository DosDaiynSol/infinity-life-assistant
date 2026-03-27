const path = require('path');
const JsonFileStore = require('./json-file-store');

class InteractionOverrideStore {
  constructor(options = {}) {
    this.store = new JsonFileStore(
      options.filePath || path.join(__dirname, '../../data/interaction_overrides.json'),
      () => ({ overrides: {} })
    );
  }

  async getAll() {
    const payload = await this.store.read();
    return payload.overrides || {};
  }

  async getOverride(interactionId) {
    const overrides = await this.getAll();
    return overrides[interactionId] || null;
  }

  async setOverride(interactionId, patch) {
    let nextOverride = null;

    await this.store.update((payload) => {
      const current = payload.overrides || {};
      nextOverride = {
        ...(current[interactionId] || {}),
        ...patch,
        updatedAt: new Date().toISOString()
      };

      return {
        overrides: {
          ...current,
          [interactionId]: nextOverride
        }
      };
    });

    return nextOverride;
  }
}

module.exports = InteractionOverrideStore;
