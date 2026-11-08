import { REGION_DEFAULTS } from '../shared/danmaku-layout.js';
import { DANMAKU_STYLE_OPTIONS } from '../shared/danmaku-style-options.js';

// Default placement can change without enlarging text in saved regions.
const FIXED_DESIGN_WIDTHS = Object.freeze({
  'sea-breeze': 480, sketch: 680, prismatic: 640, harbor: 640, snowfox: 640,
  ripploid: 520, twitter: 530, 'flower-letter': 640, spooky: 530, notebook: 640,
  glass: 696, 'animated-gradient': 520, christmas: 560, stargazer: 560,
  'christmas-letter': 560, wireframe: 480, starlight: 520, 'dark-moon': 640, moonlit: 640,
});

export function canvasContentScale(layout, style, styleOptions = {}) {
  const width = FIXED_DESIGN_WIDTHS[style] ?? REGION_DEFAULTS[style]?.[0];
  const region = layout.regions[style];
  // Widening a horizontal strip adds room for cards instead of enlarging each card.
  if (DANMAKU_STYLE_OPTIONS[style]?.layout === 'horizontal' || styleOptions[style]?.stargazerLayout === 'horizontal' || styleOptions[style]?.glowyLayout === 'horizontal') {
    return Math.min(layout.contentScale, region.width / 64, region.height / 64);
  }
  // Keep room for the stage insets and a complete card even in a very short region.
  return Math.min(width ? region.width / width : Math.min(layout.contentScale, region.width / 720), region.height / 64);
}

// Canvas coordinates are independent of the editor or live source viewport.
export function applyCanvas(document, layout, style, width, height, styleOptions = {}) {
  document.body.classList.toggle('has-layout', Boolean(layout));
  if (!layout) return 1;
  const region = layout.regions[style];
  const scale = Math.min(width / layout.canvas.width, height / layout.canvas.height);
  const contentScale = canvasContentScale(layout, style, styleOptions);
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
