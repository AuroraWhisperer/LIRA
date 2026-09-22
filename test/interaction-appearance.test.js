'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const {
  INTERACTION_APPEARANCE_DEFAULTS,
  normalizeInteractionAppearanceValue,
  readInteractionAppearance,
  applyInteractionAppearance,
} = require('../public/js/shared/interaction-appearance.js');
const { projectOverlayState, projectWebSocketPayload } = require('../src/server/overlay-projection');
const { DEFAULT_SETTINGS } = require('../src/storage/settings-defaults');

test('appearance accepts plain text and exact colors, with bounded opacity and safe fallback', () => {
  for (const [key, value] of Object.entries(INTERACTION_APPEARANCE_DEFAULTS))
    assert.equal(DEFAULT_SETTINGS[key], value, key);
  assert.equal(normalizeInteractionAppearanceValue('interactionOverlayTitle', '  今晚唱什么  '), '今晚唱什么');
  assert.equal(normalizeInteractionAppearanceValue('interactionOverlayHint', ''), '');
  assert.equal(normalizeInteractionAppearanceValue('interactionOverlayHint', '<img src=x>'), '<img src=x>');
  for (const [key, value] of [
    ['interactionOverlayTitle', '长'.repeat(61)],
    ['interactionOverlayHint', '长'.repeat(81)],
    ['interactionOverlayTitle', 'a\nb'],
    ['interactionOverlayTitle', {}],
    ['interactionRatingRules', {}],
    ['interactionRatingRules', null],
    ['interactionBarColor', 'url(https://example.invalid)'],
    ['interactionTextColor', '#fff'],
    ['interactionBackgroundOpacity', -1],
    ['interactionBackgroundOpacity', 101],
    ['interactionBackgroundOpacity', true],
    ['interactionBackgroundOpacity', 0.5],
    ['unknown', 'anything'],
  ])
    assert.equal(normalizeInteractionAppearanceValue(key, value), null, `${key}: ${value}`);
  assert.equal(normalizeInteractionAppearanceValue('interactionBackgroundOpacity', 0), '0');
  assert.equal(normalizeInteractionAppearanceValue('interactionBackgroundOpacity', '100'), '100');
  assert.equal(normalizeInteractionAppearanceValue('interactionTextColor', '#AABBCC'), '#aabbcc');
  assert.deepEqual(readInteractionAppearance({ interactionTextColor: 'invalid' }), INTERACTION_APPEARANCE_DEFAULTS);
  const style = new Map();
  applyInteractionAppearance(
    { style: { setProperty: (key, value) => style.set(key, value) } },
    {
      interactionBackgroundOpacity: '0',
      interactionOverallOpacity: '65',
      interactionBarColor: '#eeccff',
      interactionFontSize: '24',
      interactionCornerRadius: '0',
    },
  );
  assert.equal(style.get('--interaction-opacity'), '0%');
  assert.equal(style.get('--interaction-overall-opacity'), '0.65');
  assert.equal(style.get('--interaction-bar'), '#eeccff');
  assert.equal(style.get('--interaction-font-size'), '24px');
  assert.equal(style.get('--interaction-radius'), '0px');
});

test('appearance size, radius and overall opacity accept bounded integers and visibility accepts explicit booleans', () => {
  for (const [key, min, max] of [
    ['interactionOverallOpacity', 0, 100],
    ['interactionFontSize', 16, 24],
    ['interactionCornerRadius', 0, 32],
  ]) {
    assert.equal(normalizeInteractionAppearanceValue(key, min), String(min));
    assert.equal(normalizeInteractionAppearanceValue(key, String(max)), String(max));
    for (const invalid of [min - 1, max + 1, max - 0.5, true, null, [max], '1e1', '']) {
      assert.equal(normalizeInteractionAppearanceValue(key, invalid), null, `${key}: ${invalid}`);
    }
  }
  for (const key of ['interactionShowStatus', 'interactionShowParticipants']) {
    for (const value of [true, false, 'true', 'false'])
      assert.equal(normalizeInteractionAppearanceValue(key, value), String(value));
    for (const invalid of [0, 1, null, '', 'yes', ['true']])
      assert.equal(normalizeInteractionAppearanceValue(key, invalid), null);
    assert.equal(readInteractionAppearance({ [key]: false })[key], 'false');
  }
});

test('rating rules preserve arbitrary manual line breaks, plain markup and blank content', () => {
  const text = '第一条\r\n\r\n  第二条\n<img src=x>\n第三条\n第四条\n第五条';
  const expected = '第一条\n\n  第二条\n<img src=x>\n第三条\n第四条\n第五条';
  assert.equal(normalizeInteractionAppearanceValue('interactionRatingRules', text), expected);
  assert.equal(readInteractionAppearance({ interactionRatingRules: text }).interactionRatingRules, expected);
  assert.equal(readInteractionAppearance({ interactionRatingRules: '' }).interactionRatingRules, '');
  assert.equal(
    readInteractionAppearance().interactionRatingRules,
    INTERACTION_APPEARANCE_DEFAULTS.interactionRatingRules,
  );
});

test('appearance is projected to interactions HTTP and WS state without exposing private or foreign settings', () => {
  const settings = {
    ...INTERACTION_APPEARANCE_DEFAULTS,
    interactionOverlayTitle: '自定义',
    aiApiKey: 'private',
    roomId: 'private',
    clockLabel: 'foreign',
  };
  const expected = { ...INTERACTION_APPEARANCE_DEFAULTS, interactionOverlayTitle: '自定义' };
  assert.deepEqual(projectOverlayState('interactions', { settings }), { settings: expected });
  assert.deepEqual(
    projectWebSocketPayload(
      { type: 'overlay', scope: 'interactions' },
      {
        type: 'snapshot',
        reason: 'settings',
        state: { settings },
      },
    ).state,
    { settings: expected },
  );
  for (const scope of ['queue', 'games', 'clock', 'danmaku', 'lyrics']) {
    const projected = projectOverlayState(scope, { settings }).settings;
    for (const key of Object.keys(INTERACTION_APPEARANCE_DEFAULTS))
      assert.equal(projected?.[key], undefined, `${scope}: ${key}`);
  }
});
