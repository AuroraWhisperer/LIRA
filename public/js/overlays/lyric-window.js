'use strict';

import { desktopLyricRenderer } from '../lyrics/desktop-lyric-renderer.js?v=20260913-01';
import { mountSceneExtraClient } from './scene-extra-client.js';
import { COMPONENT_RESOURCE_PRESETS } from '../shared/component-resource-style.js';
import { createOverlaySocket } from './socket-client.js';

let socketController = null;
let componentTimeline = '';

document.addEventListener('DOMContentLoaded', () => {
  desktopLyricRenderer.init();
  if (mountSceneExtraClient('lyrics', {
    onConfig(config) {
      const resource = config.resourceStyle;
      const fontFamily = COMPONENT_RESOURCE_PRESETS[resource?.preset]?.fontFamily;
      desktopLyricRenderer.applySettings(fontFamily && config.desktopLyricFontFamily === fontFamily
        ? { ...config, desktopLyricFontFamily: `${fontFamily}-${resource.id}` } : config);
    },
    onData(data) {
      const timeline = data?.lyricTimeline || { lines: [] };
      const signature = JSON.stringify(timeline);
      if (signature !== componentTimeline) {
        componentTimeline = signature;
        desktopLyricRenderer.updateLyricTimeline(timeline);
      }
      desktopLyricRenderer.updateLyricState(data?.lyricState || { playing: false, lineText: '', words: [], currentMs: 0, status: 'idle' });
    },
  })) return;
  connectSocket();
  window.addEventListener('pagehide', disposeSocket, { once: true });
});

function connectSocket() {
  if (socketController) return;
  socketController = createOverlaySocket({
    // 该页面历史上不带凭据连接，保持 URL 不变。
    token: '',
    reconnectBaseDelayMs: 1000,
    reconnectMaxDelayMs: 15000,
    reconnectExponentMax: 4,
    closeOnError: true,
    onOpen: () => document.body.classList.remove('is-disconnected'),
    onClose: () => document.body.classList.add('is-disconnected'),
    onParseError: (error) => console.warn('[lyrics] invalid WebSocket message:', error),
    onMessage: (payload) => {
      if (payload.type === 'lyric-state') {
        desktopLyricRenderer.updateLyricState(payload.state);
      } else if (payload.type === 'lyric-timeline') {
        desktopLyricRenderer.updateLyricTimeline(payload.timeline);
      } else if (payload.type === 'snapshot') {
        desktopLyricRenderer.applySettings(payload.state?.settings);
        desktopLyricRenderer.updateLyricTimeline(payload.state?.lyricTimeline);
        desktopLyricRenderer.updateLyricState(payload.state?.lyricState);
      }
    },
  });
  socketController.start();
}

function disposeSocket() {
  socketController?.dispose();
  socketController = null;
}
