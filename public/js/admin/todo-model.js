'use strict';

export const STORAGE_KEY = 'admin.streamerWorkbench.v2';
export const LEGACY_STORAGE_KEY = 'admin.streamerPlanner.v1';
export const STAGES = ['before', 'live', 'after'];
const NOTE_TYPES = ['idea', 'promise', 'review'];
export const NOTE_LABELS = {
  idea: '话题灵感',
  promise: '观众请求',
  review: '高光时刻',
};
export const NOTE_STAGE = {
  idea: 'live',
  promise: 'live',
  review: 'after',
};
export const STAGE_CONFIG = {
  before: {
    listId: 'plannerBeforeList',
    countId: 'plannerBeforeCount',
    empty: '还没有开场提词，写下开播后第一句要说的话。',
  },
  live: {
    listId: 'plannerLiveList',
    countId: 'plannerLiveCount',
    empty: '把互动问题、备用话题和中场提醒放在这里。',
  },
  after: {
    listId: 'plannerAfterList',
    countId: 'plannerAfterCount',
    empty: '把感谢、回顾和下次预告放在这里。',
  },
};
const STARTER_TASKS = [
  {
    id: 'starter-device-check',
    title: '欢迎刚进来的观众，简单说明今天播什么',
    stage: 'before',
    done: false,
  },
  {
    id: 'starter-show-info',
    title: '开场问大家：今天最想听哪类歌？',
    stage: 'before',
    done: false,
  },
  {
    id: 'starter-show-assets',
    title: '冷场时聊：最近单曲循环的一首歌',
    stage: 'live',
    done: false,
  },
  {
    id: 'starter-interaction-choice',
    title: '让大家二选一：下一首唱轻快的还是抒情的？',
    stage: 'live',
    done: false,
  },
  {
    id: 'starter-midstream-reminder',
    title: '中场再说一次点歌方式和本场主题',
    stage: 'live',
    done: false,
  },
  {
    id: 'starter-review',
    title: '结束前预告下次直播时间和内容',
    stage: 'after',
    done: false,
  },
];
const OBSOLETE_STARTER_TASKS = {
  'starter-device-check': {
    titles: ['检查麦克风、耳返、画面和网络'],
    replacementId: 'starter-device-check',
  },
  'starter-show-info': {
    titles: ['确认直播标题、封面和开播公告'],
    replacementId: 'starter-show-info',
  },
  'starter-show-assets': {
    titles: ['打开场景、歌单和直播要用的页面'],
    replacementId: 'starter-show-assets',
  },
  'starter-preflight': {
    titles: ['开播前检查麦克风、耳返和网络'],
    replacementId: 'starter-device-check',
  },
  'starter-announcement': {
    titles: ['写好今天的直播标题和开播公告'],
    replacementId: 'starter-show-info',
  },
  'starter-song': {
    titles: ['添加本周要学的第一首歌'],
    replacementId: 'starter-show-assets',
  },
  'starter-clip': {
    titles: ['剪出一条值得分享的直播切片'],
    replacementId: 'starter-interaction-choice',
  },
  'starter-library': {
    titles: ['整理一次可点歌单'],
    replacementId: 'starter-midstream-reminder',
  },
  'starter-review': {
    titles: [
      '看看本月最受欢迎的歌和直播时段',
      '记下高光时间点和需要改进的问题',
    ],
    replacementId: 'starter-review',
  },
};

export function createItemId(prefix) {
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
  return { date: todayValue(), time: '20:00', title: '', goal: '' };
}

function normalizeSession(value = {}) {
  const fallback = createDefaultSession();
  const date = String(value.date || '');
  const time = String(value.time || '');
  return {
    date: /^\d{4}-\d{2}-\d{2}$/.test(date) ? date : fallback.date,
    time: /^\d{2}:\d{2}$/.test(time) ? time : fallback.time,
    title: String(value.title || '').slice(0, 60),
    goal: String(value.goal || '').slice(0, 100),
  };
}

function inferStage(value = {}) {
  if (STAGES.includes(value.stage)) return value.stage;
  if (value.category === 'review') return 'after';
  return 'before';
}

export function normalizeTask(value, fallbackId = '') {
  if (!value || typeof value !== 'object') return null;
  const title = String(value.title || '')
    .trim()
    .slice(0, 80);
  if (!title) return null;
  return {
    id: String(value.id || fallbackId || createItemId('task')),
    title,
    stage: inferStage(value),
    done: value.done === true || Number(value.progress) === 100,
    createdAt: String(value.createdAt || new Date().toISOString()),
  };
}

function upgradeStarterTask(task) {
  const obsolete = OBSOLETE_STARTER_TASKS[task.id];
  if (!obsolete?.titles.includes(task.title)) return task;
  const replacement = STARTER_TASKS.find(
    (item) => item.id === obsolete.replacementId,
  );
  if (!replacement) return task;
  return normalizeTask(
    { ...replacement, createdAt: task.createdAt, done: false },
    replacement.id,
  );
}

export function normalizeTasks(values, fallbackPrefix) {
  return values
    .map((task, index) => normalizeTask(task, `${fallbackPrefix}-${index}`))
    .filter(Boolean)
    .map(upgradeStarterTask);
}

export function normalizeNote(value, fallbackId = '') {
  if (!value || typeof value !== 'object') return null;
  const body = String(value.body || '')
    .trim()
    .slice(0, 300);
  if (!body) return null;
  return {
    id: String(value.id || fallbackId || createItemId('note')),
    body,
    type: NOTE_TYPES.includes(value.type) ? value.type : 'idea',
    createdAt: String(value.createdAt || new Date().toISOString()),
    promotedTaskId: value.promotedTaskId ? String(value.promotedTaskId) : '',
  };
}

export function createDefaultState(includeStarters = true) {
  return {
    version: 2,
    session: createDefaultSession(),
    tasks: includeStarters
      ? STARTER_TASKS.map((task) => normalizeTask(task)).filter(Boolean)
      : [],
    notes: [],
  };
}

export function normalizeState(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return createDefaultState(false);
  }
  return {
    version: 2,
    session: normalizeSession(value.session),
    tasks: Array.isArray(value.tasks)
      ? normalizeTasks(value.tasks, 'restored-task')
      : [],
    notes: Array.isArray(value.notes)
      ? value.notes
          .map((note, index) => normalizeNote(note, `restored-note-${index}`))
          .filter(Boolean)
      : [],
  };
}
