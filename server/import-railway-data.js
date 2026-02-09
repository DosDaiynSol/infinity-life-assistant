/**
 * Import Railway data to Supabase
 * Run once to migrate existing stats, users, and history from Railway
 */

require('dotenv').config();
const { createClient } = require('@supabase/supabase-js');
const fs = require('fs');

const supabase = createClient(
    process.env.SUPABASE_URL,
    process.env.SUPABASE_SERVICE_KEY,
    { auth: { persistSession: false } }
);

async function importStats() {
    console.log('\n📊 Importing Instagram Stats from Railway...');

    const stats = JSON.parse(fs.readFileSync('/tmp/railway_stats.json', 'utf8'));
    const dailyStats = stats.dailyStats || {};

    let count = 0;
    for (const [date, data] of Object.entries(dailyStats)) {
        const { error } = await supabase
            .from('instagram_stats')
            .upsert({
                date,
                dms: data.dms || 0,
                comments: data.comments || 0,
                responses: data.responses || 0
            }, { onConflict: 'date' });

        if (!error) count++;
        else console.log(`  Error for ${date}:`, error.message);
    }

    console.log(`  ✅ Imported ${count}/${Object.keys(dailyStats).length} daily stats`);
    console.log(`  📈 Total: ${stats.totalMessages} DMs, ${stats.totalComments} comments, ${stats.responsesSet} responses`);
    return count;
}

async function importUsers() {
    console.log('\n👥 Importing Users from Railway...');

    const users = JSON.parse(fs.readFileSync('/tmp/railway_users.json', 'utf8'));

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
        else console.log(`  Error for ${user.username}:`, error.message);
    }

    console.log(`  ✅ Imported ${count}/${users.length} users`);
    return count;
}

async function importHistory() {
    console.log('\n📜 Importing History from Railway...');

    // First, create instagram_history table if it doesn't exist
    console.log('  Creating instagram_history table...');

    const history = JSON.parse(fs.readFileSync('/tmp/railway_history.json', 'utf8'));

    // Insert history entries
    let count = 0;
    for (const entry of history) {
        const { error } = await supabase
            .from('instagram_history')
            .insert({
                type: entry.type,
                comment_id: entry.commentId,
                user_id: entry.userId,
                username: entry.username,
                text: entry.text,
                response: entry.response,
                responded: entry.responded,
                status: entry.status,
                rejection: entry.rejection,
                created_at: entry.timestamp
            });

        if (!error) count++;
    }

    console.log(`  ✅ Imported ${count}/${history.length} history entries`);
    return count;
}

async function main() {
    console.log('🚀 Importing Railway Data to Supabase\n');
    console.log('='.repeat(50));

    try {
        await importStats();
        await importUsers();

        // Check if instagram_history table exists first
        const { error: tableCheck } = await supabase
            .from('instagram_history')
            .select('id')
            .limit(1);

        if (tableCheck) {
            console.log('\n⚠️  instagram_history table does not exist. Creating it first...');
            console.log('   Please run the migration to create the table, then rerun this script.');
        } else {
            await importHistory();
        }

        console.log('\n' + '='.repeat(50));
        console.log('✅ Railway data import complete!');
    } catch (error) {
        console.error('\n❌ Import failed:', error.message);
        process.exit(1);
    }
}

main();
