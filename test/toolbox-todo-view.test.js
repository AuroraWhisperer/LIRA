'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { loadModuleExports } = require('./helpers/frontend-modules');

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

test('planner renders frozen display data, ordered events and safe text while returning edit actions', async () => {
  const elements = new Map();
  function element(id) {
    if (!elements.has(id)) elements.set(id, node());
    return elements.get(id);
  }
  const { renderTodo, readTodoAction } = await loadModuleExports(
    path.resolve(__dirname, '../public/js/admin/todo-view.js'),
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
});
