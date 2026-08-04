'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');
const {
  filterRandomSongCandidates,
  parseRandomSongTerms
} = require('../src/music/random-song-filter');
const songService = require('../src/music/song-service');
const {
  handleDanmakuMessage,
  parseDanmakuCommand
} = require('../src/bilibili/bilibili-message-handler');
const { closeDatabases, createDatabases } = require('../src/storage/database');

const SONGS = [
  {
    name: '晴天',
    artist: '周杰伦',
    category_name: '流行',
    language: '国语',
    tags: '怀旧, 抒情'
  },
  {
    name: '七里香',
    artist: '周杰伦',
    category_name: '流行',
    language: '国语',
    tags: '怀旧,轻快'
  },
  {
    name: '一路向北',
    artist: '周杰伦',
    category_name: '影视原声',
    language: '国语',
    tags: '抒情'
  },
  {
    name: '说好不哭',
    artist: '五月天',
    category_name: '流行',
    language: '国语',
    tags: '抒情'
  }
];

test('parses random song terms separated by half-width or full-width plus signs', () => {
  assert.deepEqual(parseRandomSongTerms(' 国语 + 周杰伦＋抒情 '), ['国语', '周杰伦', '抒情']);
});

test('requires every random song term to match the same song', () => {
  const matches = filterRandomSongCandidates(SONGS, '国语+周杰伦+抒情');
  assert.deepEqual(matches.map((song) => song.name), ['晴天', '一路向北']);
  assert.deepEqual(filterRandomSongCandidates(SONGS, '国语+周杰伦+摇滚'), []);
});

test('matches language aliases and keeps legacy single-scope behavior', () => {
  assert.equal(filterRandomSongCandidates(SONGS, '中文').length, 4);
  assert.deepEqual(
    filterRandomSongCandidates(SONGS, '影视').map((song) => song.name),
    ['一路向北']
  );
  assert.deepEqual(
    filterRandomSongCandidates(SONGS, '周杰伦').map((song) => song.name),
    ['晴天', '七里香', '一路向北']
  );
});

test('matches complete tags instead of tag substrings', () => {
  assert.deepEqual(
    filterRandomSongCandidates(SONGS, '抒情').map((song) => song.name),
    ['晴天', '一路向北', '说好不哭']
  );
  assert.deepEqual(filterRandomSongCandidates(SONGS, '情'), []);
});

test('maps viewer aliases to real library tags while preserving AND filtering', () => {
  const songs = [
    { name: '别名命中', artist: '周杰伦', tags: '抒情' },
    { name: '歌手不符', artist: '五月天', tags: '抒情' },
    { name: '标签不符', artist: '周杰伦', tags: '治愈' }
  ];

  assert.deepEqual(
    filterRandomSongCandidates(songs, '情歌+周杰伦').map((song) => song.name),
    ['别名命中']
  );
});

test('does not reverse a library alias into the standard tag', () => {
  const songs = [
    { name: '非标准标签', artist: '周杰伦', tags: '情歌' }
  ];

  assert.deepEqual(filterRandomSongCandidates(songs, '抒情'), []);
  assert.deepEqual(
    filterRandomSongCandidates(songs, '情歌').map((song) => song.name),
    ['非标准标签']
  );
});

test('song service only returns enabled library songs satisfying every term', () => {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'song-plugin-random-filter-'));
  const databases = createDatabases({ dataDir });

  try {
    songService.saveSong(databases.songDb, {
      name: '完整匹配', artist: '周杰伦', categoryName: '流行', language: '国语', tags: '抒情'
    });
    songService.saveSong(databases.songDb, {
      name: '缺少标签', artist: '周杰伦', categoryName: '流行', language: '国语', tags: '轻快'
    });
    songService.saveSong(databases.songDb, {
      name: '已禁用', artist: '周杰伦', categoryName: '流行', language: '国语', tags: '抒情', isEnabled: false
    });

    const matches = songService.listRandomSongCandidates(
      databases.songDb,
      '国语+周杰伦+抒情'
    );
    assert.deepEqual(matches.map((song) => song.name), ['完整匹配']);
    const aliasMatches = songService.listRandomSongCandidates(
      databases.songDb,
      '国语+周杰伦+情歌'
    );
    assert.deepEqual(aliasMatches.map((song) => song.name), ['完整匹配']);
    assert.equal(
      databases.songDb.prepare('SELECT tags FROM songs WHERE name = ?').get('完整匹配').tags,
      '抒情'
    );
    assert.deepEqual(
      songService.listRandomSongCandidates(databases.songDb, '国语+周杰伦+摇滚'),
      []
    );
  } finally {
    closeDatabases(databases);
    fs.rmSync(dataDir, { recursive: true, force: true });
  }
});

test('danmaku bridge passes combined terms through unchanged', () => {
  assert.deepEqual(parseDanmakuCommand('随机点歌 国语+周杰伦+抒情', {}), {
    type: 'random',
    scopeText: '国语+周杰伦+抒情'
  });
});

test('ignores a random danmaku when no library song satisfies every term', () => {
  let added = false;
  let persistedCooldown = false;
  const state = { cooldownByUser: new Map() };
  const result = handleDanmakuMessage({
    settings: () => ({ paused: 'false', userCooldownSeconds: '0' }),
    settingsStore: { getDefaultSettings: () => ({ userCooldownSeconds: '0' }) },
    state,
    pickRandomSong(scopeText) {
      assert.equal(scopeText, '国语+周杰伦+摇滚');
      return null;
    },
    addQueueItem() {
      added = true;
    },
    cooldownStore: {
      touch() {
        persistedCooldown = true;
      }
    }
  }, {
    message: '随机点歌 国语+周杰伦+摇滚',
    userName: '观众',
    uid: '123'
  });

  assert.equal(result.accepted, false);
  assert.match(result.reason, /全部条件/);
  assert.equal(added, false);
  assert.equal(persistedCooldown, false);
  assert.equal(state.cooldownByUser.size, 0);
});
