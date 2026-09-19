import { createFanTransferUi } from './transfer-ui.js';
import { toast } from '../../shared/utils.js';
import { html, renderPeople, renderDetail, renderReminders } from './view.js';
import {
  profileForm,
  recordForm,
  settingsForm,
  exportForm,
  guardRosterForm,
} from './forms.js';

let instance;

function createFanUi() {
  const root = document.getElementById('fanProfilesWorkspace');
  if (!root) return null;
  const get = (id) => document.getElementById(id);
  const editor = get('fanEditor');
  const form = get('fanEditorForm');
  const detailNode = get('fanDetail');
  const quick = get('fanQuickDialog');
  const panel = get('otherFanProfilesFeature');
  // Queue shortcuts must remain usable while the toolbox page is hidden.
  document.body.append(editor, quick);
  const state = {
    contextId: null,
    roomId: '',
    profile: null,
    profiles: [],
    tab: 'overview',
    page: 'profiles',
    filters: [],
    archived: false,
    settings: {},
    syncStatus: 'pending',
    sequence: 0,
    selection: 0,
    editor: null,
    expanded: false,
    timelineFilter: '',
  };
  let searchTimer;
  let returnFocus;
  let pollTimer;
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
      detailNode.innerHTML =
        '<p class="fan-empty">恢复完成，请重新选择档案。</p>';
      await load();
    },
  });

  async function request(action, payload = {}) {
    if (!window.fanProfiles)
      throw new Error('粉丝档案在 Electron 桌面客户端中使用。');
    const contextId = state.contextId;
    const result = await window.fanProfiles.invoke({
      action,
      payload,
      contextId,
    });
    if (!result.ok) {
      const error = new Error(
        result.error || '档案操作失败，未保存的输入仍保留。',
      );
      error.existingId = result.existingId;
      throw error;
    }
    if (action !== 'open' && state.contextId !== contextId)
      throw new Error('登录状态已变化，请重新打开粉丝档案。');
    if (
      action === 'open' &&
      state.contextId &&
      state.contextId !== result.contextId
    ) {
      state.profile = null;
      state.selection++;
      state.tab = 'overview';
      get('fanRosterResult').hidden = true;
      detailNode.innerHTML =
        '<p class="fan-empty">登录状态已变化，请重新选择档案。</p>';
    }
    state.contextId = result.contextId;
    state.roomId = result.roomId || '';
    state.syncStatus = result.syncStatus;
    get('fanSyncState').textContent =
      {
        ready: '已同步',
        syncing: '资料仍在同步',
        pending: '资料仍在同步',
        offline: '离线 · 可维护本机档案',
        unsupported: '服务器尚未支持档案同步 · 可手动维护',
      }[result.syncStatus] || '';
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
          void transfer
            .mergeDraft(error.mergeInput, error.existingId)
            .catch((failure) => showError(failure, true));
        });
        node.append(' ', merge);
      }
    }
  }

  function renderSelected() {
    if (state.profile)
      detailNode.innerHTML = renderDetail(
        state.profile,
        state.tab,
        state.timelineFilter,
      );
    renderList();
  }

  function renderList() {
    const list = get('fanPeople');
    const scroll = list.scrollTop;
    list.innerHTML = renderPeople(
      state.profiles,
      state.profile?.id,
      Boolean(get('fanSearch').value || state.filters.length || state.archived),
    );
    list.scrollTop = scroll;
    get('fanSplit').classList.toggle(
      'fan-has-selection',
      Boolean(state.profile),
    );
    get('fanSplit').classList.toggle('fan-expanded', state.expanded);
  }

  async function load(open = false) {
    const sequence = ++state.sequence;
    get('fanPageError').hidden = true;
    const data = await request(open || !state.contextId ? 'open' : 'list', {
      query: get('fanSearch').value,
      filters: state.filters,
      archived: state.archived,
    });
    if (sequence !== state.sequence) return;
    state.profiles = data.profiles;
    state.settings = data.settings;
    renderList();
    await loadReminders();
  }

  async function loadReminders() {
    const items = await request('reminders');
    const actionable = items.filter((item) => item.actionable);
    const summary = get('fanReminderSummary');
    summary.hidden = !actionable.length;
    summary.innerHTML = actionable.length
      ? `<span>今天与近期有 ${actionable.length} 项重要日子待处理</span><button type="button" data-fan-page="reminders">查看提醒</button>`
      : '';
    get('fanRemindersPage').innerHTML = renderReminders(items);
  }

  async function select(id, resetTab = true) {
    const selection = ++state.selection;
    const profile = await request('detail', { id });
    if (selection !== state.selection) return;
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
    get('fanNewProfileButton').hidden = state.page !== 'profiles';
    get('fanArchivedNotice').hidden = !state.archived;
    for (const node of root.querySelectorAll('[data-fan-page][role="tab"]'))
      node.setAttribute(
        'aria-selected',
        String(node.dataset.fanPage === state.page),
      );
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
    form
      .querySelector(
        '[autofocus], textarea, input:not([type="checkbox"]), select',
      )
      ?.focus();
  }

  function editProfile(profile = {}, showQuick = false) {
    openForm(profileForm(profile), async (payload) => {
      try {
        state.profile = await request(profile.id ? 'save' : 'create', payload);
      } catch (error) {
        if (error.existingId && profile.id && !profile.identity)
          error.mergeInput = payload;
        throw error;
      }
      await load();
      renderSelected();
      if (showQuick) showQuickDetail();
    });
  }

  function editRecord(kind, record) {
    const profileId = state.profile.id;
    openForm(recordForm(kind, record), async (payload) => {
      const result = await request('save-record', { ...payload, profileId });
      state.profile = result.profile;
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

  function leaveQuick() {
    get('fanSplit').append(detailNode);
    if (quick.open) quick.close();
    returnFocus?.focus?.();
  }

  async function action(name, element) {
    if (name === 'cancel-edit') {
      if (get('fanSaveButton').disabled) return;
      editor.close();
      return;
    }
    if (name === 'back-queue') {
      leaveQuick();
      return;
    }
    if (name === 'expand') {
      if (quick.open) {
        leaveQuick();
        document
          .querySelector('[data-main-page="otherAssistantPage"]')
          ?.click();
        get('otherFanProfilesFeatureTab')?.click();
      }
      state.expanded = !state.expanded;
      renderList();
      return;
    }
    if (name === 'back-list') {
      state.profile = null;
      state.expanded = false;
      renderList();
      return;
    }
    if (!state.contextId) await load(true);
    if (name === 'guard-roster') {
      await load(true);
      if (!state.roomId) throw new Error('请先在连接设置中填写直播间号。');
      openForm(guardRosterForm(state.roomId), async (payload) => {
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
    if (name === 'archived' || name === 'back-profiles') {
      state.archived = name === 'archived';
      state.page = 'profiles';
      state.profile = null;
      state.selection++;
      state.expanded = false;
      detailNode.innerHTML = '<p class="fan-empty">选择一份档案查看详情</p>';
      showPage();
      await load();
      return;
    }
    if (name === 'backup') {
      const data = await request('backup');
      transfer.download(
        JSON.stringify(data, null, 2),
        'LIRA-粉丝档案备份.json',
        'application/json',
      );
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
    if (name === 'export') {
      openForm({ ...exportForm(), saveLabel: '导出 CSV' }, async (payload) =>
        transfer.download(
          await request('export-list', payload),
          'LIRA-粉丝档案列表.csv',
          'text/csv;charset=utf-8',
        ),
      );
      return;
    }
    if (name === 'open-reminder') {
      await select(element.dataset.profileId);
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
      const record = state.profile.records.find(
        (r) => r.id === element.dataset.recordId,
      );
      if (record) editRecord(record.kind, record);
      return;
    }
    if (name.startsWith('resolve-')) {
      state.profile = await request('resolve-membership', {
        profileId: state.profile.id,
        id: element.dataset.recordId,
        choice: name.slice(8),
      });
    } else if (name === 'archive' || name === 'favorite') {
      const key = name === 'archive' ? 'archived' : 'favorite';
      state.profile = await request('save', {
        id: state.profile.id,
        revision: state.profile.revision,
        [key]: !state.profile[key],
      });
    } else if (name === 'delete') {
      const id = state.profile.id;
      openForm(
        {
          title: '永久删除档案',
          saveLabel: '确认永久删除',
          hint: '档案、手记与提醒状态会删除，原始礼物账本不受影响。此操作不能撤销。',
          fields: `<p class="fan-field-wide">即将删除 ${html(state.profile.alias || state.profile.platformName)}。建议先保存完整备份。</p><label class="fan-check"><input name="suppress" type="checkbox" checked />停止为这个身份自动建档</label><label class="fan-check"><input name="confirm" type="checkbox" required />我确认永久删除</label>`,
          read: (value) => ({
            id,
            confirm: value.elements.confirm.checked,
            suppress: value.elements.suppress.checked,
          }),
        },
        async (payload) => {
          await request('delete', payload);
          state.profile = null;
          detailNode.innerHTML = '<p class="fan-empty">档案已删除。</p>';
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
      if (element.dataset.fanAction)
        await action(element.dataset.fanAction, element);
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
            String(
              button.dataset.fanFilter
                ? state.filters.includes(button.dataset.fanFilter)
                : !state.filters.length,
            ),
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
  document.addEventListener('change', (event) => {
    if (event.target.id === 'fanTimelineFilter') {
      state.timelineFilter = event.target.value;
      renderSelected();
    }
  });
  get('fanRestoreFile').addEventListener('change', () => {
    const file = get('fanRestoreFile').files[0];
    get('fanRestoreFile').value = '';
    if (file)
      void transfer.restoreFile(file).catch((error) => showError(error));
  });
  quick.addEventListener('close', () => {
    if (detailNode.parentNode === get('fanQuickHost')) leaveQuick();
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
  if (!panel.hidden)
    void load(true)
      .then(() => {
        if (!state.settings.initialized) settings();
      })
      .catch((error) => showError(error));
  pollTimer = setInterval(() => {
    if ((!panel.hidden || quick.open) && !editor.open && state.contextId) {
      void load(true)
        .then(() => {
          if (state.profile) return select(state.profile.id, false);
        })
        .catch((error) => showError(error));
    }
  }, 30000);
  window.addEventListener(
    'pagehide',
    () => {
      observer.disconnect();
      clearInterval(pollTimer);
      clearTimeout(searchTimer);
    },
    { once: true },
  );

  function showQuickDetail() {
    get('fanQuickHost').append(detailNode);
    if (!quick.open) quick.showModal();
  }

  return {
    async openQuick(identity, name) {
      returnFocus = document.activeElement;
      await load(true);
      const profile = await request('find', { identity });
      if (!profile) {
        editProfile({ alias: name || identity.value, identity }, true);
        return;
      }
      state.profile = profile;
      state.tab = 'overview';
      renderSelected();
      showQuickDetail();
    },
  };
}

export function initFanProfiles() {
  if (!instance) instance = createFanUi();
  return instance;
}

export async function openFanQuickProfile(identity, name) {
  return initFanProfiles()?.openQuick(identity, name);
}
