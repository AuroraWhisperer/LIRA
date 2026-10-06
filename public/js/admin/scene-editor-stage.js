import { previewElement, mountComponentPreview } from './component-preview-surface.js';
import { createSceneItemController } from './scene-item-controller.js';
import { moveSceneItems, resizeSceneItem } from './scene-document-model.js';
import { SCENE_COMPONENTS } from '../shared/scene-components.js';
import { createBrowserSourcePreview, mountBrowserSourcePreview } from './browser-source-preview.js';
import { createTextBoxPreview } from './text-box-preview.js';

export function mountSceneEditorStage(host, { model, components, getSelection, select, report }) {
  const viewport = previewElement('div', 'scene-editor-viewport');
  const extent = previewElement('div', 'scene-editor-extent');
  const canvas = previewElement('div', 'scene-editor-canvas');
  canvas.setAttribute('aria-label', '场景画布');
  const empty = previewElement('p', 'scene-editor-empty', '添加组件，开始编排直播画面。');
  canvas.append(empty);
  extent.append(canvas);
  viewport.append(extent);
  host.append(viewport);
  const entries = new Map();
  const contentSizes = new Map();
  let resizeFrame = 0;
  let scale = 1;
  let zoom = 'fit';
  let snap = true;
  let gesture = null;
  let closed = false;
  function scheduleContentResize() {
    if (resizeFrame || !contentSizes.size || closed) return;
    resizeFrame = requestAnimationFrame(() => {
      resizeFrame = 0;
      if (closed || model.isGestureActive()) return;
      const sizes = new Map(contentSizes);
      contentSizes.clear();
      try {
        model.edit((document) => {
          for (const [id, size] of sizes) {
            const item = document.items.find((entry) => entry.id === id);
            if (!item || item.appearance.config?.mediaStyle || Math.round(item.width) !== size.width) continue;
            if (item.locked) { contentSizes.set(id, size); continue; }
            if (SCENE_COMPONENTS[item.type].lockAspectRatio && Number.isFinite(size.contentWidth) && size.contentWidth > 0) {
              const scale = Math.min(1, document.canvas.width / size.contentWidth, document.canvas.height / size.height);
              item.width = Math.max(32, Math.floor(size.contentWidth * scale));
              size.height *= scale;
            }
            item.height = Math.max(32, Math.min(document.canvas.height, Math.ceil(size.height)));
          }
        }, { recordHistory: false });
      } catch (error) { report(error.message); }
    });
  }
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
    for (const entry of entries.values()) positionContentLabel(entry);
  }
  function positionContentLabel(entry) {
    if (!SCENE_COMPONENTS[entry.host.dataset.component].contentHeight && entry.host.dataset.component !== 'gift-sprint') return;
    const space = entry.label.offsetHeight + 6;
    const above = entry.host.offsetTop * scale >= space;
    const below = (canvas.clientHeight - entry.host.offsetTop - entry.host.offsetHeight) * scale >= space;
    entry.label.classList.toggle('is-above', above);
    entry.label.classList.toggle('is-below', !above && below);
  }
  function syncSelection() {
    const selected = getSelection();
    for (const [id, entry] of entries) {
      entry.host.classList.toggle('is-selected', selected.has(id));
      entry.host.classList.toggle('is-resizable', selected.size === 1 && selected.has(id));
      entry.host.setAttribute('aria-pressed', String(selected.has(id)));
      positionContentLabel(entry);
    }
  }
  function cancelGesture() {
    if (!gesture) return;
    const { pointerId } = gesture;
    gesture = null;
    model.cancelGesture();
    if (canvas.hasPointerCapture(pointerId)) canvas.releasePointerCapture(pointerId);
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
    const handle = event.target.closest('[data-resize]')?.dataset.resize;
    gesture = { pointerId: event.pointerId, x: event.clientX, y: event.clientY, ids, handle, started: false };
    canvas.setPointerCapture(event.pointerId);
  }
  function pointerMove(event) {
    if (!gesture || event.pointerId !== gesture.pointerId) return;
    const deltaX = Math.round((event.clientX - gesture.x) / scale);
    const deltaY = Math.round((event.clientY - gesture.y) / scale);
    if (!gesture.started && Math.abs(deltaX) + Math.abs(deltaY) < 2) return;
    try {
      if (!gesture.started) { gesture.started = true; model.beginGesture(); }
      model.updateGesture((document) => gesture.handle
        ? resizeSceneItem(document, gesture.ids[0], gesture.handle, deltaX, deltaY, { snap })
        : moveSceneItems(document, gesture.ids, deltaX, deltaY, { snap }));
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
      contentSizes.delete(id);
    }
    for (const [index, item] of document.items.entries()) {
      if (!item.visible) continue;
      let entry = entries.get(item.id);
      if (!entry) {
        const component = components.find((value) => value.id === item.type)
          || (item.type === 'browser' ? createBrowserSourcePreview() : item.type === 'text-box' ? createTextBoxPreview() : null);
        const node = previewElement('div', 'scene-editor-item');
        node.dataset.itemId = item.id;
        node.dataset.component = item.type;
        node.tabIndex = 0;
        node.setAttribute('role', 'button');
        const label = previewElement('span', 'scene-editor-item-label');
        node.append(label);
        canvas.append(node);
        const controller = createSceneItemController(model, item.id, component.controller);
        const capabilities = SCENE_COMPONENTS[item.type];
        const mountPreview = item.type === 'browser' ? mountBrowserSourcePreview : mountComponentPreview;
        const surface = mountPreview(node, { ...component, controller,
          onOpen: undefined, onClose: undefined, onEdit: undefined, bounds: undefined,
          dataModes: undefined,
          startData: component.startLayerData || component.startData,
          ...(capabilities.contentHeight ? {
            onResize(size) { contentSizes.set(item.id, size); scheduleContentResize(); },
          } : {}),
          size: () => {
            const current = model.getDocument().items.find((value) => value.id === item.id) || item;
            return [current.width, current.height];
          },
        });
        for (const direction of capabilities.resizeAxes === 'x' ? ['e', 'w'] : ['n', 'e', 's', 'w', 'ne', 'se', 'sw', 'nw']) {
          const handle = previewElement('span', 'scene-editor-resize-handle');
          handle.dataset.resize = direction;
          handle.setAttribute('aria-hidden', 'true');
          node.append(handle);
        }
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
      entry.label.textContent = `${item.name} · ${Math.round(item.width)} × ${Math.round(item.height)} px`;
    }
    empty.hidden = document.items.some((item) => item.visible);
    fit();
    syncSelection();
    scheduleContentResize();
  }
  canvas.addEventListener('pointermove', pointerMove);
  canvas.addEventListener('pointerup', pointerUp);
  canvas.addEventListener('pointercancel', cancelGesture);
  canvas.addEventListener('lostpointercapture', cancelGesture);
  canvas.addEventListener('keydown', (event) => {
    if (event.key !== 'Escape' || !gesture) return;
    event.preventDefault();
    event.stopPropagation();
    cancelGesture();
  });
  canvas.addEventListener('pointerdown', (event) => { if (event.target === canvas) select(null); });
  window.addEventListener('blur', cancelGesture);
  const unsubscribe = model.subscribe(render);
  const observer = new ResizeObserver(fit);
  observer.observe(viewport);
  return { fit, syncSelection, cancelGesture, setZoom(value) { zoom = value; fit(); },
    setSnap(value) { snap = value; }, isDragging: () => !!gesture,
    dispose() {
      closed = true;
      cancelGesture();
      window.removeEventListener('blur', cancelGesture);
      unsubscribe();
      observer.disconnect();
      cancelAnimationFrame(resizeFrame);
      contentSizes.clear();
      for (const entry of entries.values()) entry.surface.dispose();
      entries.clear();
      viewport.remove();
    },
  };
}
