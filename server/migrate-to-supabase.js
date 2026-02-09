/**
 * Migration Script: JSON to Supabase
 * Run once to migrate existing data from JSON files to Supabase
 */

require('dotenv').config();
const { createClient } = require('@supabase/supabase-js');
const fs = require('fs');
const path = require('path');

const DATA_DIR = path.join(__dirname, '../data');

// Initialize Supabase
const supabase = createClient(
    process.env.SUPABASE_URL,
    process.env.SUPABASE_SERVICE_KEY,
    { auth: { persistSession: false } }
);

async function migrateInstagramUsers() {
    console.log('\n📱 Migrating Instagram Users...');

    const usersFile = path.join(DATA_DIR, 'users.json');
    if (!fs.existsSync(usersFile)) {
        console.log('  No users.json found, skipping');
        return 0;
    }

    const data = JSON.parse(fs.readFileSync(usersFile, 'utf8'));
    const users = Object.values(data.users || {});

    let count = 0;
    for (const user of users) {
        const { error } = await supabase
            .from('instagram_users')
            .upsert({
                user_id: user.id,
                username: user.username,
                ai_enabled: user.aiEnabled ?? true,
                dm_enabled: user.dmEnabled ?? true,
                comment_enabled: user.commentEnabled ?? true,
                message_count: user.messageCount || 0,
                comment_count: user.commentCount || 0,
                created_at: user.createdAt || new Date().toISOString(),
                last_seen: user.lastSeen || new Date().toISOString()
            }, { onConflict: 'user_id' });

        if (!error) count++;
        else console.log(`  Error migrating user ${user.id}:`, error.message);
    }

    console.log(`  ✅ Migrated ${count}/${users.length} users`);
    return count;
}

async function migrateInstagramConversations() {
    console.log('\n💬 Migrating Instagram Conversations...');

    const convFile = path.join(DATA_DIR, 'conversations.json');
    if (!fs.existsSync(convFile)) {
        console.log('  No conversations.json found, skipping');
        return 0;
    }

    const data = JSON.parse(fs.readFileSync(convFile, 'utf8'));
    const conversations = data.conversations || {};

    let count = 0;
    for (const [userId, messages] of Object.entries(conversations)) {
        for (const msg of messages) {
            const { error } = await supabase
                .from('instagram_conversations')
                .insert({
                    user_id: userId,
                    role: msg.role,
                    text: msg.text,
                    created_at: msg.timestamp || new Date().toISOString()
                });

            if (!error) count++;
        }
    }

    console.log(`  ✅ Migrated ${count} conversation messages`);
    return count;
}

async function migrateYouTubeStats() {
    console.log('\n🎬 Migrating YouTube Stats...');

    const statsFile = path.join(DATA_DIR, 'youtube_stats.json');
    if (!fs.existsSync(statsFile)) {
        console.log('  No youtube_stats.json found, skipping');
        return 0;
    }

    const data = JSON.parse(fs.readFileSync(statsFile, 'utf8'));

    // Migrate total stats
    const { error: statsError } = await supabase
        .from('youtube_stats')
        .insert({
            total_comments: data.totalComments || 0,
            total_responses: data.totalResponses || 0,
            created_at: data.createdAt || new Date().toISOString(),
            updated_at: data.lastUpdated || new Date().toISOString()
        });

    if (statsError) {
        console.log('  Error migrating total stats:', statsError.message);
    } else {
        console.log(`  ✅ Migrated total stats: ${data.totalComments} comments, ${data.totalResponses} responses`);
    }

    // Migrate processed videos
    const videoIds = data.processedVideoIds || [];
    let videoCount = 0;
    for (const videoId of videoIds) {
        const { error } = await supabase
            .from('youtube_processed_videos')
            .upsert({ video_id: videoId }, { onConflict: 'video_id' });

        if (!error) videoCount++;
    }
    console.log(`  ✅ Migrated ${videoCount}/${videoIds.length} processed videos`);

    // Migrate daily stats
    const dailyStats = data.dailyStats || {};
    let dailyCount = 0;
    for (const [date, stats] of Object.entries(dailyStats)) {
        const { error } = await supabase
            .from('youtube_daily_stats')
            .upsert({
                date,
                comments: stats.comments || 0,
                responses: stats.responses || 0
            }, { onConflict: 'date' });

        if (!error) dailyCount++;
    }
    console.log(`  ✅ Migrated ${dailyCount}/${Object.keys(dailyStats).length} daily stat entries`);

    return videoCount + dailyCount;
}

async function migrateGoogleRepliedReviews() {
    console.log('\n⭐ Migrating Google Replied Reviews...');

    const reviewsFile = path.join(DATA_DIR, 'google_replied_reviews.json');
    if (!fs.existsSync(reviewsFile)) {
        console.log('  No google_replied_reviews.json found, skipping');
        return 0;
    }

    const data = JSON.parse(fs.readFileSync(reviewsFile, 'utf8'));

    let count = 0;
    for (const [reviewId, review] of Object.entries(data)) {
        const { error } = await supabase
            .from('google_replied_reviews')
            .upsert({
                review_id: reviewId,
                reply_text: review.reply,
                reviewer_name: review.reviewer,
                star_rating: review.starRating,
                replied_at: review.repliedAt || new Date().toISOString()
            }, { onConflict: 'review_id' });

        if (!error) count++;
        else console.log(`  Error migrating review ${reviewId}:`, error.message);
    }

    console.log(`  ✅ Migrated ${count}/${Object.keys(data).length} replied reviews`);
    return count;
}

async function main() {
    console.log('🚀 Starting JSON to Supabase Migration\n');
    console.log('Supabase URL:', process.env.SUPABASE_URL);
    console.log('='.repeat(50));

    try {
        await migrateInstagramUsers();
        await migrateInstagramConversations();
        await migrateYouTubeStats();
        await migrateGoogleRepliedReviews();

        console.log('\n' + '='.repeat(50));
        console.log('✅ Migration complete!');
        console.log('\nYou can now safely archive the JSON files in /data if desired.');
    } catch (error) {
        console.error('\n❌ Migration failed:', error.message);
        process.exit(1);
    }
}

main();
