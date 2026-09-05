'use strict';

import { eventBus, Events } from '../shared/event-bus.js';
import {
  api,
  copyText,
  localOverlayOrigin,
  readJsonResponse,
  showError,
  toast,
} from '../shared/utils.js';
import { createOvertimeRuleEditor } from './overtime-rule-editor.js';
import { createOvertimeTimeView } from './overtime-time-view.js';
import { createOvertimeStatusView } from './overtime-status-view.js';

const PLACEHOLDER = '/img/overtime-machine/gift-placeholder.svg';
const GUARD_GIFTS = [
  {
    id: 'guard-1',
    name: '总督',
    image: 'admin/gifts/bilibili-guard-governor.webp',
  },
  {
    id: 'guard-2',
    name: '提督',
    image: 'admin/gifts/bilibili-guard-prefect.webp',
  },
  {
    id: 'guard-3',
    name: '舰长',
    image: 'admin/gifts/bilibili-guard-captain.webp',
  },
];

let initialized = false;
let serverLimits = null;
let giftDetection = null;
let catalog = [];
let settlements = [];
let rulesDirty = false;
let rulesSaving = false;
let backgroundDirty = false;
let backgroundSaving = false;
let catalogRefreshing = false;
let globalGiftSearchPending = false;
let globalGiftSearchError = '';
let giftPickerGeneration = 0;
let giftCatalogSnapshot = null;
let giftCatalogApplyGeneration = 0;
let catalogLiveStatus = null;
let globalGiftMatches = [];
let serverGiftArtworkById = new Map();
let giftPickerSource = 'sale';
let ruleEditor = null;

const overtimeTimeView = createOvertimeTimeView({
  byId,
  setValueUnlessFocused,
  getServerLimits: () => serverLimits,
  getSettlements: () => settlements,
});
const {
  renderSettlements,
  populateInitialDurationSelectors,
  syncDurationSelectorsFromInput,
  syncDurationInputFromSelectors,
  renderInitialDuration,
  parseInitialDuration,
  formatClockDisplay,
} = overtimeTimeView;

const overtimeStatusView = createOvertimeStatusView({
  byId,
  formatClockDisplay,
  renderInitialDuration,
  setValueUnlessFocused,
  getGiftDetection: () => giftDetection,
  getRuleEditor: () =>
    ruleEditor
      ? {
          renderRules: (rules) =>
            ruleEditor.renderRules(decorateOvertimeRules(rules)),
        }
      : null,
  isRulesDirty: () => rulesDirty,
  isBackgroundDirty: () => backgroundDirty,
  onLimits: (limits) => {
    serverLimits = limits;
    ruleEditor?.setLimits(limits);
  },
});
const { renderState, syncClockLoop, stopClockLoop } = overtimeStatusView;

function init() {
  if (initialized || !document.getElementById('overtimePanel')) return;
  initialized = true;
  ruleEditor = createOvertimeRuleEditor(byId('overtimeRules'), markRulesDirty);
  bindControls();
  eventBus.on(Events.STATE_LOADED, ({ state }) => {
    giftDetection = state?.giftDetection || giftDetection;
    catalogLiveStatus = state?.liveStatus || catalogLiveStatus;
    if (state?.overtime) renderState(state.overtime);
    if (giftCatalogSnapshot?.refreshedAt) renderGiftCatalogStatus();
  });
  eventBus.on(Events.OVERTIME_UPDATED, (payload) => {
    renderState(payload.state);
    if (payload.adjustment) refresh().catch(showError);
  });
  eventBus.on(Events.GIFT_CATALOG_UPDATED, ({ snapshot }) => {
    if (snapshot?.source === 'server') applyServerGiftArtwork(snapshot);
    else applyGiftCatalog(snapshot);
  });
  eventBus.on('app:shutdown', stopClockLoop);
  document.addEventListener('visibilitychange', syncClockLoop);
  loadCatalog().catch(showError);
  refresh().catch(showError);
}

async function refresh() {
  const response = await fetch('/api/overtime');
  const payload = await readJsonResponse(response, '读取加班机失败');
  if (!payload.ok) throw new Error(payload.error || '读取加班机失败');
  settlements = payload.data.settlements || [];
  renderState(payload.data);
  renderSettlements();
}

