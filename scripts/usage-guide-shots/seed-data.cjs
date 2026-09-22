'use strict';

// 使用文档截图 · 合成示例数据种子
// 在隔离数据目录（默认 screenshots/usage-guide/data）内创建全部 SQLite 库，
// 并按方案 6.2 的脱敏规范填入示例数据：示例主播 / 房间号 123456 / 观众A·B·C·D。
// 用法：node scripts/usage-guide-shots/seed-data.cjs [dataDir] [--force]

const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const {
  createDatabases,
  closeDatabases,
} = require('../../src/storage/database');
const {
  createSettingsStore,
} = require('../../src/storage/settings-store');
const {
  createGiftSyncStore,
} = require('../../src/storage/gift-sync-store');

const VIEWERS = [
  { uid: '100001', name: '观众A', guard: 3, medal: '示例团', medalLevel: 12 },
  { uid: '100002', name: '观众B', guard: 0, medal: '示例团', medalLevel: 5 },
  { uid: '100003', name: '观众C', guard: 0, medal: '', medalLevel: 0 },
  { uid: '100004', name: '观众D', guard: 1, medal: '示例团', medalLevel: 8 },
];

const GIFT_IDS = {
  小花花: '1001',
  打call: '1002',
  棒棒糖: '1003',
  辣条: '1004',
  水晶球: '1024',
  心动盲盒: '2001',
  心愿盲盒: '2002',
};

function iso(ms) {
  return new Date(ms).toISOString();
}

function seedCategories(songDb) {
  const insert = songDb.prepare(
    `INSERT INTO song_categories (name, sort_order, is_enabled, created_at, updated_at)
     VALUES (?, ?, 1, ?, ?)`,
  );
  const names = ['华语流行', '日语', '英语', '古风', '虚拟歌手', '说唱'];
  const now = iso(Date.now());
  const ids = {};
  names.forEach((name, index) => {
    const result = insert.run(name, index, now, now);
    ids[name] = Number(result.lastInsertRowid);
  });
  return ids;
}

function seedSongs(songDb, categoryIds) {
  const insert = songDb.prepare(
    `INSERT INTO songs
       (name, name_pinyin, name_initial, artist, category_id, is_enabled,
        note, request_price, song_clip, tags, language, source_platform,
        original_group, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, '', '', '', ?, ?, '', '', ?, ?)`,
  );
  const now = iso(Date.now());
  const songs = [
    ['晴天', 'qing tian', '周杰伦', '华语流行', '华语', '治愈|经典'],
    ['稻香', 'dao xiang', '周杰伦', '华语流行', '华语', '治愈'],
    ['小幸运', 'xiao xing yun', '田馥甄', '华语流行', '华语', '抒情'],
    ['平凡之路', 'ping fan zhi lu', '朴树', '华语流行', '华语', '抒情'],
    ['起风了', 'qi feng le', '买辣椒也用券', '华语流行', '华语', '治愈|高音'],
    ['年少有为', 'nian shao you wei', '李荣浩', '华语流行', '华语', ''],
    ['Lemon', 'lemon', '米津玄師', '日语', '日语', '治愈'],
    ['アイドル', 'idol', 'YOASOBI', '日语', '日语', '燃'],
    ['打上花火', 'uchiage hanabi', 'Daoko×米津玄師', '日语', '日语', '抒情'],
    ['紅蓮華', 'gurenge', 'LiSA', '日语', '日语', '燃'],
    ['Shape of You', 'shape of you', 'Ed Sheeran', '英语', '英语', '卡点'],
    ['Counting Stars', 'counting stars', 'OneRepublic', '英语', '英语', '燃'],
    ['See You Again', 'see you again', 'Wiz Khalifa', '英语', '英语', '抒情'],
    ['牵丝戏', 'qian si xi', '银临&Aki阿杰', '古风', '华语', '戏腔'],
    ['锦鲤抄', 'jin li chao', '银临', '古风', '华语', ''],
    ['不老梦', 'bu lao meng', '银临', '古风', '华语', '抒情'],
    ['棠梨煎雪', 'tang li jian xue', '银临', '古风', '华语', '治愈'],
    ['勾指起誓', 'gou zhi qi shi', '洛天依', '虚拟歌手', '华语', '甜'],
    ['权御天下', 'quan yu tian xia', '洛天依', '虚拟歌手', '华语', '燃'],
    ['普通Disco', 'pu tong disco', '洛天依&言和', '虚拟歌手', '华语', '魔性'],
    ['经济舱', 'jing ji cang', '刘聪', '说唱', '华语', ''],
    ['隆里电丝', 'long li dian si', '盛宇', '说唱', '华语', '燃'],
    ['漠河舞厅', 'mo he wu ting', '柳爽', '华语流行', '华语', '抒情'],
    ['忐忑', 'tan te', '龚琳娜', '华语流行', '华语', '高难度'],
  ];
  const ids = {};
  for (const [name, pinyin, artist, category, language, tags] of songs) {
    const enabled = name === '忐忑' ? 0 : 1; // 一首「不可点」示例
    const initial = (pinyin[0] || '#').toUpperCase();
    const result = insert.run(
      name, pinyin, /[A-Z]/.test(initial) ? initial : '#', artist,
      categoryIds[category], enabled, tags, language, now, now,
    );
    ids[name] = Number(result.lastInsertRowid);
  }
  return ids;
}

