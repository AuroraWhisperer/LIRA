import { createGiftCatalogRoleLookup } from '../../shared/gift-catalog-roles.js';
import { requestGiftWish } from '../../shared/gift-wish-client.js';
import { createGiftPickerDialog, isGuardGift } from './gift-picker-dialog.js';

export function createWishPicker(
  onSelect,
  {
    dialog: providedDialog = null,
    request = requestGiftWish,
    requireVariant = true,
    title = '选择礼物',
    guardSubtitle = requireVariant ? '按购买数量统计' : '大航海',
    showRefresh = requireVariant,
    useDefaultIds = !providedDialog && requireVariant,
  } = {},
) {
  const hostDialog = providedDialog || (useDefaultIds ? document.getElementById('giftWishPicker') : null);
  let source = 'room';
  let guards = [];
  let snapshot = null;
  let generation = 0;
  let controller;
  let role = createGiftCatalogRoleLookup(null);

  const picker = createGiftPickerDialog({
    dialog: hostDialog,
    title,
    optionClassName: 'gift-wish-option',
    ids: useDefaultIds
      ? {
          dialog: 'giftWishPicker',
          title: 'giftWishPickerTitle',
          search: 'giftWishSearch',
          results: 'giftWishResults',
          status: 'giftWishPickerStatus',
          close: 'giftWishPickerClose',
          refresh: 'giftWishRefreshGiftsBtn',
        }
      : {},
    sourceAttribute: 'wishSource',
    roomLabel: '本直播间',
    allLabel: '全部礼物',
    showRefresh,
    guardSubtitle,
    getRoleLabel: (gift) => role(gift),
    isDisabled: (gift) => requireVariant && !isGuardGift(gift) && !gift.variantId,
    onSelect(selected) {
      onSelect(selected);
      picker.close();
    },
    onSourceChange(nextSource) {
      void load(nextSource);
    },
    onRefresh() {
      void load('room');
    },
    onClose() {
      generation += 1;
      controller?.abort();
      picker.setRefreshing(false);
    },
  });

  function formatRoomSubtitle(data) {
    const roomId = String(data?.roomId || '').trim();
    if (!roomId) return '';
    return `直播间 ${roomId}`;
  }

  async function load(nextSource) {
    source = nextSource;
    const current = ++generation;
    controller?.abort();
    controller = new AbortController();
    snapshot = null;
    role = createGiftCatalogRoleLookup(null);
    picker.setSource(source);
    picker.setSubtitle(source === 'room' ? '' : '全量目录');
    const loadingText = source === 'room' ? '正在刷新本直播间在售礼物…' : '正在读取本机已收录的礼物…';
    picker.setFooterStatus(loadingText);
    picker.setRefreshing(source === 'room');
    picker.setItems({ message: loadingText });

    try {
      let data;
      let fallbackNotice = '';
      if (source === 'all') {
        data = await request('/api/overtime/gifts/catalog', undefined, controller.signal);
      } else {
        try {
          data = await request('/api/overtime/gifts/refresh', {}, controller.signal);
        } catch (error) {
          if (controller.signal.aborted || current !== generation) return;
          data = await request('/api/overtime/gifts', undefined, controller.signal);
          if (current === generation) {
            fallbackNotice = '在售列表刷新失败，暂时显示上次保存的列表。';
          }
        }
      }
      if (current !== generation) return;
      snapshot = data;
      role = createGiftCatalogRoleLookup(snapshot);
      if (Array.isArray(data?.guards)) guards = data.guards;
      const gifts = Array.isArray(data?.gifts) ? data.gifts : [];
      picker.setSourceCount(source, guards.length + gifts.length);
      picker.setSubtitle(source === 'room' ? formatRoomSubtitle(data) : '全量目录');

      if (!gifts.length && !guards.length) {
        const emptyStatus = '本机还没有这份礼物目录，请连接直播间后重新打开。';
        picker.setFooterStatus(emptyStatus);
        picker.setItems({ empty: emptyStatus });
        return;
      }

      picker.setFooterStatus(
        fallbackNotice ||
          `${source === 'room' ? '本直播间在售及盲盒产出' : '本机已收录'} · ${gifts.length} 款`,
      );
      picker.setItems({
        guards,
        gifts,
        empty: '没有匹配的礼物，试试其他名称或 ID。',
      });
    } catch (error) {
      if (current !== generation) return;
      const failure = `${error.message} 点击礼物范围可重试。`;
      picker.setFooterStatus(failure);
      picker.setItems({ message: failure, tone: 'error' });
    } finally {
      if (current === generation) picker.setRefreshing(false);
    }
  }

  return {
    open(nextGuards = []) {
      guards = Array.isArray(nextGuards) ? nextGuards : [];
      picker.open({ source: 'room' });
      void load('room');
    },
    close() {
      picker.close();
    },
    dispose() {
      generation += 1;
      controller?.abort();
      picker.dispose();
    },
  };
}
