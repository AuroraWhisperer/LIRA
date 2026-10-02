import { REGION_DEFAULTS } from '../shared/danmaku-layout.js';

export function canvasContentScale(layout, style) {
  const width = REGION_DEFAULTS[style]?.[0];
  const region = layout.regions[style];
  // Keep room for the stage insets and a complete card even in a very short region.
  return Math.min(width ? region.width / width : Math.min(layout.contentScale, region.width / 720), region.height / 64);
}

// Canvas coordinates are independent of the editor or live source viewport.
export function applyCanvas(document, layout, style, width, height) {
  document.body.classList.toggle('has-layout', Boolean(layout));
  if (!layout) return 1;
  const region = layout.regions[style];
  const scale = Math.min(width / layout.canvas.width, height / layout.canvas.height);
  const contentScale = canvasContentScale(layout, style);
  const contentWidth = region.width / contentScale;
  const values = {
    'canvas-width': `${layout.canvas.width}px`, 'canvas-height': `${layout.canvas.height}px`,
    'canvas-fit': scale, 'content-scale': contentScale,
    'region-x': `${region.x}px`, 'region-y': `${region.y}px`,
    'region-width': `${region.width}px`, 'region-height': `${region.height}px`,
    'region-content-width': `${contentWidth}px`,
    'region-content-height': `${region.height / contentScale}px`,
    // Cards share the stage's 12px inset and scale only inside its design space.
    'region-card-scale': Math.min(1.5, Math.max(1, contentWidth - 24) / 460),
  };
  for (const [key, value] of Object.entries(values)) document.documentElement.style.setProperty(`--${key}`, String(value));
  return scale;
}
