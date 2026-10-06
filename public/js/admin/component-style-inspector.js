import { previewElement } from './component-preview-surface.js';
import { openComponentStyleLibrary } from './component-style-library.js';
import { mountMediaStyleFields } from './component-style-editor.js';
import { MEDIA_STYLE_TYPES } from '../shared/component-media-style.js';
import { loadComponentStyleCss } from './component-style-api.js';

export function mountComponentStyleInspector(host, { item, model, component, request, report }) {
  if (!MEDIA_STYLE_TYPES.includes(item.type)) return { dispose() {} };
  loadComponentStyleCss();
  const change = previewElement('button', 'secondary', '更换样式 / 添加素材'); change.type = 'button'; change.disabled = item.locked;
  let library;
  let mediaFields;
  host.append(change);
  change.addEventListener('click', () => {
    library = openComponentStyleLibrary({ type: item.type, request, actionLabel: `更换「${item.name}」的样式`,
      onUse(style) {
        model.edit(document => {
          const current = document.items.find(entry => entry.id === item.id);
          if (!current || current.locked) throw new Error('组件已删除或锁定，请重新选择。');
          const previous = current.appearance.mode === 'independent' ? current.appearance.config
            : component.projectConfig?.(component.controller.getState().draft) || component.controller.getState().draft;
          const next = { ...previous };
          delete next.mediaStyle; delete next.resourceStyle;
          const key = style.config.resourceStyle ? 'resourceStyle' : 'mediaStyle';
          next[key] = structuredClone(style.config[key]);
          for (const key of ['style', 'displayStyle', 'styleOptions']) if (Object.hasOwn(style.config, key)) next[key] = structuredClone(style.config[key]);
          current.appearance = { mode: 'independent', config: next };
        });
      },
    });
  });
  if (item.appearance.config?.mediaStyle) {
    const builtin = previewElement('button', 'secondary', '改用内置样式'); builtin.type = 'button'; builtin.disabled = item.locked;
    builtin.addEventListener('click', () => {
      try { model.edit(document => {
        const current = document.items.find(entry => entry.id === item.id);
        if (current && !current.locked) delete current.appearance.config.mediaStyle;
      }); } catch (error) { report(error.message); }
    });
    host.append(builtin);
    const fields = previewElement('fieldset', 'component-style-fields'); fields.disabled = item.locked;
    mediaFields = mountMediaStyleFields(fields, item.appearance.config.mediaStyle, mediaStyle => {
      try {
        model.edit(document => {
          const current = document.items.find(entry => entry.id === item.id);
          if (current && !current.locked && current.appearance.mode === 'independent') current.appearance.config.mediaStyle = mediaStyle;
        });
      } catch (error) { report(error.message); }
    }, item.type);
    host.append(fields);
  }
  return {
    update(current, force) { if (current.appearance.config?.mediaStyle) mediaFields?.update(current.appearance.config.mediaStyle, force); },
    dispose() { library?.dispose(); },
  };
}
