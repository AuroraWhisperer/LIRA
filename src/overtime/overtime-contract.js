'use strict';

const MAX_OVERTIME_YEARS = 9_999;
const MAX_OVERTIME_SECONDS = MAX_OVERTIME_YEARS * 365 * 24 * 60 * 60;
const MAX_EFFECT_FACTOR = 1_000;
const MAX_RANDOM_WEIGHT = 100_000;
const MAX_ENABLED_RULES = 8;
const MIN_RANDOM_OUTCOMES = 2;
const MAX_RANDOM_OUTCOMES = 10;
const MAX_DISPLAY_TEXT_LENGTH = 6;

function validateTimeInput(input) {
  if (!input || typeof input !== 'object') throw new Error('time input is required.');
  const result = {};
  if (Object.hasOwn(input, 'initialSeconds')) {
    result.initialSeconds = validateSeconds(input.initialSeconds, 'initialSeconds', false);
  }
  if (Object.hasOwn(input, 'remainingSeconds')) {
    result.remainingSeconds = validateSeconds(input.remainingSeconds, 'remainingSeconds', false);
  }
  if (!Object.hasOwn(result, 'initialSeconds') && !Object.hasOwn(result, 'remainingSeconds')) {
    throw new Error('initialSeconds or remainingSeconds is required.');
  }
  return result;
}

function validateAction(action) {
  const value = String(action || '').trim();
  if (!['start', 'pause', 'reset', 'enable', 'disable'].includes(value)) {
    throw new Error('action must be start, pause, reset, enable, or disable.');
  }
  return value;
}

function validateBackground(input) {
  if (!input || typeof input !== 'object') throw new Error('background input is required.');
  const path = String(input.path || '').trim();
  const fit = String(input.fit || 'cover').trim();
  if (!['cover', 'contain', 'fill'].includes(fit)) {
    throw new Error('background fit must be cover, contain, or fill.');
  }
  if (path && !isAllowedImagePath(path, ['overtime-machine'])) {
    throw new Error('background path must be a built-in overtime image path.');
  }
  return { path, fit };
}

function validateRules(input) {
  if (!Array.isArray(input)) throw new Error('rules must be an array.');
  const giftIds = new Set();
  const rules = input.map((value, index) => validateRule(value, index));
  for (const rule of rules) {
    if (giftIds.has(rule.giftId)) throw new Error(`duplicate giftId: ${rule.giftId}`);
    giftIds.add(rule.giftId);
  }
  if (rules.filter(rule => rule.enabled).length > MAX_ENABLED_RULES) {
    throw new Error(`enabled rules cannot exceed ${MAX_ENABLED_RULES}.`);
  }
  return rules;
}

function validateRule(input, index) {
  if (!input || typeof input !== 'object') throw new Error(`rule ${index + 1} must be an object.`);
  const giftId = String(input.giftId ?? input.gift_id ?? '').trim();
  if (!giftId || giftId.length > 100) throw new Error(`rule ${index + 1} giftId is invalid.`);
  const giftName = String(input.giftName ?? input.gift_name ?? '').trim().slice(0, 100);
  const imagePath = String(input.imagePath ?? input.image_path ?? '').trim();
  if (imagePath && !isAllowedImagePath(imagePath, ['admin/gifts', 'bilibili-gifts', 'overtime-machine'])) {
    throw new Error(`rule ${index + 1} imagePath is invalid.`);
  }
  const mode = String(input.mode || '').trim();
  if (!['fixed', 'random', 'display'].includes(mode)) throw new Error(`rule ${index + 1} mode is invalid.`);
  const quantityMode = String(input.quantityMode ?? input.quantity_mode ?? 'group').trim();
  if (!['group', 'item'].includes(quantityMode)) {
    throw new Error(`rule ${index + 1} quantityMode is invalid.`);
  }
  const enabled = input.enabled !== false && Number(input.enabled) !== 0;
  const sortOrder = normalizeInteger(input.sortOrder ?? input.sort_order ?? index, `rule ${index + 1} sortOrder`);

  if (mode === 'display') {
    const displayText = validateDisplayText(input.displayText ?? input.display_text, `rule ${index + 1} displayText`);
    return {
      giftId, giftName, imagePath, mode, quantityMode, displayText,
      fixedSeconds: null, fixedEffect: null, outcomes: [], enabled, sortOrder
    };
  }

  if (mode === 'fixed') {
    const fixedEffect = validateEffect(
      input.fixedEffect ?? input.fixed_effect ?? input.effect,
      input.fixedSeconds ?? input.fixed_seconds,
      `rule ${index + 1} fixedEffect`
    );
    return {
      giftId, giftName, imagePath, mode, quantityMode,
      fixedSeconds: effectToLegacySeconds(fixedEffect),
      fixedEffect,
      outcomes: [], enabled, sortOrder
    };
  }

  const outcomesInput = input.outcomes ?? parseOutcomes(input.outcomes_json);
  if (!Array.isArray(outcomesInput)
    || outcomesInput.length < MIN_RANDOM_OUTCOMES
    || outcomesInput.length > MAX_RANDOM_OUTCOMES) {
    throw new Error(`rule ${index + 1} outcomes must contain ${MIN_RANDOM_OUTCOMES} to ${MAX_RANDOM_OUTCOMES} items.`);
  }
  const outcomes = outcomesInput.map((outcome, outcomeIndex) => ({
    ...validateEffect(
      outcome?.effect ?? outcome,
      outcome?.seconds,
      `rule ${index + 1} outcome ${outcomeIndex + 1}`
    ),
    weight: validateWeight(outcome?.weight, `rule ${index + 1} outcome ${outcomeIndex + 1} weight`)
  }));
  const totalWeight = outcomes.reduce((sum, outcome) => sum + outcome.weight, 0);
  if (totalWeight > MAX_RANDOM_WEIGHT) {
    throw new Error(`rule ${index + 1} total weight cannot exceed ${MAX_RANDOM_WEIGHT}.`);
  }
  return { giftId, giftName, imagePath, mode, quantityMode, fixedSeconds: null, outcomes, enabled, sortOrder };
}

