import { copyText, localOverlayOrigin, toast } from '../../shared/utils.js';
import {
  createGiftWishCard,
  WISH_PERIODS,
  WISH_CATEGORIES,
  DEFAULT_WISH_TEXT,
  formatGiftWishText,
} from '../../shared/gift-wish-card.js';
import { createGiftWishFeed, requestGiftWish } from '../../shared/gift-wish-client.js';
import { setGiftImage } from '../../shared/gift-image-fallback.js';
import { createWishPicker } from './wish-picker.js';
import { eventBus, Events } from '../../shared/event-bus.js';

const PERIOD_HINTS = {
  long: '每条许愿从创建时开始，跨天、跨直播持续累计。',
  day: '统计北京时间今天已捕获的礼物，次日零点自动重新计数。',
  session: '统计 B 站本次开播以来已捕获的礼物，未开播时等待，开播后重新计数。',
};

export function createGiftWishes() {
  const get = (id) => document.getElementById(id);
  if (!get('giftWishesPanel')) return { open() {}, close() {} };
  let period = 'long';
  let snapshot = null;
  let revision = null;
  let selected = null;
  let editing = null;
  let busy = false;
  let signature = '';
  let feedError = false;
  const fail = (error) => {
    get('giftWishError').textContent = error.message;
  };
  const picker = createWishPicker((gift) => {
    selected = gift;
    showSelected();
  });
  const feed = createGiftWishFeed({
    onData(data) {
      if (feedError) {
        get('giftWishError').textContent = '';
        feedError = false;
      }
      if (snapshot && data.viewRevision !== snapshot.viewRevision) resetEditor();
      snapshot = data;
      revision = data.viewRevision;
      get('giftWishFields').disabled = busy;
      render();
    },
    onError(error) {
      feedError = true;
      get('giftWishStatus').textContent = '';
      if (['GIFT_SOURCE_UNAVAILABLE', 'GIFT_VIEW_STALE'].includes(error.code)) {
        snapshot = null;
        resetEditor();
        get('giftWishFields').disabled = true;
        get('giftWishCards').replaceChildren();
        get('giftWishEmpty').hidden = true;
        signature = '';
      }
      fail(error);
    },
  });

  function showSelected() {
    get('giftWishSelectedName').textContent = selected?.name || '选择心愿礼物';
    const image = get('giftWishSelectedImage');
    if (selected) setGiftImage(image, selected.imagePath);
    else image.hidden = true;
    get('giftWishSelectedRole').textContent = selected
      ? `${WISH_CATEGORIES[selected.giftCategory] || '礼物'} · ${selected.id}`
      : '可选直播间在售礼物、盲盒本体及产出，或全部缓存礼物。';
    updateTextPreview();
  }

  function updateTextPreview() {
    get('giftWishTextFields').hidden = get('giftWishDisplayStyle').value !== 'text';
    get('giftWishTextPreview').textContent = formatGiftWishText({
      giftName: selected?.name || '礼物',
      count: snapshot?.items.find((wish) => wish.id === editing)?.count || 0,
      target: get('giftWishTarget').value || 10,
      textTemplate: get('giftWishTextTemplate').value,
    });
  }

  function resetEditor() {
    editing = null;
    selected = null;
    picker.close();
    get('giftWishForm').reset();
    get('giftWishTextTemplate').value = DEFAULT_WISH_TEXT;
    get('giftWishPick').disabled = false;
    get('giftWishCancel').hidden = true;
    get('giftWishEditorTitle').textContent = '许一个小心愿';
    get('giftWishSave').textContent = '添加许愿';
    showSelected();
  }

  function edit(wish) {
    editing = wish.id;
    selected = {
      id: wish.giftId,
      name: wish.giftName,
      imagePath: wish.imagePath,
      giftCategory: wish.giftCategory,
    };
    showSelected();
    get('giftWishPick').disabled = true;
    get('giftWishTarget').value = wish.target;
    get('giftWishLabel').value = wish.label;
    get('giftWishDisplayStyle').value = wish.displayStyle || 'card';
    get('giftWishTextTemplate').value = wish.textTemplate || DEFAULT_WISH_TEXT;
    updateTextPreview();
    get('giftWishCancel').hidden = false;
    get('giftWishEditorTitle').textContent = '编辑这份心愿';
    get('giftWishSave').textContent = '保存修改';
    get('giftWishTarget').focus();
    get('giftWishForm').scrollIntoView({ block: 'nearest' });
  }

  function render() {
    if (!snapshot) return;
    const items = snapshot.items.filter((wish) => wish.period === period);
    const status = [];
    if (snapshot.partial) status.push('礼物流水正在同步，进度可能尚未完整。');
    if (period === 'session') {
      const session = snapshot.session;
      if (session.stale) status.push('开播状态暂未确认，已暂停本场计数，稍后自动重试。');
      else if (session.state === 'offline') status.push('还未开播，心愿会在开播后开始计数。');
      else if (session.startedAt)
        status.push(
          `本场开播于 ${new Date(session.startedAt).toLocaleString('zh-CN', { timeZone: 'Asia/Shanghai', hour12: false })}`,
        );
    }
    get('giftWishStatus').textContent = status.join(' ');
    updateTextPreview();
    get('giftWishEmpty').hidden = items.length > 0;
    const nextSignature = JSON.stringify(items);
    if (signature === nextSignature) return;
    signature = nextSignature;
    const nodes = items.map((wish) => {
      const wrapper = document.createElement('div');
      wrapper.className = 'gift-wish-item';
      wrapper.append(createGiftWishCard(wish));
      const actions = document.createElement('div');
      actions.className = 'gift-wish-item-actions';
      const modify = document.createElement('button');
      modify.type = 'button';
      modify.textContent = '编辑';
      modify.addEventListener('click', () => {
        if (!busy) edit(wish);
      });
      const remove = document.createElement('button');
      remove.type = 'button';
      remove.textContent = '删除';
      remove.addEventListener('click', () => {
        if (busy) return;
        if (remove.dataset.confirm !== 'true') {
          remove.dataset.confirm = 'true';
          remove.textContent = '确认删除';
          return;
        }
        mutate('/api/gifts/wishes/delete', { id: wish.id }, '许愿已删除');
      });
      actions.append(modify, remove);
      wrapper.append(actions);
      return wrapper;
    });
    get('giftWishCards').replaceChildren(...nodes);
  }

  function selectPeriod(value) {
    if (busy) return;
    period = value;
    resetEditor();
    get('giftWishesPanel')
      .querySelectorAll('[data-wish-period]')
      .forEach((button) => button.setAttribute('aria-pressed', String(button.dataset.wishPeriod === period)));
    get('giftWishPeriodHint').textContent = PERIOD_HINTS[period];
    const url = `${localOverlayOrigin(location)}/gift-wishes?period=${period}`;
    get('giftWishUrl').value = url;
    get('giftWishPreview').href = `${url}&preview=1`;
    get('giftWishSourceHint').textContent = `OBS 浏览器源 · ${WISH_PERIODS[period]}`;
    get('giftWishError').textContent = '';
    signature = '';
    render();
  }

  async function mutate(path, body, message) {
    if (busy || !snapshot) return;
    busy = true;
    get('giftWishFields').disabled = true;
    get('giftWishError').textContent = '';
    try {
      await requestGiftWish(path, {
        ...body,
        viewRevision: snapshot.viewRevision,
      });
      resetEditor();
      toast(message);
      await feed.refresh();
    } catch (error) {
      fail(error);
    } finally {
      busy = false;
      get('giftWishFields').disabled = !snapshot;
    }
  }

  get('giftWishForm').addEventListener('submit', (event) => {
    event.preventDefault();
    if (!selected) {
      fail(new Error('请先选择一份心愿礼物。'));
      return;
    }
    const target = Number(get('giftWishTarget').value);
    if (!Number.isSafeInteger(target) || target < 1 || target > 999999999) {
      fail(new Error('目标数量必须是 1–999999999 的整数。'));
      return;
    }
    mutate(
      '/api/gifts/wishes/save',
      {
        ...(editing ? { id: editing } : { period, giftKey: selected.variantId || String(selected.id) }),
        target,
        label: get('giftWishLabel').value,
        displayStyle: get('giftWishDisplayStyle').value,
        textTemplate: get('giftWishTextTemplate').value,
      },
      editing ? '许愿已更新' : '小心愿已加入，开始收集吧',
    );
  });
  get('giftWishPick').addEventListener('click', () => picker.open(snapshot?.guards || []));
  get('giftWishCancel').addEventListener('click', resetEditor);
  get('giftWishDisplayStyle').addEventListener('change', updateTextPreview);
  get('giftWishTextTemplate').addEventListener('input', updateTextPreview);
  get('giftWishTarget').addEventListener('input', updateTextPreview);
  get('giftWishTextFields')
    .querySelectorAll('[data-wish-token]')
    .forEach((button) => {
      button.addEventListener('click', () => {
        const input = get('giftWishTextTemplate');
        input.setRangeText(button.dataset.wishToken, input.selectionStart, input.selectionEnd, 'end');
        input.focus();
        updateTextPreview();
      });
    });
  get('giftWishesRefresh').addEventListener('click', () => {
    get('giftWishError').textContent = '';
    feed.refresh();
  });
  get('giftWishCopy').addEventListener('click', () =>
    copyText(get('giftWishUrl').value)
      .then(() => toast('许愿地址已复制'))
      .catch(fail),
  );
  get('giftWishesPanel')
    .querySelectorAll('[data-wish-period]')
    .forEach((button) => button.addEventListener('click', () => selectPeriod(button.dataset.wishPeriod)));
  selectPeriod(period);
  const unsubscribe = eventBus.on(Events.STATE_LOADED, ({ state }) => {
    if (!state?.gifts || state.gifts.viewRevision === revision) return;
    revision = state.gifts.viewRevision;
    snapshot = null;
    resetEditor();
    get('giftWishFields').disabled = true;
    get('giftWishCards').replaceChildren();
    get('giftWishEmpty').hidden = true;
    signature = '';
    feed.refresh();
  });
  window.addEventListener('pagehide', () => {
    feed.stop();
    picker.close();
    unsubscribe?.();
  });
  return {
    open() {
      return feed.start();
    },
    close() {
      feed.stop();
      picker.close();
    },
  };
}
