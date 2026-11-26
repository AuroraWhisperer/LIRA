'use strict';

import { showFieldError } from '../shared/field-feedback.js';
import { renderSaveStatus } from '../shared/save-status.js';
import { openComponentPreview } from './component-preview-dialog.js';
import { SCENE_EXTRA_COMPONENTS } from '../shared/scene-extra-components.js';
import { showConfirmationDialog } from '../shared/confirmation-dialog.js';
import { bindCopyUrl } from '../shared/copy-url.js';

const OVERLAY_FIELDS = ['blindboxOverlayTitle', 'blindboxOverlayTop', 'blindboxWinnersOnly', 'blindboxHeartBoxOnly',
  'blindboxCastleMultiplier', 'blindboxCastlesRemaining', 'blindboxShowCastlesRemaining', 'blindboxShowOpenedSinceCastle'];
// [row title, [component field key, settings key]]. Shared typography and colors are edited on the song queue page.
const APPEARANCE_ROWS = [
  ['布局', [['compact', 'blindboxCompact'], ['noScroll', 'blindboxAutoPages']]],
];

function parseBlindboxOutputs(value) {
  const outputs = String(value || '')
    .split(/[,，]/u)
    .map((item) => item.trim())
    .filter(Boolean)
    .map((item) => {
      const parts = item.split(':').map((part) => part.trim());
      const giftId = parts.shift() || '';
      const name = parts.shift() || '';
      const priceText = parts.join(':');
      if (!/^[1-9]\d{0,19}$/u.test(giftId) || !name) return null;
      const price = priceText === '' ? null : Number(priceText);
      if (price !== null && (!Number.isFinite(price) || price <= 0)) return null;
      return {
        giftId,
        name,
        ...(price === null ? {} : { price }),
      };
    });
  return outputs.some((output) => !output) ? null : outputs;
}

