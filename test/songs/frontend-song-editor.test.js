'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { createUiFixture } = require('../helpers/ui-edit-state-fixture');
const { readAdminFragmentHtml } = require('../helpers/admin-html');

const fixture = createUiFixture();

async function open(t) {
  const page = await fixture(t, 'song-editor');
  await page.setContent(readAdminFragmentHtml('pages/admin/song/library.html'));
  await page.evaluate(async () => {
    const { createSongs } = await import('/js/admin/songs.js');
    window.library = [
      { id: 1, name: '歌曲甲', artist: '歌手甲', language: '国语', is_enabled: true },
      { id: 2, name: '歌曲乙', artist: '歌手乙', language: '英语', is_enabled: true },
    ];
    const filters = [new Set(), new Set(), new Set()];
    window.songState = { reloadSongs() {}, reloadAll() {}, reloadState() {} };
    window.songs = createSongs({ state: window.songState });
    window.songs.initSongForm();
    window.renderSongs = (songs) => window.songs.renderSongs(songs, ...filters);
    window.renderSongs(window.library);
  });
  return page;
}

test('song multiselects show union hints and retain independent category choices on refresh', async (t) => {
  const page = await open(t);
  await page.evaluate(() => {
    window.categoryRows = [
      { name: '儿歌; 流行；儿歌' },
      { name: '儿歌；甜歌' },
      { name: '流行，R&B' },
    ];
    window.filterChanges = [];
    window.songState.reloadSongs = () => window.filterChanges.push(window.songs.readSongFilters().categories);
    window.songs.renderCategoryFilter(window.categoryRows);
  });
  await page.locator('#categoryFilter summary').click();
  assert.equal(await page.locator('#categoryFilter .lira-multiselect-hint').textContent(), '匹配任一');
  const options = page.locator('#categoryFilterOptions');
  assert.deepEqual(
    await options.locator('input').evaluateAll((inputs) => inputs.map((input) => input.value).sort()),
    ['儿歌', '流行', '甜歌', 'R&B'].sort(),
  );
  for (const name of ['儿歌', '流行']) {
    await options.getByRole('checkbox', { name, exact: true }).check();
  }
  assert.deepEqual(await page.evaluate(() => window.filterChanges), [['儿歌'], ['儿歌', '流行']]);
  await page.evaluate(() => window.songs.renderCategoryFilter(window.categoryRows));
  assert.equal(await options.locator('input:checked').count(), 2);
  assert.equal(await page.locator('#categoryFilterSummary').textContent(), '儿歌、流行');
  await page.locator('#clearCategoryFilter').click();
  assert.equal(await options.locator('input:checked').count(), 0);
  assert.equal(await page.locator('#categoryFilterSummary').textContent(), '全部分类');
  assert.deepEqual(await page.evaluate(() => window.filterChanges), [['儿歌'], ['儿歌', '流行'], []]);
  await page.evaluate(() => window.songs.renderTagFilter(new Set(['抒情', '治愈'])));
  await page.locator('#tagFilter summary').click();
  assert.equal(await page.locator('#tagFilter .lira-multiselect-hint').textContent(), '匹配任一');
  for (const name of ['抒情', '治愈']) {
    await page.locator('#tagFilterOptions').getByRole('checkbox', { name, exact: true }).check();
  }
  assert.deepEqual(await page.evaluate(() => window.songs.readSongFilters().tags), ['抒情', '治愈']);
  assert.equal(await page.locator('#tagFilterSummary').textContent(), '抒情、治愈');
  await page.locator('#clearTagFilter').click();
  assert.deepEqual(await page.evaluate(() => window.songs.readSongFilters().tags), []);
  assert.equal(await page.locator('#tagFilterSummary').textContent(), '全部标签');
});

