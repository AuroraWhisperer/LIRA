// 编写人：Aurora
// 当前项目版本：1.4.6
'use strict';

let state = null;
let reconnectTimer = null;
let reconnectAttempts = 0;
let stateRefreshTimer = null;
let overlayResizeTimer = null;
let lastRenderKey = null;
const multilingualFontFallback = '"Microsoft YaHei", "Microsoft JhengHei", "PingFang SC", "Hiragino Sans GB", "Yu Gothic", "Meiryo", "Malgun Gothic", "Apple SD Gothic Neo", "Noto Sans CJK SC", "Noto Sans JP", "Noto Sans KR", "Segoe UI", Arial, sans-serif';

document.addEventListener('DOMContentLoaded', () => {
  loadState();
  connectSocket();
  window.addEventListener('resize', () => {
    clearTimeout(overlayResizeTimer);
    overlayResizeTimer = setTimeout(render, 100);
  });
});

async function loadState() {
  try {
    const response = await fetch('/api/state');
    const payload = await response.json();
    if (payload.ok) {
      lastRenderKey = null;
      state = payload.data;
      render();
    }
  } catch (error) {
    console.warn('[overlay-queue] loadState failed:', error.message || error);
  }
}

function connectSocket() {
  const protocol = location.protocol === 'https:' ? 'wss:' : 'ws:';
  const token = window.__API_TOKEN__;
  const wsUrl = `${protocol}//${location.host}/ws${token ? '?token=' + encodeURIComponent(token) : ''}`;
  const socket = new WebSocket(wsUrl);

  socket.addEventListener('open', () => {
    clearTimeout(reconnectTimer);
    reconnectAttempts = 0;
    lastRenderKey = null;
  });

  socket.addEventListener('message', (event) => {
    const payload = JSON.parse(event.data);
    if (payload.type === 'snapshot') {
      if (payload.reason === 'live:status' && state) {
        state.liveStatus = payload.state.liveStatus;
        return;
      }
      if (payload.reason && payload.reason.startsWith('songs:')) {
        return;
      }
      if (isSongRequestSnapshotReason(payload.reason)) {
        scheduleStateRefresh();
        return;
      }
      var newKey = computeStateKey(payload.state);
      if (newKey === lastRenderKey) {
        state = payload.state;
        return;
      }
      lastRenderKey = newKey;
      state = payload.state;
      render();
    }
  });

  socket.addEventListener('close', () => {
    const delay = Math.min(30000, 800 * Math.pow(2, Math.min(reconnectAttempts, 6)));
    reconnectAttempts += 1;
    reconnectTimer = setTimeout(() => {
      loadState();
      connectSocket();
    }, delay);
  });
}

function isSongRequestSnapshotReason(reason) {
  return [
    'queue:add',
    'bilibili:danmaku',
    'bilibili:superchat'
  ].includes(reason);
}

function scheduleStateRefresh() {
  clearTimeout(stateRefreshTimer);
  stateRefreshTimer = setTimeout(function () {
    lastRenderKey = null;
    loadState();
  }, 80);
}

function computeStateKey(nextState) {
  var queue = nextState.queue || {};
  var settings = nextState.settings || {};
  var current = queue.current;
  var waiting = queue.waiting || [];
  var superChats = nextState.superChats || [];
  return JSON.stringify([
    current ? current.song_name + '|' + (current.requester_name || '') + '|' + (current.is_pinned ? '1' : '0') : '',
    waiting.map(function (item) { return item.song_name + '|' + (item.requester_name || '') + '|' + (item.is_pinned ? '1' : '0'); }),
    superChats.map(function (item) { return (item.price || 0) + '|' + (item.message || ''); }),
    settings.overlayQueueStyle,
    settings.themePrimary, settings.themeAccent, settings.themeText, settings.themeBackground,
    settings.themeOpacity, settings.themeRadius, settings.backdropBlur, settings.glowIntensity,
    settings.enableGradient, settings.gradientEnd,
    settings.overlayFontFamily, settings.overlayFontWeight,
    settings.overlaySongColor, settings.overlayRequesterColor, settings.overlayIndexColor,
    settings.queueSongFontSize, settings.queueTitleFontSize,
    settings.queueScrollMode, settings.queueScrollSpeed, settings.identityQueueScrollSpeed,
    settings.queueFixedSixRows, settings.overlayShowIndex, settings.overlayIndexThreshold,
    settings.overlayTitle, settings.overlayLowPowerMode, settings.themeFontScale,
    settings.overlayPin1, settings.overlayPin2, settings.overlayPin3,
    settings.overlayRule1, settings.overlayRule2, settings.overlayRule3,
    settings.overlayRule4, settings.overlayRule5, settings.overlayRule6,
    settings.overlayRuleColor1, settings.overlayRuleColor2, settings.overlayRuleColor3,
    settings.overlayRuleColor4, settings.overlayRuleColor5, settings.overlayRuleColor6,
    settings.overlayRuleFontSize
  ]);
}

