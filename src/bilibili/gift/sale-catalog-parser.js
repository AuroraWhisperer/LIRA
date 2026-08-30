'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { isGuardGiftAliasId } = require('./guard-gift-aliases');

const MAPPING_FILES = [
  'gift-mapping-under-100.md',
  'gift-mapping-100-above.md',
  'silver-free-mapping.md',
];
const EXCLUDED_GIFT_IDS = new Set([13000]);

function collectPanelGiftIds(payload) {
  const ids = new Set();
  const data = payload?.data || {};
  const roomList = data.room_gift_list || {};
  addGiftEntries(ids, roomList.gold_list);
  addGiftEntries(ids, roomList.silver_list);
  for (const tab of Array.isArray(data.tab_list) ? data.tab_list : []) {
    addGiftEntries(ids, tab?.list);
  }
  addGiftEntries(ids, data.special_show_gift);
  visitGiftContainer(ids, data.discount_gift_list);
  return ids;
}

function addGiftEntries(ids, entries) {
  for (const entry of Array.isArray(entries) ? entries : [])
    addGiftEntry(ids, entry);
}

function addGiftEntry(ids, entry) {
  const id = Number(entry?.gift_id ?? entry?.id);
  if (Number.isSafeInteger(id) && id > 0 && !isExcludedGiftId(id)) ids.add(id);
  addGiftEntries(ids, entry?.upgrade_gift);
}

function visitGiftContainer(ids, value) {
  if (Array.isArray(value)) {
    addGiftEntries(ids, value);
    return;
  }
  if (!value || typeof value !== 'object') return;
  if (Object.hasOwn(value, 'gift_id')) addGiftEntry(ids, value);
  for (const child of Object.values(value)) visitGiftContainer(ids, child);
}

function parseGiftConfig(payload) {
  const result = new Map();
  const list = payload?.data?.list;
  if (!Array.isArray(list)) return result;
  for (const entry of list) {
    const id = Number(entry?.id);
    if (!Number.isSafeInteger(id) || id <= 0) continue;
    const price = Math.max(0, Number(entry?.price) || 0);
    result.set(
      id,
      Object.freeze({
        id,
        name:
          String(entry?.name || `礼物 ${id}`)
            .trim()
            .slice(0, 100) || `礼物 ${id}`,
        battery: price / 100,
        rmb: price / 1000,
        bagGift: Boolean(entry?.bag_gift),
        coinType: String(entry?.coin_type || ''),
        sourceUrl: normalizeBilibiliImageUrl(entry?.webp || entry?.img_basic),
      }),
    );
  }
  return result;
}

function collectSendableBackpackGiftIds(payload, roomId, nowMs = Date.now()) {
  const ids = new Set();
  const currentRoomId = String(roomId || '').trim();
  const nowSeconds = Math.floor(Number(nowMs) / 1000);
  for (const entry of Array.isArray(payload?.data?.list)
    ? payload.data.list
    : []) {
    const id = Number(entry?.gift_id ?? entry?.id);
    const quantity = Number(entry?.gift_num ?? 0);
    const expiresAt = Number(entry?.expire_at ?? 0);
    const boundRoomId = String(entry?.bind_roomid || '').trim();
    if (!Number.isSafeInteger(id) || id <= 0 || isExcludedGiftId(id)) continue;
    if (!Number.isFinite(quantity) || quantity <= 0) continue;
    if (Number.isFinite(expiresAt) && expiresAt > 0 && expiresAt <= nowSeconds)
      continue;
    if (boundRoomId && boundRoomId !== '0' && boundRoomId !== currentRoomId)
      continue;
    ids.add(id);
  }
  return ids;
}

