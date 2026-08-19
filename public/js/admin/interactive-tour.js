'use strict';

/**
 * 交互式引导系统 - 聚光灯高亮 + 浮动提示
 * 自动切换到目标功能位置，高亮目标元素，等待用户完成真实操作
 */

import { toast as defaultToast } from '../shared/utils.js';

export const TOUR_VERSION = 1;

// 引导步骤定义
export const TOUR_STEPS = [
  {
    id: 'welcome',
    title: '欢迎使用 LIRA',
    kicker: '开始配置',
    content: '接下来会带你完成基础配置：登录 Bilibili、连接直播间、导入歌单、选择音乐平台。<br><strong>引导会自动切换到对应功能位置</strong>，你只需跟着提示完成操作即可。',
    targetPage: null, // 不切换页面
    targetSelector: null, // 不高亮元素
    position: 'center', // 居中显示
    waitForAction: false, // 不等待操作，直接下一步
  },
  {
    id: 'bilibili-login',
    title: '登录 Bilibili 账号',
    kicker: '第 1 步 · 账号登录',
    content: '点击这个按钮扫码登录你的 Bilibili 账号。登录后才能接收弹幕和礼物数据。',
    note: '需要桌面版才能扫码；网页模式可以先了解流程。',
    targetPage: 'songAssistantPage', // 切换到点歌页
    targetTab: 'settingsTab', // 切换到设置子标签
    targetSelector: '#bilibiliLoginBtn', // 高亮登录按钮
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
    title: '填写直播间号',
    kicker: '第 2 步 · 连接直播间',
    content: '在这里填写你的直播间号或直播间链接，然后点击右上角的<strong>「刷新直播」</strong>按钮让连接生效。',
    targetPage: 'songAssistantPage',
    targetTab: 'settingsTab',
    targetSelector: '#roomIdInput',
    position: 'bottom',
    waitForAction: true,
    checkCompleted: () => {
      const input = document.getElementById('roomIdInput');
      return input && input.value.trim().length > 0;
    },
  },
  {
    id: 'refresh-live',
    title: '刷新直播连接',
    kicker: '第 2 步 · 连接直播间',
    content: '点击这个按钮让刚才填的直播间号生效。刷新后右上角的状态指示灯会变成绿色。',
    targetPage: 'songAssistantPage',
    targetTab: null,
    targetSelector: '#reconnectBtn',
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
    title: '导入你的歌单',
    kicker: '第 3 步 · 歌库准备',
    content: '点击这个标签，打开导入导出功能。你可以上传 XLSX、CSV 文件，或直接粘贴表格内容来导入歌曲。',
    note: '引导不会帮你导入歌曲，你需要自己准备好歌单文件。',
    targetPage: 'songAssistantPage',
    targetTab: null,
    targetSelector: '[data-tab="importPage"]',
    position: 'bottom',
    waitForAction: true,
    checkCompleted: () => {
      const tab = document.querySelector('[data-tab="importPage"]');
      return tab && tab.classList.contains('active');
    },
  },
  {
    id: 'music-platform',
    title: '选择音乐平台',
    kicker: '第 4 步 · 音乐登录',
    content: '切换到播放页，选择你要用的音乐平台（QQ音乐、网易云或全民K歌）。前两个在播放页顶部登录，全民K歌需要在它自己的客户端登录。',
    targetPage: 'playbackAssistantPage',
    targetTab: null,
    targetSelector: '.playback-platform-tabs',
    position: 'bottom',
    waitForAction: false, // 只是告知，不强制等待
  },
  {
    id: 'usage-guide',
    title: '随时查看完整文档',
    kicker: '第 5 步 · 后续帮助',
    content: '遇到问题时，可以从这里打开使用文档。文档里有详细的功能说明和常见问题解答。',
    targetPage: 'otherAssistantPage',
    targetTab: null,
    targetSelector: '[data-other-feature-tab="otherUsageGuideFeature"]',
    position: 'right',
    waitForAction: false,
  },
  {
    id: 'complete',
    title: '配置完成！',
    kicker: '全部完成',
    content: '基础配置已经走完了。现在可以开始用 LIRA 管理点歌、播放音乐、查看礼物了。<br><br>需要的话可以随时从使用文档重新打开这个引导。',
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
    <div class="lira-tour-spotlight"></div>
    <div class="lira-tour-tooltip" data-position="bottom">
      <div class="lira-tour-header">
        <div>
          <span class="lira-tour-kicker"></span>
          <h3 class="lira-tour-title"></h3>
        </div>
        <button class="lira-tour-close" type="button" aria-label="退出引导">×</button>
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
  `;

  document.body.appendChild(container);

  const elements = {
    backdrop: container.querySelector('.lira-tour-backdrop'),
    spotlight: container.querySelector('.lira-tour-spotlight'),
    tooltip: container.querySelector('.lira-tour-tooltip'),
    kicker: container.querySelector('.lira-tour-kicker'),
    title: container.querySelector('.lira-tour-title'),
    body: container.querySelector('.lira-tour-body'),
    progress: container.querySelector('.lira-tour-progress'),
    prev: container.querySelector('.lira-tour-prev'),
    next: container.querySelector('.lira-tour-next'),
    close: container.querySelector('.lira-tour-close'),
  };

  let currentStepIndex = 0;
  let isOpen = false;
  let checkInterval = null;

  function switchToPage(pageId) {
    if (!pageId) return;
    const tab = document.querySelector(`[data-main-page="${pageId}"]`);
    if (tab) {
      tab.click();
      // 等待页面切换动画
      return new Promise(resolve => setTimeout(resolve, 300));
    }
  }

  function switchToTab(tabSelector) {
    if (!tabSelector) return;
    const tab = document.querySelector(tabSelector);
    if (tab) {
      tab.click();
      return new Promise(resolve => setTimeout(resolve, 200));
    }
  }

  function getTarget(selector) {
    return selector ? document.querySelector(selector) : null;
  }

  function updateSpotlight(targetRect) {
    if (!targetRect) {
      container.classList.remove('has-target');
      elements.spotlight.style.display = 'none';
      return;
    }

    container.classList.add('has-target');
    elements.spotlight.style.display = 'block';
    elements.spotlight.style.top = `${targetRect.top - 8}px`;
    elements.spotlight.style.left = `${targetRect.left - 8}px`;
    elements.spotlight.style.width = `${targetRect.width + 16}px`;
    elements.spotlight.style.height = `${targetRect.height + 16}px`;
  }

  function refreshPosition(step = TOUR_STEPS[currentStepIndex]) {
    const target = getTarget(step?.targetSelector);
    const targetRect = target?.getBoundingClientRect?.() || null;
    updateSpotlight(targetRect);
    positionTooltip(targetRect, step?.position || 'center');
  }

  function highlightElement(selector) {
    if (!selector) {
      updateSpotlight(null);
      return null;
    }

    const target = getTarget(selector);
    if (!target) {
      updateSpotlight(null);
      return null;
    }

    target.scrollIntoView({ behavior: 'smooth', block: 'center' });
    return target;
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

    const tooltipRect = elements.tooltip.getBoundingClientRect();
    const calculated = calculateTooltipPosition(
      targetRect,
      tooltipRect.width,
      tooltipRect.height,
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

    currentStepIndex = stepIndex;

    // 切换到目标页面和标签
    await switchToPage(step.targetPage);
    await switchToTab(step.targetTab);

    // 更新内容
    elements.kicker.textContent = step.kicker || '';
    elements.title.textContent = step.title || '';

    let bodyHTML = step.content || '';
    if (step.note) {
      bodyHTML += `<p class="lira-tour-note">${step.note}</p>`;
    }

    // 如果需要等待操作，添加状态提示
    if (step.waitForAction) {
      bodyHTML += `<div class="lira-tour-status waiting">等待你完成这一步...</div>`;
    }

    elements.body.innerHTML = bodyHTML;

    // 先滚动到目标，再在滚动事件中持续刷新聚光灯和浮卡位置。
    highlightElement(step.targetSelector);

    setTimeout(() => refreshPosition(step), 50);

    // 更新进度点
    renderProgressDots();

    // 更新按钮状态
    elements.prev.disabled = stepIndex === 0;
    elements.next.textContent = stepIndex === TOUR_STEPS.length - 1 ? '完成' : '下一步';

    // 如果需要等待操作，开始检查
    if (step.waitForAction && step.checkCompleted) {
      startCheckingCompletion(step);
    } else {
      stopCheckingCompletion();
    }
  }

  function startCheckingCompletion(step) {
    stopCheckingCompletion();

    checkInterval = setInterval(async () => {
      const completed = await step.checkCompleted();
      if (completed) {
        const statusEl = elements.body.querySelector('.lira-tour-status');
        if (statusEl) {
          statusEl.className = 'lira-tour-status completed';
          statusEl.textContent = '✓ 完成！可以继续下一步了';
        }
        stopCheckingCompletion();
      }
    }, 500);
  }

  function stopCheckingCompletion() {
    if (checkInterval) {
      clearInterval(checkInterval);
      checkInterval = null;
    }
  }

  function next() {
    if (currentStepIndex < TOUR_STEPS.length - 1) {
      renderStep(currentStepIndex + 1);
    } else {
      close(true);
    }
  }

  function prev() {
    if (currentStepIndex > 0) {
      renderStep(currentStepIndex - 1);
    }
  }

  function open() {
    isOpen = true;
    container.hidden = false;
    currentStepIndex = 0;
    renderStep(0);
  }

  function close(completed = false) {
    isOpen = false;
    container.hidden = true;
    stopCheckingCompletion();
    container.classList.remove('has-target');

    if (completed) {
      toast('引导已完成');
      // 可以在这里保存完成状态到 localStorage 或服务器
      localStorage.setItem('liraTourCompleted', String(TOUR_VERSION));
    }
  }

  function shouldAutoOpen() {
    const completed = localStorage.getItem('liraTourCompleted');
    return !completed || completed !== String(TOUR_VERSION);
  }

  // 绑定事件
  elements.next.addEventListener('click', next);
  elements.prev.addEventListener('click', prev);
  elements.close.addEventListener('click', () => {
    if (confirm('确定要退出引导吗？你可以随时从使用文档重新打开。')) {
      close(false);
    }
  });
  const refreshOnViewportChange = () => {
    if (isOpen) refreshPosition();
  };
  window.addEventListener('resize', refreshOnViewportChange);
  window.addEventListener('scroll', refreshOnViewportChange, true);

  return {
    open,
    close,
    next,
    prev,
    shouldAutoOpen,
    reset: () => {
      localStorage.removeItem('liraTourCompleted');
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
