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
    window.songs = createSongs({ state: { reloadSongs() {}, reloadAll() {} } });
    window.songs.initSongForm();
    window.renderSongs = (songs) => window.songs.renderSongs(songs, ...filters);
    window.renderSongs(window.library);
  });
  return page;
}

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
