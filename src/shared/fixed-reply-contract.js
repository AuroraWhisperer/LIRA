'use strict';

const FIXED_REPLY_KEYS = Object.freeze([
  'customExactReplyEnabled', 'customExactReplies', 'scheduledDanmakuEnabled', 'scheduledDanmaku',
]);
const SCHEDULE_KEYS = ['mode', 'intervalSeconds', 'minSeconds', 'maxSeconds', 'selection', 'messages'];

function invalid(code = 'INVALID_FIXED_REPLY_SETTINGS') {
  throw Object.assign(new Error(code), { code });
}

function object(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function text(value, limit) {
  if (typeof value !== 'string' || !value.trim() || Array.from(value.trim()).length > limit
    || /[\x00-\x1f\x7f]/u.test(value)) invalid();
  return value.trim();
}

function fixedReplyParameters(value) {
  if (!object(value) || !Object.keys(value).length || Object.keys(value).some((key) => !FIXED_REPLY_KEYS.includes(key))) invalid();
  const result = {};
  for (const key of ['customExactReplyEnabled', 'scheduledDanmakuEnabled']) {
    if (!Object.hasOwn(value, key)) continue;
    if (typeof value[key] !== 'boolean') invalid();
    result[key] = value[key];
  }
  if (Object.hasOwn(value, 'customExactReplies')) {
    if (!Array.isArray(value.customExactReplies) || value.customExactReplies.length > 30) invalid();
    const triggers = new Set(['菜单']);
    result.customExactReplies = value.customExactReplies.map((rule) => {
      if (!object(rule) || Object.keys(rule).length !== 2 || !Object.hasOwn(rule, 'trigger') || !Object.hasOwn(rule, 'reply')) invalid();
      const trigger = text(rule.trigger, 30);
      if (triggers.has(trigger)) invalid();
      triggers.add(trigger);
      return { trigger, reply: text(rule.reply, 120) };
    });
  }
  if (Object.hasOwn(value, 'scheduledDanmaku')) {
    const schedule = value.scheduledDanmaku;
    if (!object(schedule) || Object.keys(schedule).length !== SCHEDULE_KEYS.length
      || SCHEDULE_KEYS.some((key) => !Object.hasOwn(schedule, key))
      || !['fixed', 'random'].includes(schedule.mode) || !['sequential', 'random'].includes(schedule.selection)) invalid();
    for (const key of ['intervalSeconds', 'minSeconds', 'maxSeconds']) {
      if (!Number.isInteger(schedule[key]) || schedule[key] < 10 || schedule[key] > 86400) invalid();
    }
    if (schedule.minSeconds > schedule.maxSeconds || !Array.isArray(schedule.messages) || schedule.messages.length > 100) invalid();
    result.scheduledDanmaku = {
      mode: schedule.mode,
      intervalSeconds: schedule.intervalSeconds,
      minSeconds: schedule.minSeconds,
      maxSeconds: schedule.maxSeconds,
      selection: schedule.selection,
      messages: schedule.messages.map((message) => text(message, 120)),
    };
  }
  return result;
}

function sanitizeFixedReplySettings(value) {
  if (value?.ok !== true) invalid('INVALID_RESPONSE');
  if (FIXED_REPLY_KEYS.some((key) => !Object.hasOwn(value, key))) invalid('FIXED_REPLY_UNSUPPORTED');
  try {
    const input = Object.fromEntries(FIXED_REPLY_KEYS.map((key) => [key, value[key]]));
    if (Array.isArray(input.customExactReplies)) {
      input.customExactReplies = input.customExactReplies.map((rule) => ({ trigger: rule?.trigger, reply: rule?.reply }));
    }
    if (object(input.scheduledDanmaku)) {
      input.scheduledDanmaku = Object.fromEntries(SCHEDULE_KEYS.map((key) => [key, input.scheduledDanmaku[key]]));
    }
    return { ok: true, ...fixedReplyParameters(input) };
  } catch {
    invalid('INVALID_RESPONSE');
  }
}

module.exports = { FIXED_REPLY_KEYS, fixedReplyParameters, sanitizeFixedReplySettings };
