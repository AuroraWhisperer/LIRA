import { copyText, localOverlayOrigin, toast } from '../../shared/utils.js';
import { openComponentPreview } from '../component-preview-dialog.js';
import {
  createGiftBanner,
  fitGiftBannerNames,
  GIFT_PALETTE,
  loadGiftArtworkCatalog,
} from '../../shared/gift-banner.js';

export function createGiftDisplaySettings() {
  const get = (id) => document.getElementById(id);
  const previewRoot = get('giftStylePreview');
  let config;
  const sample = {
    eventId: 'sample',
    gift: { giftId: '', giftName: '礼物', userName: '礼物样式预览', unitPrice: 1000, num: 1, guardLevel: null },
  };
  let catalog = [];
  let sequence = 0;
  let saving = false;
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

  function values() {
    return {
      palette: 'bilibili-four',
      thresholds: [1, 2, 3].map((n) => Number(get(`giftTier${n}`).value) * 100),
      visibleRows: Number(get('giftFeedRows').value),
      scrollSpeed: Number(get('giftFeedSpeed').value),
      minGiftAmountCents: Number(get('giftFeedMinAmount').value) * 100,
    };
  }

  function preview() {
    const draft = values();
    const thresholds = draft.thresholds.map((n) => Math.round(n));
    if (thresholds.every((n) => Number.isSafeInteger(n) && n > 0)) {
      previewRoot.replaceChildren(
        ...GIFT_PALETTE.map(([start, end]) => {
          const banner = createGiftBanner(sample, { ...draft, thresholds }, catalog);
          banner.style.setProperty('--gift-start', start);
          banner.style.setProperty('--gift-end', end);
          return banner;
        }),
      );
      fitGiftBannerNames(previewRoot);
    }
  }

  function updateCancelVisibility() {
    const savedValues = [
      ...[1, 2, 3].map((n) => [`giftTier${n}`, config.thresholds[n - 1] / 100]),
      ['giftFeedRows', config.visibleRows],
      ['giftFeedSpeed', config.scrollSpeed],
      ['giftFeedMinAmount', (config.minGiftAmountCents ?? 0) / 100],
    ];
    get('giftDisplayCancel').hidden = savedValues.every(([id, value]) => {
      const input = get(id);
      return input.value !== '' && Number(input.value) === value;
    });
  }

  function fill(value) {
    [1, 2, 3].forEach((n) => {
      get(`giftTier${n}`).value = value.thresholds[n - 1] / 100;
      get(`giftTierEnd${n - 1}`).value = value.thresholds[n - 1] / 100;
    });
    get('giftFeedRows').value = value.visibleRows;
    get('giftFeedSpeed').value = value.scrollSpeed;
    get('giftFeedMinAmount').value = (value.minGiftAmountCents ?? 0) / 100;
    preview();
    updateCancelVisibility();
  }

  get('giftDisplayCancel')?.addEventListener('click', () => {
    fill(config);
    get('giftDisplayError').textContent = '';
    toast('已恢复上次保存的设置');
  });
  get('giftDisplayDefaults')?.addEventListener('click', () =>
    fill({ thresholds: [3000, 10000, 100000], visibleRows: 3, scrollSpeed: 12, minGiftAmountCents: 0 }),
  );
  get('giftDisplayForm')?.addEventListener('input', (event) => {
    const boundary = event.target.dataset.giftBoundary;
    if (boundary) {
      for (const input of get('giftDisplayForm').querySelectorAll('[data-gift-boundary]')) {
        if (input !== event.target && input.dataset.giftBoundary === boundary) input.value = event.target.value;
      }
    }
    preview();
    updateCancelVisibility();
  });
  get('giftDisplayForm')?.addEventListener('submit', (event) => {
    event.preventDefault();
    run(async () => {
      if (saving) return;
      saving = true;
      const current = sequence;
      const draft = values();
      // Decimal input precision is checked by the native form; remove floating point noise in cents.
      draft.thresholds = draft.thresholds.map(Math.round);
      draft.minGiftAmountCents = Math.round(draft.minGiftAmountCents);
      get('giftDisplayFields').disabled = true;
      try {
        const response = await fetch('/api/gifts/display-settings', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(draft),
          signal: AbortSignal.timeout(10000),
        });
        const result = await response.json();
        if (current !== sequence) return;
        if (!result.ok) throw new Error(result.error);
        config = result.data;
        fill(config);
        get('giftDisplayError').textContent = '';
        toast('滚动礼物与词条样式已保存');
      } finally {
        saving = false;
        get('giftDisplayFields').disabled = false;
      }
    });
  });
  get('giftFeedUrl')?.addEventListener('click', () =>
    run(async () => {
      await copyText(get('giftFeedUrl').textContent);
      toast('本日礼物地址已复制');
    }),
  );
  get('giftFeedPreviewBtn')?.addEventListener('click', () => openComponentPreview({ id: 'gift-feed' }));
  const receiveSettings = event => {
    if (!config || saving || !event.detail?.giftDisplayConfig) return;
    let next;
    try { next = JSON.parse(event.detail.giftDisplayConfig); } catch { return; }
    const draft = values();
    const merged = { ...next };
    for (const key of ['visibleRows', 'scrollSpeed', 'minGiftAmountCents', 'thresholds']) {
      if (JSON.stringify(draft[key]) !== JSON.stringify(config[key])) merged[key] = draft[key];
    }
    config = next;
    fill(merged);
  };
  window.addEventListener('app:settings-state', receiveSettings);
  window.addEventListener('pagehide', () => window.removeEventListener('app:settings-state', receiveSettings), { once: true });

  return {
    async open() {
      if (config) return;
      const current = ++sequence;
      const response = await fetch('/api/gifts/display-settings', { signal: AbortSignal.timeout(10000) });
      const result = await response.json();
      if (!result.ok) throw new Error(result.error);
      const nextCatalog = await loadGiftArtworkCatalog(AbortSignal.timeout(5000)).catch(() => []);
      if (current !== sequence) return;
      config = result.data;
      catalog = nextCatalog;
      const url = `${localOverlayOrigin(location)}/gift-feed`;
      get('giftFeedUrl').textContent = url;
      get('giftDisplayError').textContent = '';
      fill(config);
      get('giftDisplayFields').disabled = false;
    },
  };
}
