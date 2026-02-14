/**
 * Threads Keyword Search Service v2.0
 * НОВЫЙ АЛГОРИТМ:
 * 1. Поиск по ОДНОМУ слову (остеопат, невролог, грыжа)
 * 2. Локальная фильтрация по городу (Астана - да, другие города - нет)
 * 3. Проверка на вопрос/запрос рекомендации
 * 4. LLM валидация только для прошедших фильтры
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
        searchKeywords: {
            medical: { items: ['остеопат', 'невролог', 'мануальщик'] },
            symptoms: { items: ['грыжа', 'сколиоз', 'артроз'] },
            children: { items: ['зрр', 'аутизм'] }
        },
        targetCity: 'астана',
        otherCities: ['алматы', 'москва', 'киев'],
        requirementKeywords: {
            items: ['посоветуйте', 'ищу', 'нужен', 'подскажите', 'порекомендуйте']
        },
        healthKeywords: {
            items: ['врач', 'боль', 'болит', 'клиник', 'лечени']
        }
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

        // Cache для keywords
        this.targetCity = keywordsData.targetCity?.toLowerCase() || 'астана';
        this.otherCities = (keywordsData.otherCities || []).map(c => c.toLowerCase());
        this.requirementWords = keywordsData.requirementKeywords?.items || [];
        this.healthWords = keywordsData.healthKeywords?.items || [];
    }

    /**
     * Get all search keywords (single words)
     */
    getAllKeywords() {
        const allKeywords = [];
        const searchKeywords = keywordsData.searchKeywords || {};

        for (const category of Object.values(searchKeywords)) {
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
     * НОВЫЙ АЛГОРИТМ: Локальная фильтрация поста
     * Шаг 1: Проверка города (Астана = хорошо, другой город = плохо)
     * Шаг 2: Проверка что это вопрос/запрос рекомендации
     * Шаг 3: Проверка на медицинскую тематику
     */
    localFilter(post) {
        const text = (post.text || '').toLowerCase();

        // === SPAM FILTER ===
        const spamPatterns = [
            /продаю|продам|продажа|продаётся/,
            /скидк[аи]|акция|распродажа/,
            /подписывайтесь|подпишись|лайк на лайк/,
            /казино|ставки|букмекер/,
            /криптовалют|биткоин|трейдинг/,
            /заработ[окай]|доход|пассивный/,
            /модел[ья]|фотосессия|портфолио/,
            /цветы|цветочн|букет/,
            /адвокат|юрист|нотариус/,
            /репетитор|курсы|обучение/,
            /маникюр|педикюр|ресниц|бров/,
            /ремонт квартир|строительство/,
            /такси|доставка|курьер/,
            /одежда|платье|обувь|сумк/,
            /банкет|свадьб|праздник/,
            /фильм|кино|сериал|спектакл/,
            /шопинг|магазин|торгов/,
        ];

        for (const pattern of spamPatterns) {
            if (pattern.test(text)) {
                return { pass: false, reason: `Спам/другая тема: ${pattern.source}` };
            }
        }

        // === CITY FILTER ===
        const hasTargetCity = text.includes(this.targetCity);
        const hasOtherCity = this.otherCities.some(city => text.includes(city));

        // Если упомянут другой город БЕЗ нашего города - отклоняем
        if (hasOtherCity && !hasTargetCity) {
            return { pass: false, reason: 'Упомянут другой город (не Астана)' };
        }

        // === REQUIREMENT FILTER (посоветуйте, ищу, нужен) ===
        const hasRequirement = this.requirementWords.some(word => text.includes(word)) || text.includes('?');
        if (!hasRequirement) {
            return { pass: false, reason: 'Не вопрос/не ищет рекомендацию' };
        }

        // === HEALTH FILTER ===
        const hasHealthWord = this.healthWords.some(word => text.includes(word));
        if (!hasHealthWord) {
            return { pass: false, reason: 'Нет медицинских ключевых слов' };
        }

        // Прошёл все фильтры - отправляем на LLM валидацию
        return { pass: true, hasTargetCity };
    }

    /**
     * Run a search cycle
     * @param {number} cycleIndex - Cycle index (0, 1, or 2)
     */
    async runSearchCycle(cycleIndex = 0) {
        console.log(`[Threads Search] Starting cycle ${cycleIndex + 1}/3`);

        const keywords = this.getKeywordsForCycle(cycleIndex);
        console.log(`[Threads Search] Searching ${keywords.length} keywords: ${keywords.join(', ')}`);

        let totalFound = 0;
        let totalPassed = 0;

        for (const keyword of keywords) {
            try {
                // Search posts by SINGLE keyword
                const posts = await threadsAPI.keywordSearch(keyword, {
                    search_type: 'RECENT',
                    since: threadsAPI.get24HoursAgo(),
                    limit: 50
                });

                console.log(`[Threads Search] "${keyword}": found ${posts.length} raw posts`);
                totalFound += posts.length;

                // LOCAL FILTER each post
                let passedCount = 0;
                for (const post of posts) {
                    const filter = this.localFilter(post);
                    if (filter.pass) {
                        // Save only posts that passed local filter
                        const isNew = await threadsDB.saveNewPosts([post], keyword);
                        if (isNew > 0) {
                            passedCount++;
                            console.log(`[Threads Search] ✓ Passed: @${post.username} - "${post.text?.substring(0, 50)}..."`);
                        }
                    }
                }

                totalPassed += passedCount;

                // Log API request
                await threadsDB.logApiRequest(keyword, posts.length, passedCount);

                // Delay between requests
                await threadsAPI.sleep(this.config.delayBetweenRequests);
            } catch (error) {
                console.error(`[Threads Search] Error for "${keyword}":`, error.message);
            }
        }

        console.log(`[Threads Search] Cycle summary: ${totalFound} raw → ${totalPassed} passed filter`);

        // Process new posts with LLM validation
        await this.processNewPosts();

        console.log(`[Threads Search] Cycle ${cycleIndex + 1} completed`);
    }

    /**
     * Process all new posts - LLM validate and reply
     */
    async processNewPosts() {
        if (!this.isWorkingHours()) {
            console.log('[Threads Search] Outside working hours, skipping replies');
            return;
        }

        const newPosts = await threadsDB.getPostsByStatus('new', 20);
        console.log(`[Threads Search] LLM validating ${newPosts.length} posts`);

        for (const post of newPosts) {
            // LLM validation (only for posts that passed local filter)
            const validation = await this.validatePost(post);

            if (!validation.valid) {
                await threadsDB.updatePostStatus(post.id, 'skipped', {
                    validation_result: validation
                });
                console.log(`[Threads Search] LLM rejected: ${validation.reason}`);
                continue;
            }

            console.log(`[Threads Search] ✓ LLM validated: ${validation.matchedService}`);

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
     * Validate if post is relevant for the clinic (LLM)
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
