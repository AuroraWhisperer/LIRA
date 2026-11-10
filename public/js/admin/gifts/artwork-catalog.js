import { eventBus, Events } from '../../shared/event-bus.js';
import { GIFT_PLACEHOLDER, resolveGiftImageSource } from '../../shared/gift-image.js';
import { findBlindBoxTheme } from './blindbox-theme.js';
import { getGuardIcon } from '../../shared/bilibili-guard-icons.js';

let giftArtworkById = null;
// 名称索引随目录快照整体重建：按 (id, 规范化名称) 归并，避免每行查询都扫描整个目录。
let giftArtworkByName = null;

function giftArtworkNameKey(id, normalizedName) {
  return `${id}\u0000${normalizedName}`;
}

function normalizedGiftName(value) {
  return String(value || '')
    .normalize('NFKC')
    .replace(/\s+/gu, ' ')
    .trim()
    .replace(/[A-Z]/gu, (letter) => letter.toLowerCase());
}

function buildGiftArtworkNameIndex(artworkById) {
  const byName = new Map();
  for (const gift of artworkById?.values() || []) {
    const key = giftArtworkNameKey(gift.id, gift.name);
    const entry = byName.get(key);
    if (entry) entry.count += 1;
    else byName.set(key, { count: 1, imagePath: gift.imagePath });
  }
  return byName;
}

export function findGiftArtwork(id, name, variantId) {
  if (variantId) return giftArtworkById?.get(variantId)?.imagePath || '';
  const normalizedName = normalizedGiftName(name);
  if (!id || !normalizedName) return '';
  // 同一 (id, 名称) 对应多个候选时无法区分，沿用原行为不返回图片。
  const entry = giftArtworkByName?.get(giftArtworkNameKey(id, normalizedName));
  return entry && entry.count === 1 ? entry.imagePath : '';
}

/**
 * 获取大航海徽章信息
 * @param {Object} item - 礼物项
 * @returns {Object|null} 徽章信息 {name, src}
 */
export function getGuardBadge(item) {
  const giftName = String((item && item.gift_name) || '')
    .trim()
    .toLowerCase();
  const giftId = String((item && item.gift_id) || '')
    .trim()
    .toLowerCase();

  if (giftName.includes('总督') || giftName.includes('governor') || giftId === 'guard-1') {
    return {
      name: '总督',
      level: 1,
      src: getGuardIcon(1),
    };
  }
  if (
    giftName.includes('提督') ||
    giftName.includes('prefect') ||
    giftName.includes('admiral') ||
    giftId === 'guard-2'
  ) {
    return {
      name: '提督',
      level: 2,
      src: getGuardIcon(2),
    };
  }
  if (giftName.includes('舰长') || giftName.includes('captain') || giftId === 'guard-3') {
    return {
      name: '舰长',
      level: 3,
      src: getGuardIcon(3),
    };
  }
  return null;
}

export function getGiftToastArtwork(item) {
  const id = String(item?.gift_id || '').trim();
  const isGuard = String(item?.coin_type || '').toLowerCase() === 'guard' || id.toLowerCase().startsWith('guard-');
  const imagePath = isGuard
    ? getGuardBadge(item)?.src || ''
    : findGiftArtwork(id, item?.gift_name, item?.gift_variant_id);
  return resolveGiftImageSource(imagePath);
}

let giftArtworkLoadPromise = null;
let giftArtworkController = null;
let giftArtworkRetryAfter = 0;
let giftArtworkRevision = 0;
let onArtworkChange = null;
let disposeCatalog = null;

