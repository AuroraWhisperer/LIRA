import { createCustomReplyEditor } from './danmaku-libraries.js';
import { createScheduledLibraryEditor } from './danmaku-scheduled-library.js';

export function initDanmakuCloudReplies({
  documentRef = globalThis.document,
  windowRef = globalThis.window,
  bridge = windowRef?.liraLicense,
  toast = () => {},
} = {}) {
  const get = (id) => documentRef.getElementById(id);
  const exactToggle = get('danmakuExactReplyToggle');
  const scheduledToggle = get('danmakuScheduledToggle');
  const form = get('danmakuScheduledPanel');
  if (!exactToggle || !scheduledToggle || !form) return;
  const exactState = get('danmakuExactState');
  const scheduledState = get('danmakuScheduledState');
  const saveState = get('danmakuScheduledSaveState');
  const save = get('danmakuScheduledSave');
  const mode = get('danmakuScheduledMode');
  const interval = get('danmakuScheduledInterval');
  const min = get('danmakuScheduledMin');
  const max = get('danmakuScheduledMax');
  const selection = get('danmakuScheduledSelection');
  const library = createScheduledLibraryEditor({ documentRef, changed: () => markDirty() });
  const available = Boolean(bridge?.getFixedReplySettings && bridge?.updateFixedReplySettings);
  let owner = '', generation = 0, saved = null, pending = false, dirty = false, disposed = false;
  const exactEditor = createCustomReplyEditor({
    document: documentRef, kind: 'exact', toast,
    saveSetting: async (_key, value) => {
      await sync({ customExactReplies: JSON.parse(value).map(({ keyword, reply }) => ({ trigger: keyword, reply })) });
    },
  });

  function controls() {
    const disabled = !owner || !available || !saved || pending;
    exactToggle.checked = saved?.customExactReplyEnabled === true;
    scheduledToggle.checked = saved?.scheduledDanmakuEnabled === true;
    exactToggle.disabled = scheduledToggle.disabled = disabled;
    get('danmakuExactFields').disabled = get('danmakuScheduledFields').disabled = disabled;
    for (const kind of ['exact', 'scheduled']) {
      documentRef.querySelector(`[data-fixed-open="${kind}"]`).disabled = !owner || !available || !saved;
    }
    save.disabled = disabled || !dirty;
  }

  function timingFields() {
    const random = mode.value === 'random';
    get('danmakuScheduledFixedField').hidden = random;
    get('danmakuScheduledMinField').hidden = get('danmakuScheduledMaxField').hidden = !random;
    interval.disabled = random;
    min.disabled = max.disabled = !random;
  }

  function render() {
    if (!saved) return;
    const schedule = saved.scheduledDanmaku;
    exactEditor.load(JSON.stringify(saved.customExactReplies.map(({ trigger, reply }) => ({ keyword: trigger, reply }))));
    if (!dirty) {
      mode.value = schedule.mode;
      interval.value = schedule.intervalSeconds;
      min.value = schedule.minSeconds;
      max.value = schedule.maxSeconds;
      selection.value = schedule.selection;
      library.load(schedule.messages);
      timingFields();
    }
    exactState.textContent = `${saved.customExactReplies.length} 条自定义`;
    get('danmakuScheduledSummary').textContent = schedule.mode === 'random'
      ? `随机 ${schedule.minSeconds}–${schedule.maxSeconds} 秒 · ${schedule.messages.length} 条`
      : `每 ${schedule.intervalSeconds} 秒 · ${schedule.messages.length} 条`;
    scheduledState.textContent = !schedule.messages.length ? '添加词库后才会发送' : '';
  }

  function failure(result) {
    if (result?.error === 'FIXED_REPLY_UNSUPPORTED') return '当前服务暂不支持完整匹配回复，请联系管理员。';
    if (result?.error === 'INVALID_FIXED_REPLY_SETTINGS') return '设置无效：请检查重复或保留触发词、字数及秒数范围。';
    return result?.message || '云端设置未确认，请检查连接并刷新。';
  }

  async function sync(patch) {
    const writing = Boolean(patch);
    if (!owner || !available || disposed || pending || (writing && !saved)) {
      if (writing) throw new Error('当前不能保存，请刷新云端状态后重试。');
      return;
    }
    const requested = generation;
    pending = true;
    controls();
    try {
      const result = writing ? await bridge.updateFixedReplySettings(patch) : await bridge.getFixedReplySettings();
      if (disposed || generation !== requested) throw new Error('账号已变化，请重新读取设置。');
      if (result?.ok !== true || !Array.isArray(result.customExactReplies) || !Array.isArray(result.scheduledDanmaku?.messages)) {
        throw new Error(failure(result));
      }
      saved = result;
      render();
      return result;
    } catch (error) {
      if (!disposed && generation === requested) {
        exactState.textContent = scheduledState.textContent = writing
          ? '更改尚未确认，请刷新核对云端状态。' : error.message;
      }
      if (writing) throw error;
    } finally {
      if (!disposed && generation === requested) {
        pending = false;
        controls();
      }
    }
  }

  for (const [toggle, key, name] of [
    [exactToggle, 'customExactReplyEnabled', '完整匹配回复'],
    [scheduledToggle, 'scheduledDanmakuEnabled', '定时／随机弹幕'],
  ]) {
    toggle.addEventListener('change', async () => {
      const value = toggle.checked;
      const requested = generation;
      try {
        await sync({ [key]: value });
        if (generation === requested && !disposed) toast(`${name}已${value ? '开启' : '关闭'}`);
      } catch (error) {
        if (generation === requested && !disposed) toast(error.message, { type: 'error' });
      }
    });
  }

  const markDirty = () => {
    dirty = true;
    saveState.textContent = '有尚未保存的更改';
    max.setCustomValidity('');
    controls();
  };
  for (const field of [mode, interval, min, max, selection]) {
    field.addEventListener('input', markDirty);
    field.addEventListener('change', markDirty);
  }
  mode.addEventListener('change', timingFields);
  form.addEventListener('submit', async (event) => {
    event.preventDefault();
    if (mode.value === 'random' && Number(min.value) > Number(max.value)) {
      max.setCustomValidity('最长间隔不能小于最短间隔。');
      max.reportValidity();
      return;
    }
    if (!form.reportValidity()) return;
    const messages = library.read();
    if (!messages) return;
    const requested = generation;
    const previous = saved.scheduledDanmaku;
    const scheduledDanmaku = {
      mode: mode.value,
      intervalSeconds: mode.value === 'fixed' ? Number(interval.value) : previous.intervalSeconds,
      minSeconds: mode.value === 'random' ? Number(min.value) : previous.minSeconds,
      maxSeconds: mode.value === 'random' ? Number(max.value) : previous.maxSeconds,
      selection: selection.value,
      messages,
    };
    saveState.textContent = '正在保存…';
    try {
      await sync({ scheduledDanmaku });
      if (generation !== requested || disposed) return;
      dirty = false;
      render();
      controls();
      saveState.textContent = '已保存到云端';
      toast('定时／随机弹幕设置已保存');
    } catch (error) {
      if (generation === requested && !disposed) saveState.textContent = `保存失败，草稿已保留。${error.message}`;
    }
  });

  function account(snapshot) {
    if (disposed) return;
    const name = snapshot?.streamer?.accountName;
    const next = snapshot?.state === 'authorized' && name ? JSON.stringify([name, snapshot.streamer.songPageUrl]) : '';
    if (next === owner) {
      if (!owner) exactState.textContent = scheduledState.textContent = available
        ? '连接 LIRA 账号后可设置' : '请升级桌面客户端后设置';
      return;
    }
    owner = next;
    generation += 1;
    saved = null;
    pending = dirty = false;
    exactEditor.reset();
    form.reset();
    library.reset();
    max.setCustomValidity('');
    saveState.textContent = '修改后请保存设置';
    get('danmakuScheduledSummary').textContent = '直播中按间隔发送词库';
    exactState.textContent = scheduledState.textContent = available ? '连接 LIRA 账号后可设置' : '请升级桌面客户端后设置';
    timingFields();
    controls();
    void sync();
  }
  const refresh = () => sync();
  const unsubscribe = bridge?.onStateChanged?.(account);
  const initial = generation;
  Promise.resolve(bridge?.getState?.()).then((snapshot) => {
    if (generation === initial) account(snapshot);
  }).catch(() => {
    if (generation === initial && !disposed) exactState.textContent = scheduledState.textContent = '账号信息读取失败，请重新连接。';
  });
  windowRef.addEventListener('online', refresh);
  windowRef.addEventListener('pagehide', () => {
    disposed = true;
    generation += 1;
    exactEditor.reset();
    unsubscribe?.();
    windowRef.removeEventListener('online', refresh);
  }, { once: true });
  exactState.textContent = scheduledState.textContent = available ? '正在读取云端设置…' : '请升级桌面客户端后设置';
  controls();
  timingFields();
  return { refresh };
}
