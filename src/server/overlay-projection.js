'use strict';

// Page capabilities select fields, never a whole runtime object or settings prefix.
const SETTING_KEYS = {
  queue: `backdropBlur enableGradient glowIntensity gradientEnd
    themeAccent themeBackground themeFontScale themeOpacity themePrimary themeRadius themeText
    overlayFontFamily overlayFontWeight overlayIndexColor overlayIndexThreshold overlayLowPowerMode
    overlayPin1 overlayPin2 overlayPin3 overlayQueueStyle overlayRequesterColor
    overlayRule1 overlayRule2 overlayRule3 overlayRule4 overlayRule5 overlayRule6
    overlayRuleColor1 overlayRuleColor2 overlayRuleColor3 overlayRuleColor4 overlayRuleColor5 overlayRuleColor6
    overlayRuleFontSize overlayShowIndex overlaySongColor overlayTitle
    queueScrollMode queueScrollSpeed queueSongFontSize queueTitleFontSize
    identityQueueFontSize identityQueueScrollMode identityQueueScrollSpeed
    illustratedQueueFontFamily illustratedQueueFontWeight illustratedQueueTextColor illustratedQueueUseCustomTextColor
    storybookQueueFontFamily storybookQueueFontSize storybookQueueFontWeight storybookQueueScrollMode
    storybookQueueScrollSpeed storybookQueueTextColor storybookQueueUseCustomTextColor
    neonVinylQueueFontFamily neonVinylQueueFontSize neonVinylQueueFontWeight neonVinylQueueScrollMode
    neonVinylQueueScrollSpeed neonVinylQueueTextColor neonVinylQueueUseCustomTextColor
    cherryRibbonQueueFontFamily cherryRibbonQueueFontSize cherryRibbonQueueFontWeight cherryRibbonQueueScrollMode
    cherryRibbonQueueScrollSpeed cherryRibbonQueueTextColor cherryRibbonQueueUseCustomTextColor
    goldenLilyQueueFontFamily goldenLilyQueueFontSize goldenLilyQueueFontWeight goldenLilyQueueScrollMode
    goldenLilyQueueScrollSpeed goldenLilyQueueTextColor goldenLilyQueueUseCustomTextColor`,
  songlist: `backdropBlur enableGradient glowIntensity gradientEnd
    themeAccent themeBackground themeOpacity themePrimary themeRadius themeText
    overlayFontFamily overlayFontWeight overlayLowPowerMode overlayRequesterColor overlaySongColor overlayTitle
    scrollSeconds songBoardBackdropBlur songBoardEnableGradient songBoardFontFamily songBoardFontSize
    songBoardFontWeight songBoardGlowIntensity songBoardGradientEnd songBoardSongColor songBoardSongFontSize
    songBoardSortMode songBoardSyncTheme songBoardThemeAccent songBoardThemeBackground songBoardThemeOpacity
    songBoardThemePrimary songBoardThemeRadius songBoardThemeText songBoardTitle songBoardTitleFontSize`,
  blindbox: `backdropBlur blindboxOverlayTitle enableGradient glowIntensity gradientEnd
    overlayFontFamily overlayFontWeight overlayLowPowerMode overlayRequesterColor overlaySongColor
    themeAccent themeBackground themeFontScale themeOpacity themePrimary themeRadius themeText`,
  lyrics: `desktopLyricAlignAnchor desktopLyricAlignPosition desktopLyricBackgroundEnabled
    desktopLyricBackgroundRenderer desktopLyricBaseOpacity desktopLyricBgOpacity desktopLyricBlurEffect
    desktopLyricBrightness desktopLyricContrast desktopLyricCurrentLineEnhanced desktopLyricFallbackFontFamily
    desktopLyricFontFamily desktopLyricFontSize desktopLyricFontWeight desktopLyricGlobalOpacity
    desktopLyricHideOnPause desktopLyricHidePassedLines desktopLyricInterludeOffsetEm desktopLyricKaraokeEnabled
    desktopLyricKaraokeMode desktopLyricLetterSpacing desktopLyricLineHeight desktopLyricNoLyricText
    desktopLyricOpacity desktopLyricPerspective desktopLyricRotateX desktopLyricRotateY desktopLyricSaturation
    desktopLyricScale desktopLyricScaleEffect desktopLyricShadowBlur desktopLyricShadowColor
    desktopLyricShadowEnabled desktopLyricShadowIntensity desktopLyricShadowOffsetX desktopLyricShadowOffsetY
    desktopLyricShowTitleWhenNoLyric desktopLyricShowTranslation desktopLyricSpringAnimation
    desktopLyricStrokeColor desktopLyricStrokeEnabled desktopLyricStrokeWidth desktopLyricTextAlign
    desktopLyricTextColor desktopLyricTimeOffsetMs desktopLyricTraditionalMode desktopLyricTranslateX
    desktopLyricTranslateY desktopLyricTranslationOpacity desktopLyricTranslationScale desktopLyricVisibleLines`,
  danmaku: 'danmakuOverlayStyle danmakuFullscreenDurationSeconds',
  'gift-effects': 'giftEffectDanmakuEnabled giftFrameMotionMode',
  interactions: `interactionOverlayTitle interactionOverlayHint interactionRatingRules interactionTextColor
    interactionBackgroundColor interactionBackgroundOpacity interactionOverallOpacity interactionBarColor interactionTrackColor
    interactionFontSize interactionCornerRadius interactionShowStatus interactionShowParticipants`,
  overtime: '',
  games: '',
  wheel: '',
  'gift-feed': '',
  'gift-wishes': '',
  'gift-export': '',
  opening: '',
  clock: '',
};

