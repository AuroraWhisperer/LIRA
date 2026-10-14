'use strict';

const assert = require('node:assert/strict');
const path = require('node:path');
const test = require('node:test');
const { loadModuleExports } = require('../helpers/frontend-modules');

const modulePath = path.resolve(__dirname, '../../public/js/playback/ui/appearance.js');

test('missing or damaged appearance preferences keep the existing player defaults without rewriting storage', async () => {
  const { readPlayerAppearance, DEFAULT_PLAYER_APPEARANCE } = await loadModuleExports(modulePath);
  for (const stored of [null, '{broken', 'null', '[]', '42']) {
    let writes = 0;
    const result = readPlayerAppearance({ getItem: () => stored, setItem() { writes++; } });
    assert.deepEqual(result, DEFAULT_PLAYER_APPEARANCE);
    assert.equal(writes, 0);
  }
  assert.deepEqual(readPlayerAppearance({ getItem() { throw new Error('storage blocked'); } }), DEFAULT_PLAYER_APPEARANCE);
});

test('appearance restores supported settings and only persists bounded, known fields', async () => {
  const { readPlayerAppearance, savePlayerAppearance, normalizePlayerAppearance, PLAYER_APPEARANCE_KEY } = await loadModuleExports(modulePath);
  let stored;
  const storage = {
    setItem(key, value) { assert.equal(key, PLAYER_APPEARANCE_KEY); stored = value; },
    getItem(key) { assert.equal(key, PLAYER_APPEARANCE_KEY); return stored; },
  };
  const input = {
    layout: 'vinyl', style: 'vinyl-arm', artworkSize: 90, rotation: false, backgroundMode: 'gradient', backgroundColor: '#AABBCC80',
    gradientColor: '#123456', fontFamily: 'serif', titleSize: 58, artistSize: 24, lyricSize: 40,
    textColors: 'custom', titleColor: '#123456', textAlign: 'center', backgroundOpacity: 80, unrelated: 'drop',
  };
  assert.equal(savePlayerAppearance(storage, input), true);
  assert.deepEqual(readPlayerAppearance(storage), normalizePlayerAppearance(input));
  assert.equal(readPlayerAppearance(storage).backgroundColor, '#aabbcc80');
  assert.equal(Object.hasOwn(JSON.parse(stored), 'unrelated'), false);
  const invalid = normalizePlayerAppearance({ layout: 'unknown', style: 'unknown', backgroundColor: 'url(https://invalid.test)',
    fontFamily: 'arbitrary-css', titleSize: 1000, artistSize: -1, lyricSize: null, artworkSize: NaN, rotation: 'false' });
  assert.equal(invalid.style, 'turntable');
  assert.equal(invalid.layout, 'classic');
  assert.equal(invalid.backgroundColor, '#fff1f4');
  assert.equal(invalid.fontFamily, 'system');
  assert.equal(invalid.titleSize, 200);
  assert.equal(invalid.artistSize, 8);
  assert.equal(invalid.lyricSize, 32);
  assert.equal(invalid.artworkSize, 100);
  assert.equal(invalid.rotation, true);
});

test('failed local writes are reported and leave the prior saved appearance intact', async () => {
  const { savePlayerAppearance } = await loadModuleExports(modulePath);
  assert.equal(savePlayerAppearance({ setItem() { throw new Error('quota exceeded'); } }, { style: 'cover' }), false);
});

test('restoring default appearance removes custom typography and colors so client themes can take over', async () => {
  const { applyPlayerAppearance, normalizePlayerAppearance, DEFAULT_PLAYER_APPEARANCE } = await loadModuleExports(modulePath);
  const variables = new Map();
  const root = { dataset: {}, style: { setProperty: (key, value) => variables.set(key, value), removeProperty: (key) => variables.delete(key) } };
  applyPlayerAppearance(root, normalizePlayerAppearance({ layout: 'lyrics', style: 'vinyl-arm', textColors: 'custom',
    titleColor: '#abcdef', titleSize: 64, lyricSize: 40, fontFamily: 'kai', lyricFontFamily: 'maiyuan',
    lyricLineHeight: 2, lyricLineGap: 40, lyricLetterSpacing: 2.5, lyricFontWeight: '400',
    backgroundMode: 'solid', rotation: false }));
  assert.equal(root.dataset.playerLayout, 'lyrics');
  assert.equal(root.dataset.playerStyle, 'vinyl-arm');
  assert.equal(root.dataset.playerBackground, 'solid');
  assert.equal(root.dataset.playerRotation, 'false');
  assert.equal(variables.get('--player-title-color'), '#abcdef');
  assert.equal(variables.get('--player-title-size'), '64px');
  assert.equal(variables.get('--player-active-lyric-size'), '45px');
  applyPlayerAppearance(root, DEFAULT_PLAYER_APPEARANCE);
  assert.equal(root.dataset.playerStyle, 'turntable');
  assert.equal(root.dataset.playerLayout, 'classic');
  assert.equal(root.dataset.playerBackground, 'auto');
  assert.equal(root.dataset.playerRotation, 'true');
  for (const key of ['--player-title-color', '--player-title-size', '--player-active-lyric-size', '--player-font',
    '--player-lyric-font', '--player-lyric-line-height', '--player-lyric-line-padding',
    '--player-lyric-letter-spacing', '--player-lyric-weight']) {
    assert.equal(variables.has(key), false, `${key} should inherit the default`);
  }
});

