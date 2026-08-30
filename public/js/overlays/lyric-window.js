'use strict';

import '../admin/desktop-lyric-preview.js?v=20260822-01';

let reconnectTimer = 0;
let reconnectAttempts = 0;

document.addEventListener('DOMContentLoaded', () => {
  const desktopLyricPreview = window.AdminApp.desktopLyricPreview;
  desktopLyricPreview.init(null);
  void loadSettings(desktopLyricPreview);
  connectSocket(desktopLyricPreview);
});

function connectSocket(desktopLyricPreview) {
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
        desktopLyricPreview.updateLyricState(payload.state);
      } else if (payload.type === 'lyric-timeline') {
        desktopLyricPreview.updateLyricTimeline(payload.timeline);
      } else if (payload.type === 'snapshot') {
        desktopLyricPreview.applySettings(payload.state?.settings);
        desktopLyricPreview.updateLyricTimeline(payload.state?.lyricTimeline);
        desktopLyricPreview.updateLyricState(payload.state?.lyricState);
      }
    } catch (error) {
      console.warn('[lyrics] invalid WebSocket message:', error);
    }
  });
  socket.addEventListener('close', () =>
    scheduleReconnect(desktopLyricPreview),
  );
  socket.addEventListener('error', () => socket.close());
}

function scheduleReconnect(desktopLyricPreview) {
  document.body.classList.add('is-disconnected');
  reconnectAttempts += 1;
  const delay = Math.min(1000 * 2 ** Math.min(reconnectAttempts - 1, 4), 15000);
  clearTimeout(reconnectTimer);
  reconnectTimer = setTimeout(() => connectSocket(desktopLyricPreview), delay);
}

async function loadSettings(desktopLyricPreview) {
  try {
    const response = await fetch('/api/settings');
    if (!response.ok) return;
    const payload = await response.json();
    if (payload.ok && payload.data)
      desktopLyricPreview.applySettings(payload.data);
  } catch (error) {
    console.warn('[lyrics] settings unavailable:', error);
  }
}
