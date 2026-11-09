const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { createDanmakuPreviewItems } = require('../../public/js/overlays/danmaku-preview-samples.js');

test('preview samples reference only bundled local images', () => {
  for (const item of createDanmakuPreviewItems()) {
    for (const url of [item.avatarUrl, item.giftImageUrl, ...(item.emotes || []).map(emote => emote.url)].filter(Boolean)) {
      assert.ok(url.startsWith('/img/'));
      assert.ok(fs.existsSync(path.join(__dirname, '../../public', url)), url);
    }
  }
});

test('preview message kinds reuse eight consistent viewer profiles', (t) => {
  let random = 0;
  t.mock.method(Math, 'random', () => random);
  const viewers = new Map(createDanmakuPreviewItems('twitter').slice(0, 8).map(item => [item.name, item]));
  const selectedViewers = new Map();
  assert.equal(viewers.size, 8);
  for (random = 0; random < 1; random += 0.125) {
    for (const item of createDanmakuPreviewItems('twitter')) {
      const viewer = viewers.get(item.name);
      assert.ok(viewer, 'every message uses one of the eight viewers');
      assert.equal(item.uid, viewer.uid);
      assert.ok(item.avatarUrl);
      assert.equal(item.avatarUrl, viewer.avatarUrl);
      assert.equal(item.roomGuardLevel, viewer.roomGuardLevel);
      if (item.giftGuardLevel) {
        assert.equal(item.roomGuardLevel, item.giftGuardLevel);
      }
      if (!item.id.match(/^preview-\d+$/u)) {
        if (!selectedViewers.has(item.id)) selectedViewers.set(item.id, { names: new Set(), count: item.giftGuardLevel ? 2 : 8 });
        selectedViewers.get(item.id).names.add(item.name);
      }
    }
  }
  assert.equal(new Set([...viewers.values()].map(viewer => viewer.avatarUrl)).size, 4);
  for (const { names, count } of selectedViewers.values()) assert.equal(names.size, count, 'each message draws from all eligible viewers');
});

test('preview instances do not share mutable messages, emotes or room medals', () => {
  const first = createDanmakuPreviewItems('prismatic');
  const second = createDanmakuPreviewItems('prismatic');
  const medalName = second[0].roomMedal.name;
  first[0].message = '已修改';
  first[0].emotes[0].url = '';
  first[0].roomMedal.name = '已修改';
  assert.notEqual(second[0].message, '已修改');
  assert.ok(second[0].emotes[0].url);
  assert.equal(second[0].roomMedal.name, medalName);
  assert.ok(first[1].emotes[0].url);
});
