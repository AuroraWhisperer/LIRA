// 组件 → 礼物姬 → 全屏礼物感谢：导入的样式各占一张卡片，排在内置效果之后。
// 图片/视频样式各自保存开关与触发金额；林间花信沿用 gift-frame.js 的设置卡片。
import { api, toast } from '../shared/utils.js';
import { componentStyleMedia } from '../shared/component-resource-style.js';
import {
  GIFT_FRAME_STYLE_TRIGGERS_KEY,
  isGiftFrameTriggerStyle,
  readGiftFrameStyleTrigger,
  writeGiftFrameStyleTrigger,
} from '../shared/gift-frame-style-triggers.js';
import { sceneExtraPreviewData } from './scene-extra-preview-data.js';

const PENDING = '有未保存修改，点击“保存设置”后生效。';
const views = new Map();
let settings = {};
let knownIds = [];
let saveQueue = Promise.resolve();
let initialized = false;

const element = (tag, className = '', text = '') => {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text) node.textContent = text;
  return node;
};
const isWoodland = style => style.config.resourceStyle?.preset === 'woodland-gift-frame';

export function initGiftFrameStyles() {
  if (initialized) return;
  initialized = true;
  window.addEventListener('app:settings-state', (event) => {
    settings = event.detail || {};
    for (const view of views.values()) if (view.trigger) syncTrigger(view);
  });
}

// Called after every library refresh; the library still owns import, add-to-canvas and remove confirmation.
export function renderGiftFrameStyles({ cards, add, use }) {
  const list = document.getElementById('giftEffectList');
  const addCard = document.getElementById('giftFrameAddStyle');
  if (!list || !addCard) return;
  if (add) addCard.append(add);
  knownIds = cards.map(({ style }) => style).filter(isGiftFrameTriggerStyle).map(style => style.id);
  const woodlandActions = document.getElementById('giftFrameStyleActions');
  const listed = new Set();
  for (const { style, card } of cards) {
    if (isWoodland(style)) {
      woodlandActions?.replaceChildren(...libraryActions(style, card));
      continue;
    }
    listed.add(style.id);
    let view = views.get(style.id);
    if (!view) { view = createView(style); views.set(style.id, view); }
    view.style = style;
    view.libraryActions.replaceChildren(...libraryActions(style, card));
    view.use = use;
    addCard.before(view.root);
  }
  if (!cards.some(({ style }) => isWoodland(style))) woodlandActions?.replaceChildren();
  for (const [id, view] of views) {
    if (listed.has(id)) continue;
    view.root.remove(); views.delete(id);
  }
}

function libraryActions(style, card) {
  const actions = [];
  const remove = card.querySelector('.component-style-delete');
  if (remove) {
    remove.className = 'button-quiet gift-effect-remove'; remove.textContent = '移除';
    remove.setAttribute('aria-label', `移除样式：${style.name}`);
    actions.push(remove);
  }
  const select = card.querySelector('.component-style-select');
  if (select) {
    select.className = 'secondary'; select.replaceChildren('添加到画布'); select.removeAttribute('title');
    actions.push(select);
  }
  return actions;
}

function createView(style) {
  const media = componentStyleMedia(style.config);
  const titleId = `giftFrameStyle-${style.id}-title`;
  const root = element('section', 'gift-effect-card');
  root.dataset.giftFrameStyleId = style.id;
  root.setAttribute('aria-labelledby', titleId);
  const head = element('header', 'gift-effect-card-head');
  head.append(thumbnail(media));
  const title = element('div', 'gift-effect-card-title');
  const heading = element('h3'); heading.id = titleId;
  heading.append(style.name, element('span', 'gift-effect-tag', tagFor(style, media)));
  title.append(heading, element('p', '', describe(style, media)));
  head.append(title);
  const fields = element('div', 'gift-effect-fields');
  const foot = element('footer', 'gift-effect-card-foot');
  const status = element('p', 'hint gift-frame-status'); status.setAttribute('role', 'status'); status.setAttribute('aria-live', 'polite');
  const actions = element('div', 'gift-effect-actions');
  const libraryActionsHost = element('span', 'gift-effect-style-actions');
  actions.append(libraryActionsHost);
  foot.append(status, actions);
  root.append(head, fields, foot);
  const view = { root, style, status, libraryActions: libraryActionsHost, use: null, trigger: null };
  if (isGiftFrameTriggerStyle(style)) mountTrigger(view, head, fields, actions);
  else fields.append(element('p', 'gift-effect-note', style.type === 'browser'
    ? '网页样式作为浏览器源运行，按网页自身内容显示，不接收礼物事件，也不使用触发金额。'
    : '外观样式套用在内置全屏礼物感谢上，随礼物掉落、礼物摇摇乐和林间花信各自的开关播放。'));
  return view;
}

