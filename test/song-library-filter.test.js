'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');
const { pathToFileURL } = require('node:url');
const { createDatabases, closeDatabases } = require('../src/storage/database');
const songService = require('../src/music/song-service');
const ROOT_DIR = path.join(__dirname, '..');

async function loadCategoryFilterModule() {
  const filePath = path.join(__dirname, '..', 'public', 'js', 'admin', 'song-category-filter.js');
  const context = vm.createContext({ console, document: {} });
  const module = new vm.SourceTextModule(fs.readFileSync(filePath, 'utf8'), {
    context,
    identifier: pathToFileURL(filePath).href
  });
  await module.link(() => {
    throw new Error('The category filter module should not import dependencies.');
  });
  await module.evaluate();
  return module.namespace;
}

test('category filter presents each slash-separated category on its own row', async () => {
  const { readSelectedTags, splitCategoryNames } = await loadCategoryFilterModule();

  const names = Array.from(splitCategoryNames([
      { name: '流行 / R&B / 说唱' },
      { name: 'R&B / 古风' },
      { name: '舞曲／流行' }
    ])).sort();

  assert.deepEqual(names, ['R&B', '古风', '流行', '舞曲', '说唱'].sort());
  assert.deepEqual(
    Array.from(readSelectedTags({
      querySelectorAll: () => [{ value: '抒情' }, { value: '治愈' }]
    })),
    ['抒情', '治愈']
  );
});

test('song library requires every selected category and composes with other filters', () => {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'song-library-filter-'));
  const databases = createDatabases({ dataDir });

  try {
    songService.saveSong(databases.songDb, {
      name: '双分类可点', artist: '歌手甲', categoryName: '流行 / R&B / 说唱', language: '国语'
    });
    songService.saveSong(databases.songDb, {
      name: '双分类停用', artist: '歌手甲', categoryName: 'R&B / 说唱', language: '国语', isEnabled: false
    });
    songService.saveSong(databases.songDb, {
      name: '只有R&B', artist: '歌手甲', categoryName: '流行 / R&B', language: '国语'
    });
    songService.saveSong(databases.songDb, {
      name: '语言不同', artist: '歌手甲', categoryName: 'R&B / 说唱', language: '粤语'
    });

    assert.deepEqual(
      songService.listSongs(databases.songDb, { categories: ['R&B', '说唱'] })
        .map((song) => song.name)
        .sort(),
      ['双分类停用', '双分类可点', '语言不同']
    );
    assert.deepEqual(
      songService.listSongs(databases.songDb, {
        categories: ['R&B', '说唱'],
        language: '国语',
        artist: '歌手甲',
        enabledOnly: true
      }).map((song) => song.name),
      ['双分类可点']
    );
    assert.deepEqual(
      songService.listSongs(databases.songDb, { categories: ['R&B', '民谣'] }),
      []
    );
  } finally {
    closeDatabases(databases);
    fs.rmSync(dataDir, { recursive: true, force: true });
  }
});

test('song library requires every selected complete tag and composes with category filters', () => {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'song-library-tag-filter-'));
  const databases = createDatabases({ dataDir });

  try {
    songService.saveSong(databases.songDb, {
      name: '双标签匹配', categoryName: 'R&B / 说唱', tags: '抒情, 治愈'
    });
    songService.saveSong(databases.songDb, {
      name: '只有抒情', categoryName: 'R&B / 说唱', tags: '抒情'
    });
    songService.saveSong(databases.songDb, {
      name: '分类不同', categoryName: '民谣', tags: '抒情，治愈'
    });
    songService.saveSong(databases.songDb, {
      name: '部分文字不算标签', categoryName: 'R&B / 说唱', tags: '治愈系'
    });

    assert.deepEqual(songService.listTags(databases.songDb), ['抒情', '治愈', '治愈系']);
    assert.deepEqual(
      songService.listSongs(databases.songDb, {
        categories: ['R&B', '说唱'],
        tags: ['抒情', '治愈']
      }).map((song) => song.name),
      ['双标签匹配']
    );
    assert.deepEqual(
      songService.listSongs(databases.songDb, { tags: ['抒情', '摇滚'] }),
      []
    );
  } finally {
    closeDatabases(databases);
    fs.rmSync(dataDir, { recursive: true, force: true });
  }
});

test('song library table displays the language column for rows and empty results', () => {
  const html = fs.readFileSync(path.join(ROOT_DIR, 'public', 'pages', 'admin.html'), 'utf8');
  const source = fs.readFileSync(path.join(ROOT_DIR, 'public', 'js', 'admin', 'songs.js'), 'utf8');
  const header = html.match(/<tbody id="songsTable"><\/tbody>[\s\S]*?<thead>|<thead>[\s\S]*?<tbody id="songsTable"><\/tbody>/)?.[0]
    ?? html.match(/<thead>[\s\S]*?<tbody id="songsTable"><\/tbody>/)?.[0];

  assert.ok(header, 'song table markup should remain present');
  assert.match(header, /<th>歌曲标签<\/th>\s*<th>语言<\/th>\s*<th>状态<\/th>/);
  assert.match(source, /escapeHtml\(song\.language \|\| ''\)/);
  assert.match(source, /colspan="9">暂无歌曲/);
});
