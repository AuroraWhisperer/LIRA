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

  function controls() {
    toggle.checked = settings?.enabled === true;
    toggle.disabled = !owner || !available || !settings || busy;
    open.disabled = !owner || !available || !settings;
    get('Status').textContent = !available ? '请更新客户端后使用昵称管理' : !owner ? '连接 LIRA 账号后可设置' :
      stateNotice || (!settings ? notice || '正在读取云端状态…' : settings.enabled ? '云端已开启' : '已关闭 · 已存昵称保留');
    get('Notice').textContent = notice;
    get('Refresh').disabled = !owner || !available || busy || Boolean(editing);
    get('Count').textContent = loaded ? `共 ${total} 人` : '';
    get('Empty').hidden = !loaded || items.length > 0;
    get('Pagination').hidden = total <= 20;
    get('PageLabel').textContent = `第 ${page} / ${Math.max(1, Math.ceil(total / 20))} 页`;
    get('Prev').disabled = busy || Boolean(editing) || page <= 1;
    get('Next').disabled = busy || Boolean(editing) || page * 20 >= total;
    for (const row of list.children) {
      for (const field of row.querySelectorAll('input, button')) {
        field.disabled = busy || Boolean(editing && editing.uid !== row.dataset.uid);
      }
    }
    panel.setAttribute('aria-busy', String(busy));
  }

  function action(label, onClick) {
    const button = documentRef.createElement('button');
    button.type = 'button';
    button.className = 'danmaku-text-action';
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
          actions.append(action('确认删除', () => void remove(item.uid)), action('取消', cancelEdit));
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
        error.code === 'INVALID_VIEWER_NAME_REQUEST' ? '昵称需为 1～10 个字，不能换行；完整 emoji 按一个字计算。' :
          error.code === 'VIEWER_NAME_NOT_FOUND' ? '该昵称已被删除，请取消编辑并刷新名单。' :
            stateOperation ? '昵称开关状态未确认，请刷新核对；服务器可能仍按原设置运行。' :
              '操作未确认，请检查网络后刷新核对；未保存的修改已保留。';
      if (stateOperation) stateNotice = notice;
      return false;
    } finally {
      if (!disposed && requested === generation) { busy = false; controls(); }
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
    const success = await perform(() => bridge.getViewerNameSettings(), (result) => { settings = result; }, '', true);
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
    settings = null;
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
    void perform(() => bridge.updateViewerNameSettings({ enabled }), (result) => { settings = result; },
      enabled ? '已开启昵称功能' : '已关闭昵称功能，已存昵称保留', true);
  });
  get('Refresh').addEventListener('click', refresh);
  get('Prev').addEventListener('click', () => void load(page - 1));
  get('Next').addEventListener('click', () => void load(page + 1));
  root.addEventListener('fixed-reply:select', select);
  const unsubscribe = bridge?.onStateChanged?.(account);
  const initial = generation;
  Promise.resolve(bridge?.getState?.()).then((snapshot) => {
    if (generation === initial) account(snapshot);
  }).catch(() => { if (!disposed && generation === initial) { notice = '账号信息读取失败，请重新连接账号。'; controls(); } });
  controls();
  function dispose() {
    disposed = true;
    generation++;
    unsubscribe?.();
    root.removeEventListener('fixed-reply:select', select);
    windowRef.removeEventListener('beforeunload', dispose);
  }
  windowRef.addEventListener('beforeunload', dispose, { once: true });
  return { refresh, dispose };
}
