class TelegramNotifier {
    constructor(options = {}) {
        this.botToken = options.botToken || process.env.TELEGRAM_BOT_TOKEN || null;
        this.chatId = options.chatId || process.env.TELEGRAM_CHAT_ID || null;
    }

    isConfigured() {
        return Boolean(this.botToken && this.chatId);
    }

    async sendIncidentAlert(incident) {
        if (!this.isConfigured()) {
            return { sent: false, skipped: true };
        }

        const message = [
            `[${String(incident.severity || 'warning').toUpperCase()}] ${incident.title}`,
            incident.detail || 'Без деталей',
            `service=${incident.service}`,
            incident.externalRef ? `ref=${incident.externalRef}` : null
        ]
            .filter(Boolean)
            .join('\n');

        const response = await fetch(`https://api.telegram.org/bot${this.botToken}/sendMessage`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({
                chat_id: this.chatId,
                text: message
            })
        });

        if (!response.ok) {
            const payload = await response.text();
            throw new Error(`Telegram alert failed: ${payload}`);
        }

        return { sent: true };
    }
}

module.exports = TelegramNotifier;
