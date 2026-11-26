import { setEditorPageContext } from './danmaku-editor-pagination.js';
import { createAutosave } from './settings-autosave.js';

export function initDanmakuViewerNames({
  documentRef = globalThis.document,
  windowRef = globalThis.window,
  bridge = windowRef?.liraLicense,
} = {}) {
  const get = (suffix) => documentRef.getElementById('danmakuViewerNames' + suffix);
  const toggle = get('Toggle'), list = get('List'), panel = get('Panel');
  if (!toggle || !list || !panel) return;
  const root = panel.closest('#otherDanmakuFeature');
  const open = root.querySelector('[data-fixed-open="names"]');
  const available = ['getViewerNameSettings', 'updateViewerNameSettings', 'listViewerNames',
    'updateViewerName', 'deleteViewerName'].every((key) => typeof bridge?.[key] === 'function');
  let owner = '', generation = 0, disposed = false, busy = false, active = false;
  let settings = null, items = [], page = 1, total = 0, loaded = false, editing = null, notice = '', stateNotice = '';
  const blockedWordsInput = get('BlockedWords');
  let blockedWordsDirty = false;
  let blockedWordsRevision = 0, blockedWordsFailed = false;
  const autosave = createAutosave({ root: blockedWordsInput.parentElement, windowRef,
    canSave: () => Boolean(owner && Array.isArray(settings?.blockedWords) && blockedWordsDirty && !busy), save: saveBlockedWords });

  function controls() {
    toggle.checked = settings?.enabled === true;
    toggle.disabled = !owner || !available || !settings || busy;
    open.disabled = !owner || !available || !settings;
    get('Status').ariaBusy = String(Boolean(owner && available && busy && !settings));
    get('Status').textContent = !available ? '请更新客户端后使用昵称管理' : !owner ? '连接 LIRA 账号后可设置' :
      stateNotice || (!settings ? notice || '正在读取云端状态…' : '');
    get('Notice').textContent = notice;
    get('Refresh').disabled = !owner || !available || busy || Boolean(editing);
    const supportsBlockedWords = Array.isArray(settings?.blockedWords);
    blockedWordsInput.disabled = !owner || !supportsBlockedWords;
    get('BlockedWordsSave').disabled = blockedWordsInput.disabled || busy || !blockedWordsDirty;
    get('BlockedWordsSave').textContent = '重试保存';
    get('BlockedWordsSave').parentElement.hidden = !blockedWordsFailed;
    get('BlockedWordsCapability').hidden = !settings || supportsBlockedWords;
    get('Count').textContent = loaded ? `共 ${total} 人` : '';
    get('Empty').hidden = !loaded || items.length > 0;
    setEditorPageContext(list, { offset: (page - 1) * 20, total,
      previous: page > 1 ? () => void load(page - 1) : null,
      next: page * 20 < total ? () => void load(page + 1) : null,
      disabled: busy || Boolean(editing) });
    for (const row of list.children) {
      for (const field of row.querySelectorAll('input, button')) {
        field.disabled = busy || Boolean(editing && editing.uid !== row.dataset.uid);
      }
    }
    panel.setAttribute('aria-busy', String(busy));
  }

  function action(label, onClick, className = 'secondary') {
    const button = documentRef.createElement('button');
    button.type = 'button';
    button.className = className;
    button.textContent = label;
    button.addEventListener('click', onClick);
    return button;
  }

  function renderRows() {
    list.replaceChildren();
    for (const item of items) {
      const row = documentRef.createElement('div');
      row.className = 'danmaku-blessing-row danmaku-viewer-name-row';
      row.dataset.uid = item.uid;
      const uid = documentRef.createElement('span');
      uid.className = 'danmaku-viewer-name-uid';
      uid.textContent = `UID ${item.uid}`;
      const actions = documentRef.createElement('div');
      actions.className = 'danmaku-viewer-name-actions';
      if (editing?.uid === item.uid && editing.mode === 'edit') {
        const input = documentRef.createElement('input');
        input.value = editing.name;
        input.setAttribute('aria-label', `UID ${item.uid} 的昵称`);
        input.addEventListener('input', () => { editing.name = input.value; });
        input.addEventListener('keydown', (event) => {
          if (event.key === 'Enter' && !event.isComposing) { event.preventDefault(); void save(); }
        });
        actions.append(action('保存', () => void save()), action('取消', cancelEdit));
        row.append(uid, input, actions);
      } else {
        const name = documentRef.createElement('span');
        name.className = 'danmaku-viewer-name-value';
        name.textContent = item.name;
        if (editing?.uid === item.uid) {
          actions.append(action('确认删除', () => void remove(item.uid), 'danger'), action('取消', cancelEdit));
        } else {
          actions.append(action('修改', () => {
            editing = { uid: item.uid, name: item.name, mode: 'edit' };
            notice = '';
            renderRows();
            list.querySelector('input')?.focus();
          }), action('删除', () => {
            editing = { uid: item.uid, mode: 'delete' };
            notice = '删除后，新欢迎和感谢使用该观众的 B 站昵称；观众仍可重新发送“叫我 xx”。';
            renderRows();
          }));
        }
        row.append(uid, name, actions);
      }
      list.append(row);
    }
    controls();
  }

  function cancelEdit() { editing = null; notice = ''; renderRows(); }
  function confirmed(result) {
    if (result?.ok !== true) throw Object.assign(new Error(), { code: result?.error });
    return result;
  }
  async function perform(operation, accept, message = '', stateOperation = false) {
    if (!owner || !available || busy || disposed) return false;
    const requested = generation;
    busy = true;
    notice = '';
    controls();
    try {
      const result = confirmed(await operation());
      if (disposed || requested !== generation) return false;
      accept(result);
      if (stateOperation) stateNotice = '';
      notice = message;
      return true;
    } catch (error) {
      if (disposed || requested !== generation) return false;
      notice = error.code === 'VIEWER_NAMES_UNSUPPORTED' ? '当前服务器暂不支持昵称管理，请更新服务器后重试。' :
        error.code === 'INVALID_VIEWER_NAME_SETTINGS' ? '黑名单最多 200 条，每条最多 40 个字符，不能包含换行、控制字符或只有符号。' :
        error.code === 'VIEWER_NAME_BLOCKED' ? '该昵称命中了黑名单，请换一个昵称，或先修改黑名单。' :
        error.code === 'INVALID_VIEWER_NAME_REQUEST' ? '昵称需为 1～10 个字，不能换行；完整 emoji 按一个字计算。' :
          error.code === 'VIEWER_NAME_NOT_FOUND' ? '该昵称已被删除，请取消编辑并刷新名单。' :
            stateOperation ? '昵称开关状态未确认，请刷新核对；服务器可能仍按原设置运行。' :
              '操作未确认，请检查网络后刷新核对；未保存的修改已保留。';
      if (stateOperation) stateNotice = notice;
      return false;
    } finally {
      if (!disposed && requested === generation) { busy = false; controls(); autosave.resume(); }
    }
  }
  function acceptSettings(result, resetDraft = false) {
    settings = result;
    if (!blockedWordsDirty || resetDraft) {
      blockedWordsInput.value = result.blockedWords?.join('\n') || '';
      blockedWordsDirty = false;
    }
  }
  function load(nextPage = page) {
    if (editing) return;
    return perform(() => bridge.listViewerNames({ page: nextPage }), (result) => {
      ({ items, page, total } = result);
      loaded = true;
      renderRows();
    });
  }
  async function refresh() {
    const requested = generation;
    const success = await perform(() => bridge.getViewerNameSettings(), acceptSettings, '', true);
    if (success && generation === requested && active) await load();
  }
  async function save() {
    if (editing?.mode !== 'edit' || busy) return;
    const value = { uid: editing.uid, name: editing.name };
    await perform(() => bridge.updateViewerName(value), (result) => {
      items = items.map((item) => item.uid === result.uid ? { uid: result.uid, name: result.name } : item);
      editing = null;
      renderRows();
    }, '昵称已保存到云端');
  }
  async function remove(uid) {
    const requested = generation;
    const success = await perform(() => bridge.deleteViewerName(uid), () => {
      editing = null;
      items = items.filter((item) => item.uid !== uid);
      total = Math.max(0, total - 1);
      renderRows();
    }, '昵称已删除');
    if (success && generation === requested) await load();
  }
  function account(snapshot) {
    const next = snapshot?.state === 'authorized' && snapshot.streamer?.accountName
      ? JSON.stringify([snapshot.streamer.accountName, snapshot.streamer.songPageUrl]) : '';
    if (disposed || next === owner) return;
    owner = next;
    generation++;
    autosave.cancel();
    blockedWordsRevision++;
    blockedWordsFailed = false;
    settings = null;
    blockedWordsInput.value = '';
    blockedWordsDirty = false;
    items = [];
    page = 1;
    total = 0;
    loaded = false;
    editing = null;
    busy = false;
    notice = '';
    stateNotice = '';
    renderRows();
    void refresh();
  }
  function select(event) {
    active = event.detail === 'names';
    if (active && !loaded) void load();
  }
  toggle.addEventListener('change', () => {
    if (!settings) return controls();
    const enabled = toggle.checked;
    void perform(() => bridge.updateViewerNameSettings({ enabled }), acceptSettings,
      enabled ? '已开启昵称功能' : '已关闭昵称功能，已存昵称保留', true);
  });
  blockedWordsInput.addEventListener('input', () => {
    blockedWordsDirty = true; blockedWordsRevision++; blockedWordsFailed = false; controls(); autosave.schedule();
  });
  async function saveBlockedWords() {
    if (!Array.isArray(settings?.blockedWords) || !blockedWordsDirty) return;
    const requested = generation, revision = blockedWordsRevision;
    const blockedWords = blockedWordsInput.value.split(/\r?\n/u).map((word) => word.trim()).filter(Boolean);
    const ok = await perform(() => bridge.updateViewerNameSettings({ blockedWords }), (result) => {
      settings = result;
      if (revision === blockedWordsRevision) blockedWordsDirty = false;
    }, '昵称黑名单已保存到云端');
    if (requested !== generation || disposed) return;
    blockedWordsFailed = !ok;
    controls();
  }
  get('BlockedWordsSave').addEventListener('click', saveBlockedWords);
  get('Refresh').addEventListener('click', refresh);
  root.addEventListener('fixed-reply:select', select);
  const unsubscribe = bridge?.onStateChanged?.(account);
  const initial = generation;
  Promise.resolve(bridge?.getState?.()).then((snapshot) => {
    if (generation === initial) account(snapshot);
  }).catch(() => { if (!disposed && generation === initial) { notice = '账号信息读取失败，请重新连接账号。'; controls(); } });
  controls();
  function dispose() {
    disposed = true;
    autosave.dispose();
    generation++;
    unsubscribe?.();
    root.removeEventListener('fixed-reply:select', select);
    windowRef.removeEventListener('pagehide', dispose);
  }
  windowRef.addEventListener('pagehide', dispose, { once: true });
  return { refresh, dispose };
}
