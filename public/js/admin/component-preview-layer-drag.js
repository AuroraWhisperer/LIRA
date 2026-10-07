export function mountPreviewLayerDrag(layers, { beforeDrag, commit, report }) {
  let gesture = null;
  let suppressClick = false;
  let frame = 0;
  const animations = new Map();
  const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)');
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
    current.ghost?.remove();
    for (const animation of animations.values()) animation.cancel();
    animations.clear();
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
    if (!gesture?.moved) return;
    const left = gesture.x - gesture.offsetX;
    gesture.ghost.style.transform = `translate(${left}px, ${gesture.y - gesture.offsetY}px)`;
    if (!inside(gesture.x, gesture.y)) return;
    const siblings = rows().filter(row => row !== gesture.row);
    const gap = parseFloat(getComputedStyle(layers).columnGap) || 0;
    // Measure a stable list without the placeholder so variable-width rows don't oscillate.
    let edge = layers.getBoundingClientRect().left - layers.scrollLeft;
    const next = siblings.find(row => {
      const midpoint = edge + row.offsetWidth / 2;
      edge += row.offsetWidth + gap;
      return left < midpoint;
    });
    if (gesture.row.nextElementSibling === (next || null)) return;
    const positions = new Map(siblings.map(row => [row, row.getBoundingClientRect().left]));
    for (const animation of animations.values()) animation.cancel();
    animations.clear();
    layers.insertBefore(gesture.row, next || null);
    if (reducedMotion.matches) return;
    for (const row of siblings) {
      const delta = positions.get(row) - row.getBoundingClientRect().left;
      if (delta) animations.set(row, row.animate([
        { transform: `translateX(${delta}px)` }, { transform: 'translateX(0)' },
      ], { duration: 180, easing: 'cubic-bezier(0.16, 1, 0.3, 1)' }));
    }
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
    const rect = button.parentElement.getBoundingClientRect();
    gesture = { row: button.parentElement, original: rows(), pointerId: event.pointerId,
      offsetX: event.clientX - rect.left, offsetY: event.clientY - rect.top,
      startX: event.clientX, startY: event.clientY, x: event.clientX, y: event.clientY, moved: false };
  }
  function wheel(event) {
    if (event.ctrlKey || layers.inert || !inside(event.clientX, event.clientY)
      || layers.scrollWidth <= layers.clientWidth) return;
    const delta = Math.abs(event.deltaY) > Math.abs(event.deltaX) ? event.deltaY : event.deltaX;
    const scale = event.deltaMode === 1 ? 40 : event.deltaMode === 2 ? layers.clientWidth : 1;
    event.preventDefault();
    layers.scrollLeft += delta * scale;
    position();
  }
  function move(event) {
    if (!gesture || event.pointerId !== gesture.pointerId) return;
    gesture.x = event.clientX;
    gesture.y = event.clientY;
    if (!gesture.moved) {
      if (Math.hypot(gesture.x - gesture.startX, gesture.y - gesture.startY) < 5) return;
      beforeDrag();
      const rect = gesture.row.getBoundingClientRect();
      const ghost = gesture.row.cloneNode(true);
      ghost.querySelector('.preview-canvas-layer-menu')?.remove();
      ghost.removeAttribute('data-item-id');
      for (const node of ghost.querySelectorAll('[data-item-id], [aria-controls]')) {
        node.removeAttribute('data-item-id');
        node.removeAttribute('aria-controls');
      }
      ghost.classList.add('preview-canvas-layer-ghost');
      ghost.setAttribute('aria-hidden', 'true');
      ghost.inert = true;
      ghost.style.width = `${rect.width}px`;
      ghost.style.height = `${rect.height}px`;
      layers.ownerDocument.body.append(ghost);
      gesture.ghost = ghost;
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
  layers.addEventListener('wheel', wheel, { passive: false });
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
    layers.removeEventListener('wheel', wheel);
    window.removeEventListener('pointermove', move);
    window.removeEventListener('pointerup', up);
    layers.removeEventListener('pointercancel', cancel);
    layers.removeEventListener('lostpointercapture', cancel);
    layers.removeEventListener('click', click, true);
    window.removeEventListener('blur', cancel);
    document.removeEventListener('keydown', keydown);
  } };
}
