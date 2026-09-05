'use strict';

export const STORAGE_KEY = 'admin.streamerWorkbench.v3';
export const PREVIOUS_STORAGE_KEY = 'admin.streamerWorkbench.v2';
export const LEGACY_STORAGE_KEY = 'admin.streamerPlanner.v1';
export const STAGES = ['before', 'live', 'after'];
const NOTE_TYPES = ['idea', 'promise', 'review'];
const EVENT_TYPES = ['live', 'work', 'personal'];

export const NOTE_LABELS = {
  idea: '随手记',
  promise: '观众约定',
  review: '复盘',
};
export const NOTE_STAGE = {
  idea: 'live',
  promise: 'live',
  review: 'after',
};
export const EVENT_LABELS = {
  live: '直播',
  work: '工作',
  personal: '个人',
};

const HISTORICAL_STARTERS = [
  ['starter-device-check', '欢迎刚进来的观众，简单说明今天播什么'],
  ['starter-show-info', '开场问大家：今天最想听哪类歌？'],
  ['starter-show-assets', '冷场时聊：最近单曲循环的一首歌'],
  ['starter-interaction-choice', '让大家二选一：下一首唱轻快的还是抒情的？'],
  ['starter-midstream-reminder', '中场再说一次点歌方式和本场主题'],
  ['starter-review', '结束前预告下次直播时间和内容'],
  ['starter-device-check', '检查麦克风、耳返、画面和网络'],
  ['starter-show-info', '确认直播标题、封面和开播公告'],
  ['starter-show-assets', '打开场景、歌单和直播要用的页面'],
  ['starter-preflight', '开播前检查麦克风、耳返和网络'],
  ['starter-announcement', '写好今天的直播标题和开播公告'],
  ['starter-song', '添加本周要学的第一首歌'],
  ['starter-clip', '剪出一条值得分享的直播切片'],
  ['starter-library', '整理一次可点歌单'],
  ['starter-review', '看看本月最受欢迎的歌和直播时段'],
  ['starter-review', '记下高光时间点和需要改进的问题'],
].map(([id, title]) => `${id}\u0000${title}`);
const HISTORICAL_STARTER_KEYS = new Set(HISTORICAL_STARTERS);

