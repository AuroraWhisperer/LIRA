'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { encryptQrc } = require('qrc-decoder');
const { QQMusicProvider } = require('../../src/music/providers/qq-provider');

const COOKIE =
  'qqmusic_uin=123456; qqmusic_key=test-key; qm_keyst=test-client-key; qqmusic_guid=987654321; tmeLoginType=2';

function createProvider() {
  return new QQMusicProvider({
    getAuthState: () => ({ loggedIn: true }),
    getCookieHeader: () => COOKIE,
  });
}

function encryptedQrc(text) {
  return encryptQrc(text);
}

function qrcXml(content) {
  return `<?xml version="1.0" encoding="utf-8"?>\n<QrcInfos><LyricInfo><Lyric_1 LyricType="1" LyricContent="${content}"/></LyricInfo></QrcInfos>`;
}

test('QQ provider keeps HTTP and authentication behind a focused client', () => {
  const { QQMusicClient } = require('../../src/music/providers/qq-provider-client');
  const provider = createProvider();

  assert.ok(provider instanceof QQMusicClient);
  assert.equal(typeof provider.requestJson, 'function');
  assert.equal(typeof provider.requireLogin, 'function');
});

test('QQ provider tells logged-out users to sign in when no stream is available', async () => {
  const provider = new QQMusicProvider({
    getAuthState: () => ({ loggedIn: false }),
    getCookieHeader: () => '',
  });
  let requestBody;
  provider.requestMusicu = async (body) => {
    requestBody = body;
    return { req_0: { data: { midurlinfo: [{ purl: '' }], sip: [] } } };
  };

  await assert.rejects(provider.resolvePlayableUrl({ sourceTrackId: 'paid-song-mid' }), /请先登录 QQ 音乐/);
  assert.deepEqual(requestBody.req_0.param.songtype, [0]);
});

test('QQ provider distinguishes logged-in playback rights from login failure', async () => {
  const provider = createProvider();
  provider.requestMusicu = async () => ({
    req_0: { data: { midurlinfo: [{ purl: '' }], sip: [] } },
  });

  await assert.rejects(
    provider.resolvePlayableUrl({ sourceTrackId: 'paid-song-mid' }),
    /没有该歌曲的完整播放或试听权益/,
  );
});

test('QQ provider requests the selected quality and falls back to the best playable stream', async () => {
  const provider = createProvider();
  let requestBody;
  provider.requestMusicu = async (body) => {
    requestBody = body;
    return {
      req_0: {
        data: {
          midurlinfo: [
            { filename: 'F000media-mid.flac', purl: '' },
            {
              filename: 'M800media-mid.mp3',
              purl: 'M800media-mid.mp3?vkey=test',
            },
            {
              filename: 'M500media-mid.mp3',
              purl: 'M500media-mid.mp3?vkey=test',
            },
          ],
          sip: ['https://isure.test/'],
        },
      },
    };
  };

  const stream = await provider.resolvePlayableUrl(
    {
      sourceTrackId: 'song-mid',
      sourceMediaId: 'media-mid',
      sourceSongType: 1,
    },
    { quality: 'lossless' },
  );

  const params = requestBody.req_0.param;
  assert.deepEqual(params.filename, ['F000media-mid.flac', 'M800media-mid.mp3', 'M500media-mid.mp3']);
  assert.deepEqual(params.songmid, ['song-mid', 'song-mid', 'song-mid']);
  assert.deepEqual(params.songtype, [1, 1, 1]);
  assert.equal(stream.url, 'https://isure.test/M800media-mid.mp3?vkey=test');
  assert.equal(stream.requestedQuality, 'lossless');
  assert.equal(stream.quality, 'high');
});

