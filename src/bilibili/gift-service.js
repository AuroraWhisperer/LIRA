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

// ── 礼物事件入账 ──

function addGiftEvent(context, input) {
  const settings = context.settings();
  if (settings.enableGiftSprint !== 'true') return null;

  const gift = normalizeGiftInput(input);
  if (!gift.giftName && !gift.giftId) return null;

  const giftDb = context.db.giftDb;

  if (gift.platformId) {
    const existing = giftDb.prepare('SELECT * FROM gift_events WHERE platform_id = ? LIMIT 1').get(gift.platformId);
    if (existing) {
      if (existing.status === 'deleted') return null;
      return updateGiftEventIfProgressed(context, existing, gift);
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
  const recent = context.db.giftDb.prepare(`
    SELECT * FROM gift_events
    WHERE status = 'active'
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
  normalizeGiftRow,
  normalizeGiftInput
};
