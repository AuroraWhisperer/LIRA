import { createEditorPagination } from './danmaku-editor-pagination.js';

const TITLES = { checkin: '签到祝福词库', fortune: '抽签词库', names: '昵称管理', random: '点歌回复说明', exact: '完整匹配回复', diy: '关键词回复', welcome: '进场欢迎', pk: 'PK 播报与欢迎', scheduled: '定时／随机弹幕', query: '查询回复指令清单', thanks: '礼物答谢文案', likeThanks: '点赞感谢词库', shareThanks: '分享感谢词库', followThanks: '关注感谢词库' };
const QUERY_LIST_HELP = '开启「查询回复」后，在直播间发送清单中的弹幕，系统会根据已保存的送礼记录自动回复。观众查询自己的记录，主播查询整个直播间的记录。所有时间均按北京时间计算。时间后面可以加“的”，例如“今天的礼物”。这里只展示指令用法，无需编辑或保存。';

export function initFixedReplyEditor({ documentRef = globalThis.document, windowRef = globalThis.window } = {}) {
  const root = documentRef.getElementById('otherDanmakuFeature');
  if (!root) return;
  const dialog = documentRef.getElementById('danmakuFixedEditorDialog');
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
  function openEditor(key) {
    select(key);
    if (!dialog.open) dialog.showModal();
  }
  buttons.forEach((button) => {
    button.setAttribute('aria-haspopup', 'dialog');
    button.addEventListener('click', () => {
      openEditor(button.dataset.fixedOpen);
    });
  });
  documentRef.getElementById('danmakuFixedEditorDismiss').addEventListener('click', () => dialog.close());
  dialog.addEventListener('keydown', (event) => {
    if (event.key !== 'Escape' || event.isComposing || event.defaultPrevented) return;
    event.preventDefault();
    dialog.close();
  });
  const isOutside = (event) => {
    const rect = dialog.getBoundingClientRect();
    return event.clientX < rect.left || event.clientX > rect.right || event.clientY < rect.top || event.clientY > rect.bottom;
  };
  let pointerStartedOutside = false;
  dialog.addEventListener('pointerdown', (event) => {
    pointerStartedOutside = event.target === dialog && isOutside(event);
  });
  dialog.addEventListener('click', (event) => {
    if (pointerStartedOutside && event.target === dialog && isOutside(event)) dialog.close();
    pointerStartedOutside = false;
  });
  dialog.addEventListener('close', () => {
    if (dialog.open) return;
    const previous = active;
    select('');
    buttons.find((button) => button.dataset.fixedOpen === previous)?.focus();
  });
  root.addEventListener('welcome:show-editor', () => openEditor('welcome'));
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
  const paginationTargets = [
    ['dailyLibraryList', 'dailyLibraryPagination', '.danmaku-blessing-row, .danmaku-fortune-row'],
    ['danmakuCustomReplyList', '', '.danmaku-custom-reply-row'],
    ['danmakuExactReplyList', '', '.danmaku-custom-reply-row'],
    ['danmakuQueryReplyList', '', '.danmaku-query-reply-row', 'danmakuQueryReplySearch'],
    ['danmakuScheduledLibraryList', 'danmakuScheduledLibraryPagination', '.danmaku-blessing-row'],
    ...['like', 'share', 'follow'].map(kind => [`danmaku${kind}ThanksLibraryList`, `danmaku${kind}ThanksLibraryPagination`, '.danmaku-blessing-row']),
    ['danmakuWelcomeList', 'danmakuWelcomePagination', '.danmaku-blessing-row'],
    ['danmakuWelcomeCustomList', 'danmakuWelcomeCustomPagination', '.danmaku-welcome-custom-row'],
    ...['Whitelist', 'Blacklist'].map(kind => [`danmakuWelcome${kind}List`, `danmakuWelcome${kind}Pagination`, '.danmaku-welcome-audience-row']),
    ['danmakuPkReportList', 'danmakuPkReportPagination', '.danmaku-blessing-row'],
    ['danmakuViewerNamesList', 'danmakuViewerNamesPagination', '.danmaku-viewer-name-row'],
    ['danmakuGiftThanksList', '', '.danmaku-thanks-reply'],
    ['danmakuGiftThanksLegacy', '', '.danmaku-thanks-template'],
    ['danmakuSongReplyExamples', '', ':scope > div'],
    ['danmakuWelcomeRules', '', ':scope > .danmaku-welcome-rule'],
  ];
  const disposePagers = paginationTargets.flatMap(([id, pagerId, rowSelector, searchId]) => {
    const list = documentRef.getElementById(id);
    return list ? [createEditorPagination({ list, rowSelector, windowRef,
      pagination: pagerId ? documentRef.getElementById(pagerId) : null,
      search: searchId ? documentRef.getElementById(searchId) : null })] : [];
  });
  windowRef.addEventListener('pagehide', () => { observers.forEach((observer) => observer.disconnect()); disposePagers.forEach(dispose => dispose()); }, { once: true });
  select('');
}
