'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');
const {
  filterRandomSongCandidates,
  describeRandomSongScope,
  parseRandomSongTerms,
} = require('../../src/music/random-song-filter');
const songService = require('../../src/music/song-service');
const { handleDanmakuMessage, parseDanmakuCommand } = require('../../src/bilibili/bilibili-message-handler');
const { isBilibiliCommandText } = require('../../src/bilibili/danmaku/command-text');
const { createRequesterTargetStore } = require('../../src/storage/requester-target-store');
const { closeDatabases, createDatabases } = require('../../src/storage/database');
const { createSongStore } = require('../../src/storage/song-store');
const { createQueueStore } = require('../../src/storage/queue-store');
const { addQueueItem } = require('../../src/music/queue-service');

const SONGS = [
  {
    name: '晴天',
    artist: '周杰伦',
    category_name: '流行',
    language: '国语',
    tags: '怀旧, 抒情',
  },
  {
    name: '七里香',
    artist: '周杰伦',
    category_name: '流行',
    language: '国语',
    tags: '怀旧,轻快',
  },
  {
    name: '一路向北',
    artist: '周杰伦',
    category_name: '影视原声',
    language: '国语',
    tags: '抒情',
  },
  {
    name: '说好不哭',
    artist: '五月天',
    category_name: '流行',
    language: '国语',
    tags: '抒情',
  },
];

test('parses random song terms separated by half-width or full-width plus signs', () => {
  assert.deepEqual(parseRandomSongTerms(' 国语 + 周杰伦＋抒情 '), ['国语', '周杰伦', '抒情']);
});

test('requires every random song term to match the same song', () => {
  const matches = filterRandomSongCandidates(SONGS, '国语+周杰伦+抒情');
  assert.deepEqual(
    matches.map((song) => song.name),
    ['晴天', '一路向北'],
  );
  assert.deepEqual(filterRandomSongCandidates(SONGS, '国语+周杰伦+摇滚'), []);
});

test('accepts spaces between random song conditions while preserving complete spaced values', () => {
  assert.deepEqual(
    filterRandomSongCandidates(SONGS, '流行 抒情').map((song) => song.name),
    ['晴天', '说好不哭'],
  );
  assert.deepEqual(
    filterRandomSongCandidates(
      [
        {
          name: '带空格歌手',
          artist: 'A1 TRIP',
          category_name: '说唱',
          tags: '苦情',
        },
      ],
      'A1 TRIP',
    ).map((song) => song.name),
    ['带空格歌手'],
  );
});

test('matches language aliases and keeps legacy single-scope behavior', () => {
  assert.equal(filterRandomSongCandidates(SONGS, '中文').length, 4);
  assert.deepEqual(
    filterRandomSongCandidates(SONGS, '影视').map((song) => song.name),
    ['一路向北'],
  );
  assert.deepEqual(
    filterRandomSongCandidates(SONGS, '周杰伦').map((song) => song.name),
    ['晴天', '七里香', '一路向北'],
  );
});

test('matches individual artists and languages in combined library values', () => {
  const songs = [
    {
      name: '合唱双语歌',
      artist: '周杰伦 / 阿信',
      category_name: '流行 / R&B',
      language: '国语/英语',
      tags: '影视OST',
    },
  ];

  assert.equal(filterRandomSongCandidates(songs, '周杰伦').length, 1);
  assert.equal(filterRandomSongCandidates(songs, '阿信').length, 1);
  assert.equal(filterRandomSongCandidates(songs, '英语').length, 1);
  assert.equal(filterRandomSongCandidates(songs, '华语').length, 1);
});

test('preserves artist names containing punctuation', () => {
  const songs = [{ name: '歌手名含逗号', artist: '接个吻，开一枪 / 沈以诚' }];

  assert.equal(filterRandomSongCandidates(songs, '接个吻，开一枪').length, 1);
  assert.equal(filterRandomSongCandidates(songs, '开一枪').length, 0);
});

