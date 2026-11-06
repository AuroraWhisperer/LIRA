import { createGiftWishFeed } from '../shared/gift-wish-client.js';

export function startGiftWishesCanvasData(controller, emit) {
  const publish = data => emit({ previewData: { 'gift-wishes': data } });
  const feed = createGiftWishFeed({
    onData(data) {
      publish({ ...data, preview: true,
        message: data.items.length ? '' : '还没有保存的礼物许愿，请在客户端添加。' });
    },
    onError(error) { publish({ preview: true, items: [], message: error.message }); },
  });
  let active = false;
  const stop = controller.subscribe(({ draft }) => {
    const needed = draft.document.items.some(item => item.type === 'gift-wishes');
    if (needed === active) return;
    active = needed;
    if (needed) void feed.start();
    else { feed.stop(); publish(null); }
  });
  return () => { stop(); feed.stop(); };
}
