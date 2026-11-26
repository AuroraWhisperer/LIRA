// 编写人：Aurora
// 百宝箱侧栏选中卡片的弹性滑移与 SVG 图标方向性变色协同动效。
'use strict';

const SPRING_ZETA = 0.84;
const SPRING_SQRT = Math.sqrt(1 - SPRING_ZETA * SPRING_ZETA);
const SAMPLE_STEP_SEC = 0.008;
const MAX_DURATION_SEC = 0.48;
const MIN_DURATION_SEC = 0.22;
const KEYFRAME_COUNT = 36;
const MAX_CARRIED_VELOCITY = 2400;
const MAX_REVERSAL_VELOCITY = 420;
const MIN_VISIBLE_ROW_HEIGHT = 20;

// 240% mask height maps 0%->100% position onto [0..41.67%] and [58.33..100%],
// so the 44..56% soft wavefront sweeps cleanly edge-to-edge with zero bleed or dip.
const MASK_SIZE = '100% 240%';
const MASK_REVEAL_DOWN = 'linear-gradient(to bottom, #000 0%, #000 48%, transparent 56%, transparent 100%)';
const MASK_RETIRE_DOWN = 'linear-gradient(to bottom, transparent 0%, transparent 44%, #000 52%, #000 100%)';
const MASK_REVEAL_UP = 'linear-gradient(to bottom, transparent 0%, transparent 44%, #000 52%, #000 100%)';
const MASK_RETIRE_UP = 'linear-gradient(to bottom, #000 0%, #000 48%, transparent 56%, transparent 100%)';

function nowMs() {
  return typeof performance !== 'undefined' && typeof performance.now === 'function'
    ? performance.now()
    : Date.now();
}

function shouldSkipMotion() {
  if (typeof document !== 'undefined' && document.documentElement?.classList?.contains('lira-tour-active')) {
    return true;
  }
  if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return false;
  return window.matchMedia('(prefers-reduced-motion: reduce)').matches === true;
}

function evalSpring(spring, t) {
  const gamma = SPRING_ZETA * spring.omega;
  const omegaD = spring.omega * SPRING_SQRT;
  const decay = Math.exp(-gamma * t);
  const cos = Math.cos(omegaD * t);
  const sin = Math.sin(omegaD * t);
  const b = (spring.v0 + gamma * spring.y0) / omegaD;
  const y = decay * (spring.y0 * cos + b * sin);
  const v = decay * (spring.v0 * cos - ((gamma * spring.v0 + spring.omega * spring.omega * spring.y0) / omegaD) * sin);
  return { y, v };
}