test('a large song library renders bounded pages and keeps page actions and filters consistent', async (t) => {
  const page = await open(t);
  await page.evaluate(() => {
    window.library = Array.from({ length: 5000 }, (_, index) => ({
      id: index + 1, name: `歌曲 ${index + 1}`, artist: '测试歌手', is_enabled: true,
    }));
    for (let count = 0; count < 3; count++) window.renderSongs(window.library);
  });
  assert.equal(await page.locator('#songsTable tr').count(), 100);
  assert.equal(await page.locator('#songLibraryPage').textContent(), '第 1 / 50 页');
  await page.locator('#songLibraryNextPage').click();
  assert.equal(await page.locator('#songLibraryPage').textContent(), '第 2 / 50 页');
  assert.equal(await page.locator('[data-edit-song="101"]').count(), 1);
  await page.locator('[data-edit-song="101"]').dispatchEvent('click');
  await page.waitForFunction(() => document.getElementById('songId').value === '101');
  assert.equal(await page.locator('#songName').inputValue(), '歌曲 101');
  await page.locator('[data-add-song="101"]').dispatchEvent('click');
  await page.waitForFunction(() => window.pendingSaves.length === 1);
  assert.deepEqual(await page.evaluate(() => window.pendingSaves.map(({ url, body }) => [url, body.songName])), [
    ['/api/queue/add', '歌曲 101'],
  ]);
  await page.evaluate(() => {
    window.pendingSaves[0].resolve({ ok: true });
    window.renderSongs(window.library);
  });
  assert.equal(await page.locator('#songLibraryPage').textContent(), '第 2 / 50 页', 'refresh preserves the current page');
  await page.locator('#songSearch').fill('歌曲 4001');
  await page.evaluate(() => window.renderSongs(window.library.slice(4000, 4001)));
  assert.equal(await page.locator('#songsTable tr').count(), 1);
  assert.equal(await page.locator('[data-edit-song="4001"]').count(), 1);
  assert.equal(await page.locator('#songLibraryPagination').isVisible(), false);
  await page.locator('#songSearch').fill('');
  await page.evaluate(() => window.renderSongs(window.library));
  assert.equal(await page.locator('#songLibraryPage').textContent(), '第 1 / 50 页');
});

test('deleting the only song on the last page returns to the preceding page', async (t) => {
  const page = await open(t);
  await page.evaluate(() => {
    window.library = Array.from({ length: 201 }, (_, index) => ({ id: index + 1, name: `歌曲 ${index + 1}`, is_enabled: true }));
    window.songState.reloadAll = () => {
      window.library.pop();
      window.renderSongs(window.library);
    };
    window.renderSongs(window.library);
  });
  await page.locator('#songLibraryNextPage').click();
  await page.locator('#songLibraryNextPage').click();
  assert.equal(await page.locator('#songsTable tr').count(), 1);
  await page.locator('[data-delete-song="201"]').dispatchEvent('click');
  await page.getByRole('button', { name: '确认删除', exact: true }).click();
  await page.waitForFunction(() => window.pendingSaves.length === 1);
  assert.deepEqual(await page.evaluate(() => window.pendingSaves.map(({ url, body }) => [url, body.id])), [
    ['/api/songs/delete', '201'],
  ]);
  await page.evaluate(() => window.pendingSaves[0].resolve({ ok: true }));
  await page.waitForFunction(() => document.getElementById('songLibraryPage').textContent === '第 2 / 2 页');
  assert.equal(await page.locator('#songsTable tr').count(), 100);
  assert.equal(await page.locator('#songLibraryNextPage').isDisabled(), true);
});

for (const switchSong of [false, true]) test(`deleting the edited song ${switchSong ? 'preserves a later edit' : 'resets the editor'}`, async (t) => {
  const page = await open(t);
  await page.locator('[data-edit-song="1"]').dispatchEvent('click');
  await page.waitForFunction(() => document.getElementById('songId').value === '1');
  await page.locator('[data-delete-song="1"]').dispatchEvent('click');
  await page.getByRole('button', { name: '确认删除', exact: true }).click();
  await page.waitForFunction(() => window.pendingSaves.length === 1);
  if (switchSong) {
    await page.locator('[data-edit-song="2"]').dispatchEvent('click');
    await page.waitForFunction(() => document.getElementById('songId').value === '2');
    await page.locator('#songName').fill('新的未保存草稿');
  }
  await page.evaluate(() => window.pendingSaves[0].resolve({ ok: true }));
  await page.waitForFunction(() => window.messages.length === 1);
  assert.equal(await page.locator('#songId').inputValue(), switchSong ? '2' : '');
  assert.equal(await page.locator('#songName').inputValue(), switchSong ? '新的未保存草稿' : '');
});

