const NAMES = { checkin: '签到词库', fortune: '抽签词库' };
const FIELDS = { level: '签级', name: '签名', text: '签文', advice: '建议' };
const ERRORS = {
  DAILY_BOT_UNSUPPORTED: '服务器暂不支持词库编辑，请先更新服务器。',
  DAILY_BOT_LIBRARY_CONFLICT: '另一台设备修改了词库。草稿已保留，请核对后重新载入云端词库。',
  DAILY_BOT_LIBRARY_INVALID: '词库需有 1～1000 条完整文案，回复需能在完整昵称后分为最多 4 条。请缩短过长文案后重试。',
  DAILY_BOT_TAKEOVER_REQUIRED: '旧数据正在导入，完成后可编辑词库。',
  DAILY_BOT_BUSY: '上一项操作尚未完成，请稍后重试。',
};
const fresh = () => ({ items: null, confirmed: null, version: '', dirty: false, edit: 0, page: 0, search: '', notice: '', conflict: false });

export function createDailyLibraryEditor({ documentRef, windowRef, request }) {
  const element = (suffix) => documentRef.getElementById(`dailyLibrary${suffix}`);
  const panel = documentRef.getElementById('danmakuDailyLibraryPanel');
  if (!panel) return null;
  const root = panel.closest('.danmaku-fixed-reply-section');
  let states = { checkin: fresh(), fortune: fresh() };
  let kind = 'checkin', enabled = false, busy = false, generation = 0;
  const state = () => states[kind];
  const pageSize = () => kind === 'checkin' ? 6 : 3;
  function controls() {
    const data = state();
    for (const key of Object.keys(NAMES)) {
      const button = root.querySelector(`[data-fixed-open="${key}"]`);
      button.disabled = busy || (!enabled && !states[key].items);
    }
    element('Save').disabled = !enabled || busy || !data.dirty || data.conflict;
    element('Refresh').disabled = !enabled || busy;
    element('Reload').disabled = !enabled || busy;
    element('Reload').hidden = !data.conflict;
    element('Add').disabled = !data.items || data.items.length >= 1000;
    element('Status').textContent = data.notice || (data.dirty ? '有未保存的修改' : data.items ? '已与云端确认' : '展开时读取词库');
  }
  function changed(data) {
    data.edit++;
    data.dirty = true;
    if (!data.conflict) data.notice = '';
    controls();
  }
  function render() {
    const data = state();
    const list = element('List');
    list.className = kind === 'checkin' ? 'danmaku-blessing-list' : 'danmaku-fortune-list';
    list.replaceChildren();
    const matches = (data.items || []).map((item, index) => ({ item, index })).filter(({ item }) =>
      (typeof item === 'string' ? item : Object.values(item).join(' ')).includes(data.search));
    const pages = Math.max(1, Math.ceil(matches.length / pageSize()));
    data.page = Math.min(data.page, pages - 1);
    for (const { item, index } of matches.slice(data.page * pageSize(), (data.page + 1) * pageSize())) {
      const row = documentRef.createElement('div');
      row.className = kind === 'checkin' ? 'danmaku-blessing-row' : 'danmaku-fortune-row';
      const remove = documentRef.createElement('button');
      remove.type = 'button';
      remove.className = 'danmaku-text-action daily-library-delete';
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
    element('Page').textContent = `第 ${data.page + 1} / ${pages} 页`;
    element('Pagination').hidden = pages <= 1;
    element('Previous').disabled = data.page === 0;
    element('Next').disabled = data.page === pages - 1;
    element('Add').textContent = kind === 'checkin' ? '添加祝福语' : '添加签文';
    element('Save').textContent = `保存${NAMES[kind]}`;
    controls();
  }
  async function read() {
    if (!enabled || busy) return;
    const requested = generation, key = kind, data = state();
    data.notice = '正在核对云端词库…';
    controls();
    const response = await request('library-read', { kind: key });
    if (generation !== requested) return;
    if (response?.ok) {
      const latest = response.library;
      data.confirmed = latest;
      if (data.dirty) {
        data.conflict = data.version !== latest.version;
        data.notice = data.conflict ? ERRORS.DAILY_BOT_LIBRARY_CONFLICT : '已核对云端，未保存的草稿已保留。';
      } else {
        data.items = structuredClone(latest.library);
        data.version = latest.version;
        data.conflict = false;
        data.notice = '';
      }
    } else data.notice = ERRORS[response?.error] || '读取失败，已有文案和草稿已保留。请刷新重试。';
    if (kind === key) render();
  }
  async function save() {
    const requested = generation, key = kind, data = state(), edit = data.edit;
    if (!enabled || busy || !data.dirty || data.conflict) return;
    const library = data.items.map((item) => typeof item === 'string' ? item.trim()
      : Object.fromEntries(Object.entries(item).map(([field, value]) => [field, value.trim()])));
    if (!library.length || library.some((item) => typeof item === 'string' ? !item : Object.values(item).some((value) => !value))) {
      data.notice = '请至少保留一条文案，并填写所有字段。';
      controls();
      return;
    }
    data.notice = '正在保存…';
    controls();
    const response = await request('library-save', { kind: key, expectedVersion: data.version, library });
    if (generation !== requested) return;
    if (response?.ok) {
      data.confirmed = response.library;
      data.version = response.library.version;
      data.dirty = data.edit !== edit;
      if (!data.dirty) data.items = structuredClone(response.library.library);
      data.notice = data.dirty ? '已保存提交的内容；后续修改仍未保存。' : '词库已保存到云端。';
    } else {
      data.conflict = response?.error === 'DAILY_BOT_LIBRARY_CONFLICT';
      if (data.conflict) data.confirmed = null;
      data.notice = ERRORS[response?.error] || '保存尚未确认，草稿已保留。请刷新核对后重试。';
    }
    if (kind === key) data.edit === edit ? render() : controls();
  }
  element('Refresh').addEventListener('click', read);
  element('Save').addEventListener('click', save);
  element('Reload').addEventListener('click', async () => {
    const data = state();
    const edit = data.edit;
    if (!data.confirmed) await read();
    if (state() !== data || !data.confirmed) return;
    if (data.edit !== edit) {
      data.notice = '载入期间有新的修改，草稿已保留。再次点击可放弃草稿。';
      controls();
      return;
    }
    data.items = structuredClone(data.confirmed.library);
    data.version = data.confirmed.version;
    data.dirty = data.conflict = false;
    data.edit++;
    data.notice = '';
    render();
  });
  element('Search').addEventListener('input', () => { state().search = element('Search').value; state().page = 0; render(); });
  element('Previous').addEventListener('click', () => { state().page--; render(); });
  element('Next').addEventListener('click', () => { state().page++; render(); });
  element('Add').addEventListener('click', () => {
    const data = state();
    data.items.push(kind === 'checkin' ? '' : { level: '', name: '', text: '', advice: '' });
    data.search = '';
    const index = data.items.length - 1;
    data.page = Math.floor(index / pageSize());
    changed(data);
    render();
    element('List').querySelectorAll('input')[kind === 'checkin' ? index % pageSize() : (index % pageSize()) * 4]?.focus();
  });
  const select = (event) => {
    if (!NAMES[event.detail]) return;
    kind = event.detail;
    render();
    void read();
  };
  root.addEventListener('fixed-reply:select', select);
  windowRef.addEventListener('pagehide', () => { generation++; root.removeEventListener('fixed-reply:select', select); }, { once: true });
  return {
    availability(next) { enabled = next.enabled; busy = next.busy; controls(); },
    reset() { generation++; states = { checkin: fresh(), fortune: fresh() }; render(); },
  };
}
