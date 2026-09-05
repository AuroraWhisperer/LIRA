'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { readAdminHtml } = require('./helpers/admin-html');
const { readCssBundle } = require('./helpers/css-bundle');
const { readJsModuleBundle } = require('./helpers/js-module-bundle');

const ROOT_DIR = path.resolve(__dirname, '..');
const STORAGE_KEY = 'admin.streamerWorkbench.v3';
const PREVIOUS_STORAGE_KEY = 'admin.streamerWorkbench.v2';
const LEGACY_STORAGE_KEY = 'admin.streamerPlanner.v1';

function loadTodo(stored = new Map(), storageOverrides = {}) {
  let nextId = 0;
  const sandbox = {
    console,
    crypto: { randomUUID: () => `item-${++nextId}` },
    document: { getElementById: () => null },
    window: {
      AdminApp: {},
      localStorage: {
        getItem: (key) => stored.get(key) ?? null,
        setItem: (key, value) => stored.set(key, value),
        ...storageOverrides,
      },
    },
  };
  vm.runInNewContext(
    readJsModuleBundle('public', 'js', 'admin', 'todo.js'),
    sandbox,
  );
  return { todo: sandbox.window.AdminApp.todo, stored };
}

test('workbench exposes calendar, memos and tasks without beginner cues', () => {
  const html = readAdminHtml();
  const planner = fs.readFileSync(
    path.join(ROOT_DIR, 'public/pages/admin/toolbox/planner.html'),
    'utf8',
  );
  assert.match(
    html,
    /<strong>主播工作台<\/strong>\s*<small>日历、备忘与待办<\/small>/,
  );
  for (const id of [
    'streamerPlanner',
    'plannerCalendarGrid',
    'plannerAgendaList',
    'plannerNoteForm',
    'plannerNoteBody',
    'plannerNoteList',
    'plannerTaskForm',
    'plannerTaskTitle',
    'plannerTaskList',
    'plannerEventForm',
    'plannerEventDate',
    'plannerEventAllDay',
  ]) {
    assert.ok(planner.includes(`id="${id}"`), `missing ${id}`);
  }
  assert.match(planner, /<dialog\s+id="plannerEventDialog"/);
  assert.match(planner, /maxlength="2000"/);
  assert.doesNotMatch(
    planner,
    /本场提词|暖场问题|小提示|data-planner-template|plannerSessionForm/,
  );
});

test('workbench uses a stable month grid and adapts to narrow windows', () => {
  const styles = readCssBundle('public', 'css', 'admin', 'other-features.css');
  assert.match(
    styles,
    /\.streamer-planner\s*\{[^}]*grid-auto-rows:\s*max-content/,
  );
  assert.match(
    styles,
    /\.planner-calendar-grid\s*\{[^}]*grid-template-columns:\s*repeat\(7, minmax\(0, 1fr\)\)/,
  );
  assert.match(styles, /\.planner-calendar-day\s*\{[^}]*height:\s*54px/);
  assert.match(
    styles,
    /@media \(max-width: 1000px\)[\s\S]*?\.planner-workspace\s*\{[^}]*grid-template-columns:\s*1fr/,
  );
  assert.match(styles, /:focus-visible/);
});

test('new workbenches contain no fictional entries', () => {
  const { todo } = loadTodo();
  assert.equal(todo.getState().version, 3);
  for (const name of ['events', 'tasks', 'notes'])
    assert.equal(todo.getState()[name].length, 0);
});