test('a complete library refresh resets the editor only when its song was removed', async (t) => {
  const page = await open(t);
  await page.evaluate(() => {
    window.renderComplete = (songs) => window.songs.renderSongs(songs, new Set(), new Set(), new Set(), { complete: true });
    window.renderComplete(window.library);
  });
  await page.locator('[data-edit-song="1"]').dispatchEvent('click');
  await page.waitForFunction(() => document.getElementById('songId').value === '1');
  await page.evaluate(() => window.renderSongs([window.library[1]]));
  assert.equal(await page.locator('#songId').inputValue(), '1', 'a filtered result is not treated as a deletion');
  await page.evaluate(() => window.renderComplete([window.library[1]]));
  assert.equal(await page.locator('#songId').inputValue(), '');
  assert.equal(await page.locator('#songFormTitle').isVisible(), false);
  await page.evaluate(() => {
    document.getElementById('songId').value = '3';
    window.renderComplete([window.library[1]]);
  });
  assert.equal(await page.locator('#songId').inputValue(), '3', 'a newly saved song not yet listed stays in the editor');
});

test('song editing protects drafts when changing songs or clearing the form', async (t) => {
  const page = await open(t);
  await page.locator('[data-edit-song="1"]').dispatchEvent('click');
  await page.waitForFunction(() => document.getElementById('songId').value === '1');
  await page.locator('#songName').fill('未保存的标题');
  await page.locator('[data-edit-song="1"]').dispatchEvent('click');
  assert.equal(await page.locator('[role="dialog"]').count(), 0);
  assert.equal(await page.locator('#songName').inputValue(), '未保存的标题');
  await page.locator('[data-edit-song="2"]').dispatchEvent('click');
  await page.getByRole('button', { name: '继续编辑', exact: true }).click();
  await page.locator('.lira-confirm-backdrop').waitFor({ state: 'detached' });
  assert.equal(await page.locator('#songName').inputValue(), '未保存的标题');
  assert.equal(await page.evaluate(() => document.activeElement.id), 'songName');
  await page.locator('[data-edit-song="2"]').dispatchEvent('click');
  await page.getByRole('button', { name: '放弃修改', exact: true }).click();
  await page.locator('.lira-confirm-backdrop').waitFor({ state: 'detached' });
  assert.equal(await page.locator('#songName').inputValue(), '歌曲乙');
  await page.locator('#songNote').fill('新备注');
  await page.locator('#resetSongForm').click();
  await page.getByRole('button', { name: '继续编辑', exact: true }).click();
  await page.locator('.lira-confirm-backdrop').waitFor({ state: 'detached' });
  assert.equal(await page.locator('#songNote').inputValue(), '新备注');
  await page.locator('#resetSongForm').click();
  await page.getByRole('button', { name: '放弃修改', exact: true }).click();
  await page.locator('.lira-confirm-backdrop').waitFor({ state: 'detached' });
  assert.equal(await page.locator('#songName').inputValue(), '');
  await page.locator('[data-edit-song="1"]').dispatchEvent('click');
  await page.waitForFunction(() => document.getElementById('songId').value === '1');
  assert.equal(await page.locator('[role="dialog"]').count(), 0);
});

test('a completed song save clears the unchanged submitted form', async (t) => {
  const page = await open(t);
  await page.locator('#songName').fill('新歌曲');
  await page.getByRole('button', { name: '保存歌曲', exact: true }).click();
  await page.waitForFunction(() => window.pendingSaves.length === 1);
  await page.evaluate(() => window.pendingSaves[0].resolve({ ok: true, data: { id: 3 } }));
  await page.waitForFunction(() => window.messages.includes('歌曲已保存到本地'));
  assert.equal(await page.locator('#songName').inputValue(), '');
  assert.equal(await page.locator('#songId').inputValue(), '');
});

test('a completed song save preserves later edits and advances the saved baseline', async (t) => {
  const page = await open(t);
  await page.locator('[data-edit-song="1"]').dispatchEvent('click');
  await page.waitForFunction(() => document.getElementById('songId').value === '1');
  await page.locator('#songName').fill('保存的标题');
  await page.getByRole('button', { name: '保存歌曲', exact: true }).click();
  await page.waitForFunction(() => window.pendingSaves.length === 1);
  await page.locator('#songName').fill('保存期间继续编辑的标题');
  await page.evaluate(() => window.pendingSaves[0].resolve({ ok: true, data: { id: 1 } }));
  await page.waitForFunction(() => window.messages.includes('歌曲已保存到本地'));
  assert.equal(await page.locator('#songName').inputValue(), '保存期间继续编辑的标题');
  assert.equal(await page.locator('#songId').inputValue(), '1');
  await page.locator('#resetSongForm').click();
  await page.getByRole('button', { name: '继续编辑', exact: true }).click();
  await page.locator('.lira-confirm-backdrop').waitFor({ state: 'detached' });
  await page.locator('#songName').fill('保存的标题');
  await page.locator('[data-edit-song="2"]').dispatchEvent('click');
  await page.waitForFunction(() => document.getElementById('songId').value === '2');
  assert.equal(await page.locator('[role="dialog"]').count(), 0);
});

