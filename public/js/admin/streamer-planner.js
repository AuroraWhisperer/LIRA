// 编写人：Aurora
// 本机工作台：日历、备忘与待办。
'use strict';

import { isPanelVisible, observePanelVisibility } from './panel-visibility.js';
import {
  STAGES,
  NOTE_STAGE,
  createItemId,
  toDateValue,
  shiftMonth,
  normalizeEvent,
  normalizeTask,
  normalizeNote,
} from './streamer-planner-model.js';
import { createPlannerStorage } from './streamer-planner-storage.js';
import { createPlannerReminderSync } from './streamer-planner-reminders.js';
import { createFanCalendar } from './fans/calendar.js';
import { dangerConfirm, showConfirmationDialog } from '../shared/confirmation-dialog.js';
import { toast } from '../shared/toast.js';

import {
  renderTodo,
  renderTodoCalendar,
  renderTodoAgenda,
  renderTodoTasks,
  renderTaskTitle,
  renderPlannerSaveState,
  readTodoAction,
} from './streamer-planner-view.js';

export const todo = (() => {
  const storage = createPlannerStorage(() => window.localStorage);

  const moduleState = {
    initialized: false,
    planner: storage.read(),
    selectedDate: toDateValue(),
    month: toDateValue().slice(0, 7),
    taskFilter: 'pending',
    editingNoteId: '',
    editingEventId: '',
  };
  const reminders = createPlannerReminderSync({
    getBridge: () => window.plannerReminders,
    onStatusChange: handleReminderStatus,
  });

  const byId = (id) => document.getElementById(id);
  const editedEvents = new WeakSet();
  let fanCalendar;
  let viewCache;
  let eventsRevision = 0;
  const reminderLimitHint = '待提醒日程最多 1000 条。请取消部分日程的提醒并保存，当前仍按上次同步的日程提醒。';

  function handleReminderStatus(status, previousStatus) {
    if (status === 'limit' && previousStatus !== 'limit') {
      toast(reminderLimitHint, { key: 'planner-reminders', update: true, type: 'error' });
    } else if (status === 'error' && previousStatus !== 'error') {
      toast('日程提醒没设好，请重新保存一次日程。', { key: 'planner-reminders', update: true, type: 'error' });
    } else if (status === 'ready' && (previousStatus === 'error' || previousStatus === 'limit')) {
      toast('日程提醒已恢复。LIRA 运行时会按时提醒你。', { key: 'planner-reminders', update: true, type: 'success' });
    }
    updateReminderFields();
  }

  function commit(collection, planner = moduleState.planner, selectedDate, renderChanges = render) {
    viewCache = null;
    const saved = storage.write(planner);
    if (saved) {
      moduleState.planner = planner;
      if (selectedDate) {
        moduleState.selectedDate = selectedDate;
        moduleState.month = selectedDate.slice(0, 7);
      }
      if (collection === 'events') eventsRevision++;
      void reminders.sync(planner.events, editedEvents, eventsRevision);
    }
    renderChanges();
    return saved;
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
    if (/^\d{4}-\d{2}-\d{2}$/.test(String(patch.date))) session.date = String(patch.date);
    if (/^\d{2}:\d{2}$/.test(String(patch.time))) session.time = String(patch.time);
    if (patch.title !== undefined) session.title = String(patch.title || '').slice(0, 60);
    if (patch.goal !== undefined) session.goal = String(patch.goal || '').slice(0, 100);
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

  function updateTask(taskId, patch = {}, renderChanges = render) {
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
    if (patch.progress !== undefined) task.done = Number(patch.progress) === 100;
    commit('tasks', moduleState.planner, undefined, renderChanges);
    return { ...task };
  }

  function removeItem(collection, id) {
    const items = moduleState.planner[collection];
    const index = items.findIndex((item) => item.id === id);
    if (index < 0) return false;
    if (collection === 'events') return commit(collection, { ...moduleState.planner, events: items.toSpliced(index, 1) });
    items.splice(index, 1);
    commit(collection);
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
    const index = moduleState.planner.notes.findIndex((note) => note.id === noteId);
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
    const existing = moduleState.planner.tasks.find((task) => task.id === note.promotedTaskId);
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

  function saveEvent(input, index) {
    const planner = moduleState.planner;
    const original = planner.events[index];
    const event = normalizeEvent(original
      ? { ...original, ...input, id: original.id, createdAt: original.createdAt }
      : { ...input, id: createItemId('event') });
    if (!event) return { error: '请填写日程名称和有效的日期、时间。' };
    if (original) editedEvents.add(event);
    const events = original ? planner.events.with(index, event) : [...planner.events, event];
    if (!commit('events', { ...planner, events }, event.date)) return { error: '日程未能保存到本机，请重试。' };
    return { event: { ...event } };
  }

  function saveEditedEvent(id, input) {
    const index = moduleState.planner.events.findIndex(event => event.id === id);
    return index < 0 ? { error: '找不到要修改的日程。' } : saveEvent(input, index);
  }

  function viewSnapshot() {
    const published = fanCalendar?.getEvents();
    const fanEvents = published?.length ? published : null;
    if (!viewCache || viewCache.fanEvents !== fanEvents) {
      const planner = getState();
      if (fanEvents) planner.events = planner.events.concat(fanEvents);
      viewCache = { planner, fanEvents };
    }
    return {
      planner: viewCache.planner,
      month: moduleState.month,
      selectedDate: moduleState.selectedDate,
      taskFilter: moduleState.taskFilter,
      ...storage.getStatus(),
    };
  }

  function render() {
    renderTodo(viewSnapshot());
  }

  function selectDate(date, focus = false) {
    moduleState.selectedDate = date;
    moduleState.month = date.slice(0, 7);
    const view = viewSnapshot();
    renderTodoCalendar(view);
    renderTodoAgenda(view);
    if (focus) byId('plannerCalendarGrid').querySelector('[aria-pressed="true"]')?.focus();
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
    const event = moduleState.planner.events.find((item) => item.id === eventId);
    moduleState.editingEventId = event?.id || '';
    byId('plannerEventDialogTitle').textContent = event ? '编辑日程' : '新建日程';
    byId('plannerEventTitle').value = event?.title || '';
    byId('plannerEventDate').value = event?.date || moduleState.selectedDate;
    byId('plannerEventTime').value = event ? event.time : '20:00';
    byId('plannerEventAllDay').checked = Boolean(event && !event.time);
    byId('plannerEventReminder').checked = Boolean(event?.reminderTime);
    byId('plannerEventReminderTime').value = event?.reminderTime || '09:00';
    updateReminderFields();
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

  function updateReminderFields() {
    const reminder = byId('plannerEventReminder');
    if (!reminder) return;
    const allDay = byId('plannerEventAllDay').checked;
    const time = byId('plannerEventTime');
    time.disabled = allDay;
    time.required = !allDay;
    byId('plannerEventTimeField').hidden = allDay;
    const reminderStatus = reminders.getStatus();
    const canRemoveReminder = reminderStatus === 'limit' && moduleState.planner.events.some(
      event => event.id === moduleState.editingEventId && event.reminderTime,
    );
    reminder.disabled = storage.getStatus().readFailed || (reminderStatus !== 'ready' && !canRemoveReminder);
    byId('plannerEventReminderTimeField').hidden = !allDay || !reminder.checked;
    byId('plannerEventReminderTime').required = allDay && reminder.checked;
    const messages = {
      loading: '正在检查系统通知…',
      unsupported: '请在支持系统通知的 LIRA 桌面应用中设置提醒。',
      error: '提醒未能同步，请重新保存日程后重试。',
      limit: reminderLimitHint,
    };
    byId('plannerEventReminderHint').textContent = messages[reminderStatus] ||
      (reminder.checked
        ? (allDay ? '按所选时间提醒。' : `在日程开始时${time.value ? `（${time.value}）` : ''}提醒。`)
        : '如需提醒，请勾选本条日程的「系统通知提醒」并确认提醒时间。') +
      '请在「设置 → 声音与通知」开启「工作台日程提醒」，并保持 LIRA 运行。';
  }

  async function confirmTaskDelete(taskId) {
    const confirmed = await dangerConfirm({
      title: '删除待办？',
      description: '删除后无法恢复。',
      confirmLabel: '删除待办',
    });
    if (confirmed) removeTask(taskId);
  }

  async function confirmNoteEdit(noteId) {
    const body = byId('plannerNoteBody').value.trim();
    const previous = moduleState.planner.notes.find((note) => note.id === moduleState.editingNoteId);
    if (body !== (previous?.body || '') || byId('plannerNoteType').value !== (previous?.type || 'idea')) {
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
    editNote(noteId);
  }

  async function confirmNoteDelete(noteId) {
    const confirmed = await dangerConfirm({
      title: '删除备忘？',
      description: '删除后无法恢复。',
      confirmLabel: '删除备忘',
    });
    if (confirmed) {
      if (moduleState.editingNoteId === noteId) editNote();
      removeNote(noteId);
    }
  }

  function toggleNotePin(noteId) {
    const note = moduleState.planner.notes.find((item) => item.id === noteId);
    if (note) updateNote(note.id, { pinned: !note.pinned });
  }

  function handleAction(action) {
    if (!action) return;
    const { type, value } = action;
    switch (type) {
      case 'monthOffset':
        return selectDate(`${shiftMonth(moduleState.month, Number(value))}-01`);
      case 'calendarDate':
        return selectDate(value, true);
      case 'eventNew':
        return openEvent();
      case 'eventEdit':
        return openEvent(value);
      case 'eventCancel':
        return byId('plannerEventDialog').close();
      case 'taskFilter':
        moduleState.taskFilter = value;
        return renderTodoTasks(viewSnapshot());
      case 'taskDelete':
        return confirmTaskDelete(value);
      case 'notePromote':
        return promoteNote(value);
      case 'noteEdit':
        return confirmNoteEdit(value);
      case 'notePin':
        return toggleNotePin(value);
      case 'noteDelete':
        return confirmNoteDelete(value);
    }
  }

  function submitTask(event) {
    event.preventDefault();
    if (addTask({ title: byId('plannerTaskTitle').value })) {
      byId('plannerTaskTitle').value = '';
      byId('plannerTaskTitle').focus();
    }
  }

  function submitNote(event) {
    event.preventDefault();
    const input = {
      body: byId('plannerNoteBody').value,
      type: byId('plannerNoteType').value,
    };
    const note = moduleState.editingNoteId ? updateNote(moduleState.editingNoteId, input) : addNote(input);
    if (note) editNote();
  }

  function submitEvent(event) {
    event.preventDefault();
    const allDay = byId('plannerEventAllDay').checked;
    const time = byId('plannerEventTime').value;
    const reminderTime = byId('plannerEventReminder').checked ? (allDay ? byId('plannerEventReminderTime').value : time) : '';
    if ((!allDay && !time) || (byId('plannerEventReminder').checked && !reminderTime)) {
      byId('plannerEventError').textContent = '请填写日程时间；全天日程开启提醒后，请选择提醒时间。';
      byId('plannerEventError').hidden = false;
      return;
    }
    const input = {
      title: byId('plannerEventTitle').value,
      date: byId('plannerEventDate').value,
      time: allDay ? '' : time,
      reminderTime,
      type: byId('plannerEventForm').querySelector('[name="plannerEventType"]:checked').value,
      detail: byId('plannerEventDetail').value,
    };
    const result = moduleState.editingEventId ? saveEditedEvent(moduleState.editingEventId, input) : saveEvent(input);
    if (result.event) byId('plannerEventDialog').close();
    else {
      byId('plannerEventError').textContent = result.error;
      byId('plannerEventError').hidden = false;
    }
  }

  async function confirmEventDelete() {
    const eventId = moduleState.editingEventId;
    if (!eventId) return;
    byId('plannerEventDialog').close();
    const confirmed = await dangerConfirm({
      title: '删除日程？',
      description: '删除后无法恢复。',
      confirmLabel: '删除日程',
    });
    if (confirmed) removeEvent(eventId);
    else byId('plannerEventDialog').showModal();
  }

  function init() {
    const root = byId('streamerPlanner');
    if (!root || moduleState.initialized) return;
    byId('plannerTaskForm').addEventListener('submit', submitTask);
    byId('plannerNoteForm').addEventListener('submit', submitNote);
    byId('plannerNoteCancel').addEventListener('click', () => editNote());
    byId('plannerGoToday').addEventListener('click', () => selectDate(toDateValue()));
    byId('plannerEventAllDay').addEventListener('change', updateReminderFields);
    byId('plannerEventReminder').addEventListener('change', updateReminderFields);
    byId('plannerEventTime').addEventListener('input', updateReminderFields);
    byId('plannerEventForm').addEventListener('submit', submitEvent);
    byId('plannerEventDelete').addEventListener('click', confirmEventDelete);
    root.addEventListener('change', (event) => {
      const target = event.target;
      if (target.dataset.taskComplete) updateTask(target.dataset.taskComplete, { done: target.checked });
      if (target.dataset.taskTitle) {
        // A blur-triggered rename must leave the next pointer target attached.
        const task = updateTask(target.dataset.taskTitle, { title: target.value }, () => renderPlannerSaveState(storage.getStatus()));
        if (task) renderTaskTitle(target, task);
      }
    });
    root.addEventListener('click', (event) => handleAction(readTodoAction(event.target)));
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
    commit();
    if (storage.getStatus().readFailed)
      root.querySelectorAll('button, input, select, textarea').forEach((control) => {
        control.disabled = true;
      });
    moduleState.initialized = true;
    const panel = byId('otherDailyTodoFeature');
    fanCalendar = createFanCalendar({
      isVisible: () => isPanelVisible(panel),
      onChange: () => {
        const view = viewSnapshot();
        renderTodoCalendar(view);
        renderTodoAgenda(view);
      },
    });
    const stop = observePanelVisibility(panel, fanCalendar.syncVisibility);
    window.addEventListener('pagehide', stop, { once: true });
  }

  return {
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
    addEvent: input => saveEvent(input).event ?? null,
    updateEvent: (id, input) => saveEditedEvent(id, input).event ?? null,
    removeEvent,
    getState,
  };
})();
