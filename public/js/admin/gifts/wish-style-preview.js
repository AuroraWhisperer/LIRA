import { mountComponentPreview, previewElement } from '../component-preview-surface.js';
import { mountBrowserSourcePreview } from '../browser-source-preview.js';
import { componentStyleMedia } from '../../shared/component-resource-style.js';
import { componentCssRendererUrl } from '../../shared/component-css-style.js';
import { createSceneExtraDefaults } from '../../shared/scene-extra-components.js';
import { SCENE_COMPONENTS } from '../../shared/scene-components.js';
import { addStyleToCanvas } from '../component-style-client.js';

export function createWishStylePreview(host) {
  let selected;
  let preview;
  let emit;
  let data;
  let config;
  const listeners = new Set();
  const getState = () => ({ draft: config, loaded: true });
  function clear() {
    preview?.dispose();
    preview = null;
    selected = null;
    emit = null;
    listeners.clear();
    host.classList.remove('has-imported-style');
    host.replaceChildren();
  }
  return {
    update(style, wish) {
      data = { preview: true, items: [wish] };
      config = style.type === 'browser' ? style.config
        : { ...createSceneExtraDefaults('gift-wishes'), ...style.config, period: 'all', limit: 1, showCompleted: true };
      if (selected?.id === style.id) {
        selected = style;
        for (const listener of listeners) listener(getState());
        emit?.(data);
        return;
      }
      clear();
      selected = style;
      host.classList.add('has-imported-style');
      const surface = previewElement('div', 'gift-wish-style-preview');
      const actions = previewElement('div', 'gift-wish-style-actions');
      const use = previewElement('button', 'secondary', '在画布中使用');
      use.type = 'button';
      const status = previewElement('span', 'hint', '此样式通过画布保存应用。');
      status.setAttribute('role', 'status');
      use.addEventListener('click', async () => {
        use.disabled = true;
        try { await addStyleToCanvas(selected); }
        catch (error) { status.textContent = error.message; }
        finally { use.disabled = false; }
      });
      actions.append(status, use);
      host.append(surface, actions);
      const media = componentStyleMedia(style.config);
      const controller = { getState, subscribe(listener) { listeners.add(listener); listener(getState()); return () => listeners.delete(listener); } };
      let height = media.height;
      const size = () => [media.width, height];
      preview = style.type === 'browser'
        ? mountBrowserSourcePreview(surface, { controller, size: () => [surface.clientWidth, surface.clientHeight] })
        : mountComponentPreview(surface, { title: style.name, controller, size,
          url: new URL(componentCssRendererUrl(config, SCENE_COMPONENTS['gift-wishes'].rendererUrl), location.href).href,
          startData({ emit: receive }) { emit = receive; emit(data); return () => { emit = null; }; },
          onResize(value) {
            if (config.mediaStyle || value.width !== media.width) return;
            height = value.height;
            preview?.fit();
          },
        });
    },
    clear,
    dispose: clear,
  };
}
