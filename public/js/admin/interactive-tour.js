'use strict';

/**
 * 交互式引导系统 - 聚光灯高亮 + 浮动提示
 * 自动切换到目标功能位置，高亮目标元素，等待用户完成真实操作
 */

import { toast as defaultToast } from '../shared/utils.js';

export const TOUR_VERSION = 6;
export const TOUR_COMPLETION_CHECK_INTERVAL_MS = 1500;
export const TOUR_FIRST_RUN_SHOWN_KEY = 'liraTourFirstRunShown';
const TOUR_COMPLETED_KEY = 'liraTourCompleted';

export function claimFirstRunTour(storage) {
  if (storage.getItem(TOUR_FIRST_RUN_SHOWN_KEY) !== null
      || storage.getItem(TOUR_COMPLETED_KEY) !== null) {
    return false;
  }
  storage.setItem(TOUR_FIRST_RUN_SHOWN_KEY, '1');
  return true;
}

// 引导步骤定义
export const TOUR_STEPS = [
  {
    id: 'welcome',
    title: '欢迎使用 LIRA',
    kicker: '第 0 步 · 认识 LIRA',
    content: 'LIRA 的全称是 <strong>Live Interactive Request Assistant</strong>，中文可以理解为「直播互动点歌助手」。接下来只要跟着提示，依次认识主要功能、登录 Bilibili、填写直播间、导入歌单和选择音乐平台。<br><strong>页面会自动跳到要操作的位置</strong>，看到高亮区域后照着做即可。',
    targetPage: null, // 不切换页面
    targetSelector: null, // 不高亮元素
    position: 'center', // 居中显示
    waitForAction: false, // 不等待操作，直接下一步
  },
  {
    id: 'main-navigation',
    title: '先认识顶部四个按钮',
    kicker: '第 1 步 · 认识主功能',
    content: '<strong>点歌</strong>用来管理歌库和点歌队列；<strong>播放</strong>用来选择平台并控制音乐；<strong>礼物</strong>用来查看礼物数据和提示；<strong>百宝箱</strong>放着弹幕姬、加班机、使用文档等辅助工具。',
    note: '之后想切换功能，随时点击顶部对应的按钮即可。',
    targetPage: 'songAssistantPage',
    targetTab: null,
    targetSelector: '.main-page-tabs',
    position: 'bottom',
    waitForAction: false,
  },
  {
    id: 'bilibili-login',
    title: '登录你的 Bilibili 账号',
    kicker: '第 2 步 · 登录账号',
    content: '点击高亮区域里的<strong>「扫码登录 Bilibili」</strong>，再用手机 Bilibili 扫描弹出的二维码。登录成功后，LIRA 才能稳定收到你直播间里的弹幕和礼物。',
    note: '二维码会在新窗口中打开；请在这台电脑上的 LIRA 桌面版完成。',
    targetPage: 'songAssistantPage', // 切换到点歌页
    targetTab: '[data-tab="settingsPage"]', // 切换到设置子标签
    targetSelector: '.bilibili-auth-row', // 高亮账号登录状态行
    position: 'bottom',
    waitForAction: true, // 等待用户登录
    checkCompleted: async () => {
      if (!window.bilibiliAuth?.getAuthState) return false;
      try {
        const state = await window.bilibiliAuth.getAuthState();
        return Boolean(state.loggedIn);
      } catch {
        return false;
      }
    },
  },
  {
    id: 'room-id',
    title: '填写你的直播间',
    kicker: '第 3 步 · 填写直播间',
    content: '点击高亮的输入框，填写你正在直播的房间号；也可以直接粘贴直播间网址。填好后，这一步会自动显示为已完成。',
    note: '例如：房间号「123456」，或网址「https://live.bilibili.com/123456」。',
    targetPage: 'songAssistantPage',
    targetTab: '[data-tab="settingsPage"]',
    targetSelector: '#roomId',
    position: 'bottom',
    waitForAction: true,
    checkCompleted: () => {
      const input = document.getElementById('roomId');
      return input && input.value.trim().length > 0;
    },
  },
  {
    id: 'refresh-live',
    title: '让 LIRA 连接直播间',
    kicker: '第 4 步 · 刷新连接',
    content: '页面右上角一起框选的是<strong>直播间状态</strong>和<strong>「刷新直播」</strong>按钮。点击「刷新直播」，看到左边的直播间状态变为绿色，说明 LIRA 已经连上你的直播间。',
    note: '如果没有变绿，请先检查上一步的房间号，再点击一次「刷新直播」。',
    targetPage: 'songAssistantPage',
    targetTab: null,
    targetSelector: '#liveStatus, #reconnectBtn',
    position: 'bottom',
    waitForAction: true,
    checkCompleted: () => {
      // 检查直播状态是否已连接
      const liveStatus = document.getElementById('liveStatus');
      return liveStatus && !liveStatus.classList.contains('warn');
    },
  },
  {
    id: 'import-songs',
    title: '把歌单导入 LIRA',
    kicker: '第 5 步 · 导入歌单',
    content: '现在已打开「导入导出」。把你准备好的歌单选进来：可以选择 Excel（.xlsx）、CSV 或 TSV 文件，也可以把表格内容粘贴到下方，然后点击<strong>「导入歌库」</strong>。',
    note: '暂时没有歌单也没关系，可以先点「下一步」，以后再从「点歌 → 导入导出」回来添加。',
    targetPage: 'songAssistantPage',
    targetTab: '[data-tab="importPage"]',
    targetSelector: '#importFile',
    position: 'top',
    waitForAction: false,
  },
  {
    id: 'music-platform',
    title: '选择平时听歌的平台',
    kicker: '第 6 步 · 选择音乐',
    content: '现在已打开「播放」页。先在左上方选择你平时使用的平台：QQ音乐、网易云音乐或全民 K 歌。使用 QQ音乐或网易云音乐时，点击右上方的「登录」；使用全民 K 歌时，请先在全民 K 歌客户端登录。',
    note: '这一步只告诉你登录入口，不要求现在登录；选好后可以继续。',
    targetPage: 'playbackAssistantPage',
    targetTab: null,
    targetSelector: '.source-tabs',
    position: 'bottom',
    waitForAction: false, // 只是告知，不强制等待
  },
  {
    id: 'usage-guide',
    title: '不会用时，从这里找帮助',
    kicker: '第 7 步 · 查看帮助',
    content: '这里是「百宝箱 → 使用文档」。以后忘记怎么登录、导入歌单或设置其他功能，就点击左侧的<strong>「使用文档」</strong>，再按目录查找。',
    note: '使用文档顶部还有「重新打开交互式引导」按钮，随时可以从头再看一遍。',
    targetPage: 'otherAssistantPage',
    targetTab: '[data-other-feature="otherUsageGuideFeature"]',
    targetSelector: '[data-other-feature="otherUsageGuideFeature"]',
    position: 'right',
    waitForAction: false,
  },
  {
    id: 'complete',
    title: '新手引导已完成',
    kicker: '可以开始使用了',
    content: '你已经看完最常用的设置。现在可以开始接收点歌、播放音乐和查看礼物。<br><br>还有功能不会用时，打开「百宝箱 → 使用文档」即可。',
    targetPage: null,
    targetTab: null,
    targetSelector: null,
    position: 'center',
    waitForAction: false,
  },
];