function bindControls() {
  populateInitialDurationSelectors();
  byId('overtimeEnableBtn').addEventListener('click', () =>
    runAction(overtimeStatusView.getState()?.enabled ? 'disable' : 'enable'),
  );
  byId('overtimeStartBtn').addEventListener('click', () => runAction('start'));
  byId('overtimePauseBtn').addEventListener('click', () => runAction('pause'));
  byId('overtimeResetBtn').addEventListener('click', () => runAction('reset'));
  byId('overtimeApplyTimeBtn').addEventListener('click', applyTime);
  byId('overtimeInitialTime').addEventListener(
    'input',
    syncDurationSelectorsFromInput,
  );
  byId('overtimeInitialHours').addEventListener(
    'change',
    syncDurationInputFromSelectors,
  );
  byId('overtimeInitialMinutes').addEventListener(
    'change',
    syncDurationInputFromSelectors,
  );
  byId('overtimeRefreshGiftsBtn').addEventListener('click', refreshGiftCatalog);
  byId('overtimeAddGiftBtn').addEventListener('click', openGiftPicker);
  byId('overtimeGiftSearch').addEventListener('input', handleGiftSearchInput);
  byId('overtimeGiftSearch').addEventListener(
    'keydown',
    handleGiftSearchKeydown,
  );
  byId('overtimeGlobalGiftSearchBtn').addEventListener(
    'click',
    toggleGiftPickerSource,
  );
  byId('overtimeRules').addEventListener('input', markRulesDirty);
  byId('overtimeRules').addEventListener('change', markRulesDirty);
  byId('overtimeSaveRulesBtn').addEventListener('click', saveRules);
  byId('overtimeSaveBackgroundBtn').addEventListener('click', saveBackground);
  byId('overtimeBackgroundPath').addEventListener(
    'change',
    markBackgroundDirty,
  );
  byId('overtimeBackgroundFit').addEventListener('change', markBackgroundDirty);
  byId('overtimeOpenOverlayBtn').addEventListener('click', () =>
    window.open(overlayUrl(), '_blank', 'noopener'),
  );
  byId('overtimeCopyOverlayBtn').addEventListener('click', copyOverlayUrl);
  byId('overtimePreview').src = '/overtime?quality=low';
  syncRulesSaveButton();
  syncBackgroundSaveButton();
}

async function runAction(action) {
  try {
    const result = await api('/api/overtime/action', { action });
    renderState(result.data);
  } catch (_) {}
}

async function applyTime() {
  try {
    const initialSeconds = parseInitialDuration(
      byId('overtimeInitialTime').value,
    );
    const result = await api('/api/overtime/time', {
      initialSeconds,
      remainingSeconds: initialSeconds,
    });
    renderState(result.data);
    toast('初始时间已设置，倒计时已重置并暂停');
  } catch (error) {
    showError(error);
  }
}

async function saveBackground() {
  if (backgroundSaving || !backgroundDirty) return;
  backgroundSaving = true;
  syncBackgroundSaveButton();
  try {
    const result = await api('/api/overtime/config', {
      path: byId('overtimeBackgroundPath').value,
      fit: byId('overtimeBackgroundFit').value,
    });
    renderState(result.data);
    backgroundDirty = false;
    syncBackgroundSaveButton();
    byId('overtimePreview').src = `/overtime?quality=low&t=${Date.now()}`;
    toast('直播画面已保存');
  } catch (error) {
    showError(error);
  } finally {
    backgroundSaving = false;
    syncBackgroundSaveButton();
  }
}

async function saveRules() {
  if (rulesSaving || !rulesDirty) return;
  rulesSaving = true;
  syncRulesSaveButton();
  try {
    const rules = ruleEditor.readRules();
    const result = await api('/api/overtime/rules', { rules });
    rulesDirty = false;
    renderState(result.data);
    toast('修改已保存');
  } catch (error) {
    showError(error);
  } finally {
    rulesSaving = false;
    syncRulesSaveButton();
  }
}

function markRulesDirty() {
  rulesDirty = true;
  syncRulesSaveButton();
}

function getRulesSaveButtonState(dirty, saving) {
  if (saving) return { label: '保存中…', disabled: true, dirty: false };
  if (dirty) return { label: '保存修改', disabled: false, dirty: true };
  return { label: '✓ 已保存', disabled: true, dirty: false };
}

function syncRulesSaveButton() {
  const button = byId('overtimeSaveRulesBtn');
  if (!button) return;
  const state = getRulesSaveButtonState(rulesDirty, rulesSaving);
  button.textContent = state.label;
  button.disabled = state.disabled;
  button.classList.toggle('is-dirty', state.dirty);
}

