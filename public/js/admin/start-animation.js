'use strict';

import { copyText, localOverlayOrigin, toast } from '../shared/utils.js';

const OPENING_DEFAULTS = Object.freeze({
  enabled: true,
  title: '唱一首，在一首，给你的歌',
  subtitle: '开播准备中',
  name: '',
  footer: 'SINGING LIVE',
  quality: 'normal',
  showNotes: true,
  showEq: true
});

const QUALITY_VALUES = new Set(['high', 'normal', 'low']);

function readStartAnimationConfig(root = document) {
  const value = (id, fallback) => root.getElementById(id)?.value ?? fallback;
  return {
    enabled: Boolean(root.getElementById('openingEnabled')?.checked),
    title: value('openingTitle', OPENING_DEFAULTS.title).trim(),
    subtitle: value('openingSubtitle', OPENING_DEFAULTS.subtitle).trim(),
    name: value('openingName', OPENING_DEFAULTS.name).trim(),
    footer: value('openingFooter', OPENING_DEFAULTS.footer).trim(),
    quality: QUALITY_VALUES.has(value('openingQuality', OPENING_DEFAULTS.quality))
      ? value('openingQuality', OPENING_DEFAULTS.quality) : OPENING_DEFAULTS.quality,
    showNotes: Boolean(root.getElementById('openingShowNotes')?.checked),
    showEq: Boolean(root.getElementById('openingShowEq')?.checked)
  };
}

function buildOpeningUrl(origin, config) {
  const url = new URL('/opening', origin);
  const params = new URLSearchParams();
  params.set('enabled', config.enabled ? '1' : '0');
  params.set('title', config.title || OPENING_DEFAULTS.title);
  params.set('subtitle', config.subtitle || OPENING_DEFAULTS.subtitle);
  params.set('name', config.name);
  params.set('footer', config.footer || OPENING_DEFAULTS.footer);
  params.set('quality', QUALITY_VALUES.has(config.quality) ? config.quality : OPENING_DEFAULTS.quality);
  params.set('showNotes', config.showNotes ? '1' : '0');
  params.set('showEq', config.showEq ? '1' : '0');
  params.set('audio', 'browser');
  url.search = params.toString();
  return url.toString();
}

let initialized = false;

function initStartAnimation() {
  if (initialized) return;
  const form = document.getElementById('openingAnimationForm');
  if (!form) return;
  initialized = true;

  const urlNode = document.getElementById('openingUrl');
  const preview = document.getElementById('openingPreview');
  const previewState = document.getElementById('openingPreviewState');
  const status = document.getElementById('openingAnimationStatus');
  const titleCount = document.getElementById('openingTitleCount');
  const origin = localOverlayOrigin(location);

  const render = () => {
    const config = readStartAnimationConfig();
    const nextUrl = buildOpeningUrl(origin, config);
    if (titleCount) titleCount.textContent = `${Array.from(config.title).length}/20`;
    if (urlNode) urlNode.textContent = nextUrl;
    if (preview) {
      preview.hidden = !config.enabled;
      if (preview.src !== nextUrl) preview.src = nextUrl;
    }
    if (previewState) {
      previewState.textContent = config.enabled ? '已开启' : '已关闭';
      previewState.dataset.state = config.enabled ? 'enabled' : 'disabled';
    }
    if (status) status.textContent = config.enabled
      ? '编辑文案或开关即可刷新预览。'
      : '整套特效已关闭；复制新的源地址到 Browser Source 后才会隐藏画面。';
  };

  form.addEventListener('input', render);
  form.addEventListener('change', render);
  document.getElementById('openingCopyUrl')?.addEventListener('click', async () => {
    try {
      await copyText(urlNode?.textContent || '');
      toast('开播动画地址已复制');
    } catch (error) {
      toast(error.message || '复制失败，请手动复制地址。');
    }
  });
  render();
}

export { OPENING_DEFAULTS, buildOpeningUrl, initStartAnimation, readStartAnimationConfig };
