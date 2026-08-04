// 编写人：Aurora
// 礼物冲刺服务。
// 从 Bilibili 直播礼物事件中记录付费礼物并统计冲刺目标。
'use strict';

const packetParser = require('./packet-parser');
const {
  cleanText, now, timestampToIso,
  normalizePositiveInteger, normalizeMoney, normalizeSignedMoney, normalizeNullableMoney,
  normalizeSuperChatPrice, normalizeTimestampMs, safeJsonStringify, safeParseJson
} = require('../shared/utils');

const CRYSTAL_BALL_VALUE_RMB = 100;
const GIFT_COMBO_PENDING_MAX_AGE_MS = 10 * 1000;

// ── 连击缓冲 ──

function extractComboRootKey(platformId) {
  if (!platformId) return null;
  const lower = platformId.toLowerCase();
  if (!lower.includes('combo') && !lower.includes('batch')) return null;
  return platformId;
}

function mergeIntoComboBuffer(context, gift, comboKey, nowMs = Date.now()) {
  const pending = context.state.giftComboPending.get(comboKey);
  const comboNum = normalizePositiveInteger(gift.comboNum);
  const comboTotalPrice = normalizeMoney(gift.comboTotalPrice);
  if (pending) {
    // Combo fields are cumulative; without them, num and totalPrice describe this packet only.
    if (comboNum > 0) {
      pending.gift.num = Math.max(pending.gift.num, comboNum);
    } else {
      pending.gift.num += gift.num;
    }
    if (comboTotalPrice > 0) {
      pending.gift.totalPrice = Math.max(pending.gift.totalPrice, comboTotalPrice);
    } else if (comboNum > 0) {
      pending.gift.totalPrice = Math.max(
        pending.gift.totalPrice,
        gift.totalPrice,
        normalizeMoney(gift.unitPrice * comboNum)
      );
    } else {
      pending.gift.totalPrice = normalizeMoney(pending.gift.totalPrice + gift.totalPrice);
    }
    pending.gift.unitPrice = pending.gift.num > 0
      ? normalizeMoney(pending.gift.totalPrice / pending.gift.num)
      : gift.unitPrice;
    pending.gift.createdAt = gift.createdAt;
    pending.gift.platformId = gift.platformId;
    pending.gift.cmd = gift.cmd;
    pending.gift.rawJson = gift.rawJson;
    pending.createdAtMs = nowMs;
  } else {
    if (comboNum > gift.num) gift.num = comboNum;
    if (comboTotalPrice > gift.totalPrice) {
      gift.totalPrice = comboTotalPrice;
    } else if (comboNum > 0) {
      gift.totalPrice = Math.max(gift.totalPrice, normalizeMoney(gift.unitPrice * comboNum));
    }
    if (gift.num > 0) gift.unitPrice = normalizeMoney(gift.totalPrice / gift.num);
    context.state.giftComboPending.set(comboKey, { gift, createdAtMs: nowMs });
  }
}

function flushStaleComboBuffers(context, { force = false, onGiftFlushed, nowMs = Date.now() } = {}) {
  const cutoff = nowMs - GIFT_COMBO_PENDING_MAX_AGE_MS;
  for (const [key, pending] of context.state.giftComboPending.entries()) {
    if (pending && (force || pending.createdAtMs <= cutoff)) {
      context.state.giftComboPending.delete(key);
      // 检查是否已有 COMBO_SEND 先入库（网络乱序场景）
      const existingComboSend = findRecentComboSendForBuffer(context, key, pending.gift);
      if (existingComboSend) {
        // 合并到已有的 COMBO_SEND 记录，避免重复插入
        const item = updateGiftEventIfProgressed(context, existingComboSend, pending.gift);
        if (item && typeof onGiftFlushed === 'function') onGiftFlushed(item);
        continue;
      }
      // skipComboBuffer=true 避免再次缓冲
      const item = addGiftEvent(context, pending.gift, true);
      if (item && typeof onGiftFlushed === 'function') onGiftFlushed(item);
    }
  }
}

