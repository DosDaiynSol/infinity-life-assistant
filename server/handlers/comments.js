const { OpenAI } = require('openai');
const instagramApi = require('../services/instagram-api');
const userManager = require('../services/user-manager');
const instagramDB = require('../services/instagram-database');

const openai = new OpenAI({
    apiKey: process.env.OPENAI_API_KEY
});

const CLINIC_PHONE = process.env.CLINIC_PHONE || '87470953952';
const OWN_ACCOUNT_ID = process.env.INSTAGRAM_PAGE_ID || '17841448174425966';

// Rejection categories
const REJECTION_REASONS = {
    EMOJI_ONLY: { code: 'emoji_only', label: 'Только эмодзи', icon: '😀' },
    TAG_ONLY: { code: 'tag_only', label: 'Тег друзей', icon: '👥' },
    TOO_SHORT: { code: 'too_short', label: 'Слишком короткий', icon: '📝' },
    OWN_REPLY: { code: 'own_reply', label: 'Свой ответ', icon: '🔄' },
    AI_DISABLED: { code: 'ai_disabled', label: 'ИИ отключен', icon: '🚫' },
    IRRELEVANT: { code: 'irrelevant', label: 'Не по теме', icon: '❌' },
    LLM_NO: { code: 'llm_no', label: 'LLM: нерелевантно', icon: '🤖' }
};

// Fallback template response (used if AI fails)
const TEMPLATE_RESPONSE = (username) => {
    const hour = new Date().getHours();
    let greeting = 'Добрый день';
    if (hour >= 5 && hour < 12) greeting = 'Доброе утро';
    else if (hour >= 18 || hour < 5) greeting = 'Добрый вечер';

    return `@${username} ${greeting}. Приглашаем вас на осмотр и консультацию. Записаться можно по номеру ${CLINIC_PHONE}`;
};

const TEMPLATE_RESPONSE_KZ = (username) => {
    const hour = new Date().getHours();
    let greeting = 'Қайырлы күн';
    if (hour >= 5 && hour < 12) greeting = 'Қайырлы таң';
    else if (hour >= 18 || hour < 5) greeting = 'Қайырлы кеш';

    return `@${username} ${greeting}. Сізді тексеру мен кеңеске шақырамыз. Жазылу үшін: ${CLINIC_PHONE}`;
};

/**
 * Evaluate comment with detailed rejection reason
 */
function quickFilter(comment) {
    const text = comment.text?.trim() || '';

    // Skip own account replies
    if (comment.userId === OWN_ACCOUNT_ID) {
        return { pass: false, reason: REJECTION_REASONS.OWN_REPLY };
    }

    // Skip if just tags (@username @another)
    if (/^(@\w+\s*)+$/.test(text)) {
        return { pass: false, reason: REJECTION_REASONS.TAG_ONLY };
    }

    // Skip if just emojis
    if (/^[\p{Emoji}\s]+$/u.test(text)) {
        return { pass: false, reason: REJECTION_REASONS.EMOJI_ONLY };
    }

    // Skip very short comments (less than 3 chars)
    if (text.length < 3) {
        return { pass: false, reason: REJECTION_REASONS.TOO_SHORT };
    }

    return { pass: true };
}

/**
 * LLM evaluation for relevance
 */
