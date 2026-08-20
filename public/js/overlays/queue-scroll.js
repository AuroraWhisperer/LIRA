// Queue overlay layout and animation mechanics.
'use strict';

import { bounceScrollTiming, overlayLowPowerEnabled, queueScrollSeconds, scrollTravelSeconds } from './queue-utils.js';
import { isQueueViewportResized } from './queue-viewport.js';

export function captureScrollAnimation() {
  const list = document.querySelector('.classic-list.scrolling, .classic-list.scrolling-bounce, .identity-list.scrolling, .identity-list.scrolling-bounce');
  if (!list || typeof list.getAnimations !== 'function') return null;
  const animation = list.getAnimations().find((item) => item.effect);
  if (!animation || animation.currentTime === null) return null;
  return {
    className: list.className,
    currentTime: Number(animation.currentTime) || 0
  };
}

export function restoreScrollAnimation(scrollState) {
  if (!scrollState) return;
  const list = document.querySelector('.classic-list.scrolling, .classic-list.scrolling-bounce, .identity-list.scrolling, .identity-list.scrolling-bounce');
  if (!list || list.className !== scrollState.className || typeof list.getAnimations !== 'function') return;
  const animation = list.getAnimations().find((item) => item.effect);
  if (!animation) return;
  const timing = animation.effect.getTiming();
  const duration = Number(timing.duration);
  animation.currentTime = Number.isFinite(duration) && duration > 0
    ? scrollState.currentTime % duration
    : scrollState.currentTime;
}

export function scheduleScrollAnimationRestore(scrollState) {
  if (!scrollState) return;
  const restore = () => restoreScrollAnimation(scrollState);
  if (typeof requestAnimationFrame === 'function') {
    requestAnimationFrame(restore);
  } else {
    restore();
  }
}

export function removeQueueLoopClones(list) {
  if (!list || typeof list.querySelectorAll !== 'function') return;
  list.querySelectorAll('[data-loop-clone="true"]').forEach((node) => node.remove());
}

export function resetQueueScrollClasses(list) {
  ['scrolling', 'scrolling-bounce'].forEach((name) => list.classList.remove(name));
  list.classList.add('paused');
}

export function originalQueueRowsHtml(list) {
  removeQueueLoopClones(list);
  if (!list || !list.children) return '';
  return Array.from(list.children, (node) => node.outerHTML || '').join('');
}

export function appendLoopCloneHtml(list, html) {
  const startIndex = list.children ? list.children.length : 0;
  list.insertAdjacentHTML('beforeend', html);
  if (!list.children) return;
  Array.from(list.children).slice(startIndex).forEach((node) => {
    if (node.dataset) node.dataset.loopClone = 'true';
    else if (typeof node.setAttribute === 'function') node.setAttribute('data-loop-clone', 'true');
  });
}

export function scheduleClassicVerticalScroll(content, settings, rowsHtml, rowGap) {
  const viewport = content.querySelector('.classic-list-window');
  const list = viewport && viewport.querySelector('.classic-list');
  if (!viewport || !list) return;

  const setup = () => configureClassicVerticalScroll(viewport, list, settings, rowsHtml, rowGap);
  if (typeof requestAnimationFrame === 'function') {
    requestAnimationFrame(setup);
  } else {
    setup();
  }
}