function buildSpringProfile(y0, v0, targetHeight) {
  const dist = Math.abs(y0);
  const omega = Math.max(19.2, Math.min(24.5, 24.5 - Math.min(dist, 480) * 0.011));
  const spring = { y0, v0, omega };
  // Leading edge of the card enters the 38px icon well (~9px inset inside the 56px row).
  const contactDistance = Math.min(dist * 0.76, Math.max(24, targetHeight - 8));

  let durationSec = MAX_DURATION_SEC;
  let arrivalSec = null;
  for (let t = SAMPLE_STEP_SEC; t <= MAX_DURATION_SEC; t += SAMPLE_STEP_SEC) {
    const { y, v } = evalSpring(spring, t);
    if (arrivalSec === null && Math.abs(y) <= contactDistance) {
      arrivalSec = t;
    }
    if (t >= MIN_DURATION_SEC && Math.abs(y) < 0.25 && Math.abs(v) < 8) {
      durationSec = t;
      break;
    }
  }

  const arrivalMs = Math.max(16, Math.min(210, Math.round((arrivalSec ?? 0.036) * 1000)));
  const bloomStartSec = arrivalMs / 1000;
  const bloomWindowSec = 0.19;

  const cardFrames = [];
  const wellFrames = [];
  const haloFrames = [];
  for (let i = 0; i <= KEYFRAME_COUNT; i += 1) {
    const progress = i / KEYFRAME_COUNT;
    const isFinal = i === KEYFRAME_COUNT;
    const t = progress * durationSec;
    const { y, v } = isFinal ? { y: 0, v: 0 } : evalSpring(spring, t);
    const vel = isFinal ? 0 : Math.tanh(Math.abs(v) / 1850);

    const cardScaleY = 1 + vel * 0.028;
    const cardScaleX = 1 - vel * 0.008;
    cardFrames.push({
      offset: progress,
      transform: isFinal
        ? 'translate3d(0, 0, 0) scale(1, 1)'
        : `translate3d(0, ${y.toFixed(2)}px, 0) scale(${cardScaleX.toFixed(4)}, ${cardScaleY.toFixed(4)})`,
    });

    // Keep the icon well square: gently melt back while crossing rows at high speed,
    // then bloom crisply as the card docks into the target row.
    let bloom = 0;
    if (!isFinal && t >= bloomStartSec && t <= bloomStartSec + bloomWindowSec) {
      const u = (t - bloomStartSec) / bloomWindowSec;
      bloom = Math.sin(u * Math.PI) * 0.055;
    }
    const wellScale = 1 - vel * 0.12 + bloom;
    const wellOpacity = Math.max(0.2, Math.min(1, 1 - vel * 0.78 + bloom * 4));
    wellFrames.push({
      offset: progress,
      transform: isFinal ? 'scale(1)' : `scale(${wellScale.toFixed(4)})`,
      opacity: isFinal ? 1 : Number(wellOpacity.toFixed(3)),
    });

    haloFrames.push({
      offset: progress,
      opacity: isFinal ? 0 : Number(Math.min(1, vel * 0.92).toFixed(3)),
    });
  }

  return {
    spring,
    durationMs: Math.round(durationSec * 1000),
    arrivalMs,
    cardFrames,
    wellFrames,
    haloFrames,
  };
}

function readComputedColor(element) {
  if (!element || typeof window === 'undefined' || typeof window.getComputedStyle !== 'function') return '';
  return window.getComputedStyle(element).color || '';
}

function clearMaskStyles(svg) {
  if (!svg?.style) return;
  svg.style.maskImage = '';
  svg.style.maskSize = '';
  svg.style.maskRepeat = '';
  svg.style.maskPosition = '';
}

