import { getRoomGuardState, isThousandGuardRoom, setRoomGuardState, subscribeRoomGuardState } from './bilibili-room-guard.js';

export { getRoomGuardState, subscribeRoomGuardState };

const GUARD_NAMES = { 1: 'governor', 2: 'prefect', 3: 'captain' };
const FRAME_NAMES = { 1: 'governor', 2: 'admiral', 3: 'captain' };
const ASSET_ROOT = '/img/admin/gifts/';
const FRAME_ROOT = '/img/overlays/';
const LEGACY_BADGES = {
  bf4f5ea4b54ca7bb358dec4e6c4afcc300c12eb9: 1,
  '62ac06fd72b05fe22be26426b9e1a8e1fc2c6b89': 2,
  '48360c8f3b7de8031e86ff1ef4a2dfc0ec2a61c2': 3,
};
export function getGuardIcon(level, count) {
  if (!Object.hasOwn(GUARD_NAMES, level)) return '';
  const name = GUARD_NAMES[level];
  const thousand = isThousandGuardRoom(count);
  return `${ASSET_ROOT}bilibili-guard-${name}${thousand ? '-thousand' : ''}.webp`;
}

export function getGuardAvatarFrame(level, count) {
  if (!Object.hasOwn(FRAME_NAMES, level)) return '';
  const name = FRAME_NAMES[level];
  return isThousandGuardRoom(count)
    ? `${FRAME_ROOT}danmaku-harbor/${name}-frame.png`
    : `${FRAME_ROOT}danmaku-guard/bubble-${name}-frame.webp`;
}

function imageGuardLevel(source) {
  const value = String(source || '');
  const local = /(?:^|\/)(?:bilibili-guard-)?(captain|prefect|admiral|governor)(?:-thousand)?\.webp$/.exec(value);
  if (local && (value.includes('/img/admin/gifts/') || value.includes('/danmaku-moonlit/') || value.includes('/moonlit/') || value.includes('/bilibili-guard-icons/'))) {
    return { captain: 3, prefect: 2, admiral: 2, governor: 1 }[local[1]];
  }
  const badge = /^https:\/\/i[0-2]\.hdslb\.com\/bfs\/live\/([a-f0-9]+)\.png$/.exec(value);
  return badge ? LEGACY_BADGES[badge[1]] || 0 : 0;
}

export function bindGuardImage(image, source) {
  const level = imageGuardLevel(source);
  const frame = /^\/(?:img\/overlays|overlay\/assets\/assets)\/(?:danmaku-guard\/bubble-(captain|admiral|governor)-frame\.webp|danmaku-harbor\/(captain|admiral|governor)-frame\.png)$/.exec(String(source || ''));
  const frameLevel = frame ? { captain: 3, admiral: 2, governor: 1 }[frame[1] || frame[2]] : 0;
  if (level) image.setAttribute('data-guard-icon', String(level));
  else image.removeAttribute('data-guard-icon');
  if (frameLevel) image.setAttribute('data-guard-avatar-frame', String(frameLevel));
  else image.removeAttribute('data-guard-avatar-frame');
  if (frameLevel) return getGuardAvatarFrame(frameLevel);
  return level ? getGuardIcon(level) : source;
}

export function setGuardIcon(image, level) {
  image.setAttribute('data-guard-icon', String(level));
  image.src = getGuardIcon(level);
}

// Each document receives its existing room snapshot; this module performs no network requests.
export function applyRoomGuardState(state, documentRef = globalThis.document) {
  setRoomGuardState(state);
  const root = documentRef?.documentElement;
  for (const [level, name] of Object.entries(GUARD_NAMES)) {
    root?.style.setProperty(`--bilibili-guard-${name}`, `url("${getGuardIcon(level)}")`);
    root?.style.setProperty(`--bilibili-guard-${name}-frame`, `url("${getGuardAvatarFrame(level)}")`);
  }
  for (const image of documentRef?.querySelectorAll?.('img[data-guard-icon]') || []) {
    const source = getGuardIcon(image.getAttribute('data-guard-icon'));
    if (source && image.getAttribute('src') !== source) image.src = source;
  }
  for (const image of documentRef?.querySelectorAll?.('img[data-guard-avatar-frame]') || []) {
    const source = getGuardAvatarFrame(image.getAttribute('data-guard-avatar-frame'));
    if (source && image.getAttribute('src') !== source) image.src = source;
  }
}
