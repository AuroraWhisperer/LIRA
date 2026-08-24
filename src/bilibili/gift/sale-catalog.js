'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { isGuardGiftAliasId } = require('./guard-gift-aliases');

const GIFT_DATA_URL = 'https://api.live.bilibili.com/xlive/web-room/v1/giftPanel/giftData';
const GIFT_CONFIG_URL = 'https://api.live.bilibili.com/xlive/web-room/v1/giftPanel/giftConfig';
const GIFT_BAG_URL = 'https://api.live.bilibili.com/xlive/web-room/v1/gift/bag_list';
const MAPPING_FILES = [
  'gift-mapping-under-100.md',
  'gift-mapping-100-above.md',
  'silver-free-mapping.md'
];
const EXCLUDED_GIFT_IDS = new Set([13000]);
const DEFAULT_MIN_REFRESH_MS = 10_000;

function createUnavailableGiftSaleCatalogService() {
  return {
    getSnapshot() {
      return {
        roomId: '',
        refreshedAt: '',
        count: 0,
        panelCount: 0,
        gifts: [],
        cached: true
      };
    },
    async refresh() {
      throw new Error('礼物目录刷新服务未配置。');
    },
    searchLocal() {
      throw new Error('本地礼物搜索服务未配置。');
    }
  };
}

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
  for (const entry of Array.isArray(entries) ? entries : []) addGiftEntry(ids, entry);
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
    result.set(id, Object.freeze({
      id,
      name: String(entry?.name || `礼物 ${id}`).trim().slice(0, 100) || `礼物 ${id}`,
      battery: price / 100,
      rmb: price / 1000,
      bagGift: Boolean(entry?.bag_gift),
      coinType: String(entry?.coin_type || ''),
      sourceUrl: normalizeBilibiliImageUrl(entry?.webp || entry?.img_basic)
    }));
  }
  return result;
}

function collectSendableBackpackGiftIds(payload, roomId, nowMs = Date.now()) {
  const ids = new Set();
  const currentRoomId = String(roomId || '').trim();
  const nowSeconds = Math.floor(Number(nowMs) / 1000);
  for (const entry of Array.isArray(payload?.data?.list) ? payload.data.list : []) {
    const id = Number(entry?.gift_id ?? entry?.id);
    const quantity = Number(entry?.gift_num ?? 0);
    const expiresAt = Number(entry?.expire_at ?? 0);
    const boundRoomId = String(entry?.bind_roomid || '').trim();
    if (!Number.isSafeInteger(id) || id <= 0 || isExcludedGiftId(id)) continue;
    if (!Number.isFinite(quantity) || quantity <= 0) continue;
    if (Number.isFinite(expiresAt) && expiresAt > 0 && expiresAt <= nowSeconds) continue;
    if (boundRoomId && boundRoomId !== '0' && boundRoomId !== currentRoomId) continue;
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
    candidates.sort((left, right) => Number(left.bagGift) - Number(right.bagGift) || left.id - right.id);
  }

  const panelGiftNames = new Set([...panelSaleIds]
    .map(id => normalizeGiftName(configById.get(id)?.name))
    .filter(Boolean));
  for (const box of blindBoxes) {
    if (!panelGiftNames.has(box.name)) continue;
    for (const output of box.outputs) {
      const candidates = giftsByName.get(output.name) || [];
      const priceMatches = output.rmb === null
        ? candidates
        : candidates.filter(gift => Math.abs(gift.rmb - output.rmb) < 0.001);
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
  return boxes.map((box) => ({
    name: normalizeGiftName(box?.name),
    outputs: (Array.isArray(box?.outputs) ? box.outputs : []).map((output) => {
      if (output && typeof output === 'object') {
        const price = Number(output.price);
        return {
          name: normalizeGiftName(output.name),
          rmb: Number.isFinite(price) && price >= 0 ? price : null
        };
      }
      return { name: normalizeGiftName(output), rmb: null };
    }).filter(output => output.name)
  })).filter(box => box.name && box.outputs.length > 0);
}

function normalizeGiftName(value) {
  return String(value || '').replace(/\s+/g, ' ').trim();
}

function normalizeBilibiliImageUrl(value) {
  try {
    const url = new URL(String(value || '').trim());
    const hostname = url.hostname.toLowerCase();
    if (url.protocol !== 'https:' || !(hostname === 'hdslb.com' || hostname.endsWith('.hdslb.com'))) return '';
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
      rmb: finiteNonNegative(parseMappingNumber(cells[4]))
    });
    if (!byId.has(id)) byId.set(id, mapping);
    for (const match of String(cells[5] || '').matchAll(/\d+/g)) {
      const aliasId = Number(match[0]);
      if (Number.isSafeInteger(aliasId) && aliasId > 0 && !byId.has(aliasId)) byId.set(aliasId, mapping);
    }
  }
  return byId;
}

