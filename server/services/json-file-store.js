const fs = require('fs/promises');
const path = require('path');

class JsonFileStore {
    constructor(filePath, createDefaultValue = () => []) {
        this.filePath = filePath;
        this.createDefaultValue = createDefaultValue;
        this.writeChain = Promise.resolve();
    }

    _cloneDefaultValue() {
        return JSON.parse(JSON.stringify(this.createDefaultValue()));
    }

    async _ensureFile() {
        await fs.mkdir(path.dirname(this.filePath), { recursive: true });

        try {
            await fs.access(this.filePath);
        } catch (error) {
            await fs.writeFile(
                this.filePath,
                JSON.stringify(this._cloneDefaultValue(), null, 2),
                'utf8'
            );
        }
    }

    async read() {
        await this._ensureFile();

        try {
            const raw = await fs.readFile(this.filePath, 'utf8');
            if (!raw.trim()) {
                return this._cloneDefaultValue();
            }

            return JSON.parse(raw);
        } catch (error) {
            return this._cloneDefaultValue();
        }
    }

    async write(value) {
        await this._ensureFile();

        const tempPath = `${this.filePath}.tmp`;
        await fs.writeFile(tempPath, JSON.stringify(value, null, 2), 'utf8');
        await fs.rename(tempPath, this.filePath);
    }

    async update(updater) {
        let result;

        const operation = this.writeChain.then(async () => {
            const current = await this.read();
            const next = updater(current);
            result = next;
            await this.write(next);
            return next;
        });

        this.writeChain = operation.catch(() => {});
        await operation;
        return result;
    }
}

module.exports = JsonFileStore;
