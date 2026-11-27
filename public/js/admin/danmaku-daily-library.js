import { revealEditorItem } from './danmaku-editor-pagination.js';
import { createAutosave } from './settings-autosave.js';

const NAMES = { checkin: '签到词库', fortune: '抽签词库' };
const FIELDS = { level: '签级', name: '签名', text: '签文', advice: '建议' };
const ERRORS = {
  DAILY_BOT_UNSUPPORTED: '当前服务暂不支持词库编辑，请联系管理员。',
  DAILY_BOT_LIBRARY_CONFLICT: '另一台设备修改了词库。草稿已保留，请核对后重新载入云端词库。',
  DAILY_BOT_LIBRARY_INVALID: '词库需有 1～1000 条完整文案，回复需能在完整昵称后分为最多 4 条。请缩短过长文案后重试。',
  DAILY_BOT_TAKEOVER_REQUIRED: '旧数据正在导入，完成后可编辑词库。',
  DAILY_BOT_BUSY: '上一项操作尚未完成，请稍后重试。',
};
const fresh = () => ({ items: null, confirmed: null, version: '', dirty: false, edit: 0, search: '', notice: '', readError: '', conflict: false, saveError: '' });

function matchesConfirmed(library, confirmed) {
  return library.length === confirmed.length && library.every((item, index) =>
    typeof item === 'string' ? item.trim() === confirmed[index]
      : Object.keys(FIELDS).every(field => item[field].trim() === confirmed[index][field]));
}

function settleUndo(data) {
  if (!data.dirty || data.conflict || !data.confirmed || !matchesConfirmed(data.items, data.confirmed.library)) return false;
  // The draft matches its base. Only a successful cloud response clears a read error.
  data.items = structuredClone(data.confirmed.library);
  data.dirty = false;
  data.saveError = '';
  data.notice = '';
  return true;
}