function createGiftService(context, options = {}) {
  const onGiftFlushed = typeof options.onGiftFlushed === 'function' ? options.onGiftFlushed : null;
  const scheduleTimeout = options.setTimeout || setTimeout;
  const cancelTimeout = options.clearTimeout || clearTimeout;
  const nowMs = options.now || Date.now;
  let comboTimer = null;
  let disposed = false;

  function scheduleComboFlush() {
    if (comboTimer) {
      cancelTimeout(comboTimer);
      comboTimer = null;
    }
    if (disposed || context.state.giftComboPending.size === 0) return;

    let earliest = Infinity;
    for (const pending of context.state.giftComboPending.values()) {
      if (pending && Number.isFinite(pending.createdAtMs)) earliest = Math.min(earliest, pending.createdAtMs);
    }
    if (!Number.isFinite(earliest)) return;

    const delay = Math.max(0, earliest + GIFT_COMBO_PENDING_MAX_AGE_MS - nowMs());
    comboTimer = scheduleTimeout(() => {
      comboTimer = null;
      flushPendingCombos();
    }, delay);
    if (comboTimer && typeof comboTimer.unref === 'function') comboTimer.unref();
  }

  function flushPendingCombos({ force = false } = {}) {
    if (disposed && !force) return;
    flushStaleComboBuffers(context, { force, onGiftFlushed, nowMs: nowMs() });
    scheduleComboFlush();
  }

  function add(input) {
    if (disposed) return null;
    flushPendingCombos();
    const item = addGiftEvent(context, input, false, nowMs());
    scheduleComboFlush();
    return item;
  }

  function dispose() {
    if (disposed) return;
    if (comboTimer) {
      cancelTimeout(comboTimer);
      comboTimer = null;
    }
    disposed = true;
    flushStaleComboBuffers(context, { force: true, onGiftFlushed, nowMs: nowMs() });
  }

  return {
    add,
    dispose,
    getSnapshot: () => getGiftSnapshot(context),
    getHistory: (options) => getGiftHistory(context, options),
    getSprintSnapshot: () => getGiftSprintSnapshot(context),
    getBlindBoxStats: () => getBlindBoxStats(context),
    resetSprint: () => resetGiftSprintProgress(context),
    search: (options) => searchGifts(context, options || {}),
    clearRecent: () => clearRecentGifts(context)
  };
}

// 查找最近入库的 COMBO_SEND 记录，用于处理网络乱序
// （COMBO_SEND 比 SEND_GIFT 先到达 WebSocket 的情况）
function findRecentComboSendForBuffer(context, comboKey, gift) {
  if (!comboKey || !gift) return null;
  const createdAtMs = Date.parse(gift.createdAt) || Date.now();
  const startIso = new Date(createdAtMs - GIFT_COMBO_PENDING_MAX_AGE_MS).toISOString();
  const endIso = new Date(createdAtMs + 2000).toISOString();
  const rows = context.db.giftDb.prepare(`
    SELECT * FROM gift_events
    WHERE status = 'active'
      AND created_at BETWEEN ? AND ?
      AND cmd LIKE 'COMBO_SEND%'
      AND platform_id = ?
    ORDER BY datetime(created_at) DESC, id DESC
    LIMIT 5
  `).all(startIso, endIso, comboKey);
  if (rows.length === 0) return null;
  // 优先匹配相同 uid 和 gift_id
  const exact = rows.find(r =>
    cleanText(r.uid) === cleanText(gift.uid) &&
    cleanText(r.gift_id) === cleanText(gift.giftId)
  );
  return exact || rows[0];
}

// ── 盲盒匹配 ──

// 从 giftBlindBoxConfig 解析盲盒配置，构建 gift_name → 盲盒信息的查找表
// 配置格式：
//   [{
//     "name": "星光盲盒", "price": 10,
//     "outputs": [
//       "心动卡",                                  // 仅名称，实际价值 = 盲盒成本
//       { "name": "星光", "price": 12 }            // 名称 + 实际价值
//     ]
//   }]
function loadBlindBoxMap(context) {
  const settings = context.settings();
  const raw = cleanText(settings.giftBlindBoxConfig);
  if (!raw) return null;

  // 缓存：settings 对象不变则复用
  if (context.state.blindBoxCache && context.state.blindBoxCache.raw === raw) {
    return context.state.blindBoxCache.map;
  }

  let configs = [];
  try {
    configs = JSON.parse(raw);
    if (!Array.isArray(configs)) configs = [];
  } catch (_) {
    configs = [];
  }

  const map = new Map();
  for (const box of configs) {
    const boxName = cleanText(box && box.name);
    const boxPrice = normalizeMoney(box && box.price);
    const outputs = Array.isArray(box && box.outputs) ? box.outputs : [];
    if (!boxName || boxPrice <= 0 || outputs.length === 0) continue;
    for (const output of outputs) {
      let key, giftPrice;
      if (typeof output === 'object' && output !== null) {
        key = cleanText(output.name);
        giftPrice = normalizeMoney(output.price) || null;
      } else {
        key = cleanText(String(output));
        giftPrice = null; // 无独立价格时回退用盲盒成本
      }
      if (!key) continue;
      // 同一个礼物名可能出现在多个盲盒，后者覆盖前者
      map.set(key, { blindBoxName: boxName, boxPrice, giftPrice });
    }
  }

  context.state.blindBoxCache = { raw, map: map.size > 0 ? map : null };
  return context.state.blindBoxCache.map;
}

