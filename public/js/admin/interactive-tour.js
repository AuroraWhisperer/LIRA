'use strict';

/**
 * 交互式引导系统 - 聚光灯高亮 + 浮动提示
 * 自动切换到目标功能位置，高亮目标元素，等待用户完成真实操作
 */

import { toast as defaultToast } from '../shared/utils.js';
import {
  TOUR_CONFIG_VERSION,
  TOUR_CONFIG_COMPLETION_CHECK_INTERVAL_MS,
  TOUR_CONFIG_FIRST_RUN_SHOWN_KEY,
  TOUR_CONFIG_STEPS,
  claimFirstRunTourFromStorage,
} from './interactive-tour-config.js';
import {
  calculateTooltipPositionImpl,
  clamp,
} from './interactive-tour-position.js';

export const TOUR_VERSION = TOUR_CONFIG_VERSION;
export const TOUR_COMPLETION_CHECK_INTERVAL_MS =
  TOUR_CONFIG_COMPLETION_CHECK_INTERVAL_MS;
export const TOUR_FIRST_RUN_SHOWN_KEY = TOUR_CONFIG_FIRST_RUN_SHOWN_KEY;
export const TOUR_STEPS = TOUR_CONFIG_STEPS;
export const claimFirstRunTour = claimFirstRunTourFromStorage;
export const calculateTooltipPosition = calculateTooltipPositionImpl;

const TOUR_COMPLETED_KEY = 'liraTourCompleted';

function getById(document, id) {
  return document.getElementById(id);
}