// 注意：不播种点歌队列（queue 表）——服务启动时会清空未完成的队列
// （src/music/queue-service.js clearActiveQueueOnStartup），
// 队列由 capture.cjs 在服务启动后通过 POST /api/queue/add 写入。

function seedSuperChats(superChatDb) {
  const insert = superChatDb.prepare(
    `INSERT INTO super_chats
       (platform_id, uid, user_name, price, message, requester_guard_level,
        requester_medal_name, requester_medal_level, status, source,
        created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'active', 'superchat', ?, ?)`,
  );
  const base = Date.now();
  insert.run(
    `sc-${base}-1`, VIEWERS[0].uid, VIEWERS[0].name, 30,
    '点一首《晴天》送给直播间的大家！', VIEWERS[0].guard,
    VIEWERS[0].medal, VIEWERS[0].medalLevel,
    iso(base - 25 * 60 * 1000), iso(base - 25 * 60 * 1000),
  );
  insert.run(
    `sc-${base}-2`, VIEWERS[3].uid, VIEWERS[3].name, 50,
    '主播今天状态好好，加油加油～', VIEWERS[3].guard,
    VIEWERS[3].medal, VIEWERS[3].medalLevel,
    iso(base - 8 * 60 * 1000), iso(base - 8 * 60 * 1000),
  );
}