function matchBlindBox(context, giftName) {
  const map = loadBlindBoxMap(context);
  if (!map) return null;
  return map.get(cleanText(giftName)) || null;
}

// ── 礼物事件入账 ──

function addGiftEvent(context, input, skipComboBuffer, nowMs = Date.now()) {
  const settings = context.settings();
  if (settings.enableGiftSprint !== 'true') {
    logGiftServiceDecision('ignored', input, null, 'disabled');
    return null;
  }

  const gift = normalizeGiftInput(input);
  if (!gift.giftName && !gift.giftId) {
    logGiftServiceDecision('ignored', gift, null, 'invalid-gift');
    return null;
  }
  // 免费礼物（价格为零）不存储
  if (gift.totalPrice <= 0) {
    logGiftServiceDecision('ignored', gift, null, 'non-positive-price');
    return null;
  }

  const giftDb = context.db.giftDb;

  // 连击缓冲：SEND_GIFT 暂存，等 COMBO_SEND 或超时再写入
  if (!skipComboBuffer) {
    const comboKey = extractComboRootKey(gift.comboId || gift.platformId);
    const cmd = cleanText(gift.cmd);
    if (comboKey && cmd.startsWith('COMBO_SEND')) {
      // 连击结束信号：将缓冲中的 SEND_GIFT 数据合并到 COMBO_SEND
      const pending = context.state.giftComboPending.get(comboKey);
      if (pending) {
        // 使用缓冲中累积的较大值
        gift.num = Math.max(gift.num, pending.gift.num);
        gift.totalPrice = Math.max(gift.totalPrice, pending.gift.totalPrice);
        if (gift.num > 0) gift.unitPrice = normalizeMoney(gift.totalPrice / gift.num);
      }
      context.state.giftComboPending.delete(comboKey);
    } else if (comboKey) {
      // 连击中的单次 SEND_GIFT：缓冲并累积
      flushStaleComboBuffers(context, { nowMs });
      mergeIntoComboBuffer(context, gift, comboKey, nowMs);
      logGiftServiceDecision('buffered', gift, null, 'combo-pending', { comboKey });
      return null;
    }
  }

  // 盲盒匹配：协议可能已标记为盲盒（BLIND_GIFT），也可能未标记。
  // 无论哪种情况，都要用预配置的映射表查找，因为协议发的 totalPrice 是盲盒成本价，
  // 而映射表里配置了礼物的实际价值，需要覆盖。
  // 匹配时优先用协议给的 blindBoxName（盲盒开出的具体礼物名），
  // 其次用 giftName（可能是礼物名也可能是盲盒名）。
  const matchedBox = matchBlindBox(context, gift.blindBoxName) || matchBlindBox(context, gift.giftName);
  if (matchedBox) {
    if (!gift.isBlindBox) {
      gift.isBlindBox = true;
    }
    // 映射表的盲盒名（用户配置的盲盒类型）优先于协议字段
    gift.blindBoxName = matchedBox.blindBoxName || gift.blindBoxName;
    if (gift.blindBoxPrice === null || gift.blindBoxPrice === undefined) {
      gift.blindBoxPrice = normalizeMoney(matchedBox.boxPrice * gift.num);
    }
    // 如果配置了礼物的实际价值，用它覆盖协议的 totalPrice（协议发的是盲盒成本价）
    if (matchedBox.giftPrice !== null && matchedBox.giftPrice !== undefined && matchedBox.giftPrice > 0) {
      gift.totalPrice = normalizeMoney(matchedBox.giftPrice * gift.num);
      gift.unitPrice = matchedBox.giftPrice;
    }
    gift.blindProfit = normalizeSignedMoney(gift.totalPrice - gift.blindBoxPrice);
  }

  if (gift.platformId) {
    const existing = findGiftByPlatformIdentity(giftDb, gift);
    if (existing) {
      if (existing.status === 'deleted') {
        logGiftServiceDecision('ignored', gift, existing, 'deleted-platform-id');
        return null;
      }
      const progressed = hasGiftProgressed(existing, gift);
      const item = updateGiftEventIfProgressed(context, existing, gift);
      logGiftServiceDecision(progressed ? 'updated' : 'deduplicated', gift, item, 'platform-id');
      return item;
    }
  }
  const recentDuplicate = findRecentGiftCommandDuplicate(context, gift);
  if (recentDuplicate) {
    logGiftServiceDecision('deduplicated', gift, recentDuplicate, 'cross-command');
    return recentDuplicate;
  }

  const countedInSprint = gift.totalPrice > 0 ? 1 : 0;
  const result = giftDb.prepare(`
    INSERT INTO gift_events (
      platform_id, cmd, gift_id, gift_name,
      uid, user_name, num, unit_price, total_price, coin_type,
      is_blind_box, blind_box_name, blind_box_price, blind_profit,
      counted_in_sprint, status, raw_json, created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'active', ?, ?, ?)
  `).run(
    gift.platformId, gift.cmd, gift.giftId, gift.giftName,
    gift.uid, gift.userName, gift.num, gift.unitPrice, gift.totalPrice, gift.coinType,
    gift.isBlindBox ? 1 : 0, gift.blindBoxName, gift.blindBoxPrice, gift.blindProfit,
    countedInSprint, gift.rawJson, gift.createdAt, gift.createdAt
  );

  const item = normalizeGiftRow(giftDb.prepare('SELECT * FROM gift_events WHERE id = ?').get(Number(result.lastInsertRowid)));
  logGiftServiceDecision('inserted', gift, item);
  return item;
}

