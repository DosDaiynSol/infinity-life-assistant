const { OpenAI } = require('openai');
const instagramApi = require('../services/instagram-api');
const userManager = require('../services/user-manager');
const instagramDB = require('../services/instagram-database');
const clinicData = require('../data/clinic_data.json');

const openai = new OpenAI({
    apiKey: process.env.OPENAI_API_KEY
});

const CLINIC_PHONE = process.env.CLINIC_PHONE || '87470953952';

/**
 * Check if phone number was already mentioned in conversation history
 */
function wasPhoneMentioned(history) {
    for (const msg of history) {
        if (msg.role === 'assistant' && msg.text && msg.text.includes(CLINIC_PHONE)) {
            return true;
        }
    }
    return false;
}

/**
 * OpenAI tool definition: AI can call this to end the conversation
 */
const AI_TOOLS = [
    {
        type: 'function',
        function: {
            name: 'end_conversation',
            description: 'Вызови эту функцию когда диалог подошёл к логическому завершению: клиент попрощался, поблагодарил, или больше не задаёт вопросов. После вызова бот перестанет отвечать этому клиенту. НЕ вызывай в середине разговора — только когда диалог реально закончен.',
            parameters: {
                type: 'object',
                properties: {
                    reason: {
                        type: 'string',
                        description: 'Краткая причина завершения (например: "клиент попрощался", "клиент поблагодарил")'
                    }
                },
                required: ['reason']
            }
        }
    }
];

/**
 * Build system prompt with clinic knowledge base
 */
function buildSystemPrompt(phoneAlreadyMentioned) {
    const doctors = clinicData.doctors.slice(0, 12).map(d =>
        `- ${d.name}: ${d.specialization.join(', ')} (${d.experience})`
    ).join('\n');

    const branches = clinicData.branches.map(b =>
        `- ${b.name}: ${b.address}, ${b.workingHours?.weekdays || ''}`
    ).join('\n');

    const services = clinicData.services.consultations.join(', ');
    const diagnostics = clinicData.services.diagnostics.join(', ');

    const phoneInstruction = phoneAlreadyMentioned
        ? `НОМЕР ТЕЛЕФОНА УЖЕ БЫЛ ОЗВУЧЕН РАНЕЕ В ЭТОМ ДИАЛОГЕ. НЕ ПОВТОРЯЙ ЕГО. Если нужно сослаться — скажи "по номеру, который я отправила выше" или "по тому же номеру".`
        : `Номер для записи: ${CLINIC_PHONE}. Можешь упомянуть его ОДИН раз, если это уместно. После этого больше не повторяй.`;

    return `Ты — администратор медицинской клиники INFINITY LIFE в Астане. Отвечаешь на сообщения клиентов в Instagram Direct. Ты живой человек, а не бот.

## ТВОЙ СТИЛЬ ОБЩЕНИЯ
- Пиши как реальный человек: тепло, коротко, по делу
- НЕ используй клише: "Мне очень жаль слышать", "Ваши переживания важны", "Спасибо за обращение", "Не стесняйтесь обращаться"
- НЕ используй канцеляризмы и официоз. Пиши просто и по-человечески
- 1-3 предложения максимум. Не растягивай
- Без markdown, без звёздочек, без эмодзи — это Instagram
- Отвечай на русском

## О КЛИНИКЕ
- ${clinicData.clinic.fullName}
- Сайт: ${clinicData.clinic.website}
- ${clinicData.clinic.stats.specialists} врачей, ${clinicData.clinic.stats.yearsExperience} лет опыта

## ФИЛИАЛЫ
${branches}

## ВРАЧИ (основные)
${doctors}

## УСЛУГИ
Консультации: ${services}
Диагностика (МРТ, КТ, рентген, УЗИ — всё есть!): ${diagnostics}

## ТЕЛЕФОН
${phoneInstruction}

## ЗАВЕРШЕНИЕ РАЗГОВОРА
У тебя есть функция end_conversation. Вызови её когда разговор подошёл к концу — клиент попрощался, поблагодарил, сказал "до свидания", или просто подтвердил без нового вопроса. При этом всё равно отправь короткий прощальный ответ (1 предложение). Не затягивай прощание, не благодари в ответ бесконечно.
НЕ вызывай end_conversation если клиент говорит "ок" или "спасибо" но продолжает задавать вопросы или описывать проблему.

## ЖАЛОБЫ И НЕГАТИВ
Если клиент жалуется на врача, описывает негативный опыт лечения или травму:
- НЕ ЗАЩИЩАЙ врача. НЕ называй его "высококвалифицированным специалистом"
- НЕ предлагай записаться к вам на консультацию
- Прими проблему всерьёз и с сочувствием (но без шаблонных фраз)
- Предложи связать с руководством клиники для разбора ситуации
- Пример: "Это очень серьёзно, я передам вашу информацию руководству. Если хотите, могу дать прямой контакт главного врача для личного разговора."

## ПРИМЕРЫ ХОРОШЕГО ТОНА
Клиент: "Болит спина уже неделю"
→ "Это может быть связано с позвоночником. У нас есть неврологи и мануальные терапевты — запишитесь по ${CLINIC_PHONE}, подберём специалиста."

Клиент: "Где вы находитесь?"
→ "У нас два филиала: Кабанбай батыра 40 и Жанайдар Жирентаев 4. Работаем с 8 до 21."

Клиент: "Есть МРТ?"
→ "Да, МРТ есть. Звоните ${CLINIC_PHONE}, вам подскажут ближайшее свободное время."

Клиент: "Сколько стоит приём?"
→ "Зависит от специалиста. Позвоните ${CLINIC_PHONE}, вам всё подробно расскажут."`;
}

