// 百宝箱 → 礼物姬 → 大航海感谢：开关、动画文字、本地动画预览与投屏预览。
'use strict';

import { api, copyText, localOverlayOrigin, toast } from '../shared/utils.js';

const settingIds = ['guardThanksEnabled', 'guardThanksTextMode'];
const draftFields = new Set();
let initialized = false;
let currentSettings = {};
let playerPromise = null;

export function initGuardThanks() {
  if (initialized) return;
  const panel = document.getElementById('guardThanksPanel');
  if (!panel) return;
  initialized = true;
  const markDraft = (event) => {
    if (!settingIds.includes(event.target.id)) return;
    draftFields.add(event.target.id);
    event.target.dataset.dirty = 'true';
  };
  for (const id of settingIds) document.getElementById(id).dataset.preserveDirty = 'true';
  panel.addEventListener('input', markDraft);
  panel.addEventListener('change', markDraft);

  const overlayUrl = `${localOverlayOrigin(location)}/gift-effects`;
  document.getElementById('guardThanksOverlayUrl').textContent = overlayUrl;
  document.getElementById('guardThanksSaveBtn').addEventListener('click', saveSettings);
  document.getElementById('guardThanksPlayBtn').addEventListener('click', playLocalPreview);
  document.getElementById('guardThanksSendBtn').addEventListener('click', sendOverlayPreview);
  document.getElementById('guardThanksTextMode').addEventListener('change', playLocalPreview);
  for (const input of panel.querySelectorAll('input[name="guardThanksPreviewTier"]')) {
    input.addEventListener('change', playLocalPreview);
  }
  document.getElementById('guardThanksCopyBtn').addEventListener('click', async () => {
    await copyText(overlayUrl);
    toast('礼物特效地址已复制');
  });
  document.getElementById('guardThanksOpenBtn').addEventListener('click', () => {
    const query = new URLSearchParams({
      preview: '1',
      debug: '1',
      guardPreview: selectedTier(),
      guardText: document.getElementById('guardThanksTextMode').value,
      guardName: previewUserName(),
      guardMonths: String(previewMonths() || 1),
    });
    window.open(`${overlayUrl}?${query}`, 'liraGuardThanksPreview');
  });
  // 离开页签或礼物姬时停止本地预览，不在隐藏区域里继续绘制。
  const stopHiddenPreview = () => {
    if (panel.closest('[hidden]')) playerPromise?.then((player) => player.stop());
  };
  const visibility = new MutationObserver(stopHiddenPreview);
  for (const node of [panel, document.getElementById('otherGiftFeature')].filter(Boolean)) {
    visibility.observe(node, { attributes: true, attributeFilter: ['hidden'] });
  }
  window.addEventListener('app:settings-state', (event) => renderGuardThanks(event.detail || {}));
  renderGuardThanks(currentSettings);
}

export function renderGuardThanks(settings = {}) {
  currentSettings = settings;
  const enabled = document.getElementById('guardThanksEnabled');
  if (!enabled) return;
  if (!draftFields.has('guardThanksEnabled')) enabled.checked = settings.guardThanksEnabled === 'true';
  if (!draftFields.has('guardThanksTextMode')) {
    document.getElementById('guardThanksTextMode').value = settings.guardThanksTextMode || 'bilingual';
  }
  const state = document.getElementById('guardThanksSettingsState');
  state.textContent = enabled.checked ? '已启用' : '未启用';
  state.dataset.state = enabled.checked ? 'enabled' : 'disabled';
}

function selectedTier() {
  return document.querySelector('input[name="guardThanksPreviewTier"]:checked')?.value || 'captain';
}

function previewUserName() {
  return document.getElementById('guardThanksPreviewUser').value.trim() || '观众A';
}

function previewMonths() {
  const months = Number(document.getElementById('guardThanksPreviewMonths').value);
  return Number.isSafeInteger(months) && months >= 1 && months <= 999 ? months : 0;
}

function previewPayload() {
  return {
    tier: selectedTier(),
    userName: previewUserName(),
    months: previewMonths(),
    textMode: document.getElementById('guardThanksTextMode').value,
  };
}

async function playLocalPreview() {
  const payload = previewPayload();
  if (!payload.months) {
    setStatus('预览月数需为 1–999 的整数。', 'error');
    return;
  }
  playerPromise ||= import('../shared/guard-thanks-card.js').then(({ createGuardThanksPlayer }) =>
    createGuardThanksPlayer({ root: document.getElementById('guardThanksPreviewStage') }),
  );
  const player = await playerPromise;
  void player.play({ ...payload, preview: true });
}

async function sendOverlayPreview() {
  try {
    await api('/api/gifts/guard-thanks/preview', previewPayload(), { notifyError: false });
    setStatus('预览已发送到礼物特效地址。', 'success');
  } catch (error) {
    setStatus(error.status === 400 ? error.message : '预览发送失败，请确认投屏页面已打开。', 'error');
  }
}

async function saveSettings() {
  const submitted = {
    guardThanksEnabled: String(document.getElementById('guardThanksEnabled').checked),
    guardThanksTextMode: document.getElementById('guardThanksTextMode').value,
  };
  try {
    await api('/api/settings', submitted);
    for (const id of settingIds) {
      const node = document.getElementById(id);
      const current = id === 'guardThanksEnabled' ? String(node.checked) : node.value;
      if (current === submitted[id]) {
        draftFields.delete(id);
        node.dataset.dirty = 'false';
      }
    }
    setStatus(
      submitted.guardThanksEnabled === 'true' ? '已保存，之后开通的大航海会播放感谢动画。' : '已保存，大航海感谢已关闭。',
      'success',
    );
    renderGuardThanks({ ...currentSettings, ...submitted });
  } catch (_) {
    setStatus('保存失败，请稍后重试。', 'error');
  }
}

function setStatus(message, state) {
  const node = document.getElementById('guardThanksSaveState');
  node.textContent = message;
  node.dataset.state = state;
}