function repairGiftV2Events(context) {
  const giftDb = context.db.giftDb;
  const rows = giftDb.prepare(`
    SELECT *
    FROM gift_events
    WHERE status = 'active'
      AND cmd LIKE 'SEND_GIFT_V2%'
      AND total_price <= 0
      AND raw_json != ''
    ORDER BY id ASC
    LIMIT 200
  `).all();
  if (rows.length === 0) return;

  const statement = giftDb.prepare(`
    UPDATE gift_events
    SET platform_id = ?,
        gift_id = ?,
        gift_name = ?,
        uid = ?,
        user_name = ?,
        num = ?,
        unit_price = ?,
        total_price = ?,
        coin_type = ?,
        counted_in_sprint = ?,
        created_at = ?,
        updated_at = ?
    WHERE id = ?
  `);

  let repaired = 0;
  giftDb.exec('BEGIN');
  try {
    for (const row of rows) {
      const packet = safeParseJson(row.raw_json);
      const parsed = packetParser.extractBilibiliGiftMessage(packet);
      const gift = parsed ? normalizeGiftInput(parsed) : null;
      if (!gift || gift.totalPrice <= 0) continue;

      const existing = gift.platformId ? findGiftByPlatformIdentity(giftDb, gift) : null;
      if (existing && Number(existing.id) !== Number(row.id)) {
        updateGiftEventIfProgressed(context, existing, gift);
        giftDb.prepare('DELETE FROM gift_events WHERE id = ?').run(Number(row.id));
        repaired += 1;
        continue;
      }

      statement.run(
        gift.platformId || cleanText(row.platform_id),
        gift.giftId || cleanText(row.gift_id),
        gift.giftName || cleanText(row.gift_name),
        gift.uid || cleanText(row.uid),
        gift.userName || cleanText(row.user_name),
        gift.num,
        gift.unitPrice,
        gift.totalPrice,
        gift.coinType || cleanText(row.coin_type),
        1,
        gift.createdAt || cleanText(row.created_at),
        now(),
        row.id
      );
      repaired += 1;
    }
    giftDb.exec('COMMIT');
  } catch (error) {
    giftDb.exec('ROLLBACK');
    throw error;
  }

  if (repaired > 0) {
    console.log(`[Startup] repaired ${repaired} SEND_GIFT_V2 gift record(s).`);
  }
}

// ── 冲刺快照 ──

function resetGiftSprintProgress(context) {
  const giftDb = context.db.giftDb;
  const result = giftDb.prepare(`
    UPDATE gift_events SET counted_in_sprint = 0, updated_at = ?
    WHERE counted_in_sprint = 1
  `).run(now());
  return {
    reset: true,
    changedCount: Number(result.changes || 0),
    giftSprint: getGiftSprintSnapshot(context)
  };
}

