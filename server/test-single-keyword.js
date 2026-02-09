// Test single keyword search
require('dotenv').config({ path: require('path').join(__dirname, '../.env') });

const threadsAPI = require('./services/threads-api');
const threadsDB = require('./services/threads-database');

async function testSingleKeyword() {
    const keyword = 'мануальная терапия астана';

    console.log(`\n🔍 Тестовый поиск: "${keyword}"\n`);

    try {
        // Search
        const posts = await threadsAPI.keywordSearch(keyword, { limit: 10 });
        console.log(`📊 Найдено постов: ${posts.length}\n`);

        if (posts.length === 0) {
            console.log('❌ Постов не найдено');
            return;
        }

        // Show results
        for (const post of posts.slice(0, 5)) {
            console.log('─'.repeat(50));
            console.log(`👤 @${post.username || 'unknown'}`);
            console.log(`📝 ${(post.text || '').substring(0, 150)}...`);
            console.log(`🔗 ${post.permalink || 'no link'}`);
        }

        // Save to database
        const newCount = await threadsDB.saveNewPosts(posts, keyword);
        console.log(`\n✅ Сохранено новых постов: ${newCount}`);

    } catch (error) {
        console.error('❌ Ошибка:', error.message);
    }

    process.exit(0);
}

testSingleKeyword();