export function configureClassicVerticalScroll(viewport, list, settings, rowsHtml, rowGap = 5) {
  const windowHeight = typeof window !== 'undefined' ? window.innerHeight : 0;
  const documentHeight = document.documentElement ? document.documentElement.clientHeight : 0;
  const viewportHeight = Number(windowHeight || documentHeight) || Math.max(1, viewport.clientHeight);
  const viewportTop = Math.max(0, viewport.getBoundingClientRect().top);
  const edge = Math.min(16, Math.max(0, viewportHeight * 0.02));
  const availableHeight = Math.max(1, Math.floor(viewportHeight - viewportTop - edge));
  if (viewport.style) {
    viewport.style.height = isQueueViewportResized() ? '' : `${Math.min(235, availableHeight)}px`;
    viewport.style.maxHeight = `${availableHeight}px`;
  }

  removeQueueLoopClones(list);
  if (typeof list.getAnimations === 'function') {
    list.getAnimations().forEach((animation) => animation.cancel());
  }
  resetQueueScrollClasses(list);

  const visibleHeight = Math.max(1, viewport.clientHeight);
  const overflowDistance = Math.max(0, Math.ceil(list.scrollHeight - visibleHeight));
  if (overflowDistance <= 1) return false;

  const scrollMode = settings.queueScrollMode === 'bounce' ? 'bounce' : 'loop';
  const secondsPerViewport = queueScrollSeconds(settings);
  let scrollClass = 'scrolling';

  if (scrollMode === 'bounce') {
    const downSeconds = scrollTravelSeconds(secondsPerViewport, overflowDistance, visibleHeight);
    const upSeconds = scrollTravelSeconds(3, overflowDistance, visibleHeight);
    const timing = bounceScrollTiming(downSeconds, upSeconds);
    document.documentElement.style.setProperty('--classic-bounce-distance', `${overflowDistance}px`);
    document.documentElement.style.setProperty('--scroll-seconds', `${timing.totalSeconds}s`);
    setClassicBounceKeyframes(timing.topPauseEndPercent, timing.downPercent, timing.pauseEndPercent);
    scrollClass = 'scrolling-bounce';
  } else {
    const loopDistance = Math.ceil(list.scrollHeight + rowGap);
    const travelSeconds = scrollTravelSeconds(secondsPerViewport, loopDistance, visibleHeight);
    document.documentElement.style.setProperty('--classic-loop-distance', `${loopDistance}px`);
    document.documentElement.style.setProperty('--scroll-seconds', `${travelSeconds}s`);
    appendLoopCloneHtml(list, rowsHtml);
  }

  list.classList.remove('paused');
  list.classList.add(scrollClass);
  return true;
}

export function scheduleIdentityVerticalScroll(content, settings, combinedRows, rowGap) {
  const viewport = content.querySelector('.identity-list-window');
  const list = viewport && viewport.querySelector('.identity-list');
  if (!viewport || !list) return;

  const setup = () => configureIdentityVerticalScroll(viewport, list, settings, combinedRows, rowGap);
  if (typeof requestAnimationFrame === 'function') {
    requestAnimationFrame(setup);
  } else {
    setup();
  }
}

export function scheduleStorybookVerticalScroll(content, settings, rowsHtml, rowGap) {
  scheduleIllustratedVerticalScroll(content, settings, rowsHtml, rowGap, 'storybook');
}

export function scheduleIllustratedVerticalScroll(content, settings, rowsHtml, rowGap, style) {
  const viewport = content.querySelector(`.${style}-list-window`);
  const list = viewport && viewport.querySelector(`.${style}-list`);
  if (!viewport || !list) return;

  const setup = () => configureIdentityVerticalScroll(viewport, list, settings, rowsHtml, rowGap, true);
  if (typeof requestAnimationFrame === 'function') {
    requestAnimationFrame(setup);
  } else {
    setup();
  }
}