function getGiftSnapshot(context) {
  // 先清理超时缓冲，防止闲置时缓冲礼物永远不会写入
  flushStaleComboBuffers(context);
  const recent = context.db.giftDb.prepare(`
    SELECT * FROM gift_events
    WHERE status = 'active' AND total_price > 0
    ORDER BY datetime(created_at) DESC, id DESC
    LIMIT 30
  `).all().map(normalizeGiftRow);
  return { recent };
}

function getGiftHistory(context, options = {}) {
  flushStaleComboBuffers(context);
  const giftDb = context.db.giftDb;
  const limit = Math.min(100, Math.max(1, Math.floor(Number(options.limit) || 50)));
  const page = Math.max(1, Math.floor(Number(options.page) || 1));

  // 支持全局排序
  const sortField = String(options.sortField || 'created_at');
  const sortDirection = String(options.sortDirection || 'desc').toLowerCase() === 'asc' ? 'ASC' : 'DESC';

  // 构建排序子句
  let orderByClause = '';
  switch (sortField) {
    case 'gift_name':
      orderByClause = `gift_name ${sortDirection}, id DESC`;
      break;
    case 'price':
      orderByClause = `total_price ${sortDirection}, id DESC`;
      break;
    case 'remarks':
      // 备注排序：大航海 > 盲盒盈亏 > 其他
      // 使用CASE表达式计算排序权重
      orderByClause = `
        CASE
          WHEN gift_name LIKE '%总督%' OR gift_id = 'guard-1' THEN 3000
          WHEN gift_name LIKE '%提督%' OR gift_id = 'guard-2' THEN 2000
          WHEN gift_name LIKE '%舰长%' OR gift_id = 'guard-3' THEN 1000
          WHEN is_blind_box = 1 THEN COALESCE(blind_profit, 0)
          ELSE -999999
        END ${sortDirection}, id DESC`;
      break;
    case 'created_at':
    default:
      orderByClause = `datetime(created_at) ${sortDirection}, id DESC`;
      break;
  }

  // 显示上限：只查询最近3000条记录用于显示
  // 首先获取最近3000条记录的ID范围
  const displayLimitIds = giftDb.prepare(`
    SELECT id FROM gift_events
    WHERE status = 'active' AND total_price > 0
    ORDER BY datetime(created_at) DESC, id DESC
    LIMIT 3000
  `).all().map(row => row.id);

  if (displayLimitIds.length === 0) {
    return { items: [], total: 0, page: 1, limit, totalPages: 1 };
  }

  // 在显示范围内进行排序和分页
  const minId = Math.min(...displayLimitIds);
  const maxId = Math.max(...displayLimitIds);

  const totalRow = giftDb.prepare(`
    SELECT COUNT(*) AS count
    FROM gift_events
    WHERE status = 'active' AND total_price > 0 AND id >= ? AND id <= ?
  `).get(minId, maxId) || {};
  const total = Number(totalRow.count || 0);
  const totalPages = Math.max(1, Math.ceil(total / limit));
  const safePage = Math.min(page, totalPages);

  const items = giftDb.prepare(`
    SELECT * FROM gift_events
    WHERE status = 'active' AND total_price > 0 AND id >= ? AND id <= ?
    ORDER BY ${orderByClause}
    LIMIT ? OFFSET ?
  `).all(minId, maxId, limit, (safePage - 1) * limit).map(normalizeGiftRow);

  return { items, total, page: safePage, limit, totalPages };
}

function getGiftSprintSnapshot(context) {
  const settings = context.settings();
  const targetRmb = normalizeMoney(settings.giftSprintTargetRmb);
  const row = context.db.giftDb.prepare(`
    SELECT
      COALESCE(SUM(total_price), 0) AS receivedRmb,
      COUNT(*) AS countedGiftCount
    FROM gift_events
    WHERE status = 'active' AND counted_in_sprint = 1
  `).get() || {};
  const receivedRmb = normalizeMoney(row.receivedRmb);
  const remainingRmb = Math.max(0, normalizeMoney(targetRmb - receivedRmb));

  return {
    enabled: settings.enableGiftSprint === 'true',
    targetRmb,
    receivedRmb,
    remainingRmb,
    crystalBallValueRmb: CRYSTAL_BALL_VALUE_RMB,
    remainingCrystalBalls: Math.ceil(remainingRmb / CRYSTAL_BALL_VALUE_RMB),
    countedGiftCount: Number(row.countedGiftCount || 0)
  };
}

// ── 礼物查询 ──

