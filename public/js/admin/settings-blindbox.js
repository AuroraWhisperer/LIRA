'use strict';

import { showFieldError } from '../shared/field-feedback.js';
import { openComponentPreview } from './component-preview-dialog.js';
import { SCENE_EXTRA_COMPONENTS } from '../shared/scene-extra-components.js';

const OVERLAY_FIELDS = ['blindboxOverlayTitle', 'blindboxOverlayTop', 'blindboxWinnersOnly', 'blindboxHeartBoxOnly',
  'blindboxCastleMultiplier', 'blindboxCastlesRemaining', 'blindboxShowCastlesRemaining', 'blindboxShowOpenedSinceCastle'];
const APPEARANCE_FIELDS = { compact: 'blindboxCompact', noScroll: 'blindboxAutoPages',
  overlayFontFamily: 'overlayFontFamily', overlayFontWeight: 'overlayFontWeight', themeFontScale: 'themeFontScale',
  themeBackground: 'themeBackground', themeOpacity: 'themeOpacity', themeText: 'themeText',
  themePrimary: 'themePrimary', themeAccent: 'themeAccent' };

function parseBlindboxConfig(textarea) {
  const raw = (textarea.value || '').trim();
  if (!raw) return [];
  try {
    const config = JSON.parse(raw);
    return Array.isArray(config) ? config : [];
  } catch (error) {
    void error;
    return [];
  }
}

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
  navigatorRef,
  promptRef,
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

  function mountAppearanceFields() {
    const host = documentRef.getElementById('blindboxAppearanceFields');
    for (const [key, setting] of Object.entries(APPEARANCE_FIELDS)) {
      const field = SCENE_EXTRA_COMPONENTS.blindbox.fields[key];
      const label = documentRef.createElement('label');
      const name = documentRef.createElement('span');
      name.textContent = field.label;
      const input = documentRef.createElement(field.type === 'select' ? 'select' : 'input');
      input.id = `blindboxAppearance-${key}`;
      if (field.type === 'select') {
        for (const [value, text] of Object.entries(field.options)) {
          const option = documentRef.createElement('option');
          option.value = value; option.textContent = text; input.append(option);
        }
      } else input.type = field.type;
      if (field.type === 'number') {
        input.min = field.min; input.max = field.max; input.step = field.step; input.required = true;
      }
      if (field.maxLength) input.maxLength = field.maxLength;
      if (field.type === 'checkbox') {
        label.className = 'blindbox-appearance-toggle';
        label.append(input, name);
      } else label.append(name, input);
      host.append(label);
      overlayFields.push([input.id, setting]);
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

  function updateHeartBoxSettings() {
    const settings = documentRef.getElementById('blindboxHeartBoxSettings');
    if (settings) settings.hidden = !documentRef.getElementById('blindboxHeartBoxOnly').checked;
    const remaining = documentRef.getElementById('blindboxCastlesRemaining');
    if (remaining) remaining.disabled = !documentRef.getElementById('blindboxShowCastlesRemaining').checked;
  }

  function init() {
    mountAppearanceFields();
    documentRef.getElementById('blindBoxAddBtn').addEventListener('click', async () => {
      const giftId = (value('blindBoxGiftId') || '').trim();
      const name = (value('blindBoxName') || '').trim();
      const price = parseFloat(value('blindBoxPrice'));
      const outputsRaw = (value('blindBoxOutputs') || '').trim();
      if (!name) return invalid('blindBoxName', '请输入盲盒名');
      if (isNaN(price) || price <= 0) return invalid('blindBoxPrice', '请输入有效成本');
      if (giftId && !/^[1-9]\d{0,19}$/u.test(giftId)) return invalid('blindBoxGiftId', '请输入有效盲盒 ID');
      if (!outputsRaw) return invalid('blindBoxOutputs', '请输入可能开出的礼物');

      const outputs = parseBlindboxOutputs(outputsRaw);
      if (!outputs?.length) return invalid('blindBoxOutputs', '请按“产物 ID:名称:价格”填写礼物');

      const textarea = documentRef.getElementById('giftBlindBoxCustomConfigV2');
      const config = parseBlindboxConfig(textarea);
      config.push({ giftId: giftId || null, name, price, outputs });
      const newRaw = JSON.stringify(config, null, 2);
      textarea.value = newRaw;
      textarea.dataset.dirty = 'true';
      await saveSettings({ giftBlindBoxCustomConfigV2: newRaw });
      textarea.dataset.dirty = 'false';
      toast(`已保存盲盒「${name}」，等待服务器确认`);
      documentRef.getElementById('blindBoxGiftId').value = '';
      documentRef.getElementById('blindBoxName').value = '';
      documentRef.getElementById('blindBoxPrice').value = '';
      documentRef.getElementById('blindBoxOutputs').value = '';
      renderBlindboxList();
    });

    documentRef.getElementById('blindBoxList').addEventListener('click', async (event) => {
      const btn = event.target.closest('.chip-delete');
      if (!btn) return;
      const index = parseInt(btn.dataset.blindIndex, 10);
      if (isNaN(index)) return;
      const textarea = documentRef.getElementById('giftBlindBoxCustomConfigV2');
      const config = parseBlindboxConfig(textarea);
      if (index < 0 || index >= config.length) return;
      config.splice(index, 1);
      const newRaw = JSON.stringify(config, null, 2);
      textarea.value = newRaw;
      textarea.dataset.dirty = 'true';
      await saveSettings({ giftBlindBoxCustomConfigV2: newRaw });
      textarea.dataset.dirty = 'false';
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
      const button = documentRef.getElementById('blindBoxAdvancedToggle');
      advanced.hidden = !advanced.hidden;
      button.textContent = advanced.hidden ? '高级 ▾' : '高级 ▴';
    });

    documentRef.getElementById('giftBlindBoxSaveBtn').addEventListener('click', async () => {
      const textarea = documentRef.getElementById('giftBlindBoxCustomConfigV2');
      if (!textarea.value.trim() && textarea.dataset.dirty !== 'true') {
        toast('暂无自定义配置，可在上方添加盲盒');
        return;
      }
      let raw = textarea.value.trim() || '[]';
      try {
        const parsed = JSON.parse(raw);
        if (!Array.isArray(parsed)) throw new Error('配置必须是 JSON 数组');
        raw = JSON.stringify(parsed);
      } catch (error) {
        invalid('giftBlindBoxCustomConfigV2', '盲盒配置 JSON 格式错误：' + error.message);
        return;
      }
      textarea.dataset.dirty = 'true';
      await saveSettings({ giftBlindBoxCustomConfigV2: raw });
      textarea.dataset.dirty = 'false';
      toast('自定义盲盒已保存，等待服务器确认');
      renderBlindboxList();
      await getState()?.reloadState?.();
    });

    for (const [id, setting] of overlayFields) {
      const element = documentRef.getElementById(id);
      if (!element) continue;
      element.addEventListener('input', updateOverlayUrl);
      element.addEventListener('change', () => {
        updateOverlayUrl();
        updateHeartBoxSettings();
        if (!element.checkValidity()) { element.reportValidity(); return; }
        saveSettings({ [setting]: element.type === 'checkbox' ? String(element.checked) : element.value.trim() }).catch(() => {});
      });
    }

    documentRef.getElementById('blindboxOverlayUrl').addEventListener('click', async () => {
      const url = buildOverlayUrl();
      try {
        await navigatorRef.clipboard.writeText(url);
        toast('投屏地址已复制');
      } catch (error) {
        void error;
        promptRef('复制以下地址：', url);
      }
    });

    documentRef.getElementById('blindboxPreviewBtn').addEventListener('click', () => {
      openComponentPreview({ id: 'blindbox' });
    });

    updateOverlayUrl();
    const receiveAppearance = settings => {
      for (const [id, setting] of overlayFields) {
        const input = documentRef.getElementById(id);
        if (!input || settings?.[setting] === undefined || documentRef.activeElement === input) continue;
        if (input.type === 'checkbox') input.checked = settings[setting] === 'true';
        else input.value = settings[setting];
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
