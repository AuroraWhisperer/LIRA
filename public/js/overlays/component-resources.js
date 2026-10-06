import { COMPONENT_RESOURCE_PRESETS, normalizeResourceStyle } from '../shared/component-resource-style.js';

let activeResources = {};
export function resolveComponentResource(path) { return activeResources[path] || path; }

export function createComponentResources() {
  let key = '';
  let pending;
  let stylesheet;
  let generation = 0;
  return {
    update(config) {
      const resource = config?.resourceStyle;
      const nextKey = JSON.stringify(resource || null);
      if (nextKey === key) return pending;
      key = nextKey;
      const current = ++generation;
      if (!resource) {
        pending = undefined; activeResources = {}; stylesheet?.remove(); stylesheet = null;
        return;
      }
      const preset = COMPONENT_RESOURCE_PRESETS[resource.preset];
      normalizeResourceStyle(preset?.type, resource, config);
      pending = (async () => {
        const sheets = await Promise.all(preset.sheets.map(async path => {
          const response = await fetch(path);
          if (!response.ok) throw new Error('组件样式加载失败');
          let css = await response.text();
          for (const [original, imported] of Object.entries(resource.resources)) css = css.replaceAll(original, imported);
          // Keep an imported font distinct from legacy bundled faces and other package versions.
          if (preset.fontFamily) css = css.replaceAll(preset.fontFamily, `${preset.fontFamily}-${resource.id}`);
          return css;
        }));
        // Check every image before reporting the scene ready. Videos remain lazy/range loaded.
        await Promise.all(Object.values(resource.resources).filter(src => /\.(webp|png|jpg|svg)$/.test(src)).map(src => {
          const image = new Image(); image.src = src; return image.decode();
        }));
        await Promise.all(Object.values(resource.resources).filter(src => src.endsWith('.woff2')).map(src =>
          new window.FontFace('Lira Resource Check', `url('${src}')`).load()));
        await Promise.all(Object.values(resource.resources).filter(src => /\.(mp4|webm)$/.test(src)).map(async src => {
          if (!(await fetch(src, { method: 'HEAD' })).ok) throw new Error('套装视频不可用');
        }));
        if (current !== generation) return;
        activeResources = resource.resources;
        const node = document.createElement('style'); node.dataset.componentResources = resource.id;
        node.textContent = sheets.join('\n');
        stylesheet?.remove(); stylesheet = node; document.head.append(node);
      })();
      return pending;
    },
    dispose() { generation++; activeResources = {}; stylesheet?.remove(); },
  };
}
