/**
 * Threads Keyword Search Service
 * Main orchestration for searching and responding to potential patients
 */

const threadsAPI = require('./threads-api');
const threadsDB = require('./threads-database');
const OpenAI = require('openai');
const fs = require('fs');
const path = require('path');

// Load keywords with fallback
let keywordsData;
try {
    const keywordsPath = path.join(__dirname, '../../data/threads_keywords.json');
    keywordsData = JSON.parse(fs.readFileSync(keywordsPath, 'utf-8'));
} catch (e) {
    console.log('[Threads] Keywords file not found, using defaults');
    keywordsData = {
        keywords: [
            'остеопат астана', 'ищу остеопата', 'посоветуйте остеопата',
            'невролог астана', 'детский невролог астана',
            'мануальный терапевт астана', 'мануальная терапия',
            'боль в спине астана', 'болит спина', 'болит поясница',
            'грыжа позвоночника', 'межпозвоночная грыжа',
            'сколиоз астана', 'артроз астана',
            'зрр астана', 'задержка речи', 'аутизм астана',
            'посоветуйте врача астана', 'посоветуйте клинику'
        ]
    };
}

// Load clinic data for context
let clinicData;
try {
    const clinicPath = path.join(__dirname, '../../data/clinic_data.json');
    clinicData = JSON.parse(fs.readFileSync(clinicPath, 'utf-8'));
} catch (e) {
    console.log('[Threads] Clinic data not found, using defaults');
    clinicData = { clinic: { name: 'INFINITY LIFE', contactPhone: '87470953952' } };
}

class ThreadsKeywordSearch {
    constructor() {
        this.openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

        // Rate limits
        this.config = {
            maxRepliesPerDay: 10,
            minReplyInterval: 10 * 60 * 1000, // 10 minutes
            delayBetweenRequests: 5000, // 5 seconds
            cyclesPerDay: 3,
            workingHoursStart: 8,
            workingHoursEnd: 21
        };

        this.lastReplyTime = 0;
    }

    /**
     * Get all keywords flattened
     */
    getAllKeywords() {
        const allKeywords = [];
        for (const category of Object.values(keywordsData.keywords)) {
            // Check if category is an object with items array
            if (category && Array.isArray(category.items)) {
                allKeywords.push(...category.items);
            }
        }
        return allKeywords;
    }

    /**
     * Get keywords for specific cycle (0, 1, or 2)
     */
    getKeywordsForCycle(cycleIndex) {
        const allKeywords = this.getAllKeywords();
        const chunkSize = Math.ceil(allKeywords.length / this.config.cyclesPerDay);
        const start = cycleIndex * chunkSize;
        return allKeywords.slice(start, start + chunkSize);
    }

    /**
     * Check if within working hours
     */
    isWorkingHours() {
        const hour = new Date().getHours();
        return hour >= this.config.workingHoursStart && hour < this.config.workingHoursEnd;
    }

    /**
     * Check if can send reply today
     */
    async canReplyToday() {
        const repliesCount = await threadsDB.getRepliesCountToday();
        return repliesCount < this.config.maxRepliesPerDay;
    }

    /**
     * Check if enough time passed since last reply
     */
    canReplyNow() {
        return Date.now() - this.lastReplyTime >= this.config.minReplyInterval;
    }

    /**
     * Run a search cycle
     * @param {number} cycleIndex - Cycle index (0, 1, or 2)
     */
    async runSearchCycle(cycleIndex = 0) {
        console.log(`[Threads Search] Starting cycle ${cycleIndex + 1}/3`);

        const keywords = this.getKeywordsForCycle(cycleIndex);
        console.log(`[Threads Search] Searching ${keywords.length} keywords`);

        for (const keyword of keywords) {
            try {
                // Search posts
                const posts = await threadsAPI.keywordSearch(keyword, {
                    search_type: 'RECENT',
                    since: threadsAPI.get24HoursAgo(),
                    limit: 50
                });

                // Save new posts to database
                const newCount = await threadsDB.saveNewPosts(posts, keyword);

                // Log API request
                await threadsDB.logApiRequest(keyword, posts.length, newCount);

                if (newCount > 0) {
                    console.log(`[Threads Search] "${keyword}": ${newCount} new posts found`);
                }

                // Delay between requests
                await threadsAPI.sleep(this.config.delayBetweenRequests);
            } catch (error) {
                console.error(`[Threads Search] Error for "${keyword}":`, error.message);
            }
        }

        // Process new posts
        await this.processNewPosts();

        console.log(`[Threads Search] Cycle ${cycleIndex + 1} completed`);
    }

