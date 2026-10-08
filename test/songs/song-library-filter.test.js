'use strict';

const { readAdminFragmentHtml } = require('../helpers/admin-html');

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

test('category filter presents each slash-separated category on its own row', async () => {
  const { readSelectedTags, splitCategoryNames } = await loadCategoryFilterModule();

  const names = Array.from(
    splitCategoryNames([
      { name: '流行 / R&B / 说唱' },
      { name: 'R&B / 古风' },
      { name: '舞曲／流行' },
      { name: '默认' },
    ]),
  ).sort();

  assert.deepEqual(names, ['R&B', '古风', '流行', '舞曲', '说唱'].sort());
  assert.deepEqual(
    Array.from(
      readSelectedTags({
        querySelectorAll: () => [{ value: '抒情' }, { value: '治愈' }],
      }),
    ),
    ['抒情', '治愈'],
  );
});

test('song library multi-select filters allow only one open menu', () => {
  const html = readAdminFragmentHtml('pages/admin/song/library.html');

  assert.match(html, /<details\b(?=[^>]*\bid="categoryFilter")(?=[^>]*\bname="songLibraryFilter")[^>]*>/);
  assert.match(html, /<details\b(?=[^>]*\bid="tagFilter")(?=[^>]*\bname="songLibraryFilter")[^>]*>/);
});

test('song library filter menus close only when clicking outside', async () => {
  const { closeFilterMenusOnOutsideClick } = await loadCategoryFilterModule();
  const insideTarget = {};
  const outsideTarget = {};
  const filter = {
    open: true,
    contains: (target) => target === insideTarget,
  };

  closeFilterMenusOnOutsideClick({ target: insideTarget }, [filter]);
  assert.equal(filter.open, true);

  closeFilterMenusOnOutsideClick({ target: outsideTarget }, [filter]);
  assert.equal(filter.open, false);
});

test('song library requires every selected category and composes with other filters', () => {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'song-library-filter-'));
  const databases = createDatabases({ dataDir });
  const songStore = createSongStore(databases.songDb);

  try {
    songService.saveSong(songStore, {
      name: '双分类可点',
      artist: '歌手甲',
      categoryName: '流行 / R&B / 说唱',
      language: '国语',
    });
    songService.saveSong(songStore, {
      name: '双分类停用',
      artist: '歌手甲',
      categoryName: 'R&B / 说唱',
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
      categoryName: 'R&B / 说唱',
      language: '粤语',
    });

    assert.deepEqual(
      songService
        .listSongs(songStore, { categories: ['R&B', '说唱'] })
        .map((song) => song.name)
        .sort(),
      ['双分类停用', '双分类可点', '语言不同'],
    );
    assert.deepEqual(
      songService
        .listSongs(songStore, {
          categories: ['R&B', '说唱'],
          language: '国语',
          artist: '歌手甲',
          enabledOnly: true,
        })
        .map((song) => song.name),
      ['双分类可点'],
    );
    assert.deepEqual(songService.listSongs(songStore, { categories: ['R&B', '民谣'] }), []);
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

test('song library requires every selected complete tag and composes with category filters', () => {
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
          categories: ['R&B', '说唱'],
          tags: ['抒情', '治愈'],
        })
        .map((song) => song.name),
      ['双标签匹配'],
    );
    assert.deepEqual(songService.listSongs(songStore, { tags: ['抒情', '摇滚'] }), []);
  } finally {
    closeDatabases(databases);
    fs.rmSync(dataDir, { recursive: true, force: true });
  }
});

test('song library table displays the escaped language column and spans empty results across it', async () => {
  const html = readAdminFragmentHtml('pages/admin/song/library.html');
  const header = html.match(/<thead>((?:(?!<\/thead>)[\s\S])*)<\/thead>\s*<tbody id="songsTable"><\/tbody>/)?.[1];
  assert.ok(header, 'song table markup should remain present');
  assert.match(header, /<th>语言<\/th>/);
  const columnCount = header.match(/<th\b/g).length;

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

  songsModule.renderSongs([], ...filters);
  const colspan = Number(elements.songsTable.innerHTML.match(/colspan="(\d+)"/)?.[1]);
  assert.match(header, /id="songNoteColumnHeader"/);
  const visibleColumns = columnCount - (elements.songNoteColumnHeader.hidden ? 1 : 0);
  assert.equal(colspan, visibleColumns, 'the empty-result row must span every visible table column');
});

