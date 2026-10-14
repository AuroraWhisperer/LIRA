// 参数滑块的轨道映射和视觉状态同步。只处理带 parameter-range 类的 range 输入框。
'use strict';

const PARAMETER_RANGE_SELECTOR = 'input.parameter-range[type="range"]';
const DEFAULT_THUMB_SIZE = 18;
const initializedInputs = new WeakMap();

const resizeObserver =
  typeof ResizeObserver === 'undefined'
    ? null
    : new ResizeObserver((entries) => {
        entries.forEach(({ target }) => refreshParameterRange(target));
      });

function isParameterRange(input) {
  return Boolean(input?.matches?.(PARAMETER_RANGE_SELECTOR));
}

function getFiniteNumber(value, fallback) {
  const number = Number(value);
  return Number.isFinite(number) ? number : fallback;
}

function getThumbSize(input) {
  const value =
    typeof getComputedStyle === 'function'
      ? getComputedStyle(input).getPropertyValue('--parameter-range-thumb-size')
      : '';
  return Math.max(0, getFiniteNumber(parseFloat(value), DEFAULT_THUMB_SIZE));
}

function getBalancedZeroProgress(input, min, max) {
  if (input.dataset?.rangeScale !== 'balanced' || min >= 0 || max <= 0) return null;
  return Math.min(75, Math.max(25, (-min / (max - min)) * 100));
}

/**
 * 返回滑块数值在轨道上的百分比（0–100）；balanced 模式为零点两侧各保留至少 25%。
 *
 * @param {HTMLInputElement} input 参数滑块。
 * @param {number | string} [currentValue=input.value] 要定位的实际数值。
 * @returns {number} 归一化后的百分比。
 */
export function getParameterRangeProgress(input, currentValue = input.value) {
  const min = getFiniteNumber(input.min, 0);
  const max = getFiniteNumber(input.max, 100);
  if (max <= min) return 0;

  const value = Math.min(max, Math.max(min, getFiniteNumber(currentValue, min)));
  const zeroProgress = getBalancedZeroProgress(input, min, max);
  if (zeroProgress !== null) {
    return value <= 0
      ? ((value - min) / -min) * zeroProgress
      : zeroProgress + (value / max) * (100 - zeroProgress);
  }
  return ((value - min) / (max - min)) * 100;
}

// 将轨道位置换算回实际数值；保留原生 range 的范围、步长和键盘操作。
export function getParameterRangeValue(input, progress) {
  const min = getFiniteNumber(input.min, 0);
  const max = getFiniteNumber(input.max, 100);
  if (max <= min) return min;
  const position = Math.min(100, Math.max(0, progress));
  const zeroProgress = getBalancedZeroProgress(input, min, max);
  const value = zeroProgress === null
    ? min + ((max - min) * position) / 100
    : position <= zeroProgress
      ? min + (-min * position) / zeroProgress
      : (max * (position - zeroProgress)) / (100 - zeroProgress);
  const step = input.step === 'any' ? 0 : getFiniteNumber(input.step, 1);
  const snapped = step > 0 ? min + Math.round((value - min) / step) * step : value;
  return Number(Math.min(max, Math.max(min, snapped)).toFixed(10));
}

/**
 * 返回滑块零点与当前值之间的区段，供正负值滑块从零点向两侧填充。
 * 对不跨越零点的区间，零点会收敛到最近的合法端点。
 *
 * @param {HTMLInputElement | { min: string, max: string, value: string }} input 参数滑块。
 * @returns {{ zeroProgress: number, startProgress: number, lengthProgress: number, polarity: string }} 零点区段。
 */
export function getParameterRangeOrigin(input) {
  const min = getFiniteNumber(input.min, 0);
  const max = getFiniteNumber(input.max, 100);
  if (max <= min) {
    return {
      zeroProgress: 0,
      startProgress: 0,
      lengthProgress: 0,
      polarity: 'neutral',
    };
  }

  const value = Math.min(max, Math.max(min, getFiniteNumber(input.value, min)));
  const zero = Math.min(max, Math.max(min, 0));
  const valueProgress = getParameterRangeProgress(input, value);
  const zeroProgress = getParameterRangeProgress(input, zero);

  return {
    zeroProgress,
    startProgress: Math.min(valueProgress, zeroProgress),
    lengthProgress: Math.abs(valueProgress - zeroProgress),
    polarity: value < zero ? 'negative' : value > zero ? 'positive' : 'neutral',
  };
}

/**
 * 同步一个参数滑块的视觉 CSS 变量。
 *
 * 拇指中心的行程两端各内缩半个拇指直径，非线性轨道再补偿原生拇指的位置。
 *
 * @param {HTMLInputElement} input 参数滑块。
 */
