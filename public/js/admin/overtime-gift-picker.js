import { createGiftCatalogRoleLookup } from '../shared/gift-catalog-roles.js';
import { setGiftArtwork } from '../shared/gift-image.js';
import { getGuardIcon } from '../shared/bilibili-guard-icons.js';
import { createGiftPickerDialog, isGuardGift } from './gifts/gift-picker-dialog.js';
import { api, readJsonResponse, showError } from '../shared/utils.js';

const GUARD_GIFTS = [
  {
    id: 'guard-1',
    name: '总督',
    guardLevel: 1,
    giftCategory: 'guard',
  },
  {
    id: 'guard-2',
    name: '提督',
    guardLevel: 2,
    giftCategory: 'guard',
  },
  {
    id: 'guard-3',
    name: '舰长',
    guardLevel: 3,
    giftCategory: 'guard',
  },
];

export function createOvertimeGiftPicker({ getLiveStatus, onSelect }) {
  let picker = null;
  let catalog = [];
  let catalogRefreshing = false;
  let globalGiftSearchPending = false;
  let globalGiftSearchError = '';
  let giftPickerGeneration = 0;
  let giftCatalogSnapshot = null;
  let giftCatalogApplyGeneration = 0;
  let globalGiftMatches = [];
  let serverGiftArtworkById = new Map();
  let giftRoleLookup = createGiftCatalogRoleLookup(null);
  let giftRoleRevision = 0;
  let giftPickerSource = 'sale';
  let reselectingRule = null;

  function ensurePicker() {
    if (picker) return picker;
    const dialog = byId('overtimeGiftPicker');
    if (!dialog) return null;
    picker = createGiftPickerDialog({
      dialog,
      title: '添加礼物',
      optionClassName: 'overtime-gift-option',
      ids: {
        title: 'overtimeGiftPickerTitle',
        search: 'overtimeGiftSearch',
        results: 'overtimeGiftResults',
        status: 'overtimeGiftCatalogStatus',
        refresh: 'overtimeRefreshGiftsBtn',
        roomTab: 'overtimeRoomGiftTab',
        allTab: 'overtimeGlobalGiftSearchBtn',
      },
      sourceAttribute: 'overtimeSource',
      roomLabel: '本直播间',
      allLabel: '全部礼物',
      showRefresh: true,
      guardSubtitle: '大航海',
      getRoleLabel: (gift) => giftRoleLookup(gift),
      isDisabled: (gift) => /^\d+$/u.test(gift.id) && !gift.giftIdentity,
      onSelect: addGiftRule,
      onSourceChange: switchGiftPickerSource,
      onRefresh: refreshGiftCatalog,
      onClose() {
        giftPickerGeneration += 1;
        globalGiftSearchPending = false;
        syncSourceTabs();
      },
    });
    renderGiftCatalogStatus();
    syncCatalogRefreshButton();
    syncSourceTabs();
    return picker;
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

  async function refreshGiftCatalog() {
    if (catalogRefreshing) return;
    catalogRefreshing = true;
    syncCatalogRefreshButton();
    try {
      const result = await api('/api/overtime/gifts/refresh', {});
      applyGiftCatalog(result.data);
    } catch (error) {
      showError(error);
    } finally {
      catalogRefreshing = false;
      syncCatalogRefreshButton();
    }
  }

  function applyGiftCatalog(snapshot) {
    giftCatalogApplyGeneration += 1;
    giftCatalogSnapshot = snapshot && typeof snapshot === 'object' ? snapshot : {};
    const saleGifts = Array.isArray(giftCatalogSnapshot.gifts) ? giftCatalogSnapshot.gifts : [];
    catalog = [
      ...GUARD_GIFTS.map((gift, index) => ({
        ...gift,
        catalogGroup: 0,
        catalogOrder: index,
      })),
      ...saleGifts.map((gift) => ({ ...gift, catalogGroup: 1, catalogOrder: 0 })),
    ]
      .map((gift) => ({
        variantId: gift.variantId,
        giftIdentity: gift.giftIdentity,
        giftCategory: gift.giftCategory,
        guardLevel: gift.guardLevel,
        id: String(gift.id),
        name: String(gift.name || gift.id),
        rmb: Number(gift.rmb) || 0,
        catalogGroup: gift.catalogGroup,
        catalogOrder: gift.catalogOrder,
        imagePath: String(
          (gift.guardLevel ? getGuardIcon(gift.guardLevel) : '') ||
            serverGiftArtworkById.get(giftArtworkKey(gift)) ||
            gift.imagePath ||
            (gift.image ? `/img/${String(gift.image).replace(/^\/+/, '')}` : ''),
        ),
      }))
      .sort(
        (left, right) =>
          left.catalogGroup - right.catalogGroup || left.catalogOrder - right.catalogOrder || left.rmb - right.rmb,
      );
    renderGiftCatalogStatus();
    // Keep an open picker in sync without changing its source or search query.
    if (picker?.dialog?.open) renderGiftPicker();
  }

  function applyServerGiftArtwork(snapshot) {
    if (!snapshot || typeof snapshot !== 'object') return;
    if (!Array.isArray(snapshot.gifts)) return;
    applyGiftRoleCatalog(snapshot);

    const nextArtworkById = new Map(serverGiftArtworkById);
    for (const gift of snapshot.gifts) {
      const giftId = giftArtworkKey(gift);
      const imagePath = normalizeGiftArtworkPath(gift?.imagePath);
      if (giftId && imagePath) nextArtworkById.set(giftId, imagePath);
    }
    serverGiftArtworkById = nextArtworkById;

    catalog = catalog.map((gift) => {
      const imagePath = serverGiftArtworkById.get(giftArtworkKey(gift));
      return imagePath ? { ...gift, imagePath } : gift;
    });
    globalGiftMatches = globalGiftMatches.map((gift) => {
      const imagePath = serverGiftArtworkById.get(giftArtworkKey(gift));
      return imagePath ? { ...gift, imagePath } : gift;
    });
    for (const row of byId('overtimeRules').querySelectorAll('[data-overtime-rule]')) {
      const imagePath = serverGiftArtworkById.get(giftArtworkKey({ ...row.dataset, giftIdentity: rowGiftIdentity(row) }));
      if (!imagePath) continue;
      row.dataset.imagePath = imagePath;
      const image = row.querySelector('.overtime-rule-gift img');
      if (image) setGiftArtwork(image, imagePath);
    }
    if (picker?.dialog?.open) renderGiftPicker();
  }

  function applyGiftRoleCatalog(snapshot) {
    if (!Array.isArray(snapshot?.blindBoxes)) return;
    giftRoleLookup = createGiftCatalogRoleLookup(snapshot);
    giftRoleRevision += 1;
  }

  function decorateOvertimeRules(rules) {
    if (!Array.isArray(rules)) return rules;
    return rules.map((rule) => {
      const imagePath = serverGiftArtworkById.get(giftArtworkKey(rule));
      return imagePath ? { ...rule, imagePath } : rule;
    });
  }

  function normalizeGiftArtworkPath(value) {
    const imagePath = String(value ?? '').trim();
    return /^\/overtime-gift-images\/[a-z0-9._-]+\.(?:gif|webp|png|jpe?g)$/i.test(imagePath) && !imagePath.includes('..')
      ? imagePath
      : '';
  }

  function formatCatalogStatusText() {
    if (!giftCatalogSnapshot?.refreshedAt) return '在售目录：未刷新';
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
    const sourceLabel = catalogRoomLabel(giftCatalogSnapshot, getLiveStatus());
    const count = Number(giftCatalogSnapshot.count) || Math.max(0, catalog.length - GUARD_GIFTS.length);
    return `在售目录：${count} 个 · ${sourceLabel}${timeLabel ? ` · ${timeLabel}` : ''}`;
  }

  function renderGiftCatalogStatus() {
    if (!picker) return;
    const sourceLabel = catalogRoomLabel(giftCatalogSnapshot, getLiveStatus());
    const statusText = formatCatalogStatusText();
    picker.setFooterStatus(giftPickerSource === 'global' ? '本机已收录全量礼物目录' : statusText);
    picker.setSubtitle(giftPickerSource === 'global' ? '全量目录' : sourceLabel !== '—' ? sourceLabel : '');
    picker.setRefreshing(catalogRefreshing, statusText);
  }

  function catalogRoomLabel(snapshot, liveStatus) {
    const roomId = String(snapshot?.roomId || '');
    const liveRoomId = String(liveStatus?.roomId || '');
    const ownerName = String(liveStatus?.ownerName || '').trim();
    return ownerName && roomId && liveRoomId === roomId ? ownerName : roomId || '—';
  }

  function syncCatalogRefreshButton() {
    if (!picker) return;
    picker.setRefreshing(catalogRefreshing, formatCatalogStatusText());
  }

  function syncSourceTabs() {
    if (!picker) return;
    picker.setSource(giftPickerSource === 'global' ? 'all' : 'room');
    picker.setSourceDisabled('all', globalGiftSearchPending);
  }

  function openGiftPicker(row = null) {
    const view = ensurePicker();
    if (!view) return;
    reselectingRule = row?.dataset?.overtimeRule ? row : null;
    giftPickerGeneration += 1;
    globalGiftMatches = [];
    globalGiftSearchPending = false;
    globalGiftSearchError = '';
    giftPickerSource = 'sale';
    view.setSourceCount('all', null);
    syncSourceTabs();
    renderGiftCatalogStatus();
    view.open({
      title: reselectingRule ? '重新选择礼物' : '添加礼物',
      source: 'room',
    });
    renderGiftPicker();
    // Refresh the room's live sale list whenever the picker opens. The backend
    // coalesces/throttles requests, so repeated opens do not spam Bilibili, while
    // a changed room is picked up without requiring a separate button click.
    void refreshGiftCatalog();
  }

  async function switchGiftPickerSource(nextSource) {
    const view = ensurePicker();
    if (!view) return;
    if (nextSource === 'room') {
      giftPickerGeneration += 1;
      globalGiftSearchPending = false;
      globalGiftSearchError = '';
      giftPickerSource = 'sale';
      syncSourceTabs();
      renderGiftCatalogStatus();
      renderGiftPicker();
      view.focusSearch();
      return;
    }

    if (globalGiftSearchPending) return;
    if (giftPickerSource === 'global' && !globalGiftSearchError && globalGiftMatches.length) {
      view.focusSearch();
      return;
    }

    const requestGeneration = ++giftPickerGeneration;
    const requestRoleRevision = giftRoleRevision;
    giftPickerSource = 'global';
    globalGiftMatches = [];
    globalGiftSearchError = '';
    globalGiftSearchPending = true;
    syncSourceTabs();
    renderGiftCatalogStatus();
    renderGiftPicker();
    view.focusSearch();

    try {
      const response = await fetch('/api/overtime/gifts/catalog');
      const result = await readJsonResponse(response, '读取礼物库失败');
      if (requestGeneration !== giftPickerGeneration) return;
      if (!result.ok) throw new Error(result.error || '读取礼物库失败');
      if (!Array.isArray(result.data?.gifts)) {
        throw new Error('礼物库尚未缓存。');
      }
      if (requestRoleRevision === giftRoleRevision) applyGiftRoleCatalog(result.data);
      globalGiftMatches = result.data.gifts.map((gift) => ({
        variantId: gift.variantId,
        giftIdentity: gift.giftIdentity,
        giftCategory: gift.giftCategory,
        id: String(gift.id),
        name: String(gift.name || gift.id),
        rmb: Number(gift.rmb) || 0,
        imagePath: serverGiftArtworkById.get(giftArtworkKey(gift)) || String(gift.imagePath || ''),
      }));
    } catch (error) {
      if (requestGeneration !== giftPickerGeneration) return;
      globalGiftSearchError = error.message || '读取礼物库失败';
    } finally {
      if (requestGeneration === giftPickerGeneration) {
        globalGiftSearchPending = false;
        syncSourceTabs();
        renderGiftCatalogStatus();
        renderGiftPicker();
      }
    }
  }

  function readSelectedIds() {
    const selectedIds = new Set();
    const rows = byId('overtimeRules').querySelectorAll('[data-overtime-rule]');
    for (const row of rows) {
      if (row === reselectingRule) continue;
      const gift = { ...row.dataset, giftIdentity: rowGiftIdentity(row) };
      selectedIds.add(giftSelectionKey(gift));
    }
    return selectedIds;
  }

  function renderGiftPicker() {
    const view = ensurePicker();
    if (!view) return;
    const selectedIds = readSelectedIds();
    const unselectedRoom = catalog.filter((gift) => !selectedIds.has(giftSelectionKey(gift)));
    view.setSourceCount('room', unselectedRoom.length);

    if (giftPickerSource === 'global') {
      if (globalGiftSearchPending) {
        view.setItems({ message: '正在读取礼物库…' });
        return;
      }
      if (globalGiftSearchError) {
        view.setItems({ message: globalGiftSearchError, tone: 'error' });
        return;
      }
      const unselectedGlobal = globalGiftMatches.filter((gift) => !selectedIds.has(giftSelectionKey(gift)));
      view.setSourceCount('all', unselectedGlobal.length);
      view.setItems({
        guards: [],
        gifts: unselectedGlobal,
        empty: globalGiftMatches.length ? '全部礼物中没有匹配项。' : '礼物库暂无礼物。',
      });
      return;
    }

    const guards = unselectedRoom.filter(isGuardGift);
    const gifts = unselectedRoom.filter((gift) => !isGuardGift(gift));
    view.setItems({
      guards,
      gifts,
      empty: '没有找到当前在售礼物。',
    });
  }

  function addGiftRule(gift) {
    onSelect(gift, reselectingRule);
    reselectingRule = null;
    picker?.close();
  }

  function bind() {
    ensurePicker();
    byId('overtimeAddGiftBtn').addEventListener('click', () => openGiftPicker());
  }

  return {
    bind,
    open: openGiftPicker,
    load: loadCatalog,
    applyGiftCatalog,
    applyServerGiftArtwork,
    decorateRules: decorateOvertimeRules,
    renderStatus: renderGiftCatalogStatus,
  };
}

function byId(id) {
  return document.getElementById(id);
}

function giftSelectionKey(gift) {
  return gift.giftIdentity?.variantId || gift.variantId || String(gift.giftId ?? gift.id);
}

function giftArtworkKey(gift) {
  return (
    gift.giftIdentity?.variantId ||
    gift.variantId ||
    JSON.stringify([String(gift.giftId ?? gift.id), String(gift.giftName ?? gift.name), gift.rmb ?? null])
  );
}

function rowGiftIdentity(row) {
  return JSON.parse(row.dataset.giftIdentity || 'null');
}