async function llmEvaluate(text) {
    try {
        const response = await openai.chat.completions.create({
            model: 'gpt-4o-mini',
            messages: [
                {
                    role: 'system',
                    content: `Ты анализируешь комментарии в Instagram клиники INFINITY LIFE (неврология, остеопатия, мануальная терапия, травматология, гинекология).

РЕЛЕВАНТНО (YES):
- Вопросы о здоровье, болях, симптомах
- Упоминание медицинских проблем
- Вопросы о записи, ценах, услугах
- Комплименты с вопросом ("круто, а как записаться?")
- Вопросы на казахском языке о здоровье/клинике

НЕ РЕЛЕВАНТНО (NO):
- Просто теги друзей
- Только эмодзи или короткие восклицания ("круто!", "класс!")
- Спам или реклама
- Оскорбления

Ответь ТОЛЬКО "YES" или "NO".`
                },
                {
                    role: 'user',
                    content: `Комментарий: "${text}"`
                }
            ],
            max_tokens: 5,
            temperature: 0
        });

        const answer = response.choices[0]?.message?.content?.trim().toUpperCase();
        return answer === 'YES';

    } catch (error) {
        console.error('[LLM Error]', error.message);
        // Fallback: check for medical keywords (Russian + Kazakh)
        const medicalKeywords = [
            'болит', 'боль', 'спина', 'сустав', 'грыжа', 'лечение', 'врач', 'запись', 'цена', 'сколько', 'помогите', 'записаться',
            'ауырады', 'ауру', 'жазылу', 'баға', 'қанша', 'дәрігер', 'емдеу', 'қалай'
        ];
        return medicalKeywords.some(kw => text.toLowerCase().includes(kw));
    }
}

/**
 * Detect if text is primarily Kazakh
 */
function isKazakh(text) {
    // Kazakh-specific characters and common words
    const kazakhChars = /[әіңғүұқөһ]/i;
    const kazakhWords = /\b(қалай|қанша|баға|жазылу|болады|керек|бар|жоқ|және|мен|сіз|біз|ол|бұл|осы|сол|айт|қой|деп|үшін|туралы|маған|саған|оған|бізге)\b/i;
    return kazakhChars.test(text) || kazakhWords.test(text);
}

/**
 * Generate smart AI response to the comment
 */
async function generateAIResponse(username, commentText, isKz) {
    const hour = new Date().getHours();
    let greetingRu = 'Добрый день';
    if (hour >= 5 && hour < 12) greetingRu = 'Доброе утро';
    else if (hour >= 18 || hour < 5) greetingRu = 'Добрый вечер';

    let greetingKz = 'Қайырлы күн';
    if (hour >= 5 && hour < 12) greetingKz = 'Қайырлы таң';
    else if (hour >= 18 || hour < 5) greetingKz = 'Қайырлы кеш';

    const systemPrompt = isKz ? `Сен INFINITY LIFE клиникасының Instagram-ындағы Assistant-сын. Клиника: неврология, остеопатия, мануальная терапия, травматология, гинекология. Телефон: ${CLINIC_PHONE}.

МАҢЫЗДЫ ЕРЕЖЕЛЕР:
- Әрқашан @${username} деп бастай, содан кейін "${greetingKz}" деп амандас
- Комментарийге нақты жауап бер - қайталанбасын
- Бағасы туралы сұраса: "Кеңес беру 5000₸-дан бастап" де
- Жазылу туралы сұраса: телефонды бер
- Белгілі бір ауруды немесе симптомды айтса — оған сәйкес мамандықты ұсын
- Жауапты қысқа ұста (2-3 сөйлем макс), тек қажет болса телефонды айт
- Тілі: ТЕК ҚАЗАҚ тілінде жауап бер
- Instagram-ға арналған: хэштег жок, формальды емес` : `Ты ассистент клиники INFINITY LIFE в Instagram. Клиника: неврология, остеопатия, мануальная терапия, травматология, гинекология. Телефон: ${CLINIC_PHONE}.

ВАЖНЫЕ ПРАВИЛА:
- Всегда начинай с @${username}, затем "${greetingRu}"
- Отвечай на конкретный вопрос — НЕ повторяй один шаблон
- Если спрашивают о цене: "Консультация от 5000₸"
- Если спрашивают о записи: дай телефон
- Если упомянута конкретная боль/симптом — предложи подходящего специалиста
- Ответ короткий (2-3 предложения макс), телефон давай только если уместно
- Стиль: дружелюбный, живой, НЕ как робот
- Для Instagram: без хэштегов, неформально`;

    try {
        const response = await openai.chat.completions.create({
            model: 'gpt-4o-mini',
            messages: [
                { role: 'system', content: systemPrompt },
                { role: 'user', content: `Комментарий пользователя: "${commentText}"` }
            ],
            max_tokens: 100,
            temperature: 0.7
        });

        return response.choices[0]?.message?.content?.trim() || null;
    } catch (error) {
        console.error('[AI Response Error]', error.message);
        return null;
    }
}