function expandBlindBoxSaleIds(panelSaleIds, configById, rawConfig) {
  const saleIds = new Set(panelSaleIds);
  const blindBoxes = parseBlindBoxConfig(rawConfig);
  if (blindBoxes.length === 0) return saleIds;

  const giftsByName = new Map();
  for (const gift of configById.values()) {
    const name = normalizeGiftName(gift.name);
    if (!name) continue;
    if (!giftsByName.has(name)) giftsByName.set(name, []);
    giftsByName.get(name).push(gift);
  }
  for (const candidates of giftsByName.values()) {
    candidates.sort(
      (left, right) =>
        Number(left.bagGift) - Number(right.bagGift) || left.id - right.id,
    );
  }

  const panelGiftNames = new Set(
    [...panelSaleIds]
      .map((id) => normalizeGiftName(configById.get(id)?.name))
      .filter(Boolean),
  );
  for (const box of blindBoxes) {
    if (!panelGiftNames.has(box.name)) continue;
    for (const output of box.outputs) {
      const candidates = giftsByName.get(output.name) || [];
      const priceMatches =
        output.rmb === null
          ? candidates
          : candidates.filter(
              (gift) => Math.abs(gift.rmb - output.rmb) < 0.001,
            );
      const gift = priceMatches[0] || candidates[0];
      if (gift && !isExcludedGiftId(gift.id)) saleIds.add(gift.id);
    }
  }
  return saleIds;
}

function parseBlindBoxConfig(value) {
  let boxes = value;
  if (typeof boxes === 'string') {
    try {
      boxes = JSON.parse(boxes);
    } catch (_) {
      boxes = [];
    }
  }
  if (!Array.isArray(boxes)) return [];
  return boxes
    .map((box) => ({
      name: normalizeGiftName(box?.name),
      outputs: (Array.isArray(box?.outputs) ? box.outputs : [])
        .map((output) => {
          if (output && typeof output === 'object') {
            const price = Number(output.price);
            return {
              name: normalizeGiftName(output.name),
              rmb: Number.isFinite(price) && price >= 0 ? price : null,
            };
          }
          return { name: normalizeGiftName(output), rmb: null };
        })
        .filter((output) => output.name),
    }))
    .filter((box) => box.name && box.outputs.length > 0);
}

function normalizeGiftName(value) {
  return String(value || '')
    .replace(/\s+/g, ' ')
    .trim();
}

function normalizeBilibiliImageUrl(value) {
  try {
    const url = new URL(String(value || '').trim());
    const hostname = url.hostname.toLowerCase();
    if (
      url.protocol !== 'https:' ||
      !(hostname === 'hdslb.com' || hostname.endsWith('.hdslb.com'))
    )
      return '';
    return url.href;
  } catch (_) {
    return '';
  }
}

function parseGiftMappingDocument(content) {
  const byId = new Map();
  for (const line of String(content || '').split(/\r?\n/)) {
    const cells = splitMarkdownRow(line);
    const id = Number(cells?.[0]);
    if (!Number.isSafeInteger(id) || id <= 0) continue;
    const mapping = Object.freeze({
      primaryId: id,
      name: String(cells[2] || id).trim(),
      imagePath: markdownImagePath(cells[1]),
      battery: finiteNonNegative(parseMappingNumber(cells[3])),
      rmb: finiteNonNegative(parseMappingNumber(cells[4])),
    });
    if (!byId.has(id)) byId.set(id, mapping);
    for (const match of String(cells[5] || '').matchAll(/\d+/g)) {
      const aliasId = Number(match[0]);
      if (Number.isSafeInteger(aliasId) && aliasId > 0 && !byId.has(aliasId))
        byId.set(aliasId, mapping);
    }
  }
  return byId;
}

function parseMappingNumber(value) {
  return Number(String(value || '').replace(/[^\d.-]/g, ''));
}

function markdownImagePath(cell) {
  const match = String(cell || '').match(/\]\(([^)]+)\)/);
  const relativePath = String(match?.[1] || '')
    .trim()
    .replaceAll('\\', '/');
  if (
    !relativePath ||
    /^[a-z]+:/i.test(relativePath) ||
    relativePath.startsWith('//')
  )
    return '';
  if (relativePath.includes('..')) return '';
  return `/img/bilibili-gifts/${relativePath.replace(/^\/+/, '')}`;
}

function readGiftMappings(publicDir) {
  const giftDir = path.join(publicDir, 'img', 'bilibili-gifts');
  const byId = new Map();
  for (const name of MAPPING_FILES) {
    const filePath = path.join(giftDir, name);
    const content = fs.readFileSync(filePath, 'utf8');
    for (const [id, mapping] of parseGiftMappingDocument(content)) {
      if (!byId.has(id)) byId.set(id, mapping);
    }
  }
  return byId;
}

