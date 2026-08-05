'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');
const { fileURLToPath, pathToFileURL } = require('node:url');
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

async function loadSongsModule(globals) {
  const modules = new Map();
  const context = vm.createContext({ console, ...globals });
  const filePath = path.join(ROOT_DIR, 'public', 'js', 'admin', 'songs.js');

  async function load(modulePath) {
    const identifier = pathToFileURL(modulePath).href;
    if (modules.has(identifier)) return modules.get(identifier);
    const module = new vm.SourceTextModule(fs.readFileSync(modulePath, 'utf8'), {
      context,
      identifier
    });
    modules.set(identifier, module);
    await module.link((specifier, referencingModule) => (
      load(fileURLToPath(new URL(specifier, referencingModule.identifier)))
    ));
    return module;
  }

  const module = await load(filePath);
  await module.evaluate();
  return globals.window.AdminApp.songs;
}

test('category filter presents each slash-separated category on its own row', async () => {
  const { readSelectedTags, splitCategoryNames } = await loadCategoryFilterModule();

  const names = Array.from(splitCategoryNames([
      { name: '流行 / R&B / 说唱' },
      { name: 'R&B / 古风' },
      { name: '舞曲／流行' },
      { name: '默认' }
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

test('song deletion closes custom confirmation before deleting and refreshing', async () => {
  const elements = {
    songsTable: { innerHTML: '' },
    languageFilter: { value: '', innerHTML: '' },
    artistFilter: { value: '', innerHTML: '' },
    tagFilterOptions: { innerHTML: '' },
    tagFilterSummary: { textContent: '' },
    clearTagFilter: { disabled: false }
  };
  const deleteButton = {
    dataset: { deleteSong: '42' },
    addEventListener(eventName, handler) {
      if (eventName === 'click') this.click = handler;
    }
  };
  const calls = [];
  const document = {
    getElementById: id => elements[id],
    querySelectorAll(selector) {
      if (selector === '[data-delete-song]') return [deleteButton];
      return [];
    }
  };
  const window = {
    AdminApp: {
      utils: {
        escapeHtml: String,
        escapeAttr: String,
        value: () => '',
        setValue() {},
        toast: message => calls.push(['toast', message]),
        showError() {},
        api: async (url, body) => calls.push(['api', url, body.id]),
        debounce: handler => handler,
        dangerConfirm: async options => {
          calls.push(['confirm', options.title]);
          return true;
        }
      },
      state: {
        reloadAll: async () => calls.push(['reload'])
      }
    }
  };
  const songsModule = await loadSongsModule({ document, window });

  songsModule.renderSongs([
    { id: 42, name: 'Test song', artist: 'Test artist', is_enabled: true }
  ], new Set(), new Set(), new Set());
  await deleteButton.click();

  assert.deepEqual(calls.map(call => call[0]), ['confirm', 'api', 'toast', 'reload']);
  assert.deepEqual(calls[1], ['api', '/api/songs/delete', '42']);
});