function fields(names) {
  return Object.fromEntries(
    names
      .trim()
      .split(/\s+/)
      .filter(Boolean)
      .map((name) => [name, true]),
  );
}

const SETTING_SCHEMAS = Object.fromEntries(Object.entries(SETTING_KEYS).map(([scope, keys]) => [scope, fields(keys)]));
const POINT = fields('x y');
const EFFECT = fields('operation value');
const DANMAKU_ITEM = {
  ...fields(
    'id uid timestamp name message guardLevel medalName medalLevel isStreamer avatarUrl kind giftName giftCount giftTotalPrice',
  ),
  emotes: [fields('text url kind width height')],
};
const QUEUE_ITEM = fields(
  'song_name requester_name is_pinned requester_guard_level requester_medal_level requester_medal_name',
);
const OVERTIME = {
  ...fields('revision status serverNowMs effectiveRemainingMs'),
  background: fields('path fit'),
  rules: [{ ...fields('enabled giftId giftName imagePath mode displayText fixedSeconds'), fixedEffect: EFFECT }],
};
const LYRIC_STATE = {
  ...fields('trackTitle lineText translation currentMs durationMs progress playing locked generation sequence status'),
  artists: [true],
  words: [fields('text startMs endMs')],
};
const LYRIC_TIMELINE = {
  ...fields('trackTitle status'),
  artists: [true],
  lines: [fields('startMs endMs text translation roma')],
};
const WHEEL = {
  entries: [fields('label weight')],
  spin: fields('id index startedAt durationMs turns'),
  lastResult: fields('index'),
};
const DRAW_STATE = {
  ...fields('phase round totalRounds wordLength remainingMs serverNowMs answerRevealed revealedAnswer'),
  correct: [fields('name rank points')],
  scores: [fields('name score')],
  canvas: {
    ...fields('revision totalPoints'),
    strokes: [{ ...fields('id color width'), points: [POINT] }],
  },
};
const GAME_STATES = {
  'number-bomb': fields('min max lastGuess turn winner'),
  gomoku: { ...fields('size turn winner'), board: [[true]] },
  'draw-guess': DRAW_STATE,
};
const STATE_SCHEMAS = {
  queue: { queue: { current: QUEUE_ITEM, waiting: [QUEUE_ITEM] }, superChats: [fields('message price')] },
  songlist: {},
  blindbox: {},
  'gift-effects': {},
  'gift-feed': { gifts: fields('viewRevision') },
  'gift-wishes': { gifts: fields('viewRevision') },
  overtime: { overtime: OVERTIME },
  lyrics: { lyricState: LYRIC_STATE, lyricTimeline: LYRIC_TIMELINE },
  danmaku: { danmakuFeed: [DANMAKU_ITEM], liveStatus: fields('enabled roomId connected message') },
  interactions: {},
  games: {},
  wheel: {},
  opening: {},
  clock: {},
  'gift-export': {},
};
const INTERACTION = {
  ...fields('runtimeId revision'),
  session: {
    ...fields(
      'sessionId kind title phase rule startedAt endsAt finishedAt finishReason receptionInterrupted connected participants average',
    ),
    options: [fields('text votes percentage')],
  },
};
const RESPONSE_SCHEMAS = {
  interactions: { '/api/interactions/session': INTERACTION },
  'gift-wishes': {
    '/api/gifts/wishes': {
      ...fields('viewRevision asOf day partial'),
      session: fields('state stale startedAt endedAt'),
      items: [
        fields(
          'id period giftId giftName giftCategory imagePath target label displayStyle textTemplate count remaining completed progress startAt',
        ),
      ],
    },
  },
  songlist: { '/api/songs': [fields('id name artist category_name language name_initial')] },
  blindbox: {
    '/api/gifts/blind-box-stats': {
      summary: fields('boxCount totalCost totalProfit'),
      perUser: [fields('userName boxCount totalProfit')],
    },
  },
  'gift-feed': {
    '/api/gifts/display-settings': {
      ...fields('palette visibleRows scrollSpeed minGiftAmountCents'),
      thresholds: [true],
    },
    '/api/gifts/history': {
      ...fields('viewRevision nextCursor partial'),
      items: [
        {
          ...fields('eventId artworkPath'),
          gift: fields('userName giftName giftId giftVariantId coinType unitPrice num avatarUrl guardLevel createdAt'),
        },
      ],
    },
    '/api/gifts/card-profiles': {
      ...fields('viewRevision day partial'),
      items: [fields('eventId senderId userName avatarUrl guardLevel createdAt')],
    },
    '/api/overtime/gifts/catalog': {
      gifts: [{ ...fields('id name variantId imagePath'), giftIdentity: fields('variantId') }],
    },
  },
  games: {
    '/api/games/winner-profile': fields('avatarUrl'),
    '/api/games/session/draw': fields('revision'),
  },
  wheel: { '/api/wheel': WHEEL, '/api/wheel/spin': WHEEL },
  clock: { '/api/clock/config': fields('style showDate showSeconds hourFormat label') },
  opening: {
    '/api/opening/config': fields(
      'enabled title subtitle name footer quality trackMotion showNotes showEq audio volume audioUrl characterUrl',
    ),
  },
};
const EVENT_SCHEMAS = {
  'interaction:update': { scope: 'interactions', schema: { state: INTERACTION } },
  'danmaku:message': { scope: 'danmaku', schema: { item: DANMAKU_ITEM } },
  'gift-catalog:update': { scope: 'gift-feed', schema: {} },
  'gift:frame': {
    scope: 'gift-effects',
    schema: fields('eventId giftName userName num totalPriceCents themeId motionMode preview'),
  },
  'gift:effect': {
    scope: 'gift-effects',
    schema: {
      ...fields('eventId source preview'),
      effect: {
        ...fields('mp4Url'),
        layout: { ...fields('videoWidth videoHeight'), rgbFrame: [true], alphaFrame: [true] },
      },
    },
  },
  'game:draw': {
    scope: 'games',
    schema: { operation: { ...fields('action clientId revision strokeId color width'), points: [POINT] } },
  },
  'wheel:update': { scope: 'wheel', schema: { state: WHEEL } },
  'lyric-state': { scope: 'lyrics', schema: { state: LYRIC_STATE } },
  'lyric-timeline': { scope: 'lyrics', schema: { timeline: LYRIC_TIMELINE } },
  'overtime:update': {
    scope: 'overtime',
    schema: {
      ...fields('reason'),
      state: OVERTIME,
      adjustment: {
        ...fields('mode aggregate quantity appliedDeltaSeconds netSeconds giftId giftName applicationCount'),
        effect: EFFECT,
      },
    },
  },
};

