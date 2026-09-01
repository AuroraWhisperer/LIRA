'use strict';

const { cleanText, normalizeMoney } = require('../../shared/utils');

const MAX_CONFIG_BYTES = 64 * 1024;
const MAX_BOXES = 100;
const MAX_OUTPUTS_PER_BOX = 200;
const MAX_NAME_LENGTH = 100;
const MAX_PRICE = 1_000_000;

function invalidConfig() {
  return new Error('INVALID_GIFT_BLIND_BOX_CONFIG');
}

function normalizeName(value) {
  const name = String(value || '').trim();
  if (!name || name.length > MAX_NAME_LENGTH || /[\0\r\n]/u.test(name)) {
    throw invalidConfig();
  }
  return name;
}

function normalizePrice(value) {
  const price = Number(value);
  if (!Number.isFinite(price) || price <= 0 || price > MAX_PRICE) {
    throw invalidConfig();
  }
  const normalized = Math.round(price * 100) / 100;
  if (normalized <= 0) throw invalidConfig();
  return normalized;
}

function normalizeGiftBlindBoxConfig(input) {
  if (!Array.isArray(input) || input.length > MAX_BOXES) throw invalidConfig();
  const boxes = input.map((box) => {
    if (!box || typeof box !== 'object' || Array.isArray(box)) {
      throw invalidConfig();
    }
    if (
      !Array.isArray(box.outputs) ||
      box.outputs.length === 0 ||
      box.outputs.length > MAX_OUTPUTS_PER_BOX
    ) {
      throw invalidConfig();
    }
    const outputs = box.outputs.map((output) => {
      if (typeof output === 'string') return normalizeName(output);
      if (!output || typeof output !== 'object' || Array.isArray(output)) {
        throw invalidConfig();
      }
      const normalized = { name: normalizeName(output.name) };
      if (output.price !== undefined && output.price !== null) {
        normalized.price = normalizePrice(output.price);
      }
      return normalized;
    });
    return {
      name: normalizeName(box.name),
      price: normalizePrice(box.price),
      outputs,
    };
  });
  if (Buffer.byteLength(JSON.stringify(boxes), 'utf8') > MAX_CONFIG_BYTES) {
    throw invalidConfig();
  }
  return boxes;
}

function loadBlindBoxMap(context) {
  const settings = context.settings();
  const raw = cleanText(settings.giftBlindBoxConfig);
  if (!raw) return null;

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
      let key;
      let giftPrice;
      if (typeof output === 'object' && output !== null) {
        key = cleanText(output.name);
        giftPrice = normalizeMoney(output.price) || null;
      } else {
        key = cleanText(String(output));
        giftPrice = null;
      }
      if (!key) continue;
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

module.exports = { matchBlindBox, normalizeGiftBlindBoxConfig };
