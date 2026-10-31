const TITLES = { checkin: '签到祝福词库', fortune: '抽签词库', random: '点歌回复说明', exact: '完整匹配回复', diy: '关键词回复', welcome: '进场欢迎', scheduled: '定时／随机弹幕', query: '查询回复指令清单', thanks: '礼物答谢文案' };
const QUERY_LIST_HELP = '开启「查询回复」后，在直播间发送清单中的弹幕，系统会根据已保存的送礼记录自动回复。观众查询自己的记录，主播查询整个直播间的记录。所有时间均按北京时间计算。时间后面可以加“的”，例如“今天的礼物”。这里只展示指令用法，无需编辑或保存。';

export function initFixedReplyEditor({ documentRef = globalThis.document, windowRef = globalThis.window } = {}) {
  const root = documentRef.querySelector?.('.danmaku-fixed-reply-section');
  if (!root) return;
  const heading = documentRef.getElementById('danmakuFixedEditorHeading');
  const title = documentRef.getElementById('danmakuFixedEditorTitle');
  const tabs = documentRef.getElementById('danmakuWelcomeTabs');
  const buttons = [...root.querySelectorAll('[data-fixed-open]')];
  const panels = [...root.querySelectorAll('[data-fixed-editor]')];
  let active = '';
  function select(key) {
    active = key;
    heading.hidden = !key;
    title.textContent = TITLES[key] || '';
    if (key === 'query') {
      const help = documentRef.createElement('lira-help');
      help.setAttribute('label', '查询回复指令使用说明');
      help.textContent = QUERY_LIST_HELP;
      title.append(help);
    }
    tabs.hidden = key !== 'welcome';
    documentRef.getElementById('danmakuWelcomeRefreshBtn').hidden = key !== 'welcome';
    for (const panel of panels) {
      panel.hidden = !key || !panel.dataset.fixedEditor.split(' ').includes(key);
      if (panel.tagName === 'DETAILS') panel.open = !panel.hidden;
    }
    for (const button of buttons) {
      const selected = button.dataset.fixedOpen === key;
      button.setAttribute('aria-expanded', String(selected));
      button.closest('[data-fixed-item]').classList.toggle('is-editing', selected);
    }
    root.dispatchEvent(new windowRef.CustomEvent('fixed-reply:select', { detail: key }));
  }
  buttons.forEach((button) =>
    button.addEventListener('click', () => {
      select(active === button.dataset.fixedOpen ? '' : button.dataset.fixedOpen);
      if (active) heading.scrollIntoView({ block: 'nearest' });
    }),
  );
  documentRef.getElementById('danmakuFixedEditorClose').addEventListener('click', () => {
    const previous = active;
    select('');
    buttons.find((button) => button.dataset.fixedOpen === previous)?.focus();
  });
  root.addEventListener('welcome:show-editor', () => select('welcome'));
  const observers = [];
  function mirror(source, update) {
    if (!source) return;
    update();
    const observer = new windowRef.MutationObserver(update);
    observer.observe(source, { childList: true, characterData: true, subtree: true });
    observers.push(observer);
  }
  for (const target of root.querySelectorAll('[data-fixed-count]')) {
    const source = documentRef.getElementById(target.dataset.fixedCount);
    mirror(source, () => {
      target.textContent = source.textContent;
    });
  }
  const status = documentRef.getElementById('danmakuCustomReplyStatus');
  const note = root.querySelector('[data-fixed-note="diy"]');
  mirror(status, () => {
    note.textContent = /未保存|更改|失败|保存中|正在保存/.test(status.textContent) ? status.textContent : '';
  });
  for (const listId of ['danmakuCustomReplyList', 'danmakuExactReplyList', 'danmakuQueryReplyList']) {
    const list = documentRef.getElementById(listId);
    if (!list) continue;
    const pager = documentRef.createElement('div');
    pager.className = 'danmaku-library-pagination';
    const previous = documentRef.createElement('button'),
      next = documentRef.createElement('button');
    const label = documentRef.createElement('span');
    label.className = 'hint';
    previous.type = next.type = 'button';
    previous.className = next.className = 'ghost';
    previous.textContent = '上一页';
    next.textContent = '下一页';
    pager.append(previous, label, next);
    list.after(pager);
    let page = 0;
    const search = listId === 'danmakuQueryReplyList' ? documentRef.getElementById('danmakuQueryReplySearch') : null;
    const empty = listId === 'danmakuQueryReplyList' ? documentRef.getElementById('danmakuQuerySearchEmpty') : null;
    const isQuery = listId === 'danmakuQueryReplyList';
    const render = () => {
      const query = search?.value.trim().toLocaleLowerCase() || '';
      const allRows = isQuery ? [...list.querySelectorAll('.danmaku-query-reply-row')] : [...list.children];
      const rows = allRows.filter((row) => {
        const text = [row.textContent, row.dataset.search, ...[...row.querySelectorAll('input')].map((input) => input.value)].join(' ');
        return text.toLocaleLowerCase().includes(query);
      }),
        pages = Math.max(1, Math.ceil(rows.length / 6));
      page = Math.min(page, pages - 1);
      allRows.forEach((row) => { row.hidden = true; });
      rows.forEach((row, index) => {
        row.hidden = Math.floor(index / 6) !== page;
      });
      if (isQuery) {
        for (const group of list.querySelectorAll('.danmaku-query-reply-group')) {
          group.hidden = ![...group.querySelectorAll('.danmaku-query-reply-row')].some((row) => !row.hidden);
        }
      }
      pager.hidden = pages <= 1;
      previous.disabled = page === 0;
      next.disabled = page === pages - 1;
      label.textContent = `第 ${page + 1} / ${pages} 页`;
      if (empty) empty.hidden = rows.length > 0;
    };
    search?.addEventListener('input', () => { page = 0; render(); });
    previous.addEventListener('click', () => {
      page -= 1;
      render();
    });
    next.addEventListener('click', () => {
      page += 1;
      render();
    });
    const observer = new windowRef.MutationObserver(render);
    observer.observe(list, { childList: true });
    observers.push(observer);
    render();
  }
  windowRef.addEventListener('pagehide', () => observers.forEach((observer) => observer.disconnect()), { once: true });
  select('');
}
