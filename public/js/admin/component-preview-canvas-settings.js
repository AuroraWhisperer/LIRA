import { CANVAS_PRESETS } from '../shared/canvas-presets.js';
import { previewElement } from './component-preview-surface.js';
import { resizeSceneCanvas } from './scene-document-model.js';

export function mountPreviewCanvasSettings(host, { model, report }) {
  host.append(previewElement('h3', '', '画布设置'));
  const label = previewElement('label', 'preview-canvas-preset', '分辨率预设');
  const presets = previewElement('select');
  presets.setAttribute('aria-label', '公共画布分辨率');
  for (const [width, height] of CANVAS_PRESETS) {
    const option = previewElement('option', '', `${width} × ${height}${width < height ? ' · 竖屏' : ''}`);
    option.value = `${width}x${height}`;
    presets.append(option);
  }
  const custom = previewElement('option', '', '自定义');
  custom.value = 'custom';
  presets.append(custom);
  label.append(presets);
  const fields = previewElement('div', 'component-preview-fields');
  const inputs = {};
  let renderedCanvas = null;
  function resize(canvas) {
    try { model.edit((document) => resizeSceneCanvas(document, canvas)); }
    catch (error) { report(error.message); render(true); }
  }
  for (const [key, text] of [['width', '画布宽度'], ['height', '画布高度']]) {
    const wrapper = previewElement('label', '', text);
    const input = previewElement('input');
    input.type = 'number'; input.min = '320'; input.max = '7680'; input.step = '1'; input.required = true;
    inputs[key] = input;
    wrapper.append(input); fields.append(wrapper);
    input.addEventListener('change', () => {
      if (!input.reportValidity()) { render(true); return; }
      resize({ ...model.getDocument().canvas, [key]: Number(input.value) });
    });
  }
  presets.addEventListener('change', () => {
    if (presets.value === 'custom') { inputs.width.focus(); return; }
    const [width, height] = presets.value.split('x').map(Number);
    resize({ width, height });
  });
  host.append(label, fields);
  function render(force = false) {
    const { width, height } = model.getDocument().canvas;
    if (!force && renderedCanvas?.width === width && renderedCanvas?.height === height) return;
    renderedCanvas = { width, height };
    inputs.width.value = String(width); inputs.height.value = String(height);
    presets.value = CANVAS_PRESETS.some(([w, h]) => w === width && h === height) ? `${width}x${height}` : 'custom';
  }
  return { dispose: model.subscribe(() => render()) };
}
