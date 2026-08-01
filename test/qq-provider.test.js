'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { zzcSign } = require('@jixun/qmweb-sign');
const { encryptQrc } = require('qrc-decoder');
const { QQMusicProvider } = require('../src/music/providers/qq-provider');
const { writeMusicPlaylistTracks } = require('../src/music/lyrics-service');

const COOKIE = 'qqmusic_uin=123456; qqmusic_key=test-key; qm_keyst=test-client-key; qqmusic_guid=987654321; tmeLoginType=2';

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
  let playlistRequest;
  global.fetch = async (url, options) => {
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
    playlistRequest = { url: String(url), options };
    return new Response(JSON.stringify({
      code: 0,
      'music.musicasset.PlaylistBaseRead.GetPlaylistByUin': {
        code: 0,
        data: {
          v_playlist: [
            { tid: 2924077536, dirId: 201, dirName: '我喜欢', songNum: 481 },
            { tid: 7527135346, dirId: 21, dirName: '测试歌单', songNum: 31 }
          ]
        }
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
    assert.equal(playlists[0].trackCount, 31);
    const payload = JSON.parse(playlistRequest.options.body);
    assert.equal(new URL(playlistRequest.url).origin, 'https://u6.y.qq.com');
    assert.equal(payload.comm.authst, 'test-client-key');
    assert.equal(payload.comm.ct, '19');
    assert.equal(
      payload['music.musicasset.PlaylistBaseRead.GetPlaylistByUin'].method,
      'GetPlaylistByUin'
    );
  } finally {
    global.fetch = originalFetch;
  }
});

test('QQ provider reads collected playlists from the desktop client API', async () => {
  const originalFetch = global.fetch;
  global.fetch = async () => new Response(JSON.stringify({
    code: 0,
    'music.musicasset.PlaylistFavRead': {
      code: 0,
      data: {
        v_list: [{ tid: 7453216549, dirId: 0, name: '收藏歌单', songnum: 112, logo: 'https://example.test/cover.jpg' }]
      }
    }
  }), { status: 200 });

  try {
    const playlists = await createProvider().getCollectedPlaylists({ limit: 50 });
    assert.equal(playlists.length, 1);
    assert.equal(playlists[0].id, '7453216549');
    assert.equal(playlists[0].title, '收藏歌单');
    assert.equal(playlists[0].trackCount, 112);
  } finally {
    global.fetch = originalFetch;
  }
});

test('QQ created playlists fall back to the web API when client auth is unavailable', async () => {
  const originalFetch = global.fetch;
  let call = 0;
  global.fetch = async () => {
    call += 1;
    if (call === 1) {
      return new Response(JSON.stringify({
        code: 2000,
        'music.musicasset.PlaylistBaseRead.GetPlaylistByUin': { code: 2000 }
      }), { status: 200 });
    }
    return new Response(JSON.stringify({
      code: 0,
      data: { disslist: [{ tid: 7527135346, dirid: 21, dissname: '网页回退歌单', songnum: 31 }] }
    }), { status: 200 });
  };

  try {
    const playlists = await createProvider().getCreatedPlaylists({ limit: 50, includeLiked: false });
    assert.equal(call, 2);
    assert.equal(playlists[0].title, '网页回退歌单');
  } finally {
    global.fetch = originalFetch;
  }
});

test('QQ liked tracks uses the client playlist and slices the requested page', async () => {
  const originalFetch = global.fetch;
  const requests = [];
  global.fetch = async (url, options) => {
    requests.push({ url: String(url), body: JSON.parse(options.body) });
    if (requests.length === 1) {
      return new Response(JSON.stringify({
        code: 0,
        'music.musicasset.PlaylistBaseRead.GetPlaylistByUin': {
          code: 0,
          data: { v_playlist: [{ tid: 2924077536, dirId: 201, dirName: '我喜欢', songNum: 150 }] }
        }
      }), { status: 200 });
    }
    const songlist = Array.from({ length: 150 }, (_, index) => ({
      id: index + 1,
      mid: `song-${index + 1}`,
      title: `歌曲 ${index + 1}`,
      singer: []
    }));
    return new Response(JSON.stringify({
      code: 0,
      'music.srfDissInfo.DissInfoForPc.uniform_get_Dissinfo': {
        code: 0,
        data: { songlist, total_song_num: 150 }
      }
    }), { status: 200 });
  };

  try {
    const tracks = await createProvider().getLikedTracks({ limit: 100, offset: 100 });
    assert.equal(tracks.length, 50);
    assert.equal(tracks[0].sourceTrackId, 'song-101');
    assert.equal(
      requests[1].body['music.srfDissInfo.DissInfoForPc.uniform_get_Dissinfo'].param.disstid,
      2924077536
    );
  } finally {
    global.fetch = originalFetch;
  }
});

test('QQ liked tracks rejects an incomplete login instead of returning an empty list', async () => {
  const provider = new QQMusicProvider({
    getAuthState: () => ({ loggedIn: false }),
    getCookieHeader: () => 'pt2gguin=o123456; superuin=o123456'
  });

  await assert.rejects(
    provider.getLikedTracks({ limit: 100, offset: 0 }),
    /登录/
  );
});

test('QQ playlist detail sends server-side pagination parameters', async () => {
  const originalFetch = global.fetch;
  let capturedUrl = '';
  global.fetch = async (url) => {
    capturedUrl = String(url);
    return new Response(JSON.stringify({
      code: 0,
      cdlist: [{ songlist: [{ id: 1, mid: 'page-two-song', title: '第二页', singer: [] }] }]
    }), { status: 200 });
  };

  try {
    const provider = new QQMusicProvider({
      getAuthState: () => ({ loggedIn: false }),
      getCookieHeader: () => ''
    });
    const tracks = await provider.getPlaylistTracks('2924077536', { limit: 100, offset: 100 });
    const url = new URL(capturedUrl);
    assert.equal(url.searchParams.get('song_begin'), '100');
    assert.equal(url.searchParams.get('song_num'), '100');
    assert.equal(tracks[0].sourceTrackId, 'page-two-song');
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
