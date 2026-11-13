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
  initPreviewSize(signal);
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

function initPreviewSize(signal) {
  const stage = document.getElementById('desktopLyricPreviewStage');
  const canvas = document.getElementById('desktopLyricPreviewCanvas');
  if (!canvas) return;
  const inputs = ['Width', 'Height'].map(axis => document.getElementById(`desktopLyricPreview${axis}`));
  const storageKey = 'desktopLyricPreviewSize';
  try {
    const saved = JSON.parse(localStorage.getItem(storageKey));
    inputs.forEach((input, index) => {
      const value = saved?.[index];
      if (Number.isInteger(value) && value >= Number(input.min) && value <= Number(input.max)) input.value = String(value);
    });
  } catch (error) {
    console.warn('无法读取歌词预览尺寸，使用默认尺寸。', error);
  }
  const resize = () => {
    if (inputs.some(input => !input.checkValidity())) return;
    const [width, height] = inputs.map(input => Number(input.value));
    if (!width || !height || !stage.clientWidth || !stage.clientHeight) return;
    const scale = Math.min(stage.clientWidth / width, stage.clientHeight / height, 1);
    canvas.style.width = `${width}px`;
    canvas.style.height = `${height}px`;
    canvas.style.setProperty('--lyric-preview-fit', String(scale));
  };
  for (const input of inputs) {
    input.addEventListener('input', resize, { signal });
    input.addEventListener('change', () => {
      resize();
      if (inputs.some(input => !input.checkValidity())) return;
      try { localStorage.setItem(storageKey, JSON.stringify(inputs.map(input => Number(input.value)))); }
      catch (error) {
        console.warn('无法保存歌词预览尺寸，当前预览仍然有效。', error);
      }
    }, { signal });
  }
  const observer = new ResizeObserver(resize);
  observer.observe(stage);
  signal.addEventListener('abort', () => observer.disconnect(), { once: true });
  resize();
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
  const button = document.getElementById('desktopLyricCopyUrlBtn');
  if (button) {
    button.textContent = `复制${label}`;
    button.title = desktopLyricUrl();
  }
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
