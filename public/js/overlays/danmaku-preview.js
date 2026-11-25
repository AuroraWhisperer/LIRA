import { CANVAS_PRESETS, createLayout, defaultRegion, fitRegion, normalizeLayout, resizeCanvas } from '../shared/danmaku-layout.js';
import { DANMAKU_STYLE_OPTIONS, isRandomDanmakuStyle, isFloatingDanmakuStyle, normalizeStyleOptions } from '../shared/danmaku-style-options.js';
import { isExternalComponentStyle } from '../shared/component-resource-style.js';
import { applyCanvas } from './danmaku-canvas.js';
import { initRegionEditor } from './danmaku-region-editor.js';
import { initPreviewAppearance } from './danmaku-preview-appearance.js';
import { createComponentPreviewClient, isComponentPreview, isSceneComponent } from './component-preview-client.js';
import { enhanceColorControls } from '../shared/color-control.js';
import { normalizeStyleParameters } from '../shared/component-style-parameters.js';

function initComponentCanvas({ initialStyle, styleOptions, duration, renderSamples, renderConfiguration, renderData }) {
  const host = document.getElementById('danmakuCanvasHost');
  const layer = new URLSearchParams(location.search).get('componentLayer') === '1';
  let draft = { style: initialStyle || 'signal', styleOptions: styleOptions || {},
    fullscreenDurationSeconds: Number(duration) || 6, layout: createLayout() };
  let scale = 1;
  let editable = false;
  let sampleKey = '';
  document.body.classList.add('is-component-preview');
  function fit() {
    const canvas = { width: host.clientWidth, height: host.clientHeight };
    const layout = layer ? { ...draft.layout, canvas,
      regions: { ...draft.layout.regions, [draft.style]: { x: 0, y: 0, ...canvas } } } : draft.layout;
    scale = applyCanvas(document, layout, draft.style, host.clientWidth, host.clientHeight, draft.styleOptions);
  }
  const observer = new ResizeObserver(fit);
  observer.observe(host);
  const client = createComponentPreviewClient({
    onConfig(config, canEdit) {
      if (!Object.hasOwn(draft.layout.regions, config?.style)) return false;
      try {
        draft = { ...config, style: config.style, styleOptions: normalizeStyleOptions(config.styleOptions || {}),
          fullscreenDurationSeconds: config.fullscreenDurationSeconds, layout: normalizeLayout(config.layout ?? null) || createLayout() };
      } catch { return false; }
      editable = canEdit && !layer && Boolean(config.layout);
      document.getElementById('danmakuSelection').hidden = !editable;
      const region = draft.layout.regions[draft.style];
      document.getElementById('selectionLabel').textContent = `${region.width} × ${region.height}`;
      fit();
      if (isSceneComponent()) {
        renderConfiguration(draft);
        return;
      }
      const nextSampleKey = JSON.stringify([draft.style, draft.styleOptions, draft.fullscreenDurationSeconds, draft.styleParameters]);
      if (nextSampleKey !== sampleKey) {
        sampleKey = nextSampleKey;
        renderSamples(draft.style, draft.styleOptions, draft.fullscreenDurationSeconds, draft.layout, draft);
      }
    },
    onData(data) { if (isSceneComponent()) renderData(data); },
    onDispose() { observer.disconnect(); window.dispatchEvent(new Event('lira:preview-dispose')); },
  });
  initRegionEditor(document.getElementById('danmakuSelection'), { getLayout: () => draft.layout, getStyle: () => draft.style,
    getScale: () => scale, change: (region) => {
      if (!editable) return;
      client.edit({ style: draft.style, region });
    } });
}

