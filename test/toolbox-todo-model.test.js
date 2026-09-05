'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const vm = require('node:vm');
const { readJsModuleBundle } = require('./helpers/js-module-bundle');

function loadModel() {
  const source = readJsModuleBundle('public', 'js', 'admin', 'todo-model.js');
  const sandbox = { console, crypto: { randomUUID: () => 'generated-id' } };
  vm.runInNewContext(
    `${source}\nthis.model = { STORAGE_KEY, PREVIOUS_STORAGE_KEY, LEGACY_STORAGE_KEY, STAGES, NOTE_LABELS, NOTE_STAGE, EVENT_LABELS, createItemId, toDateValue, getCalendarDays, shiftMonth, normalizeEvent, normalizeTask, normalizeTasks, normalizeNote, createDefaultState, normalizeState };`,
    sandbox,
  );
  return sandbox.model;
}

function plain(value) {
  return JSON.parse(JSON.stringify(value));
}

const model = loadModel();

test('exports v3 storage names and creates an empty default account', () => {
  assert.equal(model.STORAGE_KEY, 'admin.streamerWorkbench.v3');
  assert.equal(model.PREVIOUS_STORAGE_KEY, 'admin.streamerWorkbench.v2');
  assert.equal(model.LEGACY_STORAGE_KEY, 'admin.streamerPlanner.v1');
  assert.deepEqual(plain(model.STAGES), ['before', 'live', 'after']);
  assert.deepEqual(plain(model.NOTE_LABELS), {
    idea: '随手记',
    promise: '观众约定',
    review: '复盘',
  });
  assert.deepEqual(plain(model.EVENT_LABELS), {
    live: '直播',
    work: '工作',
    personal: '个人',
  });
  assert.deepEqual(plain(model.createDefaultState(false)), {
    version: 3,
    session: {
      date: model.toDateValue(),
      time: '20:00',
      title: '',
      goal: '',
    },
    tasks: [],
    notes: [],
    events: [],
  });
});

test('normalizes tasks and filters only exact historical starters when requested', () => {
  const values = [
    {
      id: 'starter-preflight',
      title: '开播前检查麦克风、耳返和网络',
      progress: 100,
    },
    {
      id: 'starter-device-check',
      title: '欢迎刚进来的观众，简单说明今天播什么',
      done: true,
    },
    {
      id: 'starter-device-check',
      title: '我的自定义检查',
      done: true,
      stage: 'live',
    },
    {
      id: 'custom-task',
      title: '  保留我的任务  ',
      stage: 'after',
      done: true,
    },
  ];

  assert.equal(model.normalizeTasks(values, 'task', true).length, 2);
  assert.deepEqual(
    model
      .normalizeTasks(values, 'task', true)
      .map(({ id, title, stage, done }) => ({ id, title, stage, done })),
    [
      {
        id: 'starter-device-check',
        title: '我的自定义检查',
        stage: 'live',
        done: true,
      },
      { id: 'custom-task', title: '保留我的任务', stage: 'after', done: true },
    ],
  );
  assert.equal(model.normalizeTasks(values, 'task').length, 4);
});

test('migrates v2 session once and preserves custom tasks, promoted links and pins', () => {
  const state = model.normalizeState({
    version: 2,
    session: {
      date: '2024-02-29',
      time: '21:30',
      title: '周末直播',
      goal: '测试新歌',
    },
    tasks: [
      {
        id: 'starter-review',
        title: '结束前预告下次直播时间和内容',
      },
      { id: 'my-task', title: '整理歌单', stage: 'live', done: true },
    ],
    notes: [
      {
        id: 'note-1',
        body: '  观众点歌  ',
        type: 'promise',
        promotedTaskId: 'my-task',
        pinned: true,
      },
    ],
  });

  assert.equal(state.version, 3);
  assert.equal(state.tasks.length, 1);
  assert.deepEqual(plain(state.tasks[0]), {
    id: 'my-task',
    title: '整理歌单',
    stage: 'live',
    done: true,
    createdAt: state.tasks[0].createdAt,
  });
  assert.deepEqual(plain(state.notes[0]), {
    id: 'note-1',
    body: '观众点歌',
    type: 'promise',
    createdAt: state.notes[0].createdAt,
    promotedTaskId: 'my-task',
    pinned: true,
  });
  assert.deepEqual(
    plain(state.events).map(({ id, title, date, time, type, detail }) => ({
      id,
      title,
      date,
      time,
      type,
      detail,
    })),
    [
      {
        id: 'migrated-session',
        title: '周末直播',
        date: '2024-02-29',
        time: '21:30',
        type: 'live',
        detail: '测试新歌',
      },
    ],
  );

  const v3AfterDelete = model.normalizeState({ ...state, events: [] });
  assert.deepEqual(v3AfterDelete.events, []);
});