test('random matching shares full-width field separators with the library', () => {
  const song = {
    name: 'fixture',
    artist: 'Alice／Bob',
    language: 'English／Japanese',
    tags: 'first;second',
  };
  for (const query of ['Alice', 'Bob', 'English', 'Japanese', 'first', 'second']) {
    assert.equal(filterRandomSongCandidates([song], query).length, 1, query);
  }
});

test('matches category components and common category aliases', () => {
  const songs = [{ name: '跨分类歌曲', category_name: '流行 / R&B / 说唱' }];

  assert.equal(filterRandomSongCandidates(songs, 'Pop').length, 1);
  assert.equal(filterRandomSongCandidates(songs, 'RNB').length, 1);
  assert.equal(filterRandomSongCandidates(songs, 'Hip-Hop').length, 1);
  assert.equal(filterRandomSongCandidates(songs, '行').length, 0);
});

test('matches complete tags instead of tag substrings', () => {
  assert.deepEqual(
    filterRandomSongCandidates(SONGS, '抒情').map((song) => song.name),
    ['晴天', '一路向北', '说好不哭'],
  );
  assert.deepEqual(filterRandomSongCandidates(SONGS, '情'), []);
});

test('maps viewer aliases to real library tags while preserving AND filtering', () => {
  const songs = [
    { name: '别名命中', artist: '周杰伦', tags: '抒情' },
    { name: '歌手不符', artist: '五月天', tags: '抒情' },
    { name: '标签不符', artist: '周杰伦', tags: '治愈' },
  ];

  assert.deepEqual(
    filterRandomSongCandidates(songs, '情歌+周杰伦').map((song) => song.name),
    ['别名命中'],
  );
});

test('random tag conditions are normalized once per scope instead of per library candidate', (t) => {
  const songs = Array.from({ length: 100 }, (_, index) => ({
    name: `Song ${index}`, tags: '怀旧,抒情,治愈,小甜歌,影视OST',
  }));
  const original = String.prototype.toLocaleLowerCase;
  let queryNormalizations = 0;
  t.mock.method(String.prototype, 'toLocaleLowerCase', function (...args) {
    if (['老歌', '情歌', 'OST'].includes(String(this))) queryNormalizations += 1;
    return Reflect.apply(original, this, args);
  });

  assert.equal(filterRandomSongCandidates(songs, '老歌+情歌+OST').length, songs.length);
  assert.ok(queryNormalizations < 20, `three query terms were normalized ${queryNormalizations} times`);
});

test('describes direct and alias terms against the song library', () => {
  const description = describeRandomSongScope(SONGS, '情歌+摇滚');
  assert.deepEqual(description.terms, ['情歌', '摇滚']);
  assert.deepEqual(description.unmatchedTerms, ['摇滚']);
  assert.equal(description.hasCandidates, false);
});

test('scope descriptions retain all unmatched terms and same-song AND semantics', () => {
  const songs = [
    { artist: 'A1 TRIP', language: 'English', tags: '抒情' },
    { artist: 'B', category_name: 'rock', category_is_enabled: 0, tags: '情歌' },
  ];
  assert.deepEqual(describeRandomSongScope(songs, 'A1 TRIP+英语+情歌'), {
    terms: ['A1 TRIP', '英语', '情歌'], unmatchedTerms: [], hasCandidates: true,
  });
  assert.deepEqual(describeRandomSongScope(songs, 'A1 TRIP+B+摇滚+治愈'), {
    terms: ['A1 TRIP', 'B', '摇滚', '治愈'], unmatchedTerms: ['摇滚', '治愈'], hasCandidates: false,
  });
  assert.deepEqual(filterRandomSongCandidates([songs[1]], '抒情'), [], 'standard tags do not reverse-match viewer aliases');
  assert.equal(describeRandomSongScope(songs, '').hasCandidates, true);
  assert.equal(describeRandomSongScope([], '').hasCandidates, false);
});

