import { validateSceneDocument } from './scene-template.js';
import { SCENE_COMPONENTS } from '../shared/scene-components.js';

const clone = (value) => JSON.parse(JSON.stringify(value));
const equal = (left, right) => JSON.stringify(left) === JSON.stringify(right);

function freeze(value) {
  for (const entry of Object.values(value)) if (entry && typeof entry === 'object') freeze(entry);
  return Object.freeze(value);
}

export function createSceneDocumentModel(document) {
  let current = freeze(validateSceneDocument(document));
  let past = [];
  let future = [];
  let gesture = null;
  const listeners = new Set();
  const snapshotListeners = new Set();
  const getDocument = () => clone(current);
  const getState = () => ({ canUndo: !gesture && past.length > 0, canRedo: !gesture && future.length > 0 });
  function notify() {
    for (const listener of listeners) listener(getState(), getDocument());
    for (const listener of snapshotListeners) listener(getState(), current);
  }
  function change(base, mutator) {
    const draft = clone(base);
    const result = mutator(draft);
    const next = result === undefined ? draft : result;
    for (const item of next.items) {
      if (item.appearance.mode !== 'shared') continue;
      const previous = base.items.find((entry) => entry.id === item.id);
      if (!previous || item.width === previous.width && item.height === previous.height) continue;
      for (const reference of next.items) {
        if (reference.id === item.id || reference.type !== item.type || reference.appearance.mode !== 'shared') continue;
        reference.width = item.width;
        reference.height = item.height;
        reference.x = Math.min(reference.x, next.canvas.width - reference.width);
        reference.y = Math.min(reference.y, next.canvas.height - reference.height);
      }
    }
    return freeze(validateSceneDocument(next));
  }
  function record(previous) {
    past.push(previous);
    if (past.length > 100) past.shift();
    future = [];
  }
  return {
    getDocument,
    getSnapshot: () => current,
    getState,
    isGestureActive: () => gesture !== null,
    subscribe(listener) {
      listeners.add(listener);
      listener(getState(), getDocument());
      return () => listeners.delete(listener);
    },
    subscribeSnapshot(listener) {
      snapshotListeners.add(listener);
      listener(getState(), current);
      return () => snapshotListeners.delete(listener);
    },
    edit(mutator, { recordHistory = true } = {}) {
      if (gesture) throw new Error('请先完成或取消当前手势。');
      const next = change(current, mutator);
      if (equal(current, next)) return false;
      if (recordHistory) record(current);
      current = next;
      notify();
      return true;
    },
    beginGesture() {
      if (gesture) throw new Error('已有进行中的手势。');
      gesture = current;
      notify();
    },
    updateGesture(mutator) {
      if (!gesture) throw new Error('请先开始手势。');
      const next = change(gesture, mutator);
      if (equal(current, next)) return false;
      current = next;
      notify();
      return true;
    },
    commitGesture() {
      if (!gesture) return false;
      const changed = !equal(gesture, current);
      if (changed) record(gesture);
      gesture = null;
      notify();
      return changed;
    },
    cancelGesture() {
      if (!gesture) return false;
      current = gesture;
      gesture = null;
      notify();
      return true;
    },
    undo() {
      if (!getState().canUndo) return false;
      future.push(current);
      current = past.pop();
      notify();
      return true;
    },
    redo() {
      if (!getState().canRedo) return false;
      past.push(current);
      current = future.pop();
      notify();
      return true;
    },
    reset(nextDocument) {
      const next = freeze(validateSceneDocument(nextDocument));
      current = next;
      past = [];
      future = [];
      gesture = null;
      notify();
    },
  };
}

export function snapSceneCoordinate(value) {
  if (!Number.isFinite(value)) throw new Error('坐标必须为有限数值。');
  return Math.round(value / 8) * 8;
}

