import { RANKING_FLAGS, rankingDefaults, selectRankingRows, rankingCountdown, rankingCurrentNote } from './live-rankings.js';

const scoreFormatter = new Intl.NumberFormat('zh-CN');
const formatScore = value => Number.isFinite(value) ? scoreFormatter.format(value) : '—';
function element(tag, className, text = '') {
  const node = document.createElement(tag);
  node.className = className;
  node.textContent = text;
  return node;
}
function write(node, value) { if (node.textContent !== value) node.textContent = value; }
function writeAttribute(node, name, value) { if (node.getAttribute(name) !== value) node.setAttribute(name, value); }
function setHidden(node, hidden) { if (node.hidden !== hidden) node.hidden = hidden; }
function avatarSource(value) {
  try {
    const url = new URL(value);
    return url.protocol === 'https:' && url.hostname.endsWith('.hdslb.com') && !url.username && !url.password ? url.href : '';
  } catch { return ''; }
}

export function createRankingsView(host, { scrollable = false, now = Date.now, onConfigure } = {}) {
  const cards = new Map();
  let snapshot;
  let config = rankingDefaults();
  let pageStarted = now();
  let configKey;
  let resizeFrame = 0;
  const resizeObserver = scrollable ? null : new ResizeObserver(() => {
    if (resizeFrame) return;
    resizeFrame = requestAnimationFrame(() => {
      resizeFrame = 0;
      for (const card of cards.values()) {
        if (!card.root.hidden && card.board && rowCapacity(card) !== card.capacity) renderRows(card, card.page);
      }
    });
  });
  host.classList.add('rankings-grid');
  host.classList.toggle('rankings-scrollable', scrollable);

  function createRow() {
    const root = element('li', 'ranking-row');
    const rank = element('span', 'ranking-place');
    const avatar = element('img', 'ranking-avatar');
    avatar.alt = ''; avatar.loading = 'lazy'; avatar.referrerPolicy = 'no-referrer';
    const copy = element('div', 'ranking-person');
    const name = element('span', 'ranking-name');
    const detail = element('span', 'ranking-detail');
    const score = element('strong', 'ranking-score');
    copy.append(name, detail); root.append(rank, avatar, copy, score);
    return { root, rank, avatar, name, detail, score };
  }
  function updateRow(view, row, board, current = false) {
    write(view.rank, row.rank ? String(row.rank) : `${board.limit}+`);
    write(view.name, row.name || '当前直播间');
    writeAttribute(view.name, 'title', row.name || '');
    write(view.detail, current ? '本房间' : board.unit === '助力值' && row.supporters !== null
      ? `${formatScore(row.supporters)} 人助力` : row.areaName || '直播中');
    const score = formatScore(row.score);
    write(view.score, score);
    const src = config.showAvatar ? avatarSource(row.avatarUrl) : '';
    if ((view.avatar.getAttribute('src') || '') !== src) {
      if (src) view.avatar.src = src;
      else view.avatar.removeAttribute('src');
    }
    setHidden(view.avatar, !src);
    view.root.classList.toggle('is-current', current);
    writeAttribute(view.root, 'data-place', row.rank <= 3 && row.rank ? String(row.rank) : '');
    writeAttribute(view.root, 'aria-label', `${row.rank || '未上榜'} ${row.name} ${score} ${board.unit}${current ? '，本房间' : ''}`);
  }
  function createCard(id) {
    const root = element('section', 'ranking-card');
    const header = element('header', 'ranking-header');
    const heading = element('div', 'ranking-heading');
    const title = element('h3', 'ranking-title');
    const unit = element('span', 'ranking-unit');
    const timer = element('div', 'ranking-time');
    const countdown = element('strong', 'ranking-countdown');
    timer.append(element('span', '', '本轮剩余'), countdown);
    heading.append(title, unit); header.append(heading, timer);
    let configure;
    if (onConfigure) {
      configure = element('button', 'secondary ranking-configure', '配置直播画面');
      configure.type = 'button';
      configure.addEventListener('click', async () => {
        configure.disabled = true;
        try { await onConfigure(id); } finally { configure.disabled = false; }
      });
      header.append(configure);
    }
    const body = element('div', 'ranking-body');
    const list = element('ol', 'ranking-list');
    const empty = element('p', 'ranking-empty');
    body.append(list, empty);
    const footer = element('footer', 'ranking-footer');
    const mine = createRow();
    const mineList = element('ol', 'ranking-current'); mineList.append(mine.root);
    const note = element('p', 'ranking-distance');
    const status = element('p', 'ranking-freshness');
    footer.append(mineList, note, status);
    root.append(header, body, footer);
    host.append(root);
    const card = { id, root, title, unit, countdown, configure, body, list, empty, mine, mineList, note, status,
      rows: new Map(), page: null, capacity: null, rowHeight: 0, board: null };
    cards.set(id, card);
    resizeObserver?.observe(body);
    resizeObserver?.observe(list);
    return card;
  }
  function rowCapacity(card) {
    const row = card.list.firstElementChild || card.mine.root;
    card.rowHeight = row.getBoundingClientRect().height || card.rowHeight;
    if (!card.rowHeight) return config.pageSize;
    const style = getComputedStyle(card.body);
    const available = card.body.clientHeight - parseFloat(style.paddingTop) - parseFloat(style.paddingBottom);
    return Math.max(0, Math.floor(available / card.rowHeight));
  }
  function renderRows(card, page) {
    const board = card.board;
    const capacity = scrollable ? null : rowCapacity(card);
    const rows = selectRankingRows(board, config, scrollable && config.range === 'all' ? null : page, capacity);
    const keep = new Set();
    rows.forEach((row, index) => {
      const key = row.roomId || row.uid;
      keep.add(key);
      let view = card.rows.get(key);
      if (!view) { view = createRow(); card.rows.set(key, view); }
      updateRow(view, row, board, row.roomId === snapshot?.room?.roomId);
      if (card.list.children[index] !== view.root) card.list.insertBefore(view.root, card.list.children[index] || null);
    });
    for (const [key, view] of card.rows) if (!keep.has(key)) { view.root.remove(); card.rows.delete(key); }
    setHidden(card.mineList, !board.current || config.range === 'nearby' && rows.some(row => row.roomId === board.current.roomId));
    setHidden(card.empty, rows.length > 0 || capacity === 0);
    write(card.empty, board.status === 'loading' ? '正在读取榜单…' : board.status === 'unavailable' ? board.message
      : config.range === 'nearby' ? board.eligible === false ? '本房间暂不参与此榜' : board.current?.rank
        ? 'B 站暂未返回附近名次' : `本房间未进入前 ${board.limit} 名，暂无附近排名`
        : board.status === 'stale' ? '榜单连接暂不可用，正在重试' : '本轮暂时无人上榜');
    card.page = page;
    card.capacity = capacity;
    const start = rows[0]?.rank;
    const end = rows.at(-1)?.rank;
    write(card.unit, `${board.unit}${start && !scrollable && config.range === 'all' ? ` · ${start}–${end} / ${board.rows.length}` : ''}`);
  }
  function getBottomAnchors() {
    if (!scrollable) return [];
    return [...cards.values()].filter(({ root, body }) => !root.hidden && body.scrollTop > 0
      && body.scrollHeight - body.clientHeight - body.scrollTop <= 1).map(card => card.body);
  }
  function tick(bottomAnchors = getBottomAnchors()) {
    const time = now();
    for (const card of cards.values()) {
      if (card.root.hidden || !card.board) continue;
      const board = card.board;
      write(card.countdown, rankingCountdown(board, time));
      card.countdown.classList.toggle('is-ending', board.endsAt > time && board.endsAt - time <= 60000);
      const age = board.updatedAt ? Math.max(0, time - board.updatedAt) : Infinity;
      const delayed = board.status === 'stale' || age > 2000 && board.status === 'ready';
      write(card.status, board.status === 'loading' ? '连接中' : board.status === 'unavailable' ? board.message
        : delayed ? `更新延迟${Number.isFinite(age) ? ` · ${Math.floor(age / 1000)} 秒前的数据` : ' · 正在重试'}`
          : '');
      card.status.classList.toggle('is-delayed', delayed);
      const page = scrollable || config.range !== 'all' ? 0 : Math.floor((time - pageStarted) / (config.pageSeconds * 1000));
      if (page !== card.page) renderRows(card, page);
    }
    for (const body of bottomAnchors) body.scrollTop = body.scrollHeight;
  }
  function update(data, appearance = config) {
    const bottomAnchors = getBottomAnchors();
    snapshot = data;
    config = { ...rankingDefaults(), ...appearance };
    const key = JSON.stringify(config);
    if (key !== configKey) {
      configKey = key; pageStarted = now();
      host.dataset.theme = config.theme;
      host.style.setProperty('--ranking-columns', config.columns);
      host.style.setProperty('--ranking-font-size', `${config.fontSize}px`);
      host.style.setProperty('--ranking-accent', config.accent);
    }
    const visible = new Set();
    for (const board of data?.boards || []) {
      if (!config[RANKING_FLAGS[board.id]]) continue;
      visible.add(board.id);
      const card = cards.get(board.id) || createCard(board.id);
      setHidden(card.root, false); card.board = board;
      write(card.title, board.title);
      if (card.configure) writeAttribute(card.configure, 'aria-label', `配置${board.title}直播画面`);
      if (board.current) updateRow(card.mine, board.current, board, true);
      write(card.note, rankingCurrentNote(board));
      const page = scrollable || config.range !== 'all' ? 0 : Math.floor((now() - pageStarted) / (config.pageSeconds * 1000));
      renderRows(card, page);
    }
    for (const card of cards.values()) setHidden(card.root, !visible.has(card.id));
    tick(bottomAnchors);
  }
  return { update, tick, dispose() { resizeObserver?.disconnect(); cancelAnimationFrame(resizeFrame); cards.clear(); host.replaceChildren(); } };
}
