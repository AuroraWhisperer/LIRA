export function mountPreviewLayerDrag(layers, { beforeDrag, commit, report }) {
  let gesture = null;
  let suppressClick = false;
  let frame = 0;
  const rows = () => [...layers.children];
  const inside = (x, y) => {
    const rect = layers.getBoundingClientRect();
    return x >= rect.left && x <= rect.right && y >= rect.top && y <= rect.bottom;
  };
  function finish(apply = false) {
    if (!gesture) return;
    const current = gesture;
    gesture = null;
    cancelAnimationFrame(frame);
    frame = 0;
    layers.classList.remove('is-reordering');
    current.row.classList.remove('is-dragging');
    if (layers.hasPointerCapture(current.pointerId)) layers.releasePointerCapture(current.pointerId);
    if (!current.moved) return;
    suppressClick = true;
    const order = rows().map(row => row.dataset.itemId);
    for (const row of current.original) layers.append(row);
    if (apply && order.some((id, index) => id !== current.original[index].dataset.itemId)) {
      try { commit(order); } catch (error) { report(error.message); }
    }
  }
  function position() {
    if (!gesture?.moved || !inside(gesture.x, gesture.y)) return;
    const next = rows().find(row => {
      if (row === gesture.row) return false;
      const rect = row.getBoundingClientRect();
      return gesture.x < rect.left + rect.width / 2;
    });
    layers.insertBefore(gesture.row, next || null);
  }
  function scroll() {
    frame = 0;
    if (!gesture?.moved || !inside(gesture.x, gesture.y)) return;
    const rect = layers.getBoundingClientRect();
    const delta = gesture.x < rect.left + 32 ? -10 : gesture.x > rect.right - 32 ? 10 : 0;
    if (!delta) return;
    const previous = layers.scrollLeft;
    layers.scrollLeft += delta;
    if (previous !== layers.scrollLeft) {
      position();
      frame = requestAnimationFrame(scroll);
    }
  }
  function down(event) {
    suppressClick = false;
    const button = event.target.closest('.preview-canvas-layer-select');
    if (!button || event.button !== 0 || !event.isPrimary || layers.inert) return;
    finish();
    gesture = { row: button.parentElement, original: rows(), pointerId: event.pointerId,
      startX: event.clientX, startY: event.clientY, x: event.clientX, y: event.clientY, moved: false };
  }
  function move(event) {
    if (!gesture || event.pointerId !== gesture.pointerId) return;
    gesture.x = event.clientX;
    gesture.y = event.clientY;
    if (!gesture.moved) {
      if (Math.hypot(gesture.x - gesture.startX, gesture.y - gesture.startY) < 5) return;
      beforeDrag();
      gesture.moved = true;
      layers.setPointerCapture(event.pointerId);
      layers.classList.add('is-reordering');
      gesture.row.classList.add('is-dragging');
    }
    event.preventDefault();
    position();
    if (!frame) frame = requestAnimationFrame(scroll);
  }
  function up(event) {
    if (event.pointerId === gesture?.pointerId) finish(inside(event.clientX, event.clientY));
  }
  function cancel() { finish(); }
  function keydown(event) {
    if (!gesture || event.key !== 'Escape') return;
    event.preventDefault();
    cancel();
  }
  function click(event) {
    if (!suppressClick) return;
    suppressClick = false;
    event.preventDefault();
    event.stopImmediatePropagation();
  }
  layers.addEventListener('pointerdown', down);
  window.addEventListener('pointermove', move);
  window.addEventListener('pointerup', up);
  layers.addEventListener('pointercancel', cancel);
  layers.addEventListener('lostpointercapture', cancel);
  layers.addEventListener('click', click, true);
  window.addEventListener('blur', cancel);
  document.addEventListener('keydown', keydown);
  return { cancel, dispose() {
    cancel();
    layers.removeEventListener('pointerdown', down);
    window.removeEventListener('pointermove', move);
    window.removeEventListener('pointerup', up);
    layers.removeEventListener('pointercancel', cancel);
    layers.removeEventListener('lostpointercapture', cancel);
    layers.removeEventListener('click', click, true);
    window.removeEventListener('blur', cancel);
    document.removeEventListener('keydown', keydown);
  } };
}
