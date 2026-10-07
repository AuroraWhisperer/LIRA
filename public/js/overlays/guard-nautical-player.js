import { NAUTICAL_GUARD_ART, NAUTICAL_GUARD_AVATAR } from '../shared/component-resource-style.js';
import { resolveComponentResource } from './component-resources.js';
import { sceneAvatarSource } from './scene-extra-client.js';

// The artwork carries the flags and waves; purchaser identity stays live DOM text.
export function createNauticalGuardPlayer({ root }) {
  const loading = new AbortController();
  let prepared;
  let blobs;
  let finish;
  let disposed = false;
  const stage = document.createElement('div');
  stage.className = 'ng-stage'; stage.hidden = true;
  root.append(stage);
  function fit() {
    const scale = Math.min(root.clientWidth / 1920, root.clientHeight / 1080);
    stage.style.transform = `translate(${(root.clientWidth - 1920 * scale) / 2}px, ${(root.clientHeight - 1080 * scale) / 2}px) scale(${scale})`;
  }
  const observer = new ResizeObserver(fit); observer.observe(root); fit();
  function ready() {
    if (!prepared) prepared = Promise.all(Object.entries(NAUTICAL_GUARD_ART).map(async ([tier, source]) => {
      const response = await fetch(resolveComponentResource(source), { signal: loading.signal });
      if (!response.ok) throw new Error('航海旗帜素材加载失败');
      return [tier, await response.blob()];
    })).then(entries => { if (!disposed) blobs = Object.fromEntries(entries); });
    return prepared;
  }
  return {
    ready,
    durationMs: 5000,
    play(payload) {
      if (disposed || !Object.hasOwn(NAUTICAL_GUARD_ART, payload.tier)) return Promise.resolve();
      finish?.();
      return new Promise(resolve => {
        let timer; let source; let completed = false;
        const complete = () => {
          if (completed) return;
          completed = true; clearTimeout(timer);
          stage.hidden = true; stage.replaceChildren();
          if (source) URL.revokeObjectURL(source);
          finish = null; resolve();
        };
        finish = complete;
        void ready().then(async () => {
          if (disposed || completed) return;
          // A new URL gives every purchase its own animation clock, including the same tier twice.
          source = URL.createObjectURL(blobs[payload.tier]);
          const art = document.createElement('img');
          art.className = 'ng-art'; art.alt = ''; art.src = source;
          await art.decode();
          if (disposed || completed) return;
          const avatar = document.createElement('img');
          avatar.className = 'ng-avatar'; avatar.alt = ''; avatar.referrerPolicy = 'no-referrer';
          const fallback = resolveComponentResource(NAUTICAL_GUARD_AVATAR);
          avatar.onerror = () => { avatar.onerror = null; avatar.src = fallback; };
          avatar.src = sceneAvatarSource(payload.avatarUrl) || fallback;
          const name = document.createElement('div');
          name.className = 'ng-name'; name.textContent = payload.userName;
          stage.dataset.tier = payload.tier;
          stage.replaceChildren(art, avatar, name); stage.hidden = false;
          timer = setTimeout(complete, 5000);
        }).catch(complete);
      });
    },
    stop() { finish?.(); },
    dispose() {
      disposed = true; finish?.(); loading.abort(); observer.disconnect(); blobs = null; stage.remove();
    },
  };
}
