const OpenAI = require('openai');
const fs = require('fs');
const path = require('path');

// Load clinic data
const clinicData = JSON.parse(
    fs.readFileSync(path.join(__dirname, '../data/clinic_data.json'), 'utf8')
);

const openai = new OpenAI({
    apiKey: process.env.OPENAI_API_KEY
});

class YouTubeResponder {
    constructor() {
        this.clinicData = clinicData;
    }

    // Build system prompt with clinic context
    buildSystemPrompt(videoInfo = null) {
        const clinic = this.clinicData.clinic;
        const services = this.clinicData.services;
        const treatments = this.clinicData.treatments;

        let videoContext = '';
        if (videoInfo) {
            videoContext = `
КОНТЕКСТ ВИДЕО:
- Название: "${videoInfo.title}"
- Описание: ${videoInfo.description?.substring(0, 500) || 'Не указано'}
- Теги: ${videoInfo.tags?.join(', ') || 'Не указаны'}

При ответе учитывай тему видео и отвечай релевантно его содержанию.
`;
        }

        return `Ты — AI-ассистент для YouTube канала медицинского центра "${clinic.name}".
Твоя задача — отвечать на комментарии пользователей под видео.

${videoContext}

ИНФОРМАЦИЯ О КЛИНИКЕ:
- Название: ${clinic.fullName}
- Город: ${clinic.city}
- Телефон для записи: ${clinic.contactPhoneShort}
- WhatsApp: ${clinic.whatsapp}
- Сайт: ${clinic.website}
- Instagram: ${clinic.instagram}
- Филиалы: ${this.clinicData.branches.map(b => b.address).join('; ')}

УСЛУГИ:
- Консультации: ${services.consultations.join(', ')}
- Диагностика: ${services.diagnostics.join(', ')}
- Физиотерапия: ${services.physiotherapy.map(p => typeof p === 'string' ? p : p.name).join(', ')}
- Мануальная терапия: ${services.manualTherapy.join(', ')}

НАПРАВЛЕНИЯ ЛЕЧЕНИЯ:
${treatments.join(', ')}

ПРАВИЛА ОТВЕТОВ:
1. Отвечай кратко и по существу (1-3 предложения)
2. Будь вежливым и профессиональным
3. Приглашай на консультацию когда уместно
4. Указывай телефон "${clinic.contactPhoneShort}" для записи
5. Если вопрос медицинский — не давай конкретных рекомендаций, приглашай на осмотр к специалисту
6. Используй эмодзи умеренно
7. Не начинай ответ с обращения "@username" (YouTube сам это делает)
8. Отвечай на языке комментария (русский или казахский)

ПРИМЕРЫ ХОРОШИХ ОТВЕТОВ:
- "Спасибо за вопрос! Для точной диагностики приглашаем на консультацию. Записаться можно по номеру 87470953952 🙏"
- "Да, мы успешно лечим эту проблему безоперационными методами. Ждём вас на осмотр! Запись: 87470953952"
- "Благодарим за интерес! Наш специалист сможет подробнее рассказать о лечении на консультации. Звоните: 87470953952"`;
    }

    // Generate AI response for a comment
    async generateResponse(commentText, videoInfo = null) {
        try {
            const systemPrompt = this.buildSystemPrompt(videoInfo);

            const completion = await openai.chat.completions.create({
                model: 'gpt-4o-mini',
                messages: [
                    { role: 'system', content: systemPrompt },
                    { role: 'user', content: `Комментарий под видео: "${commentText}"\n\nНапиши подходящий ответ от имени клиники:` }
                ],
                max_tokens: 200,
                temperature: 0.7
            });

            const response = completion.choices[0]?.message?.content?.trim();
            console.log(`[YouTube Responder] Generated response for: "${commentText.substring(0, 50)}..."`);
            return response;
        } catch (error) {
            console.error('[YouTube Responder] Error generating response:', error.message);
            throw error;
        }
    }

    // Check if text is emoji-only (emojis, variation selectors, ZWJ, spaces)
    isEmojiOnly(text) {
        const stripped = text.replace(/[\s\uFE0F\u200D]/g, '');
        // Match emoji sequences
        const emojiRegex = /^[\p{Emoji_Presentation}\p{Emoji}\u200D\uFE0F\u20E3\u{1F3FB}-\u{1F3FF}\u{E0020}-\u{E007F}]+$/u;
        return emojiRegex.test(stripped) && stripped.length > 0;
    }

    // Generate a quick emoji response (no AI needed)
    getEmojiResponse() {
        const responses = ['❤️', '🙏', '🙏❤️', '❤️🔥', '🤗', '💪🙏', '❤️🙏'];
        return responses[Math.floor(Math.random() * responses.length)];
    }

    // Determine if comment needs a response and what type
    // Returns: { respond: boolean, type: 'emoji' | 'ai' | null, emojiReply?: string }
    shouldRespond(comment) {
        const text = comment.textOriginal || comment.text || '';
        const textLower = text.toLowerCase().trim();

        // Skip empty
        if (textLower.length === 0) return { respond: false, type: null };

        // Skip spam-like comments
        const spamPatterns = [
            'подписка', 'subscribe', 'check my channel', 'посмотри мой канал',
            'http://', 'https://', 'www.', 'подпишись', 'лайк на лайк',
            'check out', 'my channel', 'sub4sub', 'follow me'
        ];
        if (spamPatterns.some(pattern => textLower.includes(pattern))) {
            return { respond: false, type: null };
        }

        // Emoji-only comments → reply with emoji
        if (this.isEmojiOnly(text)) {
            return { respond: true, type: 'emoji', emojiReply: this.getEmojiResponse() };
        }

        // Very short non-emoji (1-2 chars like "ну", "да") → skip
        if (textLower.length < 3) return { respond: false, type: null };

        // Positive/grateful comments → AI reply
        const positivePatterns = [
            'спасибо', 'благодар', 'помогло', 'полезно', 'интересно', 'класс',
            'круто', 'супер', 'молодец', 'лучший', 'лучшая', 'лучшие', 'браво',
            'отлично', 'замечательно', 'прекрасно', 'здорово', 'топ', 'огонь',
            'профессионал', 'рекомендую', 'хороший врач', 'хороший доктор',
            'врач от бога', 'золотые руки', 'помог', 'помогла', 'вылечил',
            'актуально', 'нужная тема', 'хорошая тема', 'полезная тема',
            'грамотный', 'опытный', 'рахмет', 'жарайсың'
        ];
        if (positivePatterns.some(pattern => textLower.includes(pattern))) {
            return { respond: true, type: 'ai' };
        }

        // Questions and inquiries → AI reply (high priority)
        const questionPatterns = [
            '?', 'как', 'где', 'сколько', 'можно', 'принимаете', 'работаете',
            'записаться', 'консультация', 'цена', 'стоимость', 'адрес',
            'телефон', 'номер', 'когда', 'какой', 'какая', 'подскажите',
            'помогите', 'посоветуйте', 'расскажите', 'объясните',
            'болит', 'боль', 'проблема', 'диагноз', 'лечение', 'симптом',
            'қалай', 'қайда', 'қанша'
        ];
        if (questionPatterns.some(pattern => textLower.includes(pattern))) {
            return { respond: true, type: 'ai' };
        }

        // Longer meaningful comments (>15 chars) → AI reply
        if (textLower.length > 15) {
            return { respond: true, type: 'ai' };
        }

        // Everything else → skip
        return { respond: false, type: null };
    }
}

module.exports = new YouTubeResponder();
