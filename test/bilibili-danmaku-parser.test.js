'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');

const {
  extractBilibiliDanmakuAvatarUrl,
  extractBilibiliDanmakuEmotes,
} = require('../src/bilibili/parsers/danmaku-parser');

function createInfo(user) {
  const info = [];
  info[0] = Array(16).fill(null);
  info[0][15] = { user };
  return info;
}

test('danmaku avatar parser reads the live room user face', () => {
  const avatarUrl = 'https://i0.hdslb.com/bfs/face/example.webp';

  assert.equal(
    extractBilibiliDanmakuAvatarUrl(createInfo({ face: avatarUrl })),
    avatarUrl,
  );
});

test('danmaku avatar parser supports the nested base face field', () => {
  const avatarUrl = 'https://i1.hdslb.com/bfs/face/example.jpg';

  assert.equal(
    extractBilibiliDanmakuAvatarUrl(createInfo({ base: { face: avatarUrl } })),
    avatarUrl,
  );
});

test('danmaku avatar parser supports JSON encoded user metadata', () => {
  const avatarUrl = 'https://i2.hdslb.com/bfs/face/encoded.jpg';
  const info = [];
  info[0] = Array(16).fill(null);
  info[0][15] = JSON.stringify({ user: { base: { face: avatarUrl } } });

  assert.equal(extractBilibiliDanmakuAvatarUrl(info), avatarUrl);
});

test('danmaku avatar parser upgrades official HTTP avatars and rejects other hosts', () => {
  assert.equal(
    extractBilibiliDanmakuAvatarUrl(
      createInfo({ face: 'http://i0.hdslb.com/bfs/face/example.jpg' }),
    ),
    'https://i0.hdslb.com/bfs/face/example.jpg',
  );
  assert.equal(
    extractBilibiliDanmakuAvatarUrl(
      createInfo({ face: 'https://example.com/avatar.jpg' }),
    ),
    '',
  );
  assert.equal(
    extractBilibiliDanmakuAvatarUrl(
      createInfo({ face: 'https://hdslb.com/avatar.jpg' }),
    ),
    '',
  );
});

test('danmaku emote parser reads inline emotes from JSON encoded extra metadata', () => {
  const info = createInfo({ face: 'https://i0.hdslb.com/bfs/face/viewer.jpg' });
  info[0][15].extra = JSON.stringify({
    emots: {
      '[妙]': {
        emotion_unique: 'emoji_1',
        url: 'https://i0.hdslb.com/bfs/emote/miao.png',
        width: 64,
        height: 64,
      },
    },
  });

  assert.deepEqual(extractBilibiliDanmakuEmotes(info), [
    {
      text: '[妙]',
      url: 'https://i0.hdslb.com/bfs/emote/miao.png',
      width: 64,
      height: 64,
      kind: 'inline',
    },
  ]);
});

test('danmaku emote kind follows its source even when the message contains only one small emote', () => {
  const image = { url: 'https://i0.hdslb.com/bfs/emote/cheer.png', width: 192, height: 192 };
  for (const extra of [false, true]) {
    for (const [field, value, kind] of [
      ['emots', { '[喝彩]': image }, 'inline'],
      ['emoticon', image, 'sticker'],
    ]) {
      const info = createInfo({});
      info[1] = '[喝彩]';
      const options = { [field]: value };
      info[0][15] = extra ? { extra: JSON.stringify(options) } : options;
      assert.equal(extractBilibiliDanmakuEmotes(info)[0].kind, kind);
    }
  }
});

test('danmaku emote parser reads whole-message emoticons and upgrades trusted HTTP images', () => {
  const info = createInfo({});
  info[1] = '[打call]';
  info[0][15].emoticon = {
    text: '[打call]',
    url: 'http://i1.hdslb.com/bfs/emote/call.gif',
    width: 180,
    height: 90,
  };

  assert.deepEqual(extractBilibiliDanmakuEmotes(info), [
    {
      text: '[打call]',
      url: 'https://i1.hdslb.com/bfs/emote/call.gif',
      width: 180,
      height: 90,
      kind: 'sticker',
    },
  ]);
});

test('danmaku emote parser reads whole-message images from metadata slot 13', () => {
  const emoticon = {
    url: 'http://i0.hdslb.com/bfs/emote/whole.gif',
    width: 180,
    height: 90,
  };
  for (const value of [emoticon, JSON.stringify(emoticon)]) {
    const metadata = Array(14).fill(null);
    metadata[13] = value;
    assert.deepEqual(extractBilibiliDanmakuEmotes([metadata, '[整张表情]']), [
      {
        text: '[整张表情]',
        url: 'https://i0.hdslb.com/bfs/emote/whole.gif',
        width: 180,
        height: 90,
        kind: 'sticker',
      },
    ]);
  }
});

test('metadata slot 13 preserves existing emote precedence and image restrictions', () => {
  const info = createInfo({});
  info[1] = '[整张表情]';
  info[0][13] = {
    url: 'https://i0.hdslb.com/bfs/emote/whole.png',
    width: 180,
    height: 90,
  };
  info[0][15].extra = JSON.stringify({
    emoticon: {
      url: 'https://i1.hdslb.com/bfs/emote/preferred.webp',
      width: 64,
      height: 32,
    },
  });
  assert.deepEqual(extractBilibiliDanmakuEmotes(info), [
    {
      text: '[整张表情]',
      url: 'https://i1.hdslb.com/bfs/emote/preferred.webp',
      width: 64,
      height: 32,
      kind: 'sticker',
    },
  ]);

  delete info[0][15].extra;
  for (const url of ['https://example.com/emote.png', 'javascript:alert(1)']) {
    info[0][13].url = url;
    assert.deepEqual(extractBilibiliDanmakuEmotes(info), []);
  }
  info[0][13] = '{invalid';
  assert.deepEqual(extractBilibiliDanmakuEmotes(info), []);
});

test('danmaku emote parser rejects untrusted images and deduplicates trigger text', () => {
  const info = createInfo({});
  info[0][15].emots = {
    '[安全]': {
      url: 'https://i0.hdslb.com/bfs/emote/safe.webp',
      width: 40,
      height: 40,
    },
    '[坏]': { url: 'https://example.com/bad.png', width: 40, height: 40 },
  };
  info[0][15].extra = JSON.stringify({
    emots: {
      '[安全]': {
        url: 'https://i1.hdslb.com/bfs/emote/duplicate.webp',
        width: 80,
        height: 80,
      },
    },
  });

  assert.deepEqual(extractBilibiliDanmakuEmotes(info), [
    {
      text: '[安全]',
      url: 'https://i0.hdslb.com/bfs/emote/safe.webp',
      width: 40,
      height: 40,
      kind: 'inline',
    },
  ]);
});
