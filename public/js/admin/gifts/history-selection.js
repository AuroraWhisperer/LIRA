// Row clicks and a page-scoped selection rectangle share the existing export selection.
export function createGiftHistorySelection({ state, update, onManualSelection }) {
  const surface = document.getElementById('giftHistoryScroll');
  const body = document.getElementById('giftHistoryBody');
  const marquee = document.getElementById('giftHistoryMarquee');
  if (!surface || !body || !marquee) return { cancel() {}, refresh() {} };

  const controls = 'input, button, a, select, textarea, label, [contenteditable="true"]';
  let drag = null;
  let frame = null;
  let suppressClick = false;

  function point(clientX, clientY) {
    const rect = surface.getBoundingClientRect();
    return {
      x: Math.max(0, Math.min(surface.clientWidth, clientX - rect.left)) + surface.scrollLeft,
      y: Math.max(0, Math.min(surface.clientHeight, clientY - rect.top)) + surface.scrollTop,
    };
  }

  function finish(cancelled = false) {
    if (!drag) return;
    const previous = drag;
    drag = null;
    cancelAnimationFrame(frame);
    frame = null;
    marquee.hidden = true;
    if (surface.hasPointerCapture(previous.pointerId)) surface.releasePointerCapture(previous.pointerId);
    if (previous.active) {
      suppressClick = true;
      if (cancelled) {
        state.selected = previous.original;
        update();
      }
    }
  }

  function refresh() {
    if (drag && drag.rows.some(({ node }) => !node.isConnected)) finish(true);
  }

  function paint() {
    refresh();
    if (!drag?.active) return;
    const end = point(drag.clientX, drag.clientY);
    const left = Math.min(drag.start.x, end.x);
    const top = Math.min(drag.start.y, end.y);
    const right = Math.max(drag.start.x, end.x);
    const bottom = Math.max(drag.start.y, end.y);
    Object.assign(marquee.style, {
      left: `${left}px`,
      top: `${top}px`,
      width: `${right - left}px`,
      height: `${bottom - top}px`,
    });
    marquee.hidden = false;
    let changed = false;
    for (const row of drag.rows) {
      const selected =
        drag.base.has(row.id) || (row.right >= left && row.left <= right && row.bottom >= top && row.top <= bottom);
      if (state.selected.has(row.id) === selected) continue;
      if (selected) state.selected.add(row.id);
      else state.selected.delete(row.id);
      changed = true;
    }
    if (changed) update();
  }

  function autoScroll() {
    frame = null;
    if (!drag?.active) return;
    const rect = surface.getBoundingClientRect();
    const top = rect.top + (surface.querySelector('thead')?.offsetHeight || 0);
    const bottom = rect.top + surface.clientHeight;
    const speed =
      drag.clientY < top + 28
        ? -Math.min(18, (top + 28 - drag.clientY) / 3)
        : drag.clientY > bottom - 28
          ? Math.min(18, (drag.clientY - bottom + 28) / 3)
          : 0;
    const previousScrollTop = surface.scrollTop;
    if (speed) surface.scrollTop += speed;
    paint();
    if (drag && surface.scrollTop !== previousScrollTop) schedulePaint();
  }

  function schedulePaint() {
    if (frame === null) frame = requestAnimationFrame(autoScroll);
  }

  surface.addEventListener(
    'click',
    (event) => {
      if (!suppressClick || event.detail === 0) return;
      suppressClick = false;
      event.preventDefault();
      event.stopPropagation();
    },
    true,
  );

  body.addEventListener('click', (event) => {
    if (event.target.closest(controls)) return;
    const row = event.target.closest('tr[data-event-id]');
    if (!row) return;
    onManualSelection();
    const id = row.dataset.eventId;
    if (state.selected.has(id)) state.selected.delete(id);
    else state.selected.add(id);
    row.querySelector('input[data-gift-select]')?.focus({ preventScroll: true });
    update();
  });

  surface.addEventListener('pointerdown', (event) => {
    suppressClick = false;
    if (event.button !== 0 || event.isPrimary === false || event.pointerType === 'touch') return;
    if (event.target.closest(controls) || event.target.closest('thead')) return;
    const rect = surface.getBoundingClientRect();
    // Scrollbar drags must keep their native behavior.
    if (event.clientX >= rect.left + surface.clientWidth || event.clientY >= rect.top + surface.clientHeight) return;
    const rows = [...body.querySelectorAll('tr[data-event-id]')].map((node) => {
      const bounds = node.getBoundingClientRect();
      return {
        node,
        id: node.dataset.eventId,
        left: bounds.left - rect.left + surface.scrollLeft,
        right: bounds.right - rect.left + surface.scrollLeft,
        top: bounds.top - rect.top + surface.scrollTop,
        bottom: bounds.bottom - rect.top + surface.scrollTop,
      };
    });
    if (!rows.length) return;
    const original = new Set(state.selected);
    const base = new Set(original);
    if (!event.ctrlKey && !event.metaKey && !event.shiftKey) rows.forEach(({ id }) => base.delete(id));
    drag = {
      pointerId: event.pointerId,
      start: point(event.clientX, event.clientY),
      clientX: event.clientX,
      clientY: event.clientY,
      originX: event.clientX,
      originY: event.clientY,
      rows,
      original,
      base,
      active: false,
    };
    event.preventDefault();
  });

  document.addEventListener('pointermove', (event) => {
    if (!drag || event.pointerId !== drag.pointerId) return;
    drag.clientX = event.clientX;
    drag.clientY = event.clientY;
    if (!drag.active) {
      if (Math.hypot(event.clientX - drag.originX, event.clientY - drag.originY) < 5) return;
      drag.active = true;
      onManualSelection();
      surface.setPointerCapture(event.pointerId);
    }
    event.preventDefault();
    schedulePaint();
  });
  surface.addEventListener('scroll', () => {
    if (drag?.active) schedulePaint();
  });
  document.addEventListener('pointerup', (event) => {
    if (!drag || event.pointerId !== drag.pointerId) return;
    if (drag.active) {
      drag.clientX = event.clientX;
      drag.clientY = event.clientY;
      paint();
    }
    finish();
  });
  document.addEventListener('pointercancel', (event) => {
    if (drag?.pointerId === event.pointerId) finish(true);
  });
  surface.addEventListener('lostpointercapture', () => finish(true));
  window.addEventListener('blur', () => finish(true));
  return { cancel: () => finish(true), refresh };
}