function markBackgroundDirty() {
  backgroundDirty = true;
  syncBackgroundSaveButton();
}

function getBackgroundSaveButtonState(dirty, saving) {
  if (saving) return { label: '保存中…', disabled: true };
  if (dirty) return { label: '保存画面', disabled: false };
  return { label: '已保存', disabled: true };
}

function syncBackgroundSaveButton() {
  const button = byId('overtimeSaveBackgroundBtn');
  if (!button) return;
  const state = getBackgroundSaveButtonState(backgroundDirty, backgroundSaving);
  button.textContent = state.label;
  button.disabled = state.disabled;
}

async function loadCatalog() {
  // A pushed local-WS revision may arrive while this initial request is in
  // flight. Do not let a slower, older response roll the picker back.
  const requestGeneration = giftCatalogApplyGeneration;
  const response = await fetch('/api/overtime/gifts');
  const payload = await readJsonResponse(response, '读取在售礼物目录失败');
  if (!payload.ok) throw new Error(payload.error || '读取在售礼物目录失败');
  if (requestGeneration !== giftCatalogApplyGeneration) return;
  applyGiftCatalog(payload.data);
}

async function refreshGiftCatalog({ notify = true } = {}) {
  if (catalogRefreshing) return;
  catalogRefreshing = true;
  syncCatalogRefreshButton();
  try {
    const result = await api('/api/overtime/gifts/refresh', {});
    applyGiftCatalog(result.data);
    if (notify) toast(`已刷新 ${giftCatalogSnapshot.count} 个在售礼物`);
  } catch (error) {
    showError(error);
  } finally {
    catalogRefreshing = false;
    syncCatalogRefreshButton();
  }
}

function applyGiftCatalog(snapshot) {
  giftCatalogApplyGeneration += 1;
  giftCatalogSnapshot =
    snapshot && typeof snapshot === 'object' ? snapshot : {};
  const saleGifts = Array.isArray(giftCatalogSnapshot.gifts)
    ? giftCatalogSnapshot.gifts
    : [];
  catalog = [
    ...GUARD_GIFTS.map((gift, index) => ({
      ...gift,
      catalogGroup: 0,
      catalogOrder: index,
    })),
    ...saleGifts.map((gift) => ({ ...gift, catalogGroup: 1, catalogOrder: 0 })),
  ]
    .map((gift) => ({
      id: String(gift.id),
      name: String(gift.name || gift.id),
      rmb: Number(gift.rmb) || 0,
      catalogGroup: gift.catalogGroup,
      catalogOrder: gift.catalogOrder,
      imagePath: String(
        serverGiftArtworkById.get(String(gift.id)) ||
          gift.imagePath ||
          (gift.image ? `/img/${String(gift.image).replace(/^\/+/, '')}` : ''),
      ),
    }))
    .sort(
      (left, right) =>
        left.catalogGroup - right.catalogGroup ||
        left.catalogOrder - right.catalogOrder ||
        left.rmb - right.rmb,
    );
  renderGiftCatalogStatus();
  // Keep an open picker in sync without changing its source or search query.
  const picker = byId('overtimeGiftPicker');
  if (picker?.open) renderGiftPicker();
}

function applyServerGiftArtwork(snapshot) {
  if (!snapshot || typeof snapshot !== 'object') return;
  if (!Array.isArray(snapshot.gifts)) return;

  const nextArtworkById = new Map(serverGiftArtworkById);
  for (const gift of snapshot.gifts) {
    const giftId = String(gift?.id ?? '').trim();
    const imagePath = normalizeGiftArtworkPath(gift?.imagePath);
    if (giftId && imagePath) nextArtworkById.set(giftId, imagePath);
  }
  serverGiftArtworkById = nextArtworkById;

  catalog = catalog.map((gift) => {
    const imagePath = serverGiftArtworkById.get(gift.id);
    return imagePath ? { ...gift, imagePath } : gift;
  });
  globalGiftMatches = globalGiftMatches.map((gift) => {
    const imagePath = serverGiftArtworkById.get(gift.id);
    return imagePath ? { ...gift, imagePath } : gift;
  });
  for (const row of byId('overtimeRules').querySelectorAll(
    '[data-overtime-rule]',
  )) {
    const imagePath = serverGiftArtworkById.get(
      String(row.dataset.giftId || ''),
    );
    if (!imagePath) continue;
    row.dataset.imagePath = imagePath;
    const image = row.querySelector('.overtime-rule-gift img');
    if (image) image.src = imagePath;
  }
  const picker = byId('overtimeGiftPicker');
  if (picker?.open) renderGiftPicker();
}

