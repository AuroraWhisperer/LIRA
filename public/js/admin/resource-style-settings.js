import { createComponentConfigController } from './component-config-controller.js';
import { COMPONENT_PREVIEW_DEFINITIONS } from './component-preview-definitions.js';
import { previewElement } from './component-preview-elements.js';
import { requestComponentStyles } from './component-style-api.js';
import { COMPONENT_RESOURCE_PRESETS } from '../shared/component-resource-style.js';
import { bindComponentAutosave } from './settings-autosave.js';
import { observePanelVisibility } from './panel-visibility.js';

// The package provides values; the installed native renderer owns its controls.
export function createResourceStyleSettings(style, { request = requestComponentStyles, signal } = {}) {
  const preset = COMPONENT_RESOURCE_PRESETS[style.config.resourceStyle.preset];
  const read = async () => {
    const packs = await request('list', { signal });
    const current = packs.flatMap(pack => pack.styles).find(entry => entry.id === style.id);
    if (!current) throw new Error('样式已移除，请重新选择。');
    return current.config;
  };
  const controller = createComponentConfigController({
    initial: { ...preset.config, ...style.config },
    read,
    persist: async (_draft, patch) => (await request('config', { id: style.id, patch, signal })).config,
    confirm: read,
  });
  controller.receive({ ...preset.config, ...style.config });
  function observeReturn(root) {
    let wasHidden = false;
    let generation = 0;
    const stop = observePanelVisibility(root, visible => {
      const current = ++generation;
      if (visible && wasHidden) {
        void read().then(config => {
          if (current === generation) controller.receive(config);
        }, () => { /* Leave the draft and its save status intact until the next check. */ });
      }
      wasHidden = !visible;
    });
    return () => { generation++; stop(); };
  }
  return {
    controller, observeReturn,
    mount(host) {
      const root = previewElement('div');
      host.append(root);
      const panel = COMPONENT_PREVIEW_DEFINITIONS[style.type].createPreview({ embedded: true }).createPanel(root, controller);
      const save = previewElement('button', 'secondary', '保存此样式'); save.type = 'button';
      const status = previewElement('p', 'hint'); status.setAttribute('role', 'status');
      save.addEventListener('click', () => { void controller.save(); });
      root.append(save, status);
      const stop = controller.subscribe(state => {
        save.disabled = !state.dirty || state.saving;
        status.textContent = state.error || (state.saving ? '正在保存…' : state.dirty ? '有未保存的修改' : '已保存，与画布中的同样式组件同步。');
      });
      const autosave = bindComponentAutosave(controller, { root, saveButton: save, status });
      const stopReturn = observeReturn(root);
      return { dispose() {
        stopReturn();
        root.remove();
        void autosave.flush().finally(() => { autosave.dispose(); stop(); panel?.dispose(); });
      } };
    },
    async savedStyle() {
      if (controller.getState().dirty && !await controller.save()) throw new Error(controller.getState().error || '样式保存失败，请重试。');
      return { ...style, config: controller.getState().saved };
    },
  };
}