function getById(document, id) {
  return document.getElementById(id);
}

function clamp(value, min, max) {
  return Math.min(Math.max(value, min), max);
}

export function calculateTooltipPosition(
  targetRect,
  tooltipWidth,
  tooltipHeight,
  preferredPosition,
  viewport = {
    width: globalThis.window?.innerWidth || 0,
    height: globalThis.window?.innerHeight || 0,
  }
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
  const position = candidates.find(side => availableSpace[side] >= requiredSpace[side])
    || candidates.reduce((best, side) => (
      availableSpace[side] > availableSpace[best] ? side : best
    ));
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
  const top = clamp(placement.top, padding, Math.max(padding, viewport.height - tooltipHeight - padding));
  const left = clamp(placement.left, padding, Math.max(padding, viewport.width - tooltipWidth - padding));
  const targetCenter = position === 'top' || position === 'bottom'
    ? targetRect.left + targetRect.width / 2 - left
    : targetRect.top + targetRect.height / 2 - top;
  const arrowLimit = position === 'top' || position === 'bottom' ? tooltipWidth : tooltipHeight;

  return {
    position,
    top,
    left,
    arrowOffset: clamp(targetCenter, arrowPadding, Math.max(arrowPadding, arrowLimit - arrowPadding)),
  };
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
      .map(target => target.getBoundingClientRect?.())
      .filter(rect => rect && (rect.width > 0 || rect.height > 0));
    if (rects.length === 0) return null;

    const top = Math.min(...rects.map(rect => rect.top));
    const left = Math.min(...rects.map(rect => rect.left));
    const right = Math.max(...rects.map(rect => rect.right));
    const bottom = Math.max(...rects.map(rect => rect.bottom));
    return { top, left, right, bottom, width: right - left, height: bottom - top };
  }

  function updateSpotlight(targetRect) {
    if (!targetRect) {
      container.classList.remove('has-target');
      elements.spotlight.style.display = 'none';
      elements.shades.forEach((shade) => { shade.style.display = 'none'; });
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
      { top: holeBottom, left: 0, width: viewportWidth, height: viewportHeight - holeBottom },
      { top: holeTop, left: 0, width: holeLeft, height: holeBottom - holeTop },
      { top: holeTop, left: holeRight, width: viewportWidth - holeRight, height: holeBottom - holeTop },
    ];

    elements.shades.forEach((shade, index) => {
      const rect = shadeRects[index];
      shade.style.display = rect.width > 0 && rect.height > 0 ? 'block' : 'none';
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
      { width: window.innerWidth, height: window.innerHeight }
    );

    elements.tooltip.style.top = `${calculated.top}px`;
    elements.tooltip.style.left = `${calculated.left}px`;
    elements.tooltip.style.transform = 'none';
    elements.tooltip.dataset.position = calculated.position;
    elements.tooltip.style.setProperty('--tour-arrow-offset', `${calculated.arrowOffset}px`);
  }

  function renderProgressDots() {
    elements.progress.innerHTML = TOUR_STEPS.map((_, index) =>
      `<span class="lira-tour-progress-dot ${index === currentStepIndex ? 'active' : ''}"></span>`
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
    elements.next.textContent = stepIndex === TOUR_STEPS.length - 1 ? '完成' : '下一步';

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

      checkTimeout = setTimeout(checkCompletion, TOUR_COMPLETION_CHECK_INTERVAL_MS);
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
    const nextIndex = currentIndex === -1
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
  window.addEventListener('scroll', scheduleRefresh, { capture: true, passive: true });

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
  controller = createInteractiveTourController({ document, window, toast: defaultToast, ...deps });
  return controller;
}
