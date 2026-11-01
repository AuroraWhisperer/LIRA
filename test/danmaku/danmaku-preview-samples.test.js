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

test('preview instances do not share mutable messages, emotes or room medals', () => {
  const first = createDanmakuPreviewItems('prismatic');
  const second = createDanmakuPreviewItems('prismatic');
  first[0].message = '已修改';
  first[0].emotes[0].url = '';
  first[0].roomMedal.name = '已修改';
  assert.notEqual(second[0].message, '已修改');
  assert.ok(second[0].emotes[0].url);
  assert.equal(second[0].roomMedal.name, '粉丝团灯牌');
  assert.ok(first[1].emotes[0].url);
});