test('later edits to a newly saved song keep its id for the next save', async (t) => {
  const page = await open(t);
  await page.locator('#songName').fill('新歌曲');
  await page.getByRole('button', { name: '保存歌曲', exact: true }).click();
  await page.waitForFunction(() => window.pendingSaves.length === 1);
  await page.locator('#songName').fill('新歌曲的后续标题');
  await page.evaluate(() => window.pendingSaves[0].resolve({ ok: true, data: { id: 3 } }));
  await page.waitForFunction(() => document.getElementById('songId').value === '3');
  assert.equal(await page.locator('#songName').inputValue(), '新歌曲的后续标题');
  await page.getByRole('button', { name: '保存歌曲', exact: true }).click();
  await page.waitForFunction(() => window.pendingSaves.length === 2);
  assert.deepEqual(await page.evaluate(() => {
    const { id, name } = window.pendingSaves[1].body;
    return { id, name };
  }), { id: '3', name: '新歌曲的后续标题' });
  await page.evaluate(() => window.pendingSaves[1].resolve({ ok: true, data: { id: 3 } }));
  await page.waitForFunction(() => document.getElementById('songName').value === '');
});

test('an earlier save cannot clear a different song or a reopened editor', async (t) => {
  const page = await open(t);
  await page.locator('[data-edit-song="1"]').dispatchEvent('click');
  await page.waitForFunction(() => document.getElementById('songId').value === '1');
  await page.getByRole('button', { name: '保存歌曲', exact: true }).click();
  await page.waitForFunction(() => window.pendingSaves.length === 1);
  await page.locator('[data-edit-song="2"]').dispatchEvent('click');
  await page.waitForFunction(() => document.getElementById('songId').value === '2');
  await page.evaluate(() => window.pendingSaves[0].resolve({ ok: true, data: { id: 1 } }));
  await page.waitForFunction(() => window.messages.length === 1);
  assert.equal(await page.locator('#songId').inputValue(), '2');
  assert.equal(await page.locator('#songName').inputValue(), '歌曲乙');

  await page.getByRole('button', { name: '保存歌曲', exact: true }).click();
  await page.waitForFunction(() => window.pendingSaves.length === 2);
  await page.locator('#resetSongForm').click();
  await page.locator('[data-edit-song="2"]').dispatchEvent('click');
  await page.waitForFunction(() => document.getElementById('songId').value === '2');
  await page.evaluate(() => window.pendingSaves[1].resolve({ ok: true, data: { id: 2 } }));
  await page.waitForFunction(() => window.messages.length === 2);
  assert.equal(await page.locator('#songId').inputValue(), '2');
  assert.equal(await page.locator('#songName').inputValue(), '歌曲乙');
});

test('song filter candidates survive filtering and refresh after clearing all filters', async (t) => {
  const page = await open(t);
  await page.locator('#artistFilter').selectOption('歌手甲');
  await page.evaluate(() => window.renderSongs([window.library[0]]));
  assert.deepEqual(await page.locator('#artistFilter option').allTextContents(), ['全部歌手', '歌手甲', '歌手乙']);
  assert.deepEqual(await page.locator('#languageFilter option').allTextContents(), ['全部语言', '国语', '英语']);
  await page.locator('#artistFilter').selectOption('歌手乙');
  await page.locator('#languageFilter').selectOption('英语');
  await page.evaluate(() => window.renderSongs([window.library[1]]));
  assert.equal(await page.locator('#artistFilter').inputValue(), '歌手乙');
  assert.equal(await page.locator('#languageFilter').inputValue(), '英语');
  await page.locator('#artistFilter').selectOption('');
  await page.locator('#languageFilter').selectOption('');
  await page.evaluate(() => window.renderSongs([window.library[1]]));
  assert.deepEqual(await page.locator('#artistFilter option').allTextContents(), ['全部歌手', '歌手乙']);
  assert.deepEqual(await page.locator('#languageFilter option').allTextContents(), ['全部语言', '英语']);
});
