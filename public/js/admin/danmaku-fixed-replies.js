import { createEditorPagination } from './danmaku-editor-pagination.js';
import './contextual-help.js';

const TITLES = { checkin: '签到祝福词库', fortune: '抽签设置', names: '昵称管理', random: '点歌回复说明', exact: '完整匹配回复', diy: '关键词回复', welcome: '进场欢迎', pk: 'PK 播报与欢迎', scheduled: '定时／随机弹幕', query: '查询回复指令清单', thanks: '礼物答谢文案', likeThanks: '点赞感谢词库', shareThanks: '分享感谢词库', followThanks: '关注感谢词库' };
const QUERY_LIST_HELP = '观众发指令查自己，主播发指令查全房（按北京时间统计）。时间词后面加不加“的”都可以，比如“今日礼物”或“今天的礼物”。此处仅作指令速查，无需编辑。';

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
    dialog.dataset.fixedActive = key;
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
  function mirror(source, update, attributeFilter) {
    if (!source) return;
    update();
    const observer = new windowRef.MutationObserver(update);
    observer.observe(source, { childList: true, characterData: true, subtree: true, attributeFilter });
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
    note.ariaBusy = String(!status.classList.contains('warn'));
    note.textContent = /未保存|更改|失败|保存中|正在保存/.test(status.textContent) ? status.textContent : '';
  });
  for (const source of root.querySelectorAll('.danmaku-function-groups .danmaku-fixed-note')) {
    const heading = source.parentElement.querySelector('.danmaku-fixed-item-heading');
    const help = heading.querySelector('lira-help');
    const warning = documentRef.createElement('lira-help');
    warning.className = 'danmaku-status-warning';
    warning.setAttribute('label', `${heading.querySelector('strong').textContent}状态提示`);
    const detail = documentRef.createElement('span');
    warning.append(detail);
    help.after(warning);
    heading.addEventListener('beforetoggle', (event) => {
      if (event.newState !== 'open') return;
      const other = warning.contains(event.target) ? help : warning;
      if (other.tooltipOpen) other.hideTooltip();
    }, true);
    // Keep the original live region and switch descriptions available with the tooltip closed.
    source.classList.add('sr-only');
    mirror(source, () => {
      const message = source.hidden || source.ariaBusy === 'true' ? '' : source.textContent.trim();
      detail.textContent = message;
      if (!message && warning.tooltipOpen) warning.hideTooltip();
      warning.hidden = !message;
      if (warning.tooltipOpen) warning.positionTooltip();
    }, ['hidden', 'aria-busy']);
  }
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
