'use strict';

const { createPublicError } = require('../shared/public-error');

const { performance } = require('node:perf_hooks');
const { randomUUID } = require('node:crypto');

const MIN_ENTRIES = 2;
const MAX_ENTRIES = 12;
const MAX_LABEL_LENGTH = 40;
const MAX_WEIGHT = 100;
const MAX_TOTAL_WEIGHT = 300;
const SPIN_DURATION_MS = 4800;
const SPIN_TURNS = 5;
const WHEEL_LIMITS = Object.freeze({
  minEntries: MIN_ENTRIES,
  maxEntries: MAX_ENTRIES,
  maxLabelLength: MAX_LABEL_LENGTH,
  minWeight: 1,
  maxWeight: MAX_WEIGHT,
  maxTotalWeight: MAX_TOTAL_WEIGHT,
});

function normalizeWheelEntries(input) {
  if (!Array.isArray(input) || input.length < MIN_ENTRIES || input.length > MAX_ENTRIES) {
    throw createPublicError(`转盘需要 ${MIN_ENTRIES}-${MAX_ENTRIES} 个选项。`);
  }

  const labels = new Set();
  let totalWeight = 0;
  const entries = input.map((entry, index) => {
    const label = String(entry?.label || '').trim();
    const weight = Number(entry?.weight);
    if (!label || label.length > MAX_LABEL_LENGTH) throw createPublicError(`第 ${index + 1} 个选项内容无效。`);
    if (labels.has(label)) throw createPublicError('转盘选项内容不能重复。');
    if (!Number.isInteger(weight) || weight < 1 || weight > MAX_WEIGHT) {
      throw createPublicError(`第 ${index + 1} 个选项的份数应为 1-${MAX_WEIGHT} 的整数。`);
    }
    labels.add(label);
    totalWeight += weight;
    return { label, weight };
  });

  if (totalWeight > MAX_TOTAL_WEIGHT) throw createPublicError(`转盘总份数不能超过 ${MAX_TOTAL_WEIGHT}。`);
  return { entries, totalWeight };
}

function chooseWeightedEntry(entries, random = Math.random) {
  const totalWeight = entries.reduce((total, entry) => total + entry.weight, 0);
  const sample = Math.min(Math.max(Number(random()) || 0, 0), 0.999999999);
  let cursor = sample * totalWeight;
  for (let index = 0; index < entries.length; index += 1) {
    cursor -= entries[index].weight;
    if (cursor < 0) return index;
  }
  return entries.length - 1;
}

function createWheelSessionService(options = {}) {
  const runtimeId = randomUUID();
  let revision = 0;
  const broadcast = typeof options.broadcast === 'function' ? options.broadcast : () => {};
  const random = typeof options.random === 'function' ? options.random : Math.random;
  const monotonicNow = options.monotonicNow || (() => performance.now());
  const wallNow = options.wallNow || Date.now;
  const scheduleTimeout = options.setTimeout || setTimeout;
  const cancelTimeout = options.clearTimeout || clearTimeout;
  let entries = [];
  let totalWeight = 0;
  let lastResult = null;
  let activeSpin = null;
  let spinStartedMs = 0;
  let spinTimer = null;
  let disposed = false;

  function getState() {
    const spin = remainingSpinMs() > 0 ? { ...activeSpin } : null;
    return {
      runtimeId,
      revision,
      entries: entries.map((entry) => ({ ...entry })),
      totalWeight,
      lastResult: lastResult ? { ...lastResult } : null,
      spin,
      limits: { ...WHEEL_LIMITS },
    };
  }

  function remainingSpinMs() {
    return activeSpin ? activeSpin.durationMs - (monotonicNow() - spinStartedMs) : 0;
  }

  function configure(input) {
    if (remainingSpinMs() > 0) {
      throw createPublicError('转盘正在转动，请稍候再修改。', 409);
    }
    const normalized = normalizeWheelEntries(input);
    entries = normalized.entries;
    totalWeight = normalized.totalWeight;
    lastResult = null;
    activeSpin = null;
    if (spinTimer) cancelTimeout(spinTimer);
    spinTimer = null;
    publish();
    return getState();
  }

  function spin() {
    if (entries.length < MIN_ENTRIES) throw createPublicError('请先配置至少两个转盘选项。');
    if (remainingSpinMs() > 0) {
      throw createPublicError('转盘正在转动，请稍候再抽取。', 409);
    }
    const index = chooseWeightedEntry(entries, random);
    const now = wallNow();
    spinStartedMs = monotonicNow();
    activeSpin = {
      id: `${now}-${index}-${Math.floor(random() * 1000000)}`,
      index,
      startedAt: now,
      durationMs: SPIN_DURATION_MS,
      turns: SPIN_TURNS,
    };
    lastResult = {
      index,
      label: entries[index].label,
      selectedAt: new Date(now).toISOString(),
    };
    publish();
    const current = activeSpin;
    cancelTimeout(spinTimer);
    function finishWhenDue() {
      if (activeSpin !== current) return;
      const remaining = remainingSpinMs();
      if (remaining > 0) {
        spinTimer = scheduleTimeout(finishWhenDue, Math.ceil(remaining));
        spinTimer.unref?.();
        return;
      }
      activeSpin = null;
      spinTimer = null;
      publish();
    }
    finishWhenDue();
    return getState();
  }

  function publish() {
    if (disposed) return;
    revision += 1;
    broadcast({ type: 'wheel:update', state: getState() });
  }

  function dispose() {
    if (disposed) return;
    disposed = true;
    if (spinTimer) cancelTimeout(spinTimer);
    spinTimer = null;
    activeSpin = null;
  }

  return { getState, configure, spin, dispose };
}

module.exports = {
  MIN_ENTRIES,
  MAX_ENTRIES,
  MAX_LABEL_LENGTH,
  MAX_WEIGHT,
  MAX_TOTAL_WEIGHT,
  SPIN_DURATION_MS,
  SPIN_TURNS,
  WHEEL_LIMITS,
  normalizeWheelEntries,
  chooseWeightedEntry,
  createWheelSessionService,
};