function searchGifts(context, { from, to, limit = 100 }) {
  // 先清理超时缓冲
  flushStaleComboBuffers(context);
  const giftDb = context.db.giftDb;
  let sql = `SELECT * FROM gift_events WHERE status = 'active' AND total_price > 0`;
  const params = [];

  if (from) {
    sql += ` AND created_at >= ?`;
    params.push(from);
  }
  if (to) {
    sql += ` AND created_at <= ?`;
    params.push(to);
  }

  sql += ` ORDER BY datetime(created_at) DESC, id DESC LIMIT ?`;
  params.push(Math.min(limit, 500));

  return giftDb.prepare(sql).all(...params).map(normalizeGiftRow);
}

// ── 盲盒盈亏统计 ──

function getBlindBoxStats(context) {
  // 先清理超时缓冲
  flushStaleComboBuffers(context);
  const giftDb = context.db.giftDb;

  // 今天 0 点 ISO 字符串
  const today = new Date();
  const todayStart = new Date(today.getFullYear(), today.getMonth(), today.getDate()).toISOString();

  // 今天所有盲盒礼物（is_blind_box=1 且有 blind_profit）
  const rows = giftDb.prepare(`
    SELECT id, user_name, uid, blind_box_name, blind_box_price, total_price, blind_profit, num, created_at
    FROM gift_events
    WHERE status = 'active'
      AND is_blind_box = 1
      AND blind_profit IS NOT NULL
      AND created_at >= ?
    ORDER BY datetime(created_at) DESC, id DESC
  `).all(todayStart);

  if (rows.length === 0) {
    return {
      today: todayStart,
      summary: { boxCount: 0, totalCost: 0, totalValue: 0, totalProfit: 0 },
      perUser: []
    };
  }

  // 按用户聚合
  const userMap = new Map();
  let totalCost = 0;
  let totalValue = 0;
  let totalProfit = 0;

  for (const row of rows) {
    const userName = (row.user_name || '观众').trim();
    const uid = (row.uid || '').trim();
    const key = uid || userName;
    const cost = normalizeMoney(row.blind_box_price);
    const value = normalizeMoney(row.total_price);
    const profit = normalizeSignedMoney(row.blind_profit);
    const boxCount = normalizePositiveInteger(row.num) || 1;

    totalCost += cost;
    totalValue += value;
    totalProfit += profit;

    const entry = userMap.get(key) || { userName, uid, boxCount: 0, totalCost: 0, totalValue: 0, totalProfit: 0 };
    entry.boxCount += boxCount;
    entry.totalCost = normalizeMoney(entry.totalCost + cost);
    entry.totalValue = normalizeMoney(entry.totalValue + value);
    entry.totalProfit = normalizeSignedMoney(entry.totalProfit + profit);
    userMap.set(key, entry);
  }

  const perUser = Array.from(userMap.values())
    .sort((a, b) => b.totalProfit - a.totalProfit);

  // 每条盲盒开盒记录（最多 500 条），用于 admin 页面滚动展示
  const MAX_RECORDS = 500;
  const records = rows.slice(0, MAX_RECORDS).map(row => ({
    id: row.id,
    user_name: (row.user_name || '观众').trim(),
    uid: (row.uid || '').trim(),
    blind_box_name: row.blind_box_name || '',
    cost: normalizeMoney(row.blind_box_price),
    value: normalizeMoney(row.total_price),
    profit: normalizeSignedMoney(row.blind_profit),
    num: row.num || 1,
    created_at: row.created_at
  }));

  return {
    today: todayStart,
    summary: {
      boxCount: rows.reduce((sum, row) => sum + (normalizePositiveInteger(row.num) || 1), 0),
      totalCost: normalizeMoney(totalCost),
      totalValue: normalizeMoney(totalValue),
      totalProfit: normalizeSignedMoney(totalProfit)
    },
    perUser,
    records
  };
}

// ── 规范化 ──

function normalizeGiftRow(row) {
  if (!row) return null;
  const blindBoxPrice = row.blind_box_price === null || row.blind_box_price === undefined ? null : normalizeMoney(row.blind_box_price);
  const totalPrice = normalizeMoney(row.total_price);
  return {
    ...row,
    num: normalizePositiveInteger(row.num) || 1,
    unit_price: normalizeMoney(row.unit_price),
    total_price: totalPrice,
    is_blind_box: Boolean(row.is_blind_box),
    blind_box_name: cleanText(row.blind_box_name),
    blind_box_price: blindBoxPrice,
    blind_profit: row.blind_profit === null || row.blind_profit === undefined ? null : normalizeSignedMoney(row.blind_profit),
    counted_in_sprint: Boolean(row.counted_in_sprint),
    sprint_count_price: totalPrice
  };
}