export function configureIdentityVerticalScroll(viewport, list, settings, combinedRows, rowGap = 4, preserveViewportHeight = false) {
  const windowHeight = typeof window !== 'undefined' ? window.innerHeight : 0;
  const documentHeight = document.documentElement ? document.documentElement.clientHeight : 0;
  const sourceHeight = Number(windowHeight || documentHeight) || Math.max(1, viewport.clientHeight);
  const viewportTop = typeof viewport.getBoundingClientRect === 'function'
    ? Math.max(0, viewport.getBoundingClientRect().top)
    : 0;
  const footer = viewport.parentElement && viewport.parentElement.querySelector('.identity-footer');
  const footerHeight = footer ? footer.getBoundingClientRect().height + 4 : 0;
  const edge = Math.min(16, Math.max(0, sourceHeight * 0.02));
  const availableHeight = Math.max(1, Math.floor(sourceHeight - viewportTop - footerHeight - edge));
  removeQueueLoopClones(list);
  if (typeof list.getAnimations === 'function') {
    list.getAnimations().forEach((animation) => animation.cancel());
  }
  resetQueueScrollClasses(list);
  const contentHeight = Math.max(1, Math.ceil(list.scrollHeight));
  if (viewport.style && !preserveViewportHeight) {
    const targetHeight = isQueueViewportResized()
      ? Math.min(contentHeight, availableHeight)
      : Math.min(364, availableHeight);
    viewport.style.height = `${targetHeight}px`;
    viewport.style.maxHeight = `${availableHeight}px`;
  }
  const viewportHeight = Math.max(1, viewport.clientHeight);
  const overflowDistance = Math.max(0, Math.ceil(contentHeight - viewportHeight));
  if (overflowDistance <= 1) return false;

  const scrollMode = settings.queueScrollMode === 'bounce' ? 'bounce' : 'loop';
  const secondsPerViewport = queueScrollSeconds(settings, 'identityQueueScrollSpeed');
  let scrollClass = 'scrolling';

  if (scrollMode === 'bounce') {
    const downSeconds = scrollTravelSeconds(secondsPerViewport, overflowDistance, viewportHeight);
    const upSeconds = scrollTravelSeconds(3, overflowDistance, viewportHeight);
    const timing = bounceScrollTiming(downSeconds, upSeconds);
    document.documentElement.style.setProperty('--identity-bounce-distance', `${overflowDistance}px`);
    document.documentElement.style.setProperty('--scroll-seconds', `${timing.totalSeconds}s`);
    setIdentityBounceKeyframes(timing.topPauseEndPercent, timing.downPercent, timing.pauseEndPercent);
    scrollClass = 'scrolling-bounce';
  } else {
    const loopDistance = Math.ceil(contentHeight + rowGap);
    const travelSeconds = scrollTravelSeconds(secondsPerViewport, loopDistance, viewportHeight);
    document.documentElement.style.setProperty('--identity-loop-distance', `${loopDistance}px`);
    document.documentElement.style.setProperty('--scroll-seconds', `${travelSeconds}s`);
    appendLoopCloneHtml(list, combinedRows);
  }

  list.classList.remove('paused');
  list.classList.add(scrollClass);
  return true;
}

export function scheduleIdentitySuperChatScroll(content) {
  const setup = () => {
    content.querySelectorAll('.identity-sc-content').forEach((container) => {
      const text = container.querySelector('.identity-sc-text');
      cancelElementAnimations(text);
      const distance = text ? Math.ceil(text.scrollWidth - container.clientWidth) : 0;
      if (!text || distance <= 1 || typeof text.animate !== 'function') return;

      const travelSeconds = Math.max(3, distance / 30);
      const pauseSeconds = 1.5;
      const totalSeconds = (travelSeconds * 2) + pauseSeconds;
      text.animate([
        { transform: 'translateX(0)', offset: 0 },
        { transform: `translateX(-${distance}px)`, offset: travelSeconds / totalSeconds },
        { transform: `translateX(-${distance}px)`, offset: (travelSeconds + pauseSeconds) / totalSeconds },
        { transform: 'translateX(0)', offset: 1 }
      ], {
        duration: totalSeconds * 1000,
        iterations: Infinity
      });
    });
  };

  if (typeof requestAnimationFrame === 'function') {
    requestAnimationFrame(setup);
  } else {
    setup();
  }
}

export function scheduleIdentityContentScroll(content) {
  const setup = () => {
    if (prefersReducedMotion()) return;

    content.querySelectorAll('.identity-content-wrapper, .storybook-info-viewport').forEach((container) => {
      const text = container.querySelector('.identity-content, .storybook-info');
      cancelElementAnimations(text);
      const distance = text ? Math.ceil(text.scrollWidth - container.clientWidth) : 0;
      if (!text || distance <= 1 || typeof text.animate !== 'function') return;

      const travelSeconds = Math.max(3, distance / 30);
      const pauseSeconds = 1;
      const totalSeconds = (travelSeconds * 2) + (pauseSeconds * 2);
      text.animate([
        { transform: 'translateX(0)', offset: 0 },
        { transform: 'translateX(0)', offset: pauseSeconds / totalSeconds },
        { transform: `translateX(-${distance}px)`, offset: (pauseSeconds + travelSeconds) / totalSeconds },
        { transform: `translateX(-${distance}px)`, offset: (travelSeconds + (pauseSeconds * 2)) / totalSeconds },
        { transform: 'translateX(0)', offset: 1 }
      ], {
        duration: totalSeconds * 1000,
        iterations: Infinity
      });
    });
  };

  if (typeof requestAnimationFrame === 'function') {
    requestAnimationFrame(setup);
  } else {
    setup();
  }
}

