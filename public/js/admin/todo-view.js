'use strict';

import {
  NOTE_LABELS,
  EVENT_LABELS,
  getCalendarDays,
  toDateValue,
} from './todo-model.js';

const byId = (id) => document.getElementById(id);

// Rendering consumes a detached snapshot; all edits are actions handled by todo.js.
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

function eventsForDate(view, date) {
  return view.planner.events
    .filter((event) => event.date === date)
    .sort((a, b) => a.time.localeCompare(b.time));
}

export function renderTodoCalendar(view) {
  byId('plannerMonthLabel').textContent = formatDate(`${view.month}-01`, {
    year: 'numeric',
    month: 'long',
  });
  byId('plannerMonthCount').textContent =
    `本月 ${view.planner.events.filter((event) => event.date.startsWith(view.month)).length} 项安排`;
  byId('plannerCalendarGrid').replaceChildren(
    ...getCalendarDays(view.month).map((day) => {
      const events = eventsForDate(view, day.date);
      const button = createElement('button', 'planner-calendar-day');
      button.type = 'button';
      button.dataset.calendarDate = day.date;
      button.classList.toggle('is-outside', !day.isCurrentMonth);
      button.classList.toggle('is-today', day.date === toDateValue());
      button.classList.toggle('is-selected', day.date === view.selectedDate);
      button.tabIndex = day.date === view.selectedDate ? 0 : -1;
      button.setAttribute(
        'aria-pressed',
        String(day.date === view.selectedDate),
      );
      button.setAttribute('aria-label', `${day.date}，${events.length} 项安排`);
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

export function renderTodoAgenda(view) {
  const date = view.selectedDate;
  const events = eventsForDate(view, date);
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
            createElement('span', '', event.detail || EVENT_LABELS[event.type]),
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

export function renderTodoTasks(view) {
  const tasks = view.planner.tasks;
  const done = tasks.filter((task) => task.done).length;
  byId('plannerPendingCount').textContent = String(tasks.length - done);
  byId('plannerDoneCount').textContent = String(done);
  byId('streamerPlanner')
    .querySelectorAll('[data-task-filter]')
    .forEach((button) => {
      button.setAttribute(
        'aria-pressed',
        String(button.dataset.taskFilter === view.taskFilter),
      );
    });
  const visible = tasks.filter(
    (task) => task.done === (view.taskFilter === 'done'),
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
            view.taskFilter === 'done' ? '暂无已完成事项' : '暂无待办',
          ),
        ]),
  );
}

function renderNote(note, tasks) {
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
  const promoted = tasks.some((task) => task.id === note.promotedTaskId);
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

export function renderTodoNotes(view) {
  const notes = [...view.planner.notes]
    .reverse()
    .sort((a, b) => Number(b.pinned) - Number(a.pinned));
  byId('plannerNoteCount').textContent = `${notes.length} 条`;
  byId('plannerNoteList').replaceChildren(
    ...(notes.length
      ? notes.map((note) => renderNote(note, view.planner.tasks))
      : [createElement('p', 'planner-empty-state', '暂无备忘')]),
  );
}

export function renderTodo(view) {
  if (!byId('streamerPlanner')) return;
  byId('plannerTodayLabel').textContent = formatDate(toDateValue(), {
    month: 'long',
    day: 'numeric',
    weekday: 'long',
  });
  const status = byId('plannerSaveState');
  status.textContent = view.readFailed
    ? '本机记录读取失败，已暂停写入'
    : view.saveFailed
      ? '保存失败，请勿关闭页面'
      : '已保存到本机';
  status.classList.toggle('is-error', view.readFailed || view.saveFailed);
  renderTodoCalendar(view);
  renderTodoAgenda(view);
  renderTodoNotes(view);
  renderTodoTasks(view);
}

export function readTodoAction(target) {
  const button = target.closest('button');
  if (!button) return null;
  for (const type of [
    'monthOffset',
    'calendarDate',
    'eventNew',
    'eventEdit',
    'eventCancel',
    'taskFilter',
    'taskDelete',
    'notePromote',
    'noteEdit',
    'notePin',
    'noteDelete',
  ]) {
    if (button.dataset[type] !== undefined) {
      return { type, value: button.dataset[type] };
    }
  }
  return null;
}
