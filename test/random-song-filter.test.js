'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');
const {
  filterRandomSongCandidates,
  describeRandomSongScope,
  parseRandomSongTerms
} = require('../src/music/random-song-filter');
const songService = require('../src/music/song-service');
const {
  handleDanmakuMessage,
  parseDanmakuCommand
} = require('../src/bilibili/bilibili-message-handler');
const { createRequesterTargetStore } = require('../src/music/requester-target-store');
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

test('accepts spaces between random song conditions while preserving complete spaced values', () => {
  assert.deepEqual(
    filterRandomSongCandidates(SONGS, '流行 抒情').map((song) => song.name),
    ['晴天', '说好不哭']
  );
  assert.deepEqual(
    filterRandomSongCandidates([
      { name: '带空格歌手', artist: 'A1 TRIP', category_name: '说唱', tags: '苦情' }
    ], 'A1 TRIP').map((song) => song.name),
    ['带空格歌手']
  );
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

test('matches individual artists and languages in combined library values', () => {
  const songs = [{
    name: '合唱双语歌',
    artist: '周杰伦 / 阿信',
    category_name: '流行 / R&B',
    language: '国语/英语',
    tags: '影视OST'
  }];

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

test('describes direct and alias terms against the song library', () => {
  const description = describeRandomSongScope(SONGS, '情歌+摇滚');
  assert.deepEqual(description.terms, ['情歌', '摇滚']);
  assert.deepEqual(description.unmatchedTerms, ['摇滚']);
  assert.equal(description.hasCandidates, false);
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

test('builds a direct mention auto-reply for a single unmatched random condition', () => {
  const result = handleDanmakuMessage({
    settings: () => ({ paused: 'false', userCooldownSeconds: '0', enableRandomTagReply: 'true' }),
    settingsStore: { getDefaultSettings: () => ({ userCooldownSeconds: '0' }) },
    state: { cooldownByUser: new Map() },
    pickRandomSong: () => null,
    describeRandomSongScope: () => ({ terms: ['摇滚'], unmatchedTerms: ['摇滚'], hasCandidates: false }),
    addQueueItem() {
      assert.fail('an unmatched random condition must not create a request');
    }
  }, {
    message: '随机点歌 摇滚',
    userName: 'Alice',
    uid: '123'
  });

  assert.equal(result.accepted, false);
  assert.deepEqual(result.autoReply, {
    message: '歌库里暂时没有「摇滚」这一类歌曲，请换个条件试试。',
    target: { uid: '123', name: 'Alice' }
  });
});

test('builds a combination mention auto-reply and keeps it disabled by the switch', () => {
  const context = {
    settings: () => ({ paused: 'false', userCooldownSeconds: '0', enableRandomTagReply: 'false' }),
    settingsStore: { getDefaultSettings: () => ({ userCooldownSeconds: '0' }) },
    state: { cooldownByUser: new Map() },
    pickRandomSong: () => null,
    describeRandomSongScope: () => ({ terms: ['国语', '摇滚'], unmatchedTerms: ['摇滚'], hasCandidates: false }),
    addQueueItem() {
      assert.fail('an unmatched random condition must not create a request');
    }
  };
  const disabledResult = handleDanmakuMessage(context, {
    message: '随机点歌 国语+摇滚',
    userName: 'Alice',
    uid: '123'
  });
  assert.equal(disabledResult.autoReply, null);

  context.settings = () => ({ paused: 'false', userCooldownSeconds: '0', enableRandomTagReply: 'true' });
  const enabledResult = handleDanmakuMessage(context, {
    message: '随机点歌 国语+摇滚',
    userName: 'Alice',
    uid: '123'
  });
  assert.deepEqual(enabledResult.autoReply, {
    message: '你输入的组合条件「国语+摇滚」暂时没有匹配歌曲，请调整组合条件后再试。',
    target: { uid: '123', name: 'Alice' }
  });
});

test('failed random filters do not replace the latest mention target', () => {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'song-plugin-requester-target-'));
  const databases = createDatabases({ dataDir });

  try {
    databases.songDb.prepare(`
      INSERT INTO requests (
        song_name, requester_uid, requester_name, source, created_at
      ) VALUES (?, ?, ?, ?, ?)
    `).run('Matched Song', '456', 'Alice', 'random:pop', '2026-08-05T10:00:00.000Z');
    const requesterTargets = createRequesterTargetStore(databases.songDb);
    const before = requesterTargets.getLatestRandomRequester();
    const result = handleDanmakuMessage({
      settings: () => ({ paused: 'false', userCooldownSeconds: '0' }),
      settingsStore: { getDefaultSettings: () => ({ userCooldownSeconds: '0' }) },
      state: { cooldownByUser: new Map() },
      pickRandomSong: () => null,
      addQueueItem() {
        assert.fail('a failed random filter must not create a request');
      }
    }, {
      message: '\u968f\u673a\u70b9\u6b4c unknown-tag',
      userName: 'Bob',
      uid: '789'
    });

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
