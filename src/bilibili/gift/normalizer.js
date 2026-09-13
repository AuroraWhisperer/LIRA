'use strict';

const {
  cleanText,
  normalizePositiveInteger,
  normalizeMoney,
  normalizeSignedMoney,
} = require('../../shared/utils');

function normalizeGiftRow(row) {
  if (!row) return null;
  const blindBoxPrice =
    row.blind_box_price === null || row.blind_box_price === undefined
      ? null
      : normalizeMoney(row.blind_box_price);
  const totalPrice = normalizeMoney(row.total_price);
  return {
    ...row,
    num: normalizePositiveInteger(row.num) || 1,
    unit_price: normalizeMoney(row.unit_price),
    total_price: totalPrice,
    is_blind_box: Boolean(row.is_blind_box),
    blind_box_id: normalizeOptionalGiftId(row.blind_box_id),
    blind_box_name: cleanText(row.blind_box_name),
    blind_box_price: blindBoxPrice,
    blind_profit:
      row.blind_profit === null || row.blind_profit === undefined
        ? null
        : normalizeSignedMoney(row.blind_profit),
    counted_in_sprint: Boolean(row.counted_in_sprint),
    sprint_count_price: totalPrice,
  };
}

function normalizeOptionalGiftId(value) {
  const id = String(value ?? '').trim();
  return /^[1-9]\d{0,19}$/u.test(id) ? id : null;
}

module.exports = {
  normalizeGiftRow,
};
