import { previewElement, mountComponentPreview } from './component-preview-surface.js';
import { createSceneItemController } from './scene-editor-state.js';
import { moveSceneItems } from './scene-document-model.js';
import { startSceneEditorOvertimeData } from './scene-editor-preview-data.js';

export function mountSceneEditorStage(host, { model, components, getSelection, select, report }) {
  const viewport = previewElement('div', 'scene-editor-viewport');
  const extent = previewElement('div', 'scene-editor-extent');
  const canvas = previewElement('div', 'scene-editor-canvas');
  canvas.setAttribute('aria-label', '场景画布');
  const empty = previewElement('p', 'scene-editor-empty', '从左侧添加组件，开始编排直播画面。');
  canvas.append(empty);
  extent.append(canvas);
  viewport.append(extent);
  host.append(viewport);
  const entries = new Map();
  let scale = 1;
  let zoom = 'fit';
  let snap = true;
  let gesture = null;
  let closed = false;
  function fit() {
    const document = model.getDocument();
    scale = zoom === 'fit' ? Math.max(0.03, Math.min(
      (viewport.clientWidth - 48) / document.canvas.width,
      (viewport.clientHeight - 48) / document.canvas.height, 1)) : Number(zoom) / 100;
    extent.style.width = `${document.canvas.width * scale}px`;
    extent.style.height = `${document.canvas.height * scale}px`;
    canvas.style.width = `${document.canvas.width}px`;
    canvas.style.height = `${document.canvas.height}px`;
    canvas.style.transform = `scale(${scale})`;
    canvas.style.setProperty('--scene-inverse-scale', String(1 / scale));
  }
  function syncSelection() {
    const selected = getSelection();
    for (const [id, entry] of entries) {
      entry.host.classList.toggle('is-selected', selected.has(id));
      entry.host.setAttribute('aria-pressed', String(selected.has(id)));
    }
  }
  function cancelGesture() {
    if (!gesture) return;
    gesture = null;
    model.cancelGesture();
  }
  function pointerDown(event, id) {
    if (event.button !== 0 || gesture) return;
    event.preventDefault();
    entries.get(id)?.host.focus({ preventScroll: true });
    const toggle = event.shiftKey || event.ctrlKey || event.metaKey;
    if (toggle || !getSelection().has(id)) select(id, toggle);
    const item = model.getDocument().items.find((entry) => entry.id === id);
    if (toggle || !item || item.locked) return;
    const ids = [...getSelection()];
    gesture = { pointerId: event.pointerId, x: event.clientX, y: event.clientY, ids, started: false };
    canvas.setPointerCapture(event.pointerId);
  }
  function pointerMove(event) {
    if (!gesture || event.pointerId !== gesture.pointerId) return;
    const deltaX = Math.round((event.clientX - gesture.x) / scale);
    const deltaY = Math.round((event.clientY - gesture.y) / scale);
    if (!gesture.started && Math.abs(deltaX) + Math.abs(deltaY) < 2) return;
    try {
      if (!gesture.started) { gesture.started = true; model.beginGesture(); }
      model.updateGesture((document) => moveSceneItems(document, gesture.ids, deltaX, deltaY, { snap }));
    } catch (error) { cancelGesture(); report(error.message); }
  }
  function pointerUp(event) {
    if (!gesture || event.pointerId !== gesture.pointerId) return;
    const { started } = gesture;
    gesture = null;
    if (started) model.commitGesture();
    if (canvas.hasPointerCapture(event.pointerId)) canvas.releasePointerCapture(event.pointerId);
  }
  function render() {
    if (closed) return;
    const document = model.getDocument();
    for (const [id, entry] of entries) {
      if (document.items.some((item) => item.id === id && item.visible)) continue;
      entry.surface.dispose();
      entry.host.remove();
      entries.delete(id);
    }
    for (const [index, item] of document.items.entries()) {
      if (!item.visible) continue;
      let entry = entries.get(item.id);
      if (!entry) {
        const component = components.find((value) => value.id === item.type);
        const node = previewElement('div', 'scene-editor-item');
        node.dataset.itemId = item.id;
        node.tabIndex = 0;
        node.setAttribute('role', 'button');
        const label = previewElement('span', 'scene-editor-item-label');
        node.append(label);
        canvas.append(node);
        const controller = createSceneItemController(model, item.id, component.controller);
        const surface = mountComponentPreview(node, { ...component, controller,
          onOpen: undefined, onClose: undefined, onEdit: undefined,
          ...(item.type === 'overtime' ? { dataModes: undefined, startData: startSceneEditorOvertimeData } : {}),
          size: () => {
            const current = model.getDocument().items.find((value) => value.id === item.id) || item;
            return [current.width, current.height];
          },
        });
        node.addEventListener('pointerdown', (event) => pointerDown(event, item.id));
        node.addEventListener('keydown', (event) => {
          if (event.key === ' ' || event.key === 'Enter') {
            event.preventDefault();
            select(item.id, event.shiftKey || event.ctrlKey || event.metaKey);
          }
        });
        entry = { host: node, label, surface };
        entries.set(item.id, entry);
      }
      entry.host.style.left = `${item.x}px`;
      entry.host.style.top = `${item.y}px`;
      entry.host.style.width = `${item.width}px`;
      entry.host.style.height = `${item.height}px`;
      entry.host.style.zIndex = String(index + 1);
      entry.host.classList.toggle('is-locked', item.locked);
      entry.host.setAttribute('aria-label', `${item.name}${item.locked ? '（已锁定）' : ''}`);
      entry.label.textContent = item.name;
    }
    empty.hidden = document.items.some((item) => item.visible);
    fit();
    syncSelection();
  }
  canvas.addEventListener('pointermove', pointerMove);
  canvas.addEventListener('pointerup', pointerUp);
  canvas.addEventListener('pointercancel', cancelGesture);
  canvas.addEventListener('lostpointercapture', cancelGesture);
  canvas.addEventListener('pointerdown', (event) => { if (event.target === canvas) select(null); });
  const unsubscribe = model.subscribe(render);
  const observer = new ResizeObserver(fit);
  observer.observe(viewport);
  return { fit, syncSelection, cancelGesture, setZoom(value) { zoom = value; fit(); },
    setSnap(value) { snap = value; }, isDragging: () => !!gesture,
    dispose() {
      closed = true;
      cancelGesture();
      unsubscribe();
      observer.disconnect();
      for (const entry of entries.values()) entry.surface.dispose();
      entries.clear();
      viewport.remove();
    },
  };
}
