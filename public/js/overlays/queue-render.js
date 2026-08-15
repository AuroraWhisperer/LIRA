// Queue overlay markup and theme rendering.
'use strict';

import { scheduleClassicVerticalScroll, scheduleIdentityContentScroll, scheduleIdentityRuleScroll, scheduleIdentitySuperChatScroll, scheduleIdentityVerticalScroll } from './queue-scroll.js';
import { escapeHtml, formatSuperChatPrice, hexToRgb, hexToRgba, identityQueueFontSize, medalLevelClass, normalizeFontSize, normalizeGuardLevel, overlayLowPowerEnabled, queueScrollSeconds, queueSongFontSize, requesterIdentityClass, requesterIdentityLabel, scaleToFontSize, withMultilingualFallback } from './queue-utils.js';

export function renderClassicQueue(settings, current, waiting, content) {
  const items = [current].concat(waiting).filter(Boolean);
  const baseFontSize = Math.max(10, normalizeFontSize(
    (settings || {}).queueSongFontSize,
    scaleToFontSize((settings || {}).themeFontScale, 40),
    70,
    10
  ));
  const rowHeight = Math.max(35, Math.round(baseFontSize * 0.65 * 1.8));
  const rowGap = 5;
  const showIndex = settings.overlayShowIndex !== 'false';
  const threshold = Number(settings.overlayIndexThreshold || 0);
  const shouldShowIndex = showIndex && (threshold === 0 || items.length > threshold);
  document.documentElement.style.setProperty('--classic-row-height', `${rowHeight}px`);
  document.documentElement.style.setProperty('--classic-row-gap', `${rowGap}px`);

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

  const noIndexClass = shouldShowIndex ? '' : ' no-index';

  content.innerHTML = `
    <div class="classic-list-window">
      <div class="classic-list paused${noIndexClass}">
        ${rowsHtml}
      </div>
    </div>
  `;

  scheduleClassicVerticalScroll(content, settings, rowsHtml, rowGap);
}

export function renderIdentityQueue(settings, current, waiting, content, superChats = []) {
  const songItems = [current].concat(waiting).filter(Boolean);
  const scItems = (Array.isArray(superChats) ? superChats : []).filter((item) => Number(item.price || 0) >= 2);
  const baseFontSize = identityQueueFontSize(settings);
  const rowHeight = Math.max(24, Math.round(baseFontSize * 1.6));
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
  scheduleIdentityContentScroll(content);
  scheduleIdentitySuperChatScroll(content);
  scheduleIdentityRuleScroll(content);
}

export function renderIdentitySuperChats(superChats) {
  const items = (Array.isArray(superChats) ? superChats : []).filter((item) => Number(item.price || 0) >= 2);
  if (items.length === 0) return '';
  return `
    <div class="identity-sc-list">
      ${items.map(renderIdentitySuperChat).join('')}
    </div>
  `;
}

export function renderIdentitySuperChat(item) {
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

export function renderIdentitySuperChatRow(item) {
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

export function renderIdentityRow(item, index, showIndex = true) {
  const guardLevel = normalizeGuardLevel(item.requester_guard_level);
  const medalLevel = Number(item.requester_medal_level || 0);
  const medalName = String(item.requester_medal_name || '').trim();
  const identityText = requesterIdentityLabel(guardLevel, medalName);
  const identityClass = requesterIdentityClass(guardLevel, medalLevel);
  const medalClass = medalLevelClass(medalLevel);
  const songName = escapeHtml(item.song_name);
  const songPrefix = item.is_pinned ? '📌 ' : '';
  const fullSongText = songPrefix + songName;

  return `
    <div class="identity-row guard-${guardLevel} medal-${medalClass}">
      ${showIndex ? `<span class="identity-rank">${index + 1}</span>` : ''}
      <span class="identity-content-wrapper">
        <span class="identity-content">
          <span class="identity-song">${fullSongText}</span>
          <span class="identity-requester">${escapeHtml(item.requester_name || '观众')}</span>
          ${identityText ? `<span class="identity-badge ${identityClass}">${escapeHtml(identityText)}</span>` : ''}
          ${medalLevel > 0 ? `<span class="identity-medal">${medalLevel}</span>` : ''}
        </span>
      </span>
    </div>
  `;
}

export function applyTheme(settings, style) {
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
  root.style.setProperty('--identity-queue-font-size', `${identityQueueFontSize(settings)}px`);
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

export function setIdentityRuleThemeVars(root, settings) {
  const defaultColors = ['#f5b72f', '#65aef7', '#8d67e8', '#f25f72', '#21b6a8', '#f97316'];
  for (let index = 0; index < defaultColors.length; index += 1) {
    const key = `overlayRuleColor${index + 1}`;
    root.style.setProperty(`--identity-rule-${index + 1}-bg`, settings[key] || defaultColors[index]);
  }
  const ruleFontSize = Math.max(8, normalizeFontSize(settings.overlayRuleFontSize, 10, 18)) * 2;
  root.style.setProperty('--identity-rule-font-size', `${ruleFontSize}px`);
}
