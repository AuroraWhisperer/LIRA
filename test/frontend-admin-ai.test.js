'use strict';

const { readAdminHtml } = require('./helpers/admin-html');

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const { NUMBER_LIMITS } = require('../src/ai/config');
const { loadModuleExports } = require('./helpers/frontend-modules');

const ROOT_DIR = path.join(__dirname, '..');

test('AI form number constraints match the server contract', () => {
  const html = readAdminHtml();
  const fieldIds = {
    replyMaxChars: 'xiaomiAiReplyMaxChars',
    generationConcurrency: 'xiaomiAiConcurrency',
    userCooldownSeconds: 'xiaomiAiUserCooldown',
    roomLimitPerMinute: 'xiaomiAiRoomLimit',
  };

  for (const [key, id] of Object.entries(fieldIds)) {
    const input = html.match(
      new RegExp(`<input\\b(?=[^>]*\\bid=["']${id}["'])[^>]*>`, 's'),
    )?.[0];
    assert.ok(input, `${id} should exist`);
    assert.equal(
      Number(input.match(/\bmin\s*=\s*["']([^"']+)["']/)?.[1]),
      NUMBER_LIMITS[key][0],
    );
    assert.equal(
      Number(input.match(/\bmax\s*=\s*["']([^"']+)["']/)?.[1]),
      NUMBER_LIMITS[key][1],
    );
  }
  assert.equal((html.match(/\bdata-ai-secret\b/g) || []).length, 3);
});

test('admin page uses one ordered module entrypoint', () => {
  const html = readAdminHtml();
  const entrySource = fs.readFileSync(
    path.join(ROOT_DIR, 'public', 'js', 'admin', 'index.js'),
    'utf8',
  );

  assert.match(
    html,
    /<script type="module" src="\/js\/admin\/index\.js\?v=[^"]+"><\/script>/,
  );
  assert.doesNotMatch(html, /<script[^>]+src="\/js\/admin\/queue\.js/);

  const giftModulePaths = [
    './gifts/notification.js',
    './gifts/detection.js',
    './gifts/sprint.js',
    './gifts/recent.js',
    './gifts/blindbox.js',
    './gifts/blindbox-analysis.js',
    './gifts/history.js',
  ];
  const giftIndexPosition = entrySource.indexOf("import './gifts/index.js';");
  assert.ok(giftIndexPosition > -1, 'gift index import should remain present');
  for (const modulePath of giftModulePaths) {
    const modulePosition = entrySource.indexOf(`import '${modulePath}';`);
    assert.ok(
      modulePosition > -1,
      `${modulePath} import should remain present`,
    );
    assert.ok(
      modulePosition < giftIndexPosition,
      `${modulePath} should load before the gift index`,
    );
  }

  const importLines = entrySource.match(/^import .+;$/gm) ?? [];
  assert.equal(importLines.at(-1), "import './app.js';");
});