    /**
     * Process all new posts - validate and reply
     */
    async processNewPosts() {
        if (!this.isWorkingHours()) {
            console.log('[Threads Search] Outside working hours, skipping replies');
            return;
        }

        const newPosts = await threadsDB.getPostsByStatus('new', 20);
        console.log(`[Threads Search] Processing ${newPosts.length} new posts`);

        for (const post of newPosts) {
            // Step 1: Rule-based pre-filter (FREE - no tokens)
            const preFilter = this.preFilterPost(post);
            if (!preFilter.pass) {
                await threadsDB.updatePostStatus(post.id, 'skipped', {
                    validation_result: { valid: false, reason: preFilter.reason, prefiltered: true }
                });
                console.log(`[Threads Search] Pre-filtered: ${preFilter.reason}`);
                continue;
            }

            // Step 2: LLM validation (only for posts that passed pre-filter)
            const validation = await this.validatePost(post);

            if (!validation.valid) {
                await threadsDB.updatePostStatus(post.id, 'skipped', {
                    validation_result: validation
                });
                continue;
            }

            // Check if we can reply
            if (!await this.canReplyToday()) {
                console.log('[Threads Search] Daily reply limit reached');
                await threadsDB.updatePostStatus(post.id, 'validated', {
                    validation_result: validation
                });
                continue;
            }

            if (!this.canReplyNow()) {
                console.log('[Threads Search] Waiting for reply interval');
                await threadsDB.updatePostStatus(post.id, 'validated', {
                    validation_result: validation
                });
                continue;
            }

            // Generate and send reply
            try {
                const replyText = await this.generateReply(post, validation);
                const replyId = await threadsAPI.sendReply(post.post_id, replyText);

                if (replyId) {
                    this.lastReplyTime = Date.now();
                    await threadsDB.updatePostStatus(post.id, 'replied', {
                        validation_result: validation,
                        reply_text: replyText,
                        reply_id: replyId
                    });
                    console.log(`[Threads Search] Replied to @${post.username}: ${replyText.substring(0, 50)}...`);
                } else {
                    await threadsDB.updatePostStatus(post.id, 'validated', {
                        validation_result: validation
                    });
                }
            } catch (error) {
                console.error(`[Threads Search] Reply error:`, error.message);
                await threadsDB.updatePostStatus(post.id, 'validated', {
                    validation_result: validation
                });
            }
        }
    }

    /**
     * Rule-based pre-filter (FREE - no tokens)
     * Filters out obvious spam/irrelevant posts
     */
    preFilterPost(post) {
        const text = (post.text || '').toLowerCase();

        // Spam indicators - skip these
        const spamPatterns = [
            /продаю|продам|продажа|продаётся/,     // selling
            /скидк[аи]|акция|распродажа/,          // discounts/sales  
            /подписывайтесь|подпишись|лайк/,       // follow/like begging
            /реклама|рекламный/,                   // advertising
            /казино|ставки|букмекер/,              // gambling
            /криптовалют|биткоин|трейдинг/,        // crypto
            /заработ[окай]|доход|пассивный/,       // income schemes
            /модел[ья]|фотосессия|портфолио/,      // modeling
            /цветы|цветочн|букет/,                 // flowers
            /адвокат|юрист|нотариус/,              // legal
            /репетитор|курсы|обучение/,            // tutoring
            /маникюр|педикюр|ресниц/,              // beauty
            /ремонт квартир|строительство/,        // construction
            /такси|доставка|курьер/,               // delivery
            /пеньюар|нижнее белье|одежда/,         // clothing
        ];

        for (const pattern of spamPatterns) {
            if (pattern.test(text)) {
                return { pass: false, reason: `Спам/реклама: ${pattern.source}` };
            }
        }

        // Must contain health-related keywords
        const healthKeywords = [
            'врач', 'доктор', 'клиник', 'больниц', 'медицин',
            'боль', 'болит', 'лечени', 'лечить', 'диагноз',
            'спин', 'позвоноч', 'грыж', 'сколиоз', 'артроз', 'артрит',
            'невролог', 'остеопат', 'мануальн', 'терапевт', 'ревматолог',
            'массаж', 'физиотерап', 'реабилитац',
            'мрт', 'узи', 'рентген', 'томограф',
            'ребёнок', 'ребенок', 'детск', 'зпр', 'зрр', 'аутизм', 'логопед',
            'посоветуйте', 'подскажите', 'порекомендуйте', 'ищу',
            'голов', 'мигрен', 'давлени', 'сустав', 'колен', 'шея'
        ];

        const hasHealthKeyword = healthKeywords.some(kw => text.includes(kw));
        if (!hasHealthKeyword) {
            return { pass: false, reason: 'Нет медицинских ключевых слов' };
        }

        // Check for question indicators
        const isQuestion = text.includes('?') ||
            /кто знает|подскажите|посоветуйте|порекомендуйте|где найти|ищу|нужен/.test(text);

        if (!isQuestion) {
            return { pass: false, reason: 'Не вопрос/не ищет рекомендацию' };
        }

        // Passed pre-filter - send to LLM
        return { pass: true };
    }