export function createDailyLibraryEditor({ documentRef, windowRef, request }) {
  const element = (suffix) => documentRef.getElementById(`dailyLibrary${suffix}`);
  const panel = documentRef.getElementById('danmakuDailyLibraryPanel');
  if (!panel) return null;
  const root = panel.closest('#otherDanmakuFeature');
  let states = { checkin: fresh(), fortune: fresh() };
  let kind = 'checkin', enabled = false, busy = false, generation = 0;
  let recheckingSettings = false, readAfterRefresh = false;
  const state = () => states[kind];
  const autosaves = Object.fromEntries(Object.keys(NAMES).map(key => [key, createAutosave({ root: panel, windowRef,
    canSave: () => enabled && !busy && states[key].dirty && !states[key].conflict,
    save: () => save(key, true) })]));
  function controls() {
    const data = state();
    for (const key of Object.keys(NAMES)) {
      const button = root.querySelector(`[data-fixed-open="${key}"]`);
      button.disabled = (busy && !recheckingSettings) || (!enabled && !states[key].items);
    }
    element('Save').disabled = !enabled || busy || !data.dirty || data.conflict;
    element('Refresh').disabled = !enabled || busy;
    element('Reload').disabled = !enabled || busy;
    element('Reload').hidden = !data.conflict;
    element('Add').disabled = !data.items || data.items.length >= 1000;
    const emptyStatus = readAfterRefresh ? '正在核对云端设置…' : '展开时读取词库';
    element('Status').textContent = data.notice || data.readError || data.saveError || (data.dirty ? '有未保存的修改' : data.items ? '已与云端确认' : emptyStatus);
    element('Status').parentElement.hidden = Boolean(data.items && !data.readError && !data.saveError && !data.conflict);
  }
  function changed(data) {
    data.edit++;
    data.dirty = true;
    data.saveError = '';
    if (!data.conflict) data.notice = '';
    controls();
    autosaves[data === states.checkin ? 'checkin' : 'fortune'].schedule();
  }
  function render() {
    const data = state();
    element('FortuneSettings').hidden = kind !== 'fortune';
    const list = element('List');
    list.classList.toggle('danmaku-blessing-list', kind === 'checkin');
    list.classList.toggle('danmaku-fortune-list', kind === 'fortune');
    list.replaceChildren();
    const matches = (data.items || []).map((item, index) => ({ item, index })).filter(({ item }) =>
      (typeof item === 'string' ? item : Object.values(item).join(' ')).includes(data.search));
    for (const { item, index } of matches) {
      const row = documentRef.createElement('div');
      row.className = kind === 'checkin' ? 'danmaku-blessing-row' : 'danmaku-fortune-row';
      const remove = documentRef.createElement('button');
      remove.type = 'button';
      remove.className = 'secondary daily-library-delete';
      remove.textContent = '删除';
      remove.setAttribute('aria-label', `删除第 ${index + 1} 条`);
      remove.addEventListener('click', () => { data.items.splice(index, 1); changed(data); render(); });
      const fields = documentRef.createElement('div');
      fields.className = 'danmaku-fortune-fields';
      for (const [field, title] of kind === 'checkin' ? [['blessing', '祝福语']] : Object.entries(FIELDS)) {
        const input = documentRef.createElement('input');
        input.type = 'text';
        input.maxLength = 1024;
        input.value = kind === 'checkin' ? item : item[field];
        input.setAttribute('aria-label', `第 ${index + 1} 条${title}`);
        input.addEventListener('input', () => {
          if (kind === 'checkin') data.items[index] = input.value;
          else data.items[index][field] = input.value;
          changed(data);
        });
        if (kind === 'checkin') row.append(input, remove);
        else {
          const label = documentRef.createElement('label');
          label.textContent = title;
          label.append(input);
          fields.append(label);
        }
      }
      if (kind === 'fortune') {
        const heading = documentRef.createElement('div');
        heading.className = 'danmaku-fortune-row-heading';
        const title = documentRef.createElement('span');
        title.textContent = `第 ${index + 1} 签`;
        heading.append(title, remove);
        row.append(heading, fields);
      }
      list.append(row);
    }
    if (!matches.length) {
      const empty = documentRef.createElement('p');
      empty.className = 'danmaku-blessing-empty';
      empty.textContent = !data.items ? '词库尚未读取' : data.search ? '没有匹配的文案' : '还没有文案，点击下方添加。';
      list.append(empty);
    }
    element('Search').value = data.search;
    element('Count').textContent = data.items ? `${data.items.length} 条${data.search ? ` · 找到 ${matches.length} 条` : ''}` : '尚未读取';
    element('Add').textContent = kind === 'checkin' ? '添加祝福语' : '添加签文';
    element('Save').textContent = '重试保存';
    controls();
  }
  async function read() {
    if (!enabled || busy) return;
    const requested = generation, key = kind, data = state();
    if (settleUndo(data)) autosaves[key].cancel();
    data.notice = '正在核对云端词库…';
    controls();
    const response = await request('library-read', { kind: key });
    if (generation !== requested) return;
    if (!response?.ok) {
      data.readError = ERRORS[response?.error] || '读取失败，已有文案和草稿已保留。请刷新重试。';
      data.notice = '';
      if (kind === key) controls();
      return;
    }
    const latest = response.library;
    const hasDraft = data.dirty;
    data.readError = '';
    data.confirmed = latest;
    if (hasDraft && !matchesConfirmed(data.items, latest.library)) {
      data.conflict = data.version !== latest.version;
      data.notice = data.conflict ? ERRORS.DAILY_BOT_LIBRARY_CONFLICT : '';
    } else {
      if (hasDraft) autosaves[key].cancel();
      else data.items = structuredClone(latest.library);
      data.version = latest.version;
      data.dirty = data.conflict = false;
      data.saveError = '';
      data.notice = '';
    }
    if (kind !== key) return;
    if (hasDraft) controls();
    else render();
  }
  async function save(key = kind, automatic = false) {
    const requested = generation, data = states[key], edit = data.edit;
    if (!enabled || busy || !data.dirty || data.conflict) return;
    if (settleUndo(data)) {
      controls();
      return;
    }
    const library = data.items.map((item) => typeof item === 'string' ? item.trim()
      : Object.fromEntries(Object.entries(item).map(([field, value]) => [field, value.trim()])));
    if (!library.length || library.some((item) => typeof item === 'string' ? !item : Object.values(item).some((value) => !value))) {
      data.saveError = data.notice = '请至少保留一条文案，并填写所有字段。';
      controls();
      return;
    }
    data.notice = '正在保存…';
    controls();
    const response = await request('library-save', { kind: key, expectedVersion: data.version, library });
    if (generation !== requested) return;
    if (response?.ok) {
      data.readError = '';
      data.saveError = '';
      data.confirmed = response.library;
      data.version = response.library.version;
      data.dirty = data.edit !== edit;
      if (!data.dirty) data.items = structuredClone(response.library.library);
      data.notice = data.dirty ? '已保存提交的内容；后续修改仍未保存。' : '词库已保存到云端。';
    } else {
      data.conflict = response?.error === 'DAILY_BOT_LIBRARY_CONFLICT';
      // A lost receipt can follow a successful write, so the old snapshot cannot confirm an undo.
      data.confirmed = null;
      data.saveError = data.notice = ERRORS[response?.error] || '保存尚未确认，草稿已保留。请刷新核对后重试。';
    }
    if (kind === key) !automatic && data.edit === edit ? render() : controls();
  }
  element('Refresh').addEventListener('click', read);
  element('Save').addEventListener('click', () => save(kind, true));
  element('Reload').addEventListener('click', async () => {
    const data = state();
    const edit = data.edit;
    if (data.readError || !data.confirmed) await read();
    if (state() !== data || data.readError || !data.confirmed) return;
    if (data.edit !== edit) {
      data.notice = '载入期间有新的修改，草稿已保留。再次点击可放弃草稿。';
      controls();
      return;
    }
    data.items = structuredClone(data.confirmed.library);
    data.version = data.confirmed.version;
    data.dirty = data.conflict = false;
    data.saveError = '';
    data.edit++;
    data.notice = '';
    render();
  });
  element('Search').addEventListener('input', () => {
    state().search = element('Search').value;
    render();
    revealEditorItem(element('List'), 0);
  });
  element('Add').addEventListener('click', () => {
    const data = state();
    data.items.push(kind === 'checkin' ? '' : { level: '', name: '', text: '', advice: '' });
    data.search = '';
    changed(data);
    render();
    element('List').lastElementChild?.querySelector('input')?.focus();
  });
  const select = (event) => {
    readAfterRefresh = false;
    if (!NAMES[event.detail]) return;
    kind = event.detail;
    readAfterRefresh = recheckingSettings;
    render();
    revealEditorItem(element('List'), 0);
    if (!readAfterRefresh) void read();
  };
  root.addEventListener('fixed-reply:select', select);
  windowRef.addEventListener('pagehide', () => { generation++; root.removeEventListener('fixed-reply:select', select); }, { once: true });
  return {
    availability(next) {
      enabled = next.enabled;
      busy = next.busy;
      recheckingSettings = next.recheckingSettings;
      if (!busy && readAfterRefresh) {
        readAfterRefresh = false;
        const stillOpen = panel.closest('dialog')?.open;
        if (stillOpen && enabled) {
          void read();
          return;
        }
        if (stillOpen) state().readError ||= '请关闭面板并刷新云端状态，再读取词库。';
      }
      controls();
      Object.values(autosaves).forEach(save => save.resume());
    },
    reset() {
      generation++;
      readAfterRefresh = false;
      Object.values(autosaves).forEach(save => save.cancel());
      states = { checkin: fresh(), fortune: fresh() };
      render();
    },
  };
}