test('QQ provider requests, decrypts, and aligns translated and romanized lyrics', async () => {
  const originalFetch = global.fetch;
  let capturedUrl = '';
  global.fetch = async (url) => {
    capturedUrl = String(url);
    return new Response(
      JSON.stringify({
        code: 0,
        req_0: {
          code: 0,
          data: {
            crypt: 1,
            lyric: encryptedQrc(qrcXml('[00:01.00]甲乙\n[00:04.00]丙')),
            qrc: encryptedQrc(qrcXml('[1000,1900]甲(1000,900)乙(1900,1000)\n[4000,1000]丙(4000,1000)')),
            trans: encryptedQrc('[00:01.05]翻译一\n[00:04.04]翻译二'),
            roma: encryptedQrc(qrcXml('[1001,1900]jia (1001,900)yi(1901,1000)\n[4001,1000]bing(4001,1000)')),
          },
        },
      }),
      { status: 200 },
    );
  };

  try {
    const provider = createProvider();
    const result = await provider.getLyrics({
      sourceTrackId: 'song-mid',
      sourceSongId: 219082993,
      title: '测试歌曲',
      artists: ['测试歌手'],
      album: '测试专辑',
      durationMs: 5000,
    });

    const payload = JSON.parse(new URL(capturedUrl).searchParams.get('data'));
    assert.equal(payload.req_0.module, 'music.musichallSong.PlayLyricInfo');
    assert.equal(payload.req_0.method, 'GetPlayLyricInfo');
    assert.equal(payload.req_0.param.songID, 219082993);
    assert.equal(payload.req_0.param.qrc, 1);
    assert.equal(payload.req_0.param.trans, 1);
    assert.equal(payload.req_0.param.roma, 1);
    assert.equal(result.lines.length, 2);
    assert.equal(result.lines[0].text, '甲乙');
    assert.equal(result.lines[0].translation, '翻译一');
    assert.equal(result.lines[0].roma, 'jia yi');
    assert.deepEqual(
      result.lines[0].words.map((word) => word.text),
      ['甲', '乙'],
    );
    assert.equal(result.lines[1].translation, '翻译二');
    assert.equal(result.lines[1].roma, 'bing');
  } finally {
    global.fetch = originalFetch;
  }
});

test('QQ provider creates an authenticated local session for EVkey Q0 media', async () => {
  const provider = createProvider();
  let requestBody;
  let requestGuid;
  provider.requestQQEncryptedVkey = async (body, guid) => {
    requestBody = body;
    requestGuid = guid;
    return {
      queryvkey: {
        data: {
          sip: ['https://isure.stream.qqmusic.qq.com/'],
          midurlinfo: [
            {
              filename: 'Q0media-mid.mflac',
              purl: 'Q0media-mid.mflac?guid=test',
              ekey: 'encoded-ekey',
            },
          ],
        },
      },
    };
  };

  const stream = await provider.resolvePlayableUrl(
    {
      sourceTrackId: 'song-mid',
      sourceMediaId: 'media-mid',
      sourceSongType: 1,
    },
    { quality: 'premium' },
  );

  assert.equal(requestBody.queryvkey.module, 'music.vkey.GetEVkey');
  assert.equal(requestBody.queryvkey.method, 'CgiGetEVkey');
  assert.equal(requestBody.queryvkey.param.guid, requestGuid);
  assert.deepEqual(requestBody.queryvkey.param.filename, ['Q0media-mid.mflac']);
  assert.deepEqual(requestBody.queryvkey.param.songtype, [1]);
  assert.match(stream.url, /^\/api\/music\/qq-encrypted-stream\?id=/);
  assert.equal(stream.encrypted, true);
  assert.equal(provider.encryptedStreams.size, 1);
  const record = [...provider.encryptedStreams.values()][0];
  assert.equal(record.ekey, 'encoded-ekey');
});

