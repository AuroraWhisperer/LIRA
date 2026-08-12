// 桌面歌词设置实时预览：复用共享逐字渲染器，只负责设置到 CSS 变量的映射。
'use strict';

import { LyricWordRenderer } from '../shared/lyric-word-renderer.js';

const DEFAULTS = {
  desktopLyricFontFamily: 'Microsoft YaHei',
  desktopLyricFontWeight: '800',
  desktopLyricTextColor: '#000000',
  desktopLyricStrokeColor: '#ffffff',
  desktopLyricFontSize: '56',
  desktopLyricStrokeWidth: '3',
  desktopLyricOpacity: '0.95',
  desktopLyricBgOpacity: '0.15',
  desktopLyricScale: '1',
  desktopLyricLineHeight: '1.4',
  desktopLyricShadowIntensity: '0.35',
  desktopLyricTranslationScale: '0.65'
};

let initialized = false;
let renderer = null;
let latestState = null;

function init(form) {
  if (initialized) return;
  const stage = document.getElementById('desktopLyricPreviewStage');
  const line = document.getElementById('desktopLyricPreviewLine');
  if (!stage || !line) return;
  initialized = true;

  renderer = new LyricWordRenderer({
    lineElement: line,
    progressElement: document.getElementById('desktopLyricPreviewProgress'),
    wordClass: 'desktop-lyric-preview-word',
    progressProperty: '--preview-word-progress',
    fallbackText: previewFallback
  });

  form?.addEventListener('input', applyStylesFromForm);
  form?.addEventListener('change', applyStylesFromForm);
  document.querySelectorAll('[data-lyric-preview-background]').forEach((button) => {
    button.addEventListener('click', () => setBackground(button.dataset.lyricPreviewBackground));
  });
  document.getElementById('desktopLyricOpenWindowBtn')?.addEventListener('click', openDesktopLyricWindow);
  window.addEventListener('app:lyric-state', (event) => updateLyricState(event.detail));
  window.addEventListener('app:settings-state', (event) => applySettings(event.detail));

  const initialState = window.AdminApp.state?.getAppState?.()?.lyricState;
  if (initialState) updateLyricState(initialState);
  applyStylesFromForm();
}

function updateLyricState(state) {
  if (!state || typeof state !== 'object') return;
  latestState = { ...(latestState || {}), ...state };
  renderer?.setState(latestState);
  const translation = document.getElementById('desktopLyricPreviewTranslation');
  if (translation) {
    translation.textContent = latestState.translation || '';
    translation.hidden = !latestState.translation;
  }
  const status = document.getElementById('desktopLyricPreviewStatus');
  if (status) {
    const hasLyric = Boolean(latestState.lineText || latestState.words?.length);
    status.textContent = hasLyric ? latestState.playing ? '实时播放中' : '歌词已暂停' : '等待播放';
    status.className = `pill ${hasLyric ? 'good' : 'warn'}`;
  }
}

function applyStylesFromForm() {
  applySettings(readFormSettings());
}

function applySettings(settings = {}) {
  const card = document.getElementById('desktopLyricLivePreview');
  if (!card) return;
  const values = { ...DEFAULTS, ...settings };
  const fontSize = numberSetting(values.desktopLyricFontSize, 56);
  const translationScale = numberSetting(values.desktopLyricTranslationScale, 0.65);
  card.style.setProperty('--preview-font', `${values.desktopLyricFontFamily}, "Microsoft YaHei", sans-serif`);
  card.style.setProperty('--preview-weight', values.desktopLyricFontWeight);
  card.style.setProperty('--preview-color', values.desktopLyricTextColor);
  card.style.setProperty('--preview-stroke', values.desktopLyricStrokeColor);
  card.style.setProperty('--preview-size', `${fontSize}px`);
  card.style.setProperty('--preview-translation-size', `${fontSize * translationScale}px`);
  card.style.setProperty('--preview-stroke-width', `${numberSetting(values.desktopLyricStrokeWidth, 3)}px`);
  card.style.setProperty('--preview-opacity', String(numberSetting(values.desktopLyricOpacity, 0.95)));
  card.style.setProperty('--preview-bg-opacity', String(numberSetting(values.desktopLyricBgOpacity, 0.15)));
  card.style.setProperty('--preview-scale', String(numberSetting(values.desktopLyricScale, 1)));
  card.style.setProperty('--preview-line-height', String(numberSetting(values.desktopLyricLineHeight, 1.4)));
  card.style.setProperty('--preview-shadow-opacity', String(numberSetting(values.desktopLyricShadowIntensity, 0.35)));
}

function readFormSettings() {
  const values = {};
  for (const key of Object.keys(DEFAULTS)) {
    const input = document.getElementById(key);
    if (input) values[key] = input.value;
  }
  return values;
}

function setBackground(background) {
  const solid = background === 'solid';
  document.getElementById('desktopLyricPreviewStage')?.classList.toggle('is-solid', solid);
  document.querySelectorAll('[data-lyric-preview-background]').forEach((button) => {
    const active = button.dataset.lyricPreviewBackground === (solid ? 'solid' : 'grid');
    button.classList.toggle('active', active);
    button.setAttribute('aria-pressed', String(active));
  });
}

async function openDesktopLyricWindow() {
  if (!window.musicAPI || typeof window.musicAPI.openLyricWindow !== 'function') {
    window.AdminApp.utils?.toast?.('独立桌面歌词需要在桌面版里使用');
    return;
  }
  try {
    await window.musicAPI.openLyricWindow();
    window.AdminApp.utils?.toast?.('桌面歌词窗口已打开');
  } catch (error) {
    window.AdminApp.utils?.showError?.(error);
  }
}

function previewFallback(state) {
  if (state.status === 'loading') return '正在载入歌词';
  if (state.status === 'empty') return '这首歌暂无歌词';
  if (state.status === 'ready') return '前奏中';
  return '等待播放 · 歌词将在这里实时预览';
}

function numberSetting(value, fallback) {
  const number = Number.parseFloat(value);
  return Number.isFinite(number) ? number : fallback;
}

window.AdminApp = window.AdminApp || {};
window.AdminApp.desktopLyricPreview = { init, applySettings, updateLyricState };
