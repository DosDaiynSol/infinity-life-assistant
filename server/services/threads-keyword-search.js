/**
 * Threads Keyword Search Service v3.0
 * ДВОЙНОЙ ПОДХОД:
 * Phase 1: Поиск "Астана" → фильтрация на релевантность услугам
 * Phase 2: Поиск по медицинским тегам (~33/цикл) → фильтрация на "Астана"
 * Все посты сохраняются в БД для дедупликации
 */

const threadsAPI = require('./threads-api');
const threadsDB = require('./threads-database');
const OpenAI = require('openai');
const fs = require('fs');
const path = require('path');
const EventEmitter = require('events');

// Load keywords with multiple path fallbacks
let keywordsData;
const keywordsPaths = [
    path.join(__dirname, '../data/threads_keywords.json'),
    path.join(__dirname, '../../data/threads_keywords.json'),
    path.join(process.cwd(), 'data/threads_keywords.json'),
    path.join(process.cwd(), 'server/data/threads_keywords.json')
];
let keywordsLoaded = false;
for (const kp of keywordsPaths) {
    try {
        keywordsData = JSON.parse(fs.readFileSync(kp, 'utf-8'));
        console.log(`[Threads] ✓ Keywords loaded from: ${kp}`);
        let total = 0;
        for (const cat of Object.values(keywordsData.searchKeywords || {})) {
            if (cat && Array.isArray(cat.items)) total += cat.items.length;
        }
        console.log(`[Threads] ✓ Total medical keywords: ${total}`);
        keywordsLoaded = true;
        break;
    } catch (e) {
        console.log(`[Threads] Keywords not found at: ${kp}`);
    }
}
if (!keywordsLoaded) {
    console.error('[Threads] ⚠️ Keywords file not found at any path, using defaults');
    keywordsData = {
        searchKeywords: {
            doctors: { items: ['остеопат', 'невролог', 'мануальщик'] },
            symptoms: { items: ['грыжа', 'сколиоз', 'артроз'] },
            children: { items: ['зрр', 'аутизм'] }
        },
        cityKeyword: 'астана',
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

// Load clinic data with fallback
let clinicData;
const clinicPaths = [
    path.join(__dirname, '../data/clinic_data.json'),
    path.join(__dirname, '../../data/clinic_data.json'),
    path.join(process.cwd(), 'data/clinic_data.json'),
    path.join(process.cwd(), 'server/data/clinic_data.json')
];
let clinicLoaded = false;
for (const cp of clinicPaths) {
    try {
        clinicData = JSON.parse(fs.readFileSync(cp, 'utf-8'));
        console.log(`[Threads] ✓ Clinic data loaded from: ${cp}`);
        clinicLoaded = true;
        break;
    } catch (e) { /* try next */ }
}
if (!clinicLoaded) {
    console.log('[Threads] Clinic data not found, using defaults');
    clinicData = { clinic: { name: 'INFINITY LIFE', contactPhone: '87470953952' } };
}

class ThreadsKeywordSearch extends EventEmitter {
    constructor() {
        super();
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
        this.searchLog = []; // Stores the latest search log for frontend
        this.isSearching = false;
        this.shouldStop = false; // Flag for manual stop

        // Cache для keywords
        this.cityKeyword = keywordsData.cityKeyword || keywordsData.targetCity || 'астана';
        this.targetCity = (keywordsData.targetCity || 'астана').toLowerCase();
        this.otherCities = (keywordsData.otherCities || []).map(c => c.toLowerCase());
        this.requirementWords = keywordsData.requirementKeywords?.items || [];
        this.healthWords = keywordsData.healthKeywords?.items || [];
    }

    /**
     * Get all medical search keywords (single words/phrases)
     */
    getAllMedicalKeywords() {
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
     * Get medical keywords for specific cycle (0, 1, or 2)
     * Splits ~100 keywords into 3 groups of ~33
     */
    getMedicalKeywordsForCycle(cycleIndex) {
        const allKeywords = this.getAllMedicalKeywords();
        const chunkSize = Math.ceil(allKeywords.length / this.config.cyclesPerDay);
        const start = cycleIndex * chunkSize;
        return allKeywords.slice(start, start + chunkSize);
    }

    /**
     * Get all keywords for the keywords tab (returns structured data)
     */
    getKeywordsInfo() {
        const allMedical = this.getAllMedicalKeywords();
        const categories = {};
        const searchKeywords = keywordsData.searchKeywords || {};

        for (const [catName, category] of Object.entries(searchKeywords)) {
            if (category && Array.isArray(category.items)) {
                categories[catName] = {
                    description: category.description || catName,
                    items: category.items,
                    count: category.items.length
                };
            }
        }

        return {
            cityKeyword: this.cityKeyword,
            totalMedicalKeywords: allMedical.length,
            keywordsPerCycle: Math.ceil(allMedical.length / 3),
            categories,
            allKeywords: [this.cityKeyword, ...allMedical]
        };
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
     * Emit a search log entry (for SSE streaming)
     */
    _emitLog(entry) {
        this.searchLog.push(entry);
        this.emit('searchLog', entry);
    }

    /**
     * LOCAL FILTER for Phase 1 (city search "Астана"):
     * Post found by searching "Астана" → check if related to our medical services
     */
    localFilterCitySearch(post) {
        const text = (post.text || '').toLowerCase();

        // === SPAM FILTER ===
        if (this._isSpam(text)) {
            return { pass: false, reason: 'Спам/другая тема' };
        }

        // Check for other city WITHOUT our city (shouldn't happen since we searched "астана" but just in case)
        const hasOtherCity = this.otherCities.some(city => text.includes(city));
        const hasTargetCity = text.includes(this.targetCity);
        if (hasOtherCity && !hasTargetCity) {
            return { pass: false, reason: 'Упомянут другой город' };
        }

        // Must be a question / seeking recommendation
        const hasRequirement = this.requirementWords.some(word => text.includes(word)) || text.includes('?');
        if (!hasRequirement) {
            return { pass: false, reason: 'Не вопрос/не ищет рекомендацию' };
        }

        // Must have health/medical context
        const hasHealthWord = this.healthWords.some(word => text.includes(word));
        const allMedical = this.getAllMedicalKeywords();
        const hasMedicalKeyword = allMedical.some(kw => text.includes(kw.toLowerCase()));

        if (!hasHealthWord && !hasMedicalKeyword) {
            return { pass: false, reason: 'Не медицинская тема' };
        }

        return { pass: true, phase: 'city', hasTargetCity: true };
    }

    /**
     * LOCAL FILTER for Phase 2 (medical tag search):
     * Post found by searching medical keyword → check if mentions "Астана"
     */
    localFilterMedicalSearch(post) {
        const text = (post.text || '').toLowerCase();

        // === SPAM FILTER ===
        if (this._isSpam(text)) {
            return { pass: false, reason: 'Спам/другая тема' };
        }

        // Must mention our city
        const hasTargetCity = text.includes(this.targetCity);
        if (!hasTargetCity) {
            return { pass: false, reason: 'Нет упоминания Астаны' };
        }

        // Must NOT mention another city (without our city is already caught above)
        const hasOtherCity = this.otherCities.some(city => text.includes(city));
        if (hasOtherCity && !hasTargetCity) {
            return { pass: false, reason: 'Упомянут другой город' };
        }

        // Must be a question / seeking recommendation
        const hasRequirement = this.requirementWords.some(word => text.includes(word)) || text.includes('?');
        if (!hasRequirement) {
            return { pass: false, reason: 'Не вопрос/не ищет рекомендацию' };
        }

        return { pass: true, phase: 'medical', hasTargetCity: true };
    }

    /**
     * Spam detection helper
     */
    _isSpam(text) {
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

        return spamPatterns.some(pattern => pattern.test(text));
    }

    /**
     * Run a search cycle with dual approach
     * @param {number} cycleIndex - Cycle index (0, 1, or 2)
     */
    async runSearchCycle(cycleIndex = 0) {
        if (this.isSearching) {
            console.log('[Threads Search] Already searching, skip');
            return;
        }

        this.isSearching = true;
        this.shouldStop = false; // Reset stop flag
        this.searchLog = []; // Reset log

        // Check token status before starting
        const tokenStatus = threadsAPI.getTokenStatus();
        if (tokenStatus.expired) {
            console.error('[Threads Search] ❌ Token is expired, cannot search');
            this._emitLog({
                type: 'error',
                message: `❌ Threads токен истёк! Необходимо сгенерировать новый токен в Meta Developer Console. Ошибка: ${tokenStatus.error || 'Token expired'}`
            });
            this._emitLog({ type: 'end', message: '❌ Поиск невозможен — токен истёк' });
            this.isSearching = false;
            return;
        }

        console.log(`\n[Threads Search] ========== Cycle ${cycleIndex + 1}/3 START ==========`);

        this._emitLog({
            type: 'start',
            cycle: cycleIndex + 1,
            timestamp: new Date().toISOString(),
            message: `🚀 Запуск цикла ${cycleIndex + 1}/3`
        });

        let totalFound = 0;
        let totalPassedFilter = 0;
        let totalNewSaved = 0;
        let totalDuplicate = 0;
        let apiRequests = 0;
        let summary_validated = 0;
        let summary_rejected = 0;
        let summary_replied = 0;

        try {
            // ====== PHASE 1: Search "Астана" ======
            this._emitLog({
                type: 'phase',
                phase: 1,
                message: `📍 Фаза 1: Поиск "${this.cityKeyword}" → фильтр на медицинские услуги`
            });

            const cityResult = await this._searchKeyword(this.cityKeyword, 'city');
            totalFound += cityResult.found;
            totalPassedFilter += cityResult.passed;
            totalNewSaved += cityResult.newSaved;
            totalDuplicate += cityResult.duplicate;
            apiRequests++;

            this._emitLog({
                type: 'keyword_result',
                keyword: this.cityKeyword,
                phase: 'city',
                found: cityResult.found,
                passed: cityResult.passed,
                newSaved: cityResult.newSaved,
                duplicate: cityResult.duplicate,
                message: `🔍 "${this.cityKeyword}": найдено ${cityResult.found}, после фильтра ${cityResult.passed}, новых ${cityResult.newSaved}, дубли ${cityResult.duplicate}`
            });

            // Check stop flag after phase 1
            if (this.shouldStop) {
                this._emitLog({ type: 'info', message: '⏹️ Поиск остановлен вручную (после фазы 1)' });
                this.isSearching = false;
                this._emitLog({ type: 'end', message: '⏹️ Поиск остановлен' });
                return;
            }

            // Delay
            await threadsAPI.sleep(this.config.delayBetweenRequests);

            // ====== PHASE 2: Search medical keywords (33 per cycle) ======
            const medicalKeywords = this.getMedicalKeywordsForCycle(cycleIndex);

            this._emitLog({
                type: 'phase',
                phase: 2,
                message: `🏥 Фаза 2: Поиск ${medicalKeywords.length} медицинских тегов → фильтр на "Астана"`
            });

            for (let i = 0; i < medicalKeywords.length; i++) {
                // Check stop flag before each keyword
                if (this.shouldStop) {
                    this._emitLog({ type: 'info', message: `⏹️ Поиск остановлен вручную (после ${i}/${medicalKeywords.length} тегов)` });
                    break;
                }

                const keyword = medicalKeywords[i];
                try {
                    const result = await this._searchKeyword(keyword, 'medical');
                    totalFound += result.found;
                    totalPassedFilter += result.passed;
                    totalNewSaved += result.newSaved;
                    totalDuplicate += result.duplicate;
                    apiRequests++;

                    this._emitLog({
                        type: 'keyword_result',
                        keyword,
                        phase: 'medical',
                        found: result.found,
                        passed: result.passed,
                        newSaved: result.newSaved,
                        duplicate: result.duplicate,
                        progress: `${i + 1}/${medicalKeywords.length}`,
                        message: `🔍 "${keyword}" [${i + 1}/${medicalKeywords.length}]: найдено ${result.found}, после фильтра ${result.passed}, новых ${result.newSaved}`
                    });

                    // Delay between requests
                    await threadsAPI.sleep(this.config.delayBetweenRequests);
                } catch (error) {
                    console.error(`[Threads Search] Error for "${keyword}":`, error.message);
                    this._emitLog({
                        type: 'error',
                        keyword,
                        message: `❌ Ошибка "${keyword}": ${error.message}`
                    });
                }
            }

            // ====== LLM Validation (skip if stopped) ======
            if (!this.shouldStop) {
                this._emitLog({
                    type: 'phase',
                    phase: 3,
                    message: `🤖 Фаза 3: LLM валидация + автоответы`
                });

                const validationResult = await this.processNewPosts();
                summary_validated = validationResult.validated;
                summary_rejected = validationResult.rejected;
                summary_replied = validationResult.replied;
            }

            // ====== Summary ======
            const summary = {
                type: 'summary',
                cycle: cycleIndex + 1,
                apiRequests,
                totalFound,
                passedLocalFilter: totalPassedFilter,
                newSaved: totalNewSaved,
                duplicates: totalDuplicate,
                llmValidated: summary_validated,
                llmRejected: summary_rejected,
                replied: summary_replied,
                stopped: this.shouldStop,
                timestamp: new Date().toISOString(),
                message: `📊 Итого: ${apiRequests} API запросов, ${totalFound} найдено, ${totalPassedFilter} после фильтра, ${totalNewSaved} новых, ${summary_validated} валидных, ${summary_replied} ответов${this.shouldStop ? ' (остановлено)' : ''}`
            };

            this._emitLog(summary);

            console.log(`[Threads Search] ========== Cycle ${cycleIndex + 1}/3 DONE ==========`);
            console.log(`[Threads Search] ${summary.message}\n`);

            // Log total API requests
            await threadsDB.logApiRequest(`cycle_${cycleIndex + 1}`, totalFound, totalNewSaved);

        } catch (error) {
            console.error('[Threads Search] Cycle error:', error.message);
            this._emitLog({
                type: 'error',
                message: `❌ Критическая ошибка цикла: ${error.message}`
            });
        } finally {
            this.isSearching = false;
            this._emitLog({ type: 'end', message: '✅ Цикл завершён' });
        }
    }

    /**
     * Stop an in-progress search
     */
    stopSearch() {
        if (this.isSearching) {
            this.shouldStop = true;
            console.log('[Threads Search] Stop requested by user');
            this._emitLog({ type: 'info', message: '⏹️ Остановка поиска...' });
            return true;
        }
        return false;
    }

    /**
     * Search a single keyword and apply the appropriate filter
     * @param {string} keyword - Keyword to search
     * @param {string} phase - 'city' or 'medical'
     * @returns {Object} - { found, passed, newSaved, duplicate }
     */
    async _searchKeyword(keyword, phase) {
        const posts = await threadsAPI.keywordSearch(keyword, {
            search_type: 'RECENT',
            since: threadsAPI.get24HoursAgo(),
            limit: 100
        });

        let found = posts.length;
        let passed = 0;
        let newSaved = 0;
        let duplicate = 0;

        for (const post of posts) {
            // Apply the appropriate filter based on phase
            const filter = phase === 'city'
                ? this.localFilterCitySearch(post)
                : this.localFilterMedicalSearch(post);

            if (filter.pass) {
                passed++;

                // Save to DB (dedup by post_id)
                const savedCount = await threadsDB.saveNewPosts([post], keyword);
                if (savedCount > 0) {
                    newSaved++;
                    console.log(`[Threads Search] ✓ NEW: @${post.username} via "${keyword}" — "${post.text?.substring(0, 60)}..."`);
                } else {
                    duplicate++;
                }
            }
        }

        return { found, passed, newSaved, duplicate };
    }

    /**
     * Process all new posts - LLM validate and reply
     * @returns {Object} - { validated, rejected, replied }
     */
    async processNewPosts() {
        const result = { validated: 0, rejected: 0, replied: 0 };

        if (!this.isWorkingHours()) {
            console.log('[Threads Search] Outside working hours, skipping replies');
            this._emitLog({
                type: 'info',
                message: '⏰ Вне рабочего времени — автоответы отключены'
            });
            return result;
        }

        const newPosts = await threadsDB.getPostsByStatus('new', 20);
        console.log(`[Threads Search] LLM validating ${newPosts.length} posts`);

        this._emitLog({
            type: 'info',
            message: `🤖 LLM валидация: ${newPosts.length} постов`
        });

        for (const post of newPosts) {
            // LLM validation
            const validation = await this.validatePost(post);

            if (!validation.valid) {
                await threadsDB.updatePostStatus(post.id, 'skipped', {
                    validation_result: validation
                });
                result.rejected++;
                console.log(`[Threads Search] LLM rejected: ${validation.reason}`);
                continue;
            }

            result.validated++;
            console.log(`[Threads Search] ✓ LLM validated: ${validation.matchedService}`);

            this._emitLog({
                type: 'validated',
                username: post.username,
                service: validation.matchedService,
                message: `✅ Валидный: @${post.username} → ${validation.matchedService}`
            });

            // Check if we can reply
            if (!await this.canReplyToday()) {
                console.log('[Threads Search] Daily reply limit reached');
                await threadsDB.updatePostStatus(post.id, 'validated', {
                    validation_result: validation
                });
                this._emitLog({
                    type: 'info',
                    message: `⚠️ Лимит ответов на день достигнут`
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
                    result.replied++;
                    console.log(`[Threads Search] Replied to @${post.username}: ${replyText.substring(0, 50)}...`);

                    this._emitLog({
                        type: 'replied',
                        username: post.username,
                        message: `💬 Ответ отправлен: @${post.username}`
                    });
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

        return result;
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
     * Get latest search log
     */
    getSearchLog() {
        return this.searchLog;
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
