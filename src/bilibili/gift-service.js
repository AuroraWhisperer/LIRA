// 编写人：Aurora
// 礼物冲刺 + 礼物机器人解析。
// 从 Bilibili 直播礼物事件中记录付费礼物，支持冲刺目标和机器人回读。
'use strict';

const crypto = require('node:crypto');
const packetParser = require('./packet-parser');
const {
  cleanText, now, timestampToIso,
  normalizePositiveInteger, normalizeMoney, normalizeSignedMoney, normalizeNullableMoney,
  normalizeSuperChatPrice, normalizeTimestampMs, safeJsonStringify, safeParseJson
} = require('../shared/utils');

const CRYSTAL_BALL_VALUE_RMB = 100;
const GIFT_BOT_PENDING_MAX_AGE_MS = 15 * 1000;
const GIFT_BOT_MATCH_WINDOW_MS = 20 * 1000;
const GIFT_COMBO_PENDING_MAX_AGE_MS = 10 * 1000;

// ── 连击缓冲 ──

// 从 combo_id / batch_combo_id 中提取不含时间戳的根 key，
// 同一连击的所有 SEND_GIFT 事件共享同一个根 key，用于缓冲去重。
function extractComboRootKey(platformId) {
  if (!platformId) return null;
  const lower = platformId.toLowerCase();
  if (!lower.includes('combo') && !lower.includes('batch')) return null;
  const lastColon = platformId.lastIndexOf(':');
  if (lastColon <= 0) return null;
  const lastSegment = platformId.slice(lastColon + 1);
  // 最后一段应该是时间戳（10+ 位 Unix 时间，可能带小数）
  if (!/^\d{10,}(\.\d+)?$/.test(lastSegment)) return null;
  return platformId.slice(0, lastColon);
}

function mergeIntoComboBuffer(context, gift, comboKey) {
  const pending = context.state.giftComboPending.get(comboKey);
  if (pending) {
    pending.gift.num += gift.num;
    pending.gift.totalPrice = normalizeMoney(pending.gift.totalPrice + gift.totalPrice);
    pending.gift.unitPrice = pending.gift.num > 0
      ? normalizeMoney(pending.gift.totalPrice / pending.gift.num)
      : gift.unitPrice;
    pending.gift.createdAt = gift.createdAt;
    pending.gift.platformId = gift.platformId;
    pending.gift.rawJson = gift.rawJson;
    pending.createdAtMs = Date.now();
  } else {
    context.state.giftComboPending.set(comboKey, { gift, createdAtMs: Date.now() });
  }
}

function flushStaleComboBuffers(context) {
  const cutoff = Date.now() - GIFT_COMBO_PENDING_MAX_AGE_MS;
  for (const [key, pending] of context.state.giftComboPending.entries()) {
    if (pending && pending.createdAtMs < cutoff) {
      context.state.giftComboPending.delete(key);
      // skipComboBuffer=true 避免再次缓冲
      addGiftEvent(context, pending.gift, true);
    }
  }
}

// ── 盲盒匹配 ──