export function refreshParameterRange(input) {
  if (!isParameterRange(input)) return;

  const progress = getParameterRangeProgress(input);
  const origin = getParameterRangeOrigin(input);
  const thumbSize = getThumbSize(input);
  const width = getFiniteNumber(input.getBoundingClientRect?.().width, 0);
  const trackLength = Math.max(0, width - thumbSize);
  const nativeProgress = getParameterRangeProgress({ min: input.min, max: input.max, value: input.value });
  const fillLength = trackLength * (progress / 100);
  const originStart = thumbSize / 2 + trackLength * (origin.startProgress / 100);
  const originLength = trackLength * (origin.lengthProgress / 100);
  const zeroPosition = thumbSize / 2 + trackLength * (origin.zeroProgress / 100);

  input.style.setProperty('--parameter-range-progress', `${progress}%`);
  input.style.setProperty('--parameter-range-track-inset', `${thumbSize / 2}px`);
  input.style.setProperty('--parameter-range-track-length', `${trackLength}px`);
  input.style.setProperty('--parameter-range-fill-length', `${fillLength}px`);
  input.style.setProperty('--parameter-range-origin-start', `${originStart}px`);
  input.style.setProperty('--parameter-range-origin-length', `${originLength}px`);
  input.style.setProperty('--parameter-range-zero-position', `${zeroPosition}px`);
  input.style.setProperty('--parameter-range-thumb-offset', `${(trackLength * (progress - nativeProgress)) / 100}px`);
  if (input.dataset) input.dataset.rangePolarity = origin.polarity;
}

function bindBalancedPointer(input) {
  if (input.dataset?.rangeScale !== 'balanced') return;
  let pointerId = null;
  let startValue;
  const update = (event) => {
    if (event.pointerId !== pointerId || input.disabled) return;
    const bounds = input.getBoundingClientRect();
    const thumbSize = getThumbSize(input);
    const length = bounds.width - thumbSize;
    if (length <= 0) return;
    const previous = input.value;
    input.value = String(getParameterRangeValue(input, ((event.clientX - bounds.left - thumbSize / 2) / length) * 100));
    if (input.value !== previous) input.dispatchEvent(new Event('input', { bubbles: true }));
  };
  const down = (event) => {
    if (input.disabled || !event.isPrimary || event.button !== 0) return;
    event.preventDefault();
    input.focus();
    pointerId = event.pointerId;
    startValue = input.value;
    input.setPointerCapture(pointerId);
    update(event);
  };
  const finish = (event) => {
    if (event.pointerId !== pointerId) return;
    if (event.type === 'pointerup') update(event);
    pointerId = null;
    if (input.hasPointerCapture(event.pointerId)) input.releasePointerCapture(event.pointerId);
    if (input.value !== startValue) input.dispatchEvent(new Event('change', { bubbles: true }));
  };
  const listeners = { pointerdown: down, pointermove: update, pointerup: finish, pointercancel: finish, lostpointercapture: finish };
  for (const [type, listener] of Object.entries(listeners)) input.addEventListener(type, listener);
  return () => {
    for (const [type, listener] of Object.entries(listeners)) input.removeEventListener(type, listener);
    if (pointerId !== null && input.hasPointerCapture(pointerId)) input.releasePointerCapture(pointerId);
    pointerId = null;
  };
}

function getInputs(root) {
  if (!root) return [];
  if (isParameterRange(root)) return [root];
  return Array.from(root.querySelectorAll?.(PARAMETER_RANGE_SELECTOR) ?? []);
}

/**
 * 初始化 root 下所有参数滑块。可重复调用，新节点会被接入，已初始化节点不会重复绑定事件。
 *
 * @param {Document | Element} [root=document] 要扫描的根节点。
 * @returns {HTMLInputElement[]} 已扫描到的参数滑块。
 */
export function initParameterRanges(root = document) {
  const inputs = getInputs(root);

  inputs.forEach((input) => {
    refreshParameterRange(input);
    if (initializedInputs.has(input)) return;

    const refresh = () => refreshParameterRange(input);
    input.addEventListener('input', refresh);
    input.addEventListener('change', refresh);
    resizeObserver?.observe(input);
    initializedInputs.set(input, { refresh, disposePointer: bindBalancedPointer(input) });
  });

  return inputs;
}

export function disposeParameterRanges(root) {
  for (const input of getInputs(root)) {
    const initialized = initializedInputs.get(input);
    if (!initialized) continue;
    const { refresh, disposePointer } = initialized;
    input.removeEventListener('input', refresh);
    input.removeEventListener('change', refresh);
    disposePointer?.();
    resizeObserver?.unobserve(input);
    initializedInputs.delete(input);
  }
}
