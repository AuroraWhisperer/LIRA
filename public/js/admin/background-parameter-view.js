import { BACKGROUND_FIELDS, BACKGROUND_GROUPS, getBackgroundAppearance, isVideoBackground } from '../shared/background-appearance.js';
import { previewElement } from './component-preview-surface.js';
import { syncComponentFieldValue } from './component-preview-panel.js';

export function mountBackgroundParameters(host, controller) {
  const root = previewElement('div', 'background-parameters');
  const groups = new Map();
  for (const [key, title] of Object.entries(BACKGROUND_GROUPS)) {
    const fields = previewElement('div', 'background-parameter-fields');
    groups.set(key, fields);
    if (['basic', 'playback'].includes(key)) root.append(fields);
    else {
      const section = previewElement('details', 'component-style-advanced');
      section.append(previewElement('summary', '', title), fields);
      root.append(section);
    }
  }
  const playback = groups.get('playback');
  const controls = new Map();
  for (const [key, field] of Object.entries(BACKGROUND_FIELDS)) {
    const scale = field.displayScale ?? 1;
    const unit = field.unit;
    const title = `${field.label}${unit ? `（${unit}）` : ''}`;
    const wrapper = previewElement('div', 'background-parameter', title);
    const input = previewElement(field.type === 'select' ? 'select' : 'input');
    input.dataset.componentParameter = key;
    input.setAttribute('aria-label', title);
    if (field.type === 'select') {
      for (const [value, title] of Object.entries(field.options)) {
        const option = previewElement('option', '', title); option.value = value; input.append(option);
      }
    } else input.type = field.type;
    const row = previewElement('div', 'background-parameter-control');
    let slider;
    if (field.type === 'number') {
      slider = previewElement('input'); slider.type = 'range';
      slider.setAttribute('aria-label', `${field.label}滑块`);
      slider.dataset.backgroundSlider = key;
      for (const control of [input, slider]) {
        control.min = field.min * scale; control.max = field.max * scale; control.step = field.step * scale;
      }
      input.required = true;
      slider.addEventListener('input', () => {
        input.value = slider.value;
        controller.edit({ [key]: Number(slider.value) / scale });
      });
      row.append(slider);
    }
    input.addEventListener(field.type === 'color' || field.type === 'number' ? 'input' : 'change', () => {
      if (!input.checkValidity()) return;
      if (slider) slider.value = input.value;
      controller.edit({ [key]: field.type === 'checkbox' ? input.checked : field.type === 'number' ? Number(input.value) / scale : input.value });
    });
    row.append(input); wrapper.append(row);
    groups.get(field.group ?? 'basic').append(wrapper);
    controls.set(key, { input, slider, scale, wrapper });
  }
  groups.get('basic').append(previewElement('p', 'hint', '仅调整背景；不透明度调低后会透出下层画面。'));
  groups.get('color').append(previewElement('p', 'hint', '白色遮罩让背景变浅，黑色遮罩压暗背景；强度 0% 为关闭。'));
  groups.get('whiteBalance').append(previewElement('p', 'hint', '色温、色调为 0 时保留原色。旧样式保留旧版调色；切换方式会改变非零参数的效果。'));
  groups.get('grading').append(previewElement('p', 'hint', '逐通道调节暗部、中间调与亮部；Lift 0、Gamma 1、Gain 1 为原色。三个范围会相互影响。'));
  groups.get('legacyGrading').append(previewElement('p', 'hint', '仅兼容旧样式的分区乘色；白色中性，不是 Lift / Gamma / Gain。'));
  groups.get('glow').append(previewElement('p', 'hint', '降低阈值可让更多亮部泛光；强度 0% 为关闭。'));
  groups.get('grain').append(previewElement('p', 'hint', '固定颗粒纹理；强度 0% 为关闭。'));
  playback.append(previewElement('p', 'hint', '视频循环播放；音量 0% 为静音，无声素材不受音量影响。'));
  const reset = previewElement('button', 'secondary', '恢复样式默认'); reset.type = 'button';
  reset.addEventListener('click', () => controller.edit(getBackgroundAppearance(controller.getState().draft.backgroundDefaults)));
  root.append(reset); host.append(root);
  const stop = controller.subscribe(({ draft, loaded }) => {
    const appearance = getBackgroundAppearance(draft);
    for (const [black, white] of [['inputBlack', 'inputWhite'], ['outputBlack', 'outputWhite']]) {
      for (const control of [controls.get(black).input, controls.get(black).slider]) control.max = appearance[white] - 1;
      for (const control of [controls.get(white).input, controls.get(white).slider]) control.min = appearance[black] + 1;
    }
    groups.get('grading').parentElement.hidden = appearance.colorProcessing !== 'standard';
    groups.get('legacyGrading').parentElement.hidden = appearance.colorProcessing !== 'legacy';
    for (const [key, { input, slider, scale, wrapper }] of controls) {
      wrapper.hidden = Boolean(BACKGROUND_FIELDS[key].mode && BACKGROUND_FIELDS[key].mode !== appearance.colorProcessing);
      const value = typeof appearance[key] === 'number' ? Number((appearance[key] * scale).toFixed(2)) : appearance[key];
      if (input.type === 'checkbox') input.checked = value;
      else syncComponentFieldValue(input, value);
      if (slider) slider.value = value;
      input.disabled = !loaded;
      if (slider) slider.disabled = !loaded;
    }
    playback.hidden = !isVideoBackground(draft);
    reset.disabled = !loaded;
  });
  return { dispose: stop };
}
