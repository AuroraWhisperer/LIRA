'use strict';

import { GIFT_PLACEHOLDER } from './gift-image-fallback.js';

export const BANNER_WIDTH = 560;
export const BANNER_HEIGHT = 96;
export const BANNER_GAP = 8;
export const MAX_COMPOSITE_ROWS = 39;
export const GIFT_PALETTE = [
  ['#62A6FF66', '#6FADFE33'], ['#9F66FFCC', '#6FACFE4D'],
  ['#FF49A1CC', '#FF66994D'], ['#FF9D00CC', '#FFD4004D'],
];
const FRAMES = { 1: 'governor', 2: 'admiral', 3: 'captain' };
const AVATAR_PLACEHOLDER = '/img/gift-avatar-placeholder.svg';

export function giftTier(gift, thresholds) {
  const total = BigInt(Math.round(gift.unitPrice * 100)) * BigInt(gift.num);
  return thresholds.filter((value) => total >= BigInt(value)).length;
}

export function giftExportPages(items, mode) {
  const size = mode === 'separate' ? 1 : MAX_COMPOSITE_ROWS;
  const pages = [];
  for (let index = 0; index < items.length; index += size) pages.push(items.slice(index, index + size));
  return pages;
}

export function resolveGiftArtwork(gift, catalog) {
  if (gift.coinType === 'guard' && /^guard-[123]$/.test(gift.giftId)) {
    return `/img/admin/gifts/bilibili-guard-${{ 1: 'governor', 2: 'prefect', 3: 'captain' }[gift.giftId.slice(-1)]}.webp`;
  }
  const normalize = (value) => String(value || '').normalize('NFKC').replace(/\s+/gu, ' ').trim().toLowerCase();
  const matches = catalog.filter((entry) => gift.giftVariantId
    ? (entry.variantId || entry.giftIdentity?.variantId) === gift.giftVariantId
    : String(entry.id) === gift.giftId && normalize(entry.name) === normalize(gift.giftName));
  const path = matches.length === 1 ? matches[0].imagePath : '';
  return /^\/overtime-gift-images\/[a-z0-9_-][a-z0-9._-]*\.webp$/i.test(path || '') && !path.includes('..')
    ? path : GIFT_PLACEHOLDER;
}

export async function loadGiftArtworkCatalog(signal) {
  const response = await fetch('/api/overtime/gifts/catalog', { signal });
  if (!response.ok) throw new Error('礼物图片目录暂不可用');
  return (await response.json()).data?.gifts || [];
}

export function createGiftBanner(item, config, catalog = []) {
  const gift = item.gift;
  const root = document.createElement('div');
  root.className = 'gift-banner';
  root.dataset.eventId = item.eventId;
  const colors = GIFT_PALETTE[giftTier(gift, config.thresholds)];
  root.style.setProperty('--gift-start', colors[0]);
  root.style.setProperty('--gift-end', colors[1]);
  const count = String(gift.num);
  const background = document.createElement('div');
  background.className = 'gift-banner-background';
  root.append(background);
  const token = globalThis.window?.__API_TOKEN__ || '';
  const avatarUrl = gift.avatarUrl ? `/api/bilibili/avatar?url=${encodeURIComponent(gift.avatarUrl)}${token ? `&token=${encodeURIComponent(token)}` : ''}` : AVATAR_PLACEHOLDER;
  root.append(bannerImage(avatarUrl, 'gift-banner-avatar', AVATAR_PLACEHOLDER));
  if (FRAMES[gift.guardLevel]) {
    root.append(bannerImage(`/img/overlays/danmaku-guard/bubble-${FRAMES[gift.guardLevel]}-frame.webp`, 'gift-banner-frame', ''));
  }
  const text = document.createElement('div');
  text.className = 'gift-banner-text';
  const name = document.createElement('div');
  name.className = 'gift-banner-name';
  name.textContent = gift.userName;
  const line = document.createElement('div');
  line.className = 'gift-banner-gift';
  line.append('投喂 ');
  const giftName = document.createElement('span');
  giftName.textContent = gift.giftName;
  line.append(giftName);
  text.append(name, line);
  root.append(text, bannerImage(item.artworkPath || resolveGiftArtwork(gift, catalog), 'gift-banner-artwork', GIFT_PLACEHOLDER));
  const quantity = document.createElement('div');
  quantity.className = 'gift-banner-count';
  const times = document.createElement('span');
  times.className = 'gift-banner-times';
  times.textContent = '×';
  quantity.append(times, count);
  root.append(quantity);
  return root;
}

function bannerImage(source, className, fallback) {
  const image = document.createElement('img');
  image.className = className;
  image.alt = '';
  image.draggable = false;
  image.src = source;
  image.dataset.fallback = fallback;
  image.addEventListener('error', () => {
    if (fallback && image.getAttribute('src') !== fallback) image.src = fallback;
    else image.style.visibility = 'hidden';
  });
  return image;
}

export async function readyGiftImages(root) {
  await Promise.all([...root.querySelectorAll('img')].map(async (image) => {
    let timer;
    const decoded = await Promise.race([
      image.decode().then(() => true, () => false),
      new Promise((resolve) => { timer = setTimeout(() => resolve(false), 5000); }),
    ]);
    clearTimeout(timer);
    if (!decoded) {
      if (image.dataset.fallback) {
        image.src = image.dataset.fallback;
        let fallbackTimer;
        await Promise.race([image.decode().catch(() => {}), new Promise((resolve) => {
          fallbackTimer = setTimeout(resolve, 1000);
        })]);
        clearTimeout(fallbackTimer);
      } else image.style.visibility = 'hidden';
    }
  }));
  await document.fonts.ready;
  await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
}