function normalizeGiftInput(input) {
  const num = normalizePositiveInteger(input && input.num) || 1;
  const comboNum = normalizePositiveInteger(input && input.comboNum);
  const unitPrice = normalizeMoney(input && input.unitPrice);
  const totalPrice = normalizeMoney((input && input.totalPrice) || (unitPrice * num));
  const comboTotalPrice = normalizeMoney(input && input.comboTotalPrice);
  const blindBoxPrice = input && input.blindBoxPrice === null ? null : normalizeNullableMoney(input && input.blindBoxPrice);
  const blindProfit = blindBoxPrice === null ? null : normalizeSignedMoney(totalPrice - blindBoxPrice);
  return {
    platformId: cleanText(input && input.platformId),
    comboId: cleanText(input && input.comboId),
    cmd: cleanText(input && input.cmd),
    giftId: cleanText(input && input.giftId),
    giftName: cleanText(input && input.giftName),
    uid: cleanText(input && input.uid),
    userName: cleanText(input && input.userName) || '观众',
    num, comboNum, unitPrice, totalPrice, comboTotalPrice,
    coinType: cleanText(input && input.coinType),
    isBlindBox: Boolean(input && input.isBlindBox),
    blindBoxName: cleanText(input && input.blindBoxName),
    blindBoxPrice, blindProfit,
    rawJson: cleanText(input && input.rawJson),
    createdAt: timestampToIso(input && input.messageTimestamp)
      || cleanText(input && input.createdAt)
      || now()
  };
}

// ── 内部辅助 ──

function updateGiftEventIfProgressed(context, row, gift) {
  const existingNum = normalizePositiveInteger(row.num) || 1;
  const nextNum = normalizePositiveInteger(gift.num) || 1;
  const existingTotal = normalizeMoney(row.total_price);
  const nextTotal = normalizeMoney(gift.totalPrice);
  if (nextNum <= existingNum && nextTotal <= existingTotal) return normalizeGiftRow(row);

  const mergedNum = Math.max(existingNum, nextNum);
  const mergedTotal = Math.max(existingTotal, nextTotal);
  const mergedUnit = mergedNum > 0 ? normalizeMoney(mergedTotal / mergedNum) : normalizeMoney(gift.unitPrice);
  const blindBoxPrice = gift.blindBoxPrice === null ? row.blind_box_price : gift.blindBoxPrice;
  const blindProfit = blindBoxPrice === null || blindBoxPrice === undefined
    ? null : normalizeSignedMoney(mergedTotal - Number(blindBoxPrice || 0));
  const updatedAt = gift.createdAt || now();

  const giftDb = context.db.giftDb;
  giftDb.prepare(`
    UPDATE gift_events
    SET gift_id = ?, gift_name = ?, uid = ?, user_name = ?,
        num = ?, unit_price = ?, total_price = ?, coin_type = ?,
        is_blind_box = ?, blind_box_name = ?, blind_box_price = ?,
        blind_profit = ?, counted_in_sprint = ?, raw_json = ?, updated_at = ?
    WHERE id = ?
  `).run(
    gift.giftId || cleanText(row.gift_id), gift.giftName || cleanText(row.gift_name),
    gift.uid || cleanText(row.uid), gift.userName || cleanText(row.user_name),
    mergedNum, mergedUnit, mergedTotal, gift.coinType || cleanText(row.coin_type),
    gift.isBlindBox ? 1 : Number(row.is_blind_box || 0),
    gift.blindBoxName || cleanText(row.blind_box_name),
    blindBoxPrice, blindProfit,
    mergedTotal > 0 ? 1 : Number(row.counted_in_sprint || 0),
    gift.rawJson || cleanText(row.raw_json), updatedAt, Number(row.id)
  );
  return normalizeGiftRow(giftDb.prepare('SELECT * FROM gift_events WHERE id = ?').get(Number(row.id)));
}

function hasGiftProgressed(row, gift) {
  const existingNum = normalizePositiveInteger(row && row.num) || 1;
  const nextNum = normalizePositiveInteger(gift && gift.num) || 1;
  const existingTotal = normalizeMoney(row && row.total_price);
  const nextTotal = normalizeMoney(gift && gift.totalPrice);
  return nextNum > existingNum || nextTotal > existingTotal;
}

