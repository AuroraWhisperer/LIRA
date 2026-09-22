import { observeServerOverlayUrl } from './server-overlay-url.js';

const ERRORS = {
  OVERLAY_FILTERS_UNSUPPORTED: '服务器尚未支持弹幕屏蔽，请更新服务器后重新读取。',
  NETWORK_UNAVAILABLE: '无法连接服务器，请检查网络后重试。',
  INVALID_OVERLAY_FILTERS: '请检查 UID 或屏蔽词：最多 500 人、200 个词，每个词不超过 100 字。',
  BILIBILI_LOGIN_REQUIRED: '请先登录 B 站，再读取直播间观众。',
  OVERLAY_ROOM_NOT_CONFIGURED: '请先设置直播间，再读取观众。',
  OVERLAY_VIEWERS_CONTEXT_CHANGED: '直播间或登录状态已变化，请重新读取观众。',
  OVERLAY_VIEWERS_UNAVAILABLE: '暂时无法读取直播间观众，请稍后重试，也可以手动输入 UID。',
  TOO_MANY_OVERLAY_VIEWER_REQUESTS: '读取过于频繁，请稍后再试。',
};

export function initDanmakuOverlayFilters() {
  const root = document.getElementById('danmakuOverlayFilters');
  if (!root) return;
  const get = (id) => document.getElementById(`danmaku${id}`);
  const bridge = window.liraLicense;
  const state = get('FiltersState');
  const uidInput = get('BlacklistUid'),
    wordInput = get('KeywordInput');
  const picker = get('ViewerPicker'),
    viewerState = get('ViewerState');
  let settings = { blockedUsers: [], blockedKeywords: [] };
  let owner = '',
    generation = 0,
    loaded = false,
    loading = false,
    saving = false;
  let readingViewers = false,
    viewers = [],
    selected = new Set();

  function checked(response) {
    if (!response?.ok) throw new Error(ERRORS[response?.error] || '操作未完成，请重新读取后重试。');
    return response;
  }

  function listItem(text, removeLabel, remove) {
    const item = document.createElement('li');
    const label = document.createElement('span');
    label.textContent = text;
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'secondary';
    button.textContent = '移除';
    button.setAttribute('aria-label', removeLabel);
    button.disabled = saving || loading;
    button.addEventListener('click', remove);
    item.append(label, button);
    return item;
  }

  function renderViewers() {
    const query = get('ViewerSearch').value.trim().toLowerCase();
    const blocked = new Set(settings.blockedUsers.map((user) => user.uid));
    const visible = viewers.filter((user) => `${user.name} ${user.uid}`.toLowerCase().includes(query));
    get('ViewerList').replaceChildren(
      ...visible.map((user) => {
        const item = document.createElement('li'),
          label = document.createElement('label');
        const checkbox = document.createElement('input'),
          text = document.createElement('span');
        checkbox.type = 'checkbox';
        checkbox.checked = blocked.has(user.uid) || selected.has(user.uid);
        checkbox.disabled = saving || loading || readingViewers || blocked.has(user.uid);
        checkbox.addEventListener('change', () => {
          if (checkbox.checked) selected.add(user.uid);
          else selected.delete(user.uid);
          updateSelection();
        });
        text.textContent = `${user.name || '未提供昵称'} · UID ${user.uid}${blocked.has(user.uid) ? '（已屏蔽）' : ''}`;
        label.append(checkbox, text);
        item.append(label);
        return item;
      }),
    );
    if (viewers.length && !readingViewers)
      viewerState.textContent = visible.length ? '' : '没有匹配的观众，可调整搜索或手动输入 UID。';
    updateSelection();
  }

  function updateSelection() {
    get('AddViewers').textContent = selected.size ? `加入黑名单（${selected.size} 人）` : '加入黑名单';
    get('AddViewers').disabled = !loaded || saving || loading || readingViewers || !selected.size;
  }

  function render() {
    const disabled = !loaded || saving || loading;
    root.setAttribute('aria-busy', String(saving || loading));
    for (const node of root.querySelectorAll('form input, form button')) node.disabled = disabled;
    get('FiltersReload').disabled = !owner || loading || saving;
    get('ReadViewers').disabled = disabled || readingViewers;
    get('ReadViewers').textContent = readingViewers ? '正在读取观众…' : '读取当前直播间观众';
    get('ClearKeywords').disabled = disabled || !settings.blockedKeywords.length;
    get('BlacklistCount').textContent = `${settings.blockedUsers.length} 人`;
    get('KeywordCount').textContent = `${settings.blockedKeywords.length} 个词`;
    get('BlacklistEmpty').hidden = !loaded || settings.blockedUsers.length > 0;
    get('KeywordsEmpty').hidden = !loaded || settings.blockedKeywords.length > 0;
    get('Blacklist').replaceChildren(
      ...settings.blockedUsers.map((user) =>
        listItem(`${user.name ? `${user.name} · ` : ''}UID ${user.uid}`, `移除黑名单用户 ${user.uid}`, () =>
          save({ blockedUsers: settings.blockedUsers.filter((entry) => entry.uid !== user.uid) }),
        ),
      ),
    );
    get('Keywords').replaceChildren(
      ...settings.blockedKeywords.map((word) =>
        listItem(word, `移除屏蔽词 ${word}`, () =>
          save({ blockedKeywords: settings.blockedKeywords.filter((entry) => entry !== word) }),
        ),
      ),
    );
    renderViewers();
  }

  async function reload() {
    if (!owner || loading || saving) return;
    const current = generation;
    loading = true;
    state.textContent = '正在读取屏蔽设置…';
    render();
    try {
      if (!bridge?.getOverlayFilters) throw new Error('请更新客户端后使用弹幕屏蔽。');
      const response = await bridge.getOverlayFilters();
      if (current !== generation) return;
      settings = checked(response);
      selected.clear();
      loaded = true;
      state.textContent = '设置已同步。添加和移除后自动保存。';
    } catch (error) {
      if (current === generation) state.textContent = error.message;
    } finally {
      if (current === generation) {
        loading = false;
        render();
      }
    }
  }

  async function save(patch, afterSave) {
    if (!loaded || saving || loading) return;
    const current = generation;
    saving = true;
    state.textContent = '正在保存屏蔽设置…';
    render();
    try {
      const response = await bridge.updateOverlayFilters(patch);
      if (current !== generation) return;
      settings = checked(response);
      selected = new Set([...selected].filter((uid) => !settings.blockedUsers.some((user) => user.uid === uid)));
      afterSave?.();
      state.textContent = '已保存，对之后收到的弹幕生效。';
    } catch (error) {
      if (current === generation) state.textContent = `保存失败，输入已保留：${error.message}`;
    } finally {
      if (current === generation) {
        saving = false;
        render();
      }
    }
  }

  get('BlacklistForm').addEventListener('submit', (event) => {
    event.preventDefault();
    const uid = uidInput.value.trim();
    if (settings.blockedUsers.some((user) => user.uid === uid)) {
      state.textContent = '该 UID 已在黑名单中。';
      return;
    }
    void save({ blockedUsers: [...settings.blockedUsers, { uid, name: '' }] }, () => {
      uidInput.value = '';
    });
  });
  get('KeywordForm').addEventListener('submit', (event) => {
    event.preventDefault();
    void save({ blockedKeywords: [...settings.blockedKeywords, wordInput.value.trim()] }, () => {
      wordInput.value = '';
    });
  });
  get('ClearKeywords').addEventListener('click', () => save({ blockedKeywords: [] }));
  get('FiltersReload').addEventListener('click', reload);
  get('ViewerSearch').addEventListener('input', renderViewers);
  get('CloseViewers').addEventListener('click', () => {
    picker.hidden = true;
    get('ReadViewers').focus();
  });
  get('AddViewers').addEventListener('click', () =>
    save({
      blockedUsers: [...settings.blockedUsers, ...viewers.filter((user) => selected.has(user.uid))],
    }),
  );
  get('ReadViewers').addEventListener('click', async () => {
    if (!loaded || readingViewers || loading || saving) return;
    const current = generation;
    readingViewers = true;
    viewers = [];
    selected.clear();
    picker.hidden = false;
    get('ViewerSearch').value = '';
    get('ViewerTitle').textContent = '选择观众';
    viewerState.textContent = '正在读取当前直播间在线榜…';
    render();
    try {
      const response = await bridge.getOverlayViewers();
      if (current !== generation) return;
      const result = checked(response);
      viewers = result.viewers;
      get('ViewerTitle').textContent = `房间 ${result.roomId} · 已读取 ${viewers.length} 人`;
      viewerState.textContent = viewers.length ? '' : '在线榜暂无可选观众，可稍后重试或手动输入 UID。';
    } catch (error) {
      if (current === generation) viewerState.textContent = error.message;
    } finally {
      if (current === generation) {
        readingViewers = false;
        render();
      }
    }
  });
  observeServerOverlayUrl((url) => {
    if (url === owner) return;
    owner = url;
    generation += 1;
    loaded = loading = saving = readingViewers = false;
    settings = { blockedUsers: [], blockedKeywords: [] };
    viewers = [];
    selected.clear();
    uidInput.value = wordInput.value = get('ViewerSearch').value = '';
    picker.hidden = true;
    viewerState.textContent = '';
    state.textContent = url ? '' : '请先连接已授权的 LIRA 账号。';
    render();
    void reload();
  });
  state.textContent ||= '请先连接已授权的 LIRA 账号。';
  render();
}
