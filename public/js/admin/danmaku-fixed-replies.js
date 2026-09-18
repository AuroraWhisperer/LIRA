const TITLES = { random: '随机点歌回复',
  diy: 'DIY 关键词回复', welcome: '进场欢迎', pk: 'PK 对手信息播报' };

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
    heading.hidden = !key; title.textContent = TITLES[key] || '';
    tabs.hidden = key !== 'welcome';
    for (const panel of panels) {
      panel.hidden = panel.dataset.fixedEditor !== key;
      if (panel.tagName === 'DETAILS') panel.open = !panel.hidden;
    }
    for (const button of buttons) {
      const selected = button.dataset.fixedOpen === key;
      button.setAttribute('aria-expanded', String(selected));
      button.closest('[data-fixed-item]').classList.toggle('is-editing', selected);
    }
  }
  buttons.forEach((button) => button.addEventListener('click', () => select(button.dataset.fixedOpen)));
  documentRef.getElementById('danmakuFixedEditorClose').addEventListener('click', () => {
    const previous = active; select('');
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
    mirror(source, () => { target.textContent = source.textContent; });
  }
  for (const [key, prefix] of [['diy', 'CustomReply']]) {
    const status = documentRef.getElementById(`danmaku${prefix}Status`);
    const note = root.querySelector(`[data-fixed-note="${key}"]`);
    mirror(status, () => { note.textContent = /未保存|更改|失败|保存中|正在保存/.test(status.textContent) ? status.textContent : ''; });
    const list = documentRef.getElementById(`danmaku${prefix}List`);
    const pager = documentRef.createElement('div'); pager.className = 'danmaku-library-pagination';
    const previous = documentRef.createElement('button'), next = documentRef.createElement('button');
    const label = documentRef.createElement('span'); label.className = 'hint';
    previous.type = next.type = 'button'; previous.className = next.className = 'ghost';
    previous.textContent = '上一页'; next.textContent = '下一页';
    pager.append(previous, label, next); list.after(pager);
    let page = 0;
    const render = () => {
      const rows = [...list.children], pages = Math.max(1, Math.ceil(rows.length / 6));
      page = Math.min(page, pages - 1);
      rows.forEach((row, index) => { row.hidden = Math.floor(index / 6) !== page; });
      pager.hidden = pages <= 1;
      previous.disabled = page === 0; next.disabled = page === pages - 1;
      label.textContent = `第 ${page + 1} / ${pages} 页`;
    };
    previous.addEventListener('click', () => { page -= 1; render(); });
    next.addEventListener('click', () => { page += 1; render(); });
    const observer = new windowRef.MutationObserver(render);
    observer.observe(list, { childList: true }); observers.push(observer); render();
  }
  const pk = documentRef.getElementById('danmakuPkReportStatus');
  mirror(pk, () => { documentRef.getElementById('danmakuPkReportDetail').textContent = pk.textContent; });
  windowRef.addEventListener('pagehide', () => observers.forEach((observer) => observer.disconnect()), { once: true });
  select('');
}
