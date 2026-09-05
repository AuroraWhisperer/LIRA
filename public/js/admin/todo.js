// 编写人：Aurora
// 本机工作台：日历、备忘与待办。
'use strict';

import {
  STORAGE_KEY,
  PREVIOUS_STORAGE_KEY,
  LEGACY_STORAGE_KEY,
  STAGES,
  NOTE_LABELS,
  NOTE_STAGE,
  EVENT_LABELS,
  createItemId,
  toDateValue,
  getCalendarDays,
  shiftMonth,
  normalizeEvent,
  normalizeTask,
  normalizeTasks,
  normalizeNote,
  createDefaultState,
  normalizeState,
} from './todo-model.js';
import {
  dangerConfirm,
  showConfirmationDialog,
} from '../shared/confirmation-dialog.js';

(function () {
  let readFailed = false;

  function readStoredJson(key) {
    const stored = window.localStorage.getItem(key);
    return stored === null || stored === undefined
      ? undefined
      : JSON.parse(stored);
  }

  function readState() {
    try {
      const current = readStoredJson(STORAGE_KEY);
      if (current !== undefined) {
        if (
          current.version !== 3 ||
          !Array.isArray(current.tasks) ||
          !Array.isArray(current.notes) ||
          !Array.isArray(current.events)
        ) {
          throw new Error('Invalid workbench data');
        }
        return normalizeState(current);
      }
      const previous = readStoredJson(PREVIOUS_STORAGE_KEY);
      if (previous !== undefined) {
        if (!Array.isArray(previous.tasks) || !Array.isArray(previous.notes)) {
          throw new Error('Invalid previous workbench data');
        }
        return normalizeState(previous);
      }
      const legacy = readStoredJson(LEGACY_STORAGE_KEY);
      if (legacy !== undefined && !Array.isArray(legacy)) {
        throw new Error('Invalid legacy workbench data');
      }
      const state = createDefaultState();
      if (legacy) state.tasks = normalizeTasks(legacy, 'migrated-task', true);
      return state;
    } catch {
      // Do not replace unreadable records with an empty workbench.
      readFailed = true;
      return createDefaultState();
    }
  }

  const moduleState = {
    initialized: false,
    planner: readState(),
    selectedDate: toDateValue(),
    month: toDateValue().slice(0, 7),
    taskFilter: 'pending',
    editingNoteId: '',
    editingEventId: '',
    saveFailed: false,
  };

  const byId = (id) => document.getElementById(id);

  function storeState() {
    if (readFailed) return;
    try {
      window.localStorage.setItem(
        STORAGE_KEY,
        JSON.stringify(moduleState.planner),
      );
      moduleState.saveFailed = false;
    } catch {
      moduleState.saveFailed = true;
    }
  }

  function commit() {
    storeState();
    render();
  }

  function getState() {
    return {
      version: 3,
      session: { ...moduleState.planner.session },
      tasks: getTasks(),
      notes: moduleState.planner.notes.map((note) => ({ ...note })),
      events: moduleState.planner.events.map((event) => ({ ...event })),
    };
  }

  function getTasks() {
    return moduleState.planner.tasks.map((task) => ({ ...task }));
  }

  function updateSession(patch = {}) {
    const session = moduleState.planner.session;
    if (/^\d{4}-\d{2}-\d{2}$/.test(String(patch.date)))
      session.date = String(patch.date);
    if (/^\d{2}:\d{2}$/.test(String(patch.time)))
      session.time = String(patch.time);
    if (patch.title !== undefined)
      session.title = String(patch.title || '').slice(0, 60);
    if (patch.goal !== undefined)
      session.goal = String(patch.goal || '').slice(0, 100);
    commit();
    return { ...session };
  }

  function addTask(input = {}) {
    const task = normalizeTask({
      ...input,
      id: input.id || createItemId('task'),
    });
    if (!task) return null;
    moduleState.planner.tasks.push(task);
    moduleState.taskFilter = task.done ? 'done' : 'pending';
    commit();
    return { ...task };
  }

  function updateTask(taskId, patch = {}) {
    const task = moduleState.planner.tasks.find((item) => item.id === taskId);
    if (!task) return null;
    if (patch.title !== undefined) {
      const title = String(patch.title || '')
        .trim()
        .slice(0, 80);
      if (title) task.title = title;
    }
    if (STAGES.includes(patch.stage)) task.stage = patch.stage;
    if (patch.done !== undefined) task.done = patch.done === true;
    if (patch.progress !== undefined)
      task.done = Number(patch.progress) === 100;
    commit();
    return { ...task };
  }

  function removeItem(collection, id) {
    const items = moduleState.planner[collection];
    const index = items.findIndex((item) => item.id === id);
    if (index < 0) return false;
    items.splice(index, 1);
    commit();
    return true;
  }

  function removeTask(taskId) {
    return removeItem('tasks', taskId);
  }
  function removeNote(noteId) {
    return removeItem('notes', noteId);
  }
  function removeEvent(eventId) {
    return removeItem('events', eventId);
  }

  function addNote(input = {}) {
    const note = normalizeNote({
      ...input,
      id: input.id || createItemId('note'),
    });
    if (!note) return null;
    moduleState.planner.notes.push(note);
    commit();
    return { ...note };
  }

  function updateNote(noteId, patch = {}) {
    const index = moduleState.planner.notes.findIndex(
      (note) => note.id === noteId,
    );
    if (index < 0) return null;
    const original = moduleState.planner.notes[index];
    const note = normalizeNote({
      ...original,
      ...patch,
      id: original.id,
      createdAt: original.createdAt,
      promotedTaskId: original.promotedTaskId,
    });
    if (!note) return null;
    moduleState.planner.notes[index] = note;
    commit();
    return { ...note };
  }

  function promoteNote(noteId) {
    const note = moduleState.planner.notes.find((item) => item.id === noteId);
    if (!note) return null;
    const existing = moduleState.planner.tasks.find(
      (task) => task.id === note.promotedTaskId,
    );
    if (existing) return { ...existing };
    const task = normalizeTask({
      title: note.body,
      stage: NOTE_STAGE[note.type],
      id: createItemId('task'),
    });
    if (!task) return null;
    moduleState.planner.tasks.push(task);
    moduleState.taskFilter = 'pending';
    note.promotedTaskId = task.id;
    commit();
    return { ...task };
  }

  function addEvent(input = {}) {
    const event = normalizeEvent({ ...input, id: createItemId('event') });
    if (!event) return null;
    moduleState.planner.events.push(event);
    moduleState.selectedDate = event.date;
    moduleState.month = event.date.slice(0, 7);
    commit();
    return { ...event };
  }

  function updateEvent(eventId, patch = {}) {
    const index = moduleState.planner.events.findIndex(
      (event) => event.id === eventId,
    );
    if (index < 0) return null;
    const original = moduleState.planner.events[index];
    const event = normalizeEvent({
      ...original,
      ...patch,
      id: original.id,
      createdAt: original.createdAt,
    });
    if (!event) return null;
    moduleState.planner.events[index] = event;
    moduleState.selectedDate = event.date;
    moduleState.month = event.date.slice(0, 7);
    commit();
    return { ...event };
  }

  function createElement(tag, className = '', text = '') {
    const element = document.createElement(tag);
    if (className) element.className = className;
    if (text) element.textContent = text;
    return element;
  }

  function createIcon(name) {
    const icon = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    icon.setAttribute('class', 'planner-icon');
    icon.setAttribute('aria-hidden', 'true');
    const use = document.createElementNS('http://www.w3.org/2000/svg', 'use');
    use.setAttribute('href', `/img/admin/workbench-icons.svg#${name}`);
    icon.append(use);
    return icon;
  }

  function iconButton(icon, label, action, id) {
    const button = createElement('button', 'planner-icon-button');
    button.type = 'button';
    button.title = label;
    button.setAttribute('aria-label', label);
    button.dataset[action] = id;
    button.append(createIcon(icon));
    return button;
  }

  function formatDate(value, options) {
    return new Intl.DateTimeFormat('zh-CN', options).format(
      new Date(`${value}T12:00:00`),
    );
  }

  function eventsForDate(date) {
    return moduleState.planner.events
      .filter((event) => event.date === date)
      .sort((a, b) => a.time.localeCompare(b.time));
  }

  function renderCalendar() {
    byId('plannerMonthLabel').textContent = formatDate(
      `${moduleState.month}-01`,
      { year: 'numeric', month: 'long' },
    );
    byId('plannerMonthCount').textContent =
      `本月 ${moduleState.planner.events.filter((event) => event.date.startsWith(moduleState.month)).length} 项安排`;
    byId('plannerCalendarGrid').replaceChildren(
      ...getCalendarDays(moduleState.month).map((day) => {
        const events = eventsForDate(day.date);
        const button = createElement('button', 'planner-calendar-day');
        button.type = 'button';
        button.dataset.calendarDate = day.date;
        button.classList.toggle('is-outside', !day.isCurrentMonth);
        button.classList.toggle('is-today', day.date === toDateValue());
        button.classList.toggle(
          'is-selected',
          day.date === moduleState.selectedDate,
        );
        button.tabIndex = day.date === moduleState.selectedDate ? 0 : -1;
        button.setAttribute(
          'aria-pressed',
          String(day.date === moduleState.selectedDate),
        );
        button.setAttribute(
          'aria-label',
          `${day.date}，${events.length} 项安排`,
        );
        if (day.date === toDateValue())
          button.setAttribute('aria-current', 'date');
        button.append(
          createElement(
            'span',
            'planner-calendar-day-number',
            String(Number(day.date.slice(-2))),
          ),
        );
        if (events.length) {
          const event = events[0];
          button.append(
            createElement(
              'span',
              `planner-calendar-event event-${event.type}`,
              event.title,
            ),
          );
          button.title = events
            .map((item) => `${item.time || '全天'} ${item.title}`)
            .join('\n');
        }
        if (events.length > 1)
          button.append(
            createElement(
              'span',
              'planner-calendar-more',
              `+${events.length - 1} 项`,
            ),
          );
        return button;
      }),
    );
  }

  function renderAgenda() {
    const date = moduleState.selectedDate;
    const events = eventsForDate(date);
    byId('plannerAgendaTitle').textContent =
      `${date === toDateValue() ? '今天 · ' : ''}${formatDate(date, { month: 'long', day: 'numeric', weekday: 'short' })}`;
    byId('plannerAgendaCount').textContent = `${events.length} 项安排`;
    byId('plannerAgendaList').replaceChildren(
      ...(events.length
        ? events.map((event) => {
            const row = createElement(
              'article',
              `planner-agenda-row event-${event.type}`,
            );
            row.setAttribute('role', 'listitem');
            const time = createElement(
              'time',
              'planner-agenda-time',
              event.time || '全天',
            );
            time.dateTime = event.time
              ? `${event.date}T${event.time}`
              : event.date;
            const open = createElement('button', 'planner-event-open');
            open.type = 'button';
            open.dataset.eventEdit = event.id;
            open.title = '编辑日程';
            open.append(createElement('strong', '', event.title));
            open.append(
              createElement(
                'span',
                '',
                event.detail || EVENT_LABELS[event.type],
              ),
            );
            row.append(
              time,
              open,
              iconButton('pencil', '编辑日程', 'eventEdit', event.id),
            );
            return row;
          })
        : [createElement('p', 'planner-empty-state', '这一天暂无安排')]),
    );
  }

  function renderTasks() {
    const tasks = moduleState.planner.tasks;
    const done = tasks.filter((task) => task.done).length;
    byId('plannerPendingCount').textContent = String(tasks.length - done);
    byId('plannerDoneCount').textContent = String(done);
    byId('streamerPlanner')
      .querySelectorAll('[data-task-filter]')
      .forEach((button) => {
        button.setAttribute(
          'aria-pressed',
          String(button.dataset.taskFilter === moduleState.taskFilter),
        );
      });
    const visible = tasks.filter(
      (task) => task.done === (moduleState.taskFilter === 'done'),
    );
    byId('plannerTaskList').replaceChildren(
      ...(visible.length
        ? visible.map((task) => {
            const row = createElement(
              'article',
              `planner-task-row${task.done ? ' is-complete' : ''}`,
            );
            row.setAttribute('role', 'listitem');
            const check = createElement('input', 'planner-task-check');
            check.type = 'checkbox';
            check.checked = task.done;
            check.dataset.taskComplete = task.id;
            check.setAttribute(
              'aria-label',
              `${task.done ? '恢复待办' : '完成'}：${task.title}`,
            );
            const title = createElement('input', 'planner-task-copy');
            title.type = 'text';
            title.maxLength = 80;
            title.value = task.title;
            title.title = task.title;
            title.dataset.taskTitle = task.id;
            title.setAttribute('aria-label', '编辑待办内容');
            row.append(
              check,
              title,
              iconButton('x', `删除待办：${task.title}`, 'taskDelete', task.id),
            );
            return row;
          })
        : [
            createElement(
              'p',
              'planner-empty-state',
              moduleState.taskFilter === 'done' ? '暂无已完成事项' : '暂无待办',
            ),
          ]),
    );
  }

  function renderNote(note) {
    const card = createElement(
      'article',
      `planner-note-card note-${note.type}${note.pinned ? ' is-pinned' : ''}`,
    );
    card.setAttribute('role', 'listitem');
    const head = createElement('div', 'planner-note-card-head');
    const date = new Date(note.createdAt);
    const time = createElement(
      'time',
      '',
      Number.isNaN(date.getTime())
        ? ''
        : new Intl.DateTimeFormat('zh-CN', {
            month: 'numeric',
            day: 'numeric',
          }).format(date),
    );
    time.dateTime = note.createdAt;
    const pin = iconButton(
      'pin',
      note.pinned ? '取消置顶' : '置顶备忘',
      'notePin',
      note.id,
    );
    pin.setAttribute('aria-pressed', String(note.pinned));
    head.append(
      createElement('span', 'planner-note-type', NOTE_LABELS[note.type]),
      time,
      pin,
    );
    const actions = createElement('div', 'planner-note-card-actions');
    const promoted = moduleState.planner.tasks.some(
      (task) => task.id === note.promotedTaskId,
    );
    const promote = createElement(
      'button',
      'planner-note-promote',
      promoted ? '已加入待办' : '转为待办',
    );
    promote.type = 'button';
    promote.dataset.notePromote = note.id;
    promote.disabled = promoted;
    if (!promoted) promote.append(createIcon('arrow-up-right'));
    actions.append(
      promote,
      iconButton('pencil', '编辑备忘', 'noteEdit', note.id),
      iconButton('x', '删除备忘', 'noteDelete', note.id),
    );
    card.append(
      head,
      createElement('p', 'planner-note-copy', note.body),
      actions,
    );
    return card;
  }

  function renderNotes() {
    const notes = [...moduleState.planner.notes]
      .reverse()
      .sort((a, b) => Number(b.pinned) - Number(a.pinned));
    byId('plannerNoteCount').textContent = `${notes.length} 条`;
    byId('plannerNoteList').replaceChildren(
      ...(notes.length
        ? notes.map(renderNote)
        : [createElement('p', 'planner-empty-state', '暂无备忘')]),
    );
  }

  function render() {
    if (!byId('streamerPlanner')) return;
    byId('plannerTodayLabel').textContent = formatDate(toDateValue(), {
      month: 'long',
      day: 'numeric',
      weekday: 'long',
    });
    const status = byId('plannerSaveState');
    status.textContent = readFailed
      ? '本机记录读取失败，已暂停写入'
      : moduleState.saveFailed
        ? '保存失败，请勿关闭页面'
        : '已保存到本机';
    status.classList.toggle('is-error', readFailed || moduleState.saveFailed);
    renderCalendar();
    renderAgenda();
    renderNotes();
    renderTasks();
  }

  function selectDate(date, focus = false) {
    moduleState.selectedDate = date;
    moduleState.month = date.slice(0, 7);
    renderCalendar();
    renderAgenda();
    if (focus)
      byId('plannerCalendarGrid')
        .querySelector('[aria-pressed="true"]')
        ?.focus();
  }

  function editNote(noteId = '') {
    const note = moduleState.planner.notes.find((item) => item.id === noteId);
    moduleState.editingNoteId = note?.id || '';
    byId('plannerNoteBody').value = note?.body || '';
    byId('plannerNoteType').value = note?.type || 'idea';
    byId('plannerNoteCancel').hidden = !note;
    byId('plannerNoteSubmit').textContent = note ? '保存修改' : '保存备忘';
    if (note) byId('plannerNoteBody').focus();
  }

  function openEvent(eventId = '') {
    const event = moduleState.planner.events.find(
      (item) => item.id === eventId,
    );
    moduleState.editingEventId = event?.id || '';
    byId('plannerEventDialogTitle').textContent = event
      ? '编辑日程'
      : '新建日程';
    byId('plannerEventTitle').value = event?.title || '';
    byId('plannerEventDate').value = event?.date || moduleState.selectedDate;
    byId('plannerEventTime').value = event ? event.time : '20:00';
    byId('plannerEventAllDay').checked = Boolean(event && !event.time);
    byId('plannerEventTime').disabled = byId('plannerEventAllDay').checked;
    byId('plannerEventDetail').value = event?.detail || '';
    byId('plannerEventForm')
      .querySelectorAll('[name="plannerEventType"]')
      .forEach((radio) => {
        radio.checked = radio.value === (event?.type || 'live');
      });
    byId('plannerEventDelete').hidden = !event;
    byId('plannerEventError').hidden = true;
    byId('plannerEventDialog').showModal();
    byId('plannerEventTitle').focus();
  }

  function init() {
    const root = byId('streamerPlanner');
    if (!root || moduleState.initialized) return;
    byId('plannerTaskForm').addEventListener('submit', (event) => {
      event.preventDefault();
      if (addTask({ title: byId('plannerTaskTitle').value })) {
        byId('plannerTaskTitle').value = '';
        byId('plannerTaskTitle').focus();
      }
    });
    byId('plannerNoteForm').addEventListener('submit', (event) => {
      event.preventDefault();
      const input = {
        body: byId('plannerNoteBody').value,
        type: byId('plannerNoteType').value,
      };
      const note = moduleState.editingNoteId
        ? updateNote(moduleState.editingNoteId, input)
        : addNote(input);
      if (note) editNote();
    });
    byId('plannerNoteCancel').addEventListener('click', () => editNote());
    byId('plannerGoToday').addEventListener('click', () =>
      selectDate(toDateValue()),
    );
    byId('plannerEventAllDay').addEventListener('change', (event) => {
      byId('plannerEventTime').disabled = event.target.checked;
    });
    byId('plannerEventForm').addEventListener('submit', (event) => {
      event.preventDefault();
      const input = {
        title: byId('plannerEventTitle').value,
        date: byId('plannerEventDate').value,
        time: byId('plannerEventAllDay').checked
          ? ''
          : byId('plannerEventTime').value,
        type: byId('plannerEventForm').querySelector(
          '[name="plannerEventType"]:checked',
        ).value,
        detail: byId('plannerEventDetail').value,
      };
      const saved = moduleState.editingEventId
        ? updateEvent(moduleState.editingEventId, input)
        : addEvent(input);
      if (saved) byId('plannerEventDialog').close();
      else {
        byId('plannerEventError').textContent =
          '请填写日程名称和有效的日期、时间。';
        byId('plannerEventError').hidden = false;
      }
    });
    byId('plannerEventDelete').addEventListener('click', async () => {
      const eventId = moduleState.editingEventId;
      if (!eventId) return;
      byId('plannerEventDialog').close();
      const confirmed = await dangerConfirm({
        title: '删除日程？',
        description: '删除后无法恢复。',
        confirmLabel: '删除日程',
      });
      if (confirmed) removeEvent(eventId);
      else openEvent(eventId);
    });
    root.addEventListener('change', (event) => {
      const target = event.target;
      if (target.dataset.taskComplete)
        updateTask(target.dataset.taskComplete, { done: target.checked });
      if (target.dataset.taskTitle)
        updateTask(target.dataset.taskTitle, { title: target.value });
    });
    root.addEventListener('click', async (event) => {
      const target = event.target.closest('button');
      if (!target) return;
      const data = target.dataset;
      if (data.monthOffset)
        selectDate(
          `${shiftMonth(moduleState.month, Number(data.monthOffset))}-01`,
        );
      if (data.calendarDate) selectDate(data.calendarDate, true);
      if (data.eventNew !== undefined) openEvent();
      if (data.eventEdit) openEvent(data.eventEdit);
      if (data.eventCancel !== undefined) byId('plannerEventDialog').close();
      if (data.taskFilter) {
        moduleState.taskFilter = data.taskFilter;
        renderTasks();
      }
      if (data.taskDelete) {
        const confirmed = await dangerConfirm({
          title: '删除待办？',
          description: '删除后无法恢复。',
          confirmLabel: '删除待办',
        });
        if (confirmed) removeTask(data.taskDelete);
      }
      if (data.notePromote) promoteNote(data.notePromote);
      if (data.noteEdit) {
        const body = byId('plannerNoteBody').value.trim();
        const previous = moduleState.planner.notes.find(
          (note) => note.id === moduleState.editingNoteId,
        );
        if (body && body !== previous?.body) {
          const confirmed = await showConfirmationDialog({
            variant: 'caution',
            title: '放弃修改？',
            description: '尚未保存的备忘内容将会丢失。',
            confirmLabel: '放弃修改',
            cancelLabel: '继续编辑',
            initialFocus: 'cancel',
          });
          if (!confirmed) return;
        }
        editNote(data.noteEdit);
      }
      if (data.notePin) {
        const note = moduleState.planner.notes.find(
          (item) => item.id === data.notePin,
        );
        if (note) updateNote(note.id, { pinned: !note.pinned });
      }
      if (data.noteDelete) {
        const confirmed = await dangerConfirm({
          title: '删除备忘？',
          description: '删除后无法恢复。',
          confirmLabel: '删除备忘',
        });
        if (confirmed) {
          if (moduleState.editingNoteId === data.noteDelete) editNote();
          removeNote(data.noteDelete);
        }
      }
    });
    byId('plannerCalendarGrid').addEventListener('keydown', (event) => {
      const offsets = {
        ArrowLeft: -1,
        ArrowRight: 1,
        ArrowUp: -7,
        ArrowDown: 7,
      };
      if (!offsets[event.key]) return;
      event.preventDefault();
      const date = new Date(`${moduleState.selectedDate}T12:00:00`);
      date.setDate(date.getDate() + offsets[event.key]);
      selectDate(toDateValue(date), true);
    });
    storeState();
    render();
    if (readFailed)
      root
        .querySelectorAll('button, input, select, textarea')
        .forEach((control) => {
          control.disabled = true;
        });
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
    updateNote,
    removeNote,
    promoteNote,
    addEvent,
    updateEvent,
    removeEvent,
    getState,
  };
})();