export function createItemId(prefix) {
  if (globalThis.crypto?.randomUUID) return globalThis.crypto.randomUUID();
  return `${prefix}-${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

function isValidDateValue(value) {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(value));
  if (!match) return false;
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  if (month < 1 || month > 12 || day < 1 || day > 31) return false;

  const date = new Date(0);
  date.setHours(0, 0, 0, 0);
  date.setFullYear(year, month - 1, day);
  return (
    date.getFullYear() === year &&
    date.getMonth() === month - 1 &&
    date.getDate() === day
  );
}

function isValidTimeValue(value) {
  const match = /^(\d{2}):(\d{2})$/.exec(String(value));
  if (!match) return false;
  const hours = Number(match[1]);
  const minutes = Number(match[2]);
  return hours >= 0 && hours <= 23 && minutes >= 0 && minutes <= 59;
}

function createCalendarDate(year, month, day = 1) {
  const date = new Date(0);
  date.setHours(0, 0, 0, 0);
  date.setFullYear(year, month - 1, day);
  return date;
}

function parseMonthValue(value) {
  const match = /^(\d{4})-(\d{2})$/.exec(String(value));
  if (!match) return null;
  const year = Number(match[1]);
  const month = Number(match[2]);
  if (month < 1 || month > 12) return null;
  return { year, month };
}

function createDefaultSession() {
  return { date: toDateValue(), time: '20:00', title: '', goal: '' };
}

function normalizeSession(value = {}) {
  const input = value && typeof value === 'object' ? value : {};
  const fallback = createDefaultSession();
  const date = String(input.date || '');
  const time = String(input.time || '');
  return {
    date: isValidDateValue(date) ? date : fallback.date,
    time: isValidTimeValue(time) ? time : fallback.time,
    title: String(input.title || '').slice(0, 60),
    goal: String(input.goal || '').slice(0, 100),
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

export function normalizeTasks(
  values,
  fallbackPrefix = 'restored-task',
  removeStarters = false,
) {
  if (!Array.isArray(values)) return [];
  return values
    .map((task, index) => normalizeTask(task, `${fallbackPrefix}-${index}`))
    .filter(Boolean)
    .filter(
      (task) =>
        !removeStarters ||
        !HISTORICAL_STARTER_KEYS.has(`${task.id}\u0000${task.title}`),
    );
}

export function normalizeNote(value, fallbackId = '') {
  if (!value || typeof value !== 'object') return null;
  const body = String(value.body || '')
    .trim()
    .slice(0, 2000);
  if (!body) return null;
  return {
    id: String(value.id || fallbackId || createItemId('note')),
    body,
    type: NOTE_TYPES.includes(value.type) ? value.type : 'idea',
    createdAt: String(value.createdAt || new Date().toISOString()),
    promotedTaskId: value.promotedTaskId ? String(value.promotedTaskId) : '',
    pinned: value.pinned === true,
  };
}

export function toDateValue(date = new Date()) {
  const value =
    date instanceof Date ? new Date(date.getTime()) : new Date(date);
  if (Number.isNaN(value.getTime())) return '';
  const year = String(value.getFullYear()).padStart(4, '0');
  const month = String(value.getMonth() + 1).padStart(2, '0');
  const day = String(value.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

export function getCalendarDays(monthValue) {
  const parsed = parseMonthValue(monthValue);
  if (!parsed) return [];
  const firstDay = createCalendarDate(parsed.year, parsed.month);
  const mondayOffset = (firstDay.getDay() + 6) % 7;
  const start = createCalendarDate(parsed.year, parsed.month, 1 - mondayOffset);
  return Array.from({ length: 42 }, (_unused, index) => {
    const date = createCalendarDate(
      start.getFullYear(),
      start.getMonth() + 1,
      start.getDate() + index,
    );
    return {
      date: toDateValue(date),
      isCurrentMonth:
        date.getFullYear() === parsed.year &&
        date.getMonth() === parsed.month - 1,
    };
  });
}

export function shiftMonth(monthValue, offset) {
  const parsed = parseMonthValue(monthValue);
  if (!parsed) return '';
  const date = createCalendarDate(parsed.year, parsed.month);
  date.setMonth(date.getMonth() + Number(offset || 0));
  return `${String(date.getFullYear()).padStart(4, '0')}-${String(
    date.getMonth() + 1,
  ).padStart(2, '0')}`;
}

export function normalizeEvent(value, fallbackId = '') {
  if (!value || typeof value !== 'object') return null;
  const title = String(value.title || '')
    .trim()
    .slice(0, 80);
  const date = String(value.date || '');
  const time = String(value.time || '');
  if (!title || !isValidDateValue(date) || (time && !isValidTimeValue(time))) {
    return null;
  }
  return {
    id: String(value.id || fallbackId || createItemId('event')),
    title,
    date,
    time,
    type: EVENT_TYPES.includes(value.type) ? value.type : 'live',
    detail: String(value.detail || '')
      .trim()
      .slice(0, 500),
    createdAt: String(value.createdAt || new Date().toISOString()),
  };
}

export function createDefaultState() {
  return {
    version: 3,
    session: createDefaultSession(),
    tasks: [],
    notes: [],
    events: [],
  };
}

function normalizeNotes(values) {
  if (!Array.isArray(values)) return [];
  return values
    .map((note, index) => normalizeNote(note, `restored-note-${index}`))
    .filter(Boolean);
}

function normalizeEvents(values) {
  if (!Array.isArray(values)) return [];
  return values
    .map((event, index) => normalizeEvent(event, `restored-event-${index}`))
    .filter(Boolean);
}

function migrateSessionEvent(session) {
  const title = session.title.trim();
  const goal = session.goal.trim();
  if (!title && !goal) return null;
  return normalizeEvent(
    {
      id: 'migrated-session',
      title: title || '直播安排',
      date: session.date,
      time: session.time,
      type: 'live',
      detail: goal,
    },
    'migrated-session',
  );
}

export function normalizeState(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return createDefaultState(false);
  }

  const session = normalizeSession(value.session);
  const isCurrentState = Number(value.version) === 3;
  return {
    version: 3,
    session,
    tasks: normalizeTasks(value.tasks, 'restored-task', !isCurrentState),
    notes: normalizeNotes(value.notes),
    events: isCurrentState
      ? normalizeEvents(value.events)
      : [migrateSessionEvent(session)].filter(Boolean),
  };
}