/**
 * Process batch of comments
 */
async function handleCommentBatch(comments) {
    const results = [];

    for (const comment of comments) {
        try {
            // Track user activity (now async)
            await userManager.trackActivity(comment.userId, 'comment', comment.username);

            // Check if AI is enabled for this user (now async)
            const aiEnabled = await userManager.isAIEnabled(comment.userId, 'comment');
            if (!aiEnabled) {
                const result = {
                    type: 'comment',
                    commentId: comment.commentId,
                    username: comment.username,
                    userId: comment.userId,
                    text: comment.text,
                    response: null,
                    responded: false,
                    rejection: REJECTION_REASONS.AI_DISABLED,
                    status: 'skipped'
                };
                results.push(result);
                await instagramDB.addHistory(result);
                console.log(`[Comment] AI disabled for @${comment.username}`);
                continue;
            }

            // Quick filter
            const filterResult = quickFilter(comment);
            if (!filterResult.pass) {
                const result = {
                    type: 'comment',
                    commentId: comment.commentId,
                    username: comment.username,
                    userId: comment.userId,
                    text: comment.text,
                    response: null,
                    responded: false,
                    rejection: filterResult.reason,
                    status: 'skipped'
                };
                results.push(result);
                await instagramDB.addHistory(result);
                console.log(`[Comment] Skipped @${comment.username}: ${filterResult.reason.label}`);
                continue;
            }

            // LLM evaluation
            const relevant = await llmEvaluate(comment.text);

            if (!relevant) {
                const result = {
                    type: 'comment',
                    commentId: comment.commentId,
                    username: comment.username,
                    userId: comment.userId,
                    text: comment.text,
                    response: null,
                    responded: false,
                    rejection: REJECTION_REASONS.LLM_NO,
                    status: 'skipped'
                };
                results.push(result);
                await instagramDB.addHistory(result);
                console.log(`[Comment] LLM rejected @${comment.username}: not relevant`);
                continue;
            }

            // Detect language
            const kz = isKazakh(comment.text);

            // Generate smart AI response
            let responseText = await generateAIResponse(comment.username || 'user', comment.text, kz);

            // Fallback to template if AI failed
            if (!responseText) {
                responseText = kz
                    ? TEMPLATE_RESPONSE_KZ(comment.username || 'user')
                    : TEMPLATE_RESPONSE(comment.username || 'user');
                console.log(`[Comment] AI failed, using template for @${comment.username}`);
            }

            const sent = await instagramApi.replyToComment(comment.commentId, responseText);

            const result = {
                type: 'comment',
                commentId: comment.commentId,
                username: comment.username,
                userId: comment.userId,
                text: comment.text,
                response: responseText,
                responded: sent,
                rejection: null,
                status: sent ? 'sent' : 'error'
            };
            results.push(result);
            await instagramDB.addHistory(result);

            console.log(`[Comment Reply] To @${comment.username} [${kz ? 'KZ' : 'RU'}]: ${responseText}`);

        } catch (error) {
            console.error(`[Comment Error] ${comment.commentId}:`, error.message);
            const errorResult = {
                type: 'comment',
                commentId: comment.commentId,
                username: comment.username,
                userId: comment.userId,
                text: comment.text,
                error: error.message,
                responded: false,
                status: 'error'
            };
            results.push(errorResult);
            await instagramDB.addHistory(errorResult);
        }
    }

    return results;
}

module.exports = { handleCommentBatch, REJECTION_REASONS };
