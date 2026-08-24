// 编写人：Aurora
// 主播工作台：围绕一场直播保存提词与速记，数据仅留在当前设备。
'use strict';

(function () {
  const STORAGE_KEY = 'admin.streamerWorkbench.v2';
  const LEGACY_STORAGE_KEY = 'admin.streamerPlanner.v1';
  const STAGES = ['before', 'live', 'after'];
  const NOTE_TYPES = ['idea', 'promise', 'review'];
  const NOTE_LABELS = {
    idea: '话题灵感',
    promise: '观众请求',
    review: '高光时刻'
  };
  const NOTE_STAGE = {
    idea: 'live',
    promise: 'live',
    review: 'after'
  };
  const STAGE_CONFIG = {
    before: {
      listId: 'plannerBeforeList',
      countId: 'plannerBeforeCount',
      empty: '还没有开场提词，写下开播后第一句要说的话。'
    },
    live: {
      listId: 'plannerLiveList',
      countId: 'plannerLiveCount',
      empty: '把互动问题、备用话题和中场提醒放在这里。'
    },
    after: {
      listId: 'plannerAfterList',
      countId: 'plannerAfterCount',
      empty: '把感谢、回顾和下次预告放在这里。'
    }
  };
  const STARTER_TASKS = [
    { id: 'starter-device-check', title: '欢迎刚进来的观众，简单说明今天播什么', stage: 'before', done: false },
    { id: 'starter-show-info', title: '开场问大家：今天最想听哪类歌？', stage: 'before', done: false },
    { id: 'starter-show-assets', title: '冷场时聊：最近单曲循环的一首歌', stage: 'live', done: false },
    { id: 'starter-interaction-choice', title: '让大家二选一：下一首唱轻快的还是抒情的？', stage: 'live', done: false },
    { id: 'starter-midstream-reminder', title: '中场再说一次点歌方式和本场主题', stage: 'live', done: false },
    { id: 'starter-review', title: '结束前预告下次直播时间和内容', stage: 'after', done: false }
  ];
  const OBSOLETE_STARTER_TASKS = {
    'starter-device-check': {
      titles: ['检查麦克风、耳返、画面和网络'],
      replacementId: 'starter-device-check'
    },
    'starter-show-info': {
      titles: ['确认直播标题、封面和开播公告'],
      replacementId: 'starter-show-info'
    },
    'starter-show-assets': {
      titles: ['打开场景、歌单和直播要用的页面'],
      replacementId: 'starter-show-assets'
    },
    'starter-preflight': {
      titles: ['开播前检查麦克风、耳返和网络'],
      replacementId: 'starter-device-check'
    },
    'starter-announcement': {
      titles: ['写好今天的直播标题和开播公告'],
      replacementId: 'starter-show-info'
    },
    'starter-song': {
      titles: ['添加本周要学的第一首歌'],
      replacementId: 'starter-show-assets'
    },
    'starter-clip': {
      titles: ['剪出一条值得分享的直播切片'],
      replacementId: 'starter-interaction-choice'
    },
    'starter-library': {
      titles: ['整理一次可点歌单'],
      replacementId: 'starter-midstream-reminder'
    },
    'starter-review': {
      titles: ['看看本月最受欢迎的歌和直播时段', '记下高光时间点和需要改进的问题'],
      replacementId: 'starter-review'
    }
  };

  function createItemId(prefix) {
    if (globalThis.crypto?.randomUUID) return globalThis.crypto.randomUUID();
    return `${prefix}-${Date.now()}-${Math.random().toString(16).slice(2)}`;
  }

  function todayValue() {
    const today = new Date();
    const year = today.getFullYear();
    const month = String(today.getMonth() + 1).padStart(2, '0');
    const day = String(today.getDate()).padStart(2, '0');
    return `${year}-${month}-${day}`;
  }

  function createDefaultSession() {
    return {
      date: todayValue(),
      time: '20:00',
      title: '',
      goal: ''
    };
  }

  function normalizeSession(value = {}) {
    const fallback = createDefaultSession();
    const date = String(value.date || '');
    const time = String(value.time || '');
    return {
      date: /^\d{4}-\d{2}-\d{2}$/.test(date) ? date : fallback.date,
      time: /^\d{2}:\d{2}$/.test(time) ? time : fallback.time,
      title: String(value.title || '').slice(0, 60),
      goal: String(value.goal || '').slice(0, 100)
    };
  }

  function inferStage(value = {}) {
    if (STAGES.includes(value.stage)) return value.stage;
    if (value.category === 'review') return 'after';
    return 'before';
  }

  function normalizeTask(value, fallbackId = '') {
    if (!value || typeof value !== 'object') return null;
    const title = String(value.title || '').trim().slice(0, 80);
    if (!title) return null;

    return {
      id: String(value.id || fallbackId || createItemId('task')),
      title,
      stage: inferStage(value),
      done: value.done === true || Number(value.progress) === 100,
      createdAt: String(value.createdAt || new Date().toISOString())
    };
  }

  function upgradeStarterTask(task) {
    const obsolete = OBSOLETE_STARTER_TASKS[task.id];
    if (!obsolete?.titles.includes(task.title)) return task;

    const replacement = STARTER_TASKS.find((item) => item.id === obsolete.replacementId);
    if (!replacement) return task;
    return normalizeTask({
      ...replacement,
      createdAt: task.createdAt,
      done: false
    }, replacement.id);
  }

  function normalizeTasks(values, fallbackPrefix) {
    return values
      .map((task, index) => normalizeTask(task, `${fallbackPrefix}-${index}`))
      .filter(Boolean)
      .map(upgradeStarterTask);
  }

  function normalizeNote(value, fallbackId = '') {
    if (!value || typeof value !== 'object') return null;
    const body = String(value.body || '').trim().slice(0, 300);
    if (!body) return null;

    return {
      id: String(value.id || fallbackId || createItemId('note')),
      body,
      type: NOTE_TYPES.includes(value.type) ? value.type : 'idea',
      createdAt: String(value.createdAt || new Date().toISOString()),
      promotedTaskId: value.promotedTaskId ? String(value.promotedTaskId) : ''
    };
  }

  function createDefaultState(includeStarters = true) {
    return {
      version: 2,
      session: createDefaultSession(),
      tasks: includeStarters
        ? STARTER_TASKS.map((task) => normalizeTask(task)).filter(Boolean)
        : [],
      notes: []
    };
  }

  function normalizeState(value) {
    if (!value || typeof value !== 'object' || Array.isArray(value)) {
      return createDefaultState(false);
    }
    return {
      version: 2,
      session: normalizeSession(value.session),
      tasks: Array.isArray(value.tasks) ? normalizeTasks(value.tasks, 'restored-task') : [],
      notes: Array.isArray(value.notes)
        ? value.notes.map((note, index) => normalizeNote(note, `restored-note-${index}`)).filter(Boolean)
        : []
    };
  }

  function readStoredJson(key) {
    try {
      const stored = window.localStorage?.getItem(key);
      if (stored === null || stored === undefined) return null;
      return JSON.parse(stored);
    } catch {
      return null;
    }
  }

  function readState() {
    const current = readStoredJson(STORAGE_KEY);
    if (current !== null) return normalizeState(current);

    const legacy = readStoredJson(LEGACY_STORAGE_KEY);
    if (Array.isArray(legacy)) {
      const migrated = createDefaultState(false);
      migrated.tasks = normalizeTasks(legacy, 'migrated-task');
      return migrated;
    }

    return createDefaultState(true);
  }

  const moduleState = {
    initialized: false,
    planner: readState()
  };

  function storeState() {
    try {
      window.localStorage?.setItem(STORAGE_KEY, JSON.stringify(moduleState.planner));
    } catch {
      // The workbench remains usable for the current session when storage is disabled.
    }
  }

  function getState() {
    return {
      version: 2,
      session: { ...moduleState.planner.session },
      tasks: moduleState.planner.tasks.map((task) => ({ ...task })),
      notes: moduleState.planner.notes.map((note) => ({ ...note }))
    };
  }

  function getTasks() {
    return moduleState.planner.tasks.map((task) => ({ ...task }));
  }

  function updateSession(patch = {}) {
    const session = moduleState.planner.session;
    if (patch.date !== undefined && /^\d{4}-\d{2}-\d{2}$/.test(String(patch.date))) {
      session.date = String(patch.date);
    }
    if (patch.time !== undefined && /^\d{2}:\d{2}$/.test(String(patch.time))) {
      session.time = String(patch.time);
    }
    if (patch.title !== undefined) session.title = String(patch.title || '').slice(0, 60);
    if (patch.goal !== undefined) session.goal = String(patch.goal || '').slice(0, 100);
    storeState();
    const saveState = document.getElementById('plannerSaveState');
    if (saveState) saveState.textContent = '已自动保存';
    return { ...session };
  }

  function addTask(input = {}) {
    const task = normalizeTask({
      ...input,
      id: input.id || createItemId('task'),
      done: input.done === true || Number(input.progress) === 100
    });
    if (!task) return null;

    moduleState.planner.tasks.push(task);
    storeState();
    render();
    return { ...task };
  }

  function updateTask(taskId, patch = {}) {
    const task = moduleState.planner.tasks.find((item) => item.id === taskId);
    if (!task) return null;

    if (patch.title !== undefined) {
      const title = String(patch.title || '').trim().slice(0, 80);
      if (title) task.title = title;
    }
    if (STAGES.includes(patch.stage)) task.stage = patch.stage;
    if (patch.done !== undefined) task.done = patch.done === true;
    if (patch.progress !== undefined) task.done = Number(patch.progress) === 100;

    storeState();
    render();
    return { ...task };
  }

  function removeTask(taskId) {
    const taskIndex = moduleState.planner.tasks.findIndex((task) => task.id === taskId);
    if (taskIndex < 0) return false;
    moduleState.planner.tasks.splice(taskIndex, 1);
    storeState();
    render();
    return true;
  }

  function addNote(input = {}) {
    const note = normalizeNote({
      ...input,
      id: input.id || createItemId('note')
    });
    if (!note) return null;

    moduleState.planner.notes.push(note);
    storeState();
    render();
    return { ...note };
  }

  function removeNote(noteId) {
    const noteIndex = moduleState.planner.notes.findIndex((note) => note.id === noteId);
    if (noteIndex < 0) return false;
    moduleState.planner.notes.splice(noteIndex, 1);
    storeState();
    render();
    return true;
  }

  function promoteNote(noteId) {
    const note = moduleState.planner.notes.find((item) => item.id === noteId);
    if (!note) return null;

    const existingTask = moduleState.planner.tasks.find((task) => task.id === note.promotedTaskId);
    if (existingTask) return { ...existingTask };

    const task = normalizeTask({
      title: note.body,
      stage: NOTE_STAGE[note.type],
      id: createItemId('task')
    });
    if (!task) return null;

    moduleState.planner.tasks.push(task);
    note.promotedTaskId = task.id;
    storeState();
    render();
    return { ...task };
  }

  function createElement(tagName, className = '', text = '') {
    const element = document.createElement(tagName);
    if (className) element.className = className;
    if (text) element.textContent = text;
    return element;
  }

  function renderSession() {
    if (!document.getElementById('streamerPlanner')) return;
    const fields = {
      date: document.getElementById('plannerSessionDate'),
      time: document.getElementById('plannerSessionTime'),
      title: document.getElementById('plannerSessionTitle'),
      goal: document.getElementById('plannerSessionGoal')
    };

    Object.entries(fields).forEach(([key, field]) => {
      if (field && document.activeElement !== field) field.value = moduleState.planner.session[key];
    });

    const saveState = document.getElementById('plannerSaveState');
    if (saveState) saveState.textContent = '已自动保存';
  }

  function renderEmptyTaskState(stage) {
    const empty = createElement('div', 'planner-empty-state');
    empty.append(
      createElement('span', 'planner-empty-icon', '+'),
      createElement('p', '', STAGE_CONFIG[stage].empty)
    );
    empty.firstElementChild?.setAttribute('aria-hidden', 'true');
    return empty;
  }

  function renderTask(task) {
    const row = createElement('article', 'planner-task-row');
    row.dataset.taskId = task.id;
    row.setAttribute('role', 'listitem');
    if (task.done) row.classList.add('is-complete');

    const check = createElement('button', 'planner-task-check', task.done ? '✓' : '');
    check.type = 'button';
    check.dataset.taskComplete = task.id;
    check.setAttribute('aria-label', task.done ? `将“${task.title}”标为未完成` : `完成“${task.title}”`);
    check.setAttribute('aria-pressed', String(task.done));

    const title = createElement('span', 'planner-task-copy', task.title);

    const remove = createElement('button', 'planner-task-delete', '×');
    remove.type = 'button';
    remove.dataset.taskDelete = task.id;
    remove.title = '删除这条提词';
    remove.setAttribute('aria-label', `删除“${task.title}”`);

    row.append(check, title, remove);
    return row;
  }

  function renderStage(stage) {
    const config = STAGE_CONFIG[stage];
    const list = document.getElementById(config.listId);
    if (!list) return;

    const tasks = moduleState.planner.tasks.filter((task) => task.stage === stage);
    list.replaceChildren(...(tasks.length ? tasks.map(renderTask) : [renderEmptyTaskState(stage)]));

    const count = document.getElementById(config.countId);
    const completed = tasks.filter((task) => task.done).length;
    if (count) count.textContent = tasks.length ? `${completed} / ${tasks.length}` : '0 项';
  }

  function renderPlanSummary() {
    const completed = moduleState.planner.tasks.filter((task) => task.done).length;
    const total = moduleState.planner.tasks.length;
    const summary = document.getElementById('plannerPlanSummary');
    const status = document.getElementById('plannerPlanStatus');
    if (summary) summary.textContent = `${completed} / ${total}`;
    if (status) {
      status.textContent = total === 0
        ? '还没有提词'
        : completed === total
          ? '本场提词已走完'
          : `还有 ${total - completed} 条提醒`;
    }
  }

  function formatNoteTime(value) {
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return '';
    return new Intl.DateTimeFormat('zh-CN', {
      month: 'numeric',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit'
    }).format(date);
  }

  function renderEmptyNoteState() {
    const empty = createElement('div', 'planner-note-empty');
    empty.append(
      createElement('span', '', '✦'),
      createElement('strong', '', '直播里的请求和灵感，先放这里'),
      createElement('p', '', '点歌、待回应的问题和高光时间点都可以随手记。')
    );
    empty.firstElementChild?.setAttribute('aria-hidden', 'true');
    return empty;
  }

  function renderNote(note) {
    const card = createElement('article', `planner-note-card note-${note.type}`);
    card.setAttribute('role', 'listitem');

    const head = createElement('div', 'planner-note-card-head');
    const type = createElement('span', 'planner-note-type', NOTE_LABELS[note.type]);
    const time = createElement('time', '', formatNoteTime(note.createdAt));
    time.dateTime = note.createdAt;
    head.append(type, time);

    const body = createElement('p', 'planner-note-copy', note.body);
    const actions = createElement('div', 'planner-note-card-actions');

    const promotedTask = moduleState.planner.tasks.find((task) => task.id === note.promotedTaskId);
    const promote = createElement('button', 'planner-note-promote', promotedTask ? '已转成提词' : '转成提词');
    promote.type = 'button';
    promote.dataset.notePromote = note.id;
    promote.disabled = Boolean(promotedTask);

    const remove = createElement('button', 'planner-note-delete', '删除');
    remove.type = 'button';
    remove.dataset.noteDelete = note.id;
    remove.setAttribute('aria-label', `删除备忘“${note.body}”`);

    actions.append(promote, remove);
    card.append(head, body, actions);
    return card;
  }

  function renderNotes() {
    const list = document.getElementById('plannerNoteList');
    if (!list) return;
    const notes = [...moduleState.planner.notes].reverse();
    list.replaceChildren(...(notes.length ? notes.map(renderNote) : [renderEmptyNoteState()]));

    const count = document.getElementById('plannerNoteCount');
    if (count) count.textContent = `${notes.length} 条`;
  }

  function render() {
    if (!document.getElementById('streamerPlanner')) return;
    renderSession();
    STAGES.forEach(renderStage);
    renderPlanSummary();
    renderNotes();
  }

  function init() {
    const root = document.getElementById('streamerPlanner');
    if (!root || moduleState.initialized) return;

    const sessionForm = document.getElementById('plannerSessionForm');
    const taskForm = document.getElementById('plannerTaskForm');
    const taskTitle = document.getElementById('plannerTaskTitle');
    const taskStage = document.getElementById('plannerTaskStage');
    const noteForm = document.getElementById('plannerNoteForm');
    const noteBody = document.getElementById('plannerNoteBody');
    const noteType = document.getElementById('plannerNoteType');

    sessionForm?.addEventListener('input', (event) => {
      const field = event.target.closest('[data-session-field]');
      if (field) updateSession({ [field.dataset.sessionField]: field.value });
    });

    taskForm?.addEventListener('submit', (event) => {
      event.preventDefault();
      const task = addTask({ title: taskTitle?.value, stage: taskStage?.value });
      if (!task || !taskTitle) return;
      taskTitle.value = '';
      taskTitle.focus();
    });

    noteForm?.addEventListener('submit', (event) => {
      event.preventDefault();
      const note = addNote({ body: noteBody?.value, type: noteType?.value });
      if (!note || !noteBody) return;
      noteBody.value = '';
      noteBody.focus();
    });

    root.addEventListener('click', (event) => {
      const template = event.target.closest('[data-planner-template]');
      if (template) {
        addTask({ title: template.dataset.title, stage: template.dataset.stage });
        return;
      }

      const taskDelete = event.target.closest('[data-task-delete]');
      if (taskDelete) {
        removeTask(taskDelete.dataset.taskDelete);
        return;
      }

      const taskComplete = event.target.closest('[data-task-complete]');
      if (taskComplete) {
        const task = moduleState.planner.tasks.find((item) => item.id === taskComplete.dataset.taskComplete);
        if (task) updateTask(task.id, { done: !task.done });
        return;
      }

      const notePromote = event.target.closest('[data-note-promote]');
      if (notePromote) {
        promoteNote(notePromote.dataset.notePromote);
        return;
      }

      const noteDelete = event.target.closest('[data-note-delete]');
      if (noteDelete) removeNote(noteDelete.dataset.noteDelete);
    });

    storeState();
    render();
    moduleState.initialized = true;
  }

  window.AdminApp = window.AdminApp || {};
  window.AdminApp.todo = {
    init,
    updateSession,
    addTask,
    updateTask,
    removeTask,
    getTasks,
    addNote,
    removeNote,
    promoteNote,
    getState
  };
})();