test('song library folds row actions into an accessible bordered menu', () => {
  const source = fs.readFileSync(path.join(ROOT_DIR, 'public', 'js', 'admin', 'songs.js'), 'utf8');
  const styles = fs.readFileSync(path.join(ROOT_DIR, 'public', 'css', 'admin', 'song-actions.css'), 'utf8');

  assert.match(source, /class="song-actions-trigger"[^>]+aria-haspopup="menu"[^>]+aria-expanded="false"/);
  assert.match(source, /class="song-actions-list" role="menu"[^>]+popover="manual"[^>]+hidden/);
  assert.match(source, /menu\.showPopover\(\)/);
  assert.match(source, /role="menuitem" data-edit-song=/);
  assert.match(source, /role="menuitem" data-add-song=/);
  assert.match(source, /class="danger" type="button" role="menuitem" data-delete-song=/);
  assert.match(styles, /\.song-actions-list:popover-open\s*\{[^}]*position: fixed;/s);
  assert.match(styles, /\.song-actions-list button\.danger\s*\{[^}]*border-color:/s);
});

test('song library hides the note column when every visible note is empty', async () => {
  const elements = {
    songsTable: { innerHTML: '', addEventListener() {} },
    songNoteColumnHeader: { hidden: false },
    languageFilter: { value: '', innerHTML: '' },
    artistFilter: { value: '', innerHTML: '' },
    tagFilterOptions: { innerHTML: '' },
    tagFilterSummary: { textContent: '' },
    clearTagFilter: { disabled: false },
  };
  const document = {
    getElementById: (id) => elements[id],
    querySelectorAll: () => [],
  };
  const window = {
    AdminApp: {
      utils: {
        escapeHtml: String,
        escapeAttr: String,
        value: () => '',
        setValue() {},
        toast() {},
        showError() {},
        api: async () => {},
        debounce: (handler) => handler,
        dangerConfirm: async () => false,
      },
    },
  };
  const songsModule = await loadSongsModule({ document, window });
  const filters = [new Set(), new Set(), new Set()];

  songsModule.renderSongs([{ id: 1, name: '无备注歌曲', artist: '', is_enabled: true, note: '  ' }], ...filters);
  assert.equal(elements.songNoteColumnHeader.hidden, true);
  assert.doesNotMatch(elements.songsTable.innerHTML, /<td>  <\/td>/);

  songsModule.renderSongs(
    [
      {
        id: 2,
        name: '有备注歌曲',
        artist: '',
        is_enabled: true,
        note: '待核对',
      },
    ],
    ...filters,
  );
  assert.equal(elements.songNoteColumnHeader.hidden, false);
  assert.match(elements.songsTable.innerHTML, /<td>待核对<\/td>/);
});

test('song deletion closes custom confirmation before deleting and refreshing', async () => {
  const tableHandlers = {};
  const elements = {
    songsTable: { innerHTML: '', addEventListener(name, handler) { tableHandlers[name] = handler; } },
    songNoteColumnHeader: { hidden: false },
    languageFilter: { value: '', innerHTML: '' },
    artistFilter: { value: '', innerHTML: '' },
    tagFilterOptions: { innerHTML: '' },
    tagFilterSummary: { textContent: '' },
    clearTagFilter: { disabled: false },
  };
  const deleteButton = {
    dataset: { deleteSong: '42' },
    // Row actions are delegated to the table, so the row button resolves itself.
    closest: (selector) => (selector === '[data-delete-song]' ? deleteButton : null),
  };
  const calls = [];
  const document = {
    getElementById: (id) => elements[id],
    querySelectorAll: () => [],
  };
  const window = {
    AdminApp: {
      utils: {
        escapeHtml: String,
        escapeAttr: String,
        value: () => '',
        setValue() {},
        toast: (message) => calls.push(['toast', message]),
        showError() {},
        api: async (url, body) => calls.push(['api', url, body.id]),
        debounce: (handler) => handler,
        dangerConfirm: async (options) => {
          calls.push(['confirm', options.title]);
          return true;
        },
      },
      state: {
        reloadAll: async () => calls.push(['reload']),
      },
    },
  };
  const songsModule = await loadSongsModule({ document, window });

  songsModule.renderSongs(
    [{ id: 42, name: 'Test song', artist: 'Test artist', is_enabled: true }],
    new Set(),
    new Set(),
    new Set(),
  );
  // Delegated row actions are fire-and-forget in the browser, so the test flushes their promise chain.
  tableHandlers.click({ target: deleteButton });
  await new Promise((resolve) => setImmediate(resolve));

  assert.deepEqual(
    calls.map((call) => call[0]),
    ['confirm', 'api', 'toast', 'reload'],
  );
  assert.deepEqual(calls[1], ['api', '/api/songs/delete', '42']);
});
