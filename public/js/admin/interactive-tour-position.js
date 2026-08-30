'use strict';

export function clamp(value, min, max) {
  return Math.min(Math.max(value, min), max);
}

export function calculateTooltipPositionImpl(
  targetRect,
  tooltipWidth,
  tooltipHeight,
  preferredPosition,
  viewport = {
    width: globalThis.window?.innerWidth || 0,
    height: globalThis.window?.innerHeight || 0,
  },
) {
  const padding = 16;
  const gap = 12;
  const arrowPadding = 24;

  // 只有没有目标的开始和结束步骤才居中显示。
  if (!targetRect || preferredPosition === 'center') {
    return {
      position: 'center',
      top: (viewport.height - tooltipHeight) / 2,
      left: (viewport.width - tooltipWidth) / 2,
      arrowOffset: null,
    };
  }

  const availableSpace = {
    bottom: viewport.height - targetRect.bottom - gap - padding,
    top: targetRect.top - gap - padding,
    right: viewport.width - targetRect.right - gap - padding,
    left: targetRect.left - gap - padding,
  };
  const requiredSpace = {
    bottom: tooltipHeight,
    top: tooltipHeight,
    right: tooltipWidth,
    left: tooltipWidth,
  };
  const fallbackOrder = {
    bottom: ['bottom', 'top', 'right', 'left'],
    top: ['top', 'bottom', 'right', 'left'],
    right: ['right', 'left', 'bottom', 'top'],
    left: ['left', 'right', 'bottom', 'top'],
  };
  const candidates = fallbackOrder[preferredPosition] || fallbackOrder.bottom;
  const position =
    candidates.find((side) => availableSpace[side] >= requiredSpace[side]) ||
    candidates.reduce((best, side) =>
      availableSpace[side] > availableSpace[best] ? side : best,
    );
  const positions = {
    bottom: {
      top: targetRect.bottom + gap,
      left: targetRect.left + (targetRect.width - tooltipWidth) / 2,
    },
    top: {
      top: targetRect.top - tooltipHeight - gap,
      left: targetRect.left + (targetRect.width - tooltipWidth) / 2,
    },
    right: {
      top: targetRect.top + (targetRect.height - tooltipHeight) / 2,
      left: targetRect.right + gap,
    },
    left: {
      top: targetRect.top + (targetRect.height - tooltipHeight) / 2,
      left: targetRect.left - tooltipWidth - gap,
    },
  };
  const placement = positions[position];
  const top = clamp(
    placement.top,
    padding,
    Math.max(padding, viewport.height - tooltipHeight - padding),
  );
  const left = clamp(
    placement.left,
    padding,
    Math.max(padding, viewport.width - tooltipWidth - padding),
  );
  const targetCenter =
    position === 'top' || position === 'bottom'
      ? targetRect.left + targetRect.width / 2 - left
      : targetRect.top + targetRect.height / 2 - top;
  const arrowLimit =
    position === 'top' || position === 'bottom' ? tooltipWidth : tooltipHeight;

  return {
    position,
    top,
    left,
    arrowOffset: clamp(
      targetCenter,
      arrowPadding,
      Math.max(arrowPadding, arrowLimit - arrowPadding),
    ),
  };
}