test('parameter ranges use shared semantic variants without changing playback controls', async () => {
  const html = readAdminHtml();
  const styles = fs.readFileSync(
    path.join(ROOT_DIR, 'public', 'css', 'components', 'parameter-range.css'),
    'utf8',
  );
  const { getParameterRangeOrigin, getParameterRangeProgress } =
    await loadModuleExports(
      path.join(ROOT_DIR, 'public', 'js', 'shared', 'parameter-range.js'),
    );

  assert.equal(
    getParameterRangeProgress({ min: '0', max: '100', value: '25' }),
    25,
  );
  assert.equal(
    getParameterRangeProgress({ min: '-3000', max: '3000', value: '0' }),
    50,
  );
  const origin = (input) =>
    JSON.parse(JSON.stringify(getParameterRangeOrigin(input)));
  assert.deepEqual(origin({ min: '-20', max: '20', value: '-5' }), {
    zeroProgress: 50,
    startProgress: 37.5,
    lengthProgress: 12.5,
    polarity: 'negative',
  });
  assert.deepEqual(origin({ min: '-20', max: '20', value: '10' }), {
    zeroProgress: 50,
    startProgress: 50,
    lengthProgress: 25,
    polarity: 'positive',
  });
  assert.deepEqual(origin({ min: '-20', max: '20', value: '0' }), {
    zeroProgress: 50,
    startProgress: 50,
    lengthProgress: 0,
    polarity: 'neutral',
  });

  const expectedVariants = {
    tempo: [
      'queueScrollSpeedRange',
      'identityQueueScrollSpeedRange',
      'scrollSecondsRange',
    ],
    scale: [
      'queueSongFontSize',
      'queueTitleFontSize',
      'identityQueueFontSize',
      'overlayRuleFontSize',
      'songBoardFontSize',
      'songBoardSongFontSize',
      'songBoardTitleFontSize',
      'desktopLyricFontSize',
      'desktopLyricLineHeight',
      'desktopLyricStrokeWidth',
      'desktopLyricShadowBlur',
      'desktopLyricTranslationScale',
      'desktopLyricScale',
      'desktopLyricAlignPosition',
      'desktopLyricPerspective',
    ],
    intensity: [
      'themeOpacity',
      'backdropBlur',
      'glowIntensity',
      'songBoardBackdropBlur',
      'songBoardGlowIntensity',
      'songBoardThemeOpacity',
      'desktopLyricShadowIntensity',
      'desktopLyricOpacity',
      'desktopLyricBaseOpacity',
      'desktopLyricTranslationOpacity',
      'desktopLyricBgOpacity',
      'desktopLyricGlobalOpacity',
      'desktopLyricBrightness',
      'desktopLyricContrast',
      'desktopLyricSaturation',
    ],
    centered: [
      'desktopLyricLetterSpacing',
      'desktopLyricShadowOffsetX',
      'desktopLyricShadowOffsetY',
      'desktopLyricInterludeOffsetEm',
      'desktopLyricTimeOffsetMs',
      'desktopLyricTranslateX',
      'desktopLyricTranslateY',
      'desktopLyricRotateX',
      'desktopLyricRotateY',
      'weSingLyricOffsetMs',
    ],
  };
  for (const [variant, ids] of Object.entries(expectedVariants)) {
    assert.match(
      styles,
      new RegExp(
        `\\.parameter-range--${variant}\\s*\\[\\s*type\\s*=\\s*['"]range['"]\\s*\\]`,
      ),
    );
    for (const id of ids) {
      assert.match(
        html,
        new RegExp(
          `id="${id}"\\s+class="parameter-range parameter-range--${variant}"\\s+type="range"`,
        ),
      );
    }
  }
  assert.doesNotMatch(html, /id="playbackSeek" class="parameter-range"/);
  assert.doesNotMatch(html, /id="playbackVolume" class="[^\"]*parameter-range/);
  assert.match(
    styles,
    /\.parameter-range\s*\[\s*type\s*=\s*['"]range['"]\s*\]/,
  );
  assert.match(styles, /--parameter-range-thumb-radius: 50%/);
  assert.match(styles, /--parameter-range-thumb-radius: 999px/);
  assert.match(styles, /--parameter-range-thumb-height: 16px/);
  assert.match(styles, /--parameter-range-thumb-height: 18px/);
  assert.doesNotMatch(styles, /repeating-linear-gradient/);
  assert.doesNotMatch(styles, /rotate\(|0 0 0 7px|radial-gradient\(circle at/);
  for (const color of ['#e77f68', '#6674d5', '#38ad96', '#c97595']) {
    assert.match(styles, new RegExp(color));
  }
});

test('admin form refresh does not overwrite the field currently being edited', () => {
  const source = fs.readFileSync(
    path.join(ROOT_DIR, 'public', 'js', 'admin', 'forms.js'),
    'utf8',
  );

  assert.match(
    source,
    /if\s*\(\s*element && element !== document\.activeElement\s*\)\s*element\.value = inputValue;/,
  );
});
