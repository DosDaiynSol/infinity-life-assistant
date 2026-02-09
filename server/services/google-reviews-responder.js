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

class GoogleReviewsResponder {
    constructor() {
        this.clinicData = clinicData;
    }

    // Build system prompt with clinic context
    buildSystemPrompt() {
        const clinic = this.clinicData.clinic;
        const services = this.clinicData.services;
        const treatments = this.clinicData.treatments;

        return `Ты — AI-ассистент медицинского центра "${clinic.name}".
Твоя задача — отвечать на отзывы пациентов на Google Maps от имени клиники.

ИНФОРМАЦИЯ О КЛИНИКЕ:
- Название: ${clinic.fullName}
- Город: ${clinic.city}
- Телефон для записи: ${clinic.contactPhoneShort}
- WhatsApp: ${clinic.whatsapp}
- Сайт: ${clinic.website}
- Филиалы: ${this.clinicData.branches.map(b => b.address).join('; ')}

УСЛУГИ:
- Консультации: ${services.consultations.join(', ')}
- Диагностика: ${services.diagnostics.join(', ')}
- Физиотерапия: ${services.physiotherapy.map(p => typeof p === 'string' ? p : p.name).join(', ')}

НАПРАВЛЕНИЯ ЛЕЧЕНИЯ:
${treatments.join(', ')}

ПРАВИЛА ОТВЕТОВ НА ОТЗЫВЫ:

ДЛЯ ПОЛОЖИТЕЛЬНЫХ ОТЗЫВОВ (4-5 звёзд):
1. Поблагодари за отзыв и доверие
2. Отметь конкретные детали из отзыва
3. Пожелай здоровья
4. Пригласи снова при необходимости

ДЛЯ НЕЙТРАЛЬНЫХ ОТЗЫВОВ (3 звезды):
1. Поблагодари за обратную связь
2. Извинись за неудобства если были
3. Попроси связаться для решения вопроса

ДЛЯ НЕГАТИВНЫХ ОТЗЫВОВ (1-2 звезды):
1. Выразь сожаление о негативном опыте
2. Извинись за неудобства
3. Предложи связаться для разрешения ситуации
4. НЕ оправдывайся, НЕ вступай в спор

ОБЩИЕ ПРАВИЛА:
1. Отвечай на языке отзыва (русский, казахский или английский)
2. Будь искренним и эмпатичным
3. Длина ответа: 3-5 предложений
4. Не используй шаблонные фразы
5. ОБЯЗАТЕЛЬНО в конце каждого ответа добавляй контакты:
   "📞 Запись: ${clinic.contactPhoneShort}
   💬 WhatsApp: ${clinic.whatsapp}
   🌐 ${clinic.website}"
6. Подписывайся перед контактами: "С уважением, команда INFINITY LIFE"`;
    }

    // Generate AI response for a review
    async generateResponse(review) {
        try {
            const systemPrompt = this.buildSystemPrompt();

            const starRatingText = {
                'FIVE': '5 звёзд (отличный)',
                'FOUR': '4 звезды (хороший)',
                'THREE': '3 звезды (нейтральный)',
                'TWO': '2 звезды (негативный)',
                'ONE': '1 звезда (очень негативный)'
            };

            const userPrompt = `ОТЗЫВ НА GOOGLE MAPS:
Автор: ${review.reviewer?.displayName || 'Аноним'}
Рейтинг: ${starRatingText[review.starRating] || review.starRating}
Текст отзыва: "${review.comment}"

Напиши персонализированный ответ от имени клиники INFINITY LIFE:`;

            const completion = await openai.chat.completions.create({
                model: 'gpt-4o-mini',
                messages: [
                    { role: 'system', content: systemPrompt },
                    { role: 'user', content: userPrompt }
                ],
                max_tokens: 300,
                temperature: 0.7
            });

            const response = completion.choices[0]?.message?.content?.trim();
            console.log(`[Google Reviews Responder] Generated response for ${review.starRating} review from ${review.reviewer?.displayName}`);
            return response;
        } catch (error) {
            console.error('[Google Reviews Responder] Error generating response:', error.message);
            throw error;
        }
    }

    // Determine if review needs a response
    shouldRespond(review) {
        // Skip if no comment text
        if (!review.comment || review.comment.trim().length < 3) {
            return { respond: false, reason: 'no_text' };
        }

        // Always respond to reviews with comments
        return { respond: true, reason: 'has_comment' };
    }

    // Get star rating as number
    getStarRatingNumber(starRating) {
        const ratings = {
            'ONE': 1,
            'TWO': 2,
            'THREE': 3,
            'FOUR': 4,
            'FIVE': 5
        };
        return ratings[starRating] || 0;
    }
}

module.exports = new GoogleReviewsResponder();
