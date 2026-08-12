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

function extractComboRootKey(platformId) {
  if (!platformId) return null;
  const lower = platformId.toLowerCase();
  if (!lower.includes('combo') && !lower.includes('batch')) return null;
  return platformId;
}

function applyBlindBoxMetadata(context, gift) {
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

function updateGiftEventIfProgressed(context, row, gift, options = {}) {
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
    options.updateSprint === false
      ? Number(row.counted_in_sprint || 0)
      : (mergedTotal > 0 ? 1 : Number(row.counted_in_sprint || 0)),
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
  repairGiftV2Events,
  extractComboRootKey,
  applyBlindBoxMetadata,
  findGiftByPlatformIdentity,
  findRecentGiftCommandDuplicate,
  updateGiftEventIfProgressed,
  hasGiftProgressed,
  logGiftServiceDecision
};
