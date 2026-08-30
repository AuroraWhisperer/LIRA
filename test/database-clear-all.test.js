// 编写人：Aurora
// Clear-all Matrix 和部分失败测试
'use strict';

const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const { describe, it, beforeEach, afterEach } = require('node:test');
const {
  createDatabases,
  clearAllData,
  closeDatabases,
} = require('../src/storage/database');
const { now } = require('../src/shared/utils');

describe('clearAllData Matrix', () => {
  let databases;
  let tempDir;

  beforeEach(() => {
    tempDir = path.join(
      process.cwd(),
      'test',
      'tmp',
      `clear-all-${Date.now()}-${Math.random().toString(36).slice(2)}`,
    );
    fs.mkdirSync(tempDir, { recursive: true });
    databases = createDatabases({ dataDir: tempDir });
  });

  afterEach(() => {
    if (databases) {
      closeDatabases(databases);
    }
    if (tempDir && fs.existsSync(tempDir)) {
      fs.rmSync(tempDir, { recursive: true, force: true });
    }
  });

  it('should preserve configuration tables', () => {
    const { songDb, superChatDb, giftDb, musicDb, checkinDb } = databases;

    // Seed configuration data
    songDb
      .prepare(
        `
      INSERT INTO settings (key, value, updated_at)
      VALUES ('roomId', '12345', ?)
    `,
      )
      .run(now());

    songDb
      .prepare(
        `
      INSERT INTO ai_configuration (key, value, is_secret, updated_at)
      VALUES ('provider', 'deepseek', 0, ?)
    `,
      )
      .run(now());

    songDb
      .prepare(
        `
      INSERT INTO theme_presets (name, scope, payload, is_builtin, sort_order, created_at, updated_at)
      VALUES ('测试主题', 'all', '{}', 0, 0, ?, ?)
    `,
      )
      .run(now(), now());

    musicDb
      .prepare(
        `
      INSERT INTO favorites (track_key, source, track_id, title, artists, album, cover_url, duration_ms, sort_order, created_at)
      VALUES ('test-track', 'netease', '12345', '测试歌曲', '测试歌手', '测试专辑', '', 180000, 0, ?)
    `,
      )
      .run(now());

    musicDb
      .prepare(
        `
      INSERT INTO playlists (name, description, sort_order, created_at, updated_at)
      VALUES ('测试歌单', '描述', 0, ?, ?)
    `,
      )
      .run(now(), now());

    giftDb
      .prepare(
        `
      INSERT INTO overtime_gift_rules (gift_id, gift_name, image_path, mode, fixed_seconds, outcomes_json, enabled, sort_order, updated_at)
      VALUES ('31039', '小花花', '', 'fixed', 10, '[]', 1, 0, ?)
    `,
      )
      .run(now());

    // Seed business data
    const timestamp = now();
    songDb
      .prepare(
        `
      INSERT INTO song_categories (name, sort_order, is_enabled, created_at, updated_at)
      VALUES ('流行', 0, 1, ?, ?)
    `,
      )
      .run(timestamp, timestamp);

    const categoryId = songDb
      .prepare('SELECT id FROM song_categories WHERE name = ?')
      .get('流行').id;

    songDb
      .prepare(
        `
      INSERT INTO songs (name, name_pinyin, artist, category_id, is_enabled, created_at, updated_at)
      VALUES ('测试歌曲', 'ceshigequ', '测试歌手', ?, 1, ?, ?)
    `,
      )
      .run(categoryId, timestamp, timestamp);

    songDb
      .prepare(
        `
      INSERT INTO queue (song_name, artist, requester_name, source, status, created_at, updated_at)
      VALUES ('测试歌曲', '测试歌手', '观众', 'danmaku', 'waiting', ?, ?)
    `,
      )
      .run(timestamp, timestamp);

    songDb
      .prepare(
        `
      INSERT INTO requests (song_name, artist, requester_name, source, created_at)
      VALUES ('测试歌曲', '测试歌手', '观众', 'danmaku', ?)
    `,
      )
      .run(timestamp);

    songDb
      .prepare(
        `
      INSERT INTO import_batches (total_count, inserted_count, duplicate_count, failed_count, created_category_count, created_at)
      VALUES (10, 10, 0, 0, 0, ?)
    `,
      )
      .run(timestamp);

    songDb
      .prepare(
        `
      INSERT INTO user_cooldowns (user_key, uid, user_name, last_request_at, request_count, updated_at)
      VALUES ('test-user', '12345', '测试用户', ?, 1, ?)
    `,
      )
      .run(Date.now(), timestamp);

    songDb
      .prepare(
        `
      INSERT INTO ai_request_logs (uid, user_name, category, status, latency_ms, input_tokens, output_tokens, tool_calls, error_code, created_at)
      VALUES ('12345', '测试用户', 'weather', 'success', 500, 100, 200, 1, '', ?)
    `,
      )
      .run(Date.now());

    songDb
      .prepare(
        `
      INSERT INTO ai_api_usage (category, month_key, request_count, updated_at)
      VALUES ('weather', '2026-08', 1, ?)
    `,
      )
      .run(Date.now());

    songDb
      .prepare(
        `
      INSERT INTO ai_viewer_context (uid, payload, expires_at)
      VALUES ('12345', '{}', ?)
    `,
      )
      .run(Date.now() + 3600000);

    songDb
      .prepare(
        `
      INSERT INTO ai_query_cache (cache_key, payload, expires_at)
      VALUES ('test-key', '{}', ?)
    `,
      )
      .run(Date.now() + 3600000);

    songDb
      .prepare(
        `
      INSERT INTO ai_blacklist (uid, user_name, reason, created_at)
      VALUES ('12345', '测试用户', '测试原因', ?)
    `,
      )
      .run(Date.now());

    superChatDb
      .prepare(
        `
      INSERT INTO super_chats (platform_id, uid, user_name, price, message, status, source, created_at, updated_at)
      VALUES ('test-sc', '12345', '测试用户', 30.0, '测试 SC', 'active', 'superchat', ?, ?)
    `,
      )
      .run(timestamp, timestamp);

    giftDb
      .prepare(
        `
      INSERT INTO gift_events (platform_id, gift_id, gift_name, uid, user_name, num, unit_price, total_price, coin_type, status, created_at, updated_at)
      VALUES ('test-gift', '31039', '小花花', '12345', '测试用户', 1, 0.1, 0.1, 'gold', 'active', ?, ?)
    `,
      )
      .run(timestamp, timestamp);

    const giftEventId = giftDb
      .prepare('SELECT id FROM gift_events LIMIT 1')
      .get().id;
    giftDb
      .prepare(
        `
      INSERT INTO overtime_settlements (gift_event_id, status, gift_id, gift_name, quantity, total_price, event_created_at, event_updated_at, settle_after_ms, retry_count, last_error, rule_mode, rule_snapshot_json, outcomes_json, created_at, updated_at)
      VALUES (?, 'pending', '31039', '小花花', 1, 0.1, ?, ?, 0, 0, '', 'fixed', '{}', '[]', ?, ?)
    `,
      )
      .run(giftEventId, timestamp, timestamp, timestamp, timestamp);

    musicDb
      .prepare(
        `
      INSERT INTO play_history (client_id, track_key, source, track_id, title, artists, album, cover_url, duration_ms, origin, requester_name, play_count, played_at, created_at, updated_at)
      VALUES ('default', 'test-track', 'netease', '12345', '测试歌曲', '测试歌手', '测试专辑', '', 180000, 'player', '主播', 1, ?, ?, ?)
    `,
      )
      .run(timestamp, timestamp, timestamp);

    musicDb
      .prepare(
        `
      INSERT INTO play_queue_state (client_id, payload, updated_at)
      VALUES ('default', '{}', ?)
    `,
      )
      .run(timestamp);

    checkinDb
      .prepare(
        `
      INSERT INTO checkin_users (uid, user_name, total_days, first_checkin_at, last_checkin_at, last_checkin_date, updated_at)
      VALUES ('12345', '测试用户', 1, ?, ?, ?, ?)
    `,
      )
      .run(timestamp, timestamp, timestamp.split('T')[0], timestamp);

    // Execute clear-all
    const result = clearAllData(
      songDb,
      superChatDb,
      giftDb,
      musicDb,
      checkinDb,
    );

    // Assert result structure
    assert.strictEqual(result.cleared, true);
    assert.strictEqual(result.scope, 'all');
    assert(Array.isArray(result.preserved));
    assert(result.preserved.includes('settings'));
    assert(result.preserved.includes('ai_configuration'));
    assert(result.preserved.includes('theme_presets'));
    assert(result.preserved.includes('overtime_machine_state'));
    assert(result.preserved.includes('overtime_gift_rules'));
    assert(result.preserved.includes('favorites'));
    assert(result.preserved.includes('playlists'));

    // Assert configuration tables preserved
    const settingsCount = songDb
      .prepare('SELECT COUNT(*) AS count FROM settings')
      .get().count;
    assert.strictEqual(settingsCount, 1, 'settings should be preserved');

    const aiConfigCount = songDb
      .prepare('SELECT COUNT(*) AS count FROM ai_configuration')
      .get().count;
    assert.strictEqual(
      aiConfigCount,
      1,
      'ai_configuration should be preserved',
    );

    const themePresetsCount = songDb
      .prepare('SELECT COUNT(*) AS count FROM theme_presets')
      .get().count;
    assert(
      themePresetsCount >= 1,
      'theme_presets should be preserved (migration seeds built-in presets)',
    );

    const overtimeRulesCount = giftDb
      .prepare('SELECT COUNT(*) AS count FROM overtime_gift_rules')
      .get().count;
    assert.strictEqual(
      overtimeRulesCount,
      1,
      'overtime_gift_rules should be preserved',
    );

    const favoritesCount = musicDb
      .prepare('SELECT COUNT(*) AS count FROM favorites')
      .get().count;
    assert.strictEqual(favoritesCount, 1, 'favorites should be preserved');

    const playlistsCount = musicDb
      .prepare('SELECT COUNT(*) AS count FROM playlists')
      .get().count;
    assert.strictEqual(playlistsCount, 1, 'playlists should be preserved');

    // Assert business tables cleared
    const songsCount = songDb
      .prepare('SELECT COUNT(*) AS count FROM songs')
      .get().count;
    assert.strictEqual(songsCount, 0, 'songs should be cleared');

    const categoriesCount = songDb
      .prepare('SELECT COUNT(*) AS count FROM song_categories')
      .get().count;
    assert.strictEqual(
      categoriesCount,
      1,
      'song_categories should have only default category',
    );
    const defaultCategory = songDb
      .prepare('SELECT name FROM song_categories LIMIT 1')
      .get();
    assert.strictEqual(defaultCategory.name, '默认');

    const queueCount = songDb
      .prepare('SELECT COUNT(*) AS count FROM queue')
      .get().count;
    assert.strictEqual(queueCount, 0, 'queue should be cleared');

    const requestsCount = songDb
      .prepare('SELECT COUNT(*) AS count FROM requests')
      .get().count;
    assert.strictEqual(requestsCount, 0, 'requests should be cleared');

    const importBatchesCount = songDb
      .prepare('SELECT COUNT(*) AS count FROM import_batches')
      .get().count;
    assert.strictEqual(
      importBatchesCount,
      0,
      'import_batches should be cleared',
    );

    const cooldownsCount = songDb
      .prepare('SELECT COUNT(*) AS count FROM user_cooldowns')
      .get().count;
    assert.strictEqual(cooldownsCount, 0, 'user_cooldowns should be cleared');

    const aiLogsCount = songDb
      .prepare('SELECT COUNT(*) AS count FROM ai_request_logs')
      .get().count;
    assert.strictEqual(aiLogsCount, 0, 'ai_request_logs should be cleared');

    const aiUsageCount = songDb
      .prepare('SELECT COUNT(*) AS count FROM ai_api_usage')
      .get().count;
    assert.strictEqual(aiUsageCount, 0, 'ai_api_usage should be cleared');

    const aiContextCount = songDb
      .prepare('SELECT COUNT(*) AS count FROM ai_viewer_context')
      .get().count;
    assert.strictEqual(
      aiContextCount,
      0,
      'ai_viewer_context should be cleared',
    );

    const aiCacheCount = songDb
      .prepare('SELECT COUNT(*) AS count FROM ai_query_cache')
      .get().count;
    assert.strictEqual(aiCacheCount, 0, 'ai_query_cache should be cleared');

    const aiBlacklistCount = songDb
      .prepare('SELECT COUNT(*) AS count FROM ai_blacklist')
      .get().count;
    assert.strictEqual(aiBlacklistCount, 0, 'ai_blacklist should be cleared');

    const scCount = superChatDb
      .prepare('SELECT COUNT(*) AS count FROM super_chats')
      .get().count;
    assert.strictEqual(scCount, 0, 'super_chats should be cleared');

    const giftsCount = giftDb
      .prepare('SELECT COUNT(*) AS count FROM gift_events')
      .get().count;
    assert.strictEqual(giftsCount, 0, 'gift_events should be cleared');

    const settlementsCount = giftDb
      .prepare('SELECT COUNT(*) AS count FROM overtime_settlements')
      .get().count;
    assert.strictEqual(
      settlementsCount,
      0,
      'overtime_settlements should be cleared',
    );

    const playHistoryCount = musicDb
      .prepare('SELECT COUNT(*) AS count FROM play_history')
      .get().count;
    assert.strictEqual(playHistoryCount, 0, 'play_history should be cleared');

    const playQueueStateCount = musicDb
      .prepare('SELECT COUNT(*) AS count FROM play_queue_state')
      .get().count;
    assert.strictEqual(
      playQueueStateCount,
      0,
      'play_queue_state should be cleared',
    );

    const checkinsCount = checkinDb
      .prepare('SELECT COUNT(*) AS count FROM checkin_users')
      .get().count;
    assert.strictEqual(checkinsCount, 0, 'checkin_users should be cleared');

    // Assert recreated defaults
    const overtimeState = giftDb
      .prepare('SELECT * FROM overtime_machine_state WHERE id = 1')
      .get();
    assert.strictEqual(overtimeState.enabled, 0, 'overtime should be disabled');
    assert.strictEqual(
      overtimeState.status,
      'paused',
      'overtime should be paused',
    );
    assert.strictEqual(
      overtimeState.enable_epoch,
      0,
      'overtime epoch should be 0',
    );

    // Assert deleted counts returned
    assert.strictEqual(result.deletedCounts.songs, 1);
    assert.strictEqual(result.deletedCounts.categories, 1);
    assert.strictEqual(result.deletedCounts.queue, 1);
    assert.strictEqual(result.deletedCounts.requests, 1);
    assert.strictEqual(result.deletedCounts.importBatches, 1);
    assert.strictEqual(result.deletedCounts.userCooldowns, 1);
    assert.strictEqual(result.deletedCounts.aiRequestLogs, 1);
    assert.strictEqual(result.deletedCounts.aiApiUsage, 1);
    assert.strictEqual(result.deletedCounts.aiViewerContext, 1);
    assert.strictEqual(result.deletedCounts.aiQueryCache, 1);
    assert.strictEqual(result.deletedCounts.aiBlacklist, 1);
    assert.strictEqual(result.deletedCounts.sc, 1);
    assert.strictEqual(result.deletedCounts.gifts, 1);
    assert.strictEqual(result.deletedCounts.overtimeSettlements, 1);
    assert.strictEqual(result.deletedCounts.playHistory, 1);
    assert.strictEqual(result.deletedCounts.playQueueState, 1);
    assert.strictEqual(result.deletedCounts.checkins, 1);
    assert(result.totalDeleted >= 17);

    // Assert recreated list
    assert(Array.isArray(result.recreated));
    assert(result.recreated.includes('song_categories'));
    assert(result.recreated.includes('overtime_machine_state'));
  });

  it('should handle empty databases', () => {
    const { songDb, superChatDb, giftDb, musicDb, checkinDb } = databases;

    const result = clearAllData(
      songDb,
      superChatDb,
      giftDb,
      musicDb,
      checkinDb,
    );

    assert.strictEqual(result.cleared, true);
    assert.strictEqual(result.totalDeleted, 0);

    // Assert defaults still recreated
    const categoriesCount = songDb
      .prepare('SELECT COUNT(*) AS count FROM song_categories')
      .get().count;
    assert.strictEqual(categoriesCount, 1);

    const overtimeState = giftDb
      .prepare('SELECT * FROM overtime_machine_state WHERE id = 1')
      .get();
    assert.strictEqual(overtimeState.enabled, 0);
  });

  it('should rollback every uncommitted database after a commit failure', () => {
    const { songDb, superChatDb, giftDb, musicDb, checkinDb } = databases;
    const timestamp = now();

    superChatDb
      .prepare(
        `
      INSERT INTO super_chats (platform_id, uid, user_name, price, message, status, source, created_at, updated_at)
      VALUES ('rollback-sc', '1', '测试用户', 30, '保留', 'active', 'superchat', ?, ?)
    `,
      )
      .run(timestamp, timestamp);
    giftDb
      .prepare(
        `
      INSERT INTO gift_events (platform_id, gift_id, gift_name, uid, user_name, num, unit_price, total_price, coin_type, status, created_at, updated_at)
      VALUES ('rollback-gift', '1', '测试礼物', '1', '测试用户', 1, 1, 1, 'gold', 'active', ?, ?)
    `,
      )
      .run(timestamp, timestamp);
    musicDb
      .prepare(
        `
      INSERT INTO play_queue_state (client_id, payload, updated_at)
      VALUES ('rollback-client', '{}', ?)
    `,
      )
      .run(timestamp);
    checkinDb
      .prepare(
        `
      INSERT INTO checkin_users (uid, user_name, total_days, first_checkin_at, last_checkin_at, last_checkin_date, updated_at)
      VALUES ('rollback-user', '测试用户', 1, ?, ?, ?, ?)
    `,
      )
      .run(timestamp, timestamp, timestamp.slice(0, 10), timestamp);

    let commitFailed = false;
    const failingSuperChatDb = new Proxy(superChatDb, {
      get(target, property) {
        if (property === 'exec') {
          return (sql) => {
            if (!commitFailed && sql === 'COMMIT') {
              commitFailed = true;
              throw new Error('simulated COMMIT failure');
            }
            return target.exec(sql);
          };
        }
        const value = Reflect.get(target, property, target);
        return typeof value === 'function' ? value.bind(target) : value;
      },
    });

    const result = clearAllData(
      songDb,
      failingSuperChatDb,
      giftDb,
      musicDb,
      checkinDb,
    );

    assert.strictEqual(result.partial, true);
    assert.deepStrictEqual(result.committed, ['songDb']);
    assert.deepStrictEqual(result.failed, ['superChatDb']);
    assert.deepStrictEqual(result.rolledBack, [
      'superChatDb',
      'giftDb',
      'musicDb',
      'checkinDb',
    ]);
    assert.deepStrictEqual(result.rollbackFailed, []);

    assert.strictEqual(
      superChatDb.prepare('SELECT COUNT(*) AS count FROM super_chats').get()
        .count,
      1,
    );
    assert.strictEqual(
      giftDb.prepare('SELECT COUNT(*) AS count FROM gift_events').get().count,
      1,
    );
    assert.strictEqual(
      musicDb.prepare('SELECT COUNT(*) AS count FROM play_queue_state').get()
        .count,
      1,
    );
    assert.strictEqual(
      checkinDb.prepare('SELECT COUNT(*) AS count FROM checkin_users').get()
        .count,
      1,
    );

    for (const db of [superChatDb, giftDb, musicDb, checkinDb]) {
      db.exec('BEGIN');
      db.exec('ROLLBACK');
    }
  });
});
