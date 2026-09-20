'use strict';

import { GIFT_PLACEHOLDER } from './gift-image-fallback.js';

export const BANNER_WIDTH = 428;
export const BANNER_HEIGHT = 72;
export const BANNER_GAP = 8;
export const MAX_COMPOSITE_ROWS = 39;
export const GIFT_PALETTE = [
  ['#2885CEB3', '#409FDE9E'], ['#8F58EDF2', '#776CE9E6'],
  ['#F6606DF2', '#F88573E6'], ['#F3A20AF2', '#F8C914E6'],
];
const FRAMES = { 1: 'governor', 2: 'admiral', 3: 'captain' };
const AVATAR_PLACEHOLDER = '/img/gift-avatar-placeholder.svg';

export function giftTier(gift, thresholds, cardTotalCents) {
  const total = cardTotalCents === undefined
    ? BigInt(Math.round(gift.unitPrice * 100)) * BigInt(gift.num) : BigInt(cardTotalCents);
  return thresholds.filter((value) => total >= BigInt(value)).length;
}

export function giftExportPages(items, mode) {
  const size = mode === 'separate' ? 1 : MAX_COMPOSITE_ROWS;
  const pages = [];
  for (let index = 0; index < items.length; index += size) pages.push(items.slice(index, index + size));
  return pages;
}

export function resolveGiftArtwork(gift, catalog) {
  const purchasedGuardLevel = /^guard-([123])$/.exec(gift.giftId)?.[1]
    || (gift.coinType === 'guard' ? ['总督', '提督', '舰长'].indexOf(gift.giftName) + 1 : 0);
  if (purchasedGuardLevel) {
    return `/img/admin/gifts/bilibili-guard-${{ 1: 'governor', 2: 'prefect', 3: 'captain' }[purchasedGuardLevel]}.webp`;
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
  const colors = GIFT_PALETTE[giftTier(gift, config.thresholds, item.cardTotalCents)];
  root.style.setProperty('--gift-start', colors[0]);
  root.style.setProperty('--gift-end', colors[1]);
  const count = String(gift.num);
  const background = document.createElement('div');
  background.className = 'gift-banner-background';
  root.append(background);
  root.append(bannerImage(giftAvatarSource(gift), 'gift-banner-avatar', AVATAR_PLACEHOLDER));
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

/** Patch changed display fields in place; return whether the text needs refitting. */
export function updateGiftBanner(root, item, config, catalog = [], retryAvatar = false) {
  const gift = item.gift;
  const colors = GIFT_PALETTE[giftTier(gift, config.thresholds, item.cardTotalCents)];
  for (const [index, key] of ['--gift-start', '--gift-end'].entries()) {
    if (root.style.getPropertyValue(key) !== colors[index]) root.style.setProperty(key, colors[index]);
  }
  let textChanged = false;
  for (const [selector, value] of [['.gift-banner-name', gift.userName], ['.gift-banner-gift span', gift.giftName]]) {
    const node = root.querySelector(selector);
    if (node.textContent !== value) { node.textContent = value; textChanged = true; }
  }
  const count = root.querySelector('.gift-banner-count').lastChild;
  if (count.nodeValue !== String(gift.num)) count.nodeValue = String(gift.num);
  updateBannerImage(root.querySelector('.gift-banner-avatar'), giftAvatarSource(gift), retryAvatar);
  updateBannerImage(root.querySelector('.gift-banner-artwork'), item.artworkPath || resolveGiftArtwork(gift, catalog));
  const frame = root.querySelector('.gift-banner-frame');
  if (FRAMES[gift.guardLevel]) {
    const source = `/img/overlays/danmaku-guard/bubble-${FRAMES[gift.guardLevel]}-frame.webp`;
    if (frame) updateBannerImage(frame, source);
    else root.insertBefore(bannerImage(source, 'gift-banner-frame', ''), root.querySelector('.gift-banner-text'));
  } else frame?.remove();
  return textChanged;
}

function giftAvatarSource(gift) {
  const token = globalThis.window?.__API_TOKEN__ || '';
  return gift.avatarUrl ? `/api/bilibili/avatar?url=${encodeURIComponent(gift.avatarUrl)}${token ? `&token=${encodeURIComponent(token)}` : ''}` : AVATAR_PLACEHOLDER;
}

function updateBannerImage(image, source, retry = false) {
  if (image.dataset.source !== source || (retry && image.getAttribute('src') !== source)) {
    image.dataset.source = source;
    image.style.visibility = '';
    image.src = source;
  }
}

export function fitGiftBannerNames(root) {
  for (const name of root.querySelectorAll('.gift-banner-name, .gift-banner-gift')) {
    name.style.fontSize = '';
    const availableWidth = name.getBoundingClientRect().width;
    if (!availableWidth) continue;
    const range = document.createRange();
    range.selectNodeContents(name);
    const textWidth = range.getBoundingClientRect().width;
    if (textWidth > availableWidth) {
      const fontSize = parseFloat(getComputedStyle(name).fontSize);
      name.style.fontSize = `${Math.floor(fontSize * availableWidth / textWidth * 10) / 10}px`;
    }
  }
}

function bannerImage(source, className, fallback) {
  const image = document.createElement('img');
  image.className = className;
  image.alt = '';
  image.draggable = false;
  image.src = source;
  image.dataset.source = source;
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
    const timeout = image.classList.contains('gift-banner-avatar') ? 9000 : 5000;
    const decoded = await Promise.race([
      image.decode().then(() => true, () => false),
      new Promise((resolve) => { timer = setTimeout(() => resolve(false), timeout); }),
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
  fitGiftBannerNames(root);
  await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
}