function buildGiftCatalog(saleIds, configById, mappingById) {
  return [...saleIds]
    .filter((id) => !isExcludedGiftId(id))
    .map((id) => {
      const metadata = configById.get(id);
      const mapping = mappingById.get(id);
      return {
        known: Boolean(metadata),
        id: String(id),
        name: metadata?.name || `礼物 ${id}`,
        battery: finiteNonNegative(metadata?.battery),
        rmb: finiteNonNegative(metadata?.rmb),
        imagePath: mapping?.imagePath || '',
      };
    })
    .sort(
      (left, right) =>
        Number(right.known) - Number(left.known) ||
        left.rmb - right.rmb ||
        Number(left.id) - Number(right.id),
    )
    .map(({ known: _known, ...gift }) => gift);
}

function searchLocalGiftCatalog(publicDir, value, limit = 100) {
  const query = validateLocalGiftQuery(value);
  const normalizedQuery = query.toLocaleLowerCase();
  const maxResults = Math.min(100, Math.max(1, Number(limit) || 100));
  const mappings = readGiftMappings(publicDir);
  const gifts = [...mappings]
    .filter(([id, mapping]) => {
      if (
        isExcludedGiftId(id) ||
        !hasLocalGiftImage(publicDir, mapping.imagePath)
      )
        return false;
      return (
        String(id).includes(normalizedQuery) ||
        String(mapping.name || '')
          .toLocaleLowerCase()
          .includes(normalizedQuery)
      );
    })
    .map(([id, mapping]) => ({
      id: String(id),
      name: String(mapping.name || `礼物 ${id}`).slice(0, 100),
      battery: finiteNonNegative(mapping.battery),
      rmb: finiteNonNegative(mapping.rmb),
      imagePath: mapping.imagePath,
    }))
    .sort(
      (left, right) =>
        Number(left.id !== query) - Number(right.id !== query) ||
        left.rmb - right.rmb ||
        Number(left.id) - Number(right.id),
    )
    .slice(0, maxResults);
  return { query, count: gifts.length, gifts };
}

function validateLocalGiftQuery(value) {
  if (typeof value !== 'string')
    throw new Error('本地礼物搜索词必须是字符串。');
  const query = value.trim();
  const length = Array.from(query).length;
  if (length < 1 || length > 100)
    throw new Error('请输入 1–100 个字符的礼物名称或 ID。');
  return query;
}

function hasLocalGiftImage(publicDir, imagePath) {
  const prefix = '/img/bilibili-gifts/';
  if (!String(imagePath || '').startsWith(prefix)) return false;
  const giftDir = path.resolve(publicDir, 'img', 'bilibili-gifts');
  const filePath = path.resolve(
    publicDir,
    String(imagePath).replace(/^\/+/, ''),
  );
  const relativePath = path.relative(giftDir, filePath);
  if (
    !relativePath ||
    relativePath.startsWith('..') ||
    path.isAbsolute(relativePath)
  )
    return false;
  try {
    return fs.statSync(filePath).isFile();
  } catch (_) {
    return false;
  }
}

function finiteNonNegative(value) {
  const number = Number(value);
  return Number.isFinite(number) && number >= 0 ? number : 0;
}

function isExcludedGiftId(value) {
  const id = Number(value);
  return EXCLUDED_GIFT_IDS.has(id) || isGuardGiftAliasId(id);
}

function splitMarkdownRow(line) {
  const text = String(line || '');
  if (!text.trimStart().startsWith('|')) return null;
  const cells = [];
  let current = '';
  let escaped = false;
  for (let index = text.indexOf('|') + 1; index < text.length; index += 1) {
    const character = text[index];
    if (character === '|' && !escaped) {
      cells.push(current.trim());
      current = '';
      continue;
    }
    current += character;
    escaped = character === '\\' && !escaped;
    if (character !== '\\') escaped = false;
  }
  if (current.trim()) cells.push(current.trim());
  return cells;
}

module.exports = {
  EXCLUDED_GIFT_IDS,
  MAPPING_FILES,
  buildGiftCatalog,
  collectPanelGiftIds,
  collectSendableBackpackGiftIds,
  expandBlindBoxSaleIds,
  finiteNonNegative,
  isExcludedGiftId,
  parseGiftConfig,
  parseGiftMappingDocument,
  readGiftMappings,
  searchLocalGiftCatalog,
  validateLocalGiftQuery,
};
