import { createFanTransferUi } from './transfer-ui.js';
import { dangerConfirm, toast } from '../../shared/utils.js';
import { html, renderPeople, renderDetail, renderReminders } from './view.js';
import { getBilibiliRoomProfileSnapshot } from '../settings-room-profile.js';
import { profileForm, recordForm, settingsForm, exportForm, guardRosterForm } from './forms.js';

let initialized = false;

function createFanUi() {
  const root = document.getElementById('fanProfilesWorkspace');
  if (!root) return false;
  const get = (id) => document.getElementById(id);
  const editor = get('fanEditor');
  const form = get('fanEditorForm');
  const detailNode = get('fanDetail');
  const panel = get('otherFanProfilesFeature');
  document.body.append(editor);
  const state = {
    contextId: null,
    roomId: '',
    profile: null,
    profiles: [],
    listStatus: 'ready',
    tab: 'overview',
    page: 'profiles',
    filters: [],
    archived: false,
    settings: {},
    syncStatus: 'pending',
    sequence: 0,
    selection: 0,
    selectionId: null,
    editor: null,
    expanded: false,
  };
  let searchTimer;
  let pollTimer;
  const renderedMarkup = new WeakMap();
  const transfer = createFanTransferUi({
    request,
    openForm,
    getProfile: () => state.profile,
    onProfile: async (profile) => {
      state.profile = profile;
      await load();
      renderSelected();
    },
    onReset: async () => {
      state.profile = null;
      updateMarkup(detailNode, '<p class="fan-empty">恢复完成，请重新选择档案。</p>');
      await load();
    },
  });

  async function request(action, payload = {}) {
    if (!window.fanProfiles) throw new Error('粉丝档案在 Electron 桌面客户端中使用。');
    const contextId = state.contextId;
    const result = await window.fanProfiles.invoke({
      action,
      payload,
      contextId,
    });
    if (!result.ok) {
      const error = new Error(result.error || '档案操作失败，未保存的输入仍保留。');
      error.existingId = result.existingId;
      throw error;
    }
    if (action !== 'open' && state.contextId !== contextId) throw new Error('登录状态已变化，请重新打开粉丝档案。');
    if (action === 'open' && state.contextId && state.contextId !== result.contextId) {
      state.profile = null;
      state.selection++;
      state.tab = 'overview';
      get('fanRosterResult').hidden = true;
      updateMarkup(detailNode, '<p class="fan-empty">登录状态已变化，请重新选择档案。</p>');
    }
    state.contextId = result.contextId;
    state.roomId = result.roomId || '';
    state.syncStatus = result.syncStatus;
    const syncLabel =
      {
        ready: '已同步',
        syncing: '资料仍在同步',
        pending: '资料仍在同步',
        offline: '离线 · 可维护本机档案',
        unsupported: '服务器尚未支持档案同步 · 可手动维护',
      }[result.syncStatus] || '';
    const syncNode = get('fanSyncState');
    if (syncNode.textContent !== syncLabel) syncNode.textContent = syncLabel;
    return result.data;
  }

  function showError(error, inEditor = false) {
    const node = get(inEditor ? 'fanEditorError' : 'fanPageError');
    node.textContent = error.message || String(error);
    node.hidden = false;
    if (inEditor && error.existingId) {
      const button = document.createElement('button');
      button.type = 'button';
      button.textContent = '打开已有档案';
      button.addEventListener('click', () => {
        editor.close();
        void select(error.existingId);
      });
      node.append(' ', button);
      if (error.mergeInput) {
        const merge = document.createElement('button');
        merge.type = 'button';
        merge.textContent = '预览合并草稿';
        merge.addEventListener('click', () => {
          void transfer.mergeDraft(error.mergeInput, error.existingId).catch((failure) => showError(failure, true));
        });
        node.append(' ', merge);
      }
    }
  }

  function updateMarkup(node, markup) {
    if (renderedMarkup.get(node) === markup) return false;
    const scroll = node.scrollTop;
    node.innerHTML = markup;
    node.scrollTop = scroll;
    renderedMarkup.set(node, markup);
    return true;
  }

  function renderSelected() {
    if (state.profile) updateMarkup(detailNode, renderDetail(state.profile, state.tab));
    renderList();
  }

  function fitPeopleNames() {
    for (const name of get('fanPeople').querySelectorAll('.fan-name')) {
      name.style.fontSize = '';
      const availableWidth = name.getBoundingClientRect().width;
      if (!availableWidth) continue;
      const range = document.createRange();
      range.selectNodeContents(name);
      const textWidth = range.getBoundingClientRect().width;
      if (textWidth > availableWidth) {
        const fontSize = parseFloat(getComputedStyle(name).fontSize);
        name.style.fontSize = `${Math.floor(((fontSize * availableWidth) / textWidth) * 10) / 10}px`;
      }
    }
  }

  function renderList() {
    const list = get('fanPeople');
    const changed = updateMarkup(
      list,
      state.listStatus === 'loading'
        ? '<p class="fan-empty" role="status">正在加载档案…</p>'
        : state.listStatus === 'error'
          ? '<p class="fan-empty">档案加载失败，请在设置中重新加载。</p>'
          : renderPeople(
              state.profiles,
              state.profile?.id,
              Boolean(get('fanSearch').value || state.filters.length),
              state.archived,
            ),
    );
    get('fanSplit').classList.toggle('fan-has-selection', Boolean(state.profile));
    get('fanSplit').classList.toggle('fan-expanded', state.expanded);
    const expandButton = detailNode.querySelector('[data-fan-action="expand"]');
    const expandLabel = state.expanded ? '收起详情' : '展开详情';
    if (expandButton && expandButton.textContent !== expandLabel) expandButton.textContent = expandLabel;
    if (changed) fitPeopleNames();
  }

  async function load(open = false, background = false) {
    const sequence = ++state.sequence;
    const keepList = state.listStatus === 'ready' && state.contextId;
    get('fanPageError').hidden = true;
    if (!keepList) {
      state.listStatus = 'loading';
      renderList();
    }
    let data;
    try {
      data = await request(open || !state.contextId ? 'open' : 'list', {
        query: get('fanSearch').value,
        filters: state.filters,
        archived: state.archived,
      });
    } catch (error) {
      if (sequence !== state.sequence) return false;
      if (!background || !keepList) {
        state.listStatus = 'error';
        renderList();
      }
      throw error;
    }
    if (sequence !== state.sequence) return false;
    state.profiles = data.profiles;
    state.settings = data.settings;
    state.listStatus = 'ready';
    renderList();
    await loadReminders();
    return sequence === state.sequence;
  }

  async function loadReminders() {
    const items = await request('reminders');
    const actionable = items.filter((item) => item.actionable);
    const summary = get('fanReminderSummary');
    summary.hidden = !actionable.length;
    updateMarkup(
      summary,
      actionable.length
        ? `<span>今天与近期有 ${actionable.length} 项重要日子待处理</span><button type="button" data-fan-page="reminders">查看提醒</button>`
        : '',
    );
    updateMarkup(get('fanRemindersPage'), renderReminders(items));
  }

  async function select(id, resetTab = true, alignScope = false) {
    let selection = ++state.selection;
    state.selectionId = id;
    const profile = await request('detail', { id });
    if (selection !== state.selection) return;
    if (alignScope && Boolean(profile.archived) !== state.archived) {
      changeScope(Boolean(profile.archived));
      selection = state.selection;
      state.selectionId = id;
      const contextId = state.contextId;
      if (!(await load()) || selection !== state.selection || contextId !== state.contextId) return;
    }
    state.profile = profile;
    if (resetTab) {
      state.tab = 'overview';
      state.page = 'profiles';
      showPage();
    }
    renderSelected();
  }

  function showPage() {
    get('fanProfilesPage').hidden = state.page !== 'profiles';
    get('fanRemindersPage').hidden = state.page !== 'reminders';
    get('fanSettingsPage').hidden = state.page !== 'settings';
    get('fanNewProfileButton').hidden = state.page !== 'profiles' || state.archived;
    get('fanArchivedNotice').hidden = !state.archived;
    for (const node of root.querySelectorAll('.fan-scope [data-fan-action]'))
      node.setAttribute('aria-pressed', String((node.dataset.fanAction === 'archived') === state.archived));
    for (const node of root.querySelectorAll('[data-fan-page][role="tab"]'))
      node.setAttribute('aria-selected', String(node.dataset.fanPage === state.page));
  }

  function clearSelection(preservePending = false) {
    state.profile = null;
    if (!preservePending) {
      state.selection++;
      state.selectionId = null;
    }
    state.tab = 'overview';
    state.expanded = false;
    updateMarkup(detailNode, '<p class="fan-empty">选择一份档案查看详情</p>');
    renderList();
  }

  function changeScope(archived) {
    clearTimeout(searchTimer);
    state.archived = archived;
    state.page = 'profiles';
    state.filters = [];
    get('fanSearch').value = '';
    for (const button of root.querySelectorAll('[data-fan-filter]'))
      button.setAttribute('aria-pressed', String(!button.dataset.fanFilter));
    state.profiles = [];
    state.listStatus = 'loading';
    clearSelection();
    showPage();
  }

  function openForm(description, save) {
    state.editor = { ...description, save };
    editor.classList.toggle('fan-profile-editor', !!description.profileEditor);
    get('fanEditorTitle').textContent = description.title;
    get('fanEditorFields').innerHTML = description.fields;
    get('fanEditorHint').textContent = description.hint || '';
    get('fanEditorError').hidden = true;
    get('fanSaveButton').textContent = description.saveLabel || '保存';
    description.bind?.(form);
    if (!editor.open) editor.showModal();
    form.querySelector('[autofocus], textarea, input:not([type="checkbox"]), select')?.focus();
  }

  function editProfile(profile = {}) {
    openForm(profileForm(profile), async (payload) => {
      try {
        state.profile = await request(profile.id ? 'save' : 'create', payload);
      } catch (error) {
        if (error.existingId && profile.id && !profile.identity) error.mergeInput = payload;
        throw error;
      }
      await load();
      renderSelected();
    });
  }

  function editRecord(kind, record) {
    const profileId = state.profile.id;
    openForm(recordForm(kind, record), async (payload) => {
      const result = await request('save-record', { ...payload, profileId });
      state.profile = result.profile;
      if (kind === 'note') state.tab = 'interactions';
      await load();
      renderSelected();
    });
  }

  function settings() {
    openForm(settingsForm(state.settings), async (payload) => {
      state.settings = await request('configure', payload);
      await load();
    });
  }

  async function action(name, element) {
    if (name === 'cancel-edit') {
      if (get('fanSaveButton').disabled) return;
      editor.close();
      return;
    }
    if (name === 'expand') {
      state.expanded = !state.expanded;
      element.closest('details')?.removeAttribute('open');
      renderList();
      return;
    }
    if (name === 'back-list') {
      state.profile = null;
      state.expanded = false;
      renderList();
      return;
    }
    if (name === 'archived' || name === 'back-profiles') {
      const archived = name === 'archived';
      if (archived === state.archived) return;
      changeScope(archived);
      await load();
      return;
    }
    if (!state.contextId) await load(true);
    if (name === 'guard-roster') {
      await load(true);
      if (!state.roomId) throw new Error('请先在连接设置中填写直播间号。');
      openForm(guardRosterForm(state.roomId, getBilibiliRoomProfileSnapshot(state.roomId)), async (payload) => {
        const result = await request('sync-guard-roster', payload);
        const message = result.total
          ? `房间 ${result.roomId}：新增 ${result.created} 份档案，更新 ${result.updated} 份，跳过 ${result.skipped} 位。`
          : `房间 ${result.roomId} 当前没有大航海成员。`;
        get('fanRosterResult').textContent = message;
        get('fanRosterResult').hidden = false;
        await load();
        if (state.profile) await select(state.profile.id, false);
        return { message };
      });
      return;
    }
    if (name === 'new') {
      editProfile();
      return;
    }
    if (name === 'settings') {
      settings();
      return;
    }
    if (name === 'refresh') {
      await load(true);
      if (state.profile) await select(state.profile.id, false);
      return;
    }
    if (name === 'clear-filter') {
      state.filters = [];
      get('fanSearch').value = '';
      for (const button of root.querySelectorAll('[data-fan-filter]'))
        button.setAttribute('aria-pressed', String(!button.dataset.fanFilter));
      await load();
      return;
    }
    if (name === 'backup') {
      const data = await request('backup');
      transfer.download(JSON.stringify(data, null, 2), 'LIRA-粉丝档案备份.json', 'application/json');
      return;
    }
    if (name === 'restore') {
      get('fanRestoreFile').click();
      return;
    }
    if (name === 'snapshots') {
      await transfer.snapshots();
      return;
    }
    if (name === 'suppressions') {
      await transfer.suppressions();
      return;
    }
    if (name === 'delete-all') {
      const confirmed = await dangerConfirm({
        title: '清除全部档案',
        message: '当前账号的主列表与已归档档案都会永久删除。建议先保存完整备份；清除后，后续同步仍可重新自动建档。',
        deletes: ['全部粉丝档案', '档案内的手记与互动记录', '档案提醒状态'],
        keeps: ['原始礼物账本', '排除名单与档案设置', '现有恢复点'],
        confirmLabel: '确认清除全部档案',
      });
      if (!confirmed) return;
      const result = await request('delete-all', { confirm: true });
      state.profile = null;
      state.archived = false;
      state.expanded = false;
      state.selection++;
      detailNode.innerHTML = '<p class="fan-empty">档案已全部清除。</p>';
      showPage();
      await load();
      toast(`已清除 ${result.deletedCount} 份档案`);
      return;
    }
    if (name === 'export') {
      openForm({ ...exportForm(), saveLabel: '导出表格' }, async (payload) =>
        transfer.download(await request('export-list', payload), 'LIRA-粉丝档案列表.csv', 'text/csv;charset=utf-8'),
      );
      return;
    }
    if (name === 'open-reminder') {
      await select(element.dataset.profileId, true, true);
      return;
    }
    if (name.startsWith('reminder-')) {
      await request('reminder-state', {
        profileId: element.dataset.profileId,
        key: element.dataset.reminderKey,
        status: name.slice(9),
      });
      await loadReminders();
      return;
    }
    if (!state.profile) return;
    if (name === 'edit-profile') {
      editProfile(state.profile);
      return;
    }
    if (name === 'legacy') {
      transfer.legacy();
      return;
    }
    if (name.startsWith('new-')) {
      editRecord(name.slice(4));
      return;
    }
    if (name === 'edit-record') {
      const record = state.profile.records.find((r) => r.id === element.dataset.recordId);
      if (record) editRecord(record.kind, record);
      return;
    }
    if (name.startsWith('resolve-')) {
      state.profile = await request('resolve-membership', {
        profileId: state.profile.id,
        id: element.dataset.recordId,
        choice: name.slice(8),
      });
    } else if (name === 'archive') {
      const profile = state.profile;
      const selection = state.selection;
      const saved = await request('save', {
        id: profile.id,
        revision: profile.revision,
        archived: !profile.archived,
      });
      if (saved.archived !== state.archived) {
        state.profiles = state.profiles.filter((item) => item.id !== saved.id);
        if (selection === state.selection || state.selectionId === saved.id) clearSelection();
        else if (state.profile?.id === saved.id) clearSelection(true);
      }
      toast(saved.archived ? '已归档，资料仍保留。可在‘已归档’中恢复。' : '已恢复到主列表，可在‘当前档案’中查看。');
      await load();
      return;
    } else if (name === 'favorite') {
      state.profile = await request('save', {
        id: state.profile.id,
        revision: state.profile.revision,
        favorite: !state.profile.favorite,
      });
    } else if (name === 'delete') {
      const id = state.profile.id;
      openForm(
        {
          title: '永久删除档案',
          saveLabel: '确认永久删除',
          hint: '档案、手记与提醒状态会删除，原始礼物账本不受影响。此操作不能撤销。',
          fields: `<p class="fan-field-wide">即将删除 ${html(state.profile.alias || state.profile.platformName)}。建议先保存完整备份。</p><label class="fan-check"><input name="suppress" type="checkbox" checked />不再为这位粉丝自动建档</label><label class="fan-check"><input name="confirm" type="checkbox" required />我确认永久删除</label>`,
          read: (value) => ({
            id,
            confirm: value.elements.confirm.checked,
            suppress: value.elements.suppress.checked,
          }),
        },
        async (payload) => {
          await request('delete', payload);
          state.profile = null;
          updateMarkup(detailNode, '<p class="fan-empty">档案已删除。</p>');
          await load();
        },
      );
      return;
    }
    await load();
    renderSelected();
  }

  document.addEventListener('click', (event) => {
    const element = event.target.closest?.(
      '[data-fan-action], [data-fan-id], [data-fan-tab], [data-fan-page], [data-fan-filter]',
    );
    if (!element) return;
    void (async () => {
      if (element.dataset.fanAction) await action(element.dataset.fanAction, element);
      else if (element.dataset.fanId) await select(element.dataset.fanId);
      else if (element.dataset.fanTab) {
        state.tab = element.dataset.fanTab;
        renderSelected();
      } else if (element.dataset.fanPage) {
        state.page = element.dataset.fanPage;
        showPage();
      } else if ('fanFilter' in element.dataset) {
        const filter = element.dataset.fanFilter;
        state.filters = filter
          ? state.filters.includes(filter)
            ? state.filters.filter((v) => v !== filter)
            : [...state.filters, filter]
          : [];
        for (const button of root.querySelectorAll('[data-fan-filter]'))
          button.setAttribute(
            'aria-pressed',
            String(button.dataset.fanFilter ? state.filters.includes(button.dataset.fanFilter) : !state.filters.length),
          );
        await load();
      }
    })().catch((error) => showError(error));
  });
  form.addEventListener('submit', async (event) => {
    event.preventDefault();
    const description = state.editor;
    if (!description || get('fanSaveButton').disabled) return;
    get('fanSaveButton').disabled = true;
    get('fanSaveButton').textContent = description.busyLabel || '正在保存…';
    form.querySelector('[data-fan-action="cancel-edit"]').disabled = true;
    form.setAttribute('aria-busy', 'true');
    get('fanEditorError').hidden = true;
    try {
      const result = await description.save(description.read(form));
      if (!result?.keepOpen) {
        editor.close();
        toast(result?.message || '已保存到本机');
      }
    } catch (error) {
      showError(error, true);
    } finally {
      get('fanSaveButton').disabled = false;
      get('fanSaveButton').textContent = state.editor.saveLabel || '保存';
      form.querySelector('[data-fan-action="cancel-edit"]').disabled = false;
      form.removeAttribute('aria-busy');
    }
  });
  editor.addEventListener('cancel', (event) => {
    if (get('fanSaveButton').disabled) event.preventDefault();
  });
  get('fanSearch').addEventListener('input', () => {
    clearTimeout(searchTimer);
    searchTimer = setTimeout(() => {
      void load().catch((error) => showError(error));
    }, 180);
  });
  get('fanRestoreFile').addEventListener('change', () => {
    const file = get('fanRestoreFile').files[0];
    get('fanRestoreFile').value = '';
    if (file) void transfer.restoreFile(file).catch((error) => showError(error));
  });
  const observer = new MutationObserver(() => {
    if (!panel.hidden)
      void load(true)
        .then(() => {
          if (!state.settings.initialized && !editor.open) settings();
        })
        .catch((error) => showError(error));
  });
  observer.observe(panel, { attributes: true, attributeFilter: ['hidden'] });
  const namesObserver = new ResizeObserver(fitPeopleNames);
  namesObserver.observe(get('fanPeople'));
  if (!panel.hidden)
    void load(true)
      .then(() => {
        if (!state.settings.initialized) settings();
      })
      .catch((error) => showError(error));
  pollTimer = setInterval(() => {
    if (!panel.hidden && !editor.open && state.contextId) {
      const id = state.profile?.id;
      const selection = state.selection;
      void load(true, true)
        .then(async (loaded) => {
          if (!loaded || !id || selection !== state.selection || state.profile?.id !== id) return;
          const profile = await request('detail', { id });
          if (selection !== state.selection || state.profile?.id !== id) return;
          state.profile = profile;
          renderSelected();
        })
        .catch((error) => showError(error));
    }
  }, 30000);
  window.addEventListener(
    'pagehide',
    () => {
      observer.disconnect();
      namesObserver.disconnect();
      clearInterval(pollTimer);
      clearTimeout(searchTimer);
    },
    { once: true },
  );

  return true;
}

export function initFanProfiles() {
  if (!initialized) initialized = createFanUi();
}
