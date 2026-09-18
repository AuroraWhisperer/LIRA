'use strict';

import { escapeAttr, escapeHtml, formatDateTime } from '../../shared/utils.js';

// View snapshots are read-only; request, pagination and clearing state belong to history.js.
export function renderHistoryLoadingView(view) {
  renderHistoryNoticeView(
    {
      label:
        view.clearOutcome === 'remote-cleared'
          ? '云端记录已清空，本机记录尚未更新。'
          : view.clearOutcome || view.hasRows
            ? '正在更新礼物记录…'
            : '正在加载礼物记录…',
    },
    view,
  );
}

export function renderHistoryErrorView(view) {
  renderHistoryNoticeView(
    {
      state: 'error',
      label:
        view.clearOutcome === 'cleared'
          ? '礼物记录已清空，列表暂未更新。'
          : view.clearOutcome === 'remote-cleared'
            ? '云端记录已清空，本机记录尚未更新。'
            : view.hasRows
              ? '记录暂未更新，请稍后重试。'
              : '暂时无法加载礼物记录。',
      detail: '请稍后重试。',
      retry: true,
    },
    view,
  );
}

export function renderHistoryWaitingView(view) {
  const slow = view.slow;
  renderHistoryNoticeView(
    {
      label:
        view.clearOutcome === 'remote-cleared'
          ? '云端记录已清空，本机记录尚未更新。'
          : slow
            ? '更新较慢，请稍后重试。'
            : view.hasRows
              ? '正在更新，当前记录可能不完整'
              : '正在更新礼物记录…',
      retry: slow || view.clearOutcome === 'remote-cleared',
    },
    view,
  );
}

export function renderGiftHistoryView(view) {
  const items = view.ledger.items;
  setText('giftHistoryTotal', `共 ${view.ledger.total} 条`);
  const total = get('giftHistoryTotal');
  if (total) total.hidden = false;
  setText('giftHistoryState', items.length === 0 ? '暂无礼物记录' : '已加载');
  setHistoryBody(
    items.length === 0
      ? '<tr><td colspan="7" class="empty"><strong>暂无礼物记录</strong><span>收到礼物后，记录会显示在这里。</span></td></tr>'
      : items.map(renderGiftHistoryRow).join(''),
  );
  renderGiftHistorySortView(view);
  updatePaginationView(false, view);
}

function formatHistoryMoney(value) {
  const number = Number(value);
  if (!Number.isFinite(number) || number <= 0) return '¥0.0';
  return `¥${number.toFixed(1)}`;
}

function renderGiftRemarks(gift) {
  const blindProfit = gift.blindProfit;
  const remarks = [];
  if (gift.isBlindBox) {
    if (blindProfit === null || blindProfit === undefined) {
      remarks.push('<span class="gift-remark-tag blind">盲盒 成本未知</span>');
    } else {
      const profitSign = blindProfit > 0 ? '+' : blindProfit < 0 ? '-' : '';
      const profitClass =
        blindProfit > 0 ? 'profit-up' : blindProfit < 0 ? 'profit-down' : '';
      remarks.push(
        `<span class="gift-remark-tag blind ${profitClass}">盲盒 ${profitSign}${formatHistoryMoney(Math.abs(Number(blindProfit) || 0))}</span>`,
      );
    }
  }
  if (gift.blindBoxName) {
    remarks.push(
      `<span class="gift-remark-tag">${escapeHtml(gift.blindBoxName)}</span>`,
    );
  }

  return remarks;
}