    /**
     * Validate if post is relevant for the clinic
     */
    async validatePost(post) {
        const prompt = `
Ты - модератор для клиники INFINITY LIFE в Астане.

Проанализируй пост из Threads и определи, подходит ли он для ответа от клиники.

ПОСТ:
"${post.text}"

Автор: @${post.username}

КРИТЕРИИ ВАЛИДНОСТИ:
1. Автор ищет врача/клинику в Астане (или просто врача, без указания другого города)
2. Запрос касается услуг клиники: остеопатия, неврология, мануальная терапия, лечение грыж, сколиоза, артроза, ЛОР, гинекология, травматология, МРТ, КТ, УЗИ, детские проблемы (ЗРР, ЗПР, аутизм)
3. Это НЕ реклама, НЕ спам, НЕ шутка
4. Автор задаёт вопрос или ищет рекомендацию

ОТВЕТЬ СТРОГО В JSON:
{
  "valid": true/false,
  "reason": "краткое объяснение на русском",
  "matchedService": "название услуги если valid=true, иначе null"
}`;

        try {
            const response = await this.openai.chat.completions.create({
                model: 'gpt-4o-mini',
                messages: [{ role: 'user', content: prompt }],
                response_format: { type: 'json_object' },
                temperature: 0.3
            });

            return JSON.parse(response.choices[0].message.content);
        } catch (error) {
            console.error('[Threads Search] Validation error:', error.message);
            return { valid: false, reason: 'Ошибка валидации' };
        }
    }

    /**
     * Generate personalized reply
     */
    async generateReply(post, validation) {
        const clinic = clinicData.clinic;

        const prompt = `
Ты - дружелюбный представитель клиники INFINITY LIFE в Астане.

ПОСТ на который отвечаем:
"${post.text}"

Автор ищет: ${validation.matchedService}

ДАННЫЕ КЛИНИКИ:
- Название: ${clinic.name}
- Телефон: ${clinic.contactPhone}
- Instagram: ${clinic.instagram}
- Адреса: пр. Кабанбай батыра 40, ул. Жанайдар Жирентаев 4

ПРАВИЛА ОТВЕТА:
1. Начни с приветствия (Добрый день! 👋)
2. Кратко упомяни релевантную услугу
3. ОБЯЗАТЕЛЬНО укажи телефон: ${clinic.contactPhone}
4. Пригласи на консультацию
5. Будь дружелюбным, не навязчивым
6. Максимум 280 символов
7. Не используй хештеги

Сгенерируй ответ (только текст ответа, без кавычек):`;

        try {
            const response = await this.openai.chat.completions.create({
                model: 'gpt-4o-mini',
                messages: [{ role: 'user', content: prompt }],
                temperature: 0.7,
                max_tokens: 150
            });

            return response.choices[0].message.content.trim();
        } catch (error) {
            console.error('[Threads Search] Generate reply error:', error.message);
            // Fallback reply
            return `Добрый день! 👋 В INFINITY LIFE можем помочь с ${validation.matchedService}. Запишитесь: ${clinic.contactPhone} 🙏`;
        }
    }

    /**
     * Get statistics
     */
    async getStats() {
        return await threadsDB.getDailyStats();
    }

    /**
     * Manual trigger for testing
     */
    async runManualCycle() {
        console.log('[Threads Search] Manual cycle triggered');
        await this.runSearchCycle(0);
        return await this.getStats();
    }
}

module.exports = new ThreadsKeywordSearch();
