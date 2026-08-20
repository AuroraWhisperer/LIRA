// Queue overlay shared viewport-resize state.
// Kept separate from queue.js so scroll mechanics never depend on the entry
// module, and separate from queue-scroll.js so the entry can set it while the
// scroll module reads it without a circular import.
'use strict';

let queueViewportResized = false;

export function calculateIllustratedQueueScale(viewportWidth, viewportHeight, canvasWidth, canvasHeight, edge = 0) {
  const safeViewportWidth = Math.max(1, Number(viewportWidth) || 1);
  const safeViewportHeight = Math.max(1, Number(viewportHeight) || 1);
  const safeCanvasWidth = Math.max(1, Number(canvasWidth) || 1);
  const safeCanvasHeight = Math.max(1, Number(canvasHeight) || 1);
  const safeEdge = Math.max(0, Number(edge) || 0);
  const availableWidth = Math.max(1, safeViewportWidth - (2 * safeEdge));
  const availableHeight = Math.max(1, safeViewportHeight - (2 * safeEdge));

  return Math.min(1, availableWidth / safeCanvasWidth, availableHeight / safeCanvasHeight);
}

export function syncIllustratedQueueViewport(panel, illustrated) {
  if (!panel || !panel.style) return 1;
  if (!illustrated) {
    panel.style.removeProperty('--illustrated-queue-scale');
    return 1;
  }

  const ownerDocument = panel.ownerDocument || document;
  const view = ownerDocument.defaultView || window;
  const panelStyle = typeof view.getComputedStyle === 'function' ? view.getComputedStyle(panel) : null;
  const edge = panelStyle
    ? Math.max(
        Number.parseFloat(panelStyle.marginLeft) || 0,
        Number.parseFloat(panelStyle.marginTop) || 0
      )
    : 0;
  const viewportWidth = Number(view.innerWidth || ownerDocument.documentElement?.clientWidth) || 1;
  const viewportHeight = Number(view.innerHeight || ownerDocument.documentElement?.clientHeight) || 1;
  const canvasWidth = Number(panel.offsetWidth || panel.clientWidth) || 1;
  const canvasHeight = Number(panel.offsetHeight || panel.clientHeight) || 1;
  const scale = calculateIllustratedQueueScale(
    viewportWidth,
    viewportHeight,
    canvasWidth,
    canvasHeight,
    edge
  );

  panel.style.setProperty('--illustrated-queue-scale', String(scale));
  return scale;
}

export function isQueueViewportResized() {
  return queueViewportResized;
}

export function markQueueViewportResized() {
  queueViewportResized = true;
}
