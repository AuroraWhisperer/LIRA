import { createGiftWishFeed } from '../../shared/gift-wish-client.js';
import { renderHeartBoxCollection } from '../../shared/heart-box-collection.js';
import { HEART_COLLECTION_BACKGROUNDS } from '../../shared/heart-box-collection-appearance.js';
import { bindCopyUrl } from '../../shared/copy-url.js';
import { localOverlayOrigin, toast } from '../../shared/utils.js';
import { openComponentPreview } from '../component-preview-dialog.js';
import { createSharedSceneSettingsController } from '../shared-scene-settings-controller.js';

export function createHeartBoxCollection() {
  const get = (id) => document.getElementById(id);
  const preview = get('heartBoxCollectionPreviewCard');
  const status = get('heartBoxCollectionStatus');
  const error = get('heartBoxCollectionError');
  const rewards = get('heartBoxCollectionShowRewards');
  const background = get('heartBoxCollectionBackgroundStyle');
  background.replaceChildren(...Object.entries(HEART_COLLECTION_BACKGROUNDS)
    .map(([value, label]) => new Option(label, value)));
  const settings = createSharedSceneSettingsController('heart-box-collection');
  let currentData;
  const render = () => renderHeartBoxCollection(preview, currentData, {
    showRewards: rewards.checked, backgroundStyle: background.value,
  });
  const date = new Intl.DateTimeFormat('zh-CN', { timeZone: 'Asia/Shanghai', month: 'numeric', day: 'numeric' });
  const feed = createGiftWishFeed({
    path: '/api/gifts/heart-box-collection',
    onData(data) {
      currentData = data;
      render();
      get('heartBoxCollectionPeriod').textContent = `本期收集 · ${date.format(new Date(data.startsAt))}—${date.format(new Date(Date.parse(data.endsAt) - 1))}`;
      status.textContent = data.partial ? '礼物记录仍在同步，当前进度可能尚未完整。'
        : data.status === 'ended' ? '本期收集已结束，当前为最终进度。' : '正在自动更新本期进度。';
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
  address.textContent = `${localOverlayOrigin(location)}/heart-box-collection`;
  const saveState = get('heartBoxCollectionSaveState');
  const retry = get('heartBoxCollectionSaveRetry');
  const stopSettings = settings.controller.subscribe(state => {
    rewards.checked = state.draft.showRewards;
    rewards.disabled = !state.loaded;
    background.value = state.draft.backgroundStyle;
    background.disabled = !state.loaded;
    saveState.textContent = state.error ? '显示设置未保存，修改已保留，请重试。'
      : state.saving ? '正在保存…' : state.dirty ? '等待保存…' : '显示设置与画布同步。';
    retry.hidden = !state.error;
    render();
  });
  rewards.addEventListener('change', () => {
    settings.controller.edit({ showRewards: rewards.checked });
    void settings.save();
  });
  background.addEventListener('change', () => {
    settings.controller.edit({ backgroundStyle: background.value });
    void settings.save();
  });
  retry.addEventListener('click', () => { void settings.save(); });
  bindCopyUrl(address, { onCopied: () => toast('心动盲盒收集任务地址已复制') });
  get('heartBoxCollectionRefresh').addEventListener('click', () => feed.refresh());
  get('heartBoxCollectionPreview').addEventListener('click', () => openComponentPreview({ id: 'heart-box-collection' }));
  window.addEventListener('pagehide', () => { stopSettings(); settings.dispose(); }, { once: true });
  return { open: feed.start, close: feed.stop };
}
