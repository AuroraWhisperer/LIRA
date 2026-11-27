'use strict';

import { showFieldError } from '../shared/field-feedback.js';
import { renderSaveStatus } from '../shared/save-status.js';
import { openComponentPreview } from './component-preview-dialog.js';
import { SCENE_EXTRA_COMPONENTS } from '../shared/scene-extra-components.js';
import { showConfirmationDialog } from '../shared/confirmation-dialog.js';
import { bindCopyUrl } from '../shared/copy-url.js';
import { eventBus, Events } from '../shared/event-bus.js';
import { parseHexColor } from '../shared/color-value.js';
import { formatMoney } from '../shared/display-format.js';
import { BLINDBOX_STYLES, DEFAULT_BLINDBOX_STYLE, normalizeBlindboxStyle } from '../shared/blindbox-styles.js';

const OVERLAY_FIELDS = ['blindboxOverlayTitle', 'blindboxOverlayTop', 'blindboxWinnersOnly', 'blindboxHeartBoxOnly',
  'blindboxCastleMultiplier', 'blindboxCastlesRemaining', 'blindboxShowCastlesRemaining', 'blindboxShowOpenedSinceCastle'];
// [row title, [component field key, settings key]]. Shared typography and colors are edited on the song queue page.
const APPEARANCE_ROWS = [
  ['布局', [['compact', 'blindboxCompact'], ['noScroll', 'blindboxAutoPages']]],
];

const SAMPLE_PREVIEW_STATS = Object.freeze({
  summary: { boxCount: 22, totalCost: 320, totalValue: 2553.5, totalProfit: 2233.5 },
  heartBoxProgress: { openedSinceCastle: 7 },
  perUser: [
    { userName: '心动测试', boxCount: 16, totalProfit: 2153 },
    { userName: '雾岛听雨', boxCount: 4, totalProfit: 96.5 },
    { userName: '星川折纸', boxCount: 1, totalProfit: 14 },
    { userName: '晚风不归', boxCount: 1, totalProfit: -30 },
  ],
});

function formatBlindboxAmount(value) {
  const number = Number(value);
  return Number.isFinite(number) ? number.toFixed(2) : '0.00';
}

function formatSignedProfit(value) {
  const number = Number(value);
  if (!Number.isFinite(number) || number === 0) return '¥0.00';
  return `${number > 0 ? '+' : '-'}¥${Math.abs(number).toFixed(2)}`;
}

function resolveBackgroundCss(hex, opacity) {
  const parsed = parseHexColor(hex || '#181823');
  const raw = opacity === '' || opacity === null || opacity === undefined ? 0.76 : Number(opacity);
  const alpha = Number.isFinite(raw) ? Math.max(0, Math.min(1, raw)) : 0.76;
  if (!parsed) return `rgba(24, 24, 35, ${alpha})`;
  return `rgba(${parsed.r}, ${parsed.g}, ${parsed.b}, ${(parsed.alpha * alpha).toFixed(3)})`;
}

function buildBlindboxStyleThumb(createEl, styleId) {
  const thumb = createEl('span', 'blindbox-style-thumb');
  if (thumb.dataset) thumb.dataset.thumb = styleId;
  thumb.setAttribute?.('aria-hidden', 'true');
  if (styleId === 'porcelain') {
    const split = createEl('span', 'bb-th-split');
    const left = createEl('span', 'bb-th-left');
    left.append(createEl('span', 'bb-th-line'), createEl('span', 'bb-th-kpi'), createEl('span', 'bb-th-sub'));
    const right = createEl('span', 'bb-th-right');
    for (let i = 0; i < 3; i += 1) {
      const row = createEl('span', 'bb-th-row');
      row.append(createEl('span', 'bb-th-dot'), createEl('span', 'bb-th-bar'));
      right.append(row);
    }
    split.append(left, right);
    thumb.append(split);
    return thumb;
  }
  if (styleId === 'layers') {
    const top = createEl('span', 'bb-th-top');
    top.append(createEl('span', 'bb-th-slab-title'), createEl('span', 'bb-th-slab-kpi'));
    const slabs = createEl('span', 'bb-th-slabs');
    for (let i = 0; i < 3; i += 1) {
      const slab = createEl('span', 'bb-th-slab');
      slab.append(createEl('span', 'bb-th-dot'), createEl('span', 'bb-th-bar'));
      slabs.append(slab);
    }
    thumb.append(top, slabs);
    return thumb;
  }
  const head = createEl('span', 'bb-th-head');
  head.append(createEl('span', 'bb-th-line'), createEl('span', 'bb-th-kpi'));
  if (styleId === 'podium') {
    const seats = createEl('span', 'bb-th-seats');
    for (let i = 0; i < 3; i += 1) {
      const seat = createEl('span', 'bb-th-seat');
      seat.append(createEl('span', 'bb-th-seat-rank'), createEl('span', 'bb-th-bar'));
      seats.append(seat);
    }
    thumb.append(head, seats);
    return thumb;
  }
  const rows = createEl('span', 'bb-th-rows');
  const badgeClass = styleId === 'prism' ? 'bb-th-ring' : 'bb-th-dot';
  for (let i = 0; i < 3; i += 1) {
    const row = createEl('span', 'bb-th-row');
    row.append(createEl('span', badgeClass), createEl('span', 'bb-th-bar'));
    rows.append(row);
  }
  thumb.append(head, rows);
  return thumb;
}

