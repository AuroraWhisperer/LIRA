export function mountCityDrag(list, { beforeDrag, commit }) {
  const events = new AbortController();
  const listen = (node, name, listener, options = {}) => node.addEventListener(name, listener, { ...options, signal: events.signal });
  const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)');
  const cards = () => [...list.querySelectorAll('[data-world-clock-city]')];
  const animations = new Map();
  let gesture = null;
  let suppressClick = false;
  let frame = 0;

  function bounds() {
    const rect = list.getBoundingClientRect();
    const viewport = gesture.scroller.getBoundingClientRect();
    return { left: rect.left, right: rect.right, top: Math.max(0, rect.top, viewport.top),
      bottom: Math.min(window.innerHeight, rect.bottom, viewport.bottom) };
  }
  function inside(x, y) {
    const rect = bounds();
    return x >= rect.left && x <= rect.right && y >= rect.top && y <= rect.bottom;
  }
  function finish(apply = false) {
    if (!gesture) return;
    const current = gesture;
    gesture = null;
    cancelAnimationFrame(frame);
    frame = 0;
    list.classList.remove('is-reordering');
    current.card.classList.remove('is-dragging');
    current.ghost?.remove();
    for (const animation of animations.values()) animation.cancel();
    animations.clear();
    if (list.hasPointerCapture(current.pointerId)) list.releasePointerCapture(current.pointerId);
    if (!current.moved) return;
    suppressClick = true;
    const order = cards().map(card => card.dataset.worldClockCity);
    if (apply && order.some((id, index) => id !== current.original[index].dataset.worldClockCity)) {
      commit(order, current.card.dataset.worldClockCity);
    } else {
      for (const card of current.original) list.moveBefore(card, null);
    }
    current.card.querySelector('button').focus({ preventScroll: true });
  }
  function position() {
    if (!gesture?.moved) return;
    const left = gesture.x - gesture.offsetX;
    const top = gesture.y - gesture.offsetY;
    gesture.ghost.style.transform = `translate(${left}px, ${top}px)`;
    if (!inside(gesture.x, gesture.y)) return;
    const rect = list.getBoundingClientRect();
    const rows = cards();
    const centers = rows.map(card => ({
      x: rect.left + list.clientLeft + card.offsetLeft - list.scrollLeft + card.offsetWidth / 2,
      y: rect.top + list.clientTop + card.offsetTop - list.scrollTop + card.offsetHeight / 2,
    }));
    const distances = centers.map(center => Math.hypot(center.x - left - gesture.width / 2, center.y - top - gesture.height / 2));
    const nextIndex = distances.indexOf(Math.min(...distances));
    const currentIndex = rows.indexOf(gesture.card);
    if (currentIndex === nextIndex) return;
    const positions = new Map(rows.map(card => [card, card.getBoundingClientRect()]));
    for (const animation of animations.values()) animation.cancel();
    animations.clear();
    list.moveBefore(gesture.card, rows[nextIndex + (nextIndex > currentIndex ? 1 : 0)] || null);
    if (reducedMotion.matches) return;
    for (const card of rows) {
      if (card === gesture.card) continue;
      const next = card.getBoundingClientRect();
      const dx = positions.get(card).left - next.left;
      const dy = positions.get(card).top - next.top;
      if (dx || dy) animations.set(card, card.animate([
        { transform: `translate(${dx}px, ${dy}px)` }, { transform: 'translate(0, 0)' },
      ], { duration: 180, easing: 'cubic-bezier(0.16, 1, 0.3, 1)' }));
    }
  }
  function scroll() {
    frame = 0;
    if (!gesture?.moved || !inside(gesture.x, gesture.y)) return;
    const rect = bounds();
    const delta = gesture.y < rect.top + 32 ? -10 : gesture.y > rect.bottom - 32 ? 10 : 0;
    if (!delta) return;
    const previous = gesture.scroller.scrollTop;
    gesture.scroller.scrollTop += delta;
    if (previous !== gesture.scroller.scrollTop) {
      position();
      frame = requestAnimationFrame(scroll);
    }
  }
  listen(list, 'pointerdown', event => {
    suppressClick = false;
    const button = event.target.closest('.world-clock-city-select');
    if (!button || event.button !== 0 || !event.isPrimary || cards().length < 2) return;
    finish();
    const card = button.parentElement;
    const rect = card.getBoundingClientRect();
    let scroller = list;
    while (scroller.parentElement && !(scroller.scrollHeight > scroller.clientHeight && /auto|scroll/.test(getComputedStyle(scroller).overflowY))) {
      scroller = scroller.parentElement;
    }
    gesture = { card, scroller, original: cards(), pointerId: event.pointerId,
      offsetX: event.clientX - rect.left, offsetY: event.clientY - rect.top, width: rect.width, height: rect.height,
      startX: event.clientX, startY: event.clientY, x: event.clientX, y: event.clientY, moved: false };
  });
  listen(window, 'pointermove', event => {
    if (!gesture || event.pointerId !== gesture.pointerId) return;
    gesture.x = event.clientX;
    gesture.y = event.clientY;
    if (!gesture.moved) {
      if (Math.hypot(gesture.x - gesture.startX, gesture.y - gesture.startY) < 5) return;
      beforeDrag();
      const ghost = gesture.card.cloneNode(true);
      ghost.removeAttribute('data-world-clock-city');
      ghost.classList.add('world-clock-city-ghost');
      ghost.setAttribute('popover', 'manual');
      ghost.setAttribute('aria-hidden', 'true');
      ghost.inert = true;
      ghost.style.width = `${gesture.width}px`;
      ghost.style.height = `${gesture.height}px`;
      ghost.querySelector('button').style.padding = getComputedStyle(gesture.card.querySelector('button')).padding;
      list.parentElement.append(ghost);
      ghost.showPopover();
      gesture.ghost = ghost;
      gesture.moved = true;
      list.setPointerCapture(event.pointerId);
      list.classList.add('is-reordering');
      gesture.card.classList.add('is-dragging');
    }
    event.preventDefault();
    position();
    if (!frame) frame = requestAnimationFrame(scroll);
  });
  listen(window, 'pointerup', event => {
    if (event.pointerId === gesture?.pointerId) finish(inside(event.clientX, event.clientY));
  });
  listen(list, 'click', event => {
    if (!suppressClick) return;
    suppressClick = false;
    event.preventDefault();
    event.stopImmediatePropagation();
  }, { capture: true });
  listen(document, 'keydown', event => {
    if (!gesture || event.key !== 'Escape') return;
    event.preventDefault();
    event.stopImmediatePropagation();
    finish();
  }, { capture: true });
  listen(list, 'pointercancel', () => finish());
  listen(list, 'lostpointercapture', () => finish());
  listen(window, 'blur', () => finish());
  listen(window, 'resize', () => finish());
  return { get dragging() { return Boolean(gesture?.moved); }, cancel: () => finish(), dispose() { finish(); events.abort(); } };
}