function render() {
  if (!state) return;
  const settings = state.settings || {};
  const style = (settings.overlayQueueStyle === 'identity' || settings.overlayQueueStyle === 'festival') ? 'identity' : 'classic';
  applyTheme(settings, style);

  const queue = state.queue || {};
  const current = queue.current;
  const waiting = queue.waiting || [];
  const content = document.getElementById('queueContent');

  if (style === 'identity') {
    renderIdentityQueue(settings, current, waiting, content, state.superChats || []);
    return;
  }

  renderClassicQueue(settings, current, waiting, content);
}

function captureScrollAnimation() {
  const list = document.querySelector('.classic-list.scrolling, .classic-list.scrolling-bounce, .identity-list.scrolling, .identity-list.scrolling-bounce');
  if (!list || typeof list.getAnimations !== 'function') return null;
  const animation = list.getAnimations().find((item) => item.effect);
  if (!animation || animation.currentTime === null) return null;
  return {
    className: list.className,
    currentTime: Number(animation.currentTime) || 0
  };
}

function restoreScrollAnimation(scrollState) {
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

function renderClassicQueue(settings, current, waiting, content) {
  const items = [current].concat(waiting).filter(Boolean);
  const visibleRows = 6;
  const baseFontSize = Math.max(10, normalizeFontSize(
    (settings || {}).queueSongFontSize,
    scaleToFontSize((settings || {}).themeFontScale, 40),
    70,
    10
  ));
  const rowHeight = Math.max(35, Math.round(baseFontSize * 0.65 * 1.8));
  const rowGap = 5;
  const rowStep = rowHeight + rowGap;
  const windowHeight = (visibleRows * rowHeight) + ((visibleRows - 1) * rowGap);
  const scrollMode = settings.queueScrollMode === 'bounce' ? 'bounce' : 'loop';
  const fixedSixRows = settings.queueFixedSixRows !== 'false';
  const showIndex = settings.overlayShowIndex !== 'false';
  const threshold = Number(settings.overlayIndexThreshold || 0);
  const shouldShowIndex = showIndex && (threshold === 0 || items.length > threshold);
  document.documentElement.style.setProperty('--classic-visible-rows', String(visibleRows));
  document.documentElement.style.setProperty('--classic-row-height', `${rowHeight}px`);
  document.documentElement.style.setProperty('--classic-row-gap', `${rowGap}px`);
  document.documentElement.style.setProperty('--classic-window-height', `${windowHeight}px`);

  if (items.length === 0) {
    content.innerHTML = '<div class="overlay-empty">当前还没有点歌</div>';
    return;
  }

  const rowsHtml = items.map((item, index) => `
    <div class="overlay-waiting-row">
      ${shouldShowIndex ? `<div class="index">${index + 1}</div>` : ''}
      <div>
        <div class="song overlay-song-line">
          <span class="overlay-song-name">${item.is_pinned ? '📌 ' : ''}${escapeHtml(item.song_name)}</span>
          <span class="overlay-requester">${escapeHtml(item.requester_name || '观众')}</span>
        </div>
      </div>
    </div>
  `).join('');

  const shouldScroll = items.length > visibleRows;
  const noIndexClass = shouldShowIndex ? '' : ' no-index';

  if (!shouldScroll) {
    content.innerHTML = fixedSixRows
      ? `
        <div class="classic-list-window">
          <div class="classic-list${noIndexClass}">
            ${rowsHtml}
          </div>
        </div>
      `
      : `<div class="overlay-waiting${noIndexClass}">${rowsHtml}</div>`;
    return;
  }

  const hiddenRows = Math.max(1, items.length - visibleRows);
  const loopDistance = items.length * rowStep;
  const bounceDistance = hiddenRows * rowStep;
  document.documentElement.style.setProperty('--classic-loop-distance', `${loopDistance}px`);
  document.documentElement.style.setProperty('--classic-bounce-distance', `${bounceDistance}px`);
  const scrollClass = scrollMode === 'bounce' ? 'scrolling-bounce' : 'scrolling';
  const scrollRowsHtml = scrollMode === 'bounce' ? rowsHtml : `${rowsHtml}${rowsHtml}`;
  const scrollDistance = scrollMode === 'bounce' ? bounceDistance : loopDistance;
  const travelSeconds = scrollTravelSeconds(queueScrollSeconds(settings), scrollDistance, windowHeight);
  if (scrollMode === 'bounce') {
    const upSeconds = scrollTravelSeconds(3, scrollDistance, windowHeight);
    const timing = bounceScrollTiming(travelSeconds, upSeconds);
    setClassicBounceKeyframes(timing.downPercent, timing.pauseEndPercent);
    document.documentElement.style.setProperty('--scroll-seconds', `${timing.totalSeconds}s`);
  } else {
    document.documentElement.style.setProperty('--scroll-seconds', `${travelSeconds}s`);
  }

  content.innerHTML = `
    <div class="classic-list-window">
      <div class="classic-list ${scrollClass}${noIndexClass}">
        ${scrollRowsHtml}
      </div>
    </div>
  `;
}

function renderIdentityQueue(settings, current, waiting, content, superChats = []) {
  const songItems = [current].concat(waiting).filter(Boolean);
  const scItems = (Array.isArray(superChats) ? superChats : []).filter((item) => Number(item.price || 0) >= 2);
  const baseFontSize = Math.max(10, normalizeFontSize(
    (settings || {}).queueSongFontSize,
    scaleToFontSize((settings || {}).themeFontScale, 40),
    70,
    10
  ));
  const rowHeight = Math.max(24, Math.round(baseFontSize * 0.65 * 1.6));
  const rowGap = 4;
  document.documentElement.style.setProperty('--identity-row-height', `${rowHeight}px`);
  document.documentElement.style.setProperty('--identity-row-gap', `${rowGap}px`);

  const showIndex = settings.overlayShowIndex !== 'false';
  const threshold = Number(settings.overlayIndexThreshold || 0);
  const shouldShowIndex = showIndex && (threshold === 0 || songItems.length > threshold);
  const pins = [
    settings.overlayPin1,
    settings.overlayPin2,
    settings.overlayPin3
  ].map((item) => String(item || '').trim()).filter(Boolean);
  const pinHtml = pins.length ? `
    <div class="identity-pins">
      ${pins.map((pin) => `
        <div class="identity-pin-row">
          <span class="identity-pin-label">置顶</span>
          <span class="identity-pin-content">${escapeHtml(pin)}</span>
        </div>
      `).join('')}
    </div>
  ` : '';
  const rules = [
    settings.overlayRule1,
    settings.overlayRule2,
    settings.overlayRule3,
    settings.overlayRule4,
    settings.overlayRule5,
    settings.overlayRule6
  ].map((item) => String(item || '').trim()).filter(Boolean);
  const ruleHtml = rules.length ? `
    <div class="identity-rules">
      ${rules.map((rule, index) => `
        <span class="identity-rule identity-rule-${(index % 6) + 1}">
          <span class="identity-rule-text">${escapeHtml(rule)}</span>
        </span>
      `).join('')}
    </div>
  ` : '';

  const scRowsHtml = scItems.map((item) => renderIdentitySuperChatRow(item)).join('');
  const songRowsHtml = songItems.length > 0
    ? songItems.map((item, i) => renderIdentityRow(item, i, shouldShowIndex)).join('')
    : '';
  const combinedRows = scRowsHtml + songRowsHtml;
  const totalRows = scItems.length + songItems.length;

  if (totalRows === 0) {
    content.innerHTML = `
      ${pinHtml}
      <div class="identity-list-window">
        <div class="identity-empty">当前还没有点歌</div>
      </div>
      ${ruleHtml ? `<div class="identity-footer">${ruleHtml}</div>` : ''}
    `;
    scheduleIdentityRuleScroll(content);
    return;
  }

  const noIndexClass = shouldShowIndex ? '' : ' no-index';

  content.innerHTML = `
    ${pinHtml}
    <div class="identity-list-window">
      <div class="identity-list paused${noIndexClass}">
        ${combinedRows}
      </div>
    </div>
    ${ruleHtml ? `<div class="identity-footer">${ruleHtml}</div>` : ''}
  `;

  scheduleIdentityVerticalScroll(content, settings, combinedRows, rowGap);
  scheduleIdentitySuperChatScroll(content);
  scheduleIdentityRuleScroll(content);
}

function scheduleIdentityVerticalScroll(content, settings, combinedRows, rowGap) {
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

function configureIdentityVerticalScroll(viewport, list, settings, combinedRows, rowGap = 4) {
  const overflowDistance = Math.max(0, Math.ceil(list.scrollHeight - viewport.clientHeight));
  if (overflowDistance <= 1) return false;

  const scrollMode = settings.queueScrollMode === 'bounce' ? 'bounce' : 'loop';
  const secondsPerViewport = queueScrollSeconds(settings, 'identityQueueScrollSpeed');
  const viewportHeight = Math.max(1, viewport.clientHeight);
  let scrollClass = 'scrolling';

  if (scrollMode === 'bounce') {
    const downSeconds = scrollTravelSeconds(secondsPerViewport, overflowDistance, viewportHeight);
    const upSeconds = scrollTravelSeconds(3, overflowDistance, viewportHeight);
    const timing = bounceScrollTiming(downSeconds, upSeconds);
    document.documentElement.style.setProperty('--identity-bounce-distance', `${overflowDistance}px`);
    document.documentElement.style.setProperty('--scroll-seconds', `${timing.totalSeconds}s`);
    setIdentityBounceKeyframes(timing.downPercent, timing.pauseEndPercent);
    scrollClass = 'scrolling-bounce';
  } else {
    const loopDistance = Math.ceil(list.scrollHeight + rowGap);
    const travelSeconds = scrollTravelSeconds(secondsPerViewport, loopDistance, viewportHeight);
    document.documentElement.style.setProperty('--identity-loop-distance', `${loopDistance}px`);
    document.documentElement.style.setProperty('--scroll-seconds', `${travelSeconds}s`);
    list.insertAdjacentHTML('beforeend', combinedRows);
  }

  list.classList.remove('paused');
  list.classList.add(scrollClass);
  return true;
}

function renderIdentitySuperChats(superChats) {
  const items = (Array.isArray(superChats) ? superChats : []).filter((item) => Number(item.price || 0) >= 2);
  if (items.length === 0) return '';
  return `
    <div class="identity-sc-list">
      ${items.map(renderIdentitySuperChat).join('')}
    </div>
  `;
}

function renderIdentitySuperChat(item) {
  const message = String(item.message || '').trim();
  const shouldScroll = Array.from(message).length > 24;
  return `
    <div class="identity-sc-row">
      <span class="identity-sc-price">SC ¥${escapeHtml(formatSuperChatPrice(item.price))}</span>
      <span class="identity-sc-message ${shouldScroll ? 'is-scrolling' : ''}">
        <span>${escapeHtml(message || '醒目留言')}</span>
      </span>
    </div>
  `;
}

function renderIdentitySuperChatRow(item) {
  const message = String(item.message || '').trim();
  return `
    <div class="identity-row identity-sc">
      <span class="identity-sc-price">SC ¥${escapeHtml(formatSuperChatPrice(item.price))}</span>
      <span class="identity-sc-content">
        <span class="identity-sc-text">${escapeHtml(message || '醒目留言')}</span>
      </span>
    </div>
  `;
}

function scheduleIdentitySuperChatScroll(content) {
  const setup = () => {
    content.querySelectorAll('.identity-sc-content').forEach((container) => {
      const text = container.querySelector('.identity-sc-text');
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

function scheduleIdentityRuleScroll(content) {
  const setup = () => {
    if (prefersReducedMotion()) return;

    content.querySelectorAll('.identity-rule').forEach((container) => {
      const text = container.querySelector('.identity-rule-text');
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

function prefersReducedMotion() {
  return typeof window !== 'undefined'
    && typeof window.matchMedia === 'function'
    && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
}

function renderIdentityRow(item, index, showIndex = true) {
  const guardLevel = normalizeGuardLevel(item.requester_guard_level);
  const medalLevel = Number(item.requester_medal_level || 0);
  const medalName = String(item.requester_medal_name || '').trim();
  const identityText = requesterIdentityLabel(guardLevel, medalLevel, medalName);
  const identityClass = requesterIdentityClass(guardLevel, medalLevel);
  const medalClass = medalLevelClass(medalLevel);
  const songName = escapeHtml(item.song_name);
  const songPrefix = item.is_pinned ? '📌 ' : '';
  const fullSongText = songPrefix + songName;

  return `
    <div class="identity-row guard-${guardLevel} medal-${medalClass}">
      ${showIndex ? `<span class="identity-rank">${index + 1}</span>` : ''}
      <span class="identity-song-wrapper">
        <span class="identity-song" data-text="${escapeHtml(fullSongText)}">${fullSongText}${fullSongText.length > 15 ? ' • ' + fullSongText : ''}</span>
      </span>
      <span class="identity-requester">${escapeHtml(item.requester_name || '观众')}</span>
      ${identityText ? `<span class="identity-badge ${identityClass}">${escapeHtml(identityText)}</span>` : ''}
      ${medalLevel > 0 ? `<span class="identity-medal">${medalLevel}</span>` : ''}
    </div>
  `;
}

function applyTheme(settings, style) {
  const panel = document.querySelector('.overlay-panel');
  panel.className = `overlay-panel queue-${style}`;
  const root = document.documentElement;
  const lowPower = overlayLowPowerEnabled(settings);
  panel.classList.toggle('low-power', lowPower);

  root.style.setProperty('--overlay-primary', settings.themePrimary || '#ff6f91');
  root.style.setProperty('--overlay-accent', settings.themeAccent || '#21b6a8');
  root.style.setProperty('--overlay-text', settings.themeText || '#fff7fb');
  root.style.setProperty('--overlay-opacity', settings.themeOpacity || '0.76');
  root.style.setProperty('--overlay-radius', `${settings.themeRadius || 8}px`);
  root.style.setProperty('--overlay-font-scale', settings.themeFontScale || '1');

  const primaryRgb = hexToRgb(settings.themePrimary || '#ff6f91');
  root.style.setProperty('--overlay-primary-r', String(primaryRgb.r));
  root.style.setProperty('--overlay-primary-g', String(primaryRgb.g));
  root.style.setProperty('--overlay-primary-b', String(primaryRgb.b));

  const accentRgb = hexToRgb(settings.themeAccent || '#21b6a8');
  root.style.setProperty('--overlay-accent-r', String(accentRgb.r));
  root.style.setProperty('--overlay-accent-g', String(accentRgb.g));
  root.style.setProperty('--overlay-accent-b', String(accentRgb.b));

  const bgRgb = hexToRgb(settings.themeBackground || '#181823');
  root.style.setProperty('--overlay-bg-r', String(bgRgb.r));
  root.style.setProperty('--overlay-bg-g', String(bgRgb.g));
  root.style.setProperty('--overlay-bg-b', String(bgRgb.b));

  const blur = lowPower ? 0 : Number(settings.backdropBlur || 0);
  root.style.setProperty('--overlay-blur', `${Number.isFinite(blur) ? Math.max(0, blur) : 0}px`);
  panel.classList.toggle('has-backdrop-blur', blur > 0);

  const rawGlowIntensity = Number(settings.glowIntensity || 0);
  const glowIntensity = lowPower || !Number.isFinite(rawGlowIntensity) ? 0 : Math.max(0, rawGlowIntensity);
  root.style.setProperty('--overlay-glow-size', `${glowIntensity}px`);
  root.style.setProperty('--overlay-glow-color',
    glowIntensity > 0
      ? `rgba(${accentRgb.r}, ${accentRgb.g}, ${accentRgb.b}, ${Math.min(0.25, glowIntensity / 80)})`
      : 'transparent');

  const gradientEnabled = settings.enableGradient === 'true';
  panel.classList.toggle('gradient-bg', gradientEnabled);
  if (gradientEnabled) {
    const gradRgb = hexToRgb(settings.gradientEnd || settings.themeBackground || '#181823');
    root.style.setProperty('--overlay-gradient-r', String(gradRgb.r));
    root.style.setProperty('--overlay-gradient-g', String(gradRgb.g));
    root.style.setProperty('--overlay-gradient-b', String(gradRgb.b));
  }

  const fontFamily = settings.overlayFontFamily || 'Microsoft YaHei';
  root.style.setProperty('--overlay-font-family', withMultilingualFallback(fontFamily));
  root.style.setProperty('--overlay-font-weight', settings.overlayFontWeight || '800');

  const songColor = settings.overlaySongColor || '';
  root.style.setProperty('--overlay-song-color', songColor || settings.themeText || '#fff7fb');
  root.style.setProperty('--overlay-requester-color', settings.overlayRequesterColor || '');
  root.style.setProperty('--overlay-index-color', settings.overlayIndexColor || '');
  setIdentityRuleThemeVars(root, settings);

  const titleEl = panel.querySelector('.overlay-title');
  if (titleEl) {
    const customTitle = String(settings.overlayTitle || '').trim();
    titleEl.textContent = customTitle || '点歌队列';
  }

  const songFontSize = queueSongFontSize(settings);
  root.style.setProperty('--overlay-song-font-size', `${songFontSize}px`);
  root.style.setProperty('--overlay-waiting-font-size', `${Math.max(10, Math.round(songFontSize * 0.65))}px`);
  root.style.setProperty('--overlay-title-font-size', `${normalizeFontSize(
    settings.queueTitleFontSize,
    scaleToFontSize(settings.themeFontScale, 30),
    40,
    10
  )}px`);
  root.style.setProperty('--scroll-seconds', `${queueScrollSeconds(settings)}s`);

  panel.style.backgroundColor = style === 'identity'
    ? ''
    : hexToRgba(settings.themeBackground || '#181823', settings.themeOpacity || 0.76);
}

function setIdentityRuleThemeVars(root, settings) {
  const defaultColors = ['#f5b72f', '#65aef7', '#8d67e8', '#f25f72', '#21b6a8', '#f97316'];
  for (let index = 0; index < defaultColors.length; index += 1) {
    const key = `overlayRuleColor${index + 1}`;
    root.style.setProperty(`--identity-rule-${index + 1}-bg`, settings[key] || defaultColors[index]);
  }
  const ruleFontSize = Math.max(8, normalizeFontSize(settings.overlayRuleFontSize, 10, 18)) * 2;
  root.style.setProperty('--identity-rule-font-size', `${ruleFontSize}px`);
}

function hexToRgb(hex) {
  const normalized = String(hex || '#181823').replace('#', '');
  const value = normalized.length === 3
    ? normalized.split('').map((char) => char + char).join('')
    : normalized;
  const number = Number.parseInt(value, 16);
  return {
    r: (number >> 16) & 255,
    g: (number >> 8) & 255,
    b: number & 255
  };
}

function queueScrollSeconds(settings, settingKey = 'queueScrollSpeed') {
  const urlSpeed = new URLSearchParams(location.search).get('speed');
  const settingSpeed = settings?.[settingKey] || settings?.queueScrollSpeed || 80;
  const speed = Math.round(Number(urlSpeed || settingSpeed));
  const displaySpeed = normalizeQueueScrollSpeed(speed);
  const actualSpeed = 50 + ((displaySpeed - 1) / 99) * 150;
  const seconds = Number((50 - ((actualSpeed - 50) / 150) * 49).toFixed(2));
  return seconds;
}

function normalizeQueueScrollSpeed(speed) {
  if (!Number.isFinite(speed)) return 80;
  if (speed > 100) {
    return Math.round(1 + ((Math.max(50, Math.min(200, speed)) - 50) / 150) * 99);
  }
  return Math.max(1, Math.min(100, speed));
}

function overlayLowPowerEnabled(settings) {
  const quality = new URLSearchParams(location.search).get('quality');
  if (quality === 'pretty' || quality === 'smooth') return false;
  if (quality === 'low') return true;
  return (settings.overlayLowPowerMode || 'false') === 'true';
}

function scrollTravelSeconds(secondsPerViewport, distance, viewportDistance) {
  const safeSeconds = Math.max(0.01, Number(secondsPerViewport) || 0.01);
  const safeDistance = Math.max(0, Number(distance) || 0);
  const safeViewportDistance = Math.max(1, Number(viewportDistance) || 1);
  return Number(Math.max(0.05, (safeSeconds * safeDistance) / safeViewportDistance).toFixed(3));
}

function bounceScrollTiming(downSeconds, upSeconds = 3) {
  const pauseSeconds = 1.5;
  const totalSeconds = downSeconds + pauseSeconds + upSeconds;
  return {
    totalSeconds,
    downPercent: (downSeconds / totalSeconds) * 100,
    pauseEndPercent: ((downSeconds + pauseSeconds) / totalSeconds) * 100
  };
}

function setClassicBounceKeyframes(downPercent, pauseEndPercent) {
  const pauseStart = Math.max(1, Math.min(97, Number(downPercent) || 90)).toFixed(4);
  const pauseEnd = Math.max(Number(pauseStart), Math.min(99, Number(pauseEndPercent) || 95)).toFixed(4);
  let style = document.getElementById('classicBounceKeyframes');
  if (!style) {
    style = document.createElement('style');
    style.id = 'classicBounceKeyframes';
    document.head.appendChild(style);
  }
  style.textContent = `
@keyframes classic-scroll-bounce {
  0% { transform: translateY(0); }
  ${pauseStart}% { transform: translateY(calc(-1 * var(--classic-bounce-distance, 57px))); }
  ${pauseEnd}% { transform: translateY(calc(-1 * var(--classic-bounce-distance, 57px))); }
  100% { transform: translateY(0); }
}`;
}

function setIdentityBounceKeyframes(downPercent, pauseEndPercent) {
  const pauseStart = Math.max(1, Math.min(97, Number(downPercent) || 90)).toFixed(4);
  const pauseEnd = Math.max(Number(pauseStart), Math.min(99, Number(pauseEndPercent) || 95)).toFixed(4);
  let style = document.getElementById('identityBounceKeyframes');
  if (!style) {
    style = document.createElement('style');
    style.id = 'identityBounceKeyframes';
    document.head.appendChild(style);
  }
  style.textContent = `
@keyframes identity-scroll-bounce {
  0% { transform: translateY(0); }
  ${pauseStart}% { transform: translateY(calc(-1 * var(--identity-bounce-distance, 64px))); }
  ${pauseEnd}% { transform: translateY(calc(-1 * var(--identity-bounce-distance, 64px))); }
  100% { transform: translateY(0); }
}`;
}

function hexToRgba(hex, opacity) {
  const { r, g, b } = hexToRgb(hex);
  const alpha = Number(opacity);
  const safeAlpha = Number.isFinite(alpha) ? Math.max(0, Math.min(1, alpha)) : 0.76;
  return `rgba(${r}, ${g}, ${b}, ${safeAlpha})`;
}

function normalizeGuardLevel(value) {
  const level = Number(value);
  return [1, 2, 3].includes(level) ? level : 0;
}

function normalizeFontSize(value, fallback, max = 20, min = 5) {
  const number = Number(value);
  const fallbackNumber = Number(fallback);
  const safeValue = Number.isFinite(number) ? number : fallbackNumber;
  return Math.max(min, Math.min(max, Math.round(safeValue)));
}

function queueSongFontSize(settings) {
  return normalizeFontSize(
    (settings || {}).queueSongFontSize,
    scaleToFontSize((settings || {}).themeFontScale, 40),
    70,
    10
  );
}

function scaleToFontSize(scale, baseSize) {
  const number = Number(scale);
  const safeScale = Number.isFinite(number) ? number : 1;
  return Math.round(safeScale * baseSize);
}

function guardLabel(level) {
  return {
    1: '总督',
    2: '提督',
    3: '舰长'
  }[level] || '观众';
}

function requesterIdentityLabel(guardLevel, medalLevel, medalName) {
  const guard = guardLabel(guardLevel);
  if (guard !== '观众') return guard;
  return Number(medalLevel || 0) > 0 ? (String(medalName || '').trim() || 'imilly') : '';
}

function requesterIdentityClass(guardLevel, medalLevel) {
  if (guardLevel === 3) return 'identity-captain';
  if (guardLevel === 2) return 'identity-admiral';
  if (guardLevel === 1) return 'identity-governor';
  return Number(medalLevel || 0) > 0 ? 'identity-fan' : 'identity-none';
}

function medalLevelClass(level) {
  const value = Number(level || 0);
  if (value >= 51) return 'red';
  if (value >= 41) return 'purple';
  if (value >= 31) return 'deep-blue';
  if (value >= 21) return 'light-blue';
  if (value >= 1) return 'blue-purple';
  return 'none';
}

function formatSuperChatPrice(value) {
  const number = Number(value);
  if (!Number.isFinite(number)) return '0';
  return Number.isInteger(number) ? String(number) : number.toFixed(2).replace(/0+$/, '').replace(/\.$/, '');
}

function escapeHtml(value) {
  return String(value || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function withMultilingualFallback(fontFamily) {
  const selected = String(fontFamily || '').trim();
  if (!selected) return multilingualFontFallback;
  return `${selected}, ${multilingualFontFallback}`;
}
