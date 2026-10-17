'use strict';

import { initAudioAssistantControls } from './audio-assistant-controls.js';

const STORAGE_KEY = 'admin.audioAssistant:v1';
const FLOAT_SIZE = 52;
const DOCK_WIDTH = 24;
const SNAP_DISTANCE = 16;
let disposeCurrent = null;

function clamp(value, min, max) {
  return Math.min(Math.max(value, min), Math.max(min, max));
}

export function normalizeAudioAssistantPreferences(value) {
  const ratio = (number, fallback) => Number.isFinite(number) ? clamp(number, 0, 1) : fallback;
  return {
    enabled: value?.enabled === true,
    placement: value?.placement === 'side' ? 'side' : 'top',
    x: ratio(value?.x, 0.92),
    y: ratio(value?.y, 0.4),
    dock: ['left', 'right'].includes(value?.dock) ? value.dock : '',
  };
}

export function resolveAudioAssistantPosition(preferences, area) {
  const width = preferences.dock ? DOCK_WIDTH : FLOAT_SIZE;
  const maxX = Math.max(0, area.width - width);
  const maxY = Math.max(area.top, area.bottom - FLOAT_SIZE);
  return {
    x: preferences.dock === 'left' ? 0 : preferences.dock === 'right' ? maxX : preferences.x * maxX,
    y: area.top + preferences.y * (maxY - area.top),
  };
}