function findGiftByPlatformIdentity(giftDb, gift) {
  if (gift.uid) {
    return giftDb.prepare(`
      SELECT * FROM gift_events
      WHERE platform_id = ? AND uid = ?
      ORDER BY id ASC LIMIT 1
    `).get(gift.platformId, gift.uid);
  }

  return giftDb.prepare(`
    SELECT * FROM gift_events
    WHERE platform_id = ? AND uid = '' AND user_name = ?
    ORDER BY id ASC LIMIT 1
  `).get(gift.platformId, gift.userName);
}

function logGiftServiceDecision(action, gift, item = null, reason = '', extraTrace = null) {
  const trace = {
    eventId: Number(item && item.id) || 0,
    platformId: cleanText(gift && (gift.platformId || gift.platform_id)),
    comboId: cleanText(gift && gift.comboId),
    cmd: cleanText(gift && gift.cmd),
    uid: cleanText(gift && gift.uid),
    userName: cleanText(gift && (gift.userName || gift.user_name)),
    giftId: cleanText(gift && (gift.giftId || gift.gift_id)),
    giftName: cleanText(gift && (gift.giftName || gift.gift_name)),
    num: normalizePositiveInteger(gift && gift.num) || 1,
    totalPrice: normalizeMoney(gift && (gift.totalPrice ?? gift.total_price)),
    messageTimestamp: timestampToIso(gift && gift.messageTimestamp) || cleanText(gift && gift.createdAt)
  };
  if (extraTrace && typeof extraTrace === 'object') Object.assign(trace, extraTrace);
  const reasonText = reason ? ` reason=${reason}` : '';
  console.log(`[Bilibili][GiftService] action=${action}${reasonText} trace=${JSON.stringify(trace)}`);
}

function findRecentGiftCommandDuplicate(context, gift) {
  const cmd = cleanText(gift && gift.cmd);
  const isCombo = cmd.startsWith('COMBO_SEND');
  const isSingleGift = cmd.startsWith('SEND_GIFT') || cmd.startsWith('BLIND_GIFT');
  if (!isCombo && !isSingleGift) return null;

  const createdAtMs = Date.parse(gift.createdAt) || Date.now();
  const startIso = new Date(createdAtMs - 5000).toISOString();
  const endIso = new Date(createdAtMs + 5000).toISOString();

  // 先检查是否存在不同CMD的重复（SEND_GIFT vs COMBO_SEND 的去重）
  const crossCmdRow = context.db.giftDb.prepare(`
    SELECT * FROM gift_events
    WHERE status = 'active'
      AND created_at BETWEEN ? AND ?
      AND cmd != ? AND (cmd LIKE 'COMBO_SEND%' OR ? LIKE 'COMBO_SEND%')
      AND uid = ? AND gift_id = ? AND gift_name = ? AND num = ?
      AND ABS(total_price - ?) < 0.0001
    ORDER BY datetime(created_at) DESC, id DESC LIMIT 1
  `).get(startIso, endIso, cmd, cmd, gift.uid, gift.giftId, gift.giftName, gift.num, gift.totalPrice);
  if (crossCmdRow) return normalizeGiftRow(crossCmdRow);

  return null;
}

// ── 清理函数 ──

function clearRecentGifts(context) {
  // 清理"显示"：只清理抽屉中显示的最近3000条记录
  const giftDb = context.db.giftDb;

  giftDb.exec('BEGIN');
  try {
    // 获取最近3000条记录的ID
    const displayIds = giftDb.prepare(`
      SELECT id FROM gift_events
      WHERE status = 'active' AND total_price > 0
      ORDER BY datetime(created_at) DESC, id DESC
      LIMIT 3000
    `).all().map(row => row.id);

    if (displayIds.length === 0) {
      giftDb.exec('COMMIT');
      return { cleared: true, scope: 'display-gifts', deletedCount: 0 };
    }

    // 删除这些记录
    const placeholders = displayIds.map(() => '?').join(',');
    const result = giftDb.prepare(`
      DELETE FROM gift_events WHERE id IN (${placeholders})
    `).run(...displayIds);

    giftDb.exec('COMMIT');
    return { cleared: true, scope: 'display-gifts', deletedCount: Number(result.changes || 0) };
  } catch (error) {
    giftDb.exec('ROLLBACK');
    throw error;
  }
}

module.exports = {
  CRYSTAL_BALL_VALUE_RMB,
  createGiftService,
  repairGiftV2Events,
  addGiftEvent,
  resetGiftSprintProgress,
  getGiftSnapshot,
  getGiftHistory,
  getGiftSprintSnapshot,
  getBlindBoxStats,
  searchGifts,
  normalizeGiftRow,
  normalizeGiftInput,
  clearRecentGifts
};
