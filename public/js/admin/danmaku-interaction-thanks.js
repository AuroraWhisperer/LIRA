import { createScheduledLibraryEditor } from './danmaku-scheduled-library.js';

const KINDS = { like: '点赞感谢', share: '分享感谢', follow: '关注感谢' };

export function initDanmakuInteractionThanks({ documentRef, windowRef, saveSettings }) {
  let owner = '', generation = 0, disposed = false;
  let state = { saved: null, pending: false, available: false };
  const groups = Object.fromEntries(Object.entries(KINDS).map(([kind, label]) => {
    const prefix = `danmaku${kind}Thanks`;
    const get = suffix => documentRef.getElementById(`${prefix}${suffix}`);
    if (!get('Panel')) return [kind, null];
    const group = { get, saved: null, dirty: false, notice: '' };
    group.library = createScheduledLibraryEditor({ documentRef, prefix: `${prefix}Library`, label,
      maxItems: 30, changed: () => {
        group.dirty = true;
        group.notice = '有未保存的更改';
        controls();
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
      get('Toggle').checked = state.saved?.[`${kind}ThanksEnabled`] === true;
      get('Toggle').disabled = get('Fields').disabled = !ready || state.pending;
      get('Save').disabled = !ready || state.pending || !group.dirty;
      documentRef.querySelector(`[data-fixed-open="${kind}Thanks"]`).disabled = !ready;
      get('State').textContent = !state.available ? '请升级桌面客户端后设置' : !owner ? '连接 LIRA 账号后可设置' :
        !state.saved ? state.message || '正在读取云端设置…' : !supported ? '当前服务器暂不支持互动感谢，请升级服务器。' :
          group.stateNotice || (!group.saved?.length ? '添加词库后才会发送' : '');
      get('SaveState').textContent = group.notice;
      get('Summary').textContent = supported ? `${state.saved[`${kind}ThanksMessages`].length} 条文案 · 随机发送` : '收到个人互动后自动感谢';
    }
  }

  async function write(kind, patch) {
    if (state.pending || !owner || !groups[kind].saved) return;
    const group = groups[kind], requested = generation;
    const libraryKey = `${kind}ThanksMessages`, libraryWrite = Object.hasOwn(patch, libraryKey);
    group.stateNotice = '';
    group.notice = libraryWrite ? '正在保存词库…' : group.notice;
    try {
      const result = await saveSettings(patch);
      if (disposed || requested !== generation) return;
      if (Object.keys(patch).some(key => JSON.stringify(result[key]) !== JSON.stringify(patch[key]))) {
        throw new Error('保存尚未确认，请刷新云端状态后重试。');
      }
      if (libraryWrite) {
        group.dirty = false;
        group.library.load(result[libraryKey]);
        group.notice = '词库已保存到云端';
      }
    } catch (error) {
      if (disposed || requested !== generation) return;
      if (libraryWrite) group.notice = `保存失败，草稿已保留。${error.message}`;
      else group.stateNotice = '开关更改尚未确认，请刷新云端状态核对。';
    } finally {
      if (!disposed && requested === generation) controls();
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
