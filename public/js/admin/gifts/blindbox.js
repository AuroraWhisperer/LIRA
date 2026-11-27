import { getBlindBoxIcon, readOfficialGiftCatalog } from './artwork-catalog.js';
// 编写人：Aurora
// 盲盒映射编辑、官方奖池与房间在售目录。
('use strict');

import { stateService } from '../state.js';
import { observePanelVisibility } from '../panel-visibility.js';
import { eventBus, Events } from '../../shared/event-bus.js';
import { escapeHtml, escapeAttr } from '../../shared/html-escape.js';
import { formatMoney } from '../../shared/display-format.js';
import { readJsonResponse } from '../../shared/json-response.js';
import { GIFT_PLACEHOLDER, setGiftArtworkFallbacks } from '../../shared/gift-image.js';

export const giftBlindbox = (() => {
  let disposeMapping = null;
  let officialCatalogRevision = 0;
  let officialBlindBoxes = [];
  let officialCatalogLoadPromise = null;
  let saleGiftIds = new Set();
  let saleVariantIds = new Set();
  let saleCatalogRevision = 0;
  let saleCatalogLoadPromise = Promise.resolve();
  let saleRoomId = '';
  let saleVisible = false;
  let pendingSaleRead;

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
    const summary = document.getElementById('blindBoxCountSummary');
    const expanded = toggle?.getAttribute('aria-expanded') === 'true';
    if (toggle) toggle.hidden = true;
    if (summary) summary.hidden = true;

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
      container.innerHTML = '<div class="blind-box-empty-notice is-error">自定义配置 JSON 格式有误，请修正后再查看</div>';
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
    const saleCount = entries.length - otherCount;
    if (summary) {
      if (entries.length === 0) {
        summary.hidden = true;
      } else {
        summary.hidden = false;
        summary.textContent =
          saleCount > 0
            ? otherCount > 0
              ? `在售 ${saleCount} 项 · 共 ${entries.length} 项`
              : `在售 ${saleCount} 项`
            : `共 ${entries.length} 项`;
      }
    }
    if (toggle) {
      toggle.hidden = otherCount === 0;
      toggle.textContent = expanded ? `收起其余盲盒（${otherCount}） ▴` : `展开其余盲盒（${otherCount}） ▾`;
    }
    renderBlindBoxMappingStatus();
    if (entries.length === 0) {
      container.innerHTML = '<div class="blind-box-empty-notice">暂无盲盒配置</div>';
      return;
    }

    const chips = entries
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
        const idTag = item.giftId ? `<small class="bb-chip-id">#${escapeHtml(String(item.giftId))}</small>` : '';
        const customBadge = item.official ? '' : '<span class="bb-chip-badge">自定义</span>';

        return `
        <div class="blind-box-chip" data-blind-box-theme="${icon?.theme || 'default'}"${!expanded && !isBlindBoxAvailable(item) ? ' hidden' : ''}>
          ${iconHtml}
          <div class="bb-chip-body">
            <div class="bb-chip-head">
              <span class="bb-chip-name">${name}</span>
              ${customBadge}
              ${idTag}
              <span class="bb-chip-price">${price}</span>
            </div>
            <div class="bb-chip-outputs">${outputs}</div>
          </div>
          ${item.official ? '' : `<button class="chip-delete" data-blind-index="${item.index}" type="button" title="删除自定义盲盒" aria-label="删除自定义盲盒 ${escapeAttr(item.name || '未命名')}">✕</button>`}
        </div>
      `;
      })
      .join('');
    let hint = '';
    if (!expanded && otherCount === entries.length) {
      const message = saleRoomId
        ? '当前直播间暂未检测到在售盲盒，可展开查看其余盲盒'
        : '尚未绑定直播间，可展开查看全部盲盒';
      hint = `<div class="blind-box-empty-notice">${message}</div>`;
    }
    container.innerHTML = hint + chips;
    setGiftArtworkFallbacks(container);
  }

  function renderBlindBoxMappingStatus() {
    const status = document.getElementById('blindBoxMappingStatus');
    if (!status) return;
    const mapping = stateService.getAppState()?.blindBoxMapping;
    if (!mapping) {
      status.hidden = false;
      status.textContent = '正在同步盲盒配置…';
      if (status.dataset) status.dataset.tone = 'pending';
      return;
    }
    const parts = mapping.applied ? [] : ['配置已保存，等待云端生效'];
    if (Number(mapping.customCount) > 0) {
      parts.push(`自定义 ${Number(mapping.customCount)} 项`);
    }
    if (Number(mapping.takenOverCount) > 0) {
      parts.push(`官方已接管 ${Number(mapping.takenOverCount)} 项`);
    }
    status.textContent = parts.join(' · ');
    status.hidden = parts.length === 0;
    if (status.dataset) status.dataset.tone = mapping.applied ? '' : 'pending';
  }

  function applyOfficialCatalogSnapshot(snapshot) {
    // Catalog updates also carry room sale snapshots without official relations.
    if (!Array.isArray(snapshot?.blindBoxes)) {
      applySaleCatalogSnapshot(snapshot);
      return;
    }
    officialCatalogRevision += 1;
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
    pendingSaleRead = null;
    saleCatalogRevision += 1;
    const gifts = Array.isArray(snapshot?.gifts) ? snapshot.gifts : [];
    saleGiftIds = new Set(gifts.map((gift) => String(gift.id)));
    saleVariantIds = new Set(gifts.map((gift) => gift.variantId).filter(Boolean));
    renderBlindBoxList();
  }

  function invalidateSaleCatalog(checkCache = false) {
    ++saleCatalogRevision;
    saleGiftIds = new Set();
    saleVariantIds = new Set();
    renderBlindBoxList();
    pendingSaleRead = checkCache ? 'cache' : 'refresh';
    readSaleCatalog();
  }

  function readSaleCatalog() {
    if (!saleVisible || !saleRoomId || !pendingSaleRead) return;
    const requestRevision = saleCatalogRevision;
    const read = pendingSaleRead;
    pendingSaleRead = null;
    // Serialize room changes so the shared refresh cannot reuse our old room's
    // in-flight request. Skip queued contexts that have already been replaced.
    saleCatalogLoadPromise = saleCatalogLoadPromise.then(async () => {
      if (requestRevision !== saleCatalogRevision || !saleRoomId) return;
      if (!saleVisible) { pendingSaleRead = read; return; }
      try {
        if (read === 'cache') {
          const response = await fetch('/api/overtime/gifts');
          const payload = await readJsonResponse(response, '在售礼物目录加载失败');
          if (requestRevision !== saleCatalogRevision) return;
          if (response.ok && payload.ok && String(payload.data?.roomId) === saleRoomId) {
            eventBus.emit(Events.GIFT_CATALOG_UPDATED, { snapshot: payload.data });
            return;
          }
        }
        for (let attempt = 0; attempt < 2; attempt += 1) {
          if (!saleVisible) { pendingSaleRead = 'refresh'; return; }
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
          eventBus.emit(Events.GIFT_CATALOG_UPDATED, {
            snapshot: payload.data,
          });
          return;
        }
      } catch (error) {
        if (requestRevision !== saleCatalogRevision) return;
        pendingSaleRead = read;
        console.warn('[BlindBox] sale catalog load failed:', error.message || error);
      }
    });
    return saleCatalogLoadPromise;
  }

  function updateSaleRoom(settings, { force = false } = {}) {
    const roomId = String(settings?.roomId || '').trim();
    if (roomId === saleRoomId && !force) return;
    const checkCache = !saleRoomId && !force;
    saleRoomId = roomId;
    invalidateSaleCatalog(checkCache);
  }

  function loadOfficialCatalog() {
    if (officialCatalogLoadPromise) return officialCatalogLoadPromise;
    const requestRevision = officialCatalogRevision;
    const pending = readOfficialGiftCatalog()
      .then((snapshot) => {
        if (requestRevision === officialCatalogRevision && Array.isArray(snapshot?.gifts)) applyOfficialCatalogSnapshot(snapshot);
      })
      .catch((error) => {
        if (requestRevision === officialCatalogRevision) {
          console.warn('[BlindBox] catalog refresh failed:', error.message || error);
        }
      })
      .finally(() => {
        if (officialCatalogLoadPromise === pending) officialCatalogLoadPromise = null;
      });
    officialCatalogLoadPromise = pending;
    return pending;
  }

  function init() {
    if (disposeMapping) return disposeMapping;
    const section = document.querySelector?.('.gift-blindbox-mapping-panel');
    const toggle = document.getElementById('blindBoxMappingToggle');
    const panelHeader = section?.querySelector?.('.panel-header');
    const collapsible = document.getElementById('blindBoxMappingCollapsible');
    const setCollapsed = (collapsed) => {
      if (collapsed && collapsible?.contains?.(document.activeElement)) toggle?.focus?.();
      section?.classList?.toggle('is-collapsed', collapsed);
      if (collapsible) {
        collapsible.inert = collapsed;
        collapsible.setAttribute?.('aria-hidden', String(collapsed));
      }
      if (toggle) {
        toggle.setAttribute?.('aria-expanded', String(!collapsed));
        toggle.title = collapsed ? '展开盲盒设置' : '折叠盲盒设置';
      }
    };
    setCollapsed(section?.classList?.contains('is-collapsed') || false);
    const onHeaderClick = (event) => {
      if (event.target?.closest?.('lira-help')) return;
      if (!event.target?.closest?.('#blindBoxMappingHeading, #blindBoxMappingToggle')) return;
      setCollapsed(!section?.classList?.contains('is-collapsed'));
    };
    panelHeader?.addEventListener?.('click', onHeaderClick);

    const list = document.getElementById('blindBoxList');
    const stopVisibility = list && observePanelVisibility(list, visible => {
      saleVisible = visible;
      if (visible) readSaleCatalog();
    });
    const onSettings = (event) => updateSaleRoom(event.detail);
    const onAuth = () => invalidateSaleCatalog();
    const unsubscribeCatalog = eventBus.on(Events.GIFT_CATALOG_UPDATED, ({ snapshot } = {}) => {
      if (Array.isArray(snapshot?.gifts)) applyOfficialCatalogSnapshot(snapshot);
    });
    const unsubscribeSaved = eventBus.on(Events.STATE_SAVED, ({ settings }) => updateSaleRoom(settings, { force: true }));
    window.addEventListener('app:settings-state', onSettings);
    document.addEventListener('app:bilibili-auth-changed', onAuth);
    const dispose = () => {
      if (disposeMapping !== dispose) return;
      panelHeader?.removeEventListener?.('click', onHeaderClick);
      unsubscribeCatalog();
      unsubscribeSaved();
      window.removeEventListener('app:settings-state', onSettings);
      document.removeEventListener('app:bilibili-auth-changed', onAuth);
      stopVisibility?.();
      saleVisible = false;
      pendingSaleRead = null;
      saleCatalogRevision += 1;
      officialCatalogRevision += 1;
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
