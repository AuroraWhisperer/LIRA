import { GIFT_MOTION_EFFECTS, GIFT_MOTION_DEFAULTS } from '../shared/gift-motion-settings.js';
import { previewElement } from './component-preview-elements.js';
import { syncComponentFieldValue, subscribeComponentFields } from './component-preview-panel.js';
import { appendSceneParameterControl } from './scene-extra-parameter-layout.js';
import { mountGiftMotionParameters } from './gift-motion-parameters.js';

export function mountGiftMotionCanvasSettings(host, target) {
  const panels = GIFT_MOTION_EFFECTS.map(effect => {
    const section = previewElement('details', 'desktop-lyric-settings-group scene-parameter-group gift-motion-settings gift-motion-canvas-settings');
    section.open = true;
    const summary = previewElement('summary');
    summary.append(previewElement('strong', '', `${effect.label}设置`));
    section.append(summary);
    const controls = previewElement('fieldset', 'desktop-lyric-group-body');
    const triggers = previewElement('div', 'scene-extra-parameters');
    const triggerInputs = new Map();
    for (const [suffix, title] of [['Enabled', '启用效果'], ['ThresholdRmb', '触发金额（元）']]) {
      const key = `${effect.prefix}${suffix}`;
      const label = previewElement('label');
      label.append(previewElement('span', 'desktop-lyric-control-copy', title));
      const input = previewElement('input');
      input.type = suffix === 'Enabled' ? 'checkbox' : 'number';
      input.setAttribute('aria-label', `${effect.label}${title}`);
      input.dataset.componentParameter = key;
      if (suffix === 'ThresholdRmb') { input.min = '0'; input.step = '0.01'; input.required = true; }
      input.addEventListener('change', () => {
        if (input.checkValidity()) target.edit({ [key]: input.type === 'checkbox' ? String(input.checked) : input.value });
      });
      appendSceneParameterControl(label, input);
      triggers.append(label); triggerInputs.set(key, input);
    }
    const fields = previewElement('div', 'gift-effect-fields');
    const view = mountGiftMotionParameters(fields, effect, { idPrefix: `canvas-${crypto.randomUUID()}-`, onEdit: patch => target.edit(patch) });
    controls.append(triggers, fields, previewElement('p', 'hint', '修改后自动保存，与客户端同款效果同步。'));
    section.append(controls); host.append(section);
    return { effect, section, controls, triggerInputs, view };
  });
  const render = ({ draft, loaded }) => {
    for (const { effect, section, controls, triggerInputs, view } of panels) {
      section.hidden = Boolean(draft.mediaStyle || draft.resourceStyle) || !['follow', effect.style].includes(draft.style || 'follow');
      controls.disabled = !loaded;
      for (const [key, input] of [...triggerInputs, ...view.inputs]) {
        const value = draft[key] ?? GIFT_MOTION_DEFAULTS[key];
        if (input.type === 'checkbox') input.checked = value === 'true';
        else syncComponentFieldValue(input, value);
        if (view.inputs.has(key)) view.sync(key);
      }
    }
  };
  const stop = subscribeComponentFields(host, target, render);
  return { dispose() { stop(); panels.forEach(({ view, section }) => { view.dispose(); section.remove(); }); } };
}