function seedGifts(giftDb) {
  const syncStore = createGiftSyncStore({ giftDb });
  const sourceKey = crypto
    .createHash('sha256').update('lira-usage-guide-demo').digest('hex');
  const source = syncStore.resolveSource(sourceKey);
  const now = Date.now();
  giftDb.prepare(
    `UPDATE gift_sync_state SET
       sync_epoch = 'demo-epoch', final_cursor = 1000, bootstrap_complete = 1,
       bootstrap_page_token = NULL, bootstrap_recovery_cursor = NULL,
       bootstrap_sync_epoch = NULL, projection_generation = 1,
       last_validated_at = ?, updated_at = ?
     WHERE source_id = ?`,
  ).run(iso(now), iso(now), source.id);

  const insert = giftDb.prepare(
    `INSERT INTO gift_events
       (source_id, platform_id, cmd, gift_id, gift_name, uid, user_name,
        num, unit_price, total_price, coin_type, is_blind_box, blind_box_id,
        blind_box_name, blind_box_price, blind_profit, counted_in_sprint,
        detection_status, first_detected_at_ms, last_platform_at_ms,
        finalized_at_ms, gift_stats_eligible, gift_stats_delivered,
        overtime_epoch, status, raw_json, created_at, updated_at)
     VALUES (?, ?, 'LIRA_SERVER_GIFT', ?, ?, ?, ?, ?, ?, ?, 'gold', ?, ?, ?, ?,
             ?, ?, 'final', 0, 0, 0, 1, 1, 0, 'active', '', ?, ?)`,
  );

  let seq = 0;
  function gift(atMs, viewer, name, count, unitPrice, extra = {}) {
    seq += 1;
    const total = unitPrice * count;
    const isBlindBox = extra.blindBox === true;
    insert.run(
      source.id, `lira-server:demo-${String(seq).padStart(3, '0')}`,
      GIFT_IDS[name] || '1099', name, viewer.uid, viewer.name,
      count, unitPrice, total,
      isBlindBox ? 1 : 0,
      extra.blindBoxId ?? null, extra.blindBoxName || '',
      isBlindBox ? (extra.boxPrice ?? null) : null,
      isBlindBox ? total - (extra.boxPrice ?? 0) : null,
      extra.sprint ? 1 : 0, iso(atMs), iso(atMs),
    );
  }

  const day = 24 * 60 * 60 * 1000;
  const today = new Date();
  today.setHours(9, 30, 0, 0);
  const start = today.getTime();

  // 昨天散票
  gift(start - day + 3600e3, VIEWERS[1], '辣条', 5, 0.1);
  gift(start - day + 3700e3, VIEWERS[2], '小花花', 3, 0.1);
  gift(start - day + 3900e3, VIEWERS[0], '打call', 10, 0.2, { sprint: true });

  // 今天上午：小花花雨（礼物许愿「本日」进度来源）
  for (let i = 0; i < 15; i += 1) {
    gift(start + i * 240e3, VIEWERS[i % 4], '小花花', 1 + (i % 3), 0.1);
  }
  // 打 call（「本场」许愿进度来源）
  for (let i = 0; i < 12; i += 1) {
    gift(start + 4000e3 + i * 180e3, VIEWERS[(i + 1) % 4], '打call', 2, 0.2, {
      sprint: true,
    });
  }
  // 棒棒糖与盲盒
  gift(start + 6400e3, VIEWERS[3], '棒棒糖', 6, 0.5, { sprint: true });
  gift(start + 6600e3, VIEWERS[0], '水晶球', 1, 100, {
    blindBox: true, blindBoxId: '2001', blindBoxName: '心动盲盒', boxPrice: 10,
    sprint: true,
  });
  gift(start + 6900e3, VIEWERS[1], '棒棒糖', 1, 0.5, {
    blindBox: true, blindBoxId: '2001', blindBoxName: '心动盲盒', boxPrice: 10,
  });
  gift(start + 7100e3, VIEWERS[2], '辣条', 2, 0.1, {
    blindBox: true, blindBoxId: '2002', blindBoxName: '心愿盲盒', boxPrice: 5,
  });
  // 三个水晶球（「长效」许愿进度来源）
  gift(start + 7600e3, VIEWERS[3], '水晶球', 1, 100, { sprint: true });
  gift(start - day + 4200e3, VIEWERS[0], '水晶球', 2, 100, { sprint: true });

  return { sourceId: source.id };
}

function seedGiftWishes(giftDb, sourceId) {
  const now = Date.now();
  const insert = giftDb.prepare(
    `INSERT INTO gift_wishes
       (id, source_id, period, gift_id, variant_id, gift_name, gift_category,
        image_path, target, label, created_at, display_style, text_template)
     VALUES (?, ?, ?, ?, '', ?, 'gift', '', ?, ?, ?, ?, ?)`,
  );
  insert.run(
    'wish-long-crystal', sourceId, 'long', GIFT_IDS['水晶球'], '水晶球',
    10, '集齐 10 个水晶球开专属歌回', iso(now - 3 * 86400e3), 'card', '',
  );
  insert.run(
    'wish-long-call', sourceId, 'long', GIFT_IDS['打call'], '打call',
    50, '本月打 call 冲 50 个', iso(now - 2 * 86400e3), 'card', '',
  );
  insert.run(
    'wish-long-flower', sourceId, 'long', GIFT_IDS['小花花'], '小花花',
    99, '', iso(now - 86400e3), 'text',
    '许愿小花花（{已收}/{目标}），谢谢大家的花花！',
  );
  insert.run(
    'wish-day-flower', sourceId, 'day', GIFT_IDS['小花花'], '小花花',
    99, '今天的小花花冲 99 朵', iso(now - 3600e3), 'card', '',
  );
  insert.run(
    'wish-session-call', sourceId, 'session', GIFT_IDS['打call'], '打call',
    30, '本场打 call 到 30 个', iso(now - 1800e3), 'text',
    '{name} 进度 {current}/{target}',
  );
  const today = new Date();
  today.setHours(9, 0, 0, 0);
  giftDb.prepare(
    `INSERT INTO gift_wish_sessions
       (source_id, room_id, started_at, ended_at, checked_at)
     VALUES (?, '', ?, '', ?)`,
  ).run(sourceId, iso(today.getTime()), iso(now));
}

