'use strict';

const { normalizePositiveInteger } = require('./utils');

function normalizeSuperChatPrice(value) {
  const number = Number(value);
  if (Number.isFinite(number)) return number;
  const match = String(value || '').match(/[\d.]+/);
  return match ? Number(match[0]) || 0 : 0;
}

function normalizeGuardLevel(value) {
  const level = normalizePositiveInteger(value);
  return [1, 2, 3].includes(level) ? level : 0;
}

module.exports = { normalizeSuperChatPrice, normalizeGuardLevel };
