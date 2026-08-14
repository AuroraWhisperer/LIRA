// 参数滑块的视觉状态同步。只处理带 parameter-range 类的 range 输入框。
'use strict';

const PARAMETER_RANGE_SELECTOR = 'input.parameter-range[type="range"]';
const DEFAULT_THUMB_SIZE = 18;
const initializedInputs = new WeakSet();

const resizeObserver = typeof ResizeObserver === 'undefined'
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
  const value = typeof getComputedStyle === 'function'
    ? getComputedStyle(input).getPropertyValue('--parameter-range-thumb-size')
    : '';
  return Math.max(0, getFiniteNumber(parseFloat(value), DEFAULT_THUMB_SIZE));
}

/**
 * 返回滑块当前值在其合法区间中的百分比（0–100）。
 *
 * @param {HTMLInputElement} input 参数滑块。
 * @returns {number} 归一化后的百分比。
 */
export function getParameterRangeProgress(input) {
  const min = getFiniteNumber(input.min, 0);
  const max = getFiniteNumber(input.max, 100);
  if (max <= min) return 0;

  const value = Math.min(max, Math.max(min, getFiniteNumber(input.value, min)));
  return ((value - min) / (max - min)) * 100;
}

/**
 * 同步一个参数滑块的视觉 CSS 变量。
 *
 * 轨道两端各内缩半个拇指直径，故 0% 和 100% 时轨道端点与拇指中心重合。
 *
 * @param {HTMLInputElement} input 参数滑块。
 */
export function refreshParameterRange(input) {
  if (!isParameterRange(input)) return;

  const progress = getParameterRangeProgress(input);
  const thumbSize = getThumbSize(input);
  const width = getFiniteNumber(input.getBoundingClientRect?.().width, 0);
  const trackLength = Math.max(0, width - thumbSize);
  const fillLength = trackLength * (progress / 100);

  input.style.setProperty('--parameter-range-progress', `${progress}%`);
  input.style.setProperty('--parameter-range-track-inset', `${thumbSize / 2}px`);
  input.style.setProperty('--parameter-range-track-length', `${trackLength}px`);
  input.style.setProperty('--parameter-range-fill-length', `${fillLength}px`);
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
    initializedInputs.add(input);
  });

  return inputs;
}
