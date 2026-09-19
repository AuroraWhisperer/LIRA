import { toast } from '../../shared/utils.js';
import { createGiftExportPreview } from './export-preview.js';

export function createGiftHistoryTools({ state, reload, resetPagination }) {
  const get = (id) => document.getElementById(id);
  let selectionController = null;
  let operation = 0;
  function showPane(pane) {
    document.querySelectorAll?.('#giftHistoryDrawer [data-gift-pane]').forEach((node) => {
      node.hidden = node.dataset.giftPane !== pane;
    });
    get('giftHistoryDrawer').dataset.view = pane;
  }
  const exporter = createGiftExportPreview({ showPane });
  const run = (fn) => Promise.resolve().then(fn).catch((error) => toast(error.message));
  const options = () => ({ ...state.filters, range: 'all', viewRevision: state.viewRevision,
    sortField: state.sortField || 'created_at', sortDirection: state.sortDirection || 'desc' });

  function cancelSelection() {
    operation += 1;
    selectionController?.abort();
    selectionController = null;
    if (get('giftHistoryCancelSelect')) get('giftHistoryCancelSelect').hidden = true;
  }

  function clear() {
    cancelSelection();
    state.selected.clear();
    exporter.close();
    if (get('giftHistorySelectionNotice')) get('giftHistorySelectionNotice').textContent = '';
    update();
  }

  function update() {
    const count = state.selected.size;
    if (get('giftHistorySelectedCount')) get('giftHistorySelectedCount').textContent = `已选 ${count} 条`;
    if (get('giftHistoryExport')) {
      get('giftHistoryExport').disabled = count === 0;
      get('giftHistoryExport').textContent = count ? `导出所选 ${count} 条` : '导出所选';
    }
    const header = get('giftHistorySelectPage');
    const selected = state.items.filter((item) => state.selected.has(item.eventId)).length;
    if (header) { header.checked = state.items.length > 0 && selected === state.items.length; header.indeterminate = selected > 0 && selected < state.items.length; }
    document.querySelectorAll?.('#giftHistoryBody input[data-gift-select]').forEach((input) => {
      input.checked = state.selected.has(input.dataset.giftSelect);
      input.closest('tr').classList.toggle('is-selected', input.checked);
    });
    if (get('giftHistorySelectAll')) {
      get('giftHistorySelectAll').disabled = !state.viewRevision || !state.total;
      get('giftHistorySelectAll').textContent = `选择全部${state.partial ? '已同步' : ''}筛选结果（${state.total} 条）`;
    }
  }

  function applyFilters() {
    if (!get('giftHistoryFilters').reportValidity()) return;
    const filters = { startDate: get('giftHistoryStartDate').value, endDate: get('giftHistoryEndDate').value,
      userQuery: get('giftHistoryUserQuery').value.trim(), giftQuery: get('giftHistoryGiftQuery').value.trim(),
      amountAbove: get('giftHistoryAmountAbove').value };
    if (filters.startDate && filters.endDate && filters.startDate > filters.endDate) {
      get('giftHistoryFilterError').textContent = '开始日期不能晚于结束日期。';
      return;
    }
    get('giftHistoryFilterError').textContent = '';
    state.filters = filters;
    clear();
    resetPagination();
    reload();
  }

  get('giftHistoryFilters')?.addEventListener('submit', (event) => { event.preventDefault(); applyFilters(); });
  get('giftHistoryToday')?.addEventListener('click', () => {
    const day = new Date(Date.now() + 28800000).toISOString().slice(0, 10);
    get('giftHistoryStartDate').value = day;
    get('giftHistoryEndDate').value = day;
    applyFilters();
  });
  get('giftHistoryReset')?.addEventListener('click', () => { get('giftHistoryFilters').reset(); applyFilters(); });
  get('giftHistoryDeselect')?.addEventListener('click', clear);
  get('giftHistoryCancelSelect')?.addEventListener('click', () => {
    cancelSelection();
    get('giftHistorySelectionNotice').textContent = '已取消选择全部。';
  });
  get('giftHistoryBody')?.addEventListener('change', (event) => {
    const id = event.target.dataset.giftSelect;
    if (!id) return;
    if (event.target.checked) state.selected.add(id); else state.selected.delete(id);
    update();
  });
  get('giftHistorySelectPage')?.addEventListener('change', (event) => {
    for (const item of state.items) {
      if (event.target.checked) state.selected.add(item.eventId); else state.selected.delete(item.eventId);
    }
    update();
  });
  get('giftHistorySelectAll')?.addEventListener('click', () => run(async () => {
    cancelSelection();
    selectionController = new AbortController();
    const current = operation;
    get('giftHistoryCancelSelect').hidden = false;
    get('giftHistorySelectionNotice').textContent = '正在取得固定记录快照…';
    try {
      const response = await fetch('/api/gifts/selection', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(options()), signal: selectionController.signal });
      const result = await response.json();
      if (current !== operation) return;
      if (!result.ok) throw new Error(result.error);
      state.selected = new Set(result.data.items.map((item) => item.eventId));
      get('giftHistorySelectionNotice').textContent = `已选 ${state.selected.size} 条${result.data.partial ? '已同步记录，仍可能有记录待补齐' : '记录'}`;
      update();
    } catch (error) { if (current === operation) throw error; }
    finally { if (current === operation) cancelSelection(); }
  }));
  get('giftHistoryExport')?.addEventListener('click', () => run(() => exporter.open({ ...options(), eventIds: [...state.selected] })));
  return { clear, update, showPane, close: () => { cancelSelection(); exporter.close(); } };
}