test('v2 import preserves personal records and original data, removes exact built-ins', () => {
  const old = JSON.stringify({
    version: 2,
    session: {
      date: '2026-08-21',
      time: '20:00',
      title: '周年直播',
      goal: '嘉宾连麦',
    },
    tasks: [
      {
        id: 'starter-device-check',
        title: '欢迎刚进来的观众，简单说明今天播什么',
        stage: 'before',
      },
      {
        id: 'starter-show-info',
        title: '我自己修改过的开场内容',
        stage: 'before',
        done: true,
      },
      { id: 'personal', title: '联系合作方', stage: 'live', done: true },
    ],
    notes: [
      {
        id: 'memo',
        body: '原有备忘',
        type: 'promise',
        promotedTaskId: 'personal',
      },
    ],
  });
  const stored = new Map([[PREVIOUS_STORAGE_KEY, old]]);
  const { todo } = loadTodo(stored);
  assert.deepEqual(
    Array.from(todo.getTasks(), (task) => task.id),
    ['starter-show-info', 'personal'],
  );
  assert.equal(todo.getTasks()[0].done, true);
  assert.equal(todo.getState().notes[0].promotedTaskId, 'personal');
  assert.equal(todo.getState().events[0].title, '周年直播');
  todo.removeEvent(todo.getState().events[0].id);
  assert.equal(stored.get(PREVIOUS_STORAGE_KEY), old);
  const reloaded = loadTodo(stored).todo;
  assert.equal(reloaded.getState().events.length, 0);
  assert.equal(reloaded.getState().notes[0].body, '原有备忘');
});

test('v1 import retains custom task progress and leaves the old key untouched', () => {
  const old = JSON.stringify([
    {
      id: 'starter-preflight',
      title: '开播前检查麦克风、耳返和网络',
      period: 'today',
      category: 'prep',
    },
    { id: 'personal', title: '检查我的设备', category: 'prep', progress: 100 },
    { id: 'review', title: '整理高光', category: 'review', progress: 25 },
  ]);
  const stored = new Map([[LEGACY_STORAGE_KEY, old]]);
  const { todo } = loadTodo(stored);
  assert.equal(todo.getTasks().length, 2);
  assert.equal(todo.getTasks()[0].done, true);
  assert.equal(todo.getTasks()[1].stage, 'after');
  assert.equal(todo.getTasks()[1].done, false);
  todo.addNote({ body: '迁移后继续记录' });
  assert.equal(stored.get(LEGACY_STORAGE_KEY), old);
  assert.equal(loadTodo(stored).todo.getTasks()[0].id, 'personal');
});

test('existing session and task APIs remain compatible', () => {
  const { todo, stored } = loadTodo();
  todo.updateSession({
    date: '2026-09-05',
    time: '21:30',
    title: '周末点歌回',
    goal: '嘉宾',
  });
  assert.equal(todo.getState().session.time, '21:30');
  assert.equal(todo.addTask({ title: '   ' }), null);
  const task = todo.addTask({ title: '  整理歌单  ', stage: 'later' });
  assert.equal(task.title, '整理歌单');
  assert.equal(task.stage, 'before');
  todo.updateTask(task.id, { title: '整理新歌', done: true });
  assert.equal(todo.getTasks()[0].done, true);
  todo.updateTask(task.id, { progress: 25, stage: 'after' });
  assert.equal(todo.getTasks()[0].done, false);
  assert.equal(todo.getTasks()[0].stage, 'after');
  assert.match(stored.get(STORAGE_KEY), /整理新歌/);
  assert.equal(todo.removeTask(task.id), true);
  assert.equal(todo.removeTask(task.id), false);
  assert.equal(todo.getTasks().length, 0);
});