function describeTopLimit(raw) {
  const value = Number.parseInt(String(raw ?? ''), 10);
  if (value === 0) return '仅显示汇总';
  if (value === -1) return '不限人数';
  if (Number.isFinite(value) && value > 0) return `最多 ${value} 人`;
  return '最多 3 人';
}

function parseBlindboxOutputToken(raw) {
  const parts = raw.split(/[:：]/u).map((part) => part.trim());
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
}

function inspectBlindboxOutputs(value) {
  return String(value || '')
    .split(/[,，]/u)
    .map((item) => item.trim())
    .filter(Boolean)
    .map((raw) => ({ raw, parsed: parseBlindboxOutputToken(raw) }));
}

function parseBlindboxOutputs(value) {
  const items = inspectBlindboxOutputs(value);
  return items.some((item) => !item.parsed) ? null : items.map((item) => item.parsed);
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

  function ensureMappingPanelExpanded() {
    const panel = documentRef.querySelector?.('.gift-blindbox-mapping-panel');
    if (!panel?.classList?.contains('is-collapsed')) return;
    panel.classList.remove('is-collapsed');
    const collapsible = documentRef.getElementById('blindBoxMappingCollapsible');
    if (collapsible) {
      collapsible.inert = false;
      collapsible.setAttribute?.('aria-hidden', 'false');
    }
    const toggle = documentRef.getElementById('blindBoxMappingToggle');
    if (toggle) {
      toggle.setAttribute?.('aria-expanded', 'true');
      toggle.title = '折叠盲盒设置';
    }
  }

  function setComposerOpen(open) {
    const composer = documentRef.getElementById('blindBoxComposer');
    if (!composer) return;
    if (open) ensureMappingPanelExpanded();
    composer.hidden = !open;
    const toggle = documentRef.getElementById('blindBoxComposerToggle');
    if (toggle) {
      toggle.setAttribute?.('aria-expanded', String(open));
      const label = toggle.querySelector?.('.blind-box-composer-toggle-label');
      if (label) label.textContent = open ? '收起表单' : '补充盲盒';
    }
    if (open) documentRef.getElementById('blindBoxName')?.focus?.();
  }

  function setAdvancedOpen(open) {
    if (open) ensureMappingPanelExpanded();
    const advanced = documentRef.getElementById('blindBoxAdvanced');
    if (advanced) advanced.hidden = !open;
    const toggle = documentRef.getElementById('blindBoxAdvancedToggle');
    if (toggle) {
      toggle.textContent = open ? '编辑 JSON ▴' : '编辑 JSON ▾';
      toggle.setAttribute?.('aria-expanded', String(open));
    }
  }

  function renderOutputsPreview() {
    const preview = documentRef.getElementById('blindBoxOutputsPreview');
    const input = documentRef.getElementById('blindBoxOutputs');
    if (!preview || !input || typeof preview.replaceChildren !== 'function') return;
    const items = inspectBlindboxOutputs(input.value);
    if (!items.length) {
      preview.hidden = true;
      preview.replaceChildren();
      return;
    }
    const nodes = [];
    const label = documentRef.createElement('span');
    label.className = 'blind-box-preview-label';
    label.textContent = '识别预览';
    nodes.push(label);
    for (const { raw, parsed } of items) {
      const chip = documentRef.createElement('span');
      if (parsed) {
        chip.className = 'bb-output';
        chip.append(documentRef.createTextNode ? documentRef.createTextNode(parsed.name) : parsed.name);
        const idEl = documentRef.createElement('small');
        idEl.textContent = `#${parsed.giftId}`;
        chip.append(idEl);
        if (parsed.price !== undefined) {
          const priceEl = documentRef.createElement('small');
          priceEl.textContent = formatMoney(parsed.price);
          chip.append(priceEl);
        }
      } else {
        chip.className = 'bb-output is-invalid';
        chip.textContent = `格式待完善：${raw}`;
      }
      nodes.push(chip);
    }
    preview.replaceChildren(...nodes);
    preview.hidden = false;
  }

  function readCustomConfig(textarea) {
    try {
      const config = JSON.parse(textarea.value.trim() || '[]');
      if (!Array.isArray(config)) throw new Error('配置必须是 JSON 数组');
      return config;
    } catch (error) {
      setAdvancedOpen(true);
      invalid('giftBlindBoxCustomConfigV2', '自定义盲盒 JSON 格式有误：' + error.message);
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
    const heartOnly = Boolean(documentRef.getElementById('blindboxHeartBoxOnly')?.checked);
    const settings = documentRef.getElementById('blindboxHeartBoxSettings');
    if (settings) settings.hidden = !heartOnly;
    const remainingEnabled = Boolean(documentRef.getElementById('blindboxShowCastlesRemaining')?.checked);
    const remaining = documentRef.getElementById('blindboxCastlesRemaining');
    if (remaining) remaining.disabled = !remainingEnabled;
    for (const id of ['blindboxCastlesDec', 'blindboxCastlesInc']) {
      const btn = documentRef.getElementById(id);
      if (btn) btn.disabled = !remainingEnabled;
    }
  }

  function init() {
    mountAppearanceFields();
    documentRef.getElementById('blindBoxComposerToggle')?.addEventListener('click', () => {
      const composer = documentRef.getElementById('blindBoxComposer');
      setComposerOpen(Boolean(composer?.hidden));
    });
    documentRef.getElementById('blindBoxComposerCancel')?.addEventListener('click', () => {
      setComposerOpen(false);
    });
    documentRef.getElementById('blindBoxAdvancedClose')?.addEventListener('click', () => {
      setAdvancedOpen(false);
    });
    documentRef.getElementById('blindBoxOutputs')?.addEventListener('input', renderOutputsPreview);

    documentRef.getElementById('blindBoxAddBtn').addEventListener('click', async () => {
      const fields = ['blindBoxGiftId', 'blindBoxName', 'blindBoxPrice', 'blindBoxOutputs'].map(id => documentRef.getElementById(id));
      const submitted = fields.map(field => field.value);
      const [giftId, name, priceText, outputsRaw] = submitted.map(text => text.trim());
      const price = parseFloat(priceText);
      if (!name) return invalid('blindBoxName', '请输入盲盒名称');
      if (isNaN(price) || price <= 0) return invalid('blindBoxPrice', '请输入大于 0 的单盒成本');
      if (giftId && !/^[1-9]\d{0,19}$/u.test(giftId)) return invalid('blindBoxGiftId', '盲盒 ID 应为正整数');
      if (!outputsRaw) return invalid('blindBoxOutputs', '请填写能开出的礼物');

      const outputs = parseBlindboxOutputs(outputsRaw);
      if (!outputs?.length) return invalid('blindBoxOutputs', '请按「礼物 ID:名称」或「礼物 ID:名称:价格」填写，多个礼物用逗号隔开。');

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
      toast(`已保存自定义盲盒「${name}」，等待云端生效`);
      if (fields.every((field, index) => field.value === submitted[index])) {
        for (const field of fields) field.value = '';
        renderOutputsPreview();
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
        title: `删除自定义盲盒「${config[index].name}」？`,
        description: '将移除这条手动配置并保存，已记录的礼物数据不受影响。',
        confirmLabel: '删除盲盒', variant: 'destructive',
      });
      if (!confirmed) return;
      if (textarea.value !== before) { toast('盲盒配置已变化，请核对后重新删除。'); return; }
      config.splice(index, 1);
      const newRaw = JSON.stringify(config, null, 2);
      textarea.value = newRaw;
      await saveCustomConfig(textarea, newRaw);
      toast('已移除自定义盲盒，等待云端生效');
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
        toast('暂无自定义盲盒，可先使用上方表单添加');
        return;
      }
      const config = readCustomConfig(textarea);
      if (!config) return;
      await saveCustomConfig(textarea, JSON.stringify(config));
      toast('自定义盲盒已保存，等待云端生效');
      renderBlindboxList();
      await getState()?.reloadState?.();
    });

    let pendingAppearanceSaves = 0;
    const failedAppearanceFields = new Set();
    const deferredAppearance = new Map();
    let latestThemeSettings = getState()?.getAppState?.()?.settings || {};
    let currentBlindboxStyle = normalizeBlindboxStyle(latestThemeSettings.blindboxStyle);
    const styleButtons = [];
    let liveStats = null;
    let previewMode = 'live';
    let statsController = null;
    let statsDebounce = null;
    let statsDirty = true;
    let statsHeartBoxFilter = null;

    const createEl = (tag, className, text) => {
      const node = documentRef.createElement(tag);
      if (className) node.className = className;
      if (text !== undefined) node.textContent = text;
      return node;
    };

    const createText = (text) => (
      typeof documentRef.createTextNode === 'function'
        ? documentRef.createTextNode(text)
        : createEl('span', '', text)
    );

    const trackAppearanceSave = (setting, patch) => {
      const status = documentRef.getElementById('blindboxSaveState');
      pendingAppearanceSaves += 1;
      renderSaveStatus(status, 'saving');
      saveSettings(patch)
        .then(() => { failedAppearanceFields.delete(setting); })
        .catch(() => { failedAppearanceFields.add(setting); })
        .finally(() => {
          pendingAppearanceSaves -= 1;
          if (!pendingAppearanceSaves) renderSaveStatus(status, failedAppearanceFields.size ? 'error' : 'saved',
            failedAppearanceFields.size ? '部分设置保存失败，请重新修改后重试。' : undefined);
        });
    };

    const syncStylePicker = () => {
      const activeMeta = BLINDBOX_STYLES.find(item => item.id === currentBlindboxStyle) || BLINDBOX_STYLES[0];
      for (const button of styleButtons) {
        const active = button.dataset?.blindboxStyleOption === currentBlindboxStyle;
        button.classList?.toggle('is-active', active);
        button.setAttribute?.('aria-pressed', String(active));
      }
      const desc = documentRef.getElementById('blindboxStyleDescription');
      if (desc) desc.textContent = activeMeta?.description || '';
    };

    const commitStyle = (nextStyle) => {
      const normalized = normalizeBlindboxStyle(nextStyle);
      if (normalized === currentBlindboxStyle && !failedAppearanceFields.has('blindboxStyle')) return;
      currentBlindboxStyle = normalized;
      latestThemeSettings = { ...latestThemeSettings, blindboxStyle: normalized };
      syncStylePicker();
      syncThemeSummary(latestThemeSettings);
      renderPreviewAndMetrics();
      trackAppearanceSave('blindboxStyle', { blindboxStyle: normalized });
    };

    const mountStylePicker = () => {
      const host = documentRef.getElementById('blindboxStylePicker');
      if (!host || typeof host.replaceChildren !== 'function') return;
      styleButtons.length = 0;
      for (const style of BLINDBOX_STYLES) {
        const btn = createEl('button', 'blindbox-style-option');
        btn.type = 'button';
        if (btn.dataset) btn.dataset.blindboxStyleOption = style.id;
        btn.setAttribute?.('aria-pressed', String(style.id === currentBlindboxStyle));
        btn.title = style.description;
        btn.append(
          buildBlindboxStyleThumb(createEl, style.id),
          createEl('span', 'blindbox-style-label', style.label),
        );
        btn.addEventListener('click', () => commitStyle(style.id));
        styleButtons.push(btn);
      }
      host.replaceChildren(...styleButtons);
      syncStylePicker();
    };

    const syncPresetStates = () => {
      const topVal = String(documentRef.getElementById('blindboxOverlayTop')?.value ?? '3').trim();
      const topSummary = documentRef.getElementById('blindboxTopSummary');
      if (topSummary) topSummary.textContent = describeTopLimit(topVal);
      for (const button of documentRef.querySelectorAll?.('[data-blindbox-top-preset]') || []) {
        const active = button.dataset?.blindboxTopPreset === topVal;
        button.classList?.toggle('is-active', active);
        button.setAttribute?.('aria-pressed', String(active));
      }
      const multRaw = String(documentRef.getElementById('blindboxCastleMultiplier')?.value ?? '').trim();
      const multNum = multRaw === '' ? '' : String(Number(multRaw));
      for (const button of documentRef.querySelectorAll?.('[data-blindbox-mult-preset]') || []) {
        const preset = button.dataset?.blindboxMultPreset ?? '';
        const active = preset === '' ? multRaw === '' : Number.isFinite(Number(multRaw)) && String(Number(preset)) === multNum;
        button.classList?.toggle('is-active', active);
        button.setAttribute?.('aria-pressed', String(active));
      }
    };

    const syncThemeSummary = (settings) => {
      if (settings) latestThemeSettings = { ...latestThemeSettings, ...settings };
      const isClassic = currentBlindboxStyle === DEFAULT_BLINDBOX_STYLE;
      const summaryStrip = documentRef.getElementById('blindboxThemeSummary');
      if (summaryStrip?.dataset) summaryStrip.dataset.styleTone = isClassic ? 'dark' : 'light';
      const swatchesWrap = documentRef.getElementById('blindboxThemeSwatches');
      if (swatchesWrap) swatchesWrap.hidden = !isClassic;
      const swatches = [
        ['blindboxSwatchBg', latestThemeSettings.themeBackground || '#181823'],
        ['blindboxSwatchPrimary', latestThemeSettings.themePrimary || '#ff6f91'],
        ['blindboxSwatchAccent', latestThemeSettings.themeAccent || '#21b6a8'],
        ['blindboxSwatchText', latestThemeSettings.themeText || '#fff7fb'],
      ];
      for (const [id, color] of swatches) {
        const dot = documentRef.getElementById(id);
        if (dot?.style) dot.style.backgroundColor = color;
      }
      const fontLabel = documentRef.getElementById('blindboxThemeFontLabel');
      if (fontLabel) {
        const family = String(latestThemeSettings.overlayFontFamily || '').trim();
        if (isClassic) {
          fontLabel.textContent = family ? `与点歌板共用字体和配色 · ${family}` : '与点歌板共用字体和配色';
        } else {
          fontLabel.textContent = family ? `固定亮色适配配色 · 字体跟随点歌板（${family}）` : '固定亮色适配配色 · 字体跟随点歌板';
        }
      }
    };

    const renderPreviewAndMetrics = () => {
      const titleInput = documentRef.getElementById('blindboxOverlayTitle');
      const topInput = documentRef.getElementById('blindboxOverlayTop');
      const winnersInput = documentRef.getElementById('blindboxWinnersOnly');
      const heartInput = documentRef.getElementById('blindboxHeartBoxOnly');
      const multInput = documentRef.getElementById('blindboxCastleMultiplier');
      const showRemainInput = documentRef.getElementById('blindboxShowCastlesRemaining');
      const remainInput = documentRef.getElementById('blindboxCastlesRemaining');
      const showOpenedInput = documentRef.getElementById('blindboxShowOpenedSinceCastle');
      const compactInput = documentRef.getElementById('blindboxAppearance-compact');

      const title = String(titleInput?.value || '').trim() || '今日盲盒盈亏';
      const parsedTop = Number.parseInt(String(topInput?.value ?? '3'), 10);
      const topN = Number.isFinite(parsedTop) ? Math.max(-1, Math.min(10, parsedTop)) : 3;
      const summaryOnly = topN === 0;
      const winnersOnly = Boolean(winnersInput?.checked);
      const heartBoxOnly = Boolean(heartInput?.checked);
      const compact = Boolean(compactInput?.checked);

      const liveSummary = liveStats?.summary || { boxCount: 0, totalCost: 0, totalValue: 0, totalProfit: 0 };
      const boxesLabel = documentRef.getElementById('blindboxMetricBoxesLabel');
      if (boxesLabel) boxesLabel.textContent = heartBoxOnly ? '今日心动' : '今日开盒';
      const metricBoxes = documentRef.getElementById('blindboxMetricBoxes');
      if (metricBoxes) metricBoxes.textContent = `${liveSummary.boxCount || 0} 盒`;
      const metricCost = documentRef.getElementById('blindboxMetricCost');
      if (metricCost) metricCost.textContent = `¥${formatBlindboxAmount(liveSummary.totalCost)}`;
      const metricValue = documentRef.getElementById('blindboxMetricValue');
      if (metricValue) metricValue.textContent = `¥${formatBlindboxAmount(liveSummary.totalValue)}`;
      const metricProfit = documentRef.getElementById('blindboxMetricProfit');
      if (metricProfit) {
        metricProfit.textContent = formatSignedProfit(liveSummary.totalProfit);
        if (metricProfit.dataset) {
          metricProfit.dataset.tone = liveSummary.totalProfit > 0 ? 'up' : liveSummary.totalProfit < 0 ? 'down' : 'flat';
        }
      }

      const openedBadge = documentRef.getElementById('blindboxOpenedCountBadge');
      if (openedBadge) {
        const openedReal = liveStats?.heartBoxProgress?.openedSinceCastle;
        const hasOpened = heartBoxOnly && Number.isSafeInteger(openedReal) && openedReal >= 0;
        openedBadge.hidden = !hasOpened;
        if (hasOpened) openedBadge.textContent = `当前已垫 ${openedReal} 盒`;
      }

      const previewMeta = documentRef.getElementById('blindboxPreviewMeta');
      if (previewMeta) {
        const tags = [describeTopLimit(topN)];
        if (winnersOnly) tags.push('仅盈利');
        if (heartBoxOnly) tags.push('心动盲盒');
        previewMeta.textContent = tags.join(' · ');
      }
      const liveDot = documentRef.getElementById('blindboxLiveDot');
      if (liveDot?.dataset) {
        liveDot.dataset.state = previewMode === 'sample' ? 'sample' : (liveSummary.boxCount > 0 ? 'live' : 'idle');
      }

      const canvas = documentRef.getElementById('blindboxPreviewCanvas');
      if (!canvas || typeof canvas.replaceChildren !== 'function') return;

      const source = previewMode === 'sample' ? SAMPLE_PREVIEW_STATS : (liveStats || { summary: liveSummary, perUser: [], heartBoxProgress: null });
      const summary = source.summary || { boxCount: 0, totalCost: 0, totalValue: 0, totalProfit: 0 };
      let users = !summaryOnly && Array.isArray(source.perUser) ? [...source.perUser] : [];
      if (winnersOnly) users = users.filter(user => user.totalProfit > 0);
      if (topN > 0) users = users.slice(0, topN);
      const visibleUsers = summaryOnly ? [] : users.slice(0, 5);

      const heartParts = [];
      if (heartBoxOnly) {
        const mult = Number(multInput?.value);
        if (String(multInput?.value || '').trim() !== '' && Number.isFinite(mult) && mult > 0) {
          const span = createEl('span', 'heart-multiplier');
          span.append(createText('今天 '), createEl('strong', '', String(mult)), createText(' 倍堡'));
          heartParts.push(span);
        }
        const remaining = Number(remainInput?.value);
        if (showRemainInput?.checked && Number.isSafeInteger(remaining) && remaining >= 0) {
          const span = createEl('span');
          span.append(createText('还有 '), createEl('strong', '', String(remaining)), createText(' 个堡'));
          heartParts.push(span);
        }
        const opened = source.heartBoxProgress?.openedSinceCastle;
        if (showOpenedInput?.checked && Number.isSafeInteger(opened) && opened >= 0) {
          const span = createEl('span');
          span.append(createText('已开 '), createEl('strong', '', String(opened)), createText(' 个盲盒'));
          heartParts.push(span);
        }
      }

      const panel = createEl('section', 'overlay-panel blindbox-panel is-admin-preview no-scroll');
      if (compact) panel.classList.add('compact');
      if (summaryOnly) panel.classList.add('summary-only');
      if (winnersOnly) panel.classList.add('winners-only');
      if (panel.dataset) {
        panel.dataset.blindboxStyle = currentBlindboxStyle;
        panel.dataset.profitTone = summary.totalProfit > 0 ? 'up' : summary.totalProfit < 0 ? 'down' : 'flat';
        panel.dataset.userCount = String(visibleUsers.length);
        panel.dataset.hasHeart = String(heartParts.length > 0);
      }
      if (panel.style?.setProperty) {
        const rawOpacity = latestThemeSettings.themeOpacity;
        const opacityNum = rawOpacity === '' || rawOpacity === null || rawOpacity === undefined ? 0.76 : Number(rawOpacity);
        const clampedOpacity = Number.isFinite(opacityNum) ? Math.max(0, Math.min(1, opacityNum)) : 0.76;
        panel.style.setProperty('--overlay-opacity', String(clampedOpacity));
        panel.style.setProperty('--overlay-text', latestThemeSettings.themeText || '#fff7fb');
        panel.style.setProperty('--overlay-primary', latestThemeSettings.themePrimary || '#ff6f91');
        panel.style.setProperty('--overlay-accent', latestThemeSettings.themeAccent || '#21b6a8');
        panel.style.setProperty('--overlay-radius', `${Math.min(20, Math.max(0, Number(latestThemeSettings.themeRadius ?? 8)))}px`);
        panel.style.setProperty('--overlay-font-weight', String(latestThemeSettings.overlayFontWeight || '800'));
        if (latestThemeSettings.overlayFontFamily) {
          panel.style.setProperty('--overlay-font-family', `${latestThemeSettings.overlayFontFamily}, var(--font-ui)`);
        }
        if (currentBlindboxStyle === DEFAULT_BLINDBOX_STYLE) {
          panel.style.backgroundColor = resolveBackgroundCss(latestThemeSettings.themeBackground, latestThemeSettings.themeOpacity);
        }
      }

      const header = createEl('header', 'overlay-header blindbox-header');
      header.append(createEl('div', 'overlay-title', title));
      const summaryEl = createEl('div', 'blindbox-summary');
      if (summaryOnly || summary.boxCount > 0) {
        const metaEl = createEl('div', 'blindbox-summary-meta');
        const boxesSpan = createEl('span', 'summary-boxes');
        boxesSpan.append(createEl('span', 'stat-value', String(summary.boxCount)), createText(' 盒'));
        const costSpan = createEl('span', 'summary-cost');
        costSpan.append(createText('花费 '), createEl('span', 'stat-value', `¥${formatBlindboxAmount(summary.totalCost)}`));
        const valueSpan = createEl('span', 'summary-value');
        valueSpan.append(createText('开出价值 '), createEl('span', 'stat-value', `¥${formatBlindboxAmount(summary.totalValue)}`));
        metaEl.append(boxesSpan, costSpan, valueSpan);

        const totalEl = createEl('div', `blindbox-total ${summary.totalProfit >= 0 ? 'profit-up' : 'profit-down'}`);
        totalEl.setAttribute?.('role', 'group');
        totalEl.setAttribute?.('aria-label', '总盈亏');
        totalEl.append(createEl('span', 'stat-value',
          `${summary.totalProfit >= 0 ? '+' : '-'}¥${formatBlindboxAmount(Math.abs(summary.totalProfit))}`));
        summaryEl.append(metaEl, totalEl);
      }
      header.append(summaryEl);
      panel.append(header);

      const heartBar = createEl('div', 'blindbox-heart-progress');
      if (heartParts.length) {
        heartBar.append(...heartParts);
      } else {
        heartBar.hidden = true;
      }
      panel.append(heartBar);

      const content = createEl('div', 'overlay-content blindbox-content');
      const leaderboard = createEl('div', 'blindbox-leaderboard');
      if (!summaryOnly) {
        if (visibleUsers.length === 0) {
          const emptyText = summary.boxCount > 0
            ? (winnersOnly ? '暂无盈利观众' : '暂无上榜观众')
            : '等待开盒';
          const emptyWrap = createEl('div', 'blindbox-empty');
          emptyWrap.append(createEl('span', 'empty-text', emptyText));
          leaderboard.append(emptyWrap);
        } else {
          for (let index = 0; index < visibleUsers.length; index += 1) {
            const user = visibleUsers[index];
            const rank = index + 1;
            const profitIsUp = user.totalProfit >= 0;
            const isLoss = user.totalProfit < 0;
            const rowClasses = ['leaderboard-row'];
            if (rank <= 3) rowClasses.push(`rank-${rank}`);
            if (isLoss) rowClasses.push('is-loss');
            const row = createEl('div', rowClasses.join(' '));
            const userInfo = createEl('div', 'user-info');
            const userResult = createEl('div', 'user-result');
            userResult.append(
              createEl('span', 'box-count', `${user.boxCount} 盒`),
              createEl('span', `profit-value ${profitIsUp ? 'is-up' : 'is-down'}`,
                `${profitIsUp ? '+' : '-'}¥${formatBlindboxAmount(Math.abs(user.totalProfit))}`),
            );
            userInfo.append(
              createEl('span', 'user-name', String(user.userName || '观众')),
              userResult,
            );
            row.append(createEl('div', 'rank-badge', String(rank)), userInfo);
            leaderboard.append(row);
          }
        }
      }
      content.append(leaderboard);
      panel.append(content);
      canvas.replaceChildren(panel);
    };

    const isPanelVisible = () => {
      const page = documentRef.getElementById('liveComponentsPage');
      const panel = documentRef.getElementById('giftBlindboxFeature');
      return !documentRef.hidden && Boolean(page?.classList?.contains('active')) && Boolean(panel) && !panel.hidden;
    };

    const refreshLiveStats = async ({ force = false } = {}) => {
      if (typeof fetch !== 'function') return;
      if (!force && !isPanelVisible()) { statsDirty = true; return; }
      const heartOnly = Boolean(documentRef.getElementById('blindboxHeartBoxOnly')?.checked);
      if (!force && !statsDirty && statsHeartBoxFilter === heartOnly) return;
      statsDirty = false;
      statsHeartBoxFilter = heartOnly;
      statsController?.abort();
      const controller = typeof AbortController === 'function' ? new AbortController() : null;
      statsController = controller;
      const refreshBtn = documentRef.getElementById('blindboxStatsRefresh');
      refreshBtn?.classList?.add('is-loading');
      try {
        const query = new URLSearchParams({ top: '-1', includeRecords: '0' });
        if (heartOnly) query.set('boxName', '心动盲盒');
        const response = await fetch(`/api/gifts/blind-box-stats?${query}`, controller ? { signal: controller.signal } : undefined);
        const payload = await response.json();
        if (statsController !== controller) return;
        if (payload?.ok && payload.data) {
          liveStats = payload.data;
          renderPreviewAndMetrics();
        }
      } catch (error) {
        if (error?.name !== 'AbortError') {
          statsDirty = true;
        }
      } finally {
        if (statsController === controller) {
          statsController = null;
          refreshBtn?.classList?.remove('is-loading');
        }
      }
    };

    const commitField = (element, setting) => {
      deferredAppearance.delete(setting);
      updateOverlayUrl();
      updateHeartBoxSettings();
      syncPresetStates();
      renderPreviewAndMetrics();
      if (setting === 'blindboxHeartBoxOnly') void refreshLiveStats({ force: isPanelVisible() });
      if (!element.checkValidity()) { element.reportValidity(); return; }
      trackAppearanceSave(setting, { [setting]: element.type === 'checkbox' ? String(element.checked) : element.value.trim() });
    };

    const setAppearanceValue = (input, settingValue) => {
      if (input.type === 'checkbox') input.checked = settingValue === 'true';
      else input.value = settingValue;
    };
    for (const [id, setting] of overlayFields) {
      const element = documentRef.getElementById(id);
      if (!element) continue;
      element.addEventListener('input', () => {
        updateOverlayUrl();
        syncPresetStates();
        renderPreviewAndMetrics();
      });
      element.addEventListener('blur', () => {
        if (!deferredAppearance.has(setting)) return;
        setAppearanceValue(element, deferredAppearance.get(setting));
        deferredAppearance.delete(setting);
        updateHeartBoxSettings();
        syncPresetStates();
        renderPreviewAndMetrics();
      });
      element.addEventListener('change', () => {
        // Native change commits before blur; this edit takes precedence over the skipped snapshot.
        commitField(element, setting);
      });
    }

    for (const button of documentRef.querySelectorAll?.('[data-blindbox-top-preset]') || []) {
      button.addEventListener('click', () => {
        const input = documentRef.getElementById('blindboxOverlayTop');
        if (!input) return;
        input.value = button.dataset?.blindboxTopPreset ?? '3';
        commitField(input, 'blindboxOverlayTop');
      });
    }

    for (const button of documentRef.querySelectorAll?.('[data-blindbox-mult-preset]') || []) {
      button.addEventListener('click', () => {
        const input = documentRef.getElementById('blindboxCastleMultiplier');
        if (!input) return;
        input.value = button.dataset?.blindboxMultPreset ?? '';
        commitField(input, 'blindboxCastleMultiplier');
      });
    }

    const stepCastles = (delta) => {
      const input = documentRef.getElementById('blindboxCastlesRemaining');
      if (!input || input.disabled) return;
      const current = Number.parseInt(String(input.value || '0'), 10);
      const base = Number.isFinite(current) ? current : 0;
      const next = Math.max(0, Math.min(99999, base + delta));
      if (next === base) return;
      input.value = String(next);
      commitField(input, 'blindboxCastlesRemaining');
    };
    documentRef.getElementById('blindboxCastlesDec')?.addEventListener('click', () => stepCastles(-1));
    documentRef.getElementById('blindboxCastlesInc')?.addEventListener('click', () => stepCastles(1));

    for (const button of documentRef.querySelectorAll?.('[data-blindbox-preview-mode]') || []) {
      button.addEventListener('click', () => {
        previewMode = button.dataset?.blindboxPreviewMode === 'sample' ? 'sample' : 'live';
        for (const peer of documentRef.querySelectorAll?.('[data-blindbox-preview-mode]') || []) {
          const active = peer === button;
          peer.classList?.toggle('is-active', active);
          peer.setAttribute?.('aria-pressed', String(active));
        }
        renderPreviewAndMetrics();
      });
    }

    for (const button of documentRef.querySelectorAll?.('[data-blindbox-backdrop]') || []) {
      button.addEventListener('click', () => {
        const backdrop = button.dataset?.blindboxBackdrop || 'light';
        const stage = documentRef.getElementById('blindboxPreviewStage');
        if (stage?.dataset) stage.dataset.backdrop = backdrop;
        for (const peer of documentRef.querySelectorAll?.('[data-blindbox-backdrop]') || []) {
          const active = peer === button;
          peer.classList?.toggle('is-active', active);
          peer.setAttribute?.('aria-pressed', String(active));
        }
      });
    }

    documentRef.getElementById('blindboxStatsRefresh')?.addEventListener('click', () => {
      void refreshLiveStats({ force: true });
    });

    bindCopyUrl(documentRef.getElementById('blindboxOverlayUrl'), { onCopied: () => toast('盲盒浏览器源地址已复制') });

    documentRef.getElementById('blindboxPreviewBtn').addEventListener('click', () => {
      openComponentPreview({ id: 'blindbox' });
    });

    mountStylePicker();
    updateOverlayUrl();
    const receiveAppearance = settings => {
      if (settings?.blindboxStyle !== undefined) {
        currentBlindboxStyle = normalizeBlindboxStyle(settings.blindboxStyle);
      }
      for (const [id, setting] of overlayFields) {
        const input = documentRef.getElementById(id);
        if (!input || settings?.[setting] === undefined) continue;
        if (documentRef.activeElement === input) {
          deferredAppearance.set(setting, settings[setting]);
          continue;
        }
        deferredAppearance.delete(setting);
        setAppearanceValue(input, settings[setting]);
      }
      updateHeartBoxSettings();
      syncStylePicker();
      syncPresetStates();
      syncThemeSummary(settings);
      renderPreviewAndMetrics();
      const heartOnly = Boolean(documentRef.getElementById('blindboxHeartBoxOnly')?.checked);
      if (statsHeartBoxFilter !== null && statsHeartBoxFilter !== heartOnly) {
        void refreshLiveStats();
      }
    };
    receiveAppearance(getState()?.getAppState?.()?.settings);
    documentRef.defaultView?.addEventListener('app:settings-state', event => receiveAppearance(event.detail));

    if (typeof MutationObserver === 'function' && typeof fetch === 'function') {
      const syncVisibility = () => {
        if (!isPanelVisible()) {
          clearTimeout(statsDebounce);
          statsDebounce = null;
          statsController?.abort();
          statsController = null;
          statsDirty = true;
          return;
        }
        void refreshLiveStats();
      };
      const observer = new MutationObserver(syncVisibility);
      const panel = documentRef.getElementById('giftBlindboxFeature');
      const page = documentRef.getElementById('liveComponentsPage');
      if (panel) observer.observe(panel, { attributes: true, attributeFilter: ['hidden'] });
      if (page) observer.observe(page, { attributes: true, attributeFilter: ['class'] });
      const unsubscribeGift = eventBus.on(Events.GIFT_RECEIVED, () => {
        statsDirty = true;
        if (!isPanelVisible()) return;
        if (statsDebounce === null) {
          statsDebounce = setTimeout(() => {
            statsDebounce = null;
            void refreshLiveStats();
          }, 500);
        }
      });
      documentRef.addEventListener?.('visibilitychange', syncVisibility);
      documentRef.defaultView?.addEventListener('pagehide', () => {
        clearTimeout(statsDebounce);
        statsDebounce = null;
        statsController?.abort();
        observer.disconnect();
        unsubscribeGift();
        documentRef.removeEventListener?.('visibilitychange', syncVisibility);
      }, { once: true });
      syncVisibility();
    }

    const customConfig = documentRef.getElementById('giftBlindBoxCustomConfigV2');
    customConfig.dataset.preserveDirty = 'true';
    customConfig.addEventListener('input', () => {
      customConfig.dataset.dirty = 'true';
      renderBlindboxList();
    });
  }

  return { buildOverlayUrl, updateOverlayUrl, init };
}
