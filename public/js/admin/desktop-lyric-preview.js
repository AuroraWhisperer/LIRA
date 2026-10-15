// 桌面歌词管理页预览适配器。
'use strict';

import { desktopLyricRenderer } from '../lyrics/desktop-lyric-renderer.js';
import { DESKTOP_LYRIC_DEFAULTS } from '../lyrics/desktop-lyric-defaults.js';
import { copyText, localOverlayOrigin, toast } from '../shared/utils.js';
import { stateService } from './state.js';
import { readDesktopLyricFormSettings, setDesktopLyricBackground, syncDesktopLyricKaraokeColorControls } from './desktop-lyric-controls.js';

let initialized = false;

function init(form) {
  if (initialized) return;
  if (!desktopLyricRenderer.init()) return;
  initialized = true;

  form?.addEventListener('input', applyStylesFromForm);
  form?.addEventListener('change', applyStylesFromForm);
  document.querySelectorAll('[data-lyric-preview-background]').forEach((button) => {
    button.addEventListener('click', () => setDesktopLyricBackground(button.dataset.lyricPreviewBackground));
  });
  document.getElementById('desktopLyricCopyUrlBtn')?.addEventListener('click', copyDesktopLyricUrl);
  window.addEventListener('app:lyric-state', (event) => desktopLyricRenderer.updateLyricState(event.detail));
  window.addEventListener('app:lyric-timeline', (event) => desktopLyricRenderer.updateLyricTimeline(event.detail));
  window.addEventListener('app:settings-state', (event) => desktopLyricRenderer.applySettings(event.detail));

  const appState = stateService.getAppState();
  if (appState?.lyricTimeline) {
    desktopLyricRenderer.updateLyricTimeline(appState.lyricTimeline);
  }
  if (appState?.lyricState) {
    desktopLyricRenderer.updateLyricState(appState.lyricState);
  }
  applyStylesFromForm();
}

function applyStylesFromForm() {
  const settings = readDesktopLyricFormSettings(DESKTOP_LYRIC_DEFAULTS);
  syncDesktopLyricKaraokeColorControls(settings);
  desktopLyricRenderer.applySettings(settings);
}

async function copyDesktopLyricUrl() {
  const desktopLyricUrl = `${localOverlayOrigin(location)}/lyrics`;
  try {
    await copyText(desktopLyricUrl);
    toast('直播歌词浏览器源地址已复制');
  } catch (error) {
    prompt('复制以下直播歌词浏览器源地址：', desktopLyricUrl);
  }
}

export const desktopLyricPreview = {
  ...desktopLyricRenderer,
  init,
};