/**
 * Generate AI response with conversation memory
 */
async function generateDMResponse(userId, newMessages) {
    try {
        // Get conversation history (now async)
        const history = await userManager.getConversation(userId, 10);

        // Check if phone was already mentioned in prior messages
        const phoneAlreadyMentioned = wasPhoneMentioned(history);

        // Build messages array for OpenAI
        const messages = [
            { role: 'system', content: buildSystemPrompt(phoneAlreadyMentioned) }
        ];

        // Add conversation history
        for (const msg of history) {
            messages.push({
                role: msg.role === 'user' ? 'user' : 'assistant',
                content: msg.text
            });
        }

        // Add new messages
        const userText = newMessages.map(m => m.text).join('\n');
        messages.push({ role: 'user', content: userText });

        // Save user message to memory
        await userManager.addMessage(userId, 'user', userText);

        const response = await openai.chat.completions.create({
            model: 'gpt-4o-mini',
            messages,
            max_tokens: 250,
            temperature: 0.7,
            tools: AI_TOOLS,
            tool_choice: 'auto'
        });

        const choice = response.choices[0];
        const reply = choice?.message?.content?.trim() || '';

        // Check if AI decided to end conversation via function call
        const toolCalls = choice?.message?.tool_calls || [];
        const endCall = toolCalls.find(tc => tc.function?.name === 'end_conversation');

        // Save assistant reply to memory
        if (reply) {
            await userManager.addMessage(userId, 'assistant', reply);
        }

        // If AI called end_conversation — disable DM AI for this user
        if (endCall) {
            let reason = 'unknown';
            try { reason = JSON.parse(endCall.function.arguments).reason; } catch (e) { }
            await userManager.updateUser(userId, { dm_enabled: false });
            console.log(`[DM] AI self-disabled for ${userId} — reason: ${reason}`);
        }

        return reply || 'Всего доброго!';

    } catch (error) {
        console.error('[DM AI Error]', error.message);
        return `Здравствуйте! Для записи и консультации позвоните ${CLINIC_PHONE}.`;
    }
}

/**
 * Process batch of DMs
 */
async function handleDMBatch(dms) {
    const results = [];

    // Group DMs by sender
    const dmsByUser = {};
    for (const dm of dms) {
        const key = dm.senderId;
        if (!dmsByUser[key]) {
            dmsByUser[key] = [];
        }
        dmsByUser[key].push(dm);
    }

    // Process each user's messages
    for (const [senderId, userDMs] of Object.entries(dmsByUser)) {
        try {
            // Get existing user or create new one (now async)
            let user = await userManager.getUser(senderId);

            // If user doesn't have username, try to fetch it
            if (!user.username) {
                console.log(`[DM] Fetching username for ${senderId}...`);
                const profile = await instagramApi.getUserProfile(senderId);
                if (profile?.username) {
                    await userManager.updateUser(senderId, { username: profile.username, name: profile.name });
                    console.log(`[DM] Got username: @${profile.username}`);
                    user.username = profile.username;
                }
            }

            // Track user activity
            await userManager.trackActivity(senderId, 'dm', user.username);

            // Check if AI is enabled for this user (now async)
            const aiEnabled = await userManager.isAIEnabled(senderId, 'dm');
            if (!aiEnabled) {
                const result = {
                    senderId,
                    username: user.username,
                    text: userDMs.map(dm => dm.text).join('\n'),
                    response: null,
                    responded: false,
                    rejection: { code: 'ai_disabled', label: 'ИИ отключен', icon: '🚫' },
                    status: 'skipped',
                    type: 'dm'
                };
                results.push(result);

                // Save to history
                await instagramDB.addHistory(result);

                console.log(`[DM] AI disabled for ${user.username || senderId}`);
                continue;
            }

            // Generate response with memory
            const responseText = await generateDMResponse(senderId, userDMs);

            // Send reply
            const sent = await instagramApi.sendDirectMessage(senderId, responseText);

            // Refresh user to get latest data
            user = await userManager.getUser(senderId);

            const result = {
                senderId,
                username: user.username,
                text: userDMs.map(dm => dm.text).join('\n'),
                response: responseText,
                responded: sent,
                rejection: null,
                status: sent ? 'sent' : 'error',
                type: 'dm'
            };
            results.push(result);

            // Save to history in Supabase
            await instagramDB.addHistory(result);

            console.log(`[DM Reply] To ${user.username || senderId}: ${responseText.substring(0, 80)}...`);

        } catch (error) {
            console.error(`[DM Error] ${senderId}:`, error.message);
            const errorResult = {
                senderId,
                text: userDMs.map(dm => dm.text).join('\n'),
                error: error.message,
                responded: false,
                status: 'error',
                type: 'dm'
            };
            results.push(errorResult);

            // Save error to history
            await instagramDB.addHistory(errorResult);
        }
    }

    return results;
}

module.exports = { handleDMBatch, generateDMResponse };