export function scheduleIdentityRuleScroll(content) {
  const setup = () => {
    if (prefersReducedMotion()) return;

    content.querySelectorAll('.identity-rule').forEach((container) => {
      const text = container.querySelector('.identity-rule-text');
      cancelElementAnimations(text);
      if (!text || typeof text.animate !== 'function') return;

      const containerOverflow = Number.isFinite(container.scrollWidth)
        ? container.scrollWidth - container.clientWidth
        : 0;
      const textOverflow = Number.isFinite(text.scrollWidth)
        ? text.scrollWidth - container.clientWidth
        : 0;
      const distance = Math.ceil(Math.max(containerOverflow, textOverflow));
      if (distance <= 1) return;

      const travelSeconds = Math.max(3, distance / 24);
      const pauseSeconds = 1.5;
      const totalSeconds = (travelSeconds * 2) + pauseSeconds;
      container.classList.add('is-scrolling');
      text.animate([
        { transform: 'translateX(0)', offset: 0 },
        { transform: `translateX(-${distance}px)`, offset: travelSeconds / totalSeconds },
        { transform: `translateX(-${distance}px)`, offset: (travelSeconds + pauseSeconds) / totalSeconds },
        { transform: 'translateX(0)', offset: 1 }
      ], {
        duration: totalSeconds * 1000,
        iterations: Infinity
      });
    });
  };

  if (typeof requestAnimationFrame === 'function') {
    requestAnimationFrame(setup);
  } else {
    setup();
  }
}

export function cancelElementAnimations(element) {
  if (!element || typeof element.getAnimations !== 'function') return;
  element.getAnimations().forEach((animation) => animation.cancel());
}

export function prefersReducedMotion() {
  return typeof window !== 'undefined'
    && typeof window.matchMedia === 'function'
    && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
}

export function setClassicBounceKeyframes(topPauseEndPercent, downPercent, pauseEndPercent) {
  const topPauseEnd = Math.max(1, Math.min(95, Number(topPauseEndPercent) || 5)).toFixed(4);
  const bottomPauseStart = Math.max(Number(topPauseEnd), Math.min(97, Number(downPercent) || 90)).toFixed(4);
  const bottomPauseEnd = Math.max(Number(bottomPauseStart), Math.min(99, Number(pauseEndPercent) || 95)).toFixed(4);
  let style = document.getElementById('classicBounceKeyframes');
  if (!style) {
    style = document.createElement('style');
    style.id = 'classicBounceKeyframes';
    document.head.appendChild(style);
  }
  style.textContent = `
@keyframes classic-scroll-bounce {
  0% { transform: translateY(0); }
  ${topPauseEnd}% { transform: translateY(0); }
  ${bottomPauseStart}% { transform: translateY(calc(-1 * var(--classic-bounce-distance, 57px))); }
  ${bottomPauseEnd}% { transform: translateY(calc(-1 * var(--classic-bounce-distance, 57px))); }
  100% { transform: translateY(0); }
}`;
}

export function setIdentityBounceKeyframes(topPauseEndPercent, downPercent, pauseEndPercent) {
  const topPauseEnd = Math.max(1, Math.min(95, Number(topPauseEndPercent) || 5)).toFixed(4);
  const bottomPauseStart = Math.max(Number(topPauseEnd), Math.min(97, Number(downPercent) || 90)).toFixed(4);
  const bottomPauseEnd = Math.max(Number(bottomPauseStart), Math.min(99, Number(pauseEndPercent) || 95)).toFixed(4);
  let style = document.getElementById('identityBounceKeyframes');
  if (!style) {
    style = document.createElement('style');
    style.id = 'identityBounceKeyframes';
    document.head.appendChild(style);
  }
  style.textContent = `
@keyframes identity-scroll-bounce {
  0% { transform: translateY(0); }
  ${topPauseEnd}% { transform: translateY(0); }
  ${bottomPauseStart}% { transform: translateY(calc(-1 * var(--identity-bounce-distance, 64px))); }
  ${bottomPauseEnd}% { transform: translateY(calc(-1 * var(--identity-bounce-distance, 64px))); }
  100% { transform: translateY(0); }
}`;
}
