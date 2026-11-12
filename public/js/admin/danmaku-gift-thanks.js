import { createGiftThanksTextEditor } from './gift-thanks-text-editor.js';
import { createGiftThanksLibrary } from './gift-thanks-library.js';
import { DEFAULT_GIFT_THANKS_TEMPLATES, normalizeGiftThanksTemplates, renderGiftThanksTemplate,
  createGiftThanksReplies, normalizeGiftThanksReplies } from '../shared/gift-thanks-templates.js';

const SAMPLES = {
  paid: { name: '小明', gifts: ['人气票×1'], amount: '共1电池', amountBlocks: ['共1电池'] },
  free: { name: '小明', gifts: ['辣条×5'], amount: '', amountBlocks: [] },
  blind: { name: '舰长 小明', gifts: ['爱心×2'], amount: '开出30电池（+10电池）', amountBlocks: ['开出30电池', '差额+10电池'] },
  guard: { name: '小明', gifts: ['舰长×1'], amount: '共1980电池', amountBlocks: ['共1980电池'] },
};

export function initDanmakuGiftThanks({
  documentRef = globalThis.document, windowRef = globalThis.window,
  bridge = windowRef?.liraLicense, toast = () => {},
} = {}) {
  const get = id => documentRef.getElementById(id);
  const form = get('danmakuGiftThanksPanel');
  if (!form) return null;
  const fields = get('danmakuGiftThanksFields');
  const status = get('danmakuGiftThanksSaveState');
  const save = get('danmakuGiftThanksSave');
  const open = documentRef.querySelector('[data-fixed-open="thanks"]');
  const sample = get('danmakuGiftThanksSample');
  const lifetime = new AbortController();
  let snapshot = {}, saved = null, owner = '', generation = 0, pending = false, dirty = false, valid = false, disposed = false, accountKnown = false;
  let advanced = false;
  const libraryRoot = get('danmakuGiftThanksLibrary');
  const library = createGiftThanksLibrary(libraryRoot, changed);
  const editors = Object.fromEntries(['gift', 'guard'].map(kind => [kind,
    createGiftThanksTextEditor(get(`danmakuThanks${kind}Editor`), changed)]));
  const values = () => advanced ? library.read() : Object.fromEntries(Object.entries(editors).map(([kind, editor]) => [kind, editor.read()]));
  const listen = (element, type, handler) => element.addEventListener(type, handler, { signal: lifetime.signal });

  function controls() {
    const supported = advanced ? snapshot.replies && bridge?.setGiftThanksReplies : snapshot.templates && bridge?.setGiftThanksTemplates;
    const disabled = !owner || !supported || snapshot.status !== 'confirmed' || pending;
    fields.disabled = disabled;
    Object.values(editors).forEach(editor => editor.setDisabled(disabled));
    library.setDisabled(disabled);
    const draft = values();
    for (const button of form.querySelectorAll('button[data-thanks-kind]')) {
      if (advanced) continue;
      const exists = draft[button.dataset.thanksKind].includes(button.dataset.thanksToken);
      button.disabled = disabled || exists;
      button.title = exists ? '文案中已有此参数块，可选中后剪切并粘贴到新位置。' : '补回此参数块';
    }
    open.disabled = !owner;
    save.disabled = disabled || !dirty || !valid;
  }
  function preview() {
    if (advanced) {
      valid = library.validate();
      controls();
      return;
    }
    const draft = values();
    valid = true;
    try { normalizeGiftThanksTemplates(draft); } catch { valid = false; }
    let fitsExamples = true;
    for (const kind of ['gift', 'guard']) {
      const output = get(`danmakuThanks${kind}Preview`);
      const example = kind === 'guard' ? SAMPLES.guard : SAMPLES[sample.value];
      const segments = valid ? renderGiftThanksTemplate(draft[kind], example) : null;
      fitsExamples = fitsExamples && Boolean(segments);
      output.textContent = segments ? segments.join('\n') : '请保留三个参数块，文案不超过 120 字，并缩短过长的文字。';
      get(`danmakuThanks${kind}Editor`).setAttribute('aria-invalid', String(!valid || !segments));
    }
    valid = valid && fitsExamples;
    controls();
  }
  function load(value) {
    libraryRoot.hidden = !advanced;
    get('danmakuGiftThanksLegacy').hidden = advanced;
    get('danmakuGiftThanksLegacyHelp').hidden = advanced;
    if (advanced) library.setValue(value);
    else for (const kind of ['gift', 'guard']) editors[kind].setValue(value[kind]);
    preview();
  }
  function changed() {
    dirty = !saved || JSON.stringify(values()) !== JSON.stringify(saved);
    status.textContent = dirty ? '有未保存的更改' : '';
    preview();
  }
  function updateState(value) {
    if (disposed || (accountKnown && !owner)) return;
    snapshot = value;
    if (!bridge?.setGiftThanksTemplates) {
      status.textContent = '请重启或升级桌面客户端后编辑答谢文案。';
    } else if (value.templates) {
      const previous = saved;
      const useLibrary = Boolean(value.replies && bridge?.setGiftThanksReplies);
      const modeChanged = !dirty && !pending && advanced !== useLibrary;
      if (modeChanged) advanced = useLibrary;
      saved = structuredClone(advanced ? value.replies : value.templates);
      if (!dirty && !pending && (modeChanged || JSON.stringify(previous) !== JSON.stringify(saved))) {
        load(saved);
        status.textContent = '';
      }
    } else if (value.status === 'confirmed') {
      status.textContent = '当前服务器暂不支持自定义答谢文案，请升级服务器。';
    }
    controls();
  }
  function account(value) {
    if (disposed) return;
    accountKnown = true;
    const next = value?.state === 'authorized' && value.streamer?.accountName ? value.streamer.accountName : '';
    if (next === owner) return;
    const reset = Boolean(owner) || !next;
    owner = next;
    generation++;
    if (reset) {
      snapshot = {};
      saved = null;
      pending = dirty = false;
      advanced = false;
      library.setValue(createGiftThanksReplies());
      load(DEFAULT_GIFT_THANKS_TEMPLATES);
    }
    status.textContent = owner ? saved ? '' : '正在读取云端文案…' : '连接 LIRA 账号后可设置';
    controls();
  }
  for (const button of form.querySelectorAll('button[data-thanks-kind]')) {
    listen(button, 'click', () => editors[button.dataset.thanksKind].insert(button.dataset.thanksToken));
  }
  listen(sample, 'change', preview);
  listen(get('danmakuGiftThanksReset'), 'click', () => {
    load(advanced ? createGiftThanksReplies() : DEFAULT_GIFT_THANKS_TEMPLATES);
    changed();
  });
  listen(form, 'submit', async event => {
    event.preventDefault();
    if (save.disabled) return;
    const templates = advanced ? normalizeGiftThanksReplies(values()) : normalizeGiftThanksTemplates(values());
    const requested = generation;
    pending = true;
    status.textContent = '正在保存文案…';
    controls();
    try {
      const result = await (advanced ? bridge.setGiftThanksReplies(templates) : bridge.setGiftThanksTemplates(templates));
      if (disposed || requested !== generation) return;
      updateState(result);
      if (!result.ok || result.status !== 'confirmed' || JSON.stringify(advanced ? result.replies : result.templates) !== JSON.stringify(templates)) {
        throw new Error('保存尚未确认，请刷新云端状态后重试；草稿已保留。');
      }
      saved = structuredClone(templates);
      dirty = false;
      status.textContent = '文案已保存到云端';
    } catch (error) {
      if (!disposed && requested === generation) {
        status.textContent = error.message || '保存失败，草稿已保留。';
        toast(status.textContent, { type: 'error' });
      }
    } finally {
      if (!disposed && requested === generation) {
        pending = false;
        controls();
      }
    }
  });
  load(DEFAULT_GIFT_THANKS_TEMPLATES);
  const unsubscribe = bridge?.onStateChanged?.(account);
  const initial = generation;
  Promise.resolve(bridge?.getState?.()).then(value => {
    if (initial === generation) account(value);
  }).catch(() => {
    if (!disposed && initial === generation) status.textContent = '账号信息读取失败，请刷新云端状态。';
  });
  windowRef.addEventListener('pagehide', () => {
    disposed = true;
    generation++;
    lifetime.abort();
    unsubscribe?.();
    Object.values(editors).forEach(editor => editor.dispose());
    library.dispose();
  }, { once: true });
  return { updateState };
}
