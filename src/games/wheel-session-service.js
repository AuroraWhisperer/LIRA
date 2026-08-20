'use strict';

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
  maxTotalWeight: MAX_TOTAL_WEIGHT
});

function normalizeWheelEntries(input) {
  if (!Array.isArray(input) || input.length < MIN_ENTRIES || input.length > MAX_ENTRIES) {
    throw new Error(`转盘需要 ${MIN_ENTRIES}-${MAX_ENTRIES} 个选项。`);
  }

  const labels = new Set();
  let totalWeight = 0;
  const entries = input.map((entry, index) => {
    const label = String(entry?.label || '').trim();
    const weight = Number(entry?.weight);
    if (!label || label.length > MAX_LABEL_LENGTH) throw new Error(`第 ${index + 1} 个选项内容无效。`);
    if (labels.has(label)) throw new Error('转盘选项内容不能重复。');
    if (!Number.isInteger(weight) || weight < 1 || weight > MAX_WEIGHT) {
      throw new Error(`第 ${index + 1} 个选项的份数应为 1-${MAX_WEIGHT} 的整数。`);
    }
    labels.add(label);
    totalWeight += weight;
    return { label, weight };
  });

  if (totalWeight > MAX_TOTAL_WEIGHT) throw new Error(`转盘总份数不能超过 ${MAX_TOTAL_WEIGHT}。`);
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
  const broadcast = typeof options.broadcast === 'function' ? options.broadcast : () => {};
  const random = typeof options.random === 'function' ? options.random : Math.random;
  let entries = [];
  let totalWeight = 0;
  let lastResult = null;
  let activeSpin = null;
  let spinTimer = null;

  function getState() {
    const spin = activeSpin && Date.now() - activeSpin.startedAt < activeSpin.durationMs
      ? { ...activeSpin }
      : null;
    return {
      entries: entries.map(entry => ({ ...entry })),
      totalWeight,
      lastResult: lastResult ? { ...lastResult } : null,
      spin,
      limits: { ...WHEEL_LIMITS }
    };
  }

  function configure(input) {
    if (activeSpin && Date.now() - activeSpin.startedAt < activeSpin.durationMs) {
      const error = new Error('转盘正在转动，请稍候再修改。');
      error.statusCode = 409;
      throw error;
    }
    const normalized = normalizeWheelEntries(input);
    entries = normalized.entries;
    totalWeight = normalized.totalWeight;
    lastResult = null;
    activeSpin = null;
    publish();
    return getState();
  }

  function spin() {
    if (entries.length < MIN_ENTRIES) throw new Error('请先配置至少两个转盘选项。');
    if (activeSpin && Date.now() - activeSpin.startedAt < activeSpin.durationMs) {
      const error = new Error('转盘正在转动，请稍候再抽取。');
      error.statusCode = 409;
      throw error;
    }
    const index = chooseWeightedEntry(entries, random);
    const now = Date.now();
    activeSpin = {
      id: `${now}-${index}-${Math.floor(random() * 1000000)}`,
      index,
      startedAt: now,
      durationMs: SPIN_DURATION_MS,
      turns: SPIN_TURNS
    };
    lastResult = { index, label: entries[index].label, selectedAt: new Date(now).toISOString() };
    publish();
    const spinId = activeSpin.id;
    clearTimeout(spinTimer);
    spinTimer = setTimeout(() => {
      if (activeSpin?.id === spinId) publish();
    }, SPIN_DURATION_MS);
    spinTimer.unref?.();
    return getState();
  }

  function publish() {
    broadcast({ type: 'wheel:update', state: getState() });
  }

  return { getState, configure, spin };
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
  createWheelSessionService
};
