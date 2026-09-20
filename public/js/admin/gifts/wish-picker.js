import { setGiftImage } from '../../shared/gift-image-fallback.js';
import { createGiftCatalogRoleLookup } from '../../shared/gift-catalog-roles.js';
import { requestGiftWish } from '../../shared/gift-wish-client.js';
import { WISH_CATEGORIES } from '../../shared/gift-wish-card.js';

export function createWishPicker(onSelect) {
  const get = (id) => document.getElementById(id);
  const dialog = get('giftWishPicker');
  let source = 'room';
  let guards = [];
  let snapshot = null;
  let generation = 0;
  let controller;
  let visibleCount = 80;

  function render() {
    const root = get('giftWishResults');
    root.replaceChildren();
    const query = get('giftWishSearch').value.trim().toLowerCase();
    const role = createGiftCatalogRoleLookup(snapshot);
    const gifts = [...guards, ...(snapshot?.gifts || [])].filter((gift) =>
      `${gift.name} ${gift.id}`.toLowerCase().includes(query),
    );
    for (const gift of gifts.slice(0, visibleCount)) {
      const button = document.createElement('button');
      button.type = 'button';
      button.className = 'gift-wish-option';
      button.disabled = gift.giftCategory !== 'guard' && !gift.variantId;
      const image = document.createElement('img');
      image.alt = '';
      setGiftImage(image, gift.imagePath);
      const name = document.createElement('span');
      name.textContent = gift.name;
      const category = document.createElement('small');
      category.textContent =
        role(gift) || WISH_CATEGORIES[gift.giftCategory] || '礼物';
      const identity = document.createElement('small');
      identity.textContent =
        gift.giftCategory === 'guard'
          ? '按购买数量统计'
          : `ID ${gift.id} · ¥${Number(gift.rmb || 0).toFixed(2)}`;
      if (button.disabled) identity.textContent += ' · 资料待同步，请刷新礼物库';
      button.append(image, name, category, identity);
      button.addEventListener('click', () => {
        onSelect(gift);
        dialog.close();
      });
      root.append(button);
    }
    if (gifts.length > visibleCount) {
      const more = document.createElement('button');
      more.type = 'button';
      more.className = 'secondary';
      more.textContent = `继续显示（还有 ${gifts.length - visibleCount} 款）`;
      more.addEventListener('click', () => {
        visibleCount += 80;
        render();
      });
      root.append(more);
    }
    if (!gifts.length) {
      const empty = document.createElement('p');
      empty.className = 'hint';
      empty.textContent = query
        ? '没有匹配的礼物，试试其他名称或 ID。'
        : '这里还没有缓存礼物，可切换礼物范围重试。';
      root.append(empty);
    }
  }

  async function load(nextSource) {
    source = nextSource;
    visibleCount = 80;
    const current = ++generation;
    controller?.abort();
    controller = new AbortController();
    snapshot = null;
    get('giftWishPickerStatus').textContent =
      source === 'room' ? '正在刷新本直播间在售礼物…' : '正在读取全部缓存礼物…';
    dialog
      .querySelectorAll('[data-wish-source]')
      .forEach((button) =>
        button.setAttribute(
          'aria-pressed',
          String(button.dataset.wishSource === source),
        ),
      );
    render();
    try {
      let data;
      if (source === 'all')
        data = await requestGiftWish(
          '/api/overtime/gifts/catalog',
          undefined,
          controller.signal,
        );
      else {
        try {
          data = await requestGiftWish(
            '/api/overtime/gifts/refresh',
            {},
            controller.signal,
          );
        } catch (error) {
          if (controller.signal.aborted || current !== generation) return;
          data = await requestGiftWish(
            '/api/overtime/gifts',
            undefined,
            controller.signal,
          );
          if (current === generation)
            get('giftWishPickerStatus').textContent =
              '在售列表暂未刷新，正在显示上次成功缓存。';
        }
      }
      if (current !== generation) return;
      snapshot = data;
      if (!data?.gifts?.length)
        get('giftWishPickerStatus').textContent =
          '礼物目录尚未缓存，连接直播间后重新打开即可。';
      else if (
        !get('giftWishPickerStatus').textContent.includes('上次成功缓存')
      ) {
        get('giftWishPickerStatus').textContent =
          `${source === 'room' ? '本直播间在售及盲盒产出' : '本地缓存的全部礼物'} · ${data.gifts.length} 款`;
      }
      render();
    } catch (error) {
      if (current !== generation) return;
      get('giftWishPickerStatus').textContent =
        `${error.message} 点击礼物范围可重试。`;
    }
  }

  get('giftWishSearch').addEventListener('input', () => {
    visibleCount = 80;
    render();
  });
  get('giftWishPickerClose').addEventListener('click', () => dialog.close());
  dialog
    .querySelectorAll('[data-wish-source]')
    .forEach((button) =>
      button.addEventListener('click', () => load(button.dataset.wishSource)),
    );
  dialog.addEventListener('close', () => {
    generation++;
    controller?.abort();
  });
  return {
    open(nextGuards) {
      guards = nextGuards;
      get('giftWishSearch').value = '';
      dialog.showModal();
      get('giftWishSearch').focus();
      load('room');
    },
    close() {
      if (dialog.open) dialog.close();
    },
  };
}
