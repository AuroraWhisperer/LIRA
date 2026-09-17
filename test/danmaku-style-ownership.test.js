'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const ROOT_DIR = path.join(__dirname, '..');

test('danmaku styles keep base, named style, and motion ownership', () => {
  const styleRoot = path.join(ROOT_DIR, 'public', 'css', 'overlays');
  const entry = fs.readFileSync(path.join(styleRoot, 'danmaku.css'), 'utf8');
  const expectedImports = [
    "@import url('./danmaku/base.css');",
    "@import url('./danmaku/gifts.css');",
    "@import url('./danmaku/signal.css');",
    "@import url('./danmaku/bubble.css');",
    "@import url('./danmaku/minimal.css');",
    "@import url('./danmaku/ranked.css');",
    "@import url('./danmaku/transparent.css');",
    "@import url('./danmaku/identity.css');",
    "@import url('./danmaku/outline.css');",
    "@import url('./danmaku/cream.css');",
    "@import url('./danmaku/motion.css');",
    "@import url('./danmaku/preview.css');",
  ];
  assert.deepEqual(entry.match(/@import url\('[^']+'\);/g), expectedImports);

  const owners = Object.fromEntries(
    [
      'base',
      'signal',
      'bubble',
      'minimal',
      'ranked',
      'transparent',
      'identity',
      'outline',
      'cream',
      'motion',
    ].map((name) => [
      name,
      fs.readFileSync(path.join(styleRoot, 'danmaku', `${name}.css`), 'utf8'),
    ]),
  );

  assert.match(owners.base, /\.draw-danmaku-identity\s*\{/);
  assert.match(owners.base, /\.draw-danmaku-emote\s*\{/);
  assert.match(owners.base, /body\.is-preview/);
  assert.doesNotMatch(owners.base, /body\[data-style=/);
  assert.match(owners.signal, /body\[data-style='signal'\]/);
  assert.doesNotMatch(owners.signal, /body\[data-style='bubble'\]/);
  assert.match(owners.bubble, /body\[data-style='bubble'\]/);
  assert.doesNotMatch(owners.bubble, /body\[data-style='minimal'\]/);
  assert.match(owners.minimal, /body\[data-style='minimal'\]/);
  assert.doesNotMatch(owners.minimal, /body\[data-style='ranked'\]/);
  assert.match(owners.ranked, /body\[data-style='ranked'\]/);
  assert.doesNotMatch(owners.ranked, /body\[data-style='transparent'\]/);
  assert.match(owners.transparent, /body\[data-style='transparent'\]/);
  assert.doesNotMatch(owners.transparent, /body\[data-style='outline'\]/);
  assert.match(owners.outline, /body\[data-style='outline'\]/);
  assert.match(owners.identity, /body\[data-style='identity'\]/);
  assert.doesNotMatch(owners.identity, /body\[data-style='ranked'\]/);
  assert.doesNotMatch(owners.outline, /@keyframes/);
  assert.match(owners.motion, /@keyframes signalMessageIn/);
  assert.match(owners.motion, /@media \(max-width:\s*480px\)/);
  assert.match(owners.motion, /prefers-reduced-motion:\s*reduce/);
  assert.doesNotMatch(owners.motion, /body\[data-style=/);
  const giftAssets = new Set();
  for (const style of ['signal', 'bubble', 'minimal', 'ranked', 'transparent', 'identity', 'outline', 'cream']) {
    const asset = owners[style].match(/url\('(\/img\/overlays\/danmaku-gifts\/[^']+)'\)/)[1];
    const bytes = fs.readFileSync(path.join(ROOT_DIR, 'public', asset));
    if (asset.endsWith('.svg')) {
      assert.match(bytes.toString(), /<svg[^>]+viewBox=/);
      assert.doesNotMatch(bytes.toString(), /<script|<foreignObject/);
    }
    giftAssets.add(bytes.toString('base64'));
  }
  assert.equal(giftAssets.size, 8, 'each style has its own gift artwork');
});
