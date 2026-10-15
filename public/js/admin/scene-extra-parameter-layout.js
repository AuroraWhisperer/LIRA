import { previewElement } from './component-preview-surface.js';

// Keep the canvas sections in the same vocabulary as their client settings pages.
const PARAMETER_GROUPS = {
  lyrics: [
    ['basic', '基础样式', ['style', 'desktopLyricFontFamily', 'desktopLyricFontSize',
      'desktopLyricFontWeight', 'desktopLyricTextAlign',
      'desktopLyricLineHeight', 'desktopLyricLetterSpacing', 'desktopLyricVisibleLines']],
    ['content', '显示策略', ['desktopLyricKaraokeMode', 'desktopLyricSungColor', 'desktopLyricTextColor',
      'desktopLyricShowTranslation', 'desktopLyricTranslationScale',
      'desktopLyricHidePassedLines', 'desktopLyricTraditionalMode', 'desktopLyricInterludeOffsetEm']],
    ['effect', '描边与阴影', ['desktopLyricStrokeEnabled', 'desktopLyricStrokeColor', 'desktopLyricStrokeWidth',
      'desktopLyricShadowEnabled', 'desktopLyricShadowColor', 'desktopLyricShadowIntensity', 'desktopLyricShadowBlur',
      'desktopLyricShadowOffsetX', 'desktopLyricShadowOffsetY'], false],
    ['visibility', '可见性与同步', ['desktopLyricHideOnPause', 'desktopLyricCurrentLineEnhanced',
      'desktopLyricOpacity', 'desktopLyricBaseOpacity', 'desktopLyricTranslationOpacity', 'desktopLyricTimeOffsetMs',
      'desktopLyricShowTitleWhenNoLyric', 'desktopLyricNoLyricText'], false],
    ['layout', '动画与布局', ['desktopLyricSpringAnimation', 'desktopLyricBlurEffect', 'desktopLyricScaleEffect',
      'desktopLyricScale', 'desktopLyricAlignPosition', 'desktopLyricAlignAnchor', 'desktopLyricTranslateX',
      'desktopLyricTranslateY', 'desktopLyricPerspective', 'desktopLyricRotateX', 'desktopLyricRotateY'], false],
    ['render', '背景与渲染', ['desktopLyricBackgroundEnabled', 'desktopLyricBackgroundRenderer',
      'desktopLyricBgOpacity', 'desktopLyricGlobalOpacity', 'desktopLyricBrightness', 'desktopLyricContrast',
      'desktopLyricSaturation'], false],
  ],
  songlist: [
    ['content', '展示内容', ['songBoardTitle', 'category', 'songBoardSortMode', 'scrollSeconds']],
    ['text', '字体与文字', ['songBoardFontFamily', 'songBoardFontWeight', 'songBoardSongFontSize',
      'songBoardTitleFontSize', 'songBoardSongColor']],
    ['theme', '主题与背景', ['songBoardSyncTheme', 'songBoardThemeText', 'songBoardThemeAccent',
      'songBoardThemeBackground', 'songBoardThemeOpacity', 'songBoardThemeRadius', 'songBoardFontSize',
      'songBoardBackdropBlur', 'songBoardGlowIntensity', 'songBoardEnableGradient', 'songBoardGradientEnd']],
  ],
  blindbox: [
    ['content', '榜单与筛选', ['blindboxOverlayTitle', 'top', 'winnersOnly', 'heartBoxOnly',
      'blindboxCastleMultiplier', 'blindboxShowCastlesRemaining', 'blindboxCastlesRemaining', 'blindboxShowOpenedSinceCastle']],
    ['appearance', '外观设置', ['compact', 'noScroll', 'overlayFontFamily', 'overlayFontWeight', 'themeFontScale',
      'themeBackground', 'themeOpacity', 'themeText', 'themePrimary', 'themeAccent']],
  ],
  interactions: [
    ['content', '内容与参与', ['kind', 'interactionOverlayTitle', 'interactionOverlayHint', 'interactionRatingRules',
      'interactionShowStatus', 'interactionShowParticipants']],
    ['appearance', '外观设置', ['interactionFontSize', 'interactionTextColor', 'interactionBackgroundColor',
      'interactionBackgroundOpacity', 'interactionOverallOpacity', 'interactionBarColor', 'interactionTrackColor', 'interactionCornerRadius']],
  ],
  'gift-feed': [
    ['display', '显示设置', ['visibleRows', 'scrollSpeed', 'minGiftAmountCents']],
    ['amounts', '金额分档', ['threshold1', 'threshold2', 'threshold3']],
  ],
  'gift-wishes': [
    ['content', '许愿展示', ['displayStyle', 'period', 'showCompleted', 'limit', 'gap']],
    ['colors', '文字配色', ['textPendingColor', 'textReceivedColor']],
  ],
  'guard-thanks': [
    ['appearance', '动画与文字', ['style', 'textMode', 'showAvatar', 'showUserName', 'nameFontSize']],
    ['preview', '模拟预览', ['tier', 'userName', 'months']],
  ],
  opening: [
    ['style', '展示样式', ['style']],
    ['content', '画面文案', ['title', 'subtitle', 'name', 'footer']],
    ['animation', '动画设置', ['quality', 'trackMotion', 'showNotes', 'showEq']],
  ],
  background: [['scene', '场景设置', ['style', 'sceneMode', 'windowScene', 'sceneIntervalSeconds']]],
  games: [['display', '显示设置', ['game', 'showTitle', 'showDanmaku', 'opacity']]],
  wheel: [['display', '显示设置', ['showResult', 'textColor', 'labelFontSize', 'opacity']]],
};

export function appendSceneParameterControl(label, input, { slider = false } = {}) {
  label.classList.add('desktop-lyric-control', 'scene-parameter-control');
  const row = previewElement('span', input.type === 'checkbox' ? 'switch-control' : 'scene-parameter-value');
  let range;
  if (slider) {
    row.classList.add('range-row');
    range = previewElement('input', 'parameter-range');
    range.type = 'range';
    range.setAttribute('aria-label', `${input.getAttribute('aria-label')}滑块`);
    for (const attribute of ['min', 'max', 'step']) range[attribute] = input[attribute];
    row.append(range);
  }
  row.append(input);
  if (input.type === 'checkbox') {
    const track = previewElement('span', 'switch-track');
    track.setAttribute('aria-hidden', 'true');
    row.append(track);
  }
  label.append(row);
  return range;
}

export function groupSceneExtraParameters(root, type, fields) {
  const groups = [];
  for (const [id, title, keys, open = true] of PARAMETER_GROUPS[type] || []) {
    const controls = keys.map(key => fields.get(key)?.label).filter(Boolean);
    if (!controls.length) continue;
    const section = previewElement('details', 'desktop-lyric-settings-group scene-parameter-group');
    section.dataset.parameterGroup = id;
    section.open = open;
    const summary = previewElement('summary');
    summary.append(previewElement('strong', '', title));
    const body = previewElement('div', 'desktop-lyric-group-body');
    body.append(...controls);
    section.append(summary, body);
    root.append(section);
    groups.push({ section, controls });
  }
  return () => {
    for (const { section, controls } of groups) section.hidden = controls.every(control => control.hidden);
  };
}
