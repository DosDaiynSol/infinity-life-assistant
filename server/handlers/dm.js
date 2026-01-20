const { OpenAI } = require('openai');
const instagramApi = require('../services/instagram-api');
const userManager = require('../services/user-manager');
const clinicData = require('../../data/clinic_data.json');

const openai = new OpenAI({
    apiKey: process.env.OPENAI_API_KEY
});

const CLINIC_PHONE = process.env.CLINIC_PHONE || '87470953952';

/**
 * Build system prompt with clinic knowledge base
 */
function buildSystemPrompt() {
    const doctors = clinicData.doctors.slice(0, 12).map(d =>
        `- ${d.name}: ${d.specialization.join(', ')} (${d.experience})`
    ).join('\n');

    const branches = clinicData.branches.map(b =>
        `- ${b.name}: ${b.address}, ${b.workingHours?.weekdays || ''}`
    ).join('\n');

    const services = clinicData.services.consultations.join(', ');

    return `Ты — ассистент медицинской клиники INFINITY LIFE в Астане. Отвечаешь на сообщения в Instagram Direct.

## О КЛИНИКЕ
- Название: ${clinicData.clinic.fullName}
- Телефон: ${clinicData.clinic.contactPhone}
- Сайт: ${clinicData.clinic.website}
- Врачей: ${clinicData.clinic.stats.specialists}
- Опыт: ${clinicData.clinic.stats.yearsExperience} лет

## ФИЛИАЛЫ
${branches}

## ВРАЧИ (основные)
${doctors}

## КОНСУЛЬТАЦИИ
${services}

## ПРАВИЛА
1. Отвечай вежливо и кратко (2-3 предложения)
2. Помни контекст предыдущих сообщений
3. ЛЮБЫЕ ДЕЙСТВИЯ (запись, цены, выбор врача) → номер ${CLINIC_PHONE}
4. Не ставь диагнозы
5. Отвечай на русском
6. Без markdown (это Instagram)

## ПРИМЕРЫ
User: "Болит спина"
→ "Здравствуйте! Боли в спине могут лечить наши мануальные терапевты и неврологи. Для записи на консультацию позвоните ${CLINIC_PHONE}."

User: "Где находитесь?"
→ "У нас 2 филиала: пр. Кабанбай батыра 40 и ул. Жанайдар Жирентаев 4. Работаем с 08:00 до 21:00. Записаться: ${CLINIC_PHONE}"`;
}

/**
 * Generate AI response with conversation memory
 */
async function generateDMResponse(userId, newMessages) {
    try {
        // Get conversation history
        const history = userManager.getConversation(userId, 10);

        // Build messages array for OpenAI
        const messages = [
            { role: 'system', content: buildSystemPrompt() }
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
        userManager.addMessage(userId, 'user', userText);

        const response = await openai.chat.completions.create({
            model: 'gpt-4o-mini',
            messages,
            max_tokens: 250,
            temperature: 0.7
        });

        const reply = response.choices[0]?.message?.content?.trim();

        // Save assistant reply to memory
        userManager.addMessage(userId, 'assistant', reply);

        return reply;

    } catch (error) {
        console.error('[DM AI Error]', error.message);
        return `Здравствуйте! Спасибо за обращение в клинику INFINITY LIFE. Для записи и консультации позвоните ${CLINIC_PHONE}.`;
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
            // Track user activity
            userManager.trackActivity(senderId, 'dm');

            // Check if AI is enabled for this user
            if (!userManager.isAIEnabled(senderId, 'dm')) {
                results.push({
                    senderId,
                    messages: userDMs.map(dm => dm.text),
                    response: null,
                    responded: false,
                    rejection: { code: 'ai_disabled', label: 'ИИ отключен', icon: '🚫' },
                    status: 'skipped'
                });
                console.log(`[DM] AI disabled for ${senderId}`);
                continue;
            }

            // Generate response with memory
            const responseText = await generateDMResponse(senderId, userDMs);

            // Send reply
            const sent = await instagramApi.sendDirectMessage(senderId, responseText);

            results.push({
                senderId,
                messages: userDMs.map(dm => dm.text),
                response: responseText,
                responded: sent,
                rejection: null,
                status: sent ? 'sent' : 'error'
            });

            console.log(`[DM Reply] To ${senderId}: ${responseText.substring(0, 80)}...`);

        } catch (error) {
            console.error(`[DM Error] ${senderId}:`, error.message);
            results.push({
                senderId,
                messages: userDMs.map(dm => dm.text),
                error: error.message,
                responded: false,
                status: 'error'
            });
        }
    }

    return results;
}

module.exports = { handleDMBatch, generateDMResponse };
