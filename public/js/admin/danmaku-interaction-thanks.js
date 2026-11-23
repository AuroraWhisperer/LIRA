import { createScheduledLibraryEditor } from './danmaku-scheduled-library.js';
import { createAutosave } from './settings-autosave.js';

const KINDS = { like: '点赞感谢', share: '分享感谢', follow: '关注感谢' };

export function initDanmakuInteractionThanks({ documentRef, windowRef, saveSettings }) {
  let owner = '', generation = 0, disposed = false;
  let state = { saved: null, pending: false, available: false };
  const groups = Object.fromEntries(Object.entries(KINDS).map(([kind, label]) => {
    const prefix = `danmaku${kind}Thanks`;
    const get = suffix => documentRef.getElementById(`${prefix}${suffix}`);
    if (!get('Panel')) return [kind, null];
    const group = { get, saved: null, dirty: false, notice: '', revision: 0, writing: false };
    group.library = createScheduledLibraryEditor({ documentRef, prefix: `${prefix}Library`, label,
      maxItems: 30, changed: () => {
        group.dirty = true;
        group.revision++;
        group.notice = '';
        controls();
        group.autosave.schedule();
      } });
    group.autosave = createAutosave({ root: get('Panel'), windowRef,
      canSave: () => Boolean(owner && group.saved && !group.writing),
      save: () => {
        const messages = group.library.read({ reportValidity: false });
        if (messages) return write(kind, { [`${kind}ThanksMessages`]: messages });
      } });
    get('Toggle').addEventListener('change', () => void write(kind, { [`${kind}ThanksEnabled`]: get('Toggle').checked }));
    get('Panel').addEventListener('submit', event => {
      event.preventDefault();
      if (get('Save').disabled) return;
      const messages = group.library.read();
      if (messages) void write(kind, { [`${kind}ThanksMessages`]: messages });
    });
    return [kind, group];
  }));

  function controls() {
    for (const [kind, group] of Object.entries(groups)) {
      if (!group) continue;
      const { get } = group;
      const supported = Array.isArray(state.saved?.[`${kind}ThanksMessages`]);
      const ready = Boolean(owner && state.available && supported);
      const toggle = get('Toggle');
      toggle.checked = state.saved?.[`${kind}ThanksEnabled`] === true;
      toggle.disabled = !ready || state.pending;
      toggle.setAttribute('data-switch-pending', String(ready && state.pending));
      get('Fields').disabled = !ready;
      get('Save').disabled = !ready || state.pending || !group.dirty;
      documentRef.querySelector(`[data-fixed-open="${kind}Thanks"]`).disabled = !ready;
      get('State').textContent = !state.available ? '请升级桌面客户端后设置' : !owner ? '连接 LIRA 账号后可设置' :
        !state.saved ? state.message || '正在读取云端设置…' : !supported ? '当前服务器暂不支持互动感谢，请升级服务器。' :
          group.stateNotice || (!group.saved?.length ? '添加词库后才会发送' : '');
      get('SaveState').textContent = group.notice;
      get('SaveState').parentElement.hidden = !group.notice.includes('失败');
      get('Save').textContent = '重试保存';
      get('Summary').textContent = supported ? `${state.saved[`${kind}ThanksMessages`].length} 条文案 · 随机发送` : '收到个人互动后自动感谢';
    }
  }

  async function write(kind, patch) {
    if (!owner || !groups[kind].saved) return;
    const group = groups[kind], requested = generation;
    const revision = group.revision;
    const libraryKey = `${kind}ThanksMessages`, libraryWrite = Object.hasOwn(patch, libraryKey);
    group.stateNotice = '';
    group.notice = libraryWrite ? '正在保存词库…' : group.notice;
    group.writing = true;
    try {
      const result = await saveSettings(patch);
      if (disposed || requested !== generation) return;
      if (Object.keys(patch).some(key => JSON.stringify(result[key]) !== JSON.stringify(patch[key]))) {
        throw new Error('保存尚未确认，请刷新云端状态后重试。');
      }
      if (libraryWrite) {
        group.dirty = revision !== group.revision;
        group.notice = '';
      }
    } catch (error) {
      if (disposed || requested !== generation) return;
      if (libraryWrite) group.notice = `保存失败，草稿已保留。${error.message}`;
      else group.stateNotice = '开关更改尚未确认，请刷新云端状态核对。';
    } finally {
      if (!disposed && requested === generation) { group.writing = false; controls(); }
    }
  }

  function updateState(next) {
    if (disposed) return;
    if (owner !== next.owner) {
      owner = next.owner;
      generation++;
      for (const group of Object.values(groups)) {
        if (!group) continue;
        group.saved = null;
        group.autosave.cancel();
        group.writing = false;
        group.dirty = false;
        group.notice = group.stateNotice = '';
        group.library.reset();
      }
    }
    const confirmed = next.saved && next.saved !== state.saved;
    state = next;
    for (const [kind, group] of Object.entries(groups)) {
      if (!group) continue;
      if (confirmed) group.stateNotice = '';
      const messages = next.saved?.[`${kind}ThanksMessages`];
      if (!Array.isArray(messages)) continue;
      if (!group.dirty && JSON.stringify(messages) !== JSON.stringify(group.saved)) group.library.load(messages);
      group.saved = messages;
    }
    controls();
  }
  windowRef.addEventListener('pagehide', () => { disposed = true; generation++; }, { once: true });
  return { updateState };
}
