import { getBlindBoxIcon, loadGiftArtworkCatalog } from './artwork-catalog.js';
// 编写人：Aurora
// 盲盒映射编辑、官方奖池与房间在售目录。
('use strict');

import { stateService } from '../state.js';
import { eventBus, Events } from '../../shared/event-bus.js';
import { escapeHtml, escapeAttr } from '../../shared/html-escape.js';
import { formatMoney } from '../../shared/display-format.js';
import { readJsonResponse } from '../../shared/json-response.js';
import { GIFT_PLACEHOLDER, setGiftArtworkFallbacks } from '../../shared/gift-image.js';

export const giftBlindbox = (() => {
  let disposeMapping = null;
  let lifecycleRevision = 0;
  let officialBlindBoxes = [];
  let officialCatalogLoadPromise = null;
  let saleGiftIds = new Set();
  let saleVariantIds = new Set();
  let saleCatalogRevision = 0;
  let saleCatalogLoadPromise = Promise.resolve();
  let saleRoomId = '';

  function isBlindBoxAvailable(item) {
    return item.variantId ? saleVariantIds.has(item.variantId) : saleGiftIds.has(String(item.giftId));
  }

  /**
   * 渲染盲盒映射配置列表
   */
  function renderBlindBoxList() {
    const container = document.getElementById('blindBoxList');
    if (!container) return;
    const textarea = document.getElementById('giftBlindBoxCustomConfigV2');
    if (!textarea) return;
    const toggle = document.getElementById('blindBoxListToggle');
    const expanded = toggle?.getAttribute('aria-expanded') === 'true';
    if (toggle) toggle.hidden = true;

    const raw = (textarea.value || '').trim();
    let config = [];
    try {
      const parsed = raw ? JSON.parse(raw) : [];
      if (parsed !== null && !Array.isArray(parsed)) throw new Error('不是数组');
      if (parsed === null && textarea.dataset?.dirty !== 'true') {
        textarea.value = '';
      }
      config = Array.isArray(parsed) ? parsed : [];
    } catch (e) {
      container.innerHTML = '<span class="hint">配置格式错误</span>';
      return;
    }

    const entries = [
      ...officialBlindBoxes.map((item) => ({ ...item, official: true })),
      ...config.map((item, index) => ({ ...item, index, official: false })),
    ].sort(
      (left, right) =>
        Number(isBlindBoxAvailable(right)) - Number(isBlindBoxAvailable(left)) ||
        String(left.name || '未命名').localeCompare(String(right.name || '未命名'), 'zh-Hans-CN'),
    );
    const otherCount = entries.filter((item) => !isBlindBoxAvailable(item)).length;
    if (toggle) {
      toggle.hidden = otherCount === 0;
      toggle.textContent = expanded ? `收起其余盲盒（${otherCount}） ▴` : `展开其余盲盒（${otherCount}） ▾`;
    }
    renderBlindBoxMappingStatus();
    if (entries.length === 0) {
      container.innerHTML = '<span class="hint">暂无盲盒配置</span>';
      return;
    }

    container.innerHTML = entries
      .map((item) => {
        const name = escapeHtml(item.name || '未命名');
        const price = formatMoney(item.price);
        const outputs = Array.isArray(item.outputs)
          ? item.outputs
              .map((o) => {
                if (typeof o === 'object' && o !== null) {
                  const outputId = escapeHtml(String(o.giftId || ''));
                  const outputPrice = Number(o.price);
                  return `<span class="bb-output">${escapeHtml(o.name)}${outputId ? `<small>#${outputId}</small>` : ''}${Number.isFinite(outputPrice) && outputPrice > 0 ? `<small>${formatMoney(outputPrice)}</small>` : ''}</span>`;
                }
                return escapeHtml(String(o));
              })
              .join('')
          : '—';

        const icon = getBlindBoxIcon({
          is_blind_box: true,
          blind_box_id: item.giftId || null,
          blind_box_variant_id: item.variantId || null,
          blind_box_name: item.name || '',
        });
        const iconHtml = `<img class="bb-chip-icon" src="${escapeAttr(icon?.src || GIFT_PLACEHOLDER)}" alt="${escapeAttr(icon?.name || item.name || '礼物图片')}">`;

        return `
        <div class="blind-box-chip" data-blind-box-theme="${icon?.theme || 'default'}"${!expanded && !isBlindBoxAvailable(item) ? ' hidden' : ''}>
          ${iconHtml}
          <div class="bb-chip-body">
            <div class="bb-chip-head">
              <span class="bb-chip-name">${name}</span>
              ${item.official ? `<small class="hint">#${escapeHtml(String(item.giftId))}</small>` : ''}
              <span class="bb-chip-price">${price}</span>
            </div>
            <div class="bb-chip-outputs">${outputs}</div>
          </div>
          ${item.official ? '' : `<button class="chip-delete" data-blind-index="${item.index}" title="删除">✕</button>`}
        </div>
      `;
      })
      .join('');
    if (!expanded && otherCount === entries.length) {
      const message = saleRoomId
        ? '暂未获取到当前直播间可送的盲盒，可展开查看其余映射'
        : '尚未设置直播间，可展开查看全部盲盒设置';
      container.innerHTML = `<span class="hint">${message}</span>${container.innerHTML}`;
    }
    setGiftArtworkFallbacks(container);
  }

  function renderBlindBoxMappingStatus() {
    const status = document.getElementById('blindBoxMappingStatus');
    if (!status) return;
    const mapping = stateService.getAppState()?.blindBoxMapping;
    if (!mapping) {
      status.hidden = false;
      status.textContent = '正在读取服务器映射状态';
      return;
    }
    const parts = mapping.applied ? [] : ['等待服务器应用盲盒映射'];
    if (Number(mapping.customCount) > 0) {
      parts.push(`自定义 ${Number(mapping.customCount)} 项`);
    }
    if (Number(mapping.takenOverCount) > 0) {
      parts.push(`服务器已接管 ${Number(mapping.takenOverCount)} 项`);
    }
    status.textContent = parts.join(' · ');
    status.hidden = parts.length === 0;
  }

  function applyOfficialCatalogSnapshot(snapshot) {
    // Catalog updates also carry room sale snapshots without official relations.
    if (typeof snapshot?.roomId === 'string' && !Array.isArray(snapshot?.blindBoxes)) {
      applySaleCatalogSnapshot(snapshot);
      return;
    }
    const gifts = Array.isArray(snapshot?.gifts) ? snapshot.gifts : [];
    const identityMode = snapshot.schemaVersion === 3;
    const giftById = new Map(gifts.map((gift) => [String(identityMode ? gift.variantId : gift.id), gift]));
    const relationById = new Map(
      (identityMode ? snapshot.variantBlindBoxes || [] : snapshot.blindBoxes || []).map((relation) => [
        String(identityMode ? relation.variantId : relation.giftId),
        relation,
      ]),
    );
    officialBlindBoxes = gifts
      .filter((gift) => {
        if (gift?.giftCategory !== 'blindBox') return false;
        const relation = relationById.get(String(identityMode ? gift.variantId : gift.id));
        // A catalog label alone does not establish a verified prize pool.
        return identityMode
          ? relation?.outputVariantIds?.length || relation?.awards?.length
          : relation?.outputGiftIds?.length;
      })
      .map((gift) => {
        const giftId = String(gift.id);
        const relation = relationById.get(identityMode ? gift.variantId : giftId);
        return {
          giftId,
          variantId: gift.variantId,
          name: gift.name,
          price: gift.rmb,
          outputs: [
            ...((identityMode ? relation?.outputVariantIds : relation?.outputGiftIds) || []).map((outputGiftId) => {
              const output = giftById.get(String(outputGiftId));
              return {
                giftId: String(output?.id || outputGiftId),
                name: output?.name || `礼物 ${outputGiftId}`,
                price: output?.rmb ?? null,
              };
            }),
            ...(relation?.awards || []).map((award) => ({
              name: award.name,
              price: award.valueRmb,
            })),
          ],
        };
      });
    renderBlindBoxList();
  }

  function applySaleCatalogSnapshot(snapshot) {
    if (!saleRoomId || String(snapshot?.roomId || '') !== saleRoomId) return;
    saleCatalogRevision += 1;
    const gifts = Array.isArray(snapshot?.gifts) ? snapshot.gifts : [];
    saleGiftIds = new Set(gifts.map((gift) => String(gift.id)));
    saleVariantIds = new Set(gifts.map((gift) => gift.variantId).filter(Boolean));
    renderBlindBoxList();
  }

  function loadSaleCatalog() {
    const requestRevision = ++saleCatalogRevision;
    saleGiftIds = new Set();
    saleVariantIds = new Set();
    renderBlindBoxList();
    // Serialize room changes so the shared refresh cannot reuse our old room's
    // in-flight request. Skip queued contexts that have already been replaced.
    saleCatalogLoadPromise = saleCatalogLoadPromise.then(async () => {
      if (requestRevision !== saleCatalogRevision || !saleRoomId) return;
      try {
        for (let attempt = 0; attempt < 2; attempt += 1) {
          const response = await fetch('/api/overtime/gifts/refresh', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: '{}',
          });
          const payload = await readJsonResponse(response, '在售礼物目录加载失败');
          if (!response.ok || payload?.ok === false) throw new Error(payload.error);
          if (requestRevision !== saleCatalogRevision) return;
          // The overtime picker may already be refreshing a different room.
          if (String(payload?.data?.roomId || '') !== saleRoomId) continue;
          applySaleCatalogSnapshot(payload.data);
          eventBus.emit(Events.GIFT_CATALOG_UPDATED, {
            snapshot: payload.data,
          });
          return;
        }
      } catch (error) {
        console.warn('[BlindBox] sale catalog load failed:', error.message || error);
      }
    });
    return saleCatalogLoadPromise;
  }

  function updateSaleRoom(settings, { force = false } = {}) {
    const roomId = String(settings?.roomId || '').trim();
    if (roomId === saleRoomId && !force) return;
    saleRoomId = roomId;
    loadSaleCatalog();
  }

  function loadOfficialCatalog() {
    if (officialCatalogLoadPromise) return officialCatalogLoadPromise;
    const requestLifecycle = lifecycleRevision;
    const pending = fetch('/api/overtime/gifts/catalog')
      .then((response) => readJsonResponse(response, '礼物目录加载失败'))
      .then(async (payload) => {
        if (payload?.ok === false) throw new Error(payload.error);
        // Initial icons must refresh without waiting for unrelated state pushes.
        if (requestLifecycle !== lifecycleRevision) return;
        await loadGiftArtworkCatalog();
        if (requestLifecycle === lifecycleRevision) applyOfficialCatalogSnapshot(payload?.data);
      })
      .catch((error) => {
        console.warn('[BlindBox] catalog refresh failed:', error.message || error);
      })
      .finally(() => {
        if (officialCatalogLoadPromise === pending) officialCatalogLoadPromise = null;
      });
    officialCatalogLoadPromise = pending;
    return pending;
  }

  function init() {
    if (disposeMapping) return disposeMapping;
    const onSettings = (event) => updateSaleRoom(event.detail);
    const unsubscribeCatalog = eventBus.on(Events.GIFT_CATALOG_UPDATED, ({ snapshot } = {}) => {
      if (Array.isArray(snapshot?.gifts)) applyOfficialCatalogSnapshot(snapshot);
    });
    const unsubscribeSaved = eventBus.on(Events.STATE_SAVED, ({ settings }) => updateSaleRoom(settings, { force: true }));
    window.addEventListener('app:settings-state', onSettings);
    document.addEventListener('app:bilibili-auth-changed', loadSaleCatalog);
    const dispose = () => {
      if (disposeMapping !== dispose) return;
      unsubscribeCatalog();
      unsubscribeSaved();
      window.removeEventListener('app:settings-state', onSettings);
      document.removeEventListener('app:bilibili-auth-changed', loadSaleCatalog);
      saleCatalogRevision += 1;
      lifecycleRevision += 1;
      officialCatalogLoadPromise = null;
      saleRoomId = '';
      disposeMapping = null;
    };
    disposeMapping = dispose;
    void loadOfficialCatalog();
    updateSaleRoom(stateService.getAppState()?.settings);
    return dispose;
  }

  return { init, renderBlindBoxList, renderBlindBoxMappingStatus, applyOfficialCatalogSnapshot };
})();