function validateSeconds(value, field, signed) {
  const number = normalizeInteger(value, field);
  const minimum = signed ? -MAX_OVERTIME_SECONDS : 0;
  if (number < minimum || number > MAX_OVERTIME_SECONDS) {
    throw new Error(`${field} must be between ${minimum} and ${MAX_OVERTIME_SECONDS}.`);
  }
  return number;
}

function validateEffect(input, legacySeconds, field) {
  if (input && typeof input === 'object' && Object.hasOwn(input, 'operation')) {
    const operation = String(input.operation || '').trim();
    if (!['add', 'subtract', 'multiply', 'divide', 'clear'].includes(operation)) {
      throw new Error(`${field} operation is invalid.`);
    }
    if (operation === 'clear') return { operation, value: 0 };
    if (operation === 'multiply' || operation === 'divide') {
      const value = normalizeInteger(input.value, `${field} value`);
      if (value < 2 || value > MAX_EFFECT_FACTOR) {
        throw new Error(`${field} value must be between 2 and ${MAX_EFFECT_FACTOR}.`);
      }
      return { operation, value };
    }
    return {
      operation,
      value: validateSeconds(input.value, `${field} value`, false)
    };
  }

  const seconds = validateSeconds(legacySeconds, `${field} seconds`, true);
  return seconds < 0
    ? { operation: 'subtract', value: Math.abs(seconds) }
    : { operation: 'add', value: seconds };
}

function effectToLegacySeconds(effect) {
  if (effect.operation === 'add') return effect.value;
  if (effect.operation === 'subtract') return -effect.value;
  return null;
}

function validateWeight(value, field) {
  const number = normalizeInteger(value, field);
  if (number <= 0 || number > MAX_RANDOM_WEIGHT) {
    throw new Error(`${field} must be between 1 and ${MAX_RANDOM_WEIGHT}.`);
  }
  return number;
}

function validateDisplayText(value, field) {
  const rawText = String(value ?? '');
  if (/[\u0000-\u001F\u007F]/u.test(rawText)) {
    throw new Error(`${field} must contain 1-${MAX_DISPLAY_TEXT_LENGTH} characters without control characters.`);
  }
  const text = rawText.trim();
  const length = Array.from(text).length;
  if (!text || length > MAX_DISPLAY_TEXT_LENGTH) {
    throw new Error(`${field} must contain 1-${MAX_DISPLAY_TEXT_LENGTH} characters without control characters.`);
  }
  return text;
}

function normalizeInteger(value, field) {
  const number = Number(value);
  if (!Number.isSafeInteger(number)) throw new Error(`${field} must be an integer.`);
  return number;
}

function parseOutcomes(value) {
  if (!value) return null;
  try {
    const parsed = typeof value === 'string' ? JSON.parse(value) : value;
    return [1, 2].includes(parsed?.version) ? parsed.outcomes : null;
  } catch (_) {
    return null;
  }
}

function isAllowedImagePath(value, roots) {
  if (value.includes('..') || value.includes('\\') || /^(?:[a-z]+:|\/\/)/i.test(value)) return false;
  return roots.some(root => new RegExp(`^/img/${root}(?:/[A-Za-z0-9._-]+)+$`).test(value));
}

module.exports = {
  MAX_OVERTIME_YEARS,
  MAX_OVERTIME_SECONDS,
  MAX_EFFECT_FACTOR,
  MAX_RANDOM_WEIGHT,
  MAX_ENABLED_RULES,
  MIN_RANDOM_OUTCOMES,
  MAX_RANDOM_OUTCOMES,
  MAX_DISPLAY_TEXT_LENGTH,
  validateTimeInput,
  validateAction,
  validateBackground,
  validateRules
};
