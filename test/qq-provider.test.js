'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { zzcSign } = require('@jixun/qmweb-sign');
const { encryptQrc } = require('qrc-decoder');
const { QQMusicProvider } = require('../src/music/providers/qq-provider');
const { writeMusicPlaylistTracks } = require('../src/music/lyrics-service');

const COOKIE = 'qqmusic_uin=123456; qqmusic_key=test-key; pgv_pvid=987654321';

function createProvider() {
  return new QQMusicProvider({
    getAuthState: () => ({ loggedIn: true }),
    getCookieHeader: () => COOKIE
  });
}

function encryptedQrc(text) {
  return encryptQrc(text);
}

function qrcXml(content) {
  return `<?xml version="1.0" encoding="utf-8"?>\n<QrcInfos><LyricInfo><Lyric_1 LyricType="1" LyricContent="${content}"/></LyricInfo></QrcInfos>`;
}

test('QQ provider requests, decrypts, and aligns translated and romanized lyrics', async () => {
  const originalFetch = global.fetch;
  let capturedUrl = '';
  global.fetch = async (url) => {
    capturedUrl = String(url);
    return new Response(JSON.stringify({
      code: 0,
      req_0: {
        code: 0,
        data: {
          crypt: 1,
          lyric: encryptedQrc(qrcXml(
            '[1000,1900]甲(1000,900)乙(1900,1000)\n[4000,1000]丙(4000,1000)'
          )),
          trans: encryptedQrc('[00:01.05]翻译一\n[00:04.04]翻译二'),
          roma: encryptedQrc(qrcXml(
            '[1001,1900]jia (1001,900)yi(1901,1000)\n[4001,1000]bing(4001,1000)'
          ))
        }
      }
    }), { status: 200 });
  };

  try {
    const provider = createProvider();
    const result = await provider.getLyrics({
      sourceTrackId: 'song-mid',
      sourceSongId: 219082993,
      title: '测试歌曲',
      artists: ['测试歌手'],
      album: '测试专辑',
      durationMs: 5000
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
    assert.deepEqual(result.lines[0].words.map((word) => word.text), ['甲', '乙']);
    assert.equal(result.lines[1].translation, '翻译二');
    assert.equal(result.lines[1].roma, 'bing');
  } finally {
    global.fetch = originalFetch;
  }
});

test('QQ provider falls back to the legacy lyric endpoint', async () => {
  const originalFetch = global.fetch;
  const urls = [];
  global.fetch = async (url) => {
    urls.push(String(url));
    if (urls.length === 1) {
      return new Response(JSON.stringify({ code: 0, req_0: { code: 500 } }), { status: 200 });
    }
    return new Response(JSON.stringify({
      lyric: Buffer.from('[00:01.00]原文').toString('base64'),
      trans: Buffer.from('[00:01.00]翻译').toString('base64'),
      romalrc: Buffer.from('[00:01.00]roma').toString('base64')
    }), { status: 200 });
  };

  try {
    const provider = createProvider();
    const result = await provider.getLyrics({
      sourceTrackId: 'song-mid',
      sourceSongId: 219082993,
      title: '测试歌曲'
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

test('QQ provider signs AddSonglist requests and preserves QQ numeric ids', async () => {
  const originalFetch = global.fetch;
  let captured;
  global.fetch = async (url, options) => {
    captured = { url: String(url), options };
    return new Response(JSON.stringify({
      code: 0,
      'music.musicasset.PlaylistDetailWrite.AddSonglist': {
        code: 0,
        data: {
          retCode: 0,
          result: {
            dirId: 201,
            tid: 2924077536,
            songlist: [{ songId: 563728446, existed: 0 }]
          }
        }
      }
    }), { status: 200 });
  };

  try {
    const provider = createProvider();
    const result = await provider.addTracksToPlaylist(
      { id: '2924077536', tid: '2924077536', dirId: '201', title: '我喜欢' },
      [{ sourceSongId: 563728446 }]
    );
    assert.equal(result.dirId, 201);
    assert.equal(result.songlist[0].existed, 0);

    const url = new URL(captured.url);
    const body = captured.options.body;
    const payload = JSON.parse(body);
    assert.equal(url.origin + url.pathname, 'https://u6.y.qq.com/cgi-bin/musics.fcg');
    assert.equal(url.searchParams.get('sign'), zzcSign(body));
    assert.equal(payload.comm.uin, '123456');
    assert.equal(payload.comm.g_tk, payload.comm.g_tk_new_20200303);
    assert.deepEqual(
      payload['music.musicasset.PlaylistDetailWrite.AddSonglist'].param.v_songInfo,
      [{ songId: 563728446, songType: 0 }]
    );
  } finally {
    global.fetch = originalFetch;
  }
});

test('QQ provider maps sourceSongId and playlist tid/dirId', async () => {
  const originalFetch = global.fetch;
  let call = 0;
  global.fetch = async () => {
    call += 1;
    if (call === 1) {
      return new Response(JSON.stringify({
        code: 0,
        data: {
          song: {
            list: [{ id: 563728446, mid: 'song-mid', title: '测试歌曲', singer: [] }]
          }
        }
      }), { status: 200 });
    }
    return new Response(JSON.stringify({
      code: 0,
      data: {
        disslist: [{ tid: 7527135346, dirid: 21, dissname: '测试歌单' }]
      }
    }), { status: 200 });
  };

  try {
    const provider = createProvider();
    const tracks = await provider.searchTracks('测试');
    const playlists = await provider.getCreatedPlaylists({ includeLiked: false });
    assert.equal(tracks[0].sourceSongId, 563728446);
    assert.equal(playlists[0].tid, '7527135346');
    assert.equal(playlists[0].dirId, '21');
  } finally {
    global.fetch = originalFetch;
  }
});

test('playlist write service rejects tracks without QQ numeric songId before fetch', async () => {
  const registry = { get: () => createProvider() };
  await assert.rejects(
    writeMusicPlaylistTracks(registry, {
      platform: 'qq',
      playlist: { id: '2924077536', tid: '2924077536', dirId: '201', title: '我喜欢' },
      tracks: [{ sourceTrackId: 'song-mid' }]
    }, 'add'),
    /songId/
  );
});
