'use strict';

import { desktopLyricRenderer } from '../lyrics/desktop-lyric-renderer.js?v=20260913-01';
import { mountSceneExtraClient } from './scene-extra-client.js';
import { COMPONENT_RESOURCE_PRESETS } from '../shared/component-resource-style.js';

let reconnectTimer = 0;
let reconnectAttempts = 0;
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
});

function connectSocket() {
  const protocol = location.protocol === 'https:' ? 'wss:' : 'ws:';
  const socket = new WebSocket(`${protocol}//${location.host}/ws`);
  socket.addEventListener('open', () => {
    clearTimeout(reconnectTimer);
    reconnectAttempts = 0;
    document.body.classList.remove('is-disconnected');
  });
  socket.addEventListener('message', (event) => {
    try {
      const payload = JSON.parse(event.data);
      if (payload.type === 'lyric-state') {
        desktopLyricRenderer.updateLyricState(payload.state);
      } else if (payload.type === 'lyric-timeline') {
        desktopLyricRenderer.updateLyricTimeline(payload.timeline);
      } else if (payload.type === 'snapshot') {
        desktopLyricRenderer.applySettings(payload.state?.settings);
        desktopLyricRenderer.updateLyricTimeline(payload.state?.lyricTimeline);
        desktopLyricRenderer.updateLyricState(payload.state?.lyricState);
      }
    } catch (error) {
      console.warn('[lyrics] invalid WebSocket message:', error);
    }
  });
  socket.addEventListener('close', scheduleReconnect);
  socket.addEventListener('error', () => socket.close());
}

function scheduleReconnect() {
  document.body.classList.add('is-disconnected');
  reconnectAttempts += 1;
  const delay = Math.min(1000 * 2 ** Math.min(reconnectAttempts - 1, 4), 15000);
  clearTimeout(reconnectTimer);
  reconnectTimer = setTimeout(connectSocket, delay);
}