test('events can be created, rescheduled, made all-day, reloaded and removed', () => {
  const { todo, stored } = loadTodo();
  assert.equal(todo.addEvent({ title: ' ', date: '2026-09-05' }), null);
  assert.equal(todo.addEvent({ title: '无效日期', date: '2026-02-30' }), null);
  const first = todo.addEvent({
    title: '联动直播',
    date: '2026-09-05',
    time: '20:00',
    type: 'live',
    detail: '嘉宾连麦',
  });
  const second = todo.addEvent({
    title: '剪辑交付',
    date: '2026-09-05',
    type: 'work',
  });
  assert.notEqual(first.id, second.id);
  assert.equal(todo.updateEvent(first.id, { date: '2026-02-30' }), null);
  assert.equal(todo.getState().events[0].date, '2026-09-05');
  todo.updateEvent(first.id, {
    title: '联动延期',
    date: '2026-10-01',
    time: '',
    type: 'personal',
  });
  const reloaded = loadTodo(stored).todo;
  assert.equal(reloaded.getState().events[0].time, '');
  assert.equal(reloaded.getState().events[0].date, '2026-10-01');
  assert.equal(reloaded.getState().events[0].detail, '嘉宾连麦');
  assert.equal(reloaded.removeEvent(first.id), true);
  assert.equal(reloaded.removeEvent(first.id), false);
  assert.equal(reloaded.getState().events.length, 1);
});

test('memos support editing and pins without changing identity or task links', () => {
  const { todo, stored } = loadTodo();
  assert.equal(todo.addNote({ body: '  ' }), null);
  const note = todo.addNote({ body: '观众约好听新歌', type: 'promise' });
  const task = todo.promoteNote(note.id);
  assert.equal(todo.promoteNote(note.id).id, task.id);
  assert.equal(todo.getTasks().length, 1);
  assert.equal(task.stage, 'live');
  const edited = todo.updateNote(note.id, {
    body: '周末新歌专场',
    pinned: true,
    id: 'cannot-change',
  });
  assert.equal(edited.id, note.id);
  assert.equal(edited.createdAt, note.createdAt);
  assert.equal(edited.promotedTaskId, task.id);
  assert.equal(edited.pinned, true);
  assert.equal(todo.updateNote(note.id, { body: ' ' }), null);
  const reloaded = loadTodo(stored).todo;
  assert.equal(reloaded.getState().notes[0].body, '周末新歌专场');
  assert.equal(reloaded.getState().notes[0].pinned, true);
  todo.removeTask(task.id);
  assert.notEqual(todo.promoteNote(note.id).id, task.id);
  assert.equal(todo.removeNote(note.id), true);
  assert.equal(todo.getState().notes.length, 0);
});

test('returned collections cannot mutate saved records', () => {
  const { todo } = loadTodo();
  todo.addEvent({ title: '直播', date: '2026-09-05' });
  todo.addNote({ body: '备忘' });
  todo.addTask({ title: '待办' });
  const snapshot = todo.getState();
  snapshot.events[0].title = 'changed';
  snapshot.notes[0].body = 'changed';
  snapshot.tasks.length = 0;
  assert.equal(todo.getState().events[0].title, '直播');
  assert.equal(todo.getState().notes[0].body, '备忘');
  assert.equal(todo.getTasks().length, 1);
});

test('unreadable current storage is not overwritten or replaced from old data', () => {
  for (const damaged of ['{broken', '{}', 'null']) {
    const stored = new Map([[STORAGE_KEY, damaged]]);
    const { todo } = loadTodo(stored);
    todo.addTask({ title: '不能覆盖原数据' });
    assert.equal(stored.get(STORAGE_KEY), damaged);
  }
});

test('failed writes keep the latest records in memory', () => {
  const stored = new Map();
  const { todo } = loadTodo(stored, {
    setItem() {
      throw new Error('Quota exceeded');
    },
  });
  todo.addNote({ body: '未保存的内容' });
  assert.equal(todo.getState().notes[0].body, '未保存的内容');
  assert.equal(stored.has(STORAGE_KEY), false);
});

test('workbench remains initialized through the existing admin entry', () => {
  const read = (file) => fs.readFileSync(path.join(ROOT_DIR, file), 'utf8');
  assert.match(
    read('public/js/admin/index.js'),
    /import ["']\.\/todo\.js["'];/,
  );
  assert.match(read('public/js/admin/app.js'), /modules\.todo\?\.init\?\.\(\)/);
});
