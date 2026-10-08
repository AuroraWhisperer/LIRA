import { requestGiftWish } from '../shared/gift-wish-client.js';
import { SCENE_EXTRA_COMPONENTS } from '../shared/scene-extra-components.js';

// Select examples in the authorized client, without exposing the catalog API to frames.
export function startGiftWishesCanvasData(controller, emit) {
  const requests = new AbortController();
  let started = false;
  async function load() {
    const gifts = new Map();
    for (const path of ['/api/overtime/gifts/catalog', '/api/overtime/gifts']) {
      try {
        const catalog = await requestGiftWish(path, undefined, requests.signal);
        for (const gift of catalog?.gifts || []) {
          if (gift.id && gift.name && gift.imagePath) gifts.set(String(gift.id), gift);
        }
      } catch {
        // The room cache can still provide artwork when the global cache is unavailable.
        if (requests.signal.aborted) return;
        continue;
      }
      if (requests.signal.aborted) return;
      if (gifts.size >= 3) break;
    }
    const available = [...gifts.values()];
    const examples = [];
    const maximum = SCENE_EXTRA_COMPONENTS['gift-wishes'].fields.limit.max;
    while (available.length && examples.length < maximum) {
      const [gift] = available.splice(Math.floor(Math.random() * available.length), 1);
      examples.push(gift);
    }
    const items = Array.from({ length: examples.length ? maximum : 0 }, (_, index) => {
      const gift = examples[index % examples.length];
      const count = [36, 58, 72][index % 3];
      return { id: `preview-wish-${index}-${gift.id}`, period: 'day', giftId: String(gift.id),
        giftName: gift.name, imagePath: gift.imagePath, target: 100, count, todayCount: count,
        remaining: 100 - count, progress: count, completed: false, label: '今日小心愿',
        displayStyle: 'card', textTemplate: '{礼物} {已收}/{目标}',
        textImagePosition: 'before', textImageFormat: 'static' };
    });
    emit({ previewData: { 'gift-wishes': { preview: true, items,
      message: items.length ? '' : '礼物图片尚未缓存，请先同步礼物库后重新打开预览。',
      session: { state: 'live', stale: false } } } });
  }
  const stop = controller.subscribe(({ draft }) => {
    if (started || requests.signal.aborted || !draft.document.items.some(item => item.type === 'gift-wishes')) return;
    started = true;
    void load();
  });
  return () => { stop(); requests.abort(); };
}
