'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const { readAdminHtml } = require('../helpers/admin-html');
const { loadModuleExports } = require('../helpers/frontend-modules');

const ROOT_DIR = path.join(__dirname, '../..');

function tagById(html, id) {
  const tags = html.match(new RegExp(`<[^>]+\\sid\\s*=\\s*["']${id}["'][^>]*>`, 'g')) || [];
  assert.equal(tags.length, 1, `${id} should exist once`);
  return tags[0];
}

test('parameter ranges preserve centered values and leave playback controls independent', async () => {
  const html = readAdminHtml();
  const styles = fs.readFileSync(path.join(ROOT_DIR, 'public', 'css', 'components', 'parameter-range.css'), 'utf8');
  const { getParameterRangeOrigin, getParameterRangeProgress } = await loadModuleExports(
    path.join(ROOT_DIR, 'public', 'js', 'shared', 'parameter-range.js'),
  );

  assert.equal(getParameterRangeProgress({ min: '0', max: '100', value: '25' }), 25);
  assert.equal(getParameterRangeProgress({ min: '-3000', max: '3000', value: '0' }), 50);
  const origin = (input) => JSON.parse(JSON.stringify(getParameterRangeOrigin(input)));
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

  for (const id of [
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
  ]) {
    const input = tagById(html, id);
    assert.match(input, /^<input\b/);
    assert.match(input, /\stype=["']range["']/);
    const classes = input.match(/\sclass=["']([^"']*)["']/)?.[1].split(/\s+/) || [];
    assert.ok(classes.includes('parameter-range'));
    assert.ok(classes.includes('parameter-range--centered'));
  }
  for (const id of ['playbackSeek', 'playbackVolume']) {
    const classes = tagById(html, id).match(/\sclass=["']([^"']*)["']/)?.[1].split(/\s+/) || [];
    assert.equal(classes.includes('parameter-range'), false);
  }
  assert.match(styles, /var\(--parameter-range-origin-length\)/);
  assert.match(styles, /var\(--parameter-range-zero-position\)/);
  const focusRule = styles.match(/:focus-visible\s*\{([^}]+)\}/)?.[1];
  assert.ok(focusRule, 'keyboard focus has a visible indicator');
  const outline = focusRule.match(/(?:^|;)\s*outline\s*:\s*([^;]+)/)?.[1];
  assert.ok(outline);
  assert.doesNotMatch(outline, /\b(?:none|transparent)\b|^0(?:px)?(?:\s|$)/);
});
