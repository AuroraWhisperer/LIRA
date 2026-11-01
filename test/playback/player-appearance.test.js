'use strict';

const assert = require('node:assert/strict');
const path = require('node:path');
const test = require('node:test');
const { loadModuleExports } = require('../helpers/frontend-modules');

const modulePath = path.resolve(__dirname, '../../public/js/playback/ui/appearance.js');

test('missing or damaged appearance preferences keep the existing player defaults without rewriting storage', async () => {
  const { readPlayerAppearance, DEFAULT_PLAYER_APPEARANCE } = await loadModuleExports(modulePath);
  for (const stored of ['{broken', '[]']) {
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
  assert.doesNotMatch(invalid.backgroundColor, /url/);
  assert.notEqual(invalid.fontFamily, 'arbitrary-css');
  assert.equal(invalid.titleSize, 200);
  assert.equal(invalid.artistSize, 8);
});

test('failed local writes are reported and leave the prior saved appearance intact', async () => {
  const { savePlayerAppearance } = await loadModuleExports(modulePath);
  assert.equal(savePlayerAppearance({ setItem() { throw new Error('quota exceeded'); } }, { style: 'cover' }), false);
});

test('restoring default appearance removes custom typography and colors so client themes can take over', async () => {
  const { applyPlayerAppearance, normalizePlayerAppearance, DEFAULT_PLAYER_APPEARANCE } = await loadModuleExports(modulePath);
  const variables = new Map();
  const root = { dataset: {}, style: { setProperty: (key, value) => variables.set(key, value), removeProperty: (key) => variables.delete(key) } };
  applyPlayerAppearance(root, normalizePlayerAppearance({ textColors: 'custom',
    titleColor: '#abcdef', titleSize: 64, lyricFontFamily: 'maiyuan' }));
  assert.equal(variables.get('--player-title-color'), '#abcdef');
  assert.equal(variables.get('--player-title-size'), '64px');
  applyPlayerAppearance(root, DEFAULT_PLAYER_APPEARANCE);
  for (const key of ['--player-title-color', '--player-title-size', '--player-lyric-font']) {
    assert.equal(variables.has(key), false, `${key} should inherit the default`);
  }
});

test('old preferences inherit their song font while new typography preserves fractional values across reloads', async () => {
  const { readPlayerAppearance, savePlayerAppearance, normalizePlayerAppearance } = await loadModuleExports(modulePath);
  const old = normalizePlayerAppearance({ fontFamily: 'kai', lyricSize: 40 });
  assert.equal(old.fontFamily, 'kai');
  assert.equal(old.lyricFontFamily, 'inherit');
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
  const style = 'vinyl-arm';
  let stored = JSON.stringify({ style, rotation: false, artworkSize: 80 });
  const storage = { getItem: () => stored, setItem: (key, value) => { stored = value; } };
  for (const layout of ['lyrics', 'classic']) {
    savePlayerAppearance(storage, { ...readPlayerAppearance(storage), layout });
    const saved = readPlayerAppearance(storage);
    assert.equal(saved.layout, layout);
    assert.equal(saved.style, style);
    assert.equal(saved.rotation, false);
    assert.equal(saved.artworkSize, 80);
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
  applyPlayerAppearance(root, normalizePlayerAppearance({ lyricFontFamily: '"幼圆"' }));
  assert.match(variables.get('--player-lyric-font'), /^"幼圆", /);
});

test('expanded typography endpoints survive saving', async () => {
  const { readPlayerAppearance, savePlayerAppearance } = await loadModuleExports(modulePath);
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
});
