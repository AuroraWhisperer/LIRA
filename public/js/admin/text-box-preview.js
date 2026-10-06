import { createTextBoxDefaults, TEXT_BOX_SIZE } from '../shared/text-box-config.js';
import { previewElement } from './component-preview-surface.js';
import { mountTextBoxEditor } from './text-box-editor.js';
import { mountTextBoxMedia } from './text-box-media.js';

export function createTextBoxPreview({ media } = {}) {
  const getState = () => ({ draft: createTextBoxDefaults(), saved: createTextBoxDefaults(), loaded: true, dirty: false });
  const controller = { getState, subscribe(listener) { listener(getState()); return () => {}; } };
  return { id: 'text-box', title: '文本框', sceneOnly: true, controller,
    url: new URL('/text-box?preview=1&componentPreview=1', location.href).href,
    size: () => TEXT_BOX_SIZE,
    createPanel(host, target = controller) {
      const content = previewElement('div', 'text-box-panel');
      const label = previewElement('h4', 'text-box-section-title', '内容');
      const editorHost = previewElement('div');
      const error = previewElement('p', 'text-box-error');
      error.setAttribute('role', 'alert'); error.hidden = true;
      const report = failure => { error.textContent = failure.message; error.hidden = false; };
      const composer = mountTextBoxEditor(editorHost, {
        getConfig: () => target.getState().draft,
        onChange(config) { target.edit(config); error.hidden = true; }, onError: report,
      });
      const materials = previewElement('section', 'text-box-materials');
      const assets = mountTextBoxMedia(materials, { composer, request: media, onError: report });
      const layout = previewElement('div', 'text-box-layout-fields');
      const fields = new Map();
      for (const [key, title, options] of [
        ['align', '文字对齐', [['left', '左对齐'], ['center', '居中'], ['right', '右对齐']]],
        ['lineHeight', '行距', [[1, '紧凑'], [1.2, '稍紧'], [1.4, '标准'], [1.6, '宽松'], [2, '双倍']]],
      ]) {
        const label = previewElement('label', '', title);
        const input = previewElement('select');
        input.setAttribute('aria-label', title);
        for (const [value, text] of options) { const option = previewElement('option', '', text); option.value = value; input.append(option); }
        input.addEventListener('change', () => target.edit({ [key]: key === 'lineHeight' ? Number(input.value) : input.value }));
        label.append(input); layout.append(label); fields.set(key, input);
      }
      content.append(label, editorHost, materials, layout, error);
      host.append(content);
      const stop = target.subscribe(({ draft, loaded }) => {
        const disabled = !loaded || host.closest('fieldset:disabled') !== null;
        composer.setConfig(draft, disabled);
        assets.setDisabled(disabled);
        for (const [key, input] of fields) { input.value = String(draft[key]); input.disabled = disabled; }
      });
      return { dispose() { stop(); composer.dispose(); assets.dispose(); content.remove(); } };
    },
  };
}
