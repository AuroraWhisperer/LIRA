// 组件 → 礼物姬：各全屏礼物感谢特效独立的持久化设置与预览。
'use strict';

import { api, toast } from '../shared/utils.js';
import { openComponentPreview } from './component-preview-dialog.js';
import { sceneExtraPreviewData } from './scene-extra-preview-data.js';
import { requestComponentStyles } from './component-style-api.js';

const MISSING_STYLE_MESSAGE = '请先在本页最下方「＋ 添加样式」导入林间花信样式包。';
const WOODLAND_PACKAGE = 'lira.woodland-gift-frame';
const isWoodlandStyle = style => style.config.resourceStyle?.preset === 'woodland-gift-frame';

// 每个特效自成一组：设置键、控件 id 和预览输入都只属于自己。
const EFFECTS = [
  {
    label: '林间花信',
    themeId: 'woodland-bloom',
    enabledKey: 'giftFrameEnabled',
    thresholdKey: 'giftFrameThresholdRmb',
    fallback: '20',
    ids: {
      enabled: 'giftFrameEnabled',
      threshold: 'giftFrameThresholdRmb',
      save: 'giftFrameSaveBtn',
      status: 'giftFrameSaveState',
      previewUser: 'giftFramePreviewUser',
      previewGift: 'giftFramePreviewGift',
      previewNum: 'giftFramePreviewNum',
      previewBtn: 'giftFramePreviewBtn',
    },
  },
];

let initialized = false;
let currentSettings = {};
// 林间花信只在导入后显示；已开启但样式库中没有时仍显示，便于关闭。
let woodland = { checked: false, installed: false, failed: false };
const draftFields = new Set();
const savingFields = new Set();
const settingIds = EFFECTS.flatMap((effect) => [effect.enabledKey, effect.thresholdKey]);

export function initGiftFrame() {
  if (initialized) return;
  const root = document.getElementById('otherGiftFeature');
  const enabled = document.getElementById('giftFrameEnabled');
  if (!root || !enabled) return;
  const markDraft = (event) => {
    if (settingIds.includes(event.target.id)) {
      const effect = EFFECTS.find(effect => [effect.enabledKey, effect.thresholdKey].includes(event.target.id));
      syncDraftField(event.target, effect);
      setStatus(effect.ids.status, '', '');
    }
  };
  for (const id of settingIds) document.getElementById(id).dataset.preserveDirty = 'true';
  root.addEventListener('input', markDraft);
  root.addEventListener('change', markDraft);

  for (const effect of EFFECTS) {
    document.getElementById(effect.ids.save).addEventListener('click', () => saveSettings(effect));
    document.getElementById(effect.ids.previewBtn).addEventListener('click', () => playPreview(effect));
  }
  window.addEventListener('app:settings-state', (event) => renderGiftFrame(event.detail || {}));
  window.addEventListener('component-styles:changed', () => {
    const status = document.getElementById('giftFrameSaveState');
    if (status.textContent.startsWith(MISSING_STYLE_MESSAGE)) setStatus(status.id, '', '');
  });
  initialized = true;
  renderGiftFrame(currentSettings);
}

export function renderGiftFrameStyleState(packs) {
  const pack = packs?.find(item => item.packageId === WOODLAND_PACKAGE && item.styles.some(isWoodlandStyle));
  woodland = { checked: Boolean(packs), installed: Boolean(pack), failed: !packs };
  const thumb = document.getElementById('giftFrameThumb');
  const icon = document.getElementById('giftFrameIcon');
  const tag = document.getElementById('giftFrameTag');
  if (thumb && icon && tag) {
    const preview = pack?.styles.find(isWoodlandStyle).config.resourceStyle.preview;
    if (preview) thumb.src = preview; else thumb.removeAttribute('src');
    thumb.hidden = !preview; icon.hidden = Boolean(preview);
    tag.textContent = pack?.version ? `样式包 ${pack.version}` : '样式包';
  }
  syncWoodlandCard();
}

function syncWoodlandCard() {
  const card = document.getElementById('giftFrameSettings');
  const notice = document.getElementById('giftFrameStyleState');
  // Visibility follows the style library; until it answers, keep the page's initial state.
  if (!card || !notice || !woodland.checked && !woodland.failed) return;
  card.hidden = !woodland.installed && currentSettings.giftFrameEnabled !== 'true';
  notice.hidden = card.hidden || woodland.installed;
  notice.textContent = notice.hidden ? '' : woodland.failed
    ? '样式库暂未读取成功；使用前请确认已导入林间花信样式包。'
    : '样式库中没有林间花信。画布里已有的林间花信图层仍按这里的设置播放；不再需要时请关闭并保存，或在下方「＋ 添加样式」重新导入。';
}

