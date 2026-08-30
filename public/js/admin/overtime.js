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
let localGiftSearchPending = false;
let giftCatalogSnapshot = null;
let giftCatalogApplyGeneration = 0;
let catalogLiveStatus = null;
let saleGiftIds = new Set();
let localGiftMatches = [];
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
  getRuleEditor: () => ruleEditor,
  isRulesDirty: () => rulesDirty,
  isBackgroundDirty: () => backgroundDirty,
  syncRuleAvailability,
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
    applyGiftCatalog(snapshot);
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
  byId('overtimeLocalGiftSearchBtn').addEventListener(
    'click',
    searchLocalGifts,
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
  const payload = await readJsonResponse(response, '读取服务器礼物目录失败');
  if (!payload.ok) throw new Error(payload.error || '读取服务器礼物目录失败');
  if (requestGeneration !== giftCatalogApplyGeneration) return;
  applyGiftCatalog(payload.data);
}

async function refreshGiftCatalog() {
  if (catalogRefreshing) return;
  catalogRefreshing = true;
  syncCatalogRefreshButton();
  try {
    const result = await api('/api/overtime/gifts/refresh', {});
    applyGiftCatalog(result.data);
    toast(`已同步 ${giftCatalogSnapshot.count} 个服务器礼物`);
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
  saleGiftIds = new Set(saleGifts.map((gift) => String(gift.id)));
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
  syncRuleAvailability();
  // Keep an already-open picker in sync with a pushed catalog revision.
  // Local-search mode remains selected; only its availability labels are
  // refreshed, so an update cannot discard the user's current query.
  const picker = byId('overtimeGiftPicker');
  if (picker?.open) renderGiftPicker();
}

function renderGiftCatalogStatus() {
  const status = byId('overtimeGiftCatalogStatus');
  if (!giftCatalogSnapshot?.refreshedAt) {
    status.textContent = '服务器目录：未同步';
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
  const isServerCatalog = giftCatalogSnapshot.source === 'server';
  const sourceLabel = isServerCatalog
    ? giftCatalogSnapshot.stale
      ? '服务器快照（可能过期）'
      : '服务器快照'
    : catalogRoomLabel(giftCatalogSnapshot, catalogLiveStatus);
  status.textContent = `${isServerCatalog ? '服务器目录' : '在售目录'}：${Number(giftCatalogSnapshot.count) || 0} 个 · ${sourceLabel}${timeLabel ? ` · ${timeLabel}` : ''}`;
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
  button.textContent = catalogRefreshing ? '同步中…' : '同步服务器礼物';
}

function syncRuleAvailability() {
  const hasSnapshot = Boolean(giftCatalogSnapshot?.refreshedAt);
  for (const row of byId('overtimeRules').querySelectorAll(
    '[data-overtime-rule]',
  )) {
    const giftId = String(row.dataset.giftId || '');
    const available = giftId.startsWith('guard-') || saleGiftIds.has(giftId);
    row.classList.toggle('is-unavailable', hasSnapshot && !available);
    const identity = row.querySelector('.overtime-rule-identity');
    if (!identity) continue;
    let status = identity.querySelector('[data-rule-sale-status]');
    if (!status) {
      status = document.createElement('small');
      status.className = 'overtime-rule-sale-status';
      status.dataset.ruleSaleStatus = 'true';
      identity.append(status);
    }
    status.hidden = !hasSnapshot || giftId.startsWith('guard-');
    status.textContent = available ? '目录中' : '当前未在售（目录外）';
  }
}

function openGiftPicker() {
  const search = byId('overtimeGiftSearch');
  search.value = '';
  localGiftMatches = [];
  giftPickerSource = 'sale';
  renderGiftPicker();
  byId('overtimeGiftPicker').showModal();
  search.focus();
}

function handleGiftSearchInput() {
  giftPickerSource = 'sale';
  renderGiftPicker();
}

function handleGiftSearchKeydown(event) {
  if (event.key !== 'Enter') return;
  event.preventDefault();
  searchLocalGifts();
}

async function searchLocalGifts() {
  if (localGiftSearchPending) return;
  const query = byId('overtimeGiftSearch').value.trim();
  if (!query || Array.from(query).length > 100) {
    showError(new Error('请输入 1–100 个字符的礼物名称或 ID。'));
    return;
  }
  localGiftSearchPending = true;
  syncLocalGiftSearchButton();
  try {
    const result = await api('/api/overtime/gifts/local/search', { query });
    localGiftMatches = (
      Array.isArray(result.data?.gifts) ? result.data.gifts : []
    ).map((gift) => ({
      id: String(gift.id),
      name: String(gift.name || gift.id),
      rmb: Number(gift.rmb) || 0,
      imagePath: String(gift.imagePath || ''),
    }));
    giftPickerSource = 'local';
    renderGiftPicker();
  } catch (_) {
  } finally {
    localGiftSearchPending = false;
    syncLocalGiftSearchButton();
  }
}

function syncLocalGiftSearchButton() {
  const button = byId('overtimeLocalGiftSearchBtn');
  if (!button) return;
  button.disabled = localGiftSearchPending;
  button.textContent = localGiftSearchPending ? '搜索中…' : '搜索本地礼物';
}

function renderGiftPicker() {
  const root = byId('overtimeGiftResults');
  const query = byId('overtimeGiftSearch').value.trim().toLocaleLowerCase();
  const selectedIds = new Set(
    Array.from(
      byId('overtimeRules').querySelectorAll('[data-overtime-rule]'),
    ).map((row) => row.dataset.giftId),
  );
  const source = giftPickerSource === 'local' ? localGiftMatches : catalog;
  const matches = source.filter(
    (gift) =>
      !selectedIds.has(gift.id) &&
      (!query ||
        gift.id.toLocaleLowerCase().includes(query) ||
        gift.name.toLocaleLowerCase().includes(query)),
  );
  root.replaceChildren();
  if (giftPickerSource === 'local' && matches.length) {
    root.append(
      createMessage(
        'overtime-rule-empty overtime-local-gift-search-status',
        `本地匹配 ${matches.length} 个；这些礼物可手动加入，不要求当前在售。`,
      ),
    );
  }
  for (const gift of matches) {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'overtime-gift-option';
    const image = document.createElement('img');
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
      const availability =
        giftPickerSource === 'local'
          ? saleGiftIds.has(gift.id)
            ? '目录中'
            : '当前未在售（目录外）'
          : '';
      meta.textContent = `ID ${gift.id} · ¥${gift.rmb.toFixed(2)}${availability ? ` · ${availability}` : ''}`;
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
        giftPickerSource === 'local'
          ? '本地没有已下载图片的匹配礼物。'
          : '没有找到这个服务器目录礼物。',
      ),
    );
}

function addGiftRule(gift) {
  const row = ruleEditor.createRule(gift);
  syncRuleAvailability();
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
