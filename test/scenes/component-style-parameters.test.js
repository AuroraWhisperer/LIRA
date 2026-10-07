const test = require('node:test');
const assert = require('node:assert/strict');
const parameters = require('../../public/js/shared/component-style-parameters.js');

test('effect parameters validate finite typed bounds and preserve old empty configurations', () => {
  const { normalizeStyleParameters, styleParameterDefaults } = parameters;
  assert.deepEqual(normalizeStyleParameters('clock', {}), {});
  const normalized = normalizeStyleParameters('clock', { peach: { shadow: { opacity: 0 } } });
  assert.deepEqual(normalized.peach.shadow, { ...styleParameterDefaults('shadow'), opacity: 0 });
  for (const input of [-1, 101, NaN, Infinity, '20', null, true]) {
    assert.throws(() => normalizeStyleParameters('clock', { peach: { shadow: { opacity: input } } }),
      { code: 'INVALID_STYLE_PARAMETERS' });
  }
  for (const input of [{ black: 255 }, { black: 100, white: 100 }, { gamma: 0 }, { outputBlack: 50, outputWhite: 20 }]) {
    assert.throws(() => normalizeStyleParameters('danmaku', { glow: { levels: input } }));
  }
  for (const input of [{ unknown: {} }, { peach: { unknown: {} } }, JSON.parse('{"__proto__":{}}'), { peach: { shadow: { url: 'x' } } }]) {
    assert.throws(() => normalizeStyleParameters('clock', input));
  }
  assert.throws(() => normalizeStyleParameters('clock', { peach: { showEntryMessages: true } }));
  assert.deepEqual(normalizeStyleParameters('danmaku', { glow: { showEntryMessages: false } }), { glow: { showEntryMessages: false } });
});

test('each instance and imported style remembers its own settings without mutating another style', () => {
  const { editStyleParameter, styleParametersFor, componentStyleKey } = parameters;
  const original = { style: 'peach', styleParameters: { peach: { shadow: { opacity: 10 } } } };
  const first = { ...original, ...editStyleParameter(original, 'shadow', { opacity: 60 }) };
  assert.equal(styleParametersFor(original).shadow.opacity, 10);
  assert.equal(styleParametersFor(first).shadow.opacity, 60);
  const switched = { ...first, style: 'digital' };
  assert.deepEqual(styleParametersFor(switched), {});
  const edited = { ...switched, ...editStyleParameter(switched, 'textOutline', { width: 2 }) };
  assert.equal(styleParametersFor({ ...edited, style: 'peach' }).shadow.opacity, 60);
  const css = { ...edited, cssStyle: { id: '11111111-2222-4333-8444-555555555555' } };
  assert.equal(componentStyleKey(css), 'css:11111111-2222-4333-8444-555555555555');
  assert.deepEqual(styleParametersFor(css), {});
  assert.equal(componentStyleKey({ url: '/component-web/11111111-2222-4333-8444-555555555555/index.html' }),
    'web:11111111-2222-4333-8444-555555555555');
  assert.deepEqual(editStyleParameter(first, 'shadow', null).styleParameters.peach, {});
});

test('capabilities follow the concrete artwork, including transparent frames and imported web boundaries', () => {
  const { styleParameterCapabilities: capabilities } = parameters;
  for (const style of ['peach', 'starlight', 'soda', 'flip', 'moonlit-fan']) {
    assert.ok(capabilities('clock', { style }).includes('innerShadow'));
  }
  for (const style of ['digital', 'timeline-horizontal', 'timeline-vertical', 'orbit']) {
    assert.ok(!capabilities('clock', { style }).includes('innerShadow'));
  }
  assert.ok(capabilities('danmaku', { style: 'whiteframe' }).includes('outline'));
  assert.ok(!capabilities('danmaku', { style: 'whiteframe' }).includes('innerShadow'));
  assert.ok(!capabilities('danmaku', { style: 'comet' }).includes('innerGlow'));
  assert.ok(capabilities('danmaku', { cssStyle: { engine: 'blc' } }).includes('textOutline'));
  const html = capabilities('browser');
  assert.ok(html.includes('shadow') && html.includes('transform'));
  assert.ok(!html.includes('whiteBalance') && !html.includes('bloom') && !html.includes('levels'));
  assert.ok(!html.includes('textOutline') && !html.includes('innerShadow'));
});

