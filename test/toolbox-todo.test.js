'use strict';

const { readAdminHtml } = require('./helpers/admin-html');

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { readCssBundle } = require('./helpers/css-bundle');

const ROOT_DIR = path.resolve(__dirname, '..');
const STORAGE_KEY = 'admin.streamerPlanner.v1';

function createTodoSandbox(stored) {
  return {
    console,
    crypto: { randomUUID: () => 'task-test-id' },
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

test('streamer planner provides beginner-friendly periods and task controls', () => {
  const html = readAdminHtml();

  assert.match(html, /<strong>主播计划<\/strong>\s*<small>安排今天、本周与本月<\/small>/);
  assert.match(html, /id="plannerTaskForm"[\s\S]*id="plannerTaskTitle"[\s\S]*id="plannerTaskPeriod"[\s\S]*id="plannerTaskCategory"/);
  assert.match(html, /id="plannerTodayList"[\s\S]*id="plannerWeekList"[\s\S]*id="plannerMonthList"/);
  assert.match(html, /开播准备[\s\S]*内容发布[\s\S]*直播复盘/);
  assert.match(html, /所有安排只保存在这台电脑/);
});

test('streamer planner timeline keeps its three periods readable on narrow screens', () => {
  const styles = readCssBundle('public', 'css', 'admin', 'other-features.css');

  assert.match(styles, /\.planner-timeline\s*\{[^}]*grid-template-columns:\s*repeat\(3, minmax\(0, 1fr\)\)/);
  assert.match(styles, /@media \(max-width: 1100px\)[\s\S]*?\.planner-timeline\s*\{[^}]*grid-template-columns:\s*1fr/);
  assert.match(styles, /\.planner-task-progress\s*select:focus-visible/);
  assert.match(styles, /@media \(prefers-reduced-motion: reduce\)[\s\S]*?\.planner-task-card/);
});

test('streamer planner adds, updates, and removes locally persisted tasks', () => {
  const source = fs.readFileSync(
    path.join(ROOT_DIR, 'public', 'js', 'admin', 'todo.js'),
    'utf8'
  );
  const stored = new Map([[STORAGE_KEY, '[]']]);
  const sandbox = createTodoSandbox(stored);
  vm.runInNewContext(source, sandbox);

  const task = sandbox.window.AdminApp.todo.addTask({
    title: '学《晴天》',
    period: 'week',
    category: 'song'
  });
  sandbox.window.AdminApp.todo.updateTask(task.id, { progress: 75 });

  assert.equal(sandbox.window.AdminApp.todo.getTasks()[0].progress, 75);
  assert.match(stored.get(STORAGE_KEY), /学《晴天》/);

  sandbox.window.AdminApp.todo.removeTask(task.id);
  assert.equal(sandbox.window.AdminApp.todo.getTasks().length, 0);
  assert.equal(stored.get(STORAGE_KEY), '[]');
});

test('streamer planner rejects blank tasks and normalizes unsupported values', () => {
  const source = fs.readFileSync(
    path.join(ROOT_DIR, 'public', 'js', 'admin', 'todo.js'),
    'utf8'
  );
  const stored = new Map([[STORAGE_KEY, '[]']]);
  const sandbox = createTodoSandbox(stored);
  vm.runInNewContext(source, sandbox);

  assert.equal(sandbox.window.AdminApp.todo.addTask({ title: '   ' }), null);
  const task = sandbox.window.AdminApp.todo.addTask({
    title: '  整理歌单  ',
    period: 'later',
    category: 'unknown'
  });

  assert.equal(task.title, '整理歌单');
  assert.equal(task.period, 'today');
  assert.equal(task.category, 'prep');
  assert.equal(task.progress, 0);
});

test('streamer planner module is loaded and initialized by the admin entry', () => {
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