export function renderGiftHistoryRow(item) {
  const gift = item?.gift || {};
  const price = Number(gift.totalPrice || 0);
  const remarks = renderGiftRemarks(gift);

  return `
    <tr data-event-id="${escapeAttr(item?.eventId || '')}">
      <td><input type="checkbox" data-gift-select="${escapeAttr(item?.eventId || '')}" aria-label="选择这条礼物记录" /></td>
      <td>${formatDateTime(gift.createdAt)}</td>
      <td class="gift-name-cell" title="${escapeAttr(gift.giftName || '')}">${escapeHtml(gift.giftName || '未知礼物')}</td>
      <td>${Number(gift.num || 1)}</td>
      <td>${formatHistoryMoney(price)}</td>
      <td class="gift-user-cell" title="${escapeAttr(gift.userName || '')}">${escapeHtml(gift.userName || '观众')}</td>
      <td>${remarks.length ? remarks.join(' ') : '<span class="hint">—</span>'}</td>
    </tr>
  `;
}

export function updatePaginationView(loading, view) {
  const previousButton = get('giftHistoryPrev');
  const nextButton = get('giftHistoryNext');
  if (previousButton) {
    previousButton.disabled = loading || view.ledger.cursorHistory.length === 0;
  }
  if (nextButton) {
    nextButton.disabled =
      loading || !view.ledger.hasMore || !view.ledger.nextCursor;
  }
  setText(
    'giftHistoryPageInfo',
    `第 ${view.ledger.page}/${view.ledger.totalPages} 页`,
  );
}

export function renderGiftHistorySortView(view) {
  getSortableHeaders().forEach((header) => {
    const sort = header.dataset?.sort;
    if (!sort) return;
    const active = sort === view.ledger.sortField;
    header.setAttribute?.(
      'aria-sort',
      active
        ? view.ledger.sortDirection === 'asc'
          ? 'ascending'
          : 'descending'
        : 'none',
    );
    const arrow = header.querySelector?.('.sort-arrow');
    if (arrow) {
      arrow.textContent = active
        ? view.ledger.sortDirection === 'asc'
          ? ' ▲'
          : ' ▼'
        : '';
    }
  });
}

export function describeGiftSyncStatus(syncState, partial) {
  if (syncState === 'LIVE' && !partial) {
    return { state: 'live', label: '礼物记录已更新' };
  }
  if (syncState === 'OFFLINE') {
    return { state: 'offline', label: '当前离线，显示已保存的记录' };
  }
  if (syncState === 'ERROR') {
    return { state: 'error', label: '记录暂未更新，请稍后重试。' };
  }
  return {
    state: 'partial',
    label:
      syncState === 'LEGACY_PARTIAL'
        ? '当前仅能查看部分历史记录。'
        : '正在更新礼物记录…',
  };
}

export function renderHistoryNoticeView(
  { state = 'partial', label, detail = '', retry = false },
  view,
) {
  const hasRows = view.hasRows;
  setText('giftHistoryState', label);
  setSyncNotice({ state, label }, !hasRows);
  const total = get('giftHistoryTotal');
  if (total) total.hidden = !hasRows;
  if (!hasRows) {
    setHistoryBody(
      `<tr><td colspan="7" class="empty"><strong>${escapeHtml(label)}</strong>${detail ? `<span>${escapeHtml(detail)}</span>` : ''}</td></tr>`,
    );
  }
  setRetryButtonView(retry, view);
  updatePaginationView(view.loading, view);
}

export function setSyncNotice({ state, label }, hidden) {
  const element = get('giftLedgerSyncStatus');
  if (!element) return;
  element.dataset.state = state;
  element.hidden = hidden;
  element.textContent = label;
  element.title = '';
}

export function setRetryButtonView(visible, view) {
  const button = get('giftHistoryRetryBtn');
  if (!button) return;
  button.hidden = !visible;
  button.textContent =
    view.clearOutcome === 'remote-cleared'
      ? '重试更新'
      : view.hasRows
        ? '重试'
        : '重新加载';
}

function setHistoryBody(html) {
  const body = get('giftHistoryBody');
  if (body) body.innerHTML = html;
}

function setText(id, value) {
  const element = get(id);
  if (element) element.textContent = value;
}

function get(id) {
  return document.getElementById(id);
}

function getSortableHeaders() {
  return document.querySelectorAll?.('#giftHistoryDrawer th[data-sort]') || [];
}