function parseMappingNumber(value) {
  return Number(String(value || '').replace(/[^\d.-]/g, ''));
}

function markdownImagePath(cell) {
  const match = String(cell || '').match(/\]\(([^)]+)\)/);
  const relativePath = String(match?.[1] || '').trim().replaceAll('\\', '/');
  if (!relativePath || /^[a-z]+:/i.test(relativePath) || relativePath.startsWith('//')) return '';
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
  return [...saleIds].filter(id => !isExcludedGiftId(id)).map((id) => {
    const metadata = configById.get(id);
    const mapping = mappingById.get(id);
    return {
      known: Boolean(metadata),
      id: String(id),
      name: metadata?.name || `礼物 ${id}`,
      battery: finiteNonNegative(metadata?.battery),
      rmb: finiteNonNegative(metadata?.rmb),
      imagePath: mapping?.imagePath || ''
    };
  }).sort((left, right) => Number(right.known) - Number(left.known)
    || left.rmb - right.rmb
    || Number(left.id) - Number(right.id))
    .map(({ known: _known, ...gift }) => gift);
}

function searchLocalGiftCatalog(publicDir, value, limit = 100) {
  const query = validateLocalGiftQuery(value);
  const normalizedQuery = query.toLocaleLowerCase();
  const maxResults = Math.min(100, Math.max(1, Number(limit) || 100));
  const mappings = readGiftMappings(publicDir);
  const gifts = [...mappings].filter(([id, mapping]) => {
    if (isExcludedGiftId(id) || !hasLocalGiftImage(publicDir, mapping.imagePath)) return false;
    return String(id).includes(normalizedQuery)
      || String(mapping.name || '').toLocaleLowerCase().includes(normalizedQuery);
  }).map(([id, mapping]) => ({
    id: String(id),
    name: String(mapping.name || `礼物 ${id}`).slice(0, 100),
    battery: finiteNonNegative(mapping.battery),
    rmb: finiteNonNegative(mapping.rmb),
    imagePath: mapping.imagePath
  })).sort((left, right) => Number(left.id !== query) - Number(right.id !== query)
    || left.rmb - right.rmb
    || Number(left.id) - Number(right.id))
    .slice(0, maxResults);
  return { query, count: gifts.length, gifts };
}

function validateLocalGiftQuery(value) {
  if (typeof value !== 'string') throw new Error('本地礼物搜索词必须是字符串。');
  const query = value.trim();
  const length = Array.from(query).length;
  if (length < 1 || length > 100) throw new Error('请输入 1–100 个字符的礼物名称或 ID。');
  return query;
}