export function loadGiftArtworkCatalog() {
  if (giftArtworkById) return Promise.resolve(giftArtworkById);
  if (giftArtworkLoadPromise) return giftArtworkLoadPromise;
  if (Date.now() < giftArtworkRetryAfter || typeof window.fetch !== 'function') return Promise.resolve(new Map());

  const requestRevision = giftArtworkRevision;
  const controller = new AbortController();
  giftArtworkController = controller;
  const pending = (async () => {
    try {
      const response = await window.fetch('/api/overtime/gifts/catalog', { signal: controller.signal });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const payload = await response.json();
      if (payload?.ok === false) throw new Error(payload.error || '礼物目录不可用');
      if (!controller.signal.aborted && !giftArtworkById && requestRevision === giftArtworkRevision) {
        const artworkById = new Map();
        for (const gift of Array.isArray(payload?.data?.gifts) ? payload.data.gifts : []) addGiftArtwork(artworkById, gift);
        giftArtworkById = artworkById;
        giftArtworkByName = buildGiftArtworkNameIndex(artworkById);
        onArtworkChange?.();
      }
    } catch (error) {
      if (!controller.signal.aborted) {
        giftArtworkRetryAfter = Date.now() + 5000;
        console.warn('读取礼物图片目录失败：', error);
      }
    }
    return giftArtworkById || new Map();
  })();
  giftArtworkLoadPromise = pending;
  return pending.finally(() => {
    if (giftArtworkLoadPromise === pending) {
      giftArtworkLoadPromise = null;
      giftArtworkController = null;
    }
  });
}

function normalizeGiftArtworkPath(value) {
  const imagePath = String(value ?? '').trim();
  if (!/^\/overtime-gift-images\/[a-z0-9._-]+\.(?:gif|webp|png|jpe?g)$/i.test(imagePath) || imagePath.includes('..'))
    return '';
  return imagePath;
}

function addGiftArtwork(index, gift) {
  const id = String(gift?.id ?? '').trim();
  const name = normalizedGiftName(gift?.name);
  if (!id || !name) return;
  const variantId = gift.variantId || gift.giftIdentity?.variantId;
  const key = variantId || JSON.stringify([id, name, gift.priceRaw ?? gift.rmb, gift.coinType, gift.bagGift]);
  const imagePath = normalizeGiftArtworkPath(gift.imagePath) || index.get(key)?.imagePath || '';
  index.set(key, { id, name, imagePath });
}

function applyGiftArtworkSnapshot(snapshot) {
  if (!snapshot || typeof snapshot !== 'object') return;
  if (!Array.isArray(snapshot.gifts)) return;

  giftArtworkRevision += 1;
  const artworkById = giftArtworkById ? new Map(giftArtworkById) : new Map();
  for (const gift of snapshot.gifts) {
    addGiftArtwork(artworkById, gift);
  }
  giftArtworkById = artworkById;
  giftArtworkByName = buildGiftArtworkNameIndex(artworkById);
  onArtworkChange?.();
}

export function initGiftArtworkCatalog(onChange) {
  if (disposeCatalog) return disposeCatalog;
  onArtworkChange = onChange;
  const unsubscribe = eventBus.on(Events.GIFT_CATALOG_UPDATED, ({ snapshot } = {}) => applyGiftArtworkSnapshot(snapshot));
  const dispose = () => {
    if (disposeCatalog !== dispose) return;
    unsubscribe();
    onArtworkChange = null;
    giftArtworkRevision += 1;
    giftArtworkController?.abort();
    giftArtworkController = null;
    giftArtworkLoadPromise = null;
    disposeCatalog = null;
  };
  disposeCatalog = dispose;
  void loadGiftArtworkCatalog();
  return dispose;
}

/**
 * 获取盲盒图标信息
 * @param {Object} item - 礼物项
 * @returns {Object|null} 图标信息 {name, src, className, theme}
 */
export function getBlindBoxIcon(item) {
  if (!(item?.is_blind_box === true || item?.is_blind_box === 1)) return null;
  const recordedBoxName = String(item?.blind_box_name || '').trim();
  const blindBoxName = String(recordedBoxName || item?.name || item?.gift_name || '').trim();
  const blindBoxId = String(item?.blind_box_id || '').trim();
  const type = findBlindBoxTheme(blindBoxName, blindBoxId);
  // Open-result records carry the output ID, while direct box records carry
  // the box ID. Only the latter can be resolved from item.gift_id exactly.
  const artworkId = blindBoxId || (recordedBoxName ? type?.id : String(item?.gift_id || '').trim());
  return {
    name: type?.name || blindBoxName || '盲盒',
    className: type?.className || 'blind-box-default',
    theme: type?.key || 'default',
    src:
      findGiftArtwork(
        artworkId,
        blindBoxName,
        recordedBoxName || blindBoxId ? item.blind_box_variant_id : item.gift_variant_id,
      ) || GIFT_PLACEHOLDER,
  };
}