function decorateOvertimeRules(rules) {
  if (!Array.isArray(rules)) return rules;
  return rules.map((rule) => {
    const imagePath = serverGiftArtworkById.get(
      String(rule?.giftId ?? '').trim(),
    );
    return imagePath ? { ...rule, imagePath } : rule;
  });
}

function normalizeGiftArtworkPath(value) {
  const imagePath = String(value ?? '').trim();
  return /^\/overtime-gift-images\/[a-z0-9._-]+\.(?:gif|webp|png|jpe?g)$/i.test(
    imagePath,
  ) && !imagePath.includes('..')
    ? imagePath
    : '';
}

function renderGiftCatalogStatus() {
  const status = byId('overtimeGiftCatalogStatus');
  if (!giftCatalogSnapshot?.refreshedAt) {
    status.textContent = '在售目录：未刷新';
    return;
  }
  const refreshedAt = new Date(giftCatalogSnapshot.refreshedAt);
  const timeLabel = Number.isNaN(refreshedAt.getTime())
    ? ''
    : refreshedAt.toLocaleString('zh-CN', {
        hour12: false,
        year: 'numeric',
        month: 'numeric',
        day: 'numeric',
        hour: '2-digit',
        minute: '2-digit',
      });
  const sourceLabel = catalogRoomLabel(giftCatalogSnapshot, catalogLiveStatus);
  status.textContent = `在售目录：${Number(giftCatalogSnapshot.count) || 0} 个 · ${sourceLabel}${timeLabel ? ` · ${timeLabel}` : ''}`;
}

function catalogRoomLabel(snapshot, liveStatus) {
  const roomId = String(snapshot?.roomId || '');
  const liveRoomId = String(liveStatus?.roomId || '');
  const ownerName = String(liveStatus?.ownerName || '').trim();
  return ownerName && roomId && liveRoomId === roomId
    ? ownerName
    : roomId || '—';
}

function syncCatalogRefreshButton() {
  const button = byId('overtimeRefreshGiftsBtn');
  if (!button) return;
  button.disabled = catalogRefreshing;
  button.textContent = catalogRefreshing ? '刷新中…' : '刷新在售礼物';
}

function openGiftPicker() {
  giftPickerGeneration += 1;
  const search = byId('overtimeGiftSearch');
  search.value = '';
  globalGiftMatches = [];
  globalGiftSearchPending = false;
  globalGiftSearchError = '';
  giftPickerSource = 'sale';
  syncGlobalGiftSearchButton();
  renderGiftPicker();
  byId('overtimeGiftPicker').showModal();
  search.focus();
  // Refresh the room's live sale list whenever the picker opens. The backend
  // coalesces/throttles requests, so repeated opens do not spam Bilibili, while
  // a changed room is picked up without requiring a separate button click.
  refreshGiftCatalog({ notify: false }).catch(() => {});
}

function handleGiftSearchInput() {
  renderGiftPicker();
}

function handleGiftSearchKeydown(event) {
  if (event.key !== 'Enter') return;
  event.preventDefault();
  renderGiftPicker();
}

async function toggleGiftPickerSource() {
  if (globalGiftSearchPending) return;
  if (giftPickerSource === 'global') {
    giftPickerSource = 'sale';
    syncGlobalGiftSearchButton();
    renderGiftPicker();
    byId('overtimeGiftSearch').focus();
    return;
  }
  const requestGeneration = ++giftPickerGeneration;
  giftPickerSource = 'global';
  globalGiftMatches = [];
  globalGiftSearchError = '';
  globalGiftSearchPending = true;
  syncGlobalGiftSearchButton();
  renderGiftPicker();
  byId('overtimeGiftSearch').focus();
  try {
    const response = await fetch('/api/overtime/gifts/catalog');
    const result = await readJsonResponse(response, '读取礼物库失败');
    if (requestGeneration !== giftPickerGeneration) return;
    if (!result.ok) throw new Error(result.error || '读取礼物库失败');
    if (!Array.isArray(result.data?.gifts)) {
      throw new Error('礼物库尚未缓存。');
    }
    globalGiftMatches = result.data.gifts.map((gift) => ({
      id: String(gift.id),
      name: String(gift.name || gift.id),
      rmb: Number(gift.rmb) || 0,
      imagePath:
        serverGiftArtworkById.get(String(gift.id)) ||
        String(gift.imagePath || ''),
    }));
  } catch (error) {
    if (requestGeneration !== giftPickerGeneration) return;
    globalGiftSearchError = error.message || '读取礼物库失败';
  } finally {
    if (requestGeneration === giftPickerGeneration) {
      globalGiftSearchPending = false;
      syncGlobalGiftSearchButton();
      renderGiftPicker();
    }
  }
}

