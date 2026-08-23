// Queue overlay panel scaling.
// Every style keeps its own design coordinates while this module applies one
// contain scale to the completed panel.
'use strict';

export function calculateQueuePanelScale(viewportWidth, viewportHeight, panelWidth, panelHeight, edge = 0) {
  const safeViewportWidth = Math.max(1, Number(viewportWidth) || 1);
  const safeViewportHeight = Math.max(1, Number(viewportHeight) || 1);
  const safePanelWidth = Math.max(1, Number(panelWidth) || 1);
  const safePanelHeight = Math.max(1, Number(panelHeight) || 1);
  const safeEdge = Math.max(0, Number(edge) || 0);
  const availableWidth = Math.max(1, safeViewportWidth - (2 * safeEdge));
  const availableHeight = Math.max(1, safeViewportHeight - (2 * safeEdge));

  return Math.min(availableWidth / safePanelWidth, availableHeight / safePanelHeight);
}

export function syncQueuePanelViewport(panel) {
  if (!panel || !panel.style) return 1;

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
  const panelWidth = Number(panel.offsetWidth || panel.clientWidth) || 1;
  const panelHeight = Number(panel.offsetHeight || panel.clientHeight) || 1;
  const scale = calculateQueuePanelScale(
    viewportWidth,
    viewportHeight,
    panelWidth,
    panelHeight,
    edge
  );

  panel.style.setProperty('--queue-panel-scale', String(scale));
  return scale;
}
