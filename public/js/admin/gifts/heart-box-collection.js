import { createGiftWishFeed } from '../../shared/gift-wish-client.js';
import { renderHeartBoxCollection } from '../../shared/heart-box-collection.js';
import { bindCopyUrl } from '../../shared/copy-url.js';
import { localOverlayOrigin, toast } from '../../shared/utils.js';
import { openComponentPreview } from '../component-preview-dialog.js';

export function createHeartBoxCollection() {
  const get = (id) => document.getElementById(id);
  const preview = get('heartBoxCollectionPreviewCard');
  const status = get('heartBoxCollectionStatus');
  const error = get('heartBoxCollectionError');
  const rewards = get('heartBoxCollectionShowRewards');
  let currentData;
  const render = () => renderHeartBoxCollection(preview, currentData, { showRewards: rewards.checked });
  const date = new Intl.DateTimeFormat('zh-CN', { timeZone: 'Asia/Shanghai', month: 'numeric', day: 'numeric' });
  const feed = createGiftWishFeed({
    path: '/api/gifts/heart-box-collection',
    onData(data) {
      currentData = data;
      render();
      get('heartBoxCollectionPeriod').textContent = `本期收集 · ${date.format(new Date(data.startsAt))}—${date.format(new Date(Date.parse(data.endsAt) - 1))}`;
      status.textContent = data.partial ? '礼物记录仍在同步，当前进度可能尚未完整。'
        : data.status === 'ended' ? '本期收集已结束，下面显示最终进度。' : '正在自动更新本期进度。';
      error.hidden = true;
    },
    onError(value) {
      if (['GIFT_SOURCE_UNAVAILABLE', 'GIFT_VIEW_STALE'].includes(value.code)) {
        currentData = null;
        render();
        get('heartBoxCollectionPeriod').textContent = '本期收集';
      }
      status.textContent = '';
      error.textContent = value.message;
      error.hidden = false;
    },
  });
  const address = get('heartBoxCollectionUrl');
  const updateAddress = () => {
    address.textContent = `${localOverlayOrigin(location)}/heart-box-collection${rewards.checked ? '' : '?showRewards=false'}`;
  };
  updateAddress();
  rewards.addEventListener('change', () => { render(); updateAddress(); });
  bindCopyUrl(address, { onCopied: () => toast('心动盲盒收集任务地址已复制') });
  get('heartBoxCollectionRefresh').addEventListener('click', () => feed.refresh());
  get('heartBoxCollectionPreview').addEventListener('click', () => openComponentPreview({ id: 'heart-box-collection' }));
  return { open: feed.start, close: feed.stop };
}
