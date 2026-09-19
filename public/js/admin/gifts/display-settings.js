import { copyText, localOverlayOrigin, toast } from '../../shared/utils.js';
import { createGiftBanner, fitGiftBannerNames, GIFT_PALETTE, loadGiftArtworkCatalog } from '../../shared/gift-banner.js';

export function createGiftDisplaySettings() {
  const get = (id) => document.getElementById(id);
  let config;
  const sample = { eventId: 'sample', gift: { giftId: '', giftName: '礼物', userName: '礼物样式预览', unitPrice: 1000, num: 1, guardLevel: null } };
  let catalog = [];
  let sequence = 0;
  let saving = false;
  const fail = (error) => { get('giftDisplayError').textContent = error.message; };
  const run = (fn) => Promise.resolve().then(fn).catch(fail);
  get('giftDisplayForm')?.querySelectorAll('.gift-tier-swatch').forEach((swatch, index) => {
    const [start, end] = GIFT_PALETTE[index];
    swatch.style.setProperty('--gift-start', start);
    swatch.style.setProperty('--gift-end', end);
  });

  function values() {
    return { palette: 'bilibili-four', thresholds: [1, 2, 3].map((n) => Number(get(`giftTier${n}`).value) * 100),
      visibleRows: Number(get('giftFeedRows').value), intervalSeconds: Number(get('giftFeedInterval').value),
      paused: get('giftFeedPaused').checked, lowPower: get('giftFeedLowPower').checked };
  }

  function preview() {
    const draft = values();
    const thresholds = draft.thresholds.map((n) => Math.round(n));
    if (thresholds.every((n) => Number.isSafeInteger(n) && n > 0)) {
      get('giftStylePreview').replaceChildren(createGiftBanner(sample, { ...draft, thresholds }, catalog));
      fitGiftBannerNames(get('giftStylePreview'));
    }
  }

  function fill(value) {
    [1, 2, 3].forEach((n) => {
      get(`giftTier${n}`).value = value.thresholds[n - 1] / 100;
      get(`giftTierEnd${n - 1}`).value = value.thresholds[n - 1] / 100;
    });
    get('giftFeedRows').value = value.visibleRows;
    get('giftFeedInterval').value = value.intervalSeconds;
    get('giftFeedPaused').checked = value.paused;
    get('giftFeedLowPower').checked = value.lowPower;
    preview();
  }

  get('giftDisplayCancel')?.addEventListener('click', () => { fill(config); get('giftDisplayError').textContent = ''; });
  get('giftDisplayDefaults')?.addEventListener('click', () => fill({ thresholds: [10000, 50000, 100000], visibleRows: 3, intervalSeconds: 4, paused: false, lowPower: false }));
  get('giftDisplayForm')?.addEventListener('input', (event) => {
    const boundary = event.target.dataset.giftBoundary;
    if (boundary) {
      for (const input of get('giftDisplayForm').querySelectorAll('[data-gift-boundary]')) {
        if (input !== event.target && input.dataset.giftBoundary === boundary) input.value = event.target.value;
      }
    }
    preview();
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
      get('giftDisplayFields').disabled = true;
      try {
        const response = await fetch('/api/gifts/display-settings', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(draft), signal: AbortSignal.timeout(10000) });
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
  get('giftFeedCopy')?.addEventListener('click', () => run(async () => { await copyText(get('giftFeedUrl').value); toast('本日礼物地址已复制'); }));

  return { async open() {
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
    get('giftFeedUrl').value = url;
    get('giftFeedPreviewLink').href = `${url}?preview=1`;
    get('giftDisplayError').textContent = '';
    fill(config);
    get('giftDisplayFields').disabled = false;
  } };
}