export function initDanmakuPreview({ initialStyle, styleOptions, duration, renderSamples, renderConfiguration, renderData }) {
  if (isComponentPreview()) return initComponentCanvas({ initialStyle, styleOptions, duration, renderSamples, renderConfiguration, renderData });
  const byId = (id) => document.getElementById(id);
  const controls = byId('danmakuPreviewControls');
  const choices = byId('danmakuPreviewStyles');
  const builtInStyles = Object.entries(DANMAKU_STYLE_OPTIONS).filter(([style]) => !isExternalComponentStyle(style));
  for (const [layout, label] of [['fixed', '固定位置弹幕'], ['horizontal', '横向弹幕'], ['random', '区域随机弹幕'], ['floating', '飘窗弹幕']]) {
    const group = document.createElement('div');
    group.className = 'danmaku-preview-choices';
    group.setAttribute('role', 'group');
    group.setAttribute('aria-label', label);
    const heading = document.createElement('h2'); heading.textContent = label; group.append(heading);
    for (const [style, options] of builtInStyles) {
      const kind = isFloatingDanmakuStyle(style) ? 'floating' : isRandomDanmakuStyle(style) ? 'random' : options.layout === 'horizontal' ? 'horizontal' : 'fixed';
      if (kind !== layout) continue;
      const button = document.createElement('button'); button.type = 'button'; button.dataset.previewStyle = style;
      const image = document.createElement('img'); image.src = `/img/overlays/danmaku-previews/${style}.${style === 'twitter' ? 'svg' : 'png'}`; image.alt = ''; image.loading = 'lazy';
      const name = document.createElement('span'); name.textContent = options.label;
      button.append(image, name); group.append(button);
    }
    choices.append(group);
  }
  for (const [width, height] of CANVAS_PRESETS) {
    const option = document.createElement('option'); option.value = width + 'x' + height; option.textContent = width + ' × ' + height;
    byId('canvasPreset').append(option);
  }
  const custom = document.createElement('option'); custom.value = 'custom'; custom.textContent = '自定义'; byId('canvasPreset').append(custom);
  enhanceColorControls(controls);
  const buttons = Array.from(controls.querySelectorAll('[data-preview-style]'));
  const host = byId('danmakuCanvasHost');
  const status = byId('previewSaveState');
  let savedHistory = {};
  let historyAvailable = true;
  try { savedHistory = window.history.state || {}; } catch { historyAvailable = false; }
  let draft = {
    style: initialStyle || savedHistory.danmakuPreviewStyle || 'signal',
    styleOptions: styleOptions || {},
    styleParameters: normalizeStyleParameters('danmaku', savedHistory.danmakuStyleParameters || {}),
    fullscreenDurationSeconds: Number(duration) || 6,
    layout: normalizeLayout(savedHistory.danmakuLayout ?? null) || createLayout(),
  };
  if (!buttons.some((button) => button.dataset.previewStyle === draft.style)) draft.style = 'signal';
  let scale = 1;
  controls.hidden = false;
  const appearance = initPreviewAppearance({ getDraft: () => draft, change: edit, error: (message) => { status.textContent = message; } });

  function fit() {
    scale = applyCanvas(document, draft.layout, draft.style, host.clientWidth, host.clientHeight, draft.styleOptions);
    byId('canvasZoom').textContent = `适应窗口 · ${Math.round(scale * 100)}%`;
  }
  function render(refreshSamples = true) {
    const { canvas, regions } = draft.layout;
    const region = regions[draft.style];
    for (const button of buttons) button.setAttribute('aria-pressed', String(button.dataset.previewStyle === draft.style));
    byId('canvasPreset').value = CANVAS_PRESETS.some(([w, h]) => w === canvas.width && h === canvas.height)
      ? `${canvas.width}x${canvas.height}` : 'custom';
    byId('canvasWidth').value = String(canvas.width);
    byId('canvasHeight').value = String(canvas.height);
    for (const key of ['x', 'y', 'width', 'height']) {
      const field = byId(`region${key[0].toUpperCase()}${key.slice(1)}`);
      field.value = String(region[key]);
      field.max = String(key === 'x' ? canvas.width - region.width : key === 'y' ? canvas.height - region.height
        : key === 'width' ? canvas.width : canvas.height);
    }
    const label = DANMAKU_STYLE_OPTIONS[draft.style].label;
    byId('danmakuPreviewDescription').textContent = `${canvas.width} × ${canvas.height} · ${label}`;
    byId('selectionLabel').textContent = `${region.width} × ${region.height}`;
    byId('regionHint').textContent = isFloatingDanmakuStyle(draft.style)
      ? '弹幕从右向左飘过区域；默认铺满画布，可拖动边框调整范围。'
      : DANMAKU_STYLE_OPTIONS[draft.style]?.layout === 'horizontal'
      ? '新消息到达时横向推移；默认在画布底部通栏显示，可调整位置与宽度。'
      : isRandomDanmakuStyle(draft.style)
      ? '弹幕在框内随机出现；缩小区域可避开直播主体。'
      : '拖动区域移动，拖动边框调整大小。方向键微调，Shift 加速。';
    byId('canvasSourceHint').textContent = `直播软件网页来源设为 ${canvas.width} × ${canvas.height}，即可还原位置。`;
    fit();
    appearance.render();
    if (refreshSamples) renderSamples(draft.style, draft.styleOptions, draft.fullscreenDurationSeconds, draft.layout, draft);
    if (historyAvailable) try {
      window.history.replaceState({ ...savedHistory, danmakuPreviewStyle: draft.style,
        danmakuStyleOptions: draft.styleOptions, danmakuStyleParameters: draft.styleParameters,
        danmakuDuration: draft.fullscreenDurationSeconds, danmakuLayout: draft.layout },
      '', `${window.location.pathname}?preview=1`);
    } catch { historyAvailable = false; }
  }
  function edit(next, refreshSamples = true) {
    draft = next;
    status.textContent = '本地预览；请从客户端打开场景编辑器以保存外观。';
    render(refreshSamples);
  }
  function regionChange(region) {
    edit({ ...draft, layout: { ...draft.layout, regions: { ...draft.layout.regions, [draft.style]: region } } }, false);
  }
  for (const button of buttons) button.addEventListener('click', () => edit({ ...draft, style: button.dataset.previewStyle }));
  for (const key of ['x', 'y', 'width', 'height']) {
    const field = byId(`region${key[0].toUpperCase()}${key.slice(1)}`);
    field.addEventListener('change', () => {
      const value = Number(field.value);
      if (!Number.isInteger(value) || value < Number(field.min) || value > Number(field.max)) {
        status.textContent = `请输入 ${field.min}～${field.max} 之间的整数。`;
        render(false);
        return;
      }
      regionChange(fitRegion({ ...draft.layout.regions[draft.style], [key]: value }, draft.layout.canvas));
    });
  }
  function canvasChange(width, height) {
    try { edit({ ...draft, layout: resizeCanvas(draft.layout, { width, height }) }); }
    catch { status.textContent = '画布宽高请输入 320～7680 的整数，整体缩放范围为 10%～800%。'; render(false); }
  }
  byId('canvasPreset').addEventListener('change', (event) => {
    if (event.target.value === 'custom') { byId('canvasWidth').focus(); return; }
    canvasChange(...event.target.value.split('x').map(Number));
  });
  for (const id of ['canvasWidth', 'canvasHeight']) byId(id).addEventListener('change', () =>
    canvasChange(Number(byId('canvasWidth').value), Number(byId('canvasHeight').value)));
  byId('regionCenter').addEventListener('click', () => {
    const region = draft.layout.regions[draft.style];
    regionChange(fitRegion({ ...region, x: (draft.layout.canvas.width - region.width) / 2,
      y: (draft.layout.canvas.height - region.height) / 2 }, draft.layout.canvas));
  });
  byId('regionFill').addEventListener('click', () => regionChange({ x: 0, y: 0, ...draft.layout.canvas }));
  byId('regionReset').addEventListener('click', () => {
    regionChange(defaultRegion(draft.style, draft.layout.canvas, draft.layout.contentScale));
    renderSamples(draft.style, draft.styleOptions, draft.fullscreenDurationSeconds, draft.layout, draft, true);
  });
  byId('previewRefresh').addEventListener('click', () => renderSamples(draft.style, draft.styleOptions, draft.fullscreenDurationSeconds, draft.layout, draft, true));
  initRegionEditor(byId('danmakuSelection'), { getLayout: () => draft.layout, getStyle: () => draft.style,
    getScale: () => scale, change: regionChange });
  const observer = new ResizeObserver(fit);
  observer.observe(host);
  window.addEventListener('pagehide', () => { appearance.dispose(); observer.disconnect(); }, { once: true });
  status.textContent = '本地预览；请从客户端打开场景编辑器以保存外观。';
  render();
}
