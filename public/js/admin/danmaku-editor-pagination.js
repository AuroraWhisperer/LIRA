const pagers = new WeakMap();
const contexts = new WeakMap();

export function revealEditorItem(list, index) {
  pagers.get(list)?.layout(index);
}

export function setEditorPageContext(list, context) {
  contexts.set(list, context);
  pagers.get(list)?.refresh();
}

export function createEditorPagination({ list, pagination, rowSelector, search, windowRef }) {
  const documentRef = list.ownerDocument;
  if (!pagination) {
    pagination = documentRef.createElement('div');
    pagination.className = 'danmaku-library-pagination';
    pagination.hidden = true;
    pagination.innerHTML = '<button type="button" class="ghost">上一页</button><span class="hint"></span><button type="button" class="ghost">下一页</button>';
    list.after(pagination);
  }
  list.classList.add('danmaku-editor-list');
  const [previous, next] = pagination.querySelectorAll('button');
  const label = pagination.querySelector('span');
  let ranges = [], page = 0, anchor = 0, offset = 0, frame = 0;

  function layout(target) {
    if (target !== undefined) anchor = target;
    if (!list.clientHeight) {
      pagination.hidden = true;
      return;
    }
    const context = contexts.get(list) || {};
    if ((context.offset || 0) !== offset) {
      anchor = context.offset > offset ? 0 : Infinity;
      offset = context.offset;
    }
    const allRows = [...list.querySelectorAll(rowSelector)];
    const query = search?.value.trim().toLocaleLowerCase() || '';
    const rows = query ? allRows.filter(row => `${row.textContent} ${row.dataset.search || ''}`.toLocaleLowerCase().includes(query)) : allRows;
    const matching = new Set(rows);
    for (const row of allRows) row.hidden = !matching.has(row);
    const groups = [...list.querySelectorAll('.danmaku-query-reply-group')];
    for (const group of groups) group.hidden = !rows.some(row => group.contains(row));
    const focused = rows.findIndex(row => row.contains(documentRef.activeElement));
    anchor = target ?? (focused >= 0 ? focused : anchor);
    const external = Boolean(context.previous || context.next);
    pagination.hidden = !external;
    if (!rows.length) {
      ranges = [];
      page = anchor = 0;
      previous.disabled = next.disabled = true;
      return;
    }

    const bounds = rows.map(row => row.getBoundingClientRect());
    let firstLabelHeight = 0;
    // Field labels are repeated only on the first visible row of a page.
    if (rows[0].matches('.danmaku-fortune-row, .danmaku-custom-reply-row')) {
      list.classList.add('is-measuring-rows');
      firstLabelHeight = Math.max(0, bounds[0].height - rows[0].getBoundingClientRect().height);
      list.classList.remove('is-measuring-rows');
    }
    const units = [];
    for (let index = 0; index < rows.length; index++) {
      const row = rows[index], rect = bounds[index];
      const group = row.closest('.danmaku-query-reply-group');
      const last = units.at(-1);
      // Cards in the same CSS grid track stay together when paging.
      if (last && Math.abs(last.top - rect.top) < 1 && last.group === group) {
        last.height = Math.max(last.height, rect.height);
        continue;
      }
      const groupRect = group?.getBoundingClientRect();
      const firstRow = group ? rows.find(row => group.contains(row)) : null;
      const prefix = group ? firstRow.getBoundingClientRect().top - groupRect.top : 0;
      units.push({ start: index, top: rect.top, group, prefix,
        height: rect.height - (index === 0 ? firstLabelHeight : 0),
        gap: index && (!group || group === last.group) ? Math.max(0, rect.top - bounds[index - 1].bottom) : 0,
        groupGap: group && last?.group && group !== last.group ? Math.max(0, groupRect.top - last.group.getBoundingClientRect().bottom) : 0 });
    }
    function fit() {
      const style = windowRef.getComputedStyle(list);
      const available = list.clientHeight - parseFloat(style.paddingTop) - parseFloat(style.paddingBottom);
      const pages = [];
      let start = 0, used = 0, lastGroup = null;
      for (const unit of units) {
        const leading = unit.prefix + firstLabelHeight;
        let spacing = unit.gap;
        if (!used) spacing = leading;
        else if (unit.group !== lastGroup) spacing = unit.groupGap + unit.prefix;
        let height = unit.height + spacing;
        if (used && used + height > available + 0.5) {
          pages.push({ start, end: unit.start });
          start = unit.start;
          used = 0;
          height = unit.height + leading;
        }
        used += height;
        lastGroup = unit.group;
      }
      pages.push({ start, end: rows.length });
      return pages;
    }
    ranges = fit();
    if (ranges.length > 1 && pagination.hidden) {
      pagination.hidden = false;
      ranges = fit();
    }
    const index = Math.min(anchor, rows.length - 1);
    page = ranges.findIndex(range => index >= range.start && index < range.end);
    const range = ranges[page];
    anchor = range.start;
    rows.forEach((row, index) => { row.hidden = index < range.start || index >= range.end; });
    for (const group of groups) group.hidden = !rows.some(row => !row.hidden && group.contains(row));
    list.scrollTop = 0;
    label.textContent = context.total === undefined ? `第 ${page + 1} / ${ranges.length} 页`
      : `第 ${offset + range.start + 1}–${offset + range.end} / ${context.total} 人`;
    previous.disabled = Boolean(context.disabled) || (page === 0 && !context.previous);
    next.disabled = Boolean(context.disabled) || (page === ranges.length - 1 && !context.next);
  }
  function refresh() {
    if (!frame) frame = windowRef.requestAnimationFrame(() => { frame = 0; layout(); });
  }
  const backward = () => {
    if (page > 0) layout(ranges[page - 1].start);
    else contexts.get(list)?.previous?.();
  };
  const forward = () => {
    if (page < ranges.length - 1) layout(ranges[page + 1].start);
    else contexts.get(list)?.next?.();
  };
  const focus = () => layout();
  const reset = () => layout(0);
  previous.addEventListener('click', backward);
  next.addEventListener('click', forward);
  search?.addEventListener('input', reset);
  list.addEventListener('focusin', focus);
  documentRef.fonts?.addEventListener('loadingdone', refresh);
  const mutation = new windowRef.MutationObserver(refresh);
  mutation.observe(list, { childList: true, subtree: true });
  const resize = new windowRef.ResizeObserver(refresh);
  resize.observe(list);
  pagers.set(list, { layout, refresh });
  refresh();
  return () => {
    mutation.disconnect();
    resize.disconnect();
    windowRef.cancelAnimationFrame(frame);
    previous.removeEventListener('click', backward);
    next.removeEventListener('click', forward);
    search?.removeEventListener('input', reset);
    list.removeEventListener('focusin', focus);
    documentRef.fonts?.removeEventListener('loadingdone', refresh);
    pagers.delete(list);
  };
}