export function createSelectionMotion() {
  let activeIndicator = null;
  const activeSweeps = new Map();

  function cancelIndicatorAnimations() {
    if (!activeIndicator) return;
    activeIndicator.animations.forEach((animation) => animation?.cancel?.());
    activeIndicator = null;
  }

  function cleanupIconSweep(button) {
    const entry = activeSweeps.get(button);
    if (!entry) return false;
    const started = nowMs() >= entry.startAtMs;
    entry.cleanup();
    return started;
  }

  function cleanupAllSweeps() {
    Array.from(activeSweeps.keys()).forEach((button) => cleanupIconSweep(button));
  }

  function runIconSweep(button, { fromColor, direction, delayMs, durationMs, arriving }) {
    const icon = button?.querySelector?.('.other-feature-icon');
    const svg = icon?.querySelector?.(':scope > svg:not(.other-feature-svg-sweep)');
    if (!icon || !svg || typeof svg.animate !== 'function' || typeof svg.cloneNode !== 'function') {
      icon?.classList?.remove?.('is-color-sweeping');
      return;
    }

    const toColor = readComputedColor(icon);
    const hasColorChange = Boolean(fromColor && toColor && fromColor !== toColor);
    const movingDown = direction >= 0;
    const startPos = movingDown ? '0% 100%' : '0% 0%';
    const endPos = movingDown ? '0% 0%' : '0% 100%';
    const animations = [];
    let overlay = null;

    if (hasColorChange) {
      overlay = svg.cloneNode(true);
      overlay.querySelectorAll?.('[id]')?.forEach((node) => node.removeAttribute('id'));
      overlay.classList?.add('other-feature-svg-sweep');
      overlay.setAttribute('aria-hidden', 'true');
      overlay.style.color = fromColor;
      overlay.style.maskImage = movingDown ? MASK_RETIRE_DOWN : MASK_RETIRE_UP;
      overlay.style.maskSize = MASK_SIZE;
      overlay.style.maskRepeat = 'no-repeat';
      overlay.style.maskPosition = startPos;

      svg.style.maskImage = movingDown ? MASK_REVEAL_DOWN : MASK_REVEAL_UP;
      svg.style.maskSize = MASK_SIZE;
      svg.style.maskRepeat = 'no-repeat';
      svg.style.maskPosition = startPos;

      icon.appendChild(overlay);

      const sweepOptions = {
        delay: delayMs,
        duration: durationMs,
        easing: arriving ? 'cubic-bezier(0.22, 0.68, 0.28, 1)' : 'cubic-bezier(0.28, 0.08, 0.24, 1)',
        fill: 'both',
      };
      const maskFrames = [{ maskPosition: startPos }, { maskPosition: endPos }];
      animations.push(svg.animate(maskFrames, sweepOptions));
      animations.push(overlay.animate(maskFrames, sweepOptions));
    } else {
      icon.classList?.remove('is-color-sweeping');
    }

    if (typeof icon.animate === 'function') {
      const microFrames = arriving
        ? [
            { offset: 0, transform: `translate3d(0, ${(-direction * 1.5).toFixed(2)}px, 0) scale(0.93)` },
            { offset: 0.42, transform: `translate3d(0, ${(direction * 0.55).toFixed(2)}px, 0) scale(1.095)` },
            { offset: 0.74, transform: `translate3d(0, ${(-direction * 0.12).toFixed(2)}px, 0) scale(0.988)` },
            { offset: 1, transform: 'translate3d(0, 0, 0) scale(1)' },
          ]
        : [
            { offset: 0, transform: 'translate3d(0, 0, 0) scale(1)' },
            { offset: 0.4, transform: `translate3d(0, ${(direction * 1).toFixed(2)}px, 0) scale(0.94)` },
            { offset: 1, transform: 'translate3d(0, 0, 0) scale(1)' },
          ];
      animations.push(
        icon.animate(microFrames, {
          delay: delayMs,
          duration: arriving ? 260 : 180,
          easing: 'cubic-bezier(0.22, 1, 0.36, 1)',
          fill: 'both',
        }),
      );
    }

    let cleaned = false;
    const cleanup = () => {
      if (cleaned) return;
      cleaned = true;
      if (activeSweeps.get(button)?.cleanup === cleanup) activeSweeps.delete(button);
      animations.forEach((animation) => animation?.cancel?.());
      overlay?.remove?.();
      clearMaskStyles(svg);
      icon.classList?.remove('is-color-sweeping');
    };

    if (!animations.length) {
      cleanup();
      return;
    }

    activeSweeps.set(button, {
      arriving,
      startAtMs: nowMs() + delayMs,
      cleanup,
    });

    const settledPromises = animations.map((animation) => animation.finished).filter(Boolean);
    if (settledPromises.length === animations.length) {
      Promise.allSettled(settledPromises).then(cleanup);
    } else {
      const primaryAnimation = animations[animations.length - 1];
      primaryAnimation.onfinish = cleanup;
      primaryAnimation.oncancel = cleanup;
    }
  }

  function transition(root, targetButton, applySelection, { animate = true } = {}) {
    if (!animate || !root || !targetButton || targetButton.getAttribute?.('aria-selected') === 'true') {
      applySelection();
      return;
    }

    const indicator = root.querySelector?.('.other-feature-indicator');
    if (
      !indicator ||
      typeof indicator.getBoundingClientRect !== 'function' ||
      typeof indicator.animate !== 'function' ||
      typeof targetButton.getBoundingClientRect !== 'function'
    ) {
      applySelection();
      return;
    }

    const fromRect = indicator.getBoundingClientRect();
    const targetRect = targetButton.getBoundingClientRect();
    if (!fromRect.height || targetRect.height < MIN_VISIBLE_ROW_HEIGHT || shouldSkipMotion()) {
      cancelIndicatorAnimations();
      indicator.getAnimations?.().forEach((animation) => animation.cancel());
      cleanupAllSweeps();
      applySelection();
      return;
    }

    const offset = fromRect.top - targetRect.top;
    if (Math.abs(offset) < 0.5) {
      applySelection();
      return;
    }

    const previousButton = root.querySelector?.('.other-feature-button.active');
    const previousSweepEntry = previousButton ? activeSweeps.get(previousButton) : null;
    const previousNeverIgnited = Boolean(
      previousSweepEntry?.arriving && nowMs() < previousSweepEntry.startAtMs,
    );

    // Carry live physical velocity when retargeting mid-flight; gently damp sharp reversals.
    let v0 = 0;
    if (activeIndicator) {
      const elapsedSec = Math.max(0, (nowMs() - activeIndicator.startMs) / 1000);
      if (elapsedSec < activeIndicator.durationMs / 1000) {
        const liveV = evalSpring(activeIndicator.spring, elapsedSec).v;
        const reversing = Math.sign(liveV) !== 0 && Math.sign(liveV) === Math.sign(offset);
        v0 = reversing
          ? Math.max(-MAX_REVERSAL_VELOCITY, Math.min(MAX_REVERSAL_VELOCITY, liveV * 0.28))
          : Math.max(-MAX_CARRIED_VELOCITY, Math.min(MAX_CARRIED_VELOCITY, liveV * 0.9));
      }
    }

    cancelIndicatorAnimations();
    indicator.getAnimations?.().forEach((animation) => animation.cancel());
    if (previousButton) cleanupIconSweep(previousButton);
    cleanupIconSweep(targetButton);

    const prevIcon = previousButton?.querySelector?.('.other-feature-icon');
    const targetIcon = targetButton.querySelector?.('.other-feature-icon');
    const prevFromColor = previousNeverIgnited ? '' : readComputedColor(prevIcon);
    const targetFromColor = readComputedColor(targetIcon);

    if (prevIcon && prevFromColor) prevIcon.classList?.add('is-color-sweeping');
    if (targetIcon && targetFromColor) targetIcon.classList?.add('is-color-sweeping');

    applySelection();

    const direction = offset < 0 ? 1 : -1;
    const profile = buildSpringProfile(offset, v0, targetRect.height);
    const timing = { duration: profile.durationMs, easing: 'linear' };

    const cardAnimation = indicator.animate(profile.cardFrames, timing);
    const animations = [cardAnimation];
    animations.push(indicator.animate(profile.wellFrames, { ...timing, pseudoElement: '::before' }));
    animations.push(indicator.animate(profile.haloFrames, { ...timing, pseudoElement: '::after' }));

    const record = {
      spring: profile.spring,
      startMs: nowMs(),
      durationMs: profile.durationMs,
      animations,
    };
    activeIndicator = record;
    const clearRecord = () => {
      if (activeIndicator === record) activeIndicator = null;
    };
    cardAnimation.onfinish = clearRecord;
    cardAnimation.oncancel = clearRecord;

    if (previousButton && !previousNeverIgnited) {
      runIconSweep(previousButton, {
        fromColor: prevFromColor,
        direction,
        delayMs: 0,
        durationMs: 175,
        arriving: false,
      });
    } else {
      prevIcon?.classList?.remove('is-color-sweeping');
    }

    runIconSweep(targetButton, {
      fromColor: targetFromColor,
      direction,
      delayMs: profile.arrivalMs,
      durationMs: 210,
      arriving: true,
    });
  }

  return { transition };
}
