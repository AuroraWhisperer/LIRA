'use strict';

import { projectTopbarStatus } from './live-status-presentation.js';

let liveStatus = {};
let connectionState = '';
let notify = null;
let disposeCurrent = null;

function render() {
  const button = document.getElementById('liveStatus');
  if (!button) return;
  const status = projectTopbarStatus(liveStatus, connectionState);
  button.className = `pill topbar-live-status ${status.tone}`.trim();
  button.setAttribute('aria-label', `${status.owner ? `${status.owner}，` : ''}${status.label}，查看连接详情`);
  button.title = `${status.label} · 点击查看连接详情`;
  const owner = document.getElementById('liveStatusOwner');
  owner.textContent = status.owner;
  owner.hidden = !status.owner;
  document.getElementById('liveStatusLabel').textContent = status.label;
  document.getElementById('topbarStatusOwner').textContent = liveStatus.ownerName || '未获取';
  document.getElementById('topbarStatusRoom').textContent = liveStatus.roomId || '未配置';
  document.getElementById('topbarStatusLive').textContent = status.detail;
  document.getElementById('topbarStatusLocal').textContent = status.local;
}

export function renderLiveStatus(live) {
  liveStatus = live;
  render();
}

export function renderConnectionStatus(nextState) {
  if (nextState === connectionState || connectionState === 'shutdown') return;
  const previous = connectionState;
  connectionState = nextState;
  render();
  if (nextState === 'disconnected') {
    notify?.({ key: 'local-connection', update: true, type: 'warning', title: '本机连接已断开', message: '正在自动重连，可点击右上角状态查看详情。', duration: 6000 });
  } else if (nextState === 'connected' && previous === 'disconnected') {
    notify?.({ key: 'local-connection', update: true, type: 'success', title: '本机连接已恢复', duration: 2800 });
  }
}

export function initTopbarStatus({ showToast } = {}) {
  if (disposeCurrent) return disposeCurrent;
  notify = showToast;
  const button = document.getElementById('liveStatus');
  const details = document.getElementById('topbarStatusDetails');
  const events = new AbortController();
  const { signal } = events;
  function placeDetails() {
    if (!details.matches(':popover-open')) return;
    const anchor = button.getBoundingClientRect();
    details.style.left = `${Math.max(12, Math.min(anchor.right - details.offsetWidth, window.innerWidth - details.offsetWidth - 12))}px`;
    details.style.top = `${anchor.bottom + 10}px`;
  }
  details.addEventListener('toggle', () => {
    button.setAttribute('aria-expanded', String(details.matches(':popover-open')));
    placeDetails();
  }, { signal });
  window.addEventListener('resize', placeDetails, { signal });
  render();
  disposeCurrent = () => {
    events.abort();
    details.hidePopover();
    notify = null;
    disposeCurrent = null;
  };
  return disposeCurrent;
}
