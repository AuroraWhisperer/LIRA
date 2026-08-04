'use strict';

const packetParser = require('../packet-parser');
const { matchBlindBox } = require('./blind-box-config');
const { normalizeGiftRow, normalizeGiftInput } = require('./normalizer');
const {
  cleanText,
  now,
  timestampToIso,
  normalizePositiveInteger,
  normalizeMoney,
  normalizeSignedMoney,
  safeParseJson
} = require('../../shared/utils');

const GIFT_COMBO_PENDING_MAX_AGE_MS = 10 * 1000;

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
    if (!pending || (!force && pending.createdAtMs > cutoff)) continue;
    context.state.giftComboPending.delete(key);
    const existingComboSend = findRecentComboSendForBuffer(context, key, pending.gift);
    if (existingComboSend) {
      const item = updateGiftEventIfProgressed(context, existingComboSend, pending.gift);
      if (item && typeof onGiftFlushed === 'function') onGiftFlushed(item);
      continue;
    }
    const item = addGiftEvent(context, pending.gift, true);
    if (item && typeof onGiftFlushed === 'function') onGiftFlushed(item);
  }
}

function createGiftEventService(context, options = {}) {
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

  return { add, dispose };
}

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
  const exact = rows.find(row =>
    cleanText(row.uid) === cleanText(gift.uid) &&
    cleanText(row.gift_id) === cleanText(gift.giftId)
  );
  return exact || rows[0];
}

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
  if (gift.totalPrice <= 0) {
    logGiftServiceDecision('ignored', gift, null, 'non-positive-price');
    return null;
  }

  const giftDb = context.db.giftDb;
  if (!skipComboBuffer) {
    const comboKey = extractComboRootKey(gift.comboId || gift.platformId);
    const cmd = cleanText(gift.cmd);
    if (comboKey && cmd.startsWith('COMBO_SEND')) {
      const pending = context.state.giftComboPending.get(comboKey);
      if (pending) {
        gift.num = Math.max(gift.num, pending.gift.num);
        gift.totalPrice = Math.max(gift.totalPrice, pending.gift.totalPrice);
        if (gift.num > 0) gift.unitPrice = normalizeMoney(gift.totalPrice / gift.num);
      }
      context.state.giftComboPending.delete(comboKey);
    } else if (comboKey) {
      flushStaleComboBuffers(context, { nowMs });
      mergeIntoComboBuffer(context, gift, comboKey, nowMs);
      logGiftServiceDecision('buffered', gift, null, 'combo-pending', { comboKey });
      return null;
    }
  }

  const matchedBox = matchBlindBox(context, gift.blindBoxName) || matchBlindBox(context, gift.giftName);
  if (matchedBox) {
    gift.isBlindBox = true;
    gift.blindBoxName = matchedBox.blindBoxName || gift.blindBoxName;
    if (gift.blindBoxPrice === null || gift.blindBoxPrice === undefined) {
      gift.blindBoxPrice = normalizeMoney(matchedBox.boxPrice * gift.num);
    }
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
    SET platform_id = ?, gift_id = ?, gift_name = ?, uid = ?, user_name = ?,
        num = ?, unit_price = ?, total_price = ?, coin_type = ?, counted_in_sprint = ?,
        created_at = ?, updated_at = ?
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

  if (repaired > 0) console.log(`[Startup] repaired ${repaired} SEND_GIFT_V2 gift record(s).`);
}

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
    ? null
    : normalizeSignedMoney(mergedTotal - Number(blindBoxPrice || 0));
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
  const crossCmdRow = context.db.giftDb.prepare(`
    SELECT * FROM gift_events
    WHERE status = 'active'
      AND created_at BETWEEN ? AND ?
      AND cmd != ? AND (cmd LIKE 'COMBO_SEND%' OR ? LIKE 'COMBO_SEND%')
      AND uid = ? AND gift_id = ? AND gift_name = ? AND num = ?
      AND ABS(total_price - ?) < 0.0001
    ORDER BY datetime(created_at) DESC, id DESC LIMIT 1
  `).get(startIso, endIso, cmd, cmd, gift.uid, gift.giftId, gift.giftName, gift.num, gift.totalPrice);
  return crossCmdRow ? normalizeGiftRow(crossCmdRow) : null;
}

module.exports = {
  createGiftEventService,
  flushStaleComboBuffers,
  addGiftEvent,
  repairGiftV2Events
};
