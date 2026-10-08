import { STYLE_PARAMETER_GROUPS, STYLE_PARAMETER_CAPABILITIES, componentStyleKey, styleParameterCapabilities, styleParameterDefaults,
  styleParametersFor, editStyleParameter, normalizeStyleParameters } from '../shared/component-style-parameters.js';
import { previewElement } from './component-preview-surface.js';
import { syncComponentFieldValue } from './component-preview-panel.js';
import { enhanceColorControls } from '../shared/color-control.js';

export function mountStyleParameters(host, controller, type, { messageHost } = {}) {
  host.querySelector('[data-style-parameters-panel]')?.remove();
  messageHost?.querySelector('[data-show-entry-messages]')?.closest('label').remove();
  if (!document.querySelector('link[data-style-parameters-css]')) {
    const link = document.createElement('link');
    link.rel = 'stylesheet'; link.href = '/css/admin/component-style-parameters.css';
    link.dataset.styleParametersCss = ''; document.head.append(link);
  }
  const root = previewElement('section', 'component-style-parameters');
  root.dataset.styleParametersPanel = type;
  root.append(previewElement('h3', 'ui-section-title', '外观效果'));
  const hint = previewElement('p', 'hint', type === 'browser'
    ? '可调整整个网页的投影、发光、边框和变换；内部调色、文字和消息显示由原网页控制。'
    : '仅调整当前样式。未开启的调整沿用原样式，强度设为 0 可关闭对应效果。');
  const status = previewElement('p', 'component-style-parameter-error');
  status.setAttribute('role', 'status'); status.hidden = true;
  root.append(hint);
  const groups = new Map();
  let currentKey = '';
  function change(group, value) {
    try {
      const { draft } = controller.getState();
      const patch = editStyleParameter(draft, group, value);
      controller.edit({ styleParameters: normalizeStyleParameters(type, patch.styleParameters) });
      status.hidden = true;
    } catch (error) { status.textContent = error.message; status.hidden = false; }
  }
  const advanced = previewElement('details', 'component-parameter-advanced');
  advanced.append(previewElement('summary', '', '调色与变形'));
  for (const [name, group] of Object.entries(STYLE_PARAMETER_GROUPS)) {
    const details = previewElement('details', 'component-parameter-group');
    details.dataset.effectGroup = name;
    const summary = previewElement('summary', '', group.label);
    const state = previewElement('span', 'component-parameter-state', '原样式'); summary.append(state);
    const toggleLabel = previewElement('label', 'component-parameter-toggle');
    const toggle = previewElement('input'); toggle.type = 'checkbox';
    toggle.dataset.effectEnabled = name;
    toggleLabel.append(toggle, document.createTextNode(`调整${group.label}`));
    const fields = previewElement('fieldset', 'component-parameter-fields');
    fields.setAttribute('aria-label', group.label);
    const controls = new Map();
    for (const [key, field] of Object.entries(group.fields)) {
      const title = `${field.label}${field.unit ? `（${field.unit}）` : ''}`;
      const label = previewElement('label', 'component-parameter-field', title);
      const row = previewElement('span', 'component-parameter-inputs');
      const input = previewElement('input'); input.type = field.type || 'number';
      input.setAttribute('aria-label', `${group.label} · ${title}`);
      input.dataset.effectField = `${name}.${key}`;
      let slider;
      if (input.type === 'number') {
        input.required = true;
        slider = previewElement('input'); slider.type = 'range';
        slider.setAttribute('aria-label', `${group.label} · ${field.label}滑块`);
        for (const control of [slider, input]) {
          control.min = field.min; control.max = field.max; control.step = field.step;
        }
        slider.addEventListener('input', () => { input.value = slider.value; save(); });
        row.append(slider);
      }
      function save() {
        if (!input.checkValidity()) return;
        const current = styleParametersFor(controller.getState().draft)[name] || styleParameterDefaults(name);
        change(name, { ...current, [key]: input.type === 'color' ? input.value : Number(input.value) });
      }
      input.addEventListener('input', save);
      input.addEventListener('change', () => input.reportValidity());
      row.append(input); label.append(row); fields.append(label);
      controls.set(key, { input, slider });
    }
    toggle.addEventListener('change', () => change(name, toggle.checked ? styleParameterDefaults(name) : null));
    details.append(summary, toggleLabel, fields);
    (group.advanced ? advanced : root).append(details);
    groups.set(name, { details, fields, toggle, state, controls });
  }
  root.append(advanced);
  let entry;
  let entryLabel;
  if (type === 'danmaku') {
    entryLabel = previewElement('label', 'component-parameter-toggle');
    entry = previewElement('input'); entry.type = 'checkbox'; entry.dataset.showEntryMessages = '';
    entry.addEventListener('change', () => change('showEntryMessages', entry.checked));
    entryLabel.append(entry, document.createTextNode('显示进房消息'));
    (messageHost || root).append(entryLabel);
  }
  const reset = previewElement('button', 'secondary', '恢复当前样式效果'); reset.type = 'button';
  reset.addEventListener('click', () => {
    const { draft } = controller.getState();
    controller.edit({ styleParameters: { ...draft.styleParameters, [componentStyleKey(draft)]: {} } });
    status.hidden = true;
  });
  root.append(status, reset); host.append(root);
  enhanceColorControls(root);
  const stop = controller.subscribe(({ draft, loaded }) => {
    const key = componentStyleKey(draft);
    const force = key !== currentKey;
    currentKey = key;
    const parameters = styleParametersFor(draft);
    const supported = styleParameterCapabilities(type, draft);
    if (type !== 'browser') {
      const kind = draft.mediaStyle ? 'art' : ['blc', 'blivechat'].includes(draft.cssStyle?.engine) ? 'panel'
        : STYLE_PARAMETER_CAPABILITIES[type]?.[draft.style];
      const target = kind === 'text' ? '光影作用于文字。' : kind === 'moon' ? '光影和轮廓作用于月轮底板。'
        : ['panel', 'frame'].includes(kind) ? '光影和轮廓作用于卡片底板。' : '光影和轮廓作用于整体图案。';
      hint.textContent = `${target}仅调整当前样式；未开启的调整沿用原样式，强度设为 0 可关闭对应效果。`;
    }
    advanced.hidden = !supported.some(name => STYLE_PARAMETER_GROUPS[name].advanced);
    for (const [name, view] of groups) {
      view.details.hidden = !supported.includes(name);
      view.toggle.checked = Object.hasOwn(parameters, name);
      view.toggle.disabled = !loaded;
      view.fields.disabled = !loaded || !view.toggle.checked;
      view.state.textContent = view.toggle.checked ? '已调整' : '原样式';
      const values = parameters[name] || styleParameterDefaults(name);
      for (const [key, { input, slider }] of view.controls) {
        syncComponentFieldValue(input, values[key], force);
        if (slider) slider.value = values[key];
      }
    }
    if (entry) { entry.checked = parameters.showEntryMessages === true; entry.disabled = !loaded; }
    reset.disabled = !loaded || !Object.keys(parameters).length;
  });
  return { dispose() { stop(); entryLabel?.remove(); root.remove(); } };
}
