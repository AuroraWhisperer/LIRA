// 桌面歌词管理页预览适配器。
'use strict';

import { desktopLyricRenderer } from '../lyrics/desktop-lyric-renderer.js';
import { DESKTOP_LYRIC_DEFAULTS } from '../lyrics/desktop-lyric-defaults.js';
import { copyText, localOverlayOrigin, toast } from '../shared/utils.js';
import { stateService } from './state.js';
import {
  normalizeDesktopLyricBackground,
  readDesktopLyricFormSettings,
  setDesktopLyricBackground,
  syncDesktopLyricKaraokeColorControls,
} from './desktop-lyric-controls.js';

const DEFAULT_PREVIEW_SIZES = Object.freeze({
  basic: [720, 960],
  advanced: [960, 640],
});
const LEGACY_SHARED_DEFAULT = [960, 360];
const SIZE_STORAGE_KEY = 'desktopLyricPreviewSize';
const BG_STORAGE_KEY = 'desktopLyricPreviewBackground';
const FRAME_INSET = 12;

let initialized = false;
let previewLayer = 'basic';
let readSettings = () => readDesktopLyricFormSettings(DESKTOP_LYRIC_DEFAULTS);
let syncLayerPreviewSize = () => {};

function init(form, options = {}) {
  if (initialized) return;
  if (!desktopLyricRenderer.init()) return;
  initialized = true;
  if (options.readSettings) readSettings = options.readSettings;

  form?.addEventListener('input', applyStylesFromForm);
  form?.addEventListener('change', applyStylesFromForm);
  initPreviewBackground();
  document.querySelectorAll('[data-lyric-preview-background]').forEach((button) => {
    button.addEventListener('click', () => {
      const mode = setDesktopLyricBackground(button.dataset.lyricPreviewBackground);
      try {
        localStorage.setItem(BG_STORAGE_KEY, mode);
      } catch (error) {
        console.warn('无法保存歌词预览背景，当前预览仍然有效。', error);
      }
    });
  });
  document.getElementById('desktopLyricCopyUrlBtn')?.addEventListener('click', copyDesktopLyricUrl);
  const appState = stateService.getAppState();
  const events = new AbortController();
  const { signal } = events;
  syncLayerPreviewSize = initPreviewSize(signal);
  setPreviewLayer(previewLayer);

  const stage = document.getElementById('desktopLyricPreviewStage');
  const positionStage = document.getElementById('advancedLyricPreviewStage');
  let positionDrag = null;
  const finishPositionDrag = event => {
    if (!positionDrag || event.pointerId !== positionDrag.pointerId) return;
    const drag = positionDrag;
    positionDrag = null;
    positionStage.classList.remove('is-positioning');
    stage?.classList.remove('is-positioning');
    if (positionStage.hasPointerCapture(event.pointerId)) positionStage.releasePointerCapture(event.pointerId);
    const finalPosition = event.type === 'pointercancel' ? drag.origin : drag.position;
    updatePositionGuide(finalPosition.x, finalPosition.y);
    if (drag.moved) options.onPositionChange(finalPosition, true);
  };
  positionStage?.addEventListener('pointerdown', event => {
    if (event.button !== 0 || positionDrag || !options.onPositionChange
      || !form?.closest('#desktopLyricPage')?.classList.contains('is-advanced')) return;
    const bounds = positionStage.getBoundingClientRect();
    const settings = readSettings();
    const origin = { x: Number(settings.advancedLyricPositionX), y: Number(settings.advancedLyricPositionY) };
    positionDrag = { pointerId: event.pointerId, clientX: event.clientX, clientY: event.clientY,
      width: bounds.width, height: bounds.height, origin, position: origin, moved: false };
    positionStage.setPointerCapture(event.pointerId);
    positionStage.classList.add('is-positioning');
    stage?.classList.add('is-positioning');
    updatePositionGuide(origin.x, origin.y);
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
    updatePositionGuide(position.x, position.y);
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
    syncLayerPreviewSize = () => {};
    desktopLyricRenderer.dispose();
  }, { once: true });
  if (appState?.lyricTimeline) desktopLyricRenderer.updateLyricTimeline(appState.lyricTimeline);
  if (appState?.lyricState) desktopLyricRenderer.updateLyricState(appState.lyricState);
  applyStylesFromForm();
}

function initPreviewBackground() {
  let saved = 'dark';
  try {
    const stored = localStorage.getItem(BG_STORAGE_KEY);
    if (stored) saved = normalizeDesktopLyricBackground(stored);
  } catch (error) {
    console.warn('无法读取歌词预览背景，使用默认背景。', error);
  }
  setDesktopLyricBackground(saved);
}

function isValidSizePair(pair, inputs) {
  return Array.isArray(pair) && pair.length === 2
    && pair.every((value, index) => Number.isInteger(value)
      && value >= Number(inputs[index].min)
      && value <= Number(inputs[index].max));
}

function readStoredSizes(inputs) {
  const sizes = {
    basic: [...DEFAULT_PREVIEW_SIZES.basic],
    advanced: [...DEFAULT_PREVIEW_SIZES.advanced],
  };
  try {
    const saved = JSON.parse(localStorage.getItem(SIZE_STORAGE_KEY));
    if (Array.isArray(saved) && isValidSizePair(saved, inputs)) {
      const isLegacyDefault = saved[0] === LEGACY_SHARED_DEFAULT[0] && saved[1] === LEGACY_SHARED_DEFAULT[1];
      if (!isLegacyDefault) {
        sizes.basic = [...saved];
        sizes.advanced = [...saved];
      }
    } else if (saved && typeof saved === 'object') {
      for (const layer of ['basic', 'advanced']) {
        if (isValidSizePair(saved[layer], inputs)) sizes[layer] = [...saved[layer]];
      }
    }
  } catch (error) {
    console.warn('无法读取歌词预览尺寸，使用默认尺寸。', error);
  }
  return sizes;
}

