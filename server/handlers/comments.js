const { OpenAI } = require('openai');
const instagramApi = require('../services/instagram-api');
const userManager = require('../services/user-manager');

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

// Template response for relevant comments
const TEMPLATE_RESPONSE = (username) => {
    const hour = new Date().getHours();
    let greeting = 'Добрый день';
    if (hour >= 5 && hour < 12) greeting = 'Доброе утро';
    else if (hour >= 18 || hour < 5) greeting = 'Добрый вечер';

    return `@${username} ${greeting}. Приглашаем вас на осмотр и консультацию. Записаться можно по номеру ${CLINIC_PHONE}`;
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
        // Fallback: check for medical keywords
        const medicalKeywords = ['болит', 'боль', 'спина', 'сустав', 'грыжа', 'лечение', 'врач', 'запись', 'цена', 'сколько', 'помогите', 'записаться'];
        return medicalKeywords.some(kw => text.toLowerCase().includes(kw));
    }
}

/**
 * Process batch of comments
 */
async function handleCommentBatch(comments) {
    const results = [];

    for (const comment of comments) {
        try {
            // Track user activity
            userManager.trackActivity(comment.userId, 'comment', comment.username);

            // Check if AI is enabled for this user
            if (!userManager.isAIEnabled(comment.userId, 'comment')) {
                results.push({
                    commentId: comment.commentId,
                    username: comment.username,
                    userId: comment.userId,
                    text: comment.text,
                    response: null,
                    responded: false,
                    rejection: REJECTION_REASONS.AI_DISABLED,
                    status: 'skipped'
                });
                console.log(`[Comment] AI disabled for @${comment.username}`);
                continue;
            }

            // Quick filter
            const filterResult = quickFilter(comment);
            if (!filterResult.pass) {
                results.push({
                    commentId: comment.commentId,
                    username: comment.username,
                    userId: comment.userId,
                    text: comment.text,
                    response: null,
                    responded: false,
                    rejection: filterResult.reason,
                    status: 'skipped'
                });
                console.log(`[Comment] Skipped @${comment.username}: ${filterResult.reason.label}`);
                continue;
            }

            // LLM evaluation
            const relevant = await llmEvaluate(comment.text);

            if (!relevant) {
                results.push({
                    commentId: comment.commentId,
                    username: comment.username,
                    userId: comment.userId,
                    text: comment.text,
                    response: null,
                    responded: false,
                    rejection: REJECTION_REASONS.LLM_NO,
                    status: 'skipped'
                });
                console.log(`[Comment] LLM rejected @${comment.username}: not relevant`);
                continue;
            }

            // Generate and send response
            const responseText = TEMPLATE_RESPONSE(comment.username || 'user');
            const sent = await instagramApi.replyToComment(comment.commentId, responseText);

            results.push({
                commentId: comment.commentId,
                username: comment.username,
                userId: comment.userId,
                text: comment.text,
                response: responseText,
                responded: sent,
                rejection: null,
                status: sent ? 'sent' : 'error'
            });

            console.log(`[Comment Reply] To @${comment.username}: ${responseText}`);

        } catch (error) {
            console.error(`[Comment Error] ${comment.commentId}:`, error.message);
            results.push({
                commentId: comment.commentId,
                username: comment.username,
                userId: comment.userId,
                text: comment.text,
                error: error.message,
                responded: false,
                status: 'error'
            });
        }
    }

    return results;
}

module.exports = { handleCommentBatch, REJECTION_REASONS };