export function resizeSceneCanvas(document, canvas) {
  const next = validateSceneDocument(document);
  const sameRatio = next.canvas.width * canvas.height === canvas.width * next.canvas.height;
  const ratio = sameRatio ? canvas.width / next.canvas.width : 1;
  next.canvas = { ...canvas };
  for (const item of next.items) {
    item.width = Math.min(canvas.width, Math.max(32, Math.round(item.width * ratio)));
    item.height = Math.min(canvas.height, Math.max(32, Math.round(item.height * ratio)));
    item.x = Math.max(0, Math.min(canvas.width - item.width, Math.round(item.x * ratio)));
    item.y = Math.max(0, Math.min(canvas.height - item.height, Math.round(item.y * ratio)));
  }
  return validateSceneDocument(next);
}

function selection(document, ids) {
  const selected = new Set(ids);
  return document.items.filter((item) => selected.has(item.id) && !item.locked);
}

function bounds(items) {
  const left = Math.min(...items.map((item) => item.x));
  const top = Math.min(...items.map((item) => item.y));
  const right = Math.max(...items.map((item) => item.x + item.width));
  const bottom = Math.max(...items.map((item) => item.y + item.height));
  return { left, top, right, bottom };
}

export function moveSceneItems(document, ids, deltaX, deltaY, { snap = false } = {}) {
  if (![deltaX, deltaY].every(Number.isFinite)) throw new Error('移动距离必须为有限数值。');
  const next = validateSceneDocument(document);
  const items = selection(next, ids);
  if (!items.length) return next;
  const box = bounds(items);
  const requestedX = snap ? snapSceneCoordinate(box.left + deltaX) - box.left : deltaX;
  const requestedY = snap ? snapSceneCoordinate(box.top + deltaY) - box.top : deltaY;
  const offsetX = Math.max(-box.left, Math.min(next.canvas.width - box.right, requestedX));
  const offsetY = Math.max(-box.top, Math.min(next.canvas.height - box.bottom, requestedY));
  for (const item of items) {
    item.x += offsetX;
    item.y += offsetY;
  }
  return next;
}

export function resizeSceneItem(document, id, handle, deltaX, deltaY, { snap = false } = {}) {
  const next = validateSceneDocument(document);
  const item = selection(next, [id])[0];
  if (!item) return next;
  const coordinate = (value) => snap ? snapSceneCoordinate(value) : value;
  const right = item.x + item.width;
  const bottom = item.y + item.height;
  if (handle.includes('w')) {
    item.x = Math.max(0, Math.min(right - 32, coordinate(item.x + deltaX)));
    item.width = right - item.x;
  } else if (handle.includes('e')) {
    item.width = Math.max(32, Math.min(next.canvas.width, coordinate(right + deltaX)) - item.x);
  }
  if (SCENE_COMPONENTS[item.type].resizeAxes.includes('y')) {
    if (handle.includes('n')) {
      item.y = Math.max(0, Math.min(bottom - 32, coordinate(item.y + deltaY)));
      item.height = bottom - item.y;
    } else if (handle.includes('s')) {
      item.height = Math.max(32, Math.min(next.canvas.height, coordinate(bottom + deltaY)) - item.y);
    }
  }
  return next;
}

export function alignSceneItems(document, ids, alignment) {
  if (!['left', 'right', 'top', 'bottom', 'center-x', 'center-y'].includes(alignment)) throw new Error('不支持的对齐方式。');
  const next = validateSceneDocument(document);
  const items = selection(next, ids);
  if (!items.length) return next;
  const box = items.length === 1
    ? { left: 0, top: 0, right: next.canvas.width, bottom: next.canvas.height } : bounds(items);
  for (const item of items) {
    if (alignment === 'left') item.x = box.left;
    if (alignment === 'right') item.x = box.right - item.width;
    if (alignment === 'top') item.y = box.top;
    if (alignment === 'bottom') item.y = box.bottom - item.height;
    if (alignment === 'center-x') item.x = (box.left + box.right - item.width) / 2;
    if (alignment === 'center-y') item.y = (box.top + box.bottom - item.height) / 2;
  }
  return next;
}