export function initAudioAssistant() {
  if (disposeCurrent) return disposeCurrent;
  const top = document.getElementById('audioAssistantTop');
  const floating = document.getElementById('audioAssistantFloat');
  const panel = document.getElementById('audioAssistantPanel');
  const enabled = document.getElementById('audioAssistantEnabled');
  const enabledState = document.getElementById('audioAssistantEnabledState');
  const placements = [...document.querySelectorAll('[data-audio-placement]')];
  const saveError = document.getElementById('audioAssistantSaveError');
  const topbar = document.querySelector('.topbar');
  const player = document.querySelector('.playback-player-panel');
  const events = new AbortController();
  const { signal } = events;
  let preferences;
  try {
    preferences = normalizeAudioAssistantPreferences(JSON.parse(localStorage.getItem(STORAGE_KEY)));
  } catch {
    preferences = normalizeAudioAssistantPreferences(null);
  }
  let drag = null;
  let suppressClick = false;
  const controls = initAudioAssistantControls({ enabled: () => preferences.enabled, signal });

  function area() {
    const topEdge = (topbar?.getBoundingClientRect().bottom || 0) + 12;
    const bottomEdge = Math.min(window.innerHeight, player?.getBoundingClientRect().top ?? window.innerHeight) - 36;
    return { width: window.innerWidth, top: topEdge, bottom: Math.max(topEdge + FLOAT_SIZE, bottomEdge) };
  }

  function save() {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(preferences));
      saveError.hidden = true;
    } catch {
      saveError.textContent = '本次设置已生效，但未能保存在本机。重新打开客户端后请再次设置。';
      saveError.hidden = false;
    }
  }

  function placeFloat(point = resolveAudioAssistantPosition(preferences, area())) {
    floating.style.left = `${point.x}px`;
    floating.style.top = `${point.y}px`;
  }

  function placePanel() {
    if (!panel.matches(':popover-open')) return;
    const bounds = area();
    panel.style.maxHeight = `${bounds.bottom - bounds.top}px`;
    const anchor = (preferences.placement === 'top' ? top : floating).getBoundingClientRect();
    const { width, height } = panel.getBoundingClientRect();
    const x = preferences.placement === 'top' ? anchor.right - width
      : anchor.right + width + 12 <= bounds.width ? anchor.right + 12 : anchor.left - width - 12;
    const y = preferences.placement === 'top' ? anchor.bottom + 10 : anchor.top;
    panel.style.left = `${clamp(x, 12, bounds.width - width - 12)}px`;
    panel.style.top = `${clamp(y, bounds.top, bounds.bottom - height)}px`;
  }

  function render() {
    enabled.checked = preferences.enabled;
    enabledState.textContent = preferences.enabled ? '已开启' : '已关闭';
    for (const button of placements) button.setAttribute('aria-pressed', String(preferences.enabled && button.dataset.audioPlacement === preferences.placement));
    top.hidden = !preferences.enabled || preferences.placement !== 'top';
    floating.hidden = !preferences.enabled || preferences.placement !== 'side';
    floating.dataset.dock = preferences.dock;
    placeFloat();
    placePanel();
  }

  function cancelDrag() {
    if (!drag) return;
    const pointerId = drag.pointerId;
    drag = null;
    floating.classList.remove('is-dragging');
    if (floating.hasPointerCapture(pointerId)) floating.releasePointerCapture(pointerId);
    render();
  }

  function changePreference(nextEnabled, placement = preferences.placement) {
    cancelDrag();
    panel.hidePopover();
    preferences.enabled = nextEnabled;
    preferences.placement = placement;
    controls.setEnabled(preferences.enabled);
    save();
    render();
  }

  function rememberPosition(point) {
    const bounds = area();
    const maxX = Math.max(0, bounds.width - FLOAT_SIZE);
    const maxY = Math.max(0, bounds.bottom - bounds.top - FLOAT_SIZE);
    preferences.x = maxX ? clamp(point.x / maxX, 0, 1) : 0;
    preferences.y = maxY ? clamp((point.y - bounds.top) / maxY, 0, 1) : 0;
    preferences.dock = point.x <= SNAP_DISTANCE ? 'left' : point.x >= maxX - SNAP_DISTANCE ? 'right' : '';
    save();
    render();
  }

  enabled.addEventListener('change', () => changePreference(enabled.checked), { signal });
  for (const button of placements) button.addEventListener('click', () => {
    changePreference(true, button.dataset.audioPlacement);
    panel.showPopover();
  }, { signal });
  panel.addEventListener('beforetoggle', (event) => {
    if (event.newState === 'open') panel.style.visibility = 'hidden';
  }, { signal });
  panel.addEventListener('toggle', () => {
    const open = panel.matches(':popover-open');
    top.setAttribute('aria-expanded', String(open));
    floating.setAttribute('aria-expanded', String(open));
    if (open) placePanel();
    panel.style.removeProperty('visibility');
  }, { signal });

  floating.addEventListener('pointerdown', (event) => {
    if (event.button !== 0 || !event.isPrimary) return;
    const rect = floating.getBoundingClientRect();
    suppressClick = false;
    drag = { pointerId: event.pointerId, startX: event.clientX, startY: event.clientY, x: rect.left, y: rect.top, moved: false };
    floating.setPointerCapture(event.pointerId);
  }, { signal });
  floating.addEventListener('pointermove', (event) => {
    if (!drag || event.pointerId !== drag.pointerId) return;
    const dx = event.clientX - drag.startX;
    const dy = event.clientY - drag.startY;
    if (!drag.moved && Math.hypot(dx, dy) < 6) return;
    drag.moved = true;
    suppressClick = true;
    panel.hidePopover();
    floating.dataset.dock = '';
    floating.classList.add('is-dragging');
    const bounds = area();
    drag.point = { x: clamp(drag.x + dx, 0, bounds.width - FLOAT_SIZE), y: clamp(drag.y + dy, bounds.top, bounds.bottom - FLOAT_SIZE) };
    placeFloat(drag.point);
  }, { signal });
  floating.addEventListener('pointerup', (event) => {
    if (!drag || event.pointerId !== drag.pointerId) return;
    const ended = drag;
    drag = null;
    floating.classList.remove('is-dragging');
    if (ended.moved) rememberPosition(ended.point);
  }, { signal });
  floating.addEventListener('pointercancel', cancelDrag, { signal });
  floating.addEventListener('lostpointercapture', cancelDrag, { signal });
  floating.addEventListener('click', (event) => {
    if (suppressClick && event.detail !== 0) {
      event.preventDefault();
      suppressClick = false;
    }
  }, { signal });
  floating.addEventListener('keydown', (event) => {
    const offset = { ArrowLeft: [-16, 0], ArrowRight: [16, 0], ArrowUp: [0, -16], ArrowDown: [0, 16] }[event.key];
    if (!offset) return;
    event.preventDefault();
    const undocking = preferences.dock === 'left' && event.key === 'ArrowRight'
      || preferences.dock === 'right' && event.key === 'ArrowLeft';
    if (undocking) offset[0] = Math.sign(offset[0]) * FLOAT_SIZE;
    const point = resolveAudioAssistantPosition(preferences, area());
    rememberPosition({ x: point.x + offset[0], y: point.y + offset[1] });
  }, { signal });

  function resize() {
    cancelDrag();
    placeFloat();
    placePanel();
  }
  const observer = new ResizeObserver(resize);
  observer.observe(panel);
  if (topbar) observer.observe(topbar);
  if (player) observer.observe(player);
  window.addEventListener('resize', resize, { signal });
  render();
  disposeCurrent = () => {
    cancelDrag();
    events.abort();
    controls.dispose();
    observer.disconnect();
    panel.hidePopover();
    top.hidden = true;
    floating.hidden = true;
    disposeCurrent = null;
  };
  return disposeCurrent;
}