// 从 giftBlindBoxConfig 解析盲盒配置，构建 gift_name → 盲盒信息的查找表
// 配置格式：[{ "name": "星光盲盒", "price": 10, "outputs": ["心动卡", "星光"] }]
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
    const price = normalizeMoney(box && box.price);
    const outputs = Array.isArray(box && box.outputs) ? box.outputs : [];
    if (!boxName || price <= 0 || outputs.length === 0) continue;
    for (const outputName of outputs) {
      const key = cleanText(outputName);
      if (!key) continue;
      // 同一个礼物名可能出现在多个盲盒，后者覆盖前者
      map.set(key, { blindBoxName: boxName, price });
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

function addGiftEvent(context, input, skipComboBuffer) {
  const settings = context.settings();
  if (settings.enableGiftSprint !== 'true') return null;

  const gift = normalizeGiftInput(input);
  if (!gift.giftName && !gift.giftId) return null;
  // 免费礼物（价格为零）不存储
  if (gift.totalPrice <= 0) return null;

  const giftDb = context.db.giftDb;

  // 连击缓冲：SEND_GIFT 暂存，等 COMBO_SEND 或超时再写入
  if (!skipComboBuffer) {
    const comboKey = extractComboRootKey(gift.platformId);
    const cmd = cleanText(gift.cmd);
    if (comboKey && cmd.startsWith('COMBO_SEND')) {
      // 连击结束信号：清除缓冲，COMBO_SEND 自身作为最终记录插入
      context.state.giftComboPending.delete(comboKey);
    } else if (comboKey) {
      // 连击中的单次 SEND_GIFT：缓冲并累积
      flushStaleComboBuffers(context);
      mergeIntoComboBuffer(context, gift, comboKey);
      return null;
    }
  }

  // 盲盒匹配：协议未标记为盲盒的礼物，用预配置的映射表查找
  if (!gift.isBlindBox) {
    const matchedBox = matchBlindBox(context, gift.giftName);
    if (matchedBox) {
      gift.isBlindBox = true;
      gift.blindBoxName = matchedBox.blindBoxName;
      gift.blindBoxPrice = normalizeMoney(matchedBox.price * gift.num);
      gift.blindProfit = normalizeSignedMoney(gift.totalPrice - gift.blindBoxPrice);
    }
  }

  if (gift.platformId) {
    const existing = giftDb.prepare('SELECT * FROM gift_events WHERE platform_id = ? LIMIT 1').get(gift.platformId);
    if (existing) {
      if (existing.status === 'deleted') return null;
      // 同一 platformId（如 batch_combo_id）但不同用户 → 不同人的礼物，不应去重
      const existingUid = cleanText(existing.uid);
      const existingUser = cleanText(existing.user_name);
      if ((existingUid && gift.uid && existingUid !== gift.uid) ||
          (existingUser && gift.userName && existingUser !== gift.userName)) {
        // 不同用户，跳过 platformId 去重，走正常插入
      } else {
        return updateGiftEventIfProgressed(context, existing, gift);
      }
    }
  }
  const recentDuplicate = findRecentGiftCommandDuplicate(context, gift);
  if (recentDuplicate) return recentDuplicate;

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

  return normalizeGiftRow(giftDb.prepare('SELECT * FROM gift_events WHERE id = ?').get(Number(result.lastInsertRowid)));
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

// ── 礼物机器人弹幕解析 ──

function handleGiftBotDanmaku(context, danmaku) {
  const settings = context.settings();
  if (settings.enableGiftSprint !== 'true' || settings.enableGiftBotFallback !== 'true') return null;

  const botName = cleanText(danmaku && danmaku.userName);
  if (!isConfiguredGiftBotName(botName, settings)) return null;

  const text = cleanText(danmaku && danmaku.message);
  if (!text) return null;

  cleanupGiftBotPending(context);
  const messageTimestamp = normalizeTimestampMs(danmaku && danmaku.messageTimestamp) || Date.now();
  const pendingKey = normalizeGiftBotName(botName);
  const parsed = parseGiftBotDanmakuMessage(text, context.state.giftBotPendingByName.get(pendingKey));
  if (!parsed) return null;

  if (parsed.type === 'pending-user') {
    const resolvedAlias = resolveGiftBotAlias(parsed.userAlias, settings);
    context.state.giftBotPendingByName.set(pendingKey, {
      userAlias: resolvedAlias.userName,
      uid: resolvedAlias.uid,
      messageTimestamp,
      createdAtMs: Date.now()
    });
    return { parsed, item: null };
  }

  if (parsed.type === 'profit-report') {
    const item = updateLastGiftBotReportProfit(context, pendingKey, {
      ...parsed, botName, message: text, messageTimestamp
    });
    return { parsed, item };
  }

  const pending = context.state.giftBotPendingByName.get(pendingKey);
  if (pending && Date.now() - pending.createdAtMs <= GIFT_BOT_PENDING_MAX_AGE_MS) {
    parsed.userAlias = parsed.userAlias || pending.userAlias;
    parsed.uid = parsed.uid || pending.uid;
  }
  context.state.giftBotPendingByName.delete(pendingKey);

  const item = addOrMergeGiftBotEvent(context, {
    ...parsed, userName: parsed.userAlias || '机器人识别观众',
    uid: parsed.uid || '', botName, message: text, messageTimestamp
  });
  if (item) {
    context.state.giftBotLastReportByName.set(pendingKey, {
      giftEventId: item.id, createdAtMs: Date.now()
    });
  }
  return { parsed, item };
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

function getGiftSprintSnapshot(context) {
  const settings = context.settings();
  const targetRmb = normalizeMoney(settings.giftSprintTargetRmb);
  const row = context.db.giftDb.prepare(`
    SELECT
      COALESCE(SUM(
        CASE
          WHEN is_blind_box = 1 AND blind_box_price IS NOT NULL AND blind_box_price > 0
            THEN blind_box_price
          ELSE total_price
        END
      ), 0) AS receivedRmb,
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
    SELECT user_name, uid, blind_box_name, blind_box_price, total_price, blind_profit, num, created_at
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

    totalCost += cost;
    totalValue += value;
    totalProfit += profit;

    const entry = userMap.get(key) || { userName, uid, boxCount: 0, totalCost: 0, totalValue: 0, totalProfit: 0 };
    entry.boxCount += 1;
    entry.totalCost = normalizeMoney(entry.totalCost + cost);
    entry.totalValue = normalizeMoney(entry.totalValue + value);
    entry.totalProfit = normalizeSignedMoney(entry.totalProfit + profit);
    userMap.set(key, entry);
  }

  const perUser = Array.from(userMap.values())
    .sort((a, b) => b.totalProfit - a.totalProfit);

  return {
    today: todayStart,
    summary: {
      boxCount: rows.length,
      totalCost: normalizeMoney(totalCost),
      totalValue: normalizeMoney(totalValue),
      totalProfit: normalizeSignedMoney(totalProfit)
    },
    perUser
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
    sprint_count_price: Boolean(row.is_blind_box) && blindBoxPrice !== null ? blindBoxPrice : totalPrice
  };
}

function normalizeGiftInput(input) {
  const num = normalizePositiveInteger(input && input.num) || 1;
  const unitPrice = normalizeMoney(input && input.unitPrice);
  const totalPrice = normalizeMoney((input && input.totalPrice) || (unitPrice * num));
  const blindBoxPrice = input && input.blindBoxPrice === null ? null : normalizeNullableMoney(input && input.blindBoxPrice);
  const blindProfit = blindBoxPrice === null ? null : normalizeSignedMoney(totalPrice - blindBoxPrice);
  return {
    platformId: cleanText(input && input.platformId),
    cmd: cleanText(input && input.cmd),
    giftId: cleanText(input && input.giftId),
    giftName: cleanText(input && input.giftName),
    uid: cleanText(input && input.uid),
    userName: cleanText(input && input.userName) || '观众',
    num, unitPrice, totalPrice,
    coinType: cleanText(input && input.coinType),
    isBlindBox: Boolean(input && input.isBlindBox),
    blindBoxName: cleanText(input && input.blindBoxName),
    blindBoxPrice, blindProfit,
    rawJson: cleanText(input && input.rawJson),
    createdAt: timestampToIso(input && input.messageTimestamp) || now()
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

function findRecentGiftCommandDuplicate(context, gift) {
  const cmd = cleanText(gift && gift.cmd);
  const isCombo = cmd.startsWith('COMBO_SEND');
  const isSingleGift = cmd.startsWith('SEND_GIFT') || cmd.startsWith('BLIND_GIFT');
  if (!isCombo && !isSingleGift) return null;

  const createdAtMs = Date.parse(gift.createdAt) || Date.now();
  const startIso = new Date(createdAtMs - 5000).toISOString();
  const endIso = new Date(createdAtMs + 5000).toISOString();
  const row = context.db.giftDb.prepare(`
    SELECT * FROM gift_events
    WHERE status = 'active'
      AND created_at BETWEEN ? AND ?
      AND cmd != ? AND (cmd LIKE 'COMBO_SEND%' OR ? LIKE 'COMBO_SEND%')
      AND uid = ? AND gift_id = ? AND gift_name = ? AND num = ?
      AND ABS(total_price - ?) < 0.0001
    ORDER BY datetime(created_at) DESC, id DESC LIMIT 1
  `).get(startIso, endIso, cmd, cmd, gift.uid, gift.giftId, gift.giftName, gift.num, gift.totalPrice);
  return row ? normalizeGiftRow(row) : null;
}

function parseGiftBotDanmakuMessage(text, pending) {
  const thankMatch = text.match(/^感谢\s*(.+?)\s*的礼物[~～!！。]*$/);
  if (thankMatch) return { type: 'pending-user', userAlias: cleanText(thankMatch[1]) };

  const blindProfit = parseGiftBotProfit(text);
  const giftMatch = text.match(/(?:开出|抽中|获得)?\s*([^，,。]+?)\s*[x×＊*]\s*(\d+)/);
  const totalMatch = text.match(/共\s*([0-9]+(?:\.[0-9]+)?)\s*(电池|元|rmb|RMB)/);
  if ((!giftMatch || !totalMatch) && blindProfit !== null) {
    return { type: 'profit-report', isBlindBox: true, blindBoxName: parseGiftBotBlindBoxName(text) || '机器人识别盲盒', blindProfit };
  }
  if (!giftMatch || !totalMatch) return null;

  const unit = totalMatch[2].toLowerCase();
  const totalPrice = unit === '电池' ? normalizeMoney(Number(totalMatch[1]) / 10) : normalizeMoney(Number(totalMatch[1]));
  const num = normalizePositiveInteger(giftMatch[2]) || 1;
  const unitPrice = num > 0 ? normalizeMoney(totalPrice / num) : totalPrice;
  const isBlindBox = blindProfit !== null || text.includes('盲盒') || text.includes('盒子') || text.includes('盒');
  const blindBoxPrice = blindProfit === null ? null : normalizeMoney(totalPrice - blindProfit);
  const blindBoxName = parseGiftBotBlindBoxName(text) || (isBlindBox ? '机器人识别盲盒' : '');

  return {
    type: 'gift-report', userAlias: pending && pending.userAlias, uid: pending && pending.uid,
    giftName: cleanGiftBotGiftName(giftMatch[1]),
    num, unitPrice, totalPrice, coinType: unit === '电池' ? 'battery' : 'rmb',
    isBlindBox, blindBoxName, blindBoxPrice, blindProfit
  };
}

function parseGiftBotProfit(text) {
  const positive = text.match(/(?:赚(?:了)?|盈利)\s*([0-9]+(?:\.[0-9]+)?)\s*元/);
  if (positive) return normalizeSignedMoney(Number(positive[1]));
  const negative = text.match(/(?:亏(?:了)?|赔(?:了)?)\s*([0-9]+(?:\.[0-9]+)?)\s*元/);
  if (negative) return normalizeSignedMoney(-Number(negative[1]));
  return null;
}

function parseGiftBotBlindBoxName(text) {
  const match = text.match(/(?:通过|使用|开启|打开)\s*([^，,。]*?盒[^，,。]*?)\s*(?:开出|抽中|获得)/);
  return match ? cleanText(match[1]) : '';
}

function cleanGiftBotGiftName(value) {
  return cleanText(value)
    .replace(/^.*(?:开出|抽中|获得)\s*/, '')
    .replace(/^礼物\s*/, '')
    .replace(/[：:，,。]+$/g, '');
}

function addOrMergeGiftBotEvent(context, report) {
  if (!report || !report.giftName) return null;
  const matched = findRecentGiftEventForBotReport(context, report);
  if (matched) return updateGiftEventFromBotReport(context, matched, report);
  return addGiftEvent(context, {
    platformId: buildGiftBotPlatformId(report),
    cmd: 'GIFT_BOT_REPORT', giftId: '', giftName: report.giftName,
    uid: report.uid, userName: report.userName, num: report.num,
    unitPrice: report.unitPrice, totalPrice: report.totalPrice,
    coinType: report.coinType, isBlindBox: report.isBlindBox,
    blindBoxName: report.blindBoxName, blindBoxPrice: report.blindBoxPrice,
    messageTimestamp: report.messageTimestamp,
    rawJson: safeJsonStringify({ source: 'gift-bot', botName: report.botName, message: report.message })
  });
}

function findRecentGiftEventForBotReport(context, report) {
  const timestamp = normalizeTimestampMs(report.messageTimestamp) || Date.now();
  const startIso = new Date(timestamp - GIFT_BOT_MATCH_WINDOW_MS).toISOString();
  const endIso = new Date(timestamp + 5 * 1000).toISOString();
  const rows = context.db.giftDb.prepare(`
    SELECT * FROM gift_events
    WHERE status = 'active' AND created_at BETWEEN ? AND ?
    ORDER BY created_at DESC LIMIT 30
  `).all(startIso, endIso);

  const reportGiftName = normalizeGiftBotName(report.giftName);
  return rows.find((row) => {
    const sameGift = normalizeGiftBotName(row.gift_name) === reportGiftName;
    const sameNum = Number(row.num || 1) === Number(report.num || 1);
    const samePrice = Math.abs(Number(row.total_price || 0) - Number(report.totalPrice || 0)) <= 0.01;
    return sameGift && sameNum && samePrice;
  }) || null;
}

function normalizeGiftBotName(value) {
  return cleanText(value).replace(/\s+/g, '').toLowerCase();
}

function updateLastGiftBotReportProfit(context, pendingKey, report) {
  const recent = context.state.giftBotLastReportByName.get(pendingKey);
  if (!recent || Date.now() - recent.createdAtMs > GIFT_BOT_PENDING_MAX_AGE_MS) return null;

  const row = context.db.giftDb.prepare('SELECT * FROM gift_events WHERE id = ? AND status = ? LIMIT 1')
    .get(Number(recent.giftEventId), 'active');
  if (!row) return null;

  return updateGiftEventFromBotReport(context, row, {
    ...report, userName: row.user_name, uid: row.uid,
    giftName: row.gift_name, num: row.num, totalPrice: row.total_price,
    unitPrice: row.unit_price, isBlindBox: true,
    blindBoxName: report.blindBoxName || row.blind_box_name || '机器人识别盲盒',
    blindBoxPrice: normalizeMoney(Number(row.total_price || 0) - Number(report.blindProfit || 0))
  });
}

function updateGiftEventFromBotReport(context, row, report) {
  const giftDb = context.db.giftDb;
  const totalPrice = normalizeMoney(report.totalPrice || row.total_price);
  const blindBoxPrice = report.blindBoxPrice !== null && report.blindBoxPrice !== undefined
    ? normalizeMoney(report.blindBoxPrice) : row.blind_box_price;
  const blindProfit = report.blindProfit !== null && report.blindProfit !== undefined
    ? normalizeSignedMoney(report.blindProfit)
    : blindBoxPrice === null || blindBoxPrice === undefined ? row.blind_profit
      : normalizeSignedMoney(totalPrice - Number(blindBoxPrice || 0));
  const rawJson = safeJsonStringify({
    source: 'gift-bot-merge', previous: safeParseJson(row.raw_json),
    botName: report.botName, message: report.message
  });

  giftDb.prepare(`
    UPDATE gift_events
    SET user_name = CASE WHEN uid = '' AND user_name IN ('', '观众') THEN ? ELSE user_name END,
        uid = CASE WHEN uid = '' THEN ? ELSE uid END,
        is_blind_box = CASE WHEN ? = 1 THEN 1 ELSE is_blind_box END,
        blind_box_name = CASE WHEN ? != '' THEN ? ELSE blind_box_name END,
        blind_box_price = CASE WHEN ? IS NOT NULL THEN ? ELSE blind_box_price END,
        blind_profit = CASE WHEN ? IS NOT NULL THEN ? ELSE blind_profit END,
        raw_json = ?, updated_at = ?
    WHERE id = ?
  `).run(
    cleanText(report.userName), cleanText(report.uid),
    report.isBlindBox ? 1 : 0,
    cleanText(report.blindBoxName), cleanText(report.blindBoxName),
    blindBoxPrice, blindBoxPrice, blindProfit, blindProfit,
    rawJson, now(), row.id
  );
  return normalizeGiftRow(giftDb.prepare('SELECT * FROM gift_events WHERE id = ?').get(Number(row.id)));
}

function buildGiftBotPlatformId(report) {
  const hash = crypto.createHash('sha1')
    .update([ 'gift-bot', report.botName, report.userName, report.giftName, report.num, report.totalPrice,
      Math.floor((normalizeTimestampMs(report.messageTimestamp) || Date.now()) / 1000) ].join('|'))
    .digest('hex').slice(0, 16);
  return `gift-bot:${hash}`;
}

function cleanupGiftBotPending(context) {
  const cutoff = Date.now() - GIFT_BOT_PENDING_MAX_AGE_MS;
  for (const [key, pending] of context.state.giftBotPendingByName.entries()) {
    if (!pending || pending.createdAtMs < cutoff) context.state.giftBotPendingByName.delete(key);
  }
  for (const [key, report] of context.state.giftBotLastReportByName.entries()) {
    if (!report || report.createdAtMs < cutoff) context.state.giftBotLastReportByName.delete(key);
  }
}

function isConfiguredGiftBotName(userName, settings) {
  const normalized = normalizeGiftBotName(userName);
  if (!normalized) return false;
  return splitSettingList(settings.giftBotNames).map(normalizeGiftBotName).includes(normalized);
}

function resolveGiftBotAlias(alias, settings) {
  const normalizedAlias = normalizeGiftBotName(alias);
  const aliasMap = parseGiftBotAliasMap(settings.giftBotAliasMap);
  const mapped = aliasMap[normalizedAlias];
  if (!mapped) return { uid: '', userName: cleanText(alias) };
  if (typeof mapped === 'object') {
    return { uid: cleanText(mapped.uid), userName: cleanText(mapped.userName || mapped.name) || cleanText(alias) };
  }
  return { uid: '', userName: cleanText(mapped) || cleanText(alias) };
}

function parseGiftBotAliasMap(value) {
  const text = cleanText(value);
  if (!text) return {};
  try {
    const parsed = JSON.parse(text);
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
      const result = {};
      for (const [key, val] of Object.entries(parsed)) result[normalizeGiftBotName(key)] = val;
      return result;
    }
  } catch (_) { /* fall through */ }
  const result = {};
  for (const part of String(value).split(/[\n;,]+/)) {
    const [left, right] = part.split('=');
    if (left && right) result[normalizeGiftBotName(left)] = cleanText(right);
  }
  return result;
}

function splitSettingList(value) {
  return String(value || '').split(/[\n,，;；]+/).map(cleanText).filter(Boolean);
}

module.exports = {
  CRYSTAL_BALL_VALUE_RMB,
  repairGiftV2Events,
  addGiftEvent,
  handleGiftBotDanmaku,
  resetGiftSprintProgress,
  getGiftSnapshot,
  getGiftSprintSnapshot,
  getBlindBoxStats,
  normalizeGiftRow,
  normalizeGiftInput
};
