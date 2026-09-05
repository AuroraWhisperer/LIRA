'use strict';

const fs = require('node:fs');
const path = require('node:path');
const saleCatalogParser = require('./sale-catalog-parser');

const GIFT_DATA_URL =
  'https://api.live.bilibili.com/xlive/web-room/v1/giftPanel/giftData';
const GIFT_CONFIG_URL =
  'https://api.live.bilibili.com/xlive/web-room/v1/giftPanel/giftConfig';
const {
  EXCLUDED_GIFT_IDS,
  buildGiftCatalog,
  collectPanelGiftIds,
  expandBlindBoxSaleIds,
  finiteNonNegative,
  isExcludedGiftId,
  parseGiftConfig,
} = saleCatalogParser;
const DEFAULT_MIN_REFRESH_MS = 10_000;
const SNAPSHOT_SCHEMA_VERSION = 1;

function createUnavailableGiftSaleCatalogService() {
  return {
    getSnapshot() {
      return {
        roomId: '',
        refreshedAt: '',
        count: 0,
        panelCount: 0,
        gifts: [],
        cached: true,
      };
    },
    async refresh() {
      throw new Error('礼物目录刷新服务未配置。');
    },
    searchLocal() {
      throw new Error('本地礼物搜索服务未配置。');
    },
  };
}

function createGiftSaleCatalogService(options = {}) {
  const dataDir = path.resolve(String(options.dataDir || ''));
  if (!options.dataDir) throw new Error('dataDir is required.');
  const getRoomId = options.getRoomId || (() => '');
  const getBlindBoxConfig = options.getBlindBoxConfig || (() => '');
  const fetchJson = options.fetchJson || defaultFetchJson;
  const now = options.now || Date.now;
  const minRefreshMs = Math.max(
    0,
    Number(options.minRefreshMs ?? DEFAULT_MIN_REFRESH_MS) || 0,
  );
  const snapshotPath = path.join(dataDir, 'overtime-gift-sale.json');
  fs.mkdirSync(dataDir, { recursive: true });
  let snapshot = readSnapshot(snapshotPath);
  let lastRefreshMs = snapshot.refreshedAt
    ? Date.parse(snapshot.refreshedAt) || 0
    : 0;
  let pending = null;

  function getSnapshot() {
    return {
      ...snapshot,
      gifts: snapshot.gifts.map((gift) => ({ ...gift })),
      cached: true,
    };
  }

  async function refresh() {
    const roomId = validateRoomId(getRoomId());
    const currentMs = now();
    if (
      snapshot.roomId === roomId &&
      lastRefreshMs > 0 &&
      currentMs - lastRefreshMs < minRefreshMs
    ) {
      return getSnapshot();
    }
    if (pending) return pending;

    pending = (async () => {
      const [giftData, giftConfig] = await Promise.all([
        fetchJson('gift_data', giftDataUrl(roomId), roomId),
        fetchJson('gift_config', giftConfigUrl(roomId), roomId),
      ]);
      validateBilibiliPayload(giftData, '礼物面板');
      validateBilibiliPayload(giftConfig, '礼物配置');
      const panelSaleIds = collectPanelGiftIds(giftData);
      if (panelSaleIds.size === 0)
        throw new Error('Bilibili 礼物面板没有返回可用礼物。');
      const configById = parseGiftConfig(giftConfig);
      const saleIds = expandBlindBoxSaleIds(
        panelSaleIds,
        configById,
        getBlindBoxConfig(),
      );
      const gifts = buildGiftCatalog(saleIds, configById);
      snapshot = {
        roomId,
        refreshedAt: new Date(currentMs).toISOString(),
        count: gifts.length,
        panelCount: panelSaleIds.size,
        gifts,
        cached: false,
      };
      writeJsonAtomic(snapshotPath, {
        schemaVersion: SNAPSHOT_SCHEMA_VERSION,
        ...snapshot,
      });
      lastRefreshMs = currentMs;
      console.log(
        `[Bilibili][GiftSale] roomId=${roomId} refreshed=${gifts.length}`,
      );
      return getUncachedSnapshot(snapshot);
    })().finally(() => {
      pending = null;
    });
    return pending;
  }

  return {
    getSnapshot,
    refresh,
    searchLocal() {
      throw new Error('本地礼物搜索服务未配置。');
    },
  };
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
    throw new Error(
      `${label}接口返回错误：${payload?.message || payload?.msg || payload?.code || '无数据'}`,
    );
  }
}

function giftDataUrl(roomId) {
  return `${GIFT_DATA_URL}?room_id=${encodeURIComponent(roomId)}&area_parent_id=0&area_id=0&platform=pc&source=live&build=0`;
}

function giftConfigUrl(roomId) {
  return `${GIFT_CONFIG_URL}?platform=pc&source=live&room_id=${encodeURIComponent(roomId)}`;
}

async function defaultFetchJson(endpointName, url, roomId) {
  const headers = {
    'User-Agent':
      'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/126 Safari/537.36',
    Accept: 'application/json, text/plain, */*',
    'Accept-Language': 'zh-CN,zh;q=0.9',
    Origin: 'https://live.bilibili.com',
    Referer: `https://live.bilibili.com/${encodeURIComponent(roomId)}`,
  };
  const response = await fetch(url, {
    signal: AbortSignal.timeout(15_000),
    headers,
  });
  const text = await response.text();
  let payload;
  try {
    payload = JSON.parse(text);
  } catch (_) {
    throw new Error(`Bilibili ${endpointName} 返回了非 JSON 响应。`);
  }
  if (!response.ok)
    throw new Error(
      `Bilibili ${endpointName} 请求失败：HTTP ${response.status}`,
    );
  return payload;
}

function readSnapshot(filePath) {
  try {
    const parsed = JSON.parse(fs.readFileSync(filePath, 'utf8'));
    if (parsed.schemaVersion !== SNAPSHOT_SCHEMA_VERSION)
      throw new Error('Unsupported gift sale snapshot schema.');
    const gifts = Array.isArray(parsed.gifts)
      ? parsed.gifts.map(normalizeSnapshotGift).filter(Boolean)
      : [];
    return {
      roomId: String(parsed.roomId || ''),
      refreshedAt: String(parsed.refreshedAt || ''),
      count: gifts.length,
      panelCount: Math.max(0, Number(parsed.panelCount) || gifts.length),
      gifts,
      cached: true,
    };
  } catch (_) {
    return {
      roomId: '',
      refreshedAt: '',
      count: 0,
      panelCount: 0,
      gifts: [],
      cached: true,
    };
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
    imagePath: '',
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
  return {
    ...value,
    gifts: value.gifts.map((gift) => ({ ...gift })),
    cached: false,
  };
}

module.exports = {
  GIFT_CONFIG_URL,
  GIFT_DATA_URL,
  EXCLUDED_GIFT_IDS,
  buildGiftCatalog,
  collectPanelGiftIds,
  createGiftSaleCatalogService,
  createUnavailableGiftSaleCatalogService,
  expandBlindBoxSaleIds,
  parseGiftConfig,
  validateRoomId,
};