function seedOvertime(giftDb) {
  const now = Date.now();
  giftDb.prepare(
    `UPDATE overtime_machine_state SET
       enabled = 1, enable_epoch = 1, initial_seconds = 3600,
       remaining_ms = 2345000, anchor_at_ms = ?, status = 'running',
       revision = 1, updated_at = ?
     WHERE id = 1`,
  ).run(now, iso(now));
  const rule = giftDb.prepare(
    `INSERT INTO overtime_gift_rules
       (gift_id, gift_name, image_path, mode, fixed_seconds, outcomes_json,
        enabled, sort_order, updated_at)
     VALUES (?, ?, '', 'fixed', ?, '', 1, ?, ?)`,
  );
  rule.run(GIFT_IDS['水晶球'], '水晶球', 300, 0, iso(now));
  rule.run(GIFT_IDS['辣条'], '辣条', 10, 1, iso(now));
}

function seedPlayback(musicDb) {
  const track = (id, title, artist, durationMs, requesterName = '') => ({
    id: `demo-${id}`,
    source: 'qq', trackId: `demo-${id}`, title, artists: [artist],
    album: '示例专辑', coverUrl: '', durationMs,
    ...(requesterName ? { requesterName } : {}),
  });
  const payload = {
    current: track('001', '晴天', '周杰伦', 269000),
    currentOrigin: 'normal',
    requestedQueue: [
      track('002', '起风了', '买辣椒也用券', 325000, '观众A'),
      track('003', 'Lemon', '米津玄師', 255000, '观众B'),
    ],
    normalQueue: [
      track('001', '晴天', '周杰伦', 269000),
      track('004', '平凡之路', '朴树', 302000, '观众D'),
      track('005', '勾指起誓', '洛天依', 183000, '观众C'),
      track('006', 'Shape of You', 'Ed Sheeran', 263000, '观众B'),
      track('007', '棠梨煎雪', '银临', 245000, '观众A'),
    ],
    normalQueueTracks: [],
    radioQueue: [],
    queueType: 'queue',
    queueTitle: '播放队列',
    queueSourceKey: '',
    playlistIndex: -1,
    pendingRequests: [
      {
        id: 'pending-1', songName: '紅蓮華',
        track: track('008', '紅蓮華', 'LiSA', 238000),
        requesterName: '观众C', score: 90, reasons: ['歌名匹配'],
      },
    ],
    history: [track('009', '不老梦', '银临', 252000)],
    displayHistory: [track('009', '不老梦', '银临', 252000)],
    mode: 'sequence',
    volume: 0.3,
    selectedSource: 'qq',
    qualityPreferences: { qq: 'standard', netease: 'standard' },
    shuffleOrder: [],
    shuffleCursor: 0,
    restoredTime: 0,
    clientId: 'default',
    timestamp: Date.now(),
  };
  musicDb.prepare(
    `INSERT INTO play_queue_state (client_id, payload, updated_at)
     VALUES ('default', ?, ?)`,
  ).run(JSON.stringify(payload), iso(Date.now()));

  const fav = musicDb.prepare(
    `INSERT INTO favorites
       (track_key, source, track_id, title, artists, album, cover_url,
        duration_ms, sort_order, created_at)
     VALUES (?, 'qq', ?, ?, ?, '示例专辑', '', ?, ?, ?)`,
  );
  [
    ['晴天', '周杰伦', 269000],
    ['Lemon', '米津玄師', 255000],
    ['牵丝戏', '银临&Aki阿杰', 240000],
  ].forEach(([title, artists, durationMs], index) => {
    fav.run(
      `qq:fav-${index}`, `fav-${index}`, title, artists, durationMs, index,
      iso(Date.now()),
    );
  });

  const history = musicDb.prepare(
    `INSERT INTO play_history
       (client_id, track_key, source, track_id, title, artists, album,
        cover_url, duration_ms, origin, requester_name, play_count, played_at,
        created_at, updated_at)
     VALUES ('default', ?, 'qq', ?, ?, ?, '示例专辑', '', ?, 'queue', ?, 1, ?, ?, ?)`,
  );
  [
    ['不老梦', '银临', 252000, ''],
    ['锦鲤抄', '银临', 233000, '观众B'],
    ['年少有为', '李荣浩', 276000, ''],
  ].forEach(([title, artists, durationMs, requester], index) => {
    const at = iso(Date.now() - (index + 1) * 900e3);
    history.run(
      `qq:hist-${index}`, `hist-${index}`, title, artists, durationMs,
      requester, at, at, at,
    );
  });
}

