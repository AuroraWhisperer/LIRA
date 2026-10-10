import { createComponentConfigController } from './component-config-controller.js';
import { COMPONENT_PREVIEW_DEFINITIONS } from './component-preview-definitions.js';
import { previewElement } from './component-preview-surface.js';
import { requestComponentStyles } from './component-style-api.js';
import { COMPONENT_RESOURCE_PRESETS } from '../shared/component-resource-style.js';

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
  return {
    controller,
    mount(host) {
      const panel = COMPONENT_PREVIEW_DEFINITIONS[style.type].createPreview({ embedded: true }).createPanel(host, controller);
      const save = previewElement('button', 'secondary', '保存此样式'); save.type = 'button';
      const status = previewElement('p', 'hint'); status.setAttribute('role', 'status');
      save.addEventListener('click', () => { void controller.save(); });
      host.append(save, status);
      const stop = controller.subscribe(state => {
        save.disabled = !state.dirty || state.saving;
        status.textContent = state.error || (state.saving ? '正在保存…' : state.dirty ? '有未保存的修改' : '已保存，与画布中的同样式组件同步。');
      });
      const timer = setInterval(() => {
        if (!document.hidden && host.checkVisibility({ checkVisibilityCSS: true })) void controller.reload();
      }, 1000);
      return { dispose() { clearInterval(timer); stop(); panel?.dispose(); host.replaceChildren(); } };
    },
    async savedStyle() {
      if (controller.getState().dirty && !await controller.save()) throw new Error(controller.getState().error || '样式保存失败，请重试。');
      return { ...style, config: controller.getState().saved };
    },
  };
}
