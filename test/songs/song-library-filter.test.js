'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');
const { pathToFileURL } = require('node:url');
const { createDatabases, closeDatabases } = require('../../src/storage/database');
const { createSongStore } = require('../../src/storage/song-store');
const songService = require('../../src/music/song-service');
const ROOT_DIR = path.join(__dirname, '../..');

async function loadCategoryFilterModule() {
  const filePath = path.join(__dirname, '../..', 'public', 'js', 'admin', 'song-category-filter.js');
  const context = vm.createContext({ console, document: {} });
  const module = new vm.SourceTextModule(fs.readFileSync(filePath, 'utf8'), {
    context,
    identifier: pathToFileURL(filePath).href,
  });
  await module.link(() => {
    throw new Error('The category filter module should not import dependencies.');
  });
  await module.evaluate();
  return module.namespace;
}

async function loadSongsModule(globals) {
  const { utils, state = {} } = globals.window.AdminApp;
  const { loadModuleExports } = require('../helpers/frontend-modules');
  const { createSongs } = await loadModuleExports(path.join(ROOT_DIR, 'public/js/admin/songs.js'), globals);
  return createSongs({ utils, state });
}

test('category filter presents each punctuation-separated category once on its own row', async () => {
  const { splitCategoryNames } = await loadCategoryFilterModule();

  const names = Array.from(
    splitCategoryNames([
      { name: '流行 / R&B / 说唱' },
      { name: 'R&B / 古风' },
      { name: '舞曲／流行' },
      { name: ' 儿歌; 流行；儿歌; ' },
      { name: '儿歌，甜歌、整活' },
      { name: 'Hip Hop, 流行' },
      { name: '默认；;，' },
    ]),
  ).sort();

  assert.deepEqual(names, ['R&B', 'Hip Hop', '儿歌', '古风', '流行', '甜歌', '整活', '舞曲', '说唱'].sort());
});

test('song library matches any selected category and intersects other filter groups', () => {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'song-library-filter-'));
  const databases = createDatabases({ dataDir });
  const songStore = createSongStore(databases.songDb);

  try {
    songService.saveSong(songStore, {
      name: '双分类可点',
      artist: '歌手甲',
      categoryName: '流行； R&B; 说唱',
      language: '国语',
    });
    songService.saveSong(songStore, {
      name: '双分类停用',
      artist: '歌手甲',
      categoryName: 'R&B，说唱',
      language: '国语',
      isEnabled: false,
    });
    songService.saveSong(songStore, {
      name: '只有R&B',
      artist: '歌手甲',
      categoryName: '流行 / R&B',
      language: '国语',
    });
    songService.saveSong(songStore, {
      name: '语言不同',
      artist: '歌手甲',
      categoryName: 'R&B、说唱',
      language: '粤语',
    });
    songService.saveSong(songStore, {
      name: '其他分类',
      artist: '歌手甲',
      categoryName: '民谣',
      language: '国语',
    });

    assert.deepEqual(
      songService
        .listSongs(songStore, { categories: ['流行', '说唱'] })
        .map((song) => song.name)
        .sort(),
      ['双分类停用', '双分类可点', '只有R&B', '语言不同'].sort(),
    );
    assert.deepEqual(
      songService
        .listSongs(songStore, {
          categories: ['流行', '说唱'],
          language: '国语',
          artist: '歌手甲',
          enabledOnly: true,
        })
        .map((song) => song.name)
        .sort(),
      ['双分类可点', '只有R&B'].sort(),
    );
    assert.deepEqual(
      songService.listSongs(songStore, { categories: ['民谣', '不存在'] }).map((song) => song.name),
      ['其他分类'],
    );
    assert.deepEqual(songService.listSongs(songStore, { categories: ['不存在'] }), []);
    assert.equal(songService.listSongs(songStore, { categories: [] }).length, 5);
    assert.deepEqual(
      songService.listSongs(songStore, { categories: ['流行', '说唱'], query: '只有' }).map((song) => song.name),
      ['只有R&B'],
    );
  } finally {
    closeDatabases(databases);
    fs.rmSync(dataDir, { recursive: true, force: true });
  }
});

test('song library artist filter matches an individual artist in a collaboration field', () => {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'song-library-artist-filter-'));
  const databases = createDatabases({ dataDir });
  const songStore = createSongStore(databases.songDb);

  try {
    songService.saveSong(songStore, {
      name: '合作歌曲',
      artist: '歌手甲 / 歌手乙',
      categoryName: '流行',
    });
    songService.saveSong(songStore, {
      name: '歌手甲独唱',
      artist: '歌手甲',
      categoryName: '流行',
    });
    songService.saveSong(songStore, {
      name: '其他歌曲',
      artist: '歌手丙',
      categoryName: '流行',
    });

    assert.deepEqual(
      songService
        .listSongs(songStore, { artist: '歌手甲' })
        .map((song) => song.name)
        .sort(),
      ['合作歌曲', '歌手甲独唱'].sort(),
    );
    assert.deepEqual(
      songService.listSongs(songStore, { artist: '歌手乙' }).map((song) => song.name),
      ['合作歌曲'],
    );
  } finally {
    closeDatabases(databases);
    fs.rmSync(dataDir, { recursive: true, force: true });
  }
});

