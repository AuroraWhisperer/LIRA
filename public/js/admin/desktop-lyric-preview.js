// 桌面歌词管理页预览适配器。
'use strict';

import { desktopLyricRenderer } from '../lyrics/desktop-lyric-renderer.js';
import { DESKTOP_LYRIC_DEFAULTS } from '../lyrics/desktop-lyric-defaults.js';
import { copyText, localOverlayOrigin, toast } from '../shared/utils.js';
import { stateService } from './state.js';
import { readDesktopLyricFormSettings, setDesktopLyricBackground, syncDesktopLyricKaraokeColorControls } from './desktop-lyric-controls.js';

let initialized = false;
let previewLayer = 'basic';
let readSettings = () => readDesktopLyricFormSettings(DESKTOP_LYRIC_DEFAULTS);

function init(form, options = {}) {
  if (initialized) return;
  if (!desktopLyricRenderer.init()) return;
  initialized = true;
  if (options.readSettings) readSettings = options.readSettings;

  form?.addEventListener('input', applyStylesFromForm);
  form?.addEventListener('change', applyStylesFromForm);
  document.querySelectorAll('[data-lyric-preview-background]').forEach((button) => {
    button.addEventListener('click', () => setDesktopLyricBackground(button.dataset.lyricPreviewBackground));
  });
  document.getElementById('desktopLyricCopyUrlBtn')?.addEventListener('click', copyDesktopLyricUrl);
  setPreviewLayer(previewLayer);
  const appState = stateService.getAppState();
  const events = new AbortController();
  const { signal } = events;
  const positionStage = document.getElementById('advancedLyricPreviewStage');
  let positionDrag = null;
  const finishPositionDrag = event => {
    if (!positionDrag || event.pointerId !== positionDrag.pointerId) return;
    const drag = positionDrag;
    positionDrag = null;
    positionStage.classList.remove('is-positioning');
    if (positionStage.hasPointerCapture(event.pointerId)) positionStage.releasePointerCapture(event.pointerId);
    if (drag.moved) options.onPositionChange(event.type === 'pointercancel' ? drag.origin : drag.position, true);
  };
  positionStage?.addEventListener('pointerdown', event => {
    if (event.button !== 0 || positionDrag || !options.onPositionChange
      || !form.closest('#desktopLyricPage')?.classList.contains('is-advanced')) return;
    const bounds = positionStage.getBoundingClientRect();
    const settings = readSettings();
    const origin = { x: Number(settings.advancedLyricPositionX), y: Number(settings.advancedLyricPositionY) };
    positionDrag = { pointerId: event.pointerId, clientX: event.clientX, clientY: event.clientY,
      width: bounds.width, height: bounds.height, origin, position: origin, moved: false };
    positionStage.setPointerCapture(event.pointerId);
    positionStage.classList.add('is-positioning');
    event.preventDefault();
  }, { signal });
  positionStage?.addEventListener('pointermove', event => {
    const drag = positionDrag;
    if (!drag || event.pointerId !== drag.pointerId) return;
    const percent = value => Math.max(0, Math.min(100, Math.round(value)));
    const position = { x: percent(drag.origin.x + (event.clientX - drag.clientX) / drag.width * 100),
      y: percent(drag.origin.y + (event.clientY - drag.clientY) / drag.height * 100) };
    if (position.x === drag.position.x && position.y === drag.position.y) return;
    drag.position = position;
    drag.moved = true;
    options.onPositionChange(position, false);
  }, { signal });
  for (const type of ['pointerup', 'pointercancel', 'lostpointercapture']) positionStage?.addEventListener(type, finishPositionDrag, { signal });
  window.addEventListener('app:lyric-state', event => {
    desktopLyricRenderer.updateLyricState(event.detail);
  }, { signal });
  window.addEventListener('app:lyric-timeline', event => {
    desktopLyricRenderer.updateLyricTimeline(event.detail);
  }, { signal });
  window.addEventListener('pagehide', () => {
    events.abort();
    desktopLyricRenderer.dispose();
  }, { once: true });
  if (appState?.lyricTimeline) desktopLyricRenderer.updateLyricTimeline(appState.lyricTimeline);
  if (appState?.lyricState) desktopLyricRenderer.updateLyricState(appState.lyricState);
  applyStylesFromForm();
}

function applyStylesFromForm() {
  const settings = readSettings();
  syncDesktopLyricKaraokeColorControls(settings);
  desktopLyricRenderer.applySettings(settings);
}

function setPreviewLayer(layer) {
  previewLayer = layer === 'advanced' ? 'advanced' : 'basic';
  desktopLyricRenderer.setPreviewLayer(previewLayer);
  const label = previewLayer === 'advanced' ? '高级歌词地址' : '基础歌词地址';
  const title = document.getElementById('desktopLyricUrlLabel');
  const url = document.getElementById('desktopLyricUrl');
  const button = document.getElementById('desktopLyricCopyUrlBtn');
  if (title) title.textContent = label;
  if (url) url.textContent = desktopLyricUrl();
  if (button) button.title = `点击复制${label}`;
}

function desktopLyricUrl() {
  return `${localOverlayOrigin(location)}/lyrics?layer=${previewLayer}`;
}

async function copyDesktopLyricUrl() {
  const url = desktopLyricUrl();
  try {
    await copyText(url);
    toast('直播歌词浏览器源地址已复制');
  } catch (error) {
    prompt('复制以下直播歌词浏览器源地址：', url);
  }
}

export const desktopLyricPreview = {
  ...desktopLyricRenderer,
  init,
  setPreviewLayer,
};