function initPreviewSize(signal) {
  const stage = document.getElementById('desktopLyricPreviewStage');
  const canvas = document.getElementById('desktopLyricPreviewCanvas');
  const notice = document.getElementById('desktopLyricPreviewNotice');
  const frameSize = document.getElementById('desktopLyricPreviewFrameSize');
  if (!stage || !canvas) return () => {};
  const inputs = ['Width', 'Height'].map(axis => document.getElementById(`desktopLyricPreview${axis}`));
  if (inputs.some(input => !input)) return () => {};

  const sizes = readStoredSizes(inputs);

  const applyInputs = () => {
    const pair = sizes[previewLayer] || DEFAULT_PREVIEW_SIZES[previewLayer];
    inputs.forEach((input, index) => { input.value = String(pair[index]); });
  };

  const resize = () => {
    if (inputs.some(input => !input.checkValidity())) return;
    const [width, height] = inputs.map(input => Number(input.value));
    const stageWidth = stage.clientWidth;
    const stageHeight = stage.clientHeight;
    if (!width || !height || !stageWidth || !stageHeight) return;

    const fullScale = Math.min(stageWidth / width, stageHeight / height, 1);
    const fullW = width * fullScale;
    const fullH = height * fullScale;
    const fillsStage = previewLayer === 'basic'
      && fullW >= stageWidth * 0.78
      && fullH >= stageHeight * 0.78;
    const framed = previewLayer === 'advanced' || !fillsStage;

    const insetX = framed ? Math.min(FRAME_INSET, Math.max(0, Math.floor((stageWidth - 120) / 2))) : 0;
    const insetY = framed ? Math.min(FRAME_INSET, Math.max(0, Math.floor((stageHeight - 80) / 2))) : 0;
    const availWidth = Math.max(1, stageWidth - insetX * 2);
    const availHeight = Math.max(1, stageHeight - insetY * 2);
    const scale = Math.min(availWidth / width, availHeight / height, 1);
    const renderedWidth = Math.round(width * scale);
    const renderedHeight = Math.round(height * scale);
    const bottomSpace = Math.max(0, Math.floor((stageHeight - renderedHeight) / 2));

    stage.classList.toggle('is-framed', framed);
    stage.classList.toggle('has-caption-room', framed && bottomSpace >= 30);
    stage.style.setProperty('--lyric-frame-width', `${renderedWidth}px`);
    stage.style.setProperty('--lyric-frame-height', `${renderedHeight}px`);
    canvas.style.width = `${width}px`;
    canvas.style.height = `${height}px`;
    canvas.style.setProperty('--lyric-canvas-width', `${width}px`);
    canvas.style.setProperty('--lyric-preview-fit', String(scale));

    const label = `${width} × ${height}`;
    if (frameSize) frameSize.textContent = label;
    if (notice) notice.dataset.subtext = `透明背景 · ${label}`;
  };

  const persistCurrentSize = () => {
    if (inputs.some(input => !input.checkValidity())) return;
    sizes[previewLayer] = inputs.map(input => Number(input.value));
    try { localStorage.setItem(SIZE_STORAGE_KEY, JSON.stringify(sizes)); }
    catch (error) {
      console.warn('无法保存歌词预览尺寸，当前预览仍然有效。', error);
    }
  };

  for (const input of inputs) {
    input.addEventListener('input', () => {
      if (inputs.every(field => field.checkValidity())) sizes[previewLayer] = inputs.map(field => Number(field.value));
      resize();
    }, { signal });
    input.addEventListener('change', () => {
      resize();
      persistCurrentSize();
    }, { signal });
  }

  const observer = new ResizeObserver(resize);
  observer.observe(stage);
  signal.addEventListener('abort', () => observer.disconnect(), { once: true });

  applyInputs();
  resize();
  return () => {
    applyInputs();
    resize();
  };
}

function updatePositionGuide(rawX, rawY) {
  const stage = document.getElementById('desktopLyricPreviewStage');
  const coords = document.getElementById('desktopLyricPreviewCoords');
  const x = Number.isFinite(Number(rawX)) ? Math.round(Number(rawX)) : 50;
  const y = Number.isFinite(Number(rawY)) ? Math.round(Number(rawY)) : 50;
  if (stage) {
    stage.style.setProperty('--lyric-anchor-x', `${x}%`);
    stage.style.setProperty('--lyric-anchor-y', `${y}%`);
  }
  if (coords) coords.textContent = `${x}% · ${y}%`;
}

function applyStylesFromForm() {
  const settings = readSettings();
  syncDesktopLyricKaraokeColorControls(settings);
  desktopLyricRenderer.applySettings(settings);
  updatePositionGuide(settings.advancedLyricPositionX, settings.advancedLyricPositionY);
}

function setPreviewLayer(layer) {
  previewLayer = layer === 'advanced' ? 'advanced' : 'basic';
  desktopLyricRenderer.setPreviewLayer(previewLayer);
  const stage = document.getElementById('desktopLyricPreviewStage');
  if (stage) stage.dataset.previewLayer = previewLayer;
  const caption = document.getElementById('desktopLyricPreviewCaption');
  if (caption) caption.textContent = previewLayer === 'advanced' ? '推流范围 · 悬停可拖动位置' : '推流范围 · 按实际比例模拟换行';
  syncLayerPreviewSize();
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