test('song service only returns enabled library songs satisfying every term', () => {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'song-plugin-random-filter-'));
  const databases = createDatabases({ dataDir });
  const songStore = createSongStore(databases.songDb);

  try {
    songService.saveSong(songStore, {
      name: '完整匹配',
      artist: '周杰伦',
      categoryName: '流行',
      language: '国语',
      tags: '抒情',
    });
    songService.saveSong(songStore, {
      name: '缺少标签',
      artist: '周杰伦',
      categoryName: '流行',
      language: '国语',
      tags: '轻快',
    });
    songService.saveSong(songStore, {
      name: '已禁用',
      artist: '周杰伦',
      categoryName: '流行',
      language: '国语',
      tags: '抒情',
      isEnabled: false,
    });

    const matches = songService.listRandomSongCandidates(songStore, '国语+周杰伦+抒情');
    assert.deepEqual(
      matches.map((song) => song.name),
      ['完整匹配'],
    );
    const aliasMatches = songService.listRandomSongCandidates(songStore, '国语+周杰伦+情歌');
    assert.deepEqual(
      aliasMatches.map((song) => song.name),
      ['完整匹配'],
    );
    assert.equal(databases.songDb.prepare('SELECT tags FROM songs WHERE name = ?').get('完整匹配').tags, '抒情');
    assert.deepEqual(songService.listRandomSongCandidates(songStore, '国语+周杰伦+摇滚'), []);
  } finally {
    closeDatabases(databases);
    fs.rmSync(dataDir, { recursive: true, force: true });
  }
});

test('danmaku bridge passes combined terms through unchanged', () => {
  for (const message of ['随机点歌 国语+周杰伦+抒情', '随机点歌国语+周杰伦+抒情']) {
    assert.equal(isBilibiliCommandText(message), true);
    assert.deepEqual(parseDanmakuCommand(message, {}), {
      type: 'random',
      scopeText: '国语+周杰伦+抒情',
    });
  }
  assert.deepEqual(parseDanmakuCommand('随机点歌', {}), { type: 'random', scopeText: '' });
});

test('ordinary random text does not trigger song requests or unmatched replies', () => {
  for (const message of ['随机', '随机xx', '随机 xx', '随机：＋ -—英文', '随机 点歌']) {
    assert.equal(isBilibiliCommandText(message), false, message);
    assert.equal(parseDanmakuCommand(message, {}), null, message);
    const result = handleDanmakuMessage(
      { settings: () => ({ enableRandomTagReply: 'true' }) },
      { message, userName: 'Alice', uid: '123' },
    );
    assert.equal(result.accepted, false, message);
    assert.equal(result.autoReply, undefined, message);
  }
});

test('danmaku song requests accept the song name with or without a separating space', () => {
  const expected = { type: 'request', songName: '123' };
  assert.deepEqual(parseDanmakuCommand('点歌123', {}), expected);
  assert.deepEqual(parseDanmakuCommand('点歌 123', {}), expected);
});

test('ignores a random danmaku when no library song satisfies every term', () => {
  let added = false;
  let recordedCooldown = false;
  const result = handleDanmakuMessage(
    {
      settings: () => ({ paused: 'false', userCooldownSeconds: '0' }),
      settingsStore: {
        getDefaultSettings: () => ({ userCooldownSeconds: '0' }),
      },
      userRequestCooldown: {
        getLastRequestAt: () => 0,
        recordAccepted() { recordedCooldown = true; },
      },
      pickRandomSong(scopeText) {
        assert.equal(scopeText, '国语+周杰伦+摇滚');
        return null;
      },
      addQueueItem() {
        added = true;
      },
    },
    {
      message: '随机点歌 国语+周杰伦+摇滚',
      userName: '观众',
      uid: '123',
    },
  );

  assert.equal(result.accepted, false);
  assert.equal(added, false);
  assert.equal(recordedCooldown, false);
});