export function createBlindboxSettings({
  documentRef,
  locationRef,
  value,
  toast,
  saveSettings,
  getGifts,
  getState,
  localOverlayOrigin,
}) {
  const invalid = (id, message) => showFieldError(documentRef.getElementById(id), message, documentRef);
  const overlayFields = OVERLAY_FIELDS.map(key => [key, key]);
  let pendingConfigWrite;
  let unsavedAddition;

  function mountAppearanceFields() {
    const host = documentRef.getElementById('blindboxAppearanceFields');
    const create = (tag, className, text) => {
      const node = documentRef.createElement(tag);
      if (className) node.className = className;
      if (text) node.textContent = text;
      return node;
    };
    for (const [rowTitle, fields] of APPEARANCE_ROWS) {
      const row = create('div', 'blindbox-appearance-row');
      const grid = create('div', 'blindbox-appearance-grid');
      row.append(create('span', 'blindbox-row-title', rowTitle), grid);
      for (const [key, setting, labelText] of fields) {
        const field = SCENE_EXTRA_COMPONENTS.blindbox.fields[key];
        const label = create('label');
        const name = create('span', '', labelText || field.label);
        const input = create('input');
        input.id = `blindboxAppearance-${key}`;
        input.type = field.type;
        if (field.type === 'checkbox') {
          label.className = 'switch-control';
          input.setAttribute('role', 'switch');
          const track = create('span', 'switch-track');
          track.setAttribute('aria-hidden', 'true');
          label.append(input, track, name);
        } else label.append(name, input);
        grid.append(label);
        overlayFields.push([input.id, setting]);
      }
      host.append(row);
    }
  }

  function buildOverlayUrl() {
    return `${localOverlayOrigin(locationRef)}/blindbox`;
  }

  function updateOverlayUrl() {
    const url = buildOverlayUrl();
    const address = documentRef.getElementById('blindboxOverlayUrl');
    if (address) address.textContent = url;
  }

  function renderBlindboxList() {
    getGifts()?.renderBlindBoxList?.();
  }

  function setAdvancedOpen(open) {
    documentRef.getElementById('blindBoxAdvanced').hidden = !open;
    documentRef.getElementById('blindBoxAdvancedToggle').textContent = open ? '高级 ▴' : '高级 ▾';
  }

  function readCustomConfig(textarea) {
    try {
      const config = JSON.parse(textarea.value.trim() || '[]');
      if (!Array.isArray(config)) throw new Error('配置必须是 JSON 数组');
      return config;
    } catch (error) {
      setAdvancedOpen(true);
      invalid('giftBlindBoxCustomConfigV2', '盲盒配置 JSON 格式错误：' + error.message);
      return null;
    }
  }

  async function saveCustomConfig(textarea, raw) {
    const submitted = textarea.value;
    textarea.dataset.dirty = 'true';
    // Each request replaces the whole list, so the last submission must reach storage last.
    const write = () => saveSettings({ giftBlindBoxCustomConfigV2: raw });
    const request = pendingConfigWrite ? pendingConfigWrite.then(write, write) : write();
    pendingConfigWrite = request;
    try {
      await request;
      if (pendingConfigWrite === request && textarea.value === submitted) {
        textarea.dataset.dirty = 'false';
        unsavedAddition = null;
      }
    } finally {
      if (pendingConfigWrite === request) pendingConfigWrite = null;
    }
  }

  function updateHeartBoxSettings() {
    const settings = documentRef.getElementById('blindboxHeartBoxSettings');
    if (settings) settings.hidden = !documentRef.getElementById('blindboxHeartBoxOnly').checked;
    const remaining = documentRef.getElementById('blindboxCastlesRemaining');
    if (remaining) remaining.disabled = !documentRef.getElementById('blindboxShowCastlesRemaining').checked;
  }

  function init() {
    mountAppearanceFields();
    documentRef.getElementById('blindBoxAddBtn').addEventListener('click', async () => {
      const fields = ['blindBoxGiftId', 'blindBoxName', 'blindBoxPrice', 'blindBoxOutputs'].map(id => documentRef.getElementById(id));
      const submitted = fields.map(field => field.value);
      const [giftId, name, priceText, outputsRaw] = submitted.map(text => text.trim());
      const price = parseFloat(priceText);
      if (!name) return invalid('blindBoxName', '请输入盲盒名');
      if (isNaN(price) || price <= 0) return invalid('blindBoxPrice', '请输入有效成本');
      if (giftId && !/^[1-9]\d{0,19}$/u.test(giftId)) return invalid('blindBoxGiftId', '请输入有效盲盒 ID');
      if (!outputsRaw) return invalid('blindBoxOutputs', '请输入可能开出的礼物');

      const outputs = parseBlindboxOutputs(outputsRaw);
      if (!outputs?.length) return invalid('blindBoxOutputs', '请按「产物 ID:名称」或「产物 ID:名称:价格」填写，多个产物用逗号分隔。');

      const textarea = documentRef.getElementById('giftBlindBoxCustomConfigV2');
      const config = readCustomConfig(textarea);
      if (!config) return;
      // The form already appended this unsaved box to the JSON draft. A retry edits that row.
      const retry = unsavedAddition?.raw === textarea.value &&
        (giftId && unsavedAddition.giftId ? giftId === unsavedAddition.giftId : name === unsavedAddition.name);
      if (retry) config.pop();
      config.push({ giftId: giftId || null, name, price, outputs });
      const newRaw = JSON.stringify(config, null, 2);
      if (retry && newRaw === unsavedAddition.raw && pendingConfigWrite) return;
      unsavedAddition = { raw: newRaw, giftId, name };
      textarea.value = newRaw;
      await saveCustomConfig(textarea, newRaw);
      toast(`已保存盲盒「${name}」，等待服务器确认`);
      if (fields.every((field, index) => field.value === submitted[index])) {
        for (const field of fields) field.value = '';
      }
      renderBlindboxList();
    });

    documentRef.getElementById('blindBoxList').addEventListener('click', async (event) => {
      const btn = event.target.closest('.chip-delete');
      if (!btn) return;
      const index = parseInt(btn.dataset.blindIndex, 10);
      if (isNaN(index)) return;
      const textarea = documentRef.getElementById('giftBlindBoxCustomConfigV2');
      const config = readCustomConfig(textarea);
      if (!config) return;
      if (index < 0 || index >= config.length) return;
      const before = textarea.value;
      const confirmed = await showConfirmationDialog({
        title: `删除自定义盲盒“${config[index].name}”？`,
        description: '将删除这项手工配置并保存。已收到的礼物记录不会删除。',
        confirmLabel: '删除盲盒', variant: 'destructive',
      });
      if (!confirmed) return;
      if (textarea.value !== before) { toast('盲盒配置已变化，请核对后重新删除。'); return; }
      config.splice(index, 1);
      const newRaw = JSON.stringify(config, null, 2);
      textarea.value = newRaw;
      await saveCustomConfig(textarea, newRaw);
      toast('盲盒移除已保存，等待服务器确认');
      renderBlindboxList();
    });

    documentRef.getElementById('blindBoxListToggle')?.addEventListener('click', () => {
      const button = documentRef.getElementById('blindBoxListToggle');
      const expanded = button.getAttribute('aria-expanded') === 'true';
      button.setAttribute('aria-expanded', String(!expanded));
      renderBlindboxList();
    });

    documentRef.getElementById('blindBoxAdvancedToggle').addEventListener('click', () => {
      const advanced = documentRef.getElementById('blindBoxAdvanced');
      setAdvancedOpen(advanced.hidden);
    });

    documentRef.getElementById('giftBlindBoxSaveBtn').addEventListener('click', async () => {
      const textarea = documentRef.getElementById('giftBlindBoxCustomConfigV2');
      if (!textarea.value.trim() && textarea.dataset.dirty !== 'true') {
        toast('暂无自定义配置，可在上方添加盲盒');
        return;
      }
      const config = readCustomConfig(textarea);
      if (!config) return;
      await saveCustomConfig(textarea, JSON.stringify(config));
      toast('自定义盲盒已保存，等待服务器确认');
      renderBlindboxList();
      await getState()?.reloadState?.();
    });

    let pendingAppearanceSaves = 0;
    const failedAppearanceFields = new Set();
    for (const [id, setting] of overlayFields) {
      const element = documentRef.getElementById(id);
      if (!element) continue;
      element.addEventListener('input', updateOverlayUrl);
      element.addEventListener('change', () => {
        updateOverlayUrl();
        updateHeartBoxSettings();
        if (!element.checkValidity()) { element.reportValidity(); return; }
        const status = documentRef.getElementById('blindboxSaveState');
        pendingAppearanceSaves += 1;
        renderSaveStatus(status, 'saving');
        saveSettings({ [setting]: element.type === 'checkbox' ? String(element.checked) : element.value.trim() })
          .then(() => { failedAppearanceFields.delete(setting); })
          .catch(() => { failedAppearanceFields.add(setting); })
          .finally(() => {
            pendingAppearanceSaves -= 1;
            if (!pendingAppearanceSaves) renderSaveStatus(status, failedAppearanceFields.size ? 'error' : 'saved',
              failedAppearanceFields.size ? '部分设置保存失败，请重新修改后重试。' : undefined);
          });
      });
    }

    bindCopyUrl(documentRef.getElementById('blindboxOverlayUrl'), { onCopied: () => toast('盲盒浏览器源地址已复制') });

    documentRef.getElementById('blindboxPreviewBtn').addEventListener('click', () => {
      openComponentPreview({ id: 'blindbox' });
    });

    updateOverlayUrl();
    const receiveAppearance = settings => {
      for (const [id, setting] of overlayFields) {
        const input = documentRef.getElementById(id);
        if (!input || settings?.[setting] === undefined || documentRef.activeElement === input) continue;
        if (input.type === 'checkbox') input.checked = settings[setting] === 'true';
        else {
          input.value = settings[setting];
        }
      }
      updateHeartBoxSettings();
    };
    receiveAppearance(getState()?.getAppState?.()?.settings);
    documentRef.defaultView?.addEventListener('app:settings-state', event => receiveAppearance(event.detail));
    const customConfig = documentRef.getElementById('giftBlindBoxCustomConfigV2');
    customConfig.dataset.preserveDirty = 'true';
    customConfig.addEventListener('input', () => {
      customConfig.dataset.dirty = 'true';
      renderBlindboxList();
    });
  }

  return { buildOverlayUrl, updateOverlayUrl, init };
}