function thumbnail(media) {
  if (!media || ['html', 'css'].includes(media.kind)) {
    const text = element('span', 'gift-effect-thumb gift-effect-thumb-text', media?.kind === 'css' ? 'CSS' : 'HTML');
    text.setAttribute('aria-hidden', 'true');
    return text;
  }
  const node = element(media.kind === 'video' ? 'video' : 'img', 'gift-effect-thumb');
  node.src = media.src;
  if (node.tagName === 'VIDEO') { node.muted = true; node.preload = 'metadata'; node.setAttribute('aria-hidden', 'true'); }
  else { node.alt = ''; node.loading = 'lazy'; }
  return node;
}

function tagFor(style, media) {
  if (style.type === 'browser') return '网页';
  if (media?.kind === 'css') return 'CSS 外观';
  return media?.kind === 'video' ? '视频' : '图片';
}

function describe(style, media) {
  if (style.type === 'browser') return '导入的网页样式。';
  if (media?.kind === 'css') return '导入的 CSS 外观。';
  const subject = media?.kind === 'video' ? '播放导入的视频' : '显示导入的图片';
  return style.config.mediaStyle?.showText === false ? `${subject}。` : `${subject}，并叠加观众、礼物和数量。`;
}

function mountTrigger(view, head, fields, actions) {
  const name = view.style.name;
  const switchLabel = element('label', 'gift-frame-switch switch-control gift-effect-switch');
  const enabled = element('input'); enabled.type = 'checkbox'; enabled.setAttribute('aria-label', `启用${name}`);
  switchLabel.append(enabled, element('span', 'switch-track'), element('span', '', '启用'));
  head.append(switchLabel);

  const thresholdLabel = element('label', 'gift-effect-field');
  const thresholdTitle = element('span', 'gift-effect-field-label', '触发金额 ');
  const help = element('lira-help', '', '按单次结算的礼物总额判断，包含此金额；0 表示所有付费礼物。各效果分别判断。');
  thresholdTitle.append(help);
  const thresholdControl = element('span', 'gift-effect-field-control');
  const threshold = element('input'); threshold.type = 'number'; threshold.min = '0'; threshold.step = '0.01'; threshold.inputMode = 'decimal';
  thresholdControl.append(threshold, element('span', 'gift-effect-unit', '元及以上'));
  thresholdLabel.append(thresholdTitle, thresholdControl);

  const sample = element('div', 'gift-effect-sample'); sample.setAttribute('role', 'group'); sample.setAttribute('aria-label', '预览示例');
  const sampleTitle = element('span', 'gift-effect-sample-label', '预览示例 ');
  sampleTitle.append(element('lira-help', '', '只用于「在画布中预览」，不会保存。'));
  const sampleFields = element('div', 'gift-effect-sample-fields');
  const user = sampleInput(sampleFields, '观众', 'text', '观众A');
  const gift = sampleInput(sampleFields, '礼物', 'text', '礼物');
  const num = sampleInput(sampleFields, '数量', 'number', '1');
  num.min = '1'; num.step = '1'; num.className = 'gift-effect-sample-count';
  sample.append(sampleTitle, sampleFields);
  fields.append(thresholdLabel, sample);

  const preview = element('button', 'secondary', '在画布中预览'); preview.type = 'button';
  const save = element('button', 'primary', '保存设置'); save.type = 'button';
  actions.append(preview, save);
  view.trigger = { enabled, threshold, save, preview, sample: { user, gift, num }, dirty: false, saving: false };
  const edit = () => { refreshDirty(view); showStatus(view); };
  enabled.addEventListener('change', edit);
  threshold.addEventListener('input', edit);
  save.addEventListener('click', () => { void saveTrigger(view); });
  preview.addEventListener('click', () => { void previewStyle(view); });
  syncTrigger(view);
}

