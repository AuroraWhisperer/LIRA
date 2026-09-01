// Queue overlay markup and theme rendering.
'use strict';

import {
  scheduleClassicVerticalScroll,
  scheduleIdentityContentScroll,
  scheduleIdentityRuleScroll,
  scheduleIdentitySuperChatScroll,
  scheduleIdentityVerticalScroll,
  scheduleIllustratedVerticalScroll,
  scheduleStorybookVerticalScroll,
} from './queue-scroll.js';
import {
  escapeHtml,
  formatSuperChatPrice,
  guardLabel,
  identityQueueFontSize,
  medalLevelClass,
  normalizeFontSize,
  normalizeGuardLevel,
  requesterIdentityClass,
  requesterIdentityLabel,
  scaleToFontSize,
  superChatPriceClass,
} from './queue-utils.js';
import { applyTheme, setIdentityRuleThemeVars } from './queue-theme.js';

export { applyTheme, setIdentityRuleThemeVars } from './queue-theme.js';

function displaySongName(value) {
  return String(value ?? '').trimStart();
}

export function renderClassicQueue(settings, current, waiting, content) {
  const items = [current].concat(waiting).filter(Boolean);
  const baseFontSize = Math.max(
    10,
    normalizeFontSize(
      (settings || {}).queueSongFontSize,
      scaleToFontSize((settings || {}).themeFontScale, 40),
      70,
      10,
    ),
  );
  const rowHeight = Math.max(35, Math.round(baseFontSize * 0.65 * 1.8));
  const rowGap = 5;
  const showIndex = settings.overlayShowIndex !== 'false';
  const threshold = Number(settings.overlayIndexThreshold || 0);
  const shouldShowIndex =
    showIndex && (threshold === 0 || items.length > threshold);
  document.documentElement.style.setProperty(
    '--classic-row-height',
    `${rowHeight}px`,
  );
  document.documentElement.style.setProperty(
    '--classic-row-gap',
    `${rowGap}px`,
  );

  if (items.length === 0) {
    content.innerHTML = '<div class="overlay-empty">当前还没有点歌</div>';
    return;
  }

  const rowsHtml = items
    .map(
      (item, index) => `
    <div class="overlay-waiting-row">
      ${shouldShowIndex ? `<div class="index">${index + 1}</div>` : ''}
      <div>
        <div class="song overlay-song-line">
          <span class="overlay-song-name">${item.is_pinned ? '📌 ' : ''}${escapeHtml(displaySongName(item.song_name))}</span>
          <span class="overlay-requester">${escapeHtml(item.requester_name || '观众')}</span>
        </div>
      </div>
    </div>
  `,
    )
    .join('');

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

export function renderIdentityQueue(
  settings,
  current,
  waiting,
  content,
  superChats = [],
) {
  const songItems = [current].concat(waiting).filter(Boolean);
  const scItems = (Array.isArray(superChats) ? superChats : []).filter(
    (item) => Number(item.price || 0) >= 2,
  );
  const baseFontSize = identityQueueFontSize(settings);
  const rowHeight = Math.max(24, Math.round(baseFontSize * 1.6));
  const rowGap = 4;
  document.documentElement.style.setProperty(
    '--identity-row-height',
    `${rowHeight}px`,
  );
  document.documentElement.style.setProperty(
    '--identity-row-gap',
    `${rowGap}px`,
  );

  const showIndex = settings.overlayShowIndex !== 'false';
  const threshold = Number(settings.overlayIndexThreshold || 0);
  const shouldShowIndex =
    showIndex && (threshold === 0 || songItems.length > threshold);
  const pins = [
    settings.overlayPin1,
    settings.overlayPin2,
    settings.overlayPin3,
  ]
    .map((item) => String(item || '').trim())
    .filter(Boolean);
  const pinHtml = pins.length
    ? `
    <div class="identity-pins">
      ${pins
        .map(
          (pin) => `
        <div class="identity-pin-row">
          <span class="identity-pin-label">置顶</span>
          <span class="identity-pin-content">${escapeHtml(pin)}</span>
        </div>
      `,
        )
        .join('')}
    </div>
  `
    : '';
  const rules = [
    settings.overlayRule1,
    settings.overlayRule2,
    settings.overlayRule3,
    settings.overlayRule4,
    settings.overlayRule5,
    settings.overlayRule6,
  ]
    .map((item) => String(item || '').trim())
    .filter(Boolean);
  const ruleHtml = rules.length
    ? `
    <div class="identity-rules">
      ${rules
        .map(
          (rule, index) => `
        <span class="identity-rule identity-rule-${(index % 6) + 1}">
          <span class="identity-rule-text">${escapeHtml(rule)}</span>
        </span>
      `,
        )
        .join('')}
    </div>
  `
    : '';

  const scRowsHtml = scItems
    .map((item) => renderIdentitySuperChatRow(item))
    .join('');
  const songRowsHtml =
    songItems.length > 0
      ? songItems
          .map((item, i) => renderIdentityRow(item, i, shouldShowIndex))
          .join('')
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

export function renderIdentitySuperChatRow(item) {
  const message = String(item.message || '').trim();
  const priceClass = superChatPriceClass(item.price);
  return `
    <div class="identity-row identity-sc">
      <span class="identity-sc-price ${priceClass}">SC ¥${escapeHtml(formatSuperChatPrice(item.price))}</span>
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
  const songName = escapeHtml(displaySongName(item.song_name));
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

export function renderStorybookQueue(settings, current, waiting, content) {
  const items = [current].concat(waiting).filter(Boolean);
  const rowGap = 7;

  if (items.length === 0) {
    content.innerHTML = `
      <div class="storybook-list-window">
        <div class="storybook-empty">当前还没有点歌</div>
      </div>
    `;
    return;
  }

  const rowsHtml = items
    .map((item, index) => renderStorybookRow(item, index))
    .join('');
  content.innerHTML = `
    <div class="storybook-list-window">
      <div class="identity-list storybook-list paused">
        ${rowsHtml}
      </div>
    </div>
  `;

  scheduleStorybookVerticalScroll(content, settings, rowsHtml, rowGap);
  scheduleIdentityContentScroll(content);
}

export function renderStorybookRow(item, index) {
  const guardLevel = normalizeGuardLevel(item.requester_guard_level);
  const medalLevel = Number(item.requester_medal_level || 0);
  const medalName = String(item.requester_medal_name || '').trim();
  const identityText = requesterIdentityLabel(guardLevel, medalName);
  const identityClass = requesterIdentityClass(guardLevel, medalLevel);
  const medalClass = medalLevelClass(medalLevel);
  const songPrefix = item.is_pinned ? '📌 ' : '';

  return `
    <div class="storybook-row guard-${guardLevel} medal-${medalClass}">
      <span class="storybook-rank">${index + 1}</span>
      <span class="storybook-info-viewport identity-content-wrapper">
        <span class="storybook-info identity-content">
          <span class="storybook-song">${songPrefix}${escapeHtml(displaySongName(item.song_name))}</span>
          <span class="storybook-requester">${escapeHtml(item.requester_name || '观众')}</span>
          ${identityText ? `<span class="storybook-badge ${identityClass}">${escapeHtml(identityText)}</span>` : ''}
          ${medalLevel > 0 ? `<span class="storybook-medal">${medalLevel}</span>` : ''}
        </span>
      </span>
    </div>
  `;
}

export function renderNeonVinylQueue(settings, current, waiting, content) {
  renderIllustratedAssetQueue(
    settings,
    current,
    waiting,
    content,
    'neon-vinyl',
    8,
    renderNeonVinylRow,
  );
}

export function renderCherryRibbonQueue(settings, current, waiting, content) {
  renderIllustratedAssetQueue(
    settings,
    current,
    waiting,
    content,
    'cherry-ribbon',
    8,
    renderCherryRibbonRow,
  );
}

export function renderGoldenLilyQueue(settings, current, waiting, content) {
  renderIllustratedAssetQueue(
    settings,
    current,
    waiting,
    content,
    'golden-lily',
    4,
    renderGoldenLilyRow,
  );
}

function renderIllustratedAssetQueue(
  settings,
  current,
  waiting,
  content,
  style,
  rowGap,
  renderRow,
) {
  const items = [current].concat(waiting).filter(Boolean);

  if (items.length === 0) {
    content.innerHTML = `
      <div class="${style}-list-window">
        <div class="${style}-empty illustrated-empty">当前还没有点歌</div>
      </div>
    `;
    return;
  }

  const rowsHtml = items.map((item, index) => renderRow(item, index)).join('');
  content.innerHTML = `
    <div class="${style}-list-window">
      <div class="identity-list ${style}-list paused">
        ${rowsHtml}
      </div>
    </div>
  `;

  scheduleIllustratedVerticalScroll(content, settings, rowsHtml, rowGap, style);
  scheduleIdentityContentScroll(content);
}

export function renderNeonVinylRow(item) {
  return renderIllustratedAssetRow(item, 'neon-vinyl');
}

export function renderCherryRibbonRow(item) {
  return renderIllustratedAssetRow(item, 'cherry-ribbon');
}

export function renderGoldenLilyRow(item, index = 0) {
  return renderIllustratedAssetRow(item, 'golden-lily', index + 1);
}

function renderIllustratedAssetRow(item, style, rank = null) {
  const guardLevel = normalizeGuardLevel(item.requester_guard_level);
  const medalLevel = Math.max(0, Number(item.requester_medal_level || 0));
  const medalName = String(item.requester_medal_name || '').trim();
  const identityClass = requesterIdentityClass(guardLevel, medalLevel);
  const medalClass = medalLevelClass(medalLevel);
  const songPrefix = item.is_pinned ? '📌 ' : '';
  const hasMedal = medalName.length > 0 || medalLevel > 0;
  const medalText = medalName
    ? `${medalName}${medalLevel > 0 ? ` · ${medalLevel}` : ''}`
    : String(medalLevel);

  return `
    <div class="${style}-row illustrated-queue-row guard-${guardLevel} medal-${medalClass}">
      ${rank === null ? '' : `<span class="${style}-rank illustrated-rank">${rank}</span>`}
      <span class="${style}-info-viewport illustrated-info-viewport identity-content-wrapper">
        <span class="${style}-info illustrated-info identity-content">
          <span class="${style}-song illustrated-field illustrated-song">
            <span class="illustrated-song-value">${songPrefix}${escapeHtml(displaySongName(item.song_name))}</span>
          </span>
          <span class="${style}-requester illustrated-field illustrated-requester">
            <span>${escapeHtml(item.requester_name || '观众')}</span>
          </span>
          ${
            guardLevel > 0
              ? `<span class="${style}-guard illustrated-field illustrated-guard ${identityClass}">
            <span class="illustrated-guard-value">${escapeHtml(guardLabel(guardLevel))}</span>
          </span>`
              : ''
          }
          ${
            hasMedal
              ? `<span class="${style}-medal illustrated-field illustrated-medal">
            <span class="illustrated-medal-value">${escapeHtml(medalText)}</span>
          </span>`
              : ''
          }
        </span>
      </span>
    </div>
  `;
}