test('clock storage, scene instances and public output roundtrip only validated display parameters', () => {
  const { getClockConfig, normalizeClockSettingValue } = require('../../src/server/clock-contract');
  const { normalizeSceneConfig } = require('../../src/server/scene-components');
  const { projectOverlayResponse } = require('../../src/server/overlay-projection');
  const { clockSettingsPayload, clockConfigFromSettings } = require('../../public/js/shared/clock-settings.js');
  const { assertClockRoundTrip } = require('../helpers/clock-round-trip');
  const styleParameters = parameters.normalizeStyleParameters('clock', { peach: { shadow: { opacity: 50 } } });
  const json = normalizeClockSettingValue('clockStyleParameters', JSON.stringify(styleParameters));
  const config = getClockConfig({ clockStyleParameters: json });
  assert.deepEqual(config.styleParameters, styleParameters);
  assertClockRoundTrip(config);
  assert.deepEqual(clockConfigFromSettings(clockSettingsPayload(config)).styleParameters, styleParameters);
  assert.equal(normalizeClockSettingValue('clockStyleParameters', '{"peach":{"token":"private"}}'), null);
  const invalid = { ...config, styleParameters: { peach: { token: 'private' } } };
  assert.throws(() => normalizeSceneConfig('clock', invalid));
  assert.equal(projectOverlayResponse('clock', '/api/clock/config', invalid).styleParameters, undefined);
  const browser = { url: 'https://example.com/overlay', viewportWidth: 800, viewportHeight: 600,
    styleParameters: { browser: { transform: { rotateZ: 15 } } } };
  assert.equal(normalizeSceneConfig('browser', browser).styleParameters.browser.transform.rotateZ, 15);
  assert.equal(require('../../public/js/shared/scene-browser-source.js').normalizeBrowserSourceConfig(browser)
    .styleParameters.browser.transform.rotateZ, 15);
});

test('browser and privileged display contracts stay identical', () => {
  const common = require('../../src/shared/component-style-parameters');
  assert.deepEqual(common.STYLE_PARAMETER_GROUPS, parameters.STYLE_PARAMETER_GROUPS);
  assert.deepEqual(common.STYLE_PARAMETER_CAPABILITIES, parameters.STYLE_PARAMETER_CAPABILITIES);
  const input = { glow: { shadow: { blur: 20 }, transform: { rotateX: 20 }, showEntryMessages: true } };
  assert.deepEqual(common.normalizeStyleParameters('danmaku', input), parameters.normalizeStyleParameters('danmaku', input));
});

test('preview relay accepts validated optional effects on old clock and danmaku drafts only', () => {
  const { createComponentPreviewSessions } = require('../../src/server/component-preview-sessions');
  const sessions = createComponentPreviewSessions();
  try {
    for (const component of ['clock', 'danmaku', 'queue']) {
      const style = component === 'clock' ? 'peach' : 'signal';
      const draft = { style };
      const state = { draft, saved: draft, generation: 0, loaded: true };
      const session = sessions.open({ component, state });
      const edit = change => sessions.browser({ id: session.id, action: 'edit', change }, session.token);
      if (component === 'queue') {
        assert.throws(() => edit({ styleParameters: {} }), { statusCode: 400 });
        continue;
      }
      assert.throws(() => edit({ styleParameters: { [style]: { shadow: { blur: 100 } } } }), { code: 'INVALID_STYLE_PARAMETERS' });
      assert.throws(() => edit({ unrelated: true }), { statusCode: 400 });
      edit({ styleParameters: { [style]: { shadow: { blur: 24 } } } });
      const commands = sessions.exchange({ id: session.id, state, ack: 0 }).commands;
      assert.equal(commands.length, 1);
      assert.equal(commands[0].change.styleParameters[style].shadow.blur, 24);
    }
  } finally { sessions.clear(); }
});
