import { copyText, localOverlayOrigin, toast } from '../../shared/utils.js';
import { openComponentPreview } from '../component-preview-dialog.js';
import {
  createGiftWishCard,
  getGiftWishTextTemplate,
  DEFAULT_WISH_TEXT,
  DEFAULT_WISH_TEXT_COLORS,
} from '../../shared/gift-wish-card.js';
import { createGiftWishFeed, requestGiftWish } from '../../shared/gift-wish-client.js';
import { setGiftImage } from '../../shared/gift-image-fallback.js';
import { createWishPicker } from './wish-picker.js';
import { createWishTextEditor } from './wish-text-editor.js';
import { createWishStylePreview } from './wish-style-preview.js';
import { eventBus, Events } from '../../shared/event-bus.js';
import { showConfirmationDialog } from '../../shared/confirmation-dialog.js';

const PERIOD_HINTS = {
  long: '从创建时开始累计，不重置。',
  day: '统计当天已捕获的礼物，北京时间零点重置。',
  session: '统计本次开播以来已捕获的礼物，下次开播重置。',
};

export function createGiftWishes() {
  const get = (id) => document.getElementById(id);
  if (!get('giftWishesPanel')) return { open() {}, close() {} };
  const textEditor = createWishTextEditor(get('giftWishTextEditor'), get('giftWishTextTemplate'));
  const stylePreview = createWishStylePreview(get('giftWishDraftPreview'));
  let importedStyle = null;
  let builtinStyle = 'card';
  let period = 'long';
  let snapshot = null;
  let revision = null;
  let selected = null;
  let editing = null;
  let busy = false;
  let signature = '';
  let feedError = false;
  let savedForm = '';
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
      setEditorDisabled(busy);
      render();
    },
    onError(error) {
      feedError = true;
      get('giftWishStatus').textContent = '';
      if (['GIFT_SOURCE_UNAVAILABLE', 'GIFT_VIEW_STALE'].includes(error.code)) {
        snapshot = null;
        resetEditor();
        setEditorDisabled(true);
        get('giftWishCards').replaceChildren();
        get('giftWishEmpty').hidden = true;
        signature = '';
      }
      fail(error);
    },
  });

  function setEditorDisabled(value) {
    get('giftWishFields').disabled = value;
    get('giftWishPeriod').disabled = busy;
    textEditor.setDisabled(value);
  }

  function showSelected() {
    get('giftWishSelectedName').textContent = selected?.name || '选个礼物';
    const image = get('giftWishSelectedImage');
    if (selected) setGiftImage(image, selected.imagePath);
    else {
      image.src = '/img/admin/nav-icons/nav-gift.webp';
      image.hidden = false;
    }
    updateDraftPreview();
  }

  function getDisplayStyle() {
    return get('giftWishDisplayStyle').querySelector('input:checked')?.value || builtinStyle;
  }

  function updateDraftPreview() {
    const displayStyle = importedStyle ? 'imported' : getDisplayStyle();
    const saved = snapshot?.items.find((wish) => wish.id === editing);
    const count = saved?.count || 0;
    const textTemplate = get('giftWishTextTemplate').value;
    const targetInput = get('giftWishTarget');
    const target = targetInput.validity.valid ? targetInput.valueAsNumber : 10;
    textEditor.setContext({ giftName: selected?.name || '未选择', count, target });
    get('giftWishTextFields').hidden = displayStyle !== 'text';
    get('giftWishEditorGrid').classList.toggle('is-text', displayStyle === 'text');
    get('giftWishImageFields').hidden = displayStyle !== 'text' || !textTemplate.includes('{图片}');
    get('giftWishColorFields').hidden = displayStyle !== 'text';
    get('giftWishPreviewStateField').hidden = displayStyle !== 'text';
    const wish = {
      id: 'draft',
      period,
      giftName: selected?.name || '礼物',
      imagePath: selected ? selected.imagePath : '/img/admin/nav-icons/nav-gift.webp',
      count,
      todayCount: get('giftWishPreviewState').value === 'received' ? 1 : 0,
      target,
      progress: Math.min(100, (count / target) * 100),
      completed: count >= target,
      displayStyle: getDisplayStyle(),
      textTemplate,
      textImageFormat: get('giftWishTextImageFormat').value,
      textPendingColor: get('giftWishTextPendingColor').value,
      textReceivedColor: get('giftWishTextReceivedColor').value,
    };
    if (importedStyle) stylePreview.update(importedStyle, wish);
    else get('giftWishDraftPreview').replaceChildren(createGiftWishCard(wish));
  }

  function resetTextColors() {
    get('giftWishTextPendingColor').value = DEFAULT_WISH_TEXT_COLORS.pending;
    get('giftWishTextReceivedColor').value = DEFAULT_WISH_TEXT_COLORS.received;
  }

  function readWishForm() {
    return JSON.stringify([
      selected?.variantId || selected?.id || '', getDisplayStyle(),
      ...['giftWishTarget', 'giftWishLabel', 'giftWishTextTemplate', 'giftWishTextImageFormat',
        'giftWishTextPendingColor', 'giftWishTextReceivedColor'].map((id) => get(id).value),
    ]);
  }

  async function confirmDiscard() {
    if (!savedForm || readWishForm() === savedForm) return true;
    return showConfirmationDialog({
      variant: 'caution',
      title: '放弃未保存的许愿修改？',
      description: '当前表单中尚未保存的内容将会丢失。',
      confirmLabel: '放弃修改',
      cancelLabel: '继续编辑',
      initialFocus: 'cancel',
    });
  }

  function resetEditor() {
    selectImportedStyle(null);
    editing = null;
    selected = null;
    picker.close();
    get('giftWishForm').reset();
    resetTextColors();
    textEditor.setValue(DEFAULT_WISH_TEXT);
    get('giftWishPick').disabled = false;
    get('giftWishCancel').hidden = true;
    get('giftWishSave').textContent = '添加许愿';
    showSelected();
    savedForm = readWishForm();
  }

  function edit(wish) {
    selectImportedStyle(null);
    editing = wish.id;
    selected = {
      id: wish.giftId,
      name: wish.giftName,
      imagePath: wish.imagePath,
      giftCategory: wish.giftCategory,
    };
    get('giftWishPick').disabled = true;
    get('giftWishTarget').value = wish.target;
    get('giftWishLabel').value = wish.label;
    get('giftWishDisplayStyle')
      .querySelectorAll('input')
      .forEach((input) => {
        input.checked = input.value === (wish.displayStyle || 'card');
      });
    textEditor.setValue(getGiftWishTextTemplate(wish));
    get('giftWishTextImageFormat').value = wish.textImageFormat || 'animated';
    get('giftWishTextPendingColor').value = wish.textPendingColor || DEFAULT_WISH_TEXT_COLORS.pending;
    get('giftWishTextReceivedColor').value = wish.textReceivedColor || DEFAULT_WISH_TEXT_COLORS.received;
    get('giftWishPreviewState').value = wish.todayCount > 0 ? 'received' : 'pending';
    showSelected();
    get('giftWishCancel').hidden = false;
    get('giftWishSave').textContent = '保存修改';
    savedForm = readWishForm();
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
    updateDraftPreview();
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
      modify.addEventListener('click', async () => {
        if (busy || editing === wish.id) return;
        const viewRevision = snapshot?.viewRevision;
        if (!await confirmDiscard() || busy || snapshot?.viewRevision !== viewRevision) return;
        const current = snapshot?.items.find((item) => item.id === wish.id);
        if (current) edit(current);
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
    get('giftWishPeriod').value = period;
    get('giftWishPeriodHint').textContent = PERIOD_HINTS[period];
    get('giftWishError').textContent = '';
    signature = '';
    render();
  }

  async function mutate(path, body, message) {
    if (busy || !snapshot) return;
    busy = true;
    setEditorDisabled(true);
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
      setEditorDisabled(!snapshot);
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
    if ([...get('giftWishTextTemplate').value].length > 240) {
      fail(new Error('展示文字最多 240 字，请缩短后再保存。'));
      get('giftWishTextEditor').focus();
      return;
    }
    mutate(
      '/api/gifts/wishes/save',
      {
        ...(editing ? { id: editing } : { period, giftKey: selected.variantId || String(selected.id) }),
        target,
        label: get('giftWishLabel').value,
        displayStyle: getDisplayStyle(),
        textTemplate: get('giftWishTextTemplate').value,
        textImagePosition: 'none',
        textImageFormat: get('giftWishTextImageFormat').value,
        textPendingColor: get('giftWishTextPendingColor').value,
        textReceivedColor: get('giftWishTextReceivedColor').value,
      },
      editing ? '许愿已更新' : '许愿已添加',
    );
  });
  get('giftWishPick').addEventListener('click', () => picker.open(snapshot?.guards || []));
  get('giftWishCancel').addEventListener('click', resetEditor);
  function selectImportedStyle(style) {
    builtinStyle = getDisplayStyle();
    importedStyle = style;
    const field = get('giftWishDisplayStyle');
    field.dataset.previewStyleId = style?.id || '';
    for (const input of field.querySelectorAll('input[type="radio"]')) {
      input.checked = !style && input.value === builtinStyle;
    }
    for (const button of field.querySelectorAll('.component-style-select')) {
      button.setAttribute('aria-pressed', String(button.closest('[data-custom-style-id]').dataset.customStyleId === style?.id));
    }
    if (!style) stylePreview.clear();
  }
  get('giftWishDisplayStyle').addEventListener('gift-wish:style', event => { selectImportedStyle(event.detail); updateDraftPreview(); });
  get('giftWishDisplayStyle').addEventListener('change', () => { selectImportedStyle(null); updateDraftPreview(); });
  get('giftWishTextTemplate').addEventListener('input', updateDraftPreview);
  get('giftWishImageFields').addEventListener('change', updateDraftPreview);
  get('giftWishColorFields').addEventListener('input', updateDraftPreview);
  get('giftWishPreviewState').addEventListener('change', updateDraftPreview);
  get('giftWishResetColors').addEventListener('click', () => {
    resetTextColors();
    updateDraftPreview();
  });
  get('giftWishTarget').addEventListener('input', updateDraftPreview);
  get('giftWishTextFields')
    .querySelectorAll('[data-wish-token]')
    .forEach((button) => {
      button.addEventListener('click', () => {
        textEditor.insert(button.dataset.wishToken);
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
  get('giftWishPeriod').addEventListener('change', async (event) => {
    const next = event.target.value;
    event.target.value = period;
    if (next !== period && await confirmDiscard()) selectPeriod(next);
  });
  const url = `${localOverlayOrigin(location)}/gift-wishes`;
  get('giftWishUrl').value = url;
  get('giftWishPreview').addEventListener('click', () => openComponentPreview({ id: 'gift-wishes' }));
  selectPeriod(period);
  const unsubscribe = eventBus.on(Events.STATE_LOADED, ({ state }) => {
    if (!state?.gifts || state.gifts.viewRevision === revision) return;
    revision = state.gifts.viewRevision;
    snapshot = null;
    resetEditor();
    setEditorDisabled(true);
    get('giftWishCards').replaceChildren();
    get('giftWishEmpty').hidden = true;
    signature = '';
    feed.refresh();
  });
  window.addEventListener('pagehide', () => {
    stylePreview.dispose();
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
      if (importedStyle) stylePreview.clear();
    },
  };
}
