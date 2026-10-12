const GUARD_NAMES = { 1: 'governor', 2: 'prefect', 3: 'captain' };
const ASSET_ROOT = '/img/admin/gifts/';
const LEGACY_BADGES = {
  bf4f5ea4b54ca7bb358dec4e6c4afcc300c12eb9: 1,
  '62ac06fd72b05fe22be26426b9e1a8e1fc2c6b89': 2,
  '48360c8f3b7de8031e86ff1ef4a2dfc0ec2a61c2': 3,
};
let currentCount = null;
let roomGuard = { roomId: '', count: null };
const listeners = new Set();

export function getRoomGuardState() {
  return { ...roomGuard };
}

export function subscribeRoomGuardState(listener) {
  listeners.add(listener);
  listener(getRoomGuardState());
  return () => listeners.delete(listener);
}

export function getGuardIcon(level, count = currentCount) {
  if (!Object.hasOwn(GUARD_NAMES, level)) return '';
  const name = GUARD_NAMES[level];
  const thousand = Number.isSafeInteger(count) && count >= 1000;
  return `${ASSET_ROOT}bilibili-guard-${name}${thousand ? '-thousand' : ''}.webp`;
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
  if (level) image.setAttribute('data-guard-icon', String(level));
  else image.removeAttribute('data-guard-icon');
  return level ? getGuardIcon(level) : source;
}

export function setGuardIcon(image, level) {
  image.setAttribute('data-guard-icon', String(level));
  image.src = getGuardIcon(level);
}

// Each document receives its existing room snapshot; this module performs no network requests.
export function applyRoomGuardState(state, documentRef = globalThis.document) {
  currentCount = state?.roomId && Number.isSafeInteger(state.count) && state.count >= 0 ? state.count : null;
  const next = { roomId: state?.roomId || '', count: currentCount };
  const changed = next.roomId !== roomGuard.roomId || next.count !== roomGuard.count;
  roomGuard = next;
  const root = documentRef?.documentElement;
  for (const [level, name] of Object.entries(GUARD_NAMES)) {
    root?.style.setProperty(`--bilibili-guard-${name}`, `url("${getGuardIcon(level)}")`);
  }
  for (const image of documentRef?.querySelectorAll?.('img[data-guard-icon]') || []) {
    const source = getGuardIcon(image.getAttribute('data-guard-icon'));
    if (source && image.getAttribute('src') !== source) image.src = source;
  }
  if (changed) for (const listener of listeners) listener(getRoomGuardState());
}
