'use strict';

import { desktopLyricRenderer } from '../lyrics/desktop-lyric-renderer.js?v=20260913-01';

let reconnectTimer = 0;
let reconnectAttempts = 0;

document.addEventListener('DOMContentLoaded', () => {
  desktopLyricRenderer.init();
  void loadSettings();
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

async function loadSettings() {
  try {
    const response = await fetch('/api/settings');
    if (!response.ok) return;
    const payload = await response.json();
    if (payload.ok && payload.data)
      desktopLyricRenderer.applySettings(payload.data);
  } catch (error) {
    console.warn('[lyrics] settings unavailable:', error);
  }
}