export function renderGiftFrame(settings = {}) {
  currentSettings = settings;
  if (!document.getElementById('giftFrameEnabled')) return;
  for (const effect of EFFECTS) {
    const { enabled, threshold } = effect.ids;
    if (!draftFields.has(effect.enabledKey)) {
      document.getElementById(enabled).checked = settings[effect.enabledKey] === 'true';
    }
    if (!draftFields.has(effect.thresholdKey)) {
      document.getElementById(threshold).value = settings[effect.thresholdKey] || effect.fallback;
    }
    for (const id of [enabled, threshold]) syncDraftField(document.getElementById(id), effect);
    if (document.getElementById(effect.ids.status).dataset.state === 'pending') setStatus(effect.ids.status, '', '');
  }
  syncWoodlandCard();
}

function syncDraftField(node, effect) {
  const same = node.id === effect.enabledKey ? node.checked === (currentSettings[node.id] === 'true')
    : node.value.trim() !== '' && Number(node.value) === Number(currentSettings[node.id] || effect.fallback);
  const dirty = savingFields.has(node.id) || !same;
  if (dirty) draftFields.add(node.id); else draftFields.delete(node.id);
  node.dataset.dirty = String(dirty);
}

async function saveSettings(effect) {
  if (savingFields.has(effect.enabledKey)) return;
  const { enabled, threshold, status } = effect.ids;
  const amount = Number(document.getElementById(threshold).value);
  if (!Number.isFinite(amount) || amount < 0) {
    setStatus(status, '金额必须是大于等于 0 的数字。', 'error');
    return;
  }
  const submitted = {
    [effect.enabledKey]: String(document.getElementById(enabled).checked),
    [effect.thresholdKey]: document.getElementById(threshold).value,
  };
  const values = { ...submitted, [effect.thresholdKey]: amount.toFixed(2) };
  for (const key of Object.keys(submitted)) savingFields.add(key);
  document.getElementById(effect.ids.save).disabled = true;
  try {
    await api('/api/settings', values, { notifyError: false });
    currentSettings = { ...currentSettings, ...values };
    for (const key of Object.keys(submitted)) {
      savingFields.delete(key);
      syncDraftField(document.getElementById(key), effect);
    }
    renderGiftFrame(currentSettings);
    const message = draftFields.size
      ? `${effect.label}设置已保存，刚才的新修改还没保存。`
      : `${effect.label}设置已保存。`;
    setStatus(status, message, 'success');
    if (draftFields.size) toast(message, { type: 'success' });
  } catch (_) {
    const message = `${effect.label}设置没保存成功，修改还在，请再试一次。`;
    setStatus(status, message, 'error');
    toast(message, { type: 'error' });
  } finally {
    document.getElementById(effect.ids.save).disabled = false;
    for (const key of Object.keys(submitted)) {
      savingFields.delete(key);
      syncDraftField(document.getElementById(key), effect);
    }
  }
}

async function playPreview(effect) {
  const { previewUser, previewGift, previewNum, status } = effect.ids;
  const num = Number(document.getElementById(previewNum).value);
  if (!Number.isSafeInteger(num) || num <= 0) {
    setStatus(status, '预览数量必须是正整数。', 'error');
    return;
  }
  try {
    const packs = await requestComponentStyles('list');
    if (!packs.some(pack => pack.packageId === 'lira.woodland-gift-frame'
      && pack.styles.some(style => style.config.resourceStyle?.preset === 'woodland-gift-frame'))) {
      setStatus(status, MISSING_STYLE_MESSAGE, 'error');
      return;
    }
  } catch (error) {
    setStatus(status, error.message || '样式库读取失败，请重试。', 'error');
    return;
  }
  const base = sceneExtraPreviewData('gift-frame');
  const event = { ...base.events[0], themeId: effect.themeId };
  event.userName = document.getElementById(previewUser).value.trim() || event.userName;
  event.giftName = document.getElementById(previewGift).value.trim() || event.giftName;
  event.num = num;
  const previewData = { ...base, events: [event] };
  setStatus(status, '', '');
  openComponentPreview({ id: 'gift-frame', previewData });
}

function setStatus(id, message, state) {
  const node = document.getElementById(id);
  if (!node) return;
  const dirty = draftFields.size > 0;
  node.textContent = dirty && !message.includes('保存')
    ? `${message}${message ? ' ' : ''}有未保存修改，点击“保存设置”后生效。` : message;
  node.dataset.state = state || (dirty ? 'pending' : '');
}
