/**
 * Test script for Threads Keyword Search
 * Run: node server/test-threads-search.js
 */

require('dotenv').config();
const threadsAPI = require('./services/threads-api');
const threadsDB = require('./services/threads-database');

async function testSearch() {
    const keyword = 'остеопат астана';

    console.log(`\n🔍 Testing search for: "${keyword}"\n`);

    try {
        // 1. Search posts via Threads API
        console.log('1. Calling Threads API...');
        const posts = await threadsAPI.keywordSearch(keyword, {
            search_type: 'RECENT',
            since: threadsAPI.get24HoursAgo(),
            limit: 20
        });

        console.log(`   Found ${posts.length} posts from API`);

        if (posts.length === 0) {
            console.log('\n⚠️  No posts found for this keyword in last 24 hours');
            console.log('   This is normal - not many people post about this topic daily');
            process.exit(0);
        }

        // 2. Show found posts
        console.log('\n2. Posts found:');
        posts.forEach((post, i) => {
            console.log(`\n   [${i + 1}] @${post.username}`);
            console.log(`       Text: ${post.text?.substring(0, 100)}...`);
            console.log(`       Link: ${post.permalink}`);
        });

        // 3. Save to database
        console.log('\n3. Saving to Supabase...');
        const newCount = await threadsDB.saveNewPosts(posts, keyword);
        console.log(`   Saved ${newCount} new posts (${posts.length - newCount} already existed)`);

        // 4. Log API request
        await threadsDB.logApiRequest(keyword, posts.length, newCount);
        console.log('   API request logged');

        // 5. Show database stats
        console.log('\n4. Checking database...');
        const newPosts = await threadsDB.getPostsByStatus('new', 10);
        console.log(`   Posts with status "new": ${newPosts.length}`);

        if (newPosts.length > 0) {
            console.log('\n   Sample posts in database:');
            newPosts.slice(0, 3).forEach((post, i) => {
                console.log(`   [${i + 1}] @${post.username}: ${post.text?.substring(0, 80)}...`);
            });
        }

        console.log('\n✅ Test completed successfully!\n');

    } catch (error) {
        console.error('\n❌ Error:', error.message);
        console.error(error.stack);
    }

    process.exit(0);
}

testSearch();
