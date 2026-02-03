const OpenAI = require('openai');
const fs = require('fs');
const path = require('path');

// Load clinic data
const clinicData = JSON.parse(
    fs.readFileSync(path.join(__dirname, '../../data/clinic_data.json'), 'utf8')
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

    // Determine if comment needs a response
    shouldRespond(comment) {
        const text = comment.textOriginal?.toLowerCase() || comment.text?.toLowerCase() || '';

        // Skip very short comments (likely emojis or single words)
        if (text.length < 5) return false;

        // Skip spam-like comments
        const spamPatterns = [
            'подписка', 'subscribe', 'check my channel', 'посмотри мой канал',
            'http://', 'https://', '.com', '.ru', '.kz'
        ];
        if (spamPatterns.some(pattern => text.includes(pattern))) return false;

        // Prioritize questions and meaningful comments
        const priorityPatterns = [
            '?', 'как', 'где', 'сколько', 'можно', 'принимаете', 'работаете',
            'записаться', 'консультация', 'цена', 'стоимость', 'адрес',
            'спасибо', 'помогло', 'полезно', 'интересно'
        ];

        return priorityPatterns.some(pattern => text.includes(pattern)) || text.length > 20;
    }
}

module.exports = new YouTubeResponder();