export function createInteractiveTourController(deps = {}) {
  const document = deps.document || globalThis.document;
  const window = deps.window || globalThis.window || {};
  const toast = deps.toast || defaultToast;

  const container = document.createElement('div');
  container.className = 'lira-tour';
  container.hidden = true;
  container.innerHTML = `
    <div class="lira-tour-backdrop"></div>
    <div class="lira-tour-shade lira-tour-shade-top"></div>
    <div class="lira-tour-shade lira-tour-shade-bottom"></div>
    <div class="lira-tour-shade lira-tour-shade-left"></div>
    <div class="lira-tour-shade lira-tour-shade-right"></div>
    <div class="lira-tour-spotlight"></div>
    <div class="lira-tour-tooltip" data-position="bottom">
      <div class="lira-tour-header">
        <div>
          <span class="lira-tour-kicker"></span>
          <h3 class="lira-tour-title"></h3>
        </div>
        <button class="lira-tour-close" type="button" aria-label="退出引导"><span class="lira-tour-close-mark" aria-hidden="true">×</span></button>
      </div>
      <div class="lira-tour-body"></div>
      <div class="lira-tour-footer">
        <div class="lira-tour-progress"></div>
        <div class="lira-tour-actions">
          <button class="lira-tour-prev secondary" type="button">上一步</button>
          <button class="lira-tour-next primary" type="button">下一步</button>
        </div>
      </div>
    </div>
    <div class="lira-tour-exit-confirmation" hidden>
      <section
        class="lira-tour-exit-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="liraTourExitTitle"
        aria-describedby="liraTourExitDescription"
      >
        <div class="lira-tour-exit-header">
          <span class="lira-tour-exit-icon" aria-hidden="true">!</span>
          <div>
            <span class="lira-tour-exit-kicker">退出确认</span>
            <h3 id="liraTourExitTitle">退出当前引导？</h3>
          </div>
        </div>
        <p id="liraTourExitDescription">
          退出后可以从「百宝箱 → 使用文档」重新打开，已经完成的设置不会改变。
        </p>
        <div class="lira-tour-exit-actions">
          <button class="lira-tour-exit-stay" type="button">继续引导</button>
          <button class="lira-tour-exit-leave" type="button">退出引导</button>
        </div>
      </section>
    </div>
  `;

  document.body.appendChild(container);

  const elements = {
    backdrop: container.querySelector('.lira-tour-backdrop'),
    shades: Array.from(container.querySelectorAll('.lira-tour-shade')),
    spotlight: container.querySelector('.lira-tour-spotlight'),
    tooltip: container.querySelector('.lira-tour-tooltip'),
    kicker: container.querySelector('.lira-tour-kicker'),
    title: container.querySelector('.lira-tour-title'),
    body: container.querySelector('.lira-tour-body'),
    progress: container.querySelector('.lira-tour-progress'),
    prev: container.querySelector('.lira-tour-prev'),
    next: container.querySelector('.lira-tour-next'),
    close: container.querySelector('.lira-tour-close'),
    exitConfirmation: container.querySelector('.lira-tour-exit-confirmation'),
    exitStay: container.querySelector('.lira-tour-exit-stay'),
    exitLeave: container.querySelector('.lira-tour-exit-leave'),
  };

  let currentStepIndex = 0;
  let isOpen = false;
  let checkTimeout = null;
  let completionCheckId = 0;
  let cancelScheduledRefresh = null;
  let tooltipSize = null;
  let lastLayoutKey = '';
  let exitConfirmationReturnFocus = null;
  let renderSequence = 0;
  let isRenderingStep = false;

  function waitForPaint() {
    return new Promise((resolve) => {
      if (typeof window.requestAnimationFrame === 'function') {
        window.requestAnimationFrame(resolve);
      } else {
        setTimeout(resolve, 0);
      }
    });
  }

  function switchToPage(pageId) {
    if (!pageId) return;
    const tab = document.querySelector(`[data-main-page="${pageId}"]`);
    if (!tab || tab.classList.contains('active')) return false;
    tab.click();
    return true;
  }

  function switchToTab(tabSelector) {
    if (!tabSelector) return;
    const tab = document.querySelector(tabSelector);
    if (!tab || tab.classList.contains('active')) return false;
    tab.click();
    return true;
  }

  function getTargets(selector) {
    return selector ? Array.from(document.querySelectorAll(selector)) : [];
  }

  function getTargetRect(targets) {
    const rects = targets
      .map((target) => target.getBoundingClientRect?.())
      .filter((rect) => rect && (rect.width > 0 || rect.height > 0));
    if (rects.length === 0) return null;

    const top = Math.min(...rects.map((rect) => rect.top));
    const left = Math.min(...rects.map((rect) => rect.left));
    const right = Math.max(...rects.map((rect) => rect.right));
    const bottom = Math.max(...rects.map((rect) => rect.bottom));
    return {
      top,
      left,
      right,
      bottom,
      width: right - left,
      height: bottom - top,
    };
  }

  function updateSpotlight(targetRect) {
    if (!targetRect) {
      container.classList.remove('has-target');
      elements.spotlight.style.display = 'none';
      elements.shades.forEach((shade) => {
        shade.style.display = 'none';
      });
      return;
    }

    container.classList.add('has-target');
    const viewportWidth = window.innerWidth;
    const viewportHeight = window.innerHeight;
    const holeTop = clamp(targetRect.top - 8, 0, viewportHeight);
    const holeLeft = clamp(targetRect.left - 8, 0, viewportWidth);
    const holeRight = clamp(targetRect.right + 8, 0, viewportWidth);
    const holeBottom = clamp(targetRect.bottom + 8, 0, viewportHeight);
    const shadeRects = [
      { top: 0, left: 0, width: viewportWidth, height: holeTop },
      {
        top: holeBottom,
        left: 0,
        width: viewportWidth,
        height: viewportHeight - holeBottom,
      },
      { top: holeTop, left: 0, width: holeLeft, height: holeBottom - holeTop },
      {
        top: holeTop,
        left: holeRight,
        width: viewportWidth - holeRight,
        height: holeBottom - holeTop,
      },
    ];

    elements.shades.forEach((shade, index) => {
      const rect = shadeRects[index];
      shade.style.display =
        rect.width > 0 && rect.height > 0 ? 'block' : 'none';
      shade.style.top = `${rect.top}px`;
      shade.style.left = `${rect.left}px`;
      shade.style.width = `${Math.max(0, rect.width)}px`;
      shade.style.height = `${Math.max(0, rect.height)}px`;
    });
    elements.spotlight.style.display = 'block';
    elements.spotlight.style.top = `${targetRect.top - 8}px`;
    elements.spotlight.style.left = `${targetRect.left - 8}px`;
    elements.spotlight.style.width = `${targetRect.width + 16}px`;
    elements.spotlight.style.height = `${targetRect.height + 16}px`;
  }

  function refreshPosition(step = TOUR_STEPS[currentStepIndex]) {
    const targets = getTargets(step?.targetSelector);
    const targetRect = getTargetRect(targets);
    if (targets.length > 0 && !targetRect) return;
    const layoutKey = targetRect
      ? [
          targetRect.top,
          targetRect.left,
          targetRect.right,
          targetRect.bottom,
          window.innerWidth,
          window.innerHeight,
        ].join(':')
      : `center:${window.innerWidth}:${window.innerHeight}`;
    if (layoutKey === lastLayoutKey) return;
    lastLayoutKey = layoutKey;
    updateSpotlight(targetRect);
    positionTooltip(targetRect, step?.position || 'center');
  }

  function scheduleRefresh() {
    if (!isOpen || cancelScheduledRefresh) return;
    const runRefresh = () => {
      cancelScheduledRefresh = null;
      if (!isOpen) return;
      refreshPosition();
    };

    if (typeof window.requestAnimationFrame === 'function') {
      const frameId = window.requestAnimationFrame(runRefresh);
      cancelScheduledRefresh = () => window.cancelAnimationFrame?.(frameId);
      return;
    }

    const timeoutId = setTimeout(runRefresh, 16);
    cancelScheduledRefresh = () => clearTimeout(timeoutId);
  }

  function stopScheduledRefresh() {
    cancelScheduledRefresh?.();
    cancelScheduledRefresh = null;
  }

  function highlightElement(selector) {
    if (!selector) {
      updateSpotlight(null);
      return null;
    }

    const targets = getTargets(selector);
    if (targets.length === 0) {
      updateSpotlight(null);
      return null;
    }

    targets[0].scrollIntoView({ behavior: 'auto', block: 'center' });
    return targets;
  }

  function positionTooltip(targetRect, position) {
    if (!targetRect) {
      elements.tooltip.style.top = '50%';
      elements.tooltip.style.left = '50%';
      elements.tooltip.style.transform = 'translate(-50%, -50%)';
      elements.tooltip.dataset.position = 'center';
      elements.tooltip.style.removeProperty('--tour-arrow-offset');
      return;
    }

    if (!tooltipSize) {
      const tooltipRect = elements.tooltip.getBoundingClientRect();
      tooltipSize = { width: tooltipRect.width, height: tooltipRect.height };
    }
    const calculated = calculateTooltipPosition(
      targetRect,
      tooltipSize.width,
      tooltipSize.height,
      position,
      { width: window.innerWidth, height: window.innerHeight },
    );

    elements.tooltip.style.top = `${calculated.top}px`;
    elements.tooltip.style.left = `${calculated.left}px`;
    elements.tooltip.style.transform = 'none';
    elements.tooltip.dataset.position = calculated.position;
    elements.tooltip.style.setProperty(
      '--tour-arrow-offset',
      `${calculated.arrowOffset}px`,
    );
  }

  function renderProgressDots() {
    elements.progress.innerHTML = TOUR_STEPS.map(
      (_, index) =>
        `<span class="lira-tour-progress-dot ${index === currentStepIndex ? 'active' : ''}"></span>`,
    ).join('');
  }

  async function renderStep(stepIndex) {
    const step = TOUR_STEPS[stepIndex];
    if (!step) return;

    const sequence = ++renderSequence;
    isRenderingStep = true;
    currentStepIndex = stepIndex;
    stopScheduledRefresh();
    stopCheckingCompletion();

    // 先更新提示内容，再切换底层页面，让点击后的反馈立即可见。
    elements.kicker.textContent = step.kicker || '';
    elements.title.textContent = step.title || '';

    let bodyHTML = step.content || '';
    if (step.note) {
      bodyHTML += `<p class="lira-tour-note">${step.note}</p>`;
    }

    if (step.waitForAction) {
      bodyHTML += `<div class="lira-tour-status waiting">请按上面的提示完成这一步</div>`;
    }

    elements.body.innerHTML = bodyHTML;
    tooltipSize = null;
    lastLayoutKey = '';
    renderProgressDots();
    elements.prev.disabled = stepIndex === 0;
    elements.next.textContent =
      stepIndex === TOUR_STEPS.length - 1 ? '完成' : '下一步';

    // 切换到目标页面和标签
    const pageChanged = switchToPage(step.targetPage);
    const tabChanged = switchToTab(step.targetTab);
    if (pageChanged || tabChanged) await waitForPaint();

    if (sequence !== renderSequence || !isOpen) return;

    // 页面/标签已经稳定后再滚动和测量，避免用隐藏目标的零坐标定位。
    highlightElement(step.targetSelector);
    scheduleRefresh();

    if (step.waitForAction && step.checkCompleted) {
      startCheckingCompletion(step);
    }

    isRenderingStep = false;
  }

  function startCheckingCompletion(step) {
    stopCheckingCompletion();
    const checkId = completionCheckId;

    const checkCompletion = async () => {
      const completed = await step.checkCompleted();
      if (!isOpen || checkId !== completionCheckId) return;

      if (completed) {
        const statusEl = elements.body.querySelector('.lira-tour-status');
        if (statusEl) {
          statusEl.className = 'lira-tour-status completed';
          statusEl.textContent = '这一步已完成，可以点击「下一步」';
          tooltipSize = null;
          lastLayoutKey = '';
          scheduleRefresh();
        }
        stopCheckingCompletion();
        return;
      }

      checkTimeout = setTimeout(
        checkCompletion,
        TOUR_COMPLETION_CHECK_INTERVAL_MS,
      );
    };

    void checkCompletion();
  }

  function stopCheckingCompletion() {
    completionCheckId += 1;
    if (checkTimeout !== null) {
      clearTimeout(checkTimeout);
      checkTimeout = null;
    }
  }

  function next() {
    if (isRenderingStep) return;
    if (currentStepIndex < TOUR_STEPS.length - 1) {
      renderStep(currentStepIndex + 1);
    } else {
      close(true);
    }
  }

  function prev() {
    if (isRenderingStep) return;
    if (currentStepIndex > 0) {
      renderStep(currentStepIndex - 1);
    }
  }

  function showExitConfirmation() {
    if (!isOpen || !elements.exitConfirmation.hidden) return;
    exitConfirmationReturnFocus = document.activeElement;
    elements.exitConfirmation.hidden = false;
    container.classList.add('is-exit-confirming');
    elements.tooltip.setAttribute('aria-hidden', 'true');
    elements.exitStay.focus();
  }

  function hideExitConfirmation(restoreFocus = true) {
    const returnFocus = exitConfirmationReturnFocus;
    exitConfirmationReturnFocus = null;
    if (elements.exitConfirmation.hidden) return;

    elements.exitConfirmation.hidden = true;
    container.classList.remove('is-exit-confirming');
    elements.tooltip.removeAttribute('aria-hidden');
    if (restoreFocus && isOpen) returnFocus?.focus?.();
  }

  function open() {
    renderSequence += 1;
    isOpen = true;
    document.documentElement.classList.add('lira-tour-active');
    container.hidden = false;
    currentStepIndex = 0;
    renderStep(0);
  }

  function close(completed = false) {
    renderSequence += 1;
    isRenderingStep = false;
    hideExitConfirmation(false);
    isOpen = false;
    document.documentElement.classList.remove('lira-tour-active');
    container.hidden = true;
    stopCheckingCompletion();
    stopScheduledRefresh();
    tooltipSize = null;
    lastLayoutKey = '';
    container.classList.remove('has-target');

    if (completed) {
      toast('引导已完成');
      localStorage.setItem(TOUR_COMPLETED_KEY, String(TOUR_VERSION));
    }
  }

  // 绑定事件
  elements.next.addEventListener('click', next);
  elements.prev.addEventListener('click', prev);
  elements.close.addEventListener('click', showExitConfirmation);
  elements.exitStay.addEventListener('click', () => hideExitConfirmation());
  elements.exitLeave.addEventListener('click', () => close(false));
  elements.exitConfirmation.addEventListener('click', (event) => {
    if (event.target === elements.exitConfirmation) hideExitConfirmation();
  });
  elements.exitConfirmation.addEventListener('keydown', (event) => {
    if (event.key === 'Escape') {
      event.preventDefault();
      hideExitConfirmation();
      return;
    }

    if (event.key !== 'Tab') return;
    const buttons = [elements.exitStay, elements.exitLeave];
    const currentIndex = buttons.indexOf(document.activeElement);
    const direction = event.shiftKey ? -1 : 1;
    const nextIndex =
      currentIndex === -1
        ? 0
        : (currentIndex + direction + buttons.length) % buttons.length;
    event.preventDefault();
    buttons[nextIndex].focus();
  });
  const refreshOnResize = () => {
    tooltipSize = null;
    lastLayoutKey = '';
    scheduleRefresh();
  };
  window.addEventListener('resize', refreshOnResize);
  window.addEventListener('scroll', scheduleRefresh, {
    capture: true,
    passive: true,
  });

  return {
    open,
    close,
    next,
    prev,
    claimAutoOpen: () => claimFirstRunTour(localStorage),
    reset: () => {
      open();
    },
  };
}

let controller = null;
export function initInteractiveTour(deps = {}) {
  if (controller) return controller;
  controller = createInteractiveTourController({
    document,
    window,
    toast: defaultToast,
    ...deps,
  });
  return controller;
}