test('builds a direct mention auto-reply for a single unmatched random condition', () => {
  const result = handleDanmakuMessage(
    {
      settings: () => ({
        paused: 'false',
        userCooldownSeconds: '0',
        enableRandomTagReply: 'true',
      }),
      settingsStore: {
        getDefaultSettings: () => ({ userCooldownSeconds: '0' }),
      },
      userRequestCooldown: { getLastRequestAt: () => 0, recordAccepted() { assert.fail(); } },
      pickRandomSong: () => null,
      describeRandomSongScope: () => ({
        terms: ['摇滚'],
        unmatchedTerms: ['摇滚'],
        hasCandidates: false,
      }),
      addQueueItem() {
        assert.fail('an unmatched random condition must not create a request');
      },
    },
    {
      message: '随机点歌 摇滚',
      userName: 'Alice',
      uid: '123',
    },
  );

  assert.equal(result.accepted, false);
  assert.ok(result.autoReply.message.includes('摇滚'));
  assert.deepEqual(result.autoReply.target, { uid: '123', name: 'Alice' });
});

test('builds a combination mention auto-reply and keeps it disabled by the switch', () => {
  const context = {
    settings: () => ({
      paused: 'false',
      userCooldownSeconds: '0',
      enableRandomTagReply: 'false',
    }),
    settingsStore: { getDefaultSettings: () => ({ userCooldownSeconds: '0' }) },
    userRequestCooldown: { getLastRequestAt: () => 0, recordAccepted() { assert.fail(); } },
    pickRandomSong: () => null,
    describeRandomSongScope: () => ({
      terms: ['国语', '摇滚'],
      unmatchedTerms: ['摇滚'],
      hasCandidates: false,
    }),
    addQueueItem() {
      assert.fail('an unmatched random condition must not create a request');
    },
  };
  const disabledResult = handleDanmakuMessage(context, {
    message: '随机点歌 国语+摇滚',
    userName: 'Alice',
    uid: '123',
  });
  assert.equal(disabledResult.autoReply, null);

  context.settings = () => ({
    paused: 'false',
    userCooldownSeconds: '0',
    enableRandomTagReply: 'true',
  });
  const enabledResult = handleDanmakuMessage(context, {
    message: '随机点歌 国语+摇滚',
    userName: 'Alice',
    uid: '123',
  });
  assert.ok(enabledResult.autoReply.message.includes('国语+摇滚'));
  assert.deepEqual(enabledResult.autoReply.target, { uid: '123', name: 'Alice' });
});

test('failed random filters do not replace the latest mention target', () => {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'song-plugin-requester-target-'));
  const databases = createDatabases({ dataDir });

  try {
    addQueueItem({
      store: createQueueStore(databases.songDb),
      settings: () => ({}),
      defaults: () => ({}),
    }, {
      songName: 'Matched Song', requesterUid: '456', requesterName: 'Alice',
      source: 'random:pop', createdAt: '2026-08-05T10:00:00.000Z',
    });
    const requesterTargets = createRequesterTargetStore(databases.songDb);
    const before = requesterTargets.getLatestRandomRequester();
    const result = handleDanmakuMessage(
      {
        settings: () => ({ paused: 'false', userCooldownSeconds: '0' }),
        settingsStore: {
          getDefaultSettings: () => ({ userCooldownSeconds: '0' }),
        },
        userRequestCooldown: { getLastRequestAt: () => 0, recordAccepted() { assert.fail(); } },
        pickRandomSong: () => null,
        addQueueItem() {
          assert.fail('a failed random filter must not create a request');
        },
      },
      {
        message: '\u968f\u673a\u70b9\u6b4c unknown-tag',
        userName: 'Bob',
        uid: '789',
      },
    );

    assert.equal(result.accepted, false);
    assert.equal(databases.songDb.prepare('SELECT COUNT(*) AS count FROM requests').get().count, 1);
    assert.deepEqual(requesterTargets.getLatestRandomRequester(), before);
    assert.equal(before.uid, '456');
    assert.equal(before.name, 'Alice');
  } finally {
    closeDatabases(databases);
    fs.rmSync(dataDir, { recursive: true, force: true });
  }
});
