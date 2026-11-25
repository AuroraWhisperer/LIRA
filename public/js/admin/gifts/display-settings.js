import { readApiResponse } from '../../shared/json-response.js';
import { localOverlayOrigin, toast } from '../../shared/utils.js';
import { bindCopyUrl } from '../../shared/copy-url.js';
import { openComponentPreview } from '../component-preview-dialog.js';
import { createComponentConfigController } from '../component-config-controller.js';
import { bindComponentAutosave } from '../settings-autosave.js';
import { GIFT_BANNER_TAILS, GIFT_BANNER_TEXTURES, DEFAULT_GIFT_BANNER_APPEARANCE } from '../../shared/gift-banner-styles.js';
import { GIFT_PLACEHOLDER } from '../../shared/gift-image.js';
import {
  applyGiftBannerAppearance,
  createGiftBanner,
  fitGiftBannerNames,
  GIFT_PALETTE,
} from '../../shared/gift-banner.js';

export function createGiftDisplaySettings() {
  const get = (id) => document.getElementById(id);
  const previewRoot = get('giftStylePreview');
  for (const [id, options] of [['giftTailStyle', GIFT_BANNER_TAILS], ['giftTextureStyle', GIFT_BANNER_TEXTURES]]) {
    for (const [value, label] of Object.entries(options)) {
      const option = document.createElement('option');
      option.value = value;
      option.textContent = label;
      get(id).append(option);
    }
  }
  const controller = createComponentConfigController({
    read: () => requestConfig(),
    persist: draft => requestConfig(draft),
  });
  const sample = {
    eventId: 'sample',
    artworkPath: GIFT_PLACEHOLDER,
    gift: { giftId: '', giftName: '礼物', userName: '礼物样式预览', unitPrice: 1000, num: 1, guardLevel: null },
  };
  let previewVisible = false;
  function updatePreviewPlayback() {
    previewRoot.classList.toggle('is-playing', previewVisible && !document.hidden);
  }
  const previewObserver = new IntersectionObserver(([entry]) => {
    previewVisible = entry.isIntersecting;
    updatePreviewPlayback();
  });
  previewObserver.observe(previewRoot);
  document.addEventListener('visibilitychange', updatePreviewPlayback);
  window.addEventListener(
    'pagehide',
    () => {
      previewObserver.disconnect();
      document.removeEventListener('visibilitychange', updatePreviewPlayback);
      previewRoot.classList.remove('is-playing');
    },
    { once: true },
  );
  const fail = (error) => {
    get('giftDisplayError').textContent = error.message;
  };
  const run = (fn) => Promise.resolve().then(fn).catch(fail);
  get('giftDisplayForm')
    ?.querySelectorAll('.gift-tier-swatch')
    .forEach((swatch, index) => {
      const [start, end] = GIFT_PALETTE[index];
      swatch.style.setProperty('--gift-start', start);
      swatch.style.setProperty('--gift-end', end);
    });

  async function requestConfig(draft) {
    const response = await fetch('/api/gifts/display-settings', {
      ...(draft ? { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(draft) } : {}),
      signal: AbortSignal.timeout(10000),
    });
    const result = await readApiResponse(response, '礼物显示设置读取或保存失败。');
    return { ...DEFAULT_GIFT_BANNER_APPEARANCE, ...result.data };
  }

  function values() {
    return {
      palette: 'bilibili-four',
      tailStyle: get('giftTailStyle').value,
      textureStyle: get('giftTextureStyle').value,
      sheen: get('giftSheen').checked,
      thresholds: [1, 2, 3].map((n) => Math.round(Number(get(`giftTier${n}`).value) * 100)),
      visibleRows: Number(get('giftFeedRows').value),
      scrollSpeed: Number(get('giftFeedSpeed').value),
      minGiftAmountCents: Math.round(Number(get('giftFeedMinAmount').value) * 100),
    };
  }

  function preview(draft) {
    if (previewRoot.childElementCount) {
      for (const banner of previewRoot.children) applyGiftBannerAppearance(banner, draft);
      return;
    }
    if (!draft.thresholds.every((n) => Number.isSafeInteger(n) && n > 0)) return;
    for (const [start, end] of GIFT_PALETTE) {
      const banner = createGiftBanner(sample, draft);
      banner.style.setProperty('--gift-start', start);
      banner.style.setProperty('--gift-end', end);
      previewRoot.append(banner);
    }
    fitGiftBannerNames(previewRoot);
  }

  function updateCancelVisibility() {
    const state = controller.getStatus();
    get('giftDisplayCancel').hidden = !state.error && !state.conflict;
  }

  function fill(value) {
    get('giftTailStyle').value = value.tailStyle ?? DEFAULT_GIFT_BANNER_APPEARANCE.tailStyle;
    get('giftTextureStyle').value = value.textureStyle ?? DEFAULT_GIFT_BANNER_APPEARANCE.textureStyle;
    get('giftSheen').checked = value.sheen ?? DEFAULT_GIFT_BANNER_APPEARANCE.sheen;
    [1, 2, 3].forEach((n) => {
      get(`giftTier${n}`).value = value.thresholds[n - 1] / 100;
      get(`giftTierEnd${n - 1}`).value = value.thresholds[n - 1] / 100;
    });
    get('giftFeedRows').value = value.visibleRows;
    get('giftFeedSpeed').value = value.scrollSpeed;
    get('giftFeedMinAmount').value = (value.minGiftAmountCents ?? 0) / 100;
    preview(value);
    updateCancelVisibility();
  }

  get('giftDisplayCancel')?.addEventListener('click', () => {
    controller.discard();
    fill(controller.getState().draft);
    get('giftDisplayError').textContent = '';
  });
  get('giftDisplayDefaults')?.addEventListener('click', () => {
    fill({ thresholds: [3000, 10000, 100000], visibleRows: 3, scrollSpeed: 12, minGiftAmountCents: 0 });
    controller.edit(values());
  });
  get('giftDisplayForm')?.addEventListener('input', (event) => {
    if (event.target.tagName === 'SELECT') return;
    const boundary = event.target.dataset.giftBoundary;
    if (boundary) {
      for (const input of get('giftDisplayForm').querySelectorAll('[data-gift-boundary]')) {
        if (input !== event.target && input.dataset.giftBoundary === boundary) input.value = event.target.value;
      }
    }
    const draft = values();
    controller.edit(draft);
    if (event.target.id === 'giftSheen') preview(draft);
    updateCancelVisibility();
  });
  get('giftDisplayForm')?.addEventListener('change', (event) => {
    if (event.target.tagName !== 'SELECT') return;
    const draft = values();
    controller.edit(draft);
    preview(draft);
    updateCancelVisibility();
  });
  get('giftDisplayForm')?.addEventListener('submit', (event) => {
    event.preventDefault();
    run(async () => {
      if (!controller.getStatus().loaded || controller.getStatus().saving) return;
      const draft = values();
      controller.edit(draft);
      if (!controller.getStatus().dirty) return;
      get('giftDisplayFields').disabled = true;
      try {
        const saved = await controller.save();
        const state = controller.getState();
        fill(state.draft);
        if (!saved) throw new Error(state.error);
        get('giftDisplayError').textContent = '';
        toast('滚动礼物与词条样式已保存');
      } finally {
        get('giftDisplayFields').disabled = false;
      }
    });
  });
  bindCopyUrl(get('giftFeedUrl'), {
    onCopied: () => toast('滚动礼物浏览器源地址已复制'),
    onError: error => { get('giftDisplayError').textContent = error.message; },
  });
  get('giftFeedPreviewBtn')?.addEventListener('click', () => openComponentPreview({ id: 'gift-feed' }));
  const receiveSettings = event => {
    if (!controller.getStatus().loaded || !event.detail?.giftDisplayConfig) return;
    let next;
    try { next = { ...DEFAULT_GIFT_BANNER_APPEARANCE, ...JSON.parse(event.detail.giftDisplayConfig) }; } catch { return; }
    if (controller.receive(next)) fill(controller.getState().draft);
  };
  window.addEventListener('app:settings-state', receiveSettings);
  let wasSaving = false;
  controller.subscribe(state => {
    if (wasSaving && !state.saving && !state.dirty) fill(state.draft);
    wasSaving = state.saving;
  });
  bindComponentAutosave(controller, { root: get('giftDisplayForm'),
    saveButton: get('giftDisplayForm').querySelector('button[type="submit"]'),
    discardButton: get('giftDisplayCancel'), status: get('giftDisplayError') });
  window.addEventListener('pagehide', () => window.removeEventListener('app:settings-state', receiveSettings), { once: true });

  return {
    async open() {
      if (controller.getStatus().loaded) return;
      if (!await controller.reload()) {
        if (controller.getStatus().error) throw new Error(controller.getStatus().error);
        return;
      }
      const url = `${localOverlayOrigin(location)}/gift-feed`;
      get('giftFeedUrl').textContent = url;
      get('giftDisplayError').textContent = '';
      fill(controller.getState().draft);
      get('giftDisplayFields').disabled = false;
    },
  };
}