test('migrates a goal-only session with a fallback event title and keeps empty accounts empty', () => {
  const state = model.normalizeState({
    version: 2,
    session: {
      date: '2026-09-05',
      time: '20:00',
      title: '',
      goal: '复盘上周数据',
    },
    tasks: [],
    notes: [],
  });
  assert.equal(state.events[0].title, '直播安排');
  assert.equal(state.events[0].detail, '复盘上周数据');
  assert.deepEqual(
    plain(model.normalizeState({ version: 2, session: null })).events,
    [],
  );
  assert.deepEqual(
    plain(
      model.normalizeState({
        version: 2,
        session: { date: '2026-09-05', time: '20:00', title: '  ', goal: '  ' },
      }),
    ).events,
    [],
  );
  assert.deepEqual(plain(model.normalizeState({ version: 2 })), {
    version: 3,
    session: {
      date: model.toDateValue(),
      time: '20:00',
      title: '',
      goal: '',
    },
    tasks: [],
    notes: [],
    events: [],
  });
});

test('normalizes events and rejects invalid local dates and times', () => {
  const event = model.normalizeEvent({
    id: 'event-1',
    title: `  ${'标题'.repeat(50)}  `,
    date: '2024-02-29',
    time: '',
    type: 'unknown',
    detail: ` ${'详情'.repeat(300)} `,
    createdAt: '2024-01-01T00:00:00.000Z',
  });
  assert.equal(event.title.length, 80);
  assert.equal(event.detail.length, 500);
  assert.equal(event.type, 'live');
  assert.equal(event.time, '');
  assert.equal(
    model.normalizeEvent({ title: 'x', date: '2023-02-29', time: '20:00' }),
    null,
  );
  assert.equal(
    model.normalizeEvent({ title: 'x', date: '2024-02-30', time: '20:00' }),
    null,
  );
  assert.equal(
    model.normalizeEvent({ title: 'x', date: '2024-02-29', time: '24:00' }),
    null,
  );
  assert.equal(
    model.normalizeEvent({ title: 'x', date: '2024-02-29', time: '20:60' }),
    null,
  );
  assert.equal(
    model.normalizeEvent({ title: '   ', date: '2024-02-29', time: '' }),
    null,
  );
});

test('uses local calendar dates for 42-cell Monday-first grids and month shifts', () => {
  const february = model.getCalendarDays('2024-02');
  assert.equal(february.length, 42);
  assert.deepEqual(plain(february.slice(0, 3)), [
    { date: '2024-01-29', isCurrentMonth: false },
    { date: '2024-01-30', isCurrentMonth: false },
    { date: '2024-01-31', isCurrentMonth: false },
  ]);
  assert.equal(february.filter((day) => day.isCurrentMonth).length, 29);
  assert.equal(
    february.find((day) => day.date === '2024-02-29').isCurrentMonth,
    true,
  );
  assert.equal(model.shiftMonth('2024-12', 1), '2025-01');
  assert.equal(model.shiftMonth('2025-01', -1), '2024-12');
  assert.equal(model.toDateValue(new Date(2024, 1, 29)), '2024-02-29');
});