// Scalars and every nested container are selected separately, so a new owner
// field (or an object placed in a scalar field) cannot silently cross a scope.
function select(value, schema) {
  if (value === null) return null;
  if (schema === true) {
    return ['string', 'boolean'].includes(typeof value) || (typeof value === 'number' && Number.isFinite(value))
      ? value
      : undefined;
  }
  if (Array.isArray(schema)) {
    return Array.isArray(value)
      ? value.map((item) => select(item, schema[0])).filter((item) => item !== undefined)
      : [];
  }
  const result = {};
  if (!value || typeof value !== 'object' || Array.isArray(value)) return result;
  for (const [key, childSchema] of Object.entries(schema)) {
    if (!Object.hasOwn(value, key)) continue;
    const child = select(value[key], childSchema);
    if (child !== undefined) result[key] = child;
  }
  return result;
}

function projectGameSession(session) {
  if (!session || !Object.hasOwn(GAME_STATES, session.game)) return null;
  const result = select(session, { ...fields('game restartBlocked'), winner: fields('uid'), danmaku: [DANMAKU_ITEM] });
  result.state = select(session.state, GAME_STATES[session.game]);
  if (session.game === 'draw-guess' && result.state) {
    if (result.state.answerRevealed !== true) result.state.revealedAnswer = '';
  }
  return result;
}