test('old preferences inherit their song font while new typography preserves fractional values across reloads', async () => {
  const { readPlayerAppearance, savePlayerAppearance, normalizePlayerAppearance } = await loadModuleExports(modulePath);
  const old = normalizePlayerAppearance({ fontFamily: 'kai', lyricSize: 40 });
  assert.equal(old.layout, 'classic');
  assert.equal(old.fontFamily, 'kai');
  assert.equal(old.lyricFontFamily, 'inherit');
  assert.equal(old.lyricLineHeight, 1.4);
  assert.equal(old.activeLyricScale, 112.5);
  let stored;
  const storage = { getItem: () => stored, setItem: (key, value) => { stored = value; } };
  savePlayerAppearance(storage, { fontFamily: 'smiley', lyricFontFamily: '"幼圆"',
    lyricLineHeight: 1.8, lyricLineGap: 38, lyricLetterSpacing: 1.5, lyricFontWeight: '400', activeLyricScale: 125.5 });
  const saved = readPlayerAppearance(storage);
  assert.equal(saved.fontFamily, 'smiley');
  assert.equal(saved.lyricFontFamily, '"幼圆"');
  assert.equal(saved.lyricLineHeight, 1.8);
  assert.equal(saved.lyricLineGap, 38);
  assert.equal(saved.lyricLetterSpacing, 1.5);
  assert.equal(saved.activeLyricScale, 125.5);
  const bounded = normalizePlayerAppearance({ lyricLineHeight: 12, lyricLineGap: -20, lyricLetterSpacing: 1.7, activeLyricScale: 0 });
  assert.equal(bounded.lyricLineHeight, 4);
  assert.equal(bounded.lyricLineGap, 0);
  assert.equal(bounded.lyricLetterSpacing, 1.5);
  assert.equal(bounded.activeLyricScale, 100);
});

test('layout changes preserve artwork preferences, including when lyrics hides the artwork', async () => {
  const { readPlayerAppearance, savePlayerAppearance } = await loadModuleExports(modulePath);
  for (const style of ['turntable', 'vinyl', 'cover', 'vinyl-arm']) {
    let stored = JSON.stringify({ style, rotation: false, artworkSize: 80 });
    const storage = { getItem: () => stored, setItem: (key, value) => { stored = value; } };
    assert.equal(readPlayerAppearance(storage).layout, 'classic');
    for (const layout of ['vinyl', 'lyrics', 'classic']) {
      savePlayerAppearance(storage, { ...readPlayerAppearance(storage), layout });
      const saved = readPlayerAppearance(storage);
      assert.equal(saved.layout, layout);
      assert.equal(saved.style, style);
      assert.equal(saved.rotation, false);
      assert.equal(saved.artworkSize, 80);
    }
  }
});

test('font choices accept bundled fonts and one escaped local family without accepting CSS stacks or declarations', async () => {
  const { normalizePlayerAppearance, applyPlayerAppearance } = await loadModuleExports(modulePath);
  for (const value of ['maiyuan', 'kuaile', 'smiley', '"本机字体"', '"Family \\"Quoted\\""', '"Font \\\\ Path"']) {
    assert.equal(normalizePlayerAppearance({ lyricFontFamily: value }).lyricFontFamily, value);
  }
  for (const value of ['Arial', '"Arial", serif', '"Arial"; color: red', 'url(https://example.test/font)', '"line\nbreak"', {}, null]) {
    assert.equal(normalizePlayerAppearance({ lyricFontFamily: value }).lyricFontFamily, 'inherit');
  }
  const variables = new Map();
  const root = { dataset: {}, style: { setProperty: (key, value) => variables.set(key, value), removeProperty: (key) => variables.delete(key) } };
  applyPlayerAppearance(root, normalizePlayerAppearance({ fontFamily: 'smiley', lyricFontFamily: '"幼圆"', activeLyricScale: 100 }));
  assert.match(variables.get('--player-font'), /Lira Smiley/);
  assert.equal(variables.get('--player-lyric-font'), '"幼圆", "Microsoft YaHei", sans-serif');
  assert.equal(root.dataset.playerEmphasis, 'custom');
  assert.equal(variables.get('--player-active-lyric-scale'), '1');
});


test('expanded typography endpoints survive saving while defaults stay unchanged', async () => {
  const { readPlayerAppearance, savePlayerAppearance, DEFAULT_PLAYER_APPEARANCE } = await loadModuleExports(modulePath);
  let stored;
  const storage = { getItem: () => stored, setItem: (key, value) => { stored = value; } };
  for (const input of [
    { titleSize: 8, artistSize: 8, lyricSize: 8, lyricLineHeight: 0.8, lyricLineGap: 0, lyricLetterSpacing: -2, activeLyricScale: 100 },
    { titleSize: 200, artistSize: 120, lyricSize: 160, lyricLineHeight: 4, lyricLineGap: 200, lyricLetterSpacing: 24, activeLyricScale: 300 },
  ]) {
    assert.equal(savePlayerAppearance(storage, input), true);
    const result = readPlayerAppearance(storage);
    for (const [key, value] of Object.entries(input)) assert.equal(result[key], value, key);
  }
  assert.deepEqual(
    ['titleSize', 'artistSize', 'lyricSize', 'lyricLineHeight', 'lyricLineGap', 'activeLyricScale'].map((key) => DEFAULT_PLAYER_APPEARANCE[key]),
    [42, 20, 32, 1.4, 28, 112.5],
  );
});
