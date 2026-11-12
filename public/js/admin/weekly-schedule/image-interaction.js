import { getWeeklyImagePath, WEEKLY_IMAGE_RANGES, WEEKLY_BACKGROUND_RANGES } from './model.js';

export function createWeeklyImageInteraction(viewport, { getTemplate, onSelect, onChange, onCommit }) {
  const doc = viewport.ownerDocument;
  const view = doc.defaultView;
  const selection = doc.createElement('div');
  selection.className = 'weekly-image-selection';
  selection.hidden = true;
  for (const [action, label] of [['rotate', '拖动旋转图片'], ['scale', '拖动缩放图片']]) {
    const handle = doc.createElement('button');
    handle.type = 'button';
    handle.dataset.weeklyHandle = action;
    handle.setAttribute('aria-label', label);
    handle.title = label;
    selection.append(handle);
  }
  viewport.append(selection);
  let selected = '';
  let selectedNode;
  let gesture;

  function getNode() {
    if (!selected) return null;
    if (selectedNode?.isConnected && selectedNode.dataset.weeklyImage === selected) return selectedNode;
    selectedNode = viewport.querySelector(`[data-weekly-image="${selected}"]`);
    return selectedNode;
  }
  function refresh() {
    const node = getNode();
    const bounds = viewport.getBoundingClientRect();
    const rect = node?.getBoundingClientRect();
    const left = rect ? Math.max(0, rect.left - bounds.left) : 0;
    const top = rect ? Math.max(0, rect.top - bounds.top) : 0;
    const right = rect ? Math.min(bounds.width, rect.right - bounds.left) : 0;
    const bottom = rect ? Math.min(bounds.height, rect.bottom - bounds.top) : 0;
    selection.hidden = !node || right <= left || bottom <= top;
    if (!selection.hidden) Object.assign(selection.style, {
      left: `${left}px`, top: `${top}px`, width: `${right - left}px`, height: `${bottom - top}px`,
    });
  }
  function select(key, node) {
    finish();
    selected = key;
    selectedNode = node;
    refresh();
  }
  // Translation is measured in the image parent's coordinate system. This also
  // handles rotated QR modules and decorative icons in a scaled preview.
  function parentMatrix(node) {
    let matrix = new view.DOMMatrix();
    for (let parent = node.parentElement; parent && parent !== viewport; parent = parent.parentElement) {
      matrix = new view.DOMMatrix(view.getComputedStyle(parent).transform).multiply(matrix);
    }
    matrix.e = 0;
    matrix.f = 0;
    return matrix;
  }
  function origin(node, parent) {
    const style = view.getComputedStyle(node);
    const [x, y] = style.transformOrigin.split(' ').map(Number.parseFloat);
    const matrix = parent.multiply(new view.DOMMatrix(style.transform));
    matrix.e = 0;
    matrix.f = 0;
    const corners = [[0, 0], [node.offsetWidth, 0], [0, node.offsetHeight], [node.offsetWidth, node.offsetHeight]]
      .map(([left, top]) => matrix.transformPoint({ x: left - x, y: top - y }));
    const rect = node.getBoundingClientRect();
    return { x: rect.left - Math.min(...corners.map(point => point.x)), y: rect.top - Math.min(...corners.map(point => point.y)) };
  }
  function pointerDown(event) {
    if (event.button !== 0 || !getTemplate()) return;
    const handle = event.target.closest('[data-weekly-handle]');
    const node = handle ? getNode() : event.target.closest('[data-weekly-image]')
      || (selected === 'background' ? getNode() : null);
    if (!node || !viewport.contains(node)) return;
    const key = node.dataset.weeklyImage;
    select(key, node);
    onSelect(key);
    const matrix = parentMatrix(node);
    const pivot = origin(node, matrix);
    gesture = {
      pointerId: event.pointerId, action: handle?.dataset.weeklyHandle || 'move', key,
      start: { x: event.clientX, y: event.clientY }, settings: { ...getTemplate()[getWeeklyImagePath(key)] },
      inverse: matrix.inverse(), pivot,
    };
    viewport.setPointerCapture(event.pointerId);
    viewport.classList.add('is-dragging');
    viewport.focus({ preventScroll: true });
    event.preventDefault();
  }
  function constrain(key, values) {
    const ranges = key === 'background' ? WEEKLY_BACKGROUND_RANGES : WEEKLY_IMAGE_RANGES;
    return Object.fromEntries(Object.entries(values).map(([field, value]) => [field,
      Math.round(Math.max(ranges[field].min, Math.min(ranges[field].max, value)))]));
  }
  function pointerMove(event) {
    if (!gesture || event.pointerId !== gesture.pointerId) return;
    const { key, start, settings, inverse, pivot, action } = gesture;
    let values;
    if (action === 'move') {
      const delta = inverse.transformPoint({ x: event.clientX - start.x, y: event.clientY - start.y });
      const x = key === 'background' ? 'offsetX' : 'x';
      const y = key === 'background' ? 'offsetY' : 'y';
      values = { [x]: settings[x] + delta.x, [y]: settings[y] + delta.y };
    } else if (action === 'scale') {
      const before = Math.hypot(start.x - pivot.x, start.y - pivot.y);
      const after = Math.hypot(event.clientX - pivot.x, event.clientY - pivot.y);
      values = { scale: settings.scale * after / Math.max(1, before) };
    } else {
      const before = Math.atan2(start.y - pivot.y, start.x - pivot.x);
      const after = Math.atan2(event.clientY - pivot.y, event.clientX - pivot.x);
      const rotation = settings.rotation + (after - before) * 180 / Math.PI;
      values = { rotation: ((rotation + 540) % 360) - 180 };
    }
    onChange(key, constrain(key, values));
    refresh();
  }
  function finish() {
    if (!gesture) return;
    const { pointerId } = gesture;
    gesture = null;
    if (viewport.hasPointerCapture(pointerId)) viewport.releasePointerCapture(pointerId);
    viewport.classList.remove('is-dragging');
    onCommit();
  }
  function keyDown(event) {
    if (event.target !== viewport || !selected || !getTemplate()) return;
    const direction = { ArrowLeft: [-1, 0], ArrowRight: [1, 0], ArrowUp: [0, -1], ArrowDown: [0, 1] }[event.key];
    if (!direction) return;
    event.preventDefault();
    const settings = getTemplate()[getWeeklyImagePath(selected)];
    const x = selected === 'background' ? 'offsetX' : 'x';
    const y = selected === 'background' ? 'offsetY' : 'y';
    const step = event.shiftKey ? 10 : 1;
    onChange(selected, constrain(selected, { [x]: settings[x] + direction[0] * step, [y]: settings[y] + direction[1] * step }));
    refresh();
  }
  viewport.addEventListener('pointerdown', pointerDown);
  viewport.addEventListener('pointermove', pointerMove);
  viewport.addEventListener('pointerup', finish);
  viewport.addEventListener('pointercancel', finish);
  viewport.addEventListener('lostpointercapture', finish);
  viewport.addEventListener('keydown', keyDown);
  return {
    select, refresh,
    dispose() {
      finish();
      viewport.removeEventListener('pointerdown', pointerDown);
      viewport.removeEventListener('pointermove', pointerMove);
      viewport.removeEventListener('pointerup', finish);
      viewport.removeEventListener('pointercancel', finish);
      viewport.removeEventListener('lostpointercapture', finish);
      viewport.removeEventListener('keydown', keyDown);
      selection.remove();
    },
  };
}