function hasLocalGiftImage(publicDir, imagePath) {
  const prefix = '/img/bilibili-gifts/';
  if (!String(imagePath || '').startsWith(prefix)) return false;
  const giftDir = path.resolve(publicDir, 'img', 'bilibili-gifts');
  const filePath = path.resolve(publicDir, String(imagePath).replace(/^\/+/, ''));
  const relativePath = path.relative(giftDir, filePath);
  if (!relativePath || relativePath.startsWith('..') || path.isAbsolute(relativePath)) return false;
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

function createGiftSaleCatalogService(options = {}) {
  const dataDir = path.resolve(String(options.dataDir || ''));
  const publicDir = path.resolve(String(options.publicDir || ''));
  if (!options.dataDir || !options.publicDir) throw new Error('dataDir and publicDir are required.');
  const getRoomId = options.getRoomId || (() => '');
  const getBlindBoxConfig = options.getBlindBoxConfig || (() => '');
  const getCookieHeader = typeof options.getCookieHeader === 'function' ? options.getCookieHeader : null;
  const fetchJson = options.fetchJson || defaultFetchJson;
  const now = options.now || Date.now;
  const minRefreshMs = Math.max(0, Number(options.minRefreshMs ?? DEFAULT_MIN_REFRESH_MS) || 0);
  const snapshotPath = path.join(dataDir, 'overtime-gift-sale.json');
  fs.mkdirSync(dataDir, { recursive: true });
  let snapshot = readSnapshot(snapshotPath);
  let lastRefreshMs = snapshot.refreshedAt ? Date.parse(snapshot.refreshedAt) || 0 : 0;
  let pending = null;

  function getSnapshot() {
    return { ...snapshot, gifts: snapshot.gifts.map((gift) => ({ ...gift })), cached: true };
  }

  function searchLocal(query) {
    return searchLocalGiftCatalog(publicDir, query);
  }

  async function refresh() {
    const roomId = validateRoomId(getRoomId());
    const currentMs = now();
    if (snapshot.roomId === roomId && lastRefreshMs > 0 && currentMs - lastRefreshMs < minRefreshMs) {
      return getSnapshot();
    }
    if (pending) return pending;

    pending = (async () => {
      const cookieHeader = getCookieHeader ? String(await getCookieHeader() || '').trim() : '';
      const [giftData, giftConfig, giftBag] = await Promise.all([
        fetchJson('gift_data', giftDataUrl(roomId), roomId),
        fetchJson('gift_config', giftConfigUrl(roomId), roomId),
        cookieHeader
          ? fetchJson('gift_bag', giftBagUrl(roomId), roomId, { cookieHeader })
          : Promise.resolve(null)
      ]);
      validateBilibiliPayload(giftData, '礼物面板');
      validateBilibiliPayload(giftConfig, '礼物配置');
      if (giftBag) validateBilibiliPayload(giftBag, '礼物背包');
      const panelSaleIds = collectPanelGiftIds(giftData);
      if (panelSaleIds.size === 0) throw new Error('Bilibili 礼物面板没有返回可用礼物。');
      const configById = parseGiftConfig(giftConfig);
      const saleIds = expandBlindBoxSaleIds(panelSaleIds, configById, getBlindBoxConfig());
      for (const id of collectSendableBackpackGiftIds(giftBag, roomId, currentMs)) saleIds.add(id);
      const mappings = readGiftMappings(publicDir);
      const gifts = buildGiftCatalog(saleIds, configById, mappings);
      snapshot = {
        roomId,
        refreshedAt: new Date(currentMs).toISOString(),
        count: gifts.length,
        panelCount: panelSaleIds.size,
        gifts,
        cached: false
      };
      writeJsonAtomic(snapshotPath, snapshot);
      lastRefreshMs = currentMs;
      console.log(`[Bilibili][GiftSale] roomId=${roomId} refreshed=${gifts.length}`);
      return getUncachedSnapshot(snapshot);
    })().finally(() => {
      pending = null;
    });
    return pending;
  }

  return { getSnapshot, refresh, searchLocal };
}

function validateRoomId(value) {
  const text = String(value || '').trim();
  if (!/^\d{1,20}$/.test(text) || BigInt(text) <= 0n) {
    throw new Error('请先在设置中填写有效的 Bilibili 直播间号。');
  }
  return text;
}

function validateBilibiliPayload(payload, label) {
  if (!payload || Number(payload.code) !== 0 || !payload.data) {
    throw new Error(`${label}接口返回错误：${payload?.message || payload?.msg || payload?.code || '无数据'}`);
  }
}

function giftDataUrl(roomId) {
  return `${GIFT_DATA_URL}?room_id=${encodeURIComponent(roomId)}&area_parent_id=0&area_id=0&platform=pc&source=live&build=0`;
}

function giftConfigUrl(roomId) {
  return `${GIFT_CONFIG_URL}?platform=pc&source=live&room_id=${encodeURIComponent(roomId)}`;
}

function giftBagUrl(roomId) {
  return `${GIFT_BAG_URL}?room_id=${encodeURIComponent(roomId)}`;
}

async function defaultFetchJson(endpointName, url, roomId, options = {}) {
  const headers = {
    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/126 Safari/537.36',
    'Accept': 'application/json, text/plain, */*',
    'Accept-Language': 'zh-CN,zh;q=0.9',
    'Origin': 'https://live.bilibili.com',
    'Referer': `https://live.bilibili.com/${encodeURIComponent(roomId)}`
  };
  const cookieHeader = String(options.cookieHeader || '').trim();
  if (cookieHeader) headers.Cookie = cookieHeader;
  const response = await fetch(url, {
    signal: AbortSignal.timeout(15_000),
    headers
  });
  const text = await response.text();
  let payload;
  try {
    payload = JSON.parse(text);
  } catch (_) {
    throw new Error(`Bilibili ${endpointName} 返回了非 JSON 响应。`);
  }
  if (!response.ok) throw new Error(`Bilibili ${endpointName} 请求失败：HTTP ${response.status}`);
  return payload;
}

function readSnapshot(filePath) {
  try {
    const parsed = JSON.parse(fs.readFileSync(filePath, 'utf8'));
    const gifts = Array.isArray(parsed.gifts) ? parsed.gifts.map(normalizeSnapshotGift).filter(Boolean) : [];
    return {
      roomId: String(parsed.roomId || ''),
      refreshedAt: String(parsed.refreshedAt || ''),
      count: gifts.length,
      panelCount: Math.max(0, Number(parsed.panelCount) || gifts.length),
      gifts,
      cached: true
    };
  } catch (_) {
    return { roomId: '', refreshedAt: '', count: 0, panelCount: 0, gifts: [], cached: true };
  }
}

function normalizeSnapshotGift(gift) {
  const id = String(gift?.id || '').trim();
  if (!/^\d+$/.test(id) || isExcludedGiftId(id)) return null;
  return {
    id,
    name: String(gift?.name || `礼物 ${id}`).slice(0, 100),
    battery: finiteNonNegative(gift?.battery),
    rmb: finiteNonNegative(gift?.rmb),
    imagePath: String(gift?.imagePath || '').startsWith('/img/bilibili-gifts/') ? String(gift.imagePath) : ''
  };
}

function writeJsonAtomic(filePath, value) {
  const tempPath = `${filePath}.tmp-${process.pid}`;
  try {
    fs.writeFileSync(tempPath, `${JSON.stringify(value, null, 2)}\n`);
    fs.renameSync(tempPath, filePath);
  } finally {
    if (fs.existsSync(tempPath)) fs.rmSync(tempPath, { force: true });
  }
}

function getUncachedSnapshot(value) {
  return { ...value, gifts: value.gifts.map((gift) => ({ ...gift })), cached: false };
}

module.exports = {
  GIFT_BAG_URL,
  GIFT_CONFIG_URL,
  GIFT_DATA_URL,
  EXCLUDED_GIFT_IDS,
  MAPPING_FILES,
  buildGiftCatalog,
  collectPanelGiftIds,
  collectSendableBackpackGiftIds,
  createGiftSaleCatalogService,
  createUnavailableGiftSaleCatalogService,
  expandBlindBoxSaleIds,
  parseGiftConfig,
  parseGiftMappingDocument,
  readGiftMappings,
  searchLocalGiftCatalog,
  validateLocalGiftQuery,
  validateRoomId
};
