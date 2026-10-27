'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { loadModuleExports } = require('../helpers/frontend-modules');

function node(tag = '') {
  const attributes = {};
  return {
    tag,
    attributes,
    children: [],
    dataset: {},
    textContent: '',
    classList: { toggle() {} },
    setAttribute(name, value) {
      attributes[name] = value;
    },
    append(...children) {
      this.children.push(...children);
    },
    replaceChildren(...children) {
      this.children = children;
    },
    querySelectorAll() {
      return [];
    },
  };
}

function freeze(value) {
  for (const child of Object.values(value)) {
    if (child && typeof child === 'object') freeze(child);
  }
  return Object.freeze(value);
}

test('reused date formatters preserve current local dates after timezone changes', async t => {
  const timezone = process.env.TZ;
  t.after(() => {
    if (timezone === undefined) delete process.env.TZ;
    else process.env.TZ = timezone;
  });
  process.env.TZ = 'UTC';
  const elements = new Map();
  const now = '2026-10-24T00:00:00Z';
  const { renderTodo } = await loadModuleExports(
    path.resolve(__dirname, '../../public/js/admin/streamer-planner-view.js'), {
      Date: class extends Date { constructor(...args) { super(...(args.length ? args : [now])); } },
      document: { getElementById(id) { if (!elements.has(id)) elements.set(id, node()); return elements.get(id); },
        createElement: node, createElementNS: (_, tag) => node(tag) },
    });
  const dates = ['2026-10-23T23:59:59Z', now, '2026-10-24T04:00:00Z'];
  const view = { month: '2026-09', selectedDate: '2026-09-13', planner: { tasks: [], events: [],
    notes: dates.map((createdAt, id) => ({ id, type: 'idea', body: 'note', createdAt })) } };
  for (const zone of ['UTC', 'America/New_York', 'Pacific/Kiritimati']) {
    process.env.TZ = zone;
    renderTodo(view);
    const format = (date, options) => new Intl.DateTimeFormat('zh-CN', options).format(new Date(date));
    assert.equal(elements.get('plannerMonthLabel').textContent,
      format('2026-09-01T12:00:00', { year: 'numeric', month: 'long' }));
    assert.equal(elements.get('plannerAgendaTitle').textContent,
      format('2026-09-13T12:00:00', { month: 'long', day: 'numeric', weekday: 'short' }));
    assert.equal(elements.get('plannerTodayLabel').textContent,
      format(now, { month: 'long', day: 'numeric', weekday: 'long' }));
    for (const [index, date] of dates.toReversed().entries()) {
      const label = elements.get('plannerNoteList').children[index].children[0].children[1].textContent;
      assert.equal(label, format(date, { month: 'numeric', day: 'numeric' }));
    }
  }
});

