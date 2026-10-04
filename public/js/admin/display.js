// 编写人：Aurora
// 展示板配置
'use strict';

import { stateService } from './state.js';
import {
  localOverlayOrigin,
  copyText,
  toast,
} from '../shared/utils.js';
import { createComponentConfigController } from './component-config-controller.js';
import { registerComponentSettings } from './component-settings-sync.js';
import { saveComponentSettings, confirmComponentSettings } from './component-settings-save.js';
import { bindSongBoardSettings, collectSongBoardSettings, songBoardConfigFromSettings, songBoardSettingsPayload } from './song-board-settings.js';
import { updateBlindboxOverlayUrl } from './settings.js';
import { publishDisplay } from './legacy-admin-bridge.js';
import { observeServerOverlayUrl } from './server-overlay-url.js';
import { initCanvasOverlaySource } from './canvas-overlay-source.js';

export const display = (() => {
  let controller;

  function initDisplayForm() {
    if (controller) return controller;
    const form = document.getElementById('displayForm');
    controller = createComponentConfigController({
      initial: songBoardConfigFromSettings(stateService.getAppState()?.settings || {}),
      confirm: async () => songBoardConfigFromSettings(await confirmComponentSettings()),
      persist: async (draft, changed) => songBoardConfigFromSettings(
        await saveComponentSettings(songBoardSettingsPayload(draft, changed)),
      ),
    });
    const view = bindSongBoardSettings(form, controller);
    const unregister = registerComponentSettings('song-board', controller, songBoardConfigFromSettings, songBoardSettingsPayload);
    window.addEventListener('pagehide', () => { view.dispose(); unregister(); }, { once: true });

    document.querySelectorAll('[data-copy-url]').forEach((button) => {
      button.addEventListener('click', async () => {
        const url = document.getElementById(button.dataset.copyUrl).textContent;
        if (button.disabled || !url) return;
        try {
          await copyText(url);
          toast('地址已复制');
        } catch (error) {
          toast(error?.message || '复制失败，请手动复制地址');
          prompt('复制以下地址：', url);
        }
      });
    });
    document.querySelectorAll('[data-open-url]').forEach((button) => {
      button.addEventListener('click', () => {
        const url = document.getElementById(button.dataset.openUrl).textContent;
        if (!button.disabled && url) window.open(url, '_blank', 'noopener,noreferrer');
      });
    });
    return controller;
  }

  function initOverlayUrls() {
    const origin = localOverlayOrigin(location);
    initCanvasOverlaySource();
    document.getElementById('localDanmakuUrl').textContent = `${origin}/danmaku?source=component`;
    document.getElementById('queueUrl').textContent = `${origin}/queue`;
    document.getElementById('songsUrl').textContent = `${origin}/songlist`;
    document.getElementById('lyricsUrl').textContent = `${origin}/lyrics`;
    observeServerOverlayUrl((url) => {
      document.getElementById('liveDanmakuUrl').textContent = url || '连接已授权账号后显示服务器地址';
      document.querySelector('[data-copy-url="liveDanmakuUrl"]').disabled = !url;
    });
    document.getElementById('liveBlindboxUrl').textContent = `${origin}/blindbox`;
    document.getElementById('liveGamesUrl').textContent = `${origin}/games`;
    document.getElementById('liveWheelUrl').textContent = `${origin}/wheel`;
    document.getElementById('liveInteractionsUrl').textContent = `${origin}/interactions`;
    document.getElementById('liveGiftFeedUrl').textContent = `${origin}/gift-feed`;
    document.getElementById('liveGiftWishUrl').textContent = `${origin}/gift-wishes`;
    document.getElementById('liveOvertimeUrl').textContent = `${origin}/overtime`;
    document.getElementById('liveGiftEffectsUrl').textContent = `${origin}/gift-effects`;
    document.getElementById('liveOpeningUrl').textContent = `${origin}/opening`;
    document.getElementById('liveClockUrl').textContent = `${origin}/clock`;
    updateBlindboxOverlayUrl();
    initSongPageUrl();
  }

  function initSongPageUrl() {
    const bridge = window.liraLicense;
    let profileChanged = false;
    const render = (snapshot) => {
      let url = '';
      if (snapshot?.state === 'authorized') {
        try {
          const page = new URL(snapshot.streamer?.songPageUrl);
          if (page.protocol === 'https:' && !page.username && !page.password) url = page.href;
        } catch {
          url = '';
        }
      }
      document.getElementById('webSongPageUrl').textContent = url || '连接已授权账号后显示网页歌单地址';
      document.querySelector('[data-copy-url="webSongPageUrl"]').disabled = !url;
      document.querySelector('[data-open-url="webSongPageUrl"]').disabled = !url;
    };
    render(null);
    const dispose = bridge?.onStateChanged?.((snapshot) => {
      profileChanged = true;
      render(snapshot);
    });
    Promise.resolve(bridge?.getProfile?.())
      .then((snapshot) => {
        if (!profileChanged) render(snapshot);
      })
      .catch(() => {
        if (!profileChanged) render(null);
      });
    window.addEventListener(
      'pagehide',
      () => {
        profileChanged = true;
        dispose?.();
      },
      { once: true },
    );
  }

  function collectDisplay() {
    return collectSongBoardSettings(document.getElementById('displayForm'));
  }

  return {
    initDisplayForm,
    initOverlayUrls,
    collectDisplay,
  };
})();
publishDisplay(display);