function sampleInput(host, label, type, value) {
  const field = element('label', 'gift-effect-field');
  const input = element('input'); input.type = type; input.value = value;
  if (type === 'text') input.maxLength = 80;
  field.append(element('span', 'gift-effect-field-label', label), input);
  host.append(field);
  return input;
}

function savedTrigger(view) {
  return readGiftFrameStyleTrigger(settings, view.style.id);
}

function refreshDirty(view) {
  const { enabled, threshold } = view.trigger;
  const saved = savedTrigger(view);
  view.trigger.dirty = view.trigger.saving || enabled.checked !== saved.enabled
    || threshold.value.trim() === '' || Number(threshold.value) !== Number(saved.thresholdRmb);
  enabled.dataset.dirty = threshold.dataset.dirty = String(view.trigger.dirty);
}

// Settings pushes refresh untouched cards; drafts stay until saved.
function syncTrigger(view) {
  const { trigger } = view;
  if (!trigger.dirty) {
    const saved = savedTrigger(view);
    trigger.enabled.checked = saved.enabled;
    trigger.threshold.value = saved.thresholdRmb;
  }
  refreshDirty(view);
  if (view.status.dataset.state === 'pending' || !view.status.dataset.state) showStatus(view);
}

function showStatus(view, message = '', state = '') {
  const pending = view.trigger?.dirty && !view.trigger.saving;
  view.status.textContent = message || (pending ? PENDING : '');
  view.status.dataset.state = state || (pending ? 'pending' : '');
}

function saveTrigger(view) {
  const { trigger } = view;
  if (trigger.saving) return saveQueue;
  const amount = Number(trigger.threshold.value);
  if (trigger.threshold.value.trim() === '' || !Number.isFinite(amount) || amount < 0) {
    showStatus(view, '金额必须是大于等于 0 的数字。', 'error');
    return saveQueue;
  }
  const submitted = { enabled: trigger.enabled.checked, thresholdRmb: amount.toFixed(2) };
  trigger.saving = true; trigger.save.disabled = true;
  showStatus(view, '正在保存…');
  // One serialized writer: each save builds the whole map from the latest saved state.
  saveQueue = saveQueue.then(async () => {
    try {
      const value = writeGiftFrameStyleTrigger(settings, knownIds, view.style.id, submitted);
      await api('/api/settings', { [GIFT_FRAME_STYLE_TRIGGERS_KEY]: value }, { notifyError: false });
      settings = { ...settings, [GIFT_FRAME_STYLE_TRIGGERS_KEY]: value };
      trigger.saving = false;
      refreshDirty(view);
      showStatus(view, trigger.dirty ? '设置已保存，刚才的新修改还没保存。' : '设置已保存。', 'success');
    } catch (error) {
      trigger.saving = false;
      refreshDirty(view);
      const message = error.message || '设置没保存成功，修改还在，请再试一次。';
      showStatus(view, message, 'error');
      toast(message, { type: 'error' });
    } finally {
      trigger.save.disabled = false;
    }
  });
  return saveQueue;
}

async function previewStyle(view) {
  const { trigger } = view;
  const num = Number(trigger.sample.num.value);
  if (!Number.isSafeInteger(num) || num <= 0) {
    showStatus(view, '预览数量必须是正整数。', 'error');
    return;
  }
  const base = sceneExtraPreviewData('gift-frame');
  const event = { ...base.events[0], num,
    userName: trigger.sample.user.value.trim() || base.events[0].userName,
    giftName: trigger.sample.gift.value.trim() || base.events[0].giftName };
  trigger.preview.disabled = true;
  try {
    await view.use(view.style, { previewData: { ...base, events: [event] }, reuseExisting: true });
    showStatus(view);
  } catch (error) {
    showStatus(view, error.message || '无法打开预览，请重试。', 'error');
  } finally {
    trigger.preview.disabled = false;
  }
}
