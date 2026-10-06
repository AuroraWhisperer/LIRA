import { previewElement } from './component-preview-surface.js';
import { enhanceSelects } from '../shared/select-menu.js';

export function mountPreviewPresets(host, { controller, connection, beforeChange, setBusy, report }) {
  const bar = previewElement('div', 'preview-canvas-presets');
  const label = previewElement('label', '', '场景预设');
  const select = previewElement('select');
  select.setAttribute('aria-label', '场景预设');
  label.append(select);
  const live = previewElement('span', 'preview-canvas-live-preset');
  const buttons = [];
  let disposed = false;
  let busy = false;
  let signature = '';
  bar.append(label);
  function button(text, action) {
    const node = previewElement('button', 'secondary', text);
    node.type = 'button';
    node.addEventListener('click', action);
    buttons.push(node);
    bar.append(node);
  }
  async function run(action, change) {
    if (busy || !beforeChange()) return;
    busy = true;
    setBusy(true);
    try {
      await controller.flush();
      if (action === 'save') {
        await controller.save();
        await controller.flush();
        while (controller.getState().saving) {
          await new Promise(resolve => window.setTimeout(resolve, 100));
          if (disposed || !controller.getState().loaded) return;
        }
        const state = controller.getState();
        if (state.error || state.dirty) throw new Error(state.error || '仍有未保存修改，请重试。');
        report('预设已保存，直播画面保持当前场景');
      } else await connection.execute('preset', change);
    } catch (error) {
      if (!disposed) report(error.message);
    } finally {
      busy = false;
      if (!disposed) { setBusy(false); render(); }
    }
  }
  function create(duplicate) {
    const state = controller.getState();
    const title = duplicate ? `${state.draft.document.title.slice(0, 75)} 副本` : `场景 ${state.presets.length + 1}`;
    void run('preset', { action: 'create', title, duplicate });
  }
  select.addEventListener('change', () => { void run('preset', { action: 'select', id: select.value }); });
  button('新建', () => create(false));
  button('复制', () => create(true));
  button('保存预设', () => { void run('save'); });
  bar.append(live);
  host.prepend(bar);
  function render(disabled = false) {
    const state = controller.getState();
    const next = JSON.stringify(state.presets);
    if (signature !== next) {
      signature = next;
      select.replaceChildren(...state.presets.map(preset => {
        const option = previewElement('option', '', `${preset.title}${preset.dirty ? ' · 未保存' : ''}`);
        option.value = preset.id;
        return option;
      }));
    }
    select.value = state.draft.document.id;
    const active = state.presets.find(preset => preset.id === state.activeSceneId);
    live.textContent = active ? `当前直播：${state.activeSceneTitle || active.title}` : '尚未应用到直播';
    select.disabled = disabled || busy || state.saving || !state.loaded;
    for (const node of buttons) node.disabled = select.disabled;
    enhanceSelects();
  }
  render();
  return { render, dispose() { disposed = true; bar.remove(); } };
}
