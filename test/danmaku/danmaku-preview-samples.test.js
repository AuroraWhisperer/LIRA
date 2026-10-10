const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { createDanmakuPreviewItems, DANMAKU_PREVIEW_ENTRY } = require('../../public/js/overlays/danmaku-preview-samples.js');

test('preview nicknames use ordinary Bilibili characters and cover short and 16-character names', () => {
  const samples = createDanmakuPreviewItems();
  for (const item of [...samples, DANMAKU_PREVIEW_ENTRY]) {
    assert.match(item.name, /^[\u4e00-\u9fffA-Za-z0-9_-]{2,16}$/u, item.id);
  }
  for (const kind of [undefined, 'gift', 'superchat']) {
    const names = samples.filter(item => item.kind === kind).map(item => item.name);
    assert.ok(names.some(name => name.length <= 3), `${kind || 'chat'}: short nickname`);
    assert.ok(names.some(name => name.length === 16), `${kind || 'chat'}: maximum-length nickname`);
  }
  assert.ok(samples.some(item => /^[A-Za-z0-9_-]{16}$/u.test(item.name)), 'long Latin nickname');
  for (const gift of samples.filter(item => item.giftGuardLevel)) {
    assert.equal(samples.find(item => item.guardLevel === gift.giftGuardLevel).name, gift.name);
  }
});

test('both preview voices cover short, long and repeated chat and SC within 40 characters', () => {
  const samples = createDanmakuPreviewItems();
  assert.equal(new Set(samples.map(item => item.id)).size, samples.length);
  for (const item of samples) {
    const length = Array.from(item.message).length;
    assert.ok(length > 0 && length <= 40, `${item.id}: ${length} characters`);
  }
  for (const tone of ['anime', 'everyday']) {
    for (const kind of ['chat', 'superchat']) {
      const messages = samples.filter(item => item.id.startsWith(`preview-${kind}-`) && item.id.includes(tone))
        .map(item => item.message);
      assert.ok(messages.some(text => Array.from(text).length <= 8), `${tone} ${kind}: short`);
      assert.ok(messages.some(text => Array.from(text).length >= 36 && !/^(.+?)\1{3,}$/u.test(text)), `${tone} ${kind}: long prose`);
      assert.ok(messages.some(text => Array.from(text).length >= 36 && /^(.+?)\1{3,}$/u.test(text)), `${tone} ${kind}: repeated`);
    }
    assert.deepEqual(samples.filter(item => item.kind === 'superchat' && item.id.endsWith(tone)).map(item => item.price),
      [2, 30, 50, 100, 500, 1000, 2000]);
  }
});

test('preview pool includes inline emotes, mixed text, stickers and distinct gift values and guard tiers', () => {
  const samples = createDanmakuPreviewItems();
  const emotes = samples.filter(item => item.emotes?.length);
  assert.ok(emotes.some(item => item.emotes[0].kind === 'inline' && item.message === item.emotes[0].text));
  assert.ok(emotes.some(item => item.emotes[0].kind === 'inline' && item.message === item.emotes[0].text.repeat(5)));
  assert.ok(emotes.some(item => item.emotes[0].kind === 'inline' && item.message.replaceAll(item.emotes[0].text, '').trim()));
  assert.ok(emotes.some(item => item.emotes[0].kind === 'sticker' && item.message === item.emotes[0].text));
  for (const item of samples) {
    for (const url of [item.avatarUrl, item.giftImageUrl, ...(item.emotes || []).map(emote => emote.url)].filter(Boolean)) {
      assert.ok(url.startsWith('/img/'));
      assert.ok(fs.existsSync(path.join(__dirname, '../../public', url)), url);
    }
  }
  const gifts = samples.filter(item => item.kind === 'gift' && !item.giftGuardLevel);
  assert.ok(new Set(gifts.map(item => item.giftName)).size >= 3);
  assert.ok(gifts.some(item => item.giftTotalPrice < 1));
  assert.ok(gifts.some(item => item.giftTotalPrice >= 10 && item.giftTotalPrice < 100));
  assert.ok(gifts.some(item => item.giftTotalPrice >= 100));
  assert.ok(gifts.some(item => item.giftTotalPrice >= 1000));
  const guards = samples.filter(item => item.giftGuardLevel);
  assert.deepEqual(guards.map(item => item.giftGuardLevel).sort(), [1, 2, 3]);
  assert.ok(guards.every(item => item.giftTotalPrice > 0 && item.message.includes(item.giftName)));
  assert.deepEqual(new Set(guards.map(item => item.guardAction)), new Set(['open', 'renew']));
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
