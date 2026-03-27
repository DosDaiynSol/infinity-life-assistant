const CLINIC_PHONE = process.env.CLINIC_PHONE || '87470953952';

const CRITICAL_PATTERNS = [
    {
        reasonCode: 'acute_symptom',
        riskLevel: 'critical',
        matchers: [
            /не могу дыш/i,
            /кровотеч/i,
            /онемел/i,
            /парализ/i,
            /судорог/i,
            /обморок/i,
            /резк(ая|ую)\s+боль/i,
            /сильн(ая|ую)\s+боль/i,
            /очень плохо/i
        ]
    },
    {
        reasonCode: 'medical_complaint',
        riskLevel: 'critical',
        matchers: [
            /жалоб/i,
            /претензи/i,
            /суд/i,
            /юрист/i,
            /верните деньги/i,
            /стало хуже/i,
            /навредил/i,
            /ошибк[аи]\s+врач/i,
            /после .* хуже/i
        ]
    }
];

const WARNING_PATTERNS = [
    {
        reasonCode: 'public_negative_feedback',
        riskLevel: 'high',
        matchers: [
            /ужас/i,
            /кошмар/i,
            /шарлатан/i,
            /хам/i,
            /груб/i,
            /обман/i,
            /не помогло/i,
            /опасно/i
        ]
    }
];

function classifyEvent({ channel, text }) {
    const value = String(text || '').trim();

    for (const pattern of CRITICAL_PATTERNS) {
        if (pattern.matchers.some((matcher) => matcher.test(value))) {
            return {
                decision: 'escalate',
                riskLevel: pattern.riskLevel,
                reasonCode: pattern.reasonCode,
                allowTriageReply: true
            };
        }
    }

    if (channel === 'comment') {
        for (const pattern of WARNING_PATTERNS) {
            if (pattern.matchers.some((matcher) => matcher.test(value))) {
                return {
                    decision: 'escalate',
                    riskLevel: pattern.riskLevel,
                    reasonCode: pattern.reasonCode,
                    allowTriageReply: true
                };
            }
        }
    }

    return {
        decision: 'auto_reply',
        riskLevel: 'low',
        reasonCode: 'standard_inquiry',
        allowTriageReply: false
    };
}

function buildSafeFallback({ channel, username, isKazakh }) {
    if (channel === 'comment') {
        if (isKazakh) {
            return `@${username || 'user'} Қайырлы күн. Жазылу немесе кеңес алу үшін ${CLINIC_PHONE} нөміріне хабарласыңыз.`;
        }

        return `@${username || 'user'} Добрый день. Для записи и консультации позвоните, пожалуйста, по номеру ${CLINIC_PHONE}.`;
    }

    if (isKazakh) {
        return `Сәлеметсіз бе. Жылдам кеңес пен жазылу үшін ${CLINIC_PHONE} нөміріне хабарласыңыз.`;
    }

    return `Здравствуйте. Для быстрой записи и консультации позвоните, пожалуйста, по номеру ${CLINIC_PHONE}.`;
}

function buildEscalationTriage({ channel, username, isKazakh }) {
    if (channel === 'comment') {
        if (isKazakh) {
            return `@${username || 'user'} Қайырлы күн. Біз бұл жағдайды аға әкімшіге береміз. Direct-ке жазыңыз немесе ${CLINIC_PHONE} нөміріне хабарласыңыз.`;
        }

        return `@${username || 'user'} Добрый день. Передаём ситуацию старшему администратору. Напишите нам в Direct или позвоните по номеру ${CLINIC_PHONE}.`;
    }

    if (isKazakh) {
        return `Хабарыңызды аға әкімшіге бірден береміз. Егер жағдайыңыз шұғыл болса, жедел көмекке жүгініңіз. Бізбен байланыс: ${CLINIC_PHONE}.`;
    }

    return `Я сразу передаю ваш вопрос старшему администратору. Если состояние острое, пожалуйста, не ждите ответа в Direct и обратитесь за неотложной помощью. Связаться с клиникой можно по номеру ${CLINIC_PHONE}.`;
}

module.exports = {
    buildEscalationTriage,
    buildSafeFallback,
    classifyEvent
};
