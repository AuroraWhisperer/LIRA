// Canvas coordinates are independent of the editor or live source viewport.
export function applyCanvas(document, layout, style, width, height) {
  document.body.classList.toggle('has-layout', Boolean(layout));
  if (!layout) return 1;
  const region = layout.regions[style];
  const scale = Math.min(width / layout.canvas.width, height / layout.canvas.height);
  const values = {
    'canvas-width': `${layout.canvas.width}px`, 'canvas-height': `${layout.canvas.height}px`,
    'canvas-fit': scale, 'content-scale': layout.contentScale,
    'region-x': `${region.x}px`, 'region-y': `${region.y}px`,
    'region-width': `${region.width}px`, 'region-height': `${region.height}px`,
    'region-content-width': `${region.width / layout.contentScale}px`,
    'region-content-height': `${region.height / layout.contentScale}px`,
  };
  for (const [key, value] of Object.entries(values)) document.documentElement.style.setProperty(`--${key}`, String(value));
  return scale;
}