test('QQ provider treats numeric qrc as a flag and keeps rich lyric translations', async () => {
  const provider = createProvider();
  let legacyRequests = 0;
  provider.requestMusicu = async () => ({
    code: 0,
    req_0: {
      code: 0,
      data: {
        crypt: 1,
        lyric: encryptedQrc(qrcXml('[1000,1900]甲(1000,900)乙(1900,1000)\n[4000,1000]丙(4000,1000)')),
        qrc: 1,
        trans: encryptedQrc('[00:01.05]翻译一\n[00:04.04]翻译二'),
        roma: encryptedQrc(qrcXml('[1001,1900]jia (1001,900)yi(1901,1000)\n[4001,1000]bing(4001,1000)')),
      },
    },
  });
  provider.getLegacyLyrics = async () => {
    legacyRequests += 1;
    return { source: 'qq', sourceTrackId: 'song-mid', lines: [] };
  };

  const result = await provider.getLyrics({
    sourceTrackId: 'song-mid',
    sourceSongId: 219082993,
    title: '测试歌曲',
  });

  assert.equal(legacyRequests, 0);
  assert.equal(result.lines.length, 2);
  assert.equal(result.lines[0].translation, '翻译一');
  assert.equal(result.lines[0].roma, 'jia yi');
  assert.deepEqual(
    result.lines[0].words.map((word) => word.text),
    ['甲', '乙'],
  );
  assert.equal(result.lines[1].translation, '翻译二');
  assert.equal(result.lines[1].roma, 'bing');
});

test('QQ provider falls back to the legacy lyric endpoint', async () => {
  const originalFetch = global.fetch;
  const urls = [];
  global.fetch = async (url) => {
    urls.push(String(url));
    if (urls.length === 1) {
      return new Response(JSON.stringify({ code: 0, req_0: { code: 500 } }), {
        status: 200,
      });
    }
    return new Response(
      JSON.stringify({
        lyric: Buffer.from('[00:01.00]原文').toString('base64'),
        trans: Buffer.from('[00:01.00]翻译').toString('base64'),
        romalrc: Buffer.from('[00:01.00]roma').toString('base64'),
      }),
      { status: 200 },
    );
  };

  try {
    const provider = createProvider();
    const result = await provider.getLyrics({
      sourceTrackId: 'song-mid',
      sourceSongId: 219082993,
      title: '测试歌曲',
    });
    assert.equal(urls.length, 2);
    assert.match(urls[0], /musicu\.fcg/);
    assert.match(urls[1], /fcg_query_lyric_new\.fcg/);
    assert.equal(result.lines[0].text, '原文');
    assert.equal(result.lines[0].translation, '翻译');
    assert.equal(result.lines[0].roma, 'roma');
  } finally {
    global.fetch = originalFetch;
  }
});

test('QQ provider recovers a missing numeric song ID before requesting rich lyrics', async () => {
  const originalFetch = global.fetch;
  const urls = [];
  global.fetch = async (url) => {
    urls.push(String(url));
    if (urls.length === 1) {
      return new Response(
        JSON.stringify({
          code: 0,
          data: {
            song: {
              list: [
                {
                  id: 107402287,
                  mid: '000w1gfs48CBnw',
                  title: '해볼래 (试试看)',
                  singer: [],
                },
                {
                  id: 999,
                  mid: 'different-mid',
                  title: '해볼래 (试试看)',
                  singer: [],
                },
              ],
            },
          },
        }),
        { status: 200 },
      );
    }
    return new Response(
      JSON.stringify({
        code: 0,
        req_0: {
          code: 0,
          data: {
            crypt: 0,
            lyric: Buffer.from('[00:01.00]원문').toString('base64'),
            trans: Buffer.from('[00:01.00]中文译').toString('base64'),
            roma: Buffer.from('[00:01.00]romanization').toString('base64'),
          },
        },
      }),
      { status: 200 },
    );
  };

  try {
    const result = await createProvider().getLyrics({
      sourceTrackId: '000w1gfs48CBnw',
      title: '해볼래 (试试看)',
      artists: ['SISTAR'],
    });

    assert.equal(urls.length, 2);
    assert.match(urls[0], /client_search_cp/);
    const payload = JSON.parse(new URL(urls[1]).searchParams.get('data'));
    assert.equal(payload.req_0.param.songMID, '000w1gfs48CBnw');
    assert.equal(payload.req_0.param.songID, 107402287);
    assert.equal(result.lines[0].translation, '中文译');
    assert.equal(result.lines[0].roma, 'romanization');
  } finally {
    global.fetch = originalFetch;
  }
});
