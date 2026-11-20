import { DANMAKU_STYLE_OPTIONS } from '../shared/danmaku-style-options.js';

const FAVORITES_PREFIX = 'lira.danmaku-favorite-styles.v1.';
const listeners = new Set();
let account = '';
let styles = [];

function snapshot() {
  return { available: Boolean(account), styles: [...styles] };
}

function notify() {
  for (const listener of listeners) listener(snapshot());
}

export function setDanmakuStyleFavoritesAccount(nextAccount) {
  if (account === nextAccount) return;
  account = nextAccount;
  try {
    const saved = account ? JSON.parse(localStorage.getItem(`${FAVORITES_PREFIX}${encodeURIComponent(account)}`)) : null;
    styles = Array.isArray(saved) ? [...new Set(saved.filter(style => typeof style === 'string' && Object.hasOwn(DANMAKU_STYLE_OPTIONS, style)))] : [];
  } catch { styles = []; }
  notify();
}

export const danmakuStyleFavorites = {
  subscribe(listener) {
    listeners.add(listener);
    listener(snapshot());
    return () => listeners.delete(listener);
  },
  set({ style, favorite }) {
    if (!account) throw new Error('请先连接已授权的 LIRA 账号。');
    if (typeof style !== 'string' || !Object.hasOwn(DANMAKU_STYLE_OPTIONS, style) || typeof favorite !== 'boolean') throw new Error('收藏样式无效。');
    if (styles.includes(style) === favorite) return snapshot();
    const next = favorite ? [style, ...styles] : styles.filter(value => value !== style);
    try {
      localStorage.setItem(`${FAVORITES_PREFIX}${encodeURIComponent(account)}`, JSON.stringify(next));
    } catch { throw new Error('收藏未能保存，请重试。'); }
    styles = next;
    notify();
    return snapshot();
  },
};

export function bindDanmakuStyleFavorites({ root, cards, favorites = danmakuStyleFavorites, report }) {
  const entries = new Map();
  const originalOrder = [...cards.keys()];
  let order = [...originalOrder];
  let state = { available: false, styles: [] };
  let disposed = false;

  function moveCards() {
    const focused = document.activeElement;
    root.prepend(...order.map(style => entries.get(style).wrapper));
    if (focused !== document.activeElement && root.contains(focused)) focused.focus();
  }

  function reset() {
    order = [...state.styles.filter(style => entries.has(style)), ...originalOrder.filter(style => !state.styles.includes(style))];
    moveCards();
  }

  for (const [style, card] of cards) {
    const wrapper = document.createElement('div');
    wrapper.className = 'danmaku-style-card';
    card.replaceWith(wrapper);
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'danmaku-style-favorite';
    button.dataset.danmakuFavorite = style;
    const icon = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    icon.setAttribute('viewBox', '0 0 24 24');
    icon.setAttribute('aria-hidden', 'true');
    icon.setAttribute('focusable', 'false');
    const shape = document.createElementNS('http://www.w3.org/2000/svg', 'path');
    shape.setAttribute('d', 'm12 3 2.8 5.7 6.2.9-4.5 4.4 1.1 6.2L12 17.3l-5.6 2.9 1.1-6.2L3 9.6l6.2-.9L12 3Z');
    icon.append(shape);
    button.append(icon);
    wrapper.append(card, button);
    const entry = { wrapper, button, pending: false };
    entries.set(style, entry);
    button.addEventListener('click', async () => {
      if (entry.pending || !state.available) return;
      const focused = document.activeElement === button;
      entry.pending = true;
      button.disabled = true;
      report('');
      try { await favorites.set({ style, favorite: !state.styles.includes(style) }); }
      catch (error) { if (!disposed) report(error.message); }
      finally {
        entry.pending = false;
        if (!disposed) {
          button.disabled = !state.available;
          if (focused && document.activeElement === document.body) button.focus();
        }
      }
    });
  }

  const unsubscribe = favorites.subscribe(next => {
    const added = next.styles.filter(style => entries.has(style) && !state.styles.includes(style));
    state = next;
    for (const [style, { button, pending }] of entries) {
      const favorite = state.styles.includes(style);
      button.setAttribute('aria-pressed', String(favorite));
      button.setAttribute('aria-label', `${favorite ? '取消收藏' : '收藏'}：${DANMAKU_STYLE_OPTIONS[style].label}`);
      button.title = favorite ? '取消收藏' : '收藏并置顶';
      button.disabled = !state.available || pending;
    }
    if (added.length) {
      order = [...added, ...order.filter(style => !added.includes(style))];
      moveCards();
    }
  });
  reset();
  return { reset, get elements() { return order.map(style => entries.get(style).wrapper); },
    dispose() { disposed = true; unsubscribe(); } };
}