test('planner indexes each detached event snapshot and task list once and reuses fixed date formatters', async () => {
  const elements = new Map();
  let formatterCount = 0;
  const { renderTodoCalendar, renderTodoAgenda, renderTodoNotes } = await loadModuleExports(
    path.resolve(__dirname, '../../public/js/admin/streamer-planner-view.js'), {
      document: { getElementById(id) { if (!elements.has(id)) elements.set(id, node()); return elements.get(id); },
        createElement: node, createElementNS: (_, tag) => node(tag) },
      Intl: { DateTimeFormat: function(...args) { formatterCount++; return new Intl.DateTimeFormat(...args); } },
    });
  let dates = 0;
  let taskIds = 0;
  const view = { month: '2026-10', selectedDate: '2026-10-23', planner: {
    events: Array.from({ length: 500 }, (_, i) => ({ id: `event-${i}`,
      get date() { dates++; return '2026-10-23'; }, time: '', title: `event-${i}`, type: 'personal', readonly: true })),
    tasks: Array.from({ length: 500 }, (_, i) => ({ get id() { taskIds++; return `task-${i}`; } })),
    notes: Array.from({ length: 500 }, (_, i) => ({ id: `note-${i}`, body: `note-${i}`, type: 'idea',
      promotedTaskId: i === 0 ? 'task-499' : 'removed-task', createdAt: '2026-10-23T12:00:00' })),
  } };
  renderTodoCalendar(view);
  renderTodoAgenda(view);
  assert.equal(dates, 1000, 'one grouping pass plus the visible agenda time elements');
  assert.equal(elements.get('plannerMonthCount').textContent, '本月 500 项安排');
  assert.equal(elements.get('plannerAgendaList').children[0].children[1].children[0].textContent, 'event-0');
  assert.equal(elements.get('plannerAgendaList').children[499].children[1].children[0].textContent, 'event-499');
  renderTodoNotes(view);
  assert.equal(taskIds, 500);
  assert.equal(elements.get('plannerNoteList').children.at(-1).children[2].children[0].disabled, true);
  assert.equal(elements.get('plannerNoteList').children[0].children[2].children[0].disabled, false);
  renderTodoNotes(view);
  assert.equal(formatterCount, 4, 'formatters are initialized once, not once per note or render');
  renderTodoCalendar({ ...view, planner: { ...view.planner, events: [{ date: '2026-11-01', time: '', title: 'new', type: 'work' }] } });
  assert.equal(elements.get('plannerMonthCount').textContent, '本月 0 项安排');
});

test('planner renders frozen display data, ordered events and safe text while returning edit actions', async () => {
  const elements = new Map();
  function element(id) {
    if (!elements.has(id)) elements.set(id, node());
    return elements.get(id);
  }
  const { renderTodo, readTodoAction } = await loadModuleExports(
    path.resolve(__dirname, '../../public/js/admin/streamer-planner-view.js'),
    {
      document: {
        getElementById: element,
        createElement: node,
        createElementNS: (_, tag) => node(tag),
      },
    },
  );
  const dangerous = '<img src=x onerror=alert(1)>';
  const view = freeze({
    planner: {
      tasks: [{ id: 'task', title: dangerous, done: false }],
      notes: [
        {
          id: 'note',
          body: dangerous,
          type: 'idea',
          createdAt: '2026-09-13T12:00:00',
          pinned: true,
        },
      ],
      events: [
        {
          id: 'late',
          date: '2026-09-13',
          time: '20:00',
          title: 'late',
          type: 'live',
        },
        {
          id: 'early',
          date: '2026-09-13',
          time: '08:00',
          title: dangerous,
          type: 'live',
        },
      ],
    },
    month: '2026-09',
    selectedDate: '2026-09-13',
    taskFilter: 'pending',
    readFailed: true,
    saveFailed: false,
  });
  renderTodo(view);
  assert.equal(element('plannerCalendarGrid').children.length, 42);
  assert.equal(element('plannerAgendaList').children[0].children[1].dataset.eventEdit, 'early');
  assert.equal(element('plannerAgendaList').children[0].children[1].children[0].textContent, dangerous);
  assert.equal(element('plannerTaskList').children[0].children[1].value, dangerous);
  assert.match(element('plannerSaveState').textContent, /已暂停写入/);
  const button = element('plannerAgendaList').children[0].children[1];
  const action = readTodoAction({ closest: () => button });
  assert.equal(action.type, 'eventEdit');
  assert.equal(action.value, 'early');
  assert.equal(readTodoAction({ closest: () => null }), null);
  renderTodo({ ...view, planner: { ...view.planner, events: [{
    id: 'fan:synthetic:500', date: view.selectedDate, time: '', type: 'personal',
    title: '测试观众 · 陪伴满 500 天（预计）', detail: 'B 站陪伴天数', readonly: true,
  }] } });
  const row = element('plannerAgendaList').children[0];
  assert.equal(row.children.length, 2, 'automatic reminders do not expose manual event editing');
  assert.equal(row.children[1].tag, 'div');
  assert.equal(row.children[1].dataset.eventEdit, undefined);
  assert.match(row.children[1].children[0].textContent, /500 天/);
});