test('song library language filter matches an individual language in a combined field', () => {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'song-library-language-filter-'));
  const databases = createDatabases({ dataDir });
  const songStore = createSongStore(databases.songDb);

  try {
    songService.saveSong(songStore, {
      name: '双语歌曲',
      artist: '歌手甲',
      language: '国语/英语',
    });
    songService.saveSong(songStore, {
      name: '国语歌曲',
      artist: '歌手乙',
      language: '国语',
    });
    songService.saveSong(songStore, {
      name: '粤语歌曲',
      artist: '歌手丙',
      language: '粤语',
    });

    assert.deepEqual(
      songService
        .listSongs(songStore, { language: '国语' })
        .map((song) => song.name)
        .sort(),
      ['双语歌曲', '国语歌曲'].sort(),
    );
    assert.deepEqual(
      songService.listSongs(songStore, { language: '英语' }).map((song) => song.name),
      ['双语歌曲'],
    );
  } finally {
    closeDatabases(databases);
    fs.rmSync(dataDir, { recursive: true, force: true });
  }
});

test('song library matches any selected complete tag and intersects category filters', () => {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'song-library-tag-filter-'));
  const databases = createDatabases({ dataDir });
  const songStore = createSongStore(databases.songDb);

  try {
    songService.saveSong(songStore, {
      name: '双标签匹配',
      categoryName: 'R&B / 说唱',
      tags: '抒情, 治愈',
    });
    songService.saveSong(songStore, {
      name: '只有抒情',
      categoryName: 'R&B / 说唱',
      tags: '抒情',
    });
    songService.saveSong(songStore, {
      name: '只有治愈',
      categoryName: '流行',
      tags: '治愈',
    });
    songService.saveSong(songStore, {
      name: '分类不同',
      categoryName: '民谣',
      tags: '抒情，治愈',
    });
    songService.saveSong(songStore, {
      name: '部分文字不算标签',
      categoryName: 'R&B / 说唱',
      tags: '治愈系',
    });

    assert.deepEqual(songService.listTags(songStore), ['抒情', '治愈', '治愈系']);
    assert.deepEqual(
      songService
        .listSongs(songStore, {
          categories: ['R&B', '流行'],
          tags: ['抒情', '治愈'],
        })
        .map((song) => song.name)
        .sort(),
      ['双标签匹配', '只有抒情', '只有治愈'].sort(),
    );
    assert.deepEqual(
      songService.listSongs(songStore, { tags: ['抒情', '摇滚'] }).map((song) => song.name).sort(),
      ['双标签匹配', '只有抒情', '分类不同'].sort(),
    );
    assert.deepEqual(songService.listSongs(songStore, { tags: ['摇滚'] }), []);
    assert.equal(songService.listSongs(songStore, { tags: [] }).length, 5);
  } finally {
    closeDatabases(databases);
    fs.rmSync(dataDir, { recursive: true, force: true });
  }
});

test('song library table escapes the language column', async () => {
  const elements = {
    songsTable: { innerHTML: '', addEventListener() {} },
    songNoteColumnHeader: { hidden: false },
    languageFilter: { value: '', innerHTML: '' },
    artistFilter: { value: '', innerHTML: '' },
    tagFilterOptions: { innerHTML: '' },
    tagFilterSummary: { textContent: '' },
    clearTagFilter: { disabled: false },
  };
  const escapeHtml = (value) => String(value).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  const songsModule = await loadSongsModule({
    document: { getElementById: (id) => elements[id], querySelectorAll: () => [] },
    window: {
      AdminApp: {
        utils: {
          escapeHtml,
          escapeAttr: escapeHtml,
          value: () => '',
          setValue() {},
          toast() {},
          showError() {},
          api: async () => {},
          debounce: (handler) => handler,
          dangerConfirm: async () => false,
        },
      },
    },
  });
  const filters = [new Set(), new Set(), new Set()];

  songsModule.renderSongs([{ id: 1, name: '双语歌曲', artist: '', is_enabled: true, language: '<b>英语</b>' }], ...filters);
  assert.match(elements.songsTable.innerHTML, /&lt;b&gt;英语&lt;\/b&gt;/);
  assert.doesNotMatch(elements.songsTable.innerHTML, /<b>英语/);
});
