'use strict';

const { cleanText, normalizeMoney } = require('../../shared/utils');

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

module.exports = { matchBlindBox };
