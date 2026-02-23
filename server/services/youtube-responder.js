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

        let videoContext = '';
        if (videoInfo) {
            videoContext = `\nКОНТЕКСТ ВИДЕО: "${videoInfo.title}"`;
        }

        return `Ты SMM-менеджер YouTube канала клиники "${clinic.name}" (${clinic.city}).
${videoContext}

ГЛАВНОЕ ПРАВИЛО: Пиши КАК ЖИВОЙ ЧЕЛОВЕК, а не как бот. Коротко и тепло.

СТИЛЬ ОТВЕТОВ:
- МАКСИМУМ 1 предложение (5-15 слов)
- Пиши как обычный человек в соцсетях, не как корпорация
- Можно 1 эмодзи, не больше
- НЕ начинай с "Спасибо за комментарий/отзыв"
- НЕ используй слова: "наши специалисты", "не стесняйтесь", "будем рады"

КОГДА ДАВАТЬ ТЕЛЕФОН ${clinic.contactPhoneShort}:
- ТОЛЬКО если спрашивают: запись, цена, стоимость, адрес, как попасть, где находитесь
- Во всех остальных случаях — НЕ давать телефон

ПРИМЕРЫ ПРАВИЛЬНЫХ ОТВЕТОВ:
- На "Спасибо большое!" → "Рады что помогло! ❤️"
- На "Молодец доктор" → "Передадим, ей будет приятно 🙏"
- На "У меня тоже так щёлкает" → "Это бывает! Если беспокоит — обращайтесь 🙏"  
- На "Крутое упражнение" → "Да, очень эффективное! 💪"
- На "Сколько стоит приём?" → "Звоните ${clinic.contactPhoneShort}, подскажут всё 🙏"
- На "Где вы находитесь?" → "Мы в Астане! Запись: ${clinic.contactPhoneShort}"
- На критику → НЕ ОТВЕЧАТЬ (вернёшь пустую строку)

ЗАПРЕЩЕНО:
- Длинные ответы (больше 1 предложения)
- Медицинские советы и диагностика
- Навязывание записи когда не просят
- Фразы-штампы ИИ

Отвечай на языке комментария (русский/казахский).`;
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

        // Skip negative/troll/hate comments — don't engage
        const negativePatterns = [
            'мошен', 'обман', 'шарлатан', 'развод', 'лохотрон', 'кидал',
            'врёт', 'врет', 'вруш', 'фигня', 'чушь', 'бред', 'хрен',
            'дерьм', 'гавно', 'говно', 'тупо', 'отстой', 'ужас',
            'scam', 'fake', 'fraud', 'bullshit'
        ];
        if (negativePatterns.some(pattern => textLower.includes(pattern))) {
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