function seedCheckin(checkinDb) {
  const insert = checkinDb.prepare(
    `INSERT INTO checkin_users
       (uid, user_name, total_days, first_checkin_at, last_checkin_at,
        last_checkin_date, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
  );
  const now = Date.now();
  const today = iso(now).slice(0, 10);
  insert.run('100001', '观众A', 30, iso(now - 30 * 86400e3), iso(now - 3600e3), today, iso(now));
  insert.run('100002', '观众B', 12, iso(now - 20 * 86400e3), iso(now - 7200e3), today, iso(now));
  insert.run('100003', '观众C', 5, iso(now - 9 * 86400e3), iso(now - 86400e3), iso(now - 86400e3).slice(0, 10), iso(now));
}

function seedSettings(songDb) {
  const store = createSettingsStore(songDb);
  store.setSettings({
    // 房间号留空：避免启动时真实连接 B 站直播间拉取真实数据。
    roomId: '',
    giftSprintTargetRmb: '2000',
    enableGiftSprint: 'true',
    enableGiftNotification: 'true',
    overlayTitle: '示例主播的点歌板',
    songBoardTitle: '示例主播的歌单',
    openingName: '示例主播',
  });
}

function seed(dataDir) {
  const databases = createDatabases({ dataDir });
  let sourceId = null;
  try {
    seedSettings(databases.songDb);
    const categoryIds = seedCategories(databases.songDb);
    seedSongs(databases.songDb, categoryIds);
    seedSuperChats(databases.superChatDb);
    sourceId = seedGifts(databases.giftDb).sourceId;
    seedGiftWishes(databases.giftDb, sourceId);
    seedOvertime(databases.giftDb);
    seedPlayback(databases.musicDb);
    seedCheckin(databases.checkinDb);
  } finally {
    closeDatabases(databases);
  }
  // 截图运行器需要 sourceId 来设置活动礼物来源（setActiveGiftSource）
  fs.writeFileSync(
    path.join(dataDir, 'seed-meta.json'),
    `${JSON.stringify({ giftSourceId: sourceId }, null, 2)}\n`,
  );
}

function main() {
  const args = process.argv.slice(2);
  const force = args.includes('--force');
  const target =
    args.find((arg) => !arg.startsWith('--')) ||
    path.resolve(__dirname, '../../screenshots/usage-guide/data');
  const dataDir = path.resolve(target);
  if (fs.existsSync(dataDir)) {
    if (!force) {
      console.log(`[seed] 已存在，跳过：${dataDir}（--force 重建）`);
      return;
    }
    fs.rmSync(dataDir, { recursive: true, force: true });
  }
  fs.mkdirSync(dataDir, { recursive: true });
  seed(dataDir);
  console.log(`[seed] 示例数据已写入：${dataDir}`);
}

if (require.main === module) main();

module.exports = { seed };