function syncGlobalGiftSearchButton() {
  const button = byId('overtimeGlobalGiftSearchBtn');
  if (!button) return;
  button.disabled = globalGiftSearchPending;
  button.textContent = globalGiftSearchPending
    ? '加载中…'
    : giftPickerSource === 'global'
      ? '返回在售礼物'
      : '搜索全部礼物';
}

function renderGiftPicker() {
  const root = byId('overtimeGiftResults');
  root.replaceChildren();
  if (
    giftPickerSource === 'global' &&
    (globalGiftSearchPending || globalGiftSearchError)
  ) {
    root.append(
      createMessage(
        'overtime-rule-empty overtime-local-gift-search-status',
        globalGiftSearchPending
          ? '正在读取礼物库…'
          : globalGiftSearchError,
      ),
    );
    return;
  }
  const query = byId('overtimeGiftSearch').value.trim().toLocaleLowerCase();
  const selectedIds = new Set(
    Array.from(
      byId('overtimeRules').querySelectorAll('[data-overtime-rule]'),
    ).map((row) => row.dataset.giftId),
  );
  const source = giftPickerSource === 'global' ? globalGiftMatches : catalog;
  const matches = source.filter(
    (gift) =>
      !selectedIds.has(gift.id) &&
      (!query ||
        gift.id.toLocaleLowerCase().includes(query) ||
        gift.name.toLocaleLowerCase().includes(query)),
  );
  if (giftPickerSource === 'global' && matches.length) {
    root.append(
      createMessage(
        'overtime-rule-empty overtime-local-gift-search-status',
        `礼物库 · ${matches.length} / ${globalGiftMatches.length} 个`,
      ),
    );
  }
  for (const gift of matches) {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'overtime-gift-option';
    const image = document.createElement('img');
    image.loading = 'lazy';
    image.decoding = 'async';
    image.src = gift.imagePath || PLACEHOLDER;
    image.alt = '';
    image.addEventListener(
      'error',
      () => {
        image.src = PLACEHOLDER;
      },
      { once: true },
    );
    const text = document.createElement('span');
    const name = document.createElement('strong');
    name.textContent = gift.name;
    text.append(name);
    if (!gift.id.startsWith('guard-')) {
      const meta = document.createElement('small');
      meta.textContent = `ID ${gift.id} · ¥${gift.rmb.toFixed(2)}`;
      text.append(meta);
    }
    button.append(image, text);
    button.addEventListener('click', () => addGiftRule(gift));
    root.append(button);
  }
  if (!matches.length)
    root.append(
      createMessage(
        'overtime-rule-empty',
        giftPickerSource === 'global'
          ? globalGiftMatches.length
            ? '全部礼物中没有匹配项。'
            : '礼物库暂无礼物。'
          : '没有找到当前在售礼物。',
      ),
    );
}

function createMessage(className, message) {
  const node = document.createElement('div');
  node.className = className;
  node.textContent = message;
  return node;
}

function addGiftRule(gift) {
  const row = ruleEditor.createRule(gift);
  byId('overtimeGiftPicker').close();
  row.scrollIntoView({ block: 'nearest' });
  toast(`已添加 ${gift.name}`);
}

function overlayUrl() {
  return `${localOverlayOrigin()}/overtime`;
}

async function copyOverlayUrl() {
  try {
    await copyText(overlayUrl());
    toast('地址已复制');
  } catch (error) {
    showError(error);
  }
}

function byId(id) {
  return document.getElementById(id);
}

function setValueUnlessFocused(id, value) {
  const input = byId(id);
  if (document.activeElement !== input) input.value = value;
}

window.AdminApp = window.AdminApp || {};
window.AdminApp.overtime = { init, refresh };