function projectOverlayState(scope, state) {
  if (!Object.hasOwn(STATE_SCHEMAS, scope)) return null;
  const result = select(state || {}, STATE_SCHEMAS[scope]);
  if (SETTING_KEYS[scope]) result.settings = select(state?.settings || {}, SETTING_SCHEMAS[scope]);
  // Retain the optional legacy dedicated game snapshot without expanding the
  // global runtime snapshot to include a new domain.
  if (scope === 'games' && Object.hasOwn(state || {}, 'games')) result.games = projectGameSession(state.games);
  return result;
}

function projectInteraction(data) {
  const result = select(data, INTERACTION);
  if (result?.session?.kind === 'rating' && result.session.phase !== 'finished') {
    result.session.average = null;
    delete result.session.participants;
    delete result.session.options;
  }
  return result;
}

function projectOverlayResponse(scope, pathName, data) {
  if (!Object.hasOwn(STATE_SCHEMAS, scope)) return null;
  if (pathName === '/api/state') return projectOverlayState(scope, data);
  if (scope === 'games' && ['/api/games/session', '/api/games/session/move'].includes(pathName))
    return projectGameSession(data);
  if (scope === 'interactions' && pathName === '/api/interactions/session') return projectInteraction(data);
  const schema = RESPONSE_SCHEMAS[scope]?.[pathName];
  return schema ? select(data, schema) : null;
}

function projectWebSocketPayload(principal, payload) {
  if (principal?.type === 'admin') return payload;
  if (principal?.type !== 'overlay' || !Object.hasOwn(STATE_SCHEMAS, principal.scope)) return null;
  if (!payload || typeof payload !== 'object') return null;
  const { scope } = principal;
  if (payload.type === 'snapshot') {
    return { ...select(payload, fields('type reason')), state: projectOverlayState(scope, payload.state) };
  }
  if (payload.type === 'shutdown') return select(payload, fields('type reason'));
  if (payload.type === 'game:update') {
    return scope === 'games' ? { type: 'game:update', session: projectGameSession(payload.session) } : null;
  }
  if (payload.type === 'interaction:update')
    return scope === 'interactions' ? { type: payload.type, state: projectInteraction(payload.state) } : null;
  const event = EVENT_SCHEMAS[payload.type];
  return event?.scope === scope ? { type: payload.type, ...select(payload, event.schema) } : null;
}

module.exports = { projectOverlayState, projectOverlayResponse, projectWebSocketPayload };
