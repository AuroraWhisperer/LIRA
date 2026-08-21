'use strict';

const { readAdminHtml } = require('./helpers/admin-html');

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { readCssBundle } = require('./helpers/css-bundle');

const ROOT_DIR = path.resolve(__dirname, '..');
const STORAGE_KEY = 'admin.streamerWorkbench.v2';
const LEGACY_STORAGE_KEY = 'admin.streamerPlanner.v1';

function createTodoSandbox(stored) {
  return {
    console,
    crypto: { randomUUID: () => `item-${stored.size}` },
    document: { getElementById: () => null },
    window: {
      AdminApp: {},
      localStorage: {
        getItem(key) { return stored.has(key) ? stored.get(key) : null; },
        setItem(key, value) { stored.set(key, value); }
      }
    }
  };
}

function loadTodo(stored = new Map([[STORAGE_KEY, JSON.stringify({
  session: { date: '2026-08-21', time: '20:00', title: '', goal: '' },
  tasks: [],
  notes: []
})]])) {
  const source = fs.readFileSync(
    path.join(ROOT_DIR, 'public', 'js', 'admin', 'todo.js'),
    'utf8'
  );
  const sandbox = createTodoSandbox(stored);
  vm.runInNewContext(source, sandbox);
  return { todo: sandbox.window.AdminApp.todo, stored };
}

test('streamer workbench keeps broadcast stages and field notes', () => {
  const html = readAdminHtml();
  const planner = fs.readFileSync(
    path.join(ROOT_DIR, 'public', 'pages', 'admin', 'toolbox', 'planner.html'),
    'utf8'
  );

  assert.match(html, /<strong>主播工作台<\/strong>\s*<small>直播清单与现场备忘<\/small>/);
  assert.match(html, /id="plannerSessionForm"[\s\S]*id="plannerSessionDate"[\s\S]*id="plannerSessionTime"[\s\S]*id="plannerSessionTitle"[\s\S]*id="plannerSessionGoal"/);
  assert.match(html, /id="plannerTaskForm"[\s\S]*id="plannerTaskTitle"[\s\S]*id="plannerTaskStage"/);
  assert.match(html, /id="plannerBeforeList"[\s\S]*id="plannerLiveList"[\s\S]*id="plannerAfterList"/);
  assert.match(html, /id="plannerNoteForm"[\s\S]*id="plannerNoteBody"[\s\S]*id="plannerNoteType"[\s\S]*id="plannerNoteList"/);
  assert.doesNotMatch(planner, /NEXT LIVE · 下一场直播/);
  assert.doesNotMatch(planner, /把下一场播清楚，也把直播里的灵感留下来/);
  assert.doesNotMatch(planner, /场次信息、直播清单和现场备忘会自动保存，下次打开还在。/);
  assert.doesNotMatch(planner, /内容只保存在这台电脑/);
});

test('streamer workbench keeps its split desk readable on narrow windows', () => {
  const styles = readCssBundle('public', 'css', 'admin', 'other-features.css');

  assert.match(styles, /\.planner-workspace\s*\{[^}]*grid-template-columns:\s*minmax\(0, 1\.55fr\) minmax\(300px, 0\.75fr\)/);
  assert.match(styles, /\.streamer-planner\s*\{[^}]*grid-auto-rows:\s*max-content/);
  assert.match(styles, /@media \(max-width: 1100px\)[\s\S]*?\.planner-workspace\s*\{[^}]*grid-template-columns:\s*1fr/);
  assert.match(styles, /\.planner-stage-track/);
  assert.match(styles, /\.planner-note-card/);
  assert.match(styles, /\.planner-task-check:focus-visible/);
  assert.match(styles, /@media \(prefers-reduced-motion: reduce\)[\s\S]*?\.planner-task-row/);
});

test('streamer workbench saves show details and stage checklist actions', () => {
  const { todo, stored } = loadTodo();

  todo.updateSession({
    date: '2026-08-23',
    time: '21:30',
    title: '周末点歌回',
    goal: '把新学的两首歌唱稳定'
  });
  const task = todo.addTask({ title: '开场先说本周安排', stage: 'live' });
  todo.updateTask(task.id, { done: true });

  const state = todo.getState();
  assert.equal(state.session.title, '周末点歌回');
  assert.equal(state.session.time, '21:30');
  assert.equal(state.tasks[0].stage, 'live');
  assert.equal(state.tasks[0].done, true);
  assert.match(stored.get(STORAGE_KEY), /把新学的两首歌唱稳定/);

  todo.removeTask(task.id);
  assert.equal(todo.getTasks().length, 0);
});

test('streamer workbench rejects blank items and normalizes unsupported stages', () => {
  const { todo } = loadTodo();

  assert.equal(todo.addTask({ title: '   ' }), null);
  const task = todo.addTask({ title: '  整理歌单  ', stage: 'later' });

  assert.equal(task.title, '整理歌单');
  assert.equal(task.stage, 'before');
  assert.equal(task.done, false);
});

test('streamer workbench stores notes and turns a note into an action', () => {
  const { todo, stored } = loadTodo();

  assert.equal(todo.addNote({ body: '  ' }), null);
  const note = todo.addNote({ body: '观众想听《稻香》', type: 'promise' });
  const task = todo.promoteNote(note.id);

  assert.equal(task.title, '观众想听《稻香》');
  assert.equal(task.stage, 'after');
  assert.equal(todo.getState().notes[0].promotedTaskId, task.id);
  assert.match(stored.get(STORAGE_KEY), /观众想听《稻香》/);

  assert.equal(todo.removeNote(note.id), true);
  assert.equal(todo.getState().notes.length, 0);
});

test('streamer workbench migrates existing v1 tasks without deleting the old data', () => {
  const legacyTasks = [
    { id: 'old-prep', title: '检查麦克风', period: 'today', category: 'prep', progress: 100 },
    { id: 'old-review', title: '整理高光', period: 'month', category: 'review', progress: 25 }
  ];
  const stored = new Map([[LEGACY_STORAGE_KEY, JSON.stringify(legacyTasks)]]);
  const { todo } = loadTodo(stored);

  assert.deepEqual(
    JSON.parse(JSON.stringify(todo.getTasks().map(({ title, stage, done }) => ({ title, stage, done })))),
    [
      { title: '检查麦克风', stage: 'before', done: true },
      { title: '整理高光', stage: 'after', done: false }
    ]
  );

  todo.addNote({ body: '迁移后继续记录', type: 'idea' });
  assert.equal(stored.get(LEGACY_STORAGE_KEY), JSON.stringify(legacyTasks));
  assert.match(stored.get(STORAGE_KEY), /检查麦克风/);
});

test('streamer workbench module is loaded and initialized by the admin entry', () => {
  const indexSource = fs.readFileSync(
    path.join(ROOT_DIR, 'public', 'js', 'admin', 'index.js'),
    'utf8'
  );
  const appSource = fs.readFileSync(
    path.join(ROOT_DIR, 'public', 'js', 'admin', 'app.js'),
    'utf8'
  );

  assert.match(indexSource, /import '\.\/todo\.js';/);
  assert.match(appSource, /modules\.todo\?\.init\?\.\(\)/);
});
