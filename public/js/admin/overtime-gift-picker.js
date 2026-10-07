import { createGiftCatalogRoleLookup } from '../shared/gift-catalog-roles.js';
import { giftSelectionKey, giftArtworkKey, rowGiftIdentity } from './overtime-gift-identity.js';
import { setGiftImage } from '../shared/gift-image-fallback.js';
import { createGiftPickerButton } from './gifts/picker-option.js';
import { api, readJsonResponse, showError, toast } from '../shared/utils.js';

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

export function createOvertimeGiftPicker({ getLiveStatus, onSelect }) {
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
        id: String(gift.id),
        name: String(gift.name || gift.id),
        rmb: Number(gift.rmb) || 0,
        catalogGroup: gift.catalogGroup,
        catalogOrder: gift.catalogOrder,
        imagePath: String(
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
    const picker = byId('overtimeGiftPicker');
    if (picker?.open) renderGiftPicker();
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
      if (image) setGiftImage(image, imagePath);
    }
    const picker = byId('overtimeGiftPicker');
    if (picker?.open) renderGiftPicker();
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
    const sourceLabel = catalogRoomLabel(giftCatalogSnapshot, getLiveStatus());
    status.textContent = `在售目录：${Number(giftCatalogSnapshot.count) || 0} 个 · ${sourceLabel}${timeLabel ? ` · ${timeLabel}` : ''}`;
  }

  function catalogRoomLabel(snapshot, liveStatus) {
    const roomId = String(snapshot?.roomId || '');
    const liveRoomId = String(liveStatus?.roomId || '');
    const ownerName = String(liveStatus?.ownerName || '').trim();
    return ownerName && roomId && liveRoomId === roomId ? ownerName : roomId || '—';
  }

  function syncCatalogRefreshButton() {
    const button = byId('overtimeRefreshGiftsBtn');
    if (!button) return;
    button.disabled = catalogRefreshing;
    button.textContent = catalogRefreshing ? '刷新中…' : '刷新在售礼物';
  }

  function openGiftPicker(row = null) {
    reselectingRule = row?.dataset?.overtimeRule ? row : null;
    byId('overtimeGiftPickerTitle').textContent = reselectingRule ? '重新选择礼物' : '添加礼物';
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
    void refreshGiftCatalog({ notify: false });
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
    const requestRoleRevision = giftRoleRevision;
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
      if (requestRoleRevision === giftRoleRevision) applyGiftRoleCatalog(result.data);
      globalGiftMatches = result.data.gifts.map((gift) => ({
        variantId: gift.variantId,
        giftIdentity: gift.giftIdentity,
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
    if (giftPickerSource === 'global' && (globalGiftSearchPending || globalGiftSearchError)) {
      appendPickerMessage(
        root,
        'overtime-rule-empty overtime-local-gift-search-status',
        globalGiftSearchPending ? '正在读取礼物库…' : globalGiftSearchError,
      );
      return;
    }
    const query = byId('overtimeGiftSearch').value.trim().toLocaleLowerCase();
    const selectedIds = new Set();
    const rows = byId('overtimeRules').querySelectorAll('[data-overtime-rule]');
    for (const row of rows) {
      if (row === reselectingRule) continue;
      const gift = { ...row.dataset, giftIdentity: rowGiftIdentity(row) };
      selectedIds.add(giftSelectionKey(gift));
    }
    const source = giftPickerSource === 'global' ? globalGiftMatches : catalog;
    const matches = filterGiftOptions(source, selectedIds, query);
    if (giftPickerSource === 'global' && matches.length) {
      appendPickerMessage(
        root,
        'overtime-rule-empty overtime-local-gift-search-status',
        `礼物库 · ${matches.length} / ${globalGiftMatches.length} 个`,
      );
    }
    for (const gift of matches) root.append(createGiftOption(gift));
    if (!matches.length)
      appendPickerMessage(
        root,
        'overtime-rule-empty',
        giftPickerSource === 'global'
          ? globalGiftMatches.length
            ? '全部礼物中没有匹配项。'
            : '礼物库暂无礼物。'
          : '没有找到当前在售礼物。',
      );
  }

  function filterGiftOptions(source, selectedIds, query) {
    return source.filter(
      (gift) =>
        !selectedIds.has(giftSelectionKey(gift)) &&
        (!query || gift.id.toLocaleLowerCase().includes(query) || gift.name.toLocaleLowerCase().includes(query)),
    );
  }

  function createGiftOption(gift) {
    const button = createGiftPickerButton(gift, { className: 'overtime-gift-option',
      disabled: /^\d+$/u.test(gift.id) && !gift.giftIdentity, onSelect: addGiftRule });
    const text = document.createElement('span');
    const name = document.createElement('strong');
    name.textContent = gift.name;
    text.append(name);
    if (!gift.id.startsWith('guard-')) {
      const meta = document.createElement('small');
      meta.textContent = [
        `ID ${gift.id} · ¥${gift.rmb.toFixed(2)}`,
        giftRoleLookup(gift),
        gift.giftIdentity?.bagGift ? '背包礼物' : '',
      ]
        .filter(Boolean)
        .join(' · ');
      if (button.disabled) meta.textContent += ' · 资料待同步，请刷新礼物库';
      text.append(meta);
    }
    button.append(text);
    return button;
  }

  function appendPickerMessage(root, className, message) {
    const node = document.createElement('div');
    node.className = className;
    node.textContent = message;
    root.append(node);
  }

  function addGiftRule(gift) {
    onSelect(gift, reselectingRule);
    reselectingRule = null;
    byId('overtimeGiftPicker').close();
  }

  function bind() {
    byId('overtimeRefreshGiftsBtn').addEventListener('click', refreshGiftCatalog);
    byId('overtimeAddGiftBtn').addEventListener('click', openGiftPicker);
    byId('overtimeGiftSearch').addEventListener('input', handleGiftSearchInput);
    byId('overtimeGiftSearch').addEventListener('keydown', handleGiftSearchKeydown);
    byId('overtimeGlobalGiftSearchBtn').addEventListener('click', toggleGiftPickerSource);
  }
  return { bind, open: openGiftPicker, load: loadCatalog, applyGiftCatalog, applyServerGiftArtwork,
    decorateRules: decorateOvertimeRules, renderStatus: renderGiftCatalogStatus };
}

function byId(id) {
  return document.getElementById(id);
}
