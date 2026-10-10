import { WINDOWLIGHT_ART } from '../shared/component-resource-style.js';
import { resolveComponentResource } from './component-resources.js';
import { createWindowlightEffects } from './background-windowlight-effects.js';

const SCENES = ['sunny', 'sunset', 'rainy', 'night'];

export function createWindowlightBackground(root) {
  const document = root.ownerDocument;
  const images = new Map();
  let effects;
  let reduced = false;
  let sourceKey = '';
  let loading;
  let generation = 0;
  let prepared = false;
  let disposed = false;
  let enabled = false;
  let visible = true;
  let mode = 'manual';
  let selectedScene = 'sunny';
  let activeScene = selectedScene;
  let intervalMs = 300000;
  let remainingMs = intervalMs;
  let startedAt = 0;
  let timer = null;

  function showScene() {
    const previous = root.dataset.scene;
    root.dataset.scene = activeScene;
    effects?.update(activeScene, enabled && visible && !reduced);
    for (const scene of SCENES) {
      const plate = images.get(scene);
      plate?.classList.toggle('is-active', scene === activeScene);
      if (previous !== activeScene) plate?.classList.toggle('is-previous', scene === previous);
    }
  }

  function pauseTimer() {
    if (timer === null) return;
    clearTimeout(timer);
    timer = null;
    remainingMs = Math.max(0, remainingMs - (performance.now() - startedAt));
  }

  function schedule() {
    if (timer !== null || !enabled || !visible || !prepared || mode !== 'auto' || disposed) return;
    startedAt = performance.now();
    timer = setTimeout(() => {
      timer = null;
      activeScene = SCENES[(SCENES.indexOf(activeScene) + 1) % SCENES.length];
      showScene();
      remainingMs = intervalMs;
      schedule();
    }, remainingMs);
  }

  function mount() {
    for (const name of Object.keys(WINDOWLIGHT_ART)) {
      const image = document.createElement('img');
      image.alt = '';
      image.draggable = false;
      image.width = 1920;
      image.height = 1080;
      image.className = SCENES.includes(name) ? 'windowlight-plate' : 'windowlight-light';
      images.set(name, image);
      if (name === 'window-mask') continue;
      if (SCENES.includes(name)) root.append(image);
      else {
        const layer = document.createElement('div');
        layer.className = `windowlight-effect windowlight-${name}`;
        layer.append(image);
        root.append(layer);
      }
    }
    showScene();
  }

  return {
    update(config, { visible: nextVisible = true, reducedMotion = false } = {}) {
      if (disposed) return;
      enabled = config?.style === 'windowlight' && !config.mediaStyle;
      visible = nextVisible;
      reduced = reducedMotion;
      effects?.update(activeScene, enabled && visible && !reduced);
      root.dataset.motion = enabled && visible && !reducedMotion ? 'running' : 'paused';
      root.dataset.reducedMotion = String(reducedMotion);
      if (!enabled) {
        pauseTimer();
        root.hidden = true;
        return;
      }
      if (!images.size) mount();
      const nextScene = SCENES.includes(config.windowScene) ? config.windowScene : 'sunny';
      const nextMode = config.sceneMode === 'auto' ? 'auto' : 'manual';
      const nextInterval = Number.isInteger(config.sceneIntervalSeconds)
        ? Math.min(3600, Math.max(10, config.sceneIntervalSeconds)) * 1000 : 300000;
      if (selectedScene !== nextScene || mode !== nextMode || intervalMs !== nextInterval) {
        pauseTimer();
        if (selectedScene !== nextScene || mode !== nextMode) activeScene = nextScene;
        selectedScene = nextScene;
        mode = nextMode;
        intervalMs = nextInterval;
        remainingMs = intervalMs;
        showScene();
      }
      root.style.setProperty('--windowlight-mask-size', config.fit === 'fill' ? '100% 100%' : config.fit || 'cover');
      const sources = Object.fromEntries(Object.entries(WINDOWLIGHT_ART).map(([name, path]) => [name, resolveComponentResource(path)]));
      const key = JSON.stringify(sources);
      if (sourceKey !== key) {
        pauseTimer();
        prepared = false;
        effects?.dispose();
        effects = null;
        sourceKey = key;
        const current = ++generation;
        loading = Promise.all([...images].map(([name, image]) => {
          image.src = sources[name];
          return image.decode();
        })).then(() => {
          if (disposed || current !== generation) return;
          effects = createWindowlightEffects(root, images);
          effects.update(activeScene, enabled && visible && !reduced);
          prepared = true;
          root.hidden = !enabled;
          schedule();
        }, error => {
          if (!disposed && current === generation) sourceKey = '';
          throw error;
        });
      }
      root.hidden = !prepared;
      if (!visible) pauseTimer();
      else schedule();
      return loading;
    },
    dispose() {
      if (disposed) return;
      disposed = true;
      generation++;
      pauseTimer();
      effects?.dispose();
      root.replaceChildren();
      root.hidden = true;
      images.clear();
    },
  };
}
