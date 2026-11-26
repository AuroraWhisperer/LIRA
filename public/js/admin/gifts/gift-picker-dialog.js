import { setGiftArtwork } from '../../shared/gift-image.js';

const SVG_NS = 'http://www.w3.org/2000/svg';
const PAGE_SIZE = 80;
const SEARCH_DEBOUNCE_MS = 100;

const ICONS = {
  search: [
    ['circle', { cx: '11', cy: '11', r: '7.2' }],
    ['path', { d: 'm20 20-3.6-3.6' }],
  ],
  refresh: [
    ['path', { d: 'M21 12a9 9 0 1 1-2.64-6.36' }],
    ['path', { d: 'M21 3v6h-6' }],
  ],
  close: [
    ['path', { d: 'M18 6 6 18M6 6l12 12' }],
  ],
};

const CATEGORIES = [
  ['all', '全部'],
  ['guard', '大航海'],
  ['direct', '常规'],
  ['blind', '盲盒'],
];

function createElement(doc, tag, className = '', text) {
  const node = doc.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

function createIcon(doc, name, size = 15) {
  const make = (tag) => (typeof doc.createElementNS === 'function' ? doc.createElementNS(SVG_NS, tag) : doc.createElement(tag));
  const svg = make('svg');
  svg.setAttribute('viewBox', '0 0 24 24');
  svg.setAttribute('width', String(size));
  svg.setAttribute('height', String(size));
  svg.setAttribute('fill', 'none');
  svg.setAttribute('stroke', 'currentColor');
  svg.setAttribute('stroke-width', '2');
  svg.setAttribute('stroke-linecap', 'round');
  svg.setAttribute('stroke-linejoin', 'round');
  svg.setAttribute('aria-hidden', 'true');
  for (const [tag, attrs] of ICONS[name]) {
    const child = make(tag);
    for (const [key, value] of Object.entries(attrs)) child.setAttribute(key, value);
    svg.append(child);
  }
  return svg;
}

export function getGuardLevel(gift) {
  const numeric = Number(gift?.guardLevel);
  if (numeric === 1 || numeric === 2 || numeric === 3) return numeric;
  const match = /^guard-([123])$/i.exec(String(gift?.id ?? ''));
  return match ? Number(match[1]) : 0;
}

export function isGuardGift(gift) {
  return gift?.giftCategory === 'guard' || getGuardLevel(gift) > 0;
}

export function sortGuards(guards) {
  return [...(Array.isArray(guards) ? guards : [])].sort(
    (left, right) => (getGuardLevel(left) || 9) - (getGuardLevel(right) || 9),
  );
}

function formatPrice(rmb) {
  const amount = Number(rmb) || 0;
  return `¥${amount.toFixed(2)}`;
}

function classifyGift(gift, roleLabel) {
  if (isGuardGift(gift)) return 'guard';
  if (roleLabel) return roleLabel.startsWith('盲盒') ? 'blind' : 'direct';
  return gift?.giftCategory === 'blindBox' || gift?.giftCategory === 'blindBoxOutput' ? 'blind' : 'direct';
}

function createGiftBadge(doc, { disabled, roleLabel, gift }) {
  if (disabled) return createElement(doc, 'span', 'lira-gp-badge lira-gp-badge--muted', '待同步');
  if (classifyGift(gift, roleLabel) === 'blind') {
    return createElement(doc, 'span', 'lira-gp-badge lira-gp-badge--blind', '盲盒');
  }
  if (gift?.giftIdentity?.bagGift || gift?.bagGift) {
    return createElement(doc, 'span', 'lira-gp-badge lira-gp-badge--bag', '背包');
  }
  return null;
}

function createGuardCard(doc, gift, { optionClassName, guardSubtitle, onSelect }) {
  const level = getGuardLevel(gift) || 3;
  const className = ['lira-gp-option', 'lira-gp-guard', `lira-gp-guard--${level}`, optionClassName]
    .filter(Boolean)
    .join(' ');
  const button = createElement(doc, 'button', className);
  button.type = 'button';

  const image = doc.createElement('img');
  image.alt = '';
  image.loading = 'lazy';
  image.decoding = 'async';
  setGiftArtwork(image, gift.imagePath);

  const text = createElement(doc, 'span', 'lira-gp-guard-text');
  const name = createElement(doc, 'strong', 'lira-gp-guard-name', String(gift.name || gift.id));
  text.append(name);
  const sub = typeof guardSubtitle === 'function' ? guardSubtitle(gift) : guardSubtitle;
  if (sub) text.append(createElement(doc, 'small', 'lira-gp-guard-sub', sub));

  const dot = createElement(doc, 'span', 'lira-gp-guard-dot');
  dot.setAttribute('aria-hidden', 'true');

  button.append(image, text, dot);
  button.addEventListener('click', () => onSelect(gift));
  return button;
}

function createGiftCard(doc, gift, { optionClassName, disabled, roleLabel, disabledTitle, onSelect }) {
  const className = ['lira-gp-option', 'lira-gp-card', optionClassName].filter(Boolean).join(' ');
  const button = createElement(doc, 'button', className);
  button.type = 'button';
  button.disabled = Boolean(disabled);

  const image = doc.createElement('img');
  image.alt = '';
  image.loading = 'lazy';
  image.decoding = 'async';
  setGiftArtwork(image, gift.imagePath);

  const badge = createGiftBadge(doc, { disabled, roleLabel, gift });
  const nameText = String(gift.name || gift.id);
  const name = createElement(doc, 'strong', 'lira-gp-name', nameText);

  const meta = createElement(doc, 'span', 'lira-gp-meta');
  meta.append(
    createElement(doc, 'span', 'lira-gp-price', formatPrice(gift.rmb)),
    createElement(doc, 'span', 'lira-gp-dot', '·'),
    createElement(doc, 'span', 'lira-gp-id', `#${gift.id}`),
  );

  button.append(image);
  if (badge) button.append(badge);
  button.append(name, meta);

  const isBlindOutput = roleLabel.startsWith('盲盒产物');
  const isBag = Boolean(gift?.giftIdentity?.bagGift || gift?.bagGift);
  if (disabled && disabledTitle) {
    const details = [roleLabel, disabledTitle].filter(Boolean).join(' · ');
    button.title = `${nameText} · ${details}`;
    button.append(createElement(doc, 'small', 'lira-gp-role lira-gp-role--muted', details));
  } else if (isBlindOutput) {
    button.title = `${nameText} · ${roleLabel}`;
    button.append(createElement(doc, 'small', 'lira-gp-role', roleLabel));
  } else if (roleLabel === '直送礼物') {
    button.title = `${nameText} · ${roleLabel}`;
    button.append(createElement(doc, 'span', 'sr-only', roleLabel));
  } else if (roleLabel === '盲盒') {
    button.title = `${nameText} · 盲盒`;
  } else if (isBag) {
    button.title = `${nameText} · 背包礼物`;
  } else {
    button.title = nameText;
  }

  button.addEventListener('click', () => onSelect(gift));
  return button;
}

export function createGiftPickerDialog({
  dialog: providedDialog = null,
  documentRef = document,
  title = '选择礼物',
  optionClassName = '',
  ids = {},
  sourceAttribute = 'pickerSource',
  roomLabel = '本直播间',
  allLabel = '全部礼物',
  searchPlaceholder = '搜索名称或 ID…',
  showRefresh = false,
  guardSubtitle = '大航海',
  disabledTitle = '资料待同步，请刷新礼物库',
  getRoleLabel = () => '',
  isDisabled = () => false,
  onSelect,
  onSourceChange,
  onRefresh,
  onClose,
}) {
  const ownsDialog = !providedDialog;
  const dialog = providedDialog || createElement(documentRef, 'dialog');
  if (ids.dialog) dialog.id = ids.dialog;
  dialog.classList.add('lira-gift-picker');

  const shell = createElement(documentRef, 'div', 'lira-gp-shell');
  const header = createElement(documentRef, 'header', 'lira-gp-header');

  // Row 1: Title + inline subtitle <-> Search + Refresh + Close
  const topRow = createElement(documentRef, 'div', 'lira-gp-top');
  const heading = createElement(documentRef, 'div', 'lira-gp-heading');
  const titleEl = createElement(documentRef, 'h3', 'lira-gp-title', title);
  if (ids.title) {
    titleEl.id = ids.title;
    dialog.setAttribute('aria-labelledby', ids.title);
  } else {
    dialog.setAttribute('aria-label', title);
  }
  const subtitleEl = createElement(documentRef, 'span', 'lira-gp-subtitle', '');
  subtitleEl.hidden = true;
  heading.append(titleEl, subtitleEl);

  const controls = createElement(documentRef, 'div', 'lira-gp-controls');
  const searchWrap = createElement(documentRef, 'label', 'lira-gp-search');
  const searchIcon = createIcon(documentRef, 'search', 14);
  searchIcon.classList?.add?.('lira-gp-search-icon');
  const searchInput = createElement(documentRef, 'input', 'lira-gp-search-input');
  searchInput.type = 'search';
  if (ids.search) searchInput.id = ids.search;
  searchInput.placeholder = searchPlaceholder;
  searchInput.autocomplete = 'off';
  searchInput.maxLength = 100;
  searchInput.setAttribute('aria-label', '搜索礼物名称或 ID');
  searchWrap.append(searchIcon, searchInput);

  const actions = createElement(documentRef, 'div', 'lira-gp-actions');
  let refreshBtn = null;
  if (showRefresh) {
    refreshBtn = createElement(documentRef, 'button', 'lira-gp-icon-btn lira-gp-refresh');
    refreshBtn.type = 'button';
    if (ids.refresh) refreshBtn.id = ids.refresh;
    refreshBtn.title = '刷新在售礼物';
    refreshBtn.setAttribute('aria-label', '刷新在售礼物');
    refreshBtn.append(createIcon(documentRef, 'refresh', 14));
    refreshBtn.addEventListener('click', () => onRefresh?.());
    actions.append(refreshBtn);
  }

  const closeBtn = createElement(documentRef, 'button', 'lira-gp-icon-btn lira-gp-close');
  closeBtn.type = 'button';
  if (ids.close) closeBtn.id = ids.close;
  closeBtn.title = '关闭 (ESC)';
  closeBtn.setAttribute('aria-label', '关闭');
  closeBtn.append(createIcon(documentRef, 'close', 15));
  closeBtn.addEventListener('click', () => dialog.close());
  actions.append(closeBtn);

  controls.append(searchWrap, actions);
  topRow.append(heading, controls);

  // Row 2: Hairline scope tabs <-> Ghost category filters
  const navRow = createElement(documentRef, 'div', 'lira-gp-nav');
  const scopes = createElement(documentRef, 'div', 'lira-gp-scopes');
  scopes.setAttribute('role', 'group');
  scopes.setAttribute('aria-label', '礼物范围');

  const scopeButtons = {};
  const scopeCounts = {};
  for (const [source, label, buttonId] of [
    ['room', roomLabel, ids.roomTab],
    ['all', allLabel, ids.allTab],
  ]) {
    const btn = createElement(documentRef, 'button', 'lira-gp-tab');
    btn.type = 'button';
    if (buttonId) btn.id = buttonId;
    btn.dataset[sourceAttribute] = source;
    btn.setAttribute('aria-pressed', String(source === 'room'));
    const labelNode = createElement(documentRef, 'span', '', label);
    const countNode = createElement(documentRef, 'span', 'lira-gp-tab-count', '');
    countNode.hidden = true;
    btn.append(labelNode, countNode);
    btn.addEventListener('click', () => {
      if (btn.disabled) return;
      return onSourceChange?.(source);
    });
    scopes.append(btn);
    scopeButtons[source] = btn;
    scopeCounts[source] = countNode;
  }

  const filters = createElement(documentRef, 'div', 'lira-gp-filters');
  filters.setAttribute('role', 'group');
  filters.setAttribute('aria-label', '礼物分类');
  const filterButtons = {};
  for (const [category, label] of CATEGORIES) {
    const btn = createElement(documentRef, 'button', 'lira-gp-filter', label);
    btn.type = 'button';
    btn.dataset.pickerCategory = category;
    btn.setAttribute('aria-pressed', String(category === 'all'));
    btn.addEventListener('click', () => {
      if (activeCategory === category) return;
      activeCategory = category;
      syncFilterButtons();
      renderItems();
    });
    filters.append(btn);
    filterButtons[category] = btn;
  }

  navRow.append(scopes, filters);
  header.append(topRow, navRow);

  // Body
  const body = createElement(documentRef, 'div', 'lira-gp-body');
  const results = createElement(documentRef, 'div', 'lira-gp-results');
  if (ids.results) results.id = ids.results;
  body.append(results);

  // Footer
  const footer = createElement(documentRef, 'footer', 'lira-gp-footer');
  const footerStatus = createElement(documentRef, 'span', 'lira-gp-footer-status', '');
  if (ids.status) footerStatus.id = ids.status;
  footerStatus.setAttribute('role', 'status');
  const footerMeta = createElement(documentRef, 'span', 'lira-gp-footer-meta', '');
  footer.append(footerStatus, footerMeta);

  shell.append(header, body, footer);
  dialog.replaceChildren(shell);
  if (ownsDialog && documentRef.body) documentRef.body.append(dialog);

  let currentSource = 'room';
  let activeCategory = 'all';
  let currentGuards = [];
  let currentGifts = [];
  let stateMessage = '';
  let stateTone = 'normal';
  let emptyMessage = '没有匹配的礼物，试试其他名称或 ID。';
  let searchTimer;

  function syncFilterButtons() {
    for (const [category, btn] of Object.entries(filterButtons)) {
      btn.setAttribute('aria-pressed', String(activeCategory === category));
    }
  }

  function syncAvailableFilters() {
    const hasGuard = currentGuards.length > 0;
    let hasDirect = false;
    let hasBlind = false;
    for (const gift of currentGifts) {
      const kind = classifyGift(gift, getRoleLabel(gift) || '');
      if (kind === 'blind') hasBlind = true;
      else if (kind === 'direct') hasDirect = true;
    }
    const kindCount = Number(hasGuard) + Number(hasDirect) + Number(hasBlind);
    filters.hidden = kindCount <= 1;
    filterButtons.guard.hidden = !hasGuard;
    filterButtons.direct.hidden = !hasDirect;
    filterButtons.blind.hidden = !hasBlind;
    if (
      (activeCategory === 'guard' && !hasGuard) ||
      (activeCategory === 'direct' && !hasDirect) ||
      (activeCategory === 'blind' && !hasBlind)
    ) {
      activeCategory = 'all';
      syncFilterButtons();
    }
  }

  function renderItems() {
    clearTimeout(searchTimer);
    results.replaceChildren();

    if (stateMessage) {
      const cls = stateTone === 'error' ? 'lira-gp-empty lira-gp-empty--error' : 'lira-gp-empty';
      results.append(createElement(documentRef, 'p', cls, stateMessage));
      footerMeta.textContent = 'ESC 关闭';
      return;
    }

    syncAvailableFilters();

    const query = searchInput.value.trim().toLocaleLowerCase();
    const matchesQuery = (gift) =>
      !query ||
      String(gift.id ?? '').toLocaleLowerCase().includes(query) ||
      String(gift.name ?? '').toLocaleLowerCase().includes(query);

    const matchedGuards =
      activeCategory === 'all' || activeCategory === 'guard'
        ? currentGuards.filter(matchesQuery)
        : [];

    const matchedGifts =
      activeCategory === 'guard'
        ? []
        : currentGifts.filter((gift) => {
            if (!matchesQuery(gift)) return false;
            if (activeCategory === 'all') return true;
            return classifyGift(gift, getRoleLabel(gift) || '') === activeCategory;
          });

    const totalMatched = matchedGuards.length + matchedGifts.length;
    footerMeta.textContent = totalMatched ? `共 ${totalMatched} 款 · ESC 关闭` : 'ESC 关闭';

    if (!totalMatched) {
      results.append(createElement(documentRef, 'p', 'lira-gp-empty', emptyMessage));
      return;
    }

    if (matchedGuards.length) {
      const guardStrip = createElement(documentRef, 'div', 'lira-gp-guards');
      for (const guard of matchedGuards) {
        guardStrip.append(
          createGuardCard(documentRef, guard, {
            optionClassName,
            guardSubtitle,
            onSelect: handleSelect,
          }),
        );
      }
      results.append(guardStrip);
    }

    if (matchedGifts.length) {
      const grid = createElement(documentRef, 'div', 'lira-gp-grid');
      results.append(grid);

      let shown = 0;
      const moreButton = createElement(documentRef, 'button', 'secondary lira-gp-more');
      moreButton.type = 'button';

      function appendPage() {
        const start = shown;
        shown = Math.min(shown + PAGE_SIZE, matchedGifts.length);
        for (const gift of matchedGifts.slice(start, shown)) {
          const roleLabel = getRoleLabel(gift) || '';
          grid.append(
            createGiftCard(documentRef, gift, {
              optionClassName,
              disabled: Boolean(isDisabled(gift)),
              roleLabel,
              disabledTitle,
              onSelect: handleSelect,
            }),
          );
        }
        if (shown < matchedGifts.length) {
          moreButton.textContent = `显示更多（${shown} / ${matchedGifts.length}）`;
          results.append(moreButton);
        }
      }

      moreButton.addEventListener('click', () => {
        moreButton.remove();
        const firstNewIndex = grid.childElementCount;
        appendPage();
        grid.children[firstNewIndex]?.focus();
      });

      appendPage();
    }
  }

  function handleSelect(gift) {
    onSelect?.(gift);
  }

  searchInput.addEventListener('input', () => {
    clearTimeout(searchTimer);
    searchTimer = setTimeout(renderItems, SEARCH_DEBOUNCE_MS);
  });

  searchInput.addEventListener('keydown', (event) => {
    if (event.key !== 'Enter') return;
    event.preventDefault();
    clearTimeout(searchTimer);
    renderItems();
  });

  dialog.addEventListener('click', (event) => {
    if (event.target === dialog) dialog.close();
  });

  dialog.addEventListener('close', () => {
    clearTimeout(searchTimer);
    onClose?.();
  });

  return {
    dialog,
    elements: {
      dialog,
      title: titleEl,
      subtitle: subtitleEl,
      search: searchInput,
      results,
      refreshButton: refreshBtn,
      closeButton: closeBtn,
      roomTab: scopeButtons.room,
      allTab: scopeButtons.all,
      footerStatus,
      footerMeta,
    },
    open({ title: nextTitle, source = 'room' } = {}) {
      if (nextTitle !== undefined) titleEl.textContent = nextTitle;
      currentSource = source;
      activeCategory = 'all';
      searchInput.value = '';
      syncFilterButtons();
      this.setSource(source);
      if (!dialog.open) dialog.showModal();
      searchInput.focus();
    },
    close() {
      if (dialog.open) dialog.close();
    },
    focusSearch() {
      searchInput.focus();
    },
    getQuery() {
      return searchInput.value;
    },
    setTitle(nextTitle) {
      titleEl.textContent = nextTitle;
    },
    setSubtitle(text) {
      const value = String(text || '').trim();
      subtitleEl.textContent = value;
      subtitleEl.hidden = !value;
    },
    setFooterStatus(text) {
      footerStatus.textContent = String(text || '');
    },
    setSource(source) {
      currentSource = source;
      for (const [key, btn] of Object.entries(scopeButtons)) {
        btn.setAttribute('aria-pressed', String(key === source));
      }
    },
    setSourceDisabled(source, disabled) {
      if (scopeButtons[source]) scopeButtons[source].disabled = Boolean(disabled);
    },
    setSourceCount(source, count) {
      const node = scopeCounts[source];
      if (!node) return;
      if (Number.isFinite(count) && count >= 0) {
        node.textContent = String(count);
        node.hidden = false;
      } else {
        node.textContent = '';
        node.hidden = true;
      }
    },
    setRefreshing(refreshing, tooltip) {
      if (!refreshBtn) return;
      refreshBtn.disabled = Boolean(refreshing);
      refreshBtn.classList?.toggle?.('is-refreshing', Boolean(refreshing));
      refreshBtn.title = refreshing ? '正在刷新在售礼物…' : tooltip || '刷新在售礼物';
      refreshBtn.setAttribute('aria-label', refreshing ? '正在刷新在售礼物' : '刷新在售礼物');
    },
    setItems({ guards = [], gifts = [], message = '', tone = 'normal', empty = '没有匹配的礼物，试试其他名称或 ID。' } = {}) {
      currentGuards = sortGuards(guards);
      currentGifts = Array.isArray(gifts) ? gifts : [];
      stateMessage = message;
      stateTone = tone;
      emptyMessage = empty;
      renderItems();
    },
    render: renderItems,
    dispose() {
      clearTimeout(searchTimer);
      if (dialog.open) dialog.close();
      if (ownsDialog) dialog.remove();
    },
  };
}
