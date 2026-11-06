import { DANMAKU_STYLE_OPTIONS } from '../shared/danmaku-style-options.js';
import { DANMAKU_STYLE_TAGS } from './danmaku-style-catalog.js';

const HISTORY_PREFIX = 'lira.danmaku-recent-styles.v1.';
const RECENT_LIMIT = 4;
const LAYOUT_LABELS = { fixed: '固定位置', 'fullscreen-random': '区域随机', floating: '飘窗弹幕' };

export function bindDanmakuStyleFilters({ root, clearButton, render }) {
  const groups = [...root.querySelectorAll('[data-style-filter-group]')];
  const filters = { layout: 'all', motion: 'all', holiday: 'all', visual: 'all' };

  function filter() {
    for (const group of groups) {
      for (const button of group.querySelectorAll('button')) {
        button.setAttribute('aria-pressed', String(button.dataset.filterValue === filters[group.dataset.styleFilterGroup]));
      }
    }
    clearButton.disabled = Object.values(filters).every(value => value === 'all');
    render(style => {
      const values = { layout: DANMAKU_STYLE_OPTIONS[style].layout || 'fixed', ...DANMAKU_STYLE_TAGS[style] };
      return Object.entries(filters).every(([key, value]) => value === 'all'
        || (Array.isArray(values[key]) ? values[key].includes(value) : String(values[key]) === value));
    });
  }

  for (const group of groups) {
    const choices = [...group.querySelectorAll('button')];
    group.addEventListener('click', event => {
      const button = event.target.closest('button');
      if (!button) return;
      filters[group.dataset.styleFilterGroup] = button.dataset.filterValue;
      filter();
    });
    group.addEventListener('keydown', event => {
      const index = choices.indexOf(event.target);
      if (index < 0) return;
      let next;
      if (event.key === 'ArrowRight') next = (index + 1) % choices.length;
      else if (event.key === 'ArrowLeft') next = (index + choices.length - 1) % choices.length;
      else if (event.key === 'Home') next = 0;
      else if (event.key === 'End') next = choices.length - 1;
      else return;
      event.preventDefault();
      choices[next].focus();
      choices[next].click();
    });
  }
  clearButton.addEventListener('click', () => {
    for (const key of Object.keys(filters)) filters[key] = 'all';
    filter();
  });
  filter();
  return filter;
}

export function bindDanmakuStyleLibrary({ buttons, controller, getAccount }) {
  const dialog = document.getElementById('danmakuStyleLibrary');
  const recentList = document.getElementById('danmakuRecentStyles');
  const openButton = document.getElementById('danmakuAllStylesBtn');
  const clearButton = document.getElementById('danmakuClearStyleFilters');
  const count = document.getElementById('danmakuStyleResultCount');
  const empty = document.getElementById('danmakuStyleEmpty');
  const cards = new Map(buttons.map(button => [button.dataset.danmakuStyle, button]));
  let account;
  let history = [];
  let previous;
  let recentSignature = '';

  function readHistory() {
    if (!account) return [];
    try {
      const saved = JSON.parse(localStorage.getItem(`${HISTORY_PREFIX}${encodeURIComponent(account)}`));
      return Array.isArray(saved) ? [...new Set(saved.filter(style => cards.has(style)))].slice(0, RECENT_LIMIT) : [];
    } catch { return []; }
  }

  function remember(style) {
    if (!account || !cards.has(style)) return;
    history = [style, ...history.filter(value => value !== style)].slice(0, RECENT_LIMIT);
    try {
      localStorage.setItem(`${HISTORY_PREFIX}${encodeURIComponent(account)}`, JSON.stringify(history));
    } catch (error) {
      console.warn('[DanmakuStyleLibrary] Failed to save recent styles:', error);
    }
  }

  function renderRecent(state) {
    const styles = [...new Set([state.draft.style, state.saved.style, ...history])]
      .filter(style => cards.has(style)).slice(0, RECENT_LIMIT);
    const signature = JSON.stringify(styles);
    if (signature !== recentSignature) {
      recentSignature = signature;
      recentList.replaceChildren(...styles.map(style => {
        const source = cards.get(style);
        const card = source.cloneNode(true);
        card.removeAttribute('data-danmaku-style');
        card.dataset.recentDanmakuStyle = style;
        card.hidden = false;
        // Keep the original selection path, including imported-style parameter cleanup.
        card.addEventListener('click', () => {
          source.click();
          recentList.querySelector(`[data-recent-danmaku-style="${style}"]`)?.focus();
        });
        return card;
      }));
    }
    for (const card of recentList.children) {
      card.setAttribute('aria-pressed', String(card.dataset.recentDanmakuStyle === state.draft.style));
      card.disabled = !state.loaded;
    }
  }

  for (const [style, card] of cards) {
    const name = card.querySelector('.danmaku-style-name');
    const caption = document.createElement('span');
    caption.className = 'danmaku-style-caption';
    const code = document.createElement('span');
    code.className = 'danmaku-style-code';
    code.textContent = style;
    card.title = LAYOUT_LABELS[DANMAKU_STYLE_OPTIONS[style].layout || 'fixed'];
    caption.append(name, code);
    card.append(caption);
    card.addEventListener('click', () => {
      if (!controller.getState().loaded) return;
      controller.edit({ style });
      if (dialog.open) dialog.close();
    });
  }

  bindDanmakuStyleFilters({ root: dialog, clearButton, render(matches) {
    let visible = 0;
    for (const [style, card] of cards) {
      card.hidden = !matches(style);
      if (!card.hidden) visible += 1;
    }
    count.textContent = `${visible} 款内置样式`;
    empty.hidden = visible > 0;
  } });
  openButton.addEventListener('click', () => {
    if (dialog.open) return;
    dialog.showModal();
    document.getElementById('danmakuCloseStyleLibraryBtn').focus({ preventScroll: true });
    dialog.querySelector('.danmaku-library-scroll').scrollTop = 0;
  });
  document.getElementById('danmakuCloseStyleLibraryBtn').addEventListener('click', () => dialog.close());
  document.getElementById('danmakuImportedStyles').addEventListener('click', event => {
    if (event.target.closest('.component-style-select')) dialog.close();
  });
  dialog.addEventListener('close', () => openButton.focus());
  controller.subscribe(state => {
    const nextAccount = getAccount();
    if (account !== nextAccount) {
      account = nextAccount;
      history = readHistory();
      previous = null;
      if (dialog.open) dialog.close();
    }
    if (previous?.saving && !state.saving && previous.generation === state.generation
      && state.applied && !state.error) remember(state.saved.style);
    for (const [style, card] of cards) {
      card.setAttribute('aria-pressed', String(style === state.draft.style));
      card.disabled = !state.loaded;
    }
    renderRecent(state);
    previous = state;
  });
}
