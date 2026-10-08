import { localOverlayOrigin } from '../shared/utils.js';
import { CANVAS_PRESETS, createLayout, defaultRegion, fitRegion, normalizeLayout, resizeCanvas } from '../shared/danmaku-layout.js';
import { DANMAKU_STYLE_OPTIONS } from '../shared/danmaku-style-options.js';
import { cloneComponentPanel } from './component-preview-panel.js';
import { bindDanmakuParameters } from './danmaku-parameter-view.js';

export function applyDanmakuRegionEdit(controller, change) {
  const { draft, loaded } = controller.getState();
  if (!loaded || !Object.hasOwn(draft, 'layout') || !Object.hasOwn(DANMAKU_STYLE_OPTIONS, change?.style)) return;
  try {
    const current = draft.layout || createLayout();
    const layout = normalizeLayout({ ...current, regions: { ...current.regions, [change.style]: change.region } });
    controller.edit({ layout });
  } catch { return; }
}

function createPanel(host, controller, source, embedded) {
  const choices = document.createElement('div');
  choices.className = 'danmaku-style-options';
  for (const original of embedded ? [] : source.querySelectorAll('[data-danmaku-style]')) {
    const button = original.cloneNode(true);
    button.addEventListener('click', () => {
      controller.edit({ style: button.dataset.danmakuStyle, ...(controller.getState().draft.mediaStyle ? { mediaStyle: null } : {}),
        ...(controller.getState().draft.resourceStyle ? { resourceStyle: null } : {}) });
    });
    choices.append(button);
  }
  const parameters = cloneComponentPanel(source.querySelector('.danmaku-parameters'), 'preview-danmaku');
  const error = document.createElement('p');
  error.setAttribute('role', 'status');
  if (!embedded) host.append(choices);
  host.append(parameters, error);
  const parameterView = bindDanmakuParameters(parameters, controller, (message) => { error.textContent = message; });
  if (embedded) {
    return { dispose() { parameterView.dispose(); } };
  }
  const heading = document.createElement('h3');
  heading.textContent = '画布与弹幕区域';
  const fields = document.createElement('div');
  fields.className = 'component-preview-fields';
  const inputs = {};
  for (const [key, title] of [['canvasWidth', '画布宽度'], ['canvasHeight', '画布高度'],
    ['x', '区域 X'], ['y', '区域 Y'], ['width', '区域宽度'], ['height', '区域高度']]) {
    const label = document.createElement('label');
    label.textContent = title;
    const input = document.createElement('input');
    input.type = 'number';
    input.step = '1';
    input.min = key.startsWith('canvas') ? '320' : ['width', 'height'].includes(key) ? '32' : '0';
    label.append(input);
    fields.append(label);
    inputs[key] = input;
    input.addEventListener('change', () => {
      const draft = controller.getState().draft;
      if (!Object.hasOwn(draft, 'layout')) return;
      const layout = draft.layout || createLayout();
      try {
        if (key.startsWith('canvas')) {
          controller.edit({ layout: resizeCanvas(layout, { width: Number(inputs.canvasWidth.value), height: Number(inputs.canvasHeight.value) }) });
        } else {
          const value = Number(input.value);
          if (!Number.isInteger(value)) throw new Error('区域参数请输入整数。');
          applyDanmakuRegionEdit(controller, { style: draft.style,
            region: fitRegion({ ...layout.regions[draft.style], [key]: value }, layout.canvas) });
        }
      } catch (failure) { error.textContent = failure.message; render(controller.getState()); }
    });
  }
  const presets = document.createElement('select');
  presets.setAttribute('aria-label', '画布分辨率');
  for (const [width, height] of CANVAS_PRESETS) {
    const option = document.createElement('option');
    option.value = `${width}x${height}`;
    option.textContent = `${width} × ${height}`;
    presets.append(option);
  }
  const custom = document.createElement('option');
  custom.value = 'custom';
  custom.textContent = '自定义';
  presets.append(custom);
  presets.addEventListener('change', () => {
    if (presets.value === 'custom') return;
    const [width, height] = presets.value.split('x').map(Number);
    controller.edit({ layout: resizeCanvas(controller.getState().draft.layout || createLayout(), { width, height }) });
  });
  const actions = document.createElement('div');
  actions.className = 'row';
  for (const [action, text] of [['center', '区域居中'], ['fill', '铺满画布'], ['reset', '恢复区域默认']]) {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'secondary';
    button.textContent = text;
    button.addEventListener('click', () => {
      const { draft } = controller.getState();
      if (!Object.hasOwn(draft, 'layout')) return;
      const layout = draft.layout || createLayout();
      const region = layout.regions[draft.style];
      applyDanmakuRegionEdit(controller, { style: draft.style, region: action === 'reset'
        ? defaultRegion(draft.style, layout.canvas, layout.contentScale) : action === 'fill'
          ? { x: 0, y: 0, ...layout.canvas }
          : fitRegion({ ...region, x: (layout.canvas.width - region.width) / 2,
            y: (layout.canvas.height - region.height) / 2 }, layout.canvas) });
    });
    actions.append(button);
  }
  const hint = document.createElement('p');
  hint.className = 'hint';
  hint.textContent = '拖动预览中的区域移动或调整大小；坐标按正式输出保存。';
  host.append(heading, presets, fields, actions, hint);
  function render({ draft, loaded }) {
    const layout = draft.layout || createLayout();
    const region = layout.regions[draft.style];
    for (const [key, input] of Object.entries(inputs)) {
      input.value = String(key === 'canvasWidth' ? layout.canvas.width : key === 'canvasHeight' ? layout.canvas.height : region[key]);
      input.disabled = !loaded || !Object.hasOwn(draft, 'layout');
    }
    presets.value = CANVAS_PRESETS.some(([width, height]) => width === layout.canvas.width && height === layout.canvas.height)
      ? `${layout.canvas.width}x${layout.canvas.height}` : 'custom';
    presets.disabled = !loaded || !Object.hasOwn(draft, 'layout');
    for (const button of actions.querySelectorAll('button')) button.disabled = presets.disabled;
    for (const button of choices.querySelectorAll('button')) {
      button.disabled = false;
      button.setAttribute('aria-pressed', String(button.dataset.danmakuStyle === draft.style));
    }
  }
  const unsubscribe = controller.subscribe(render);
  return { dispose() { unsubscribe(); parameterView.dispose(); } };
}

export function createDanmakuPreview({ controller, source = document, embedded = false }) {
  return { id: 'danmaku', title: '弹幕姬', controller,
    url: new URL(`/danmaku?preview=1&componentPreview=1${embedded ? '&componentLayer=1' : ''}`, localOverlayOrigin()).href,
    createPanel: (host, targetController = controller) => createPanel(host, targetController, source, embedded),
    projectConfig: (draft) => ({ ...draft, ...(Object.hasOwn(draft, 'layout') ? { layout: draft.layout || createLayout() } : {}) }),
    size: (draft) => { const canvas = (draft.layout || createLayout()).canvas; return [canvas.width, canvas.height]; },
    bounds: (draft) => (draft.layout || createLayout()).regions[draft.style],
    onEdit: (change) => applyDanmakuRegionEdit(controller, change),
  };
}
