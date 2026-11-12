'use strict';

const assert = require('node:assert/strict');
const path = require('node:path');
const test = require('node:test');

async function createForm() {
  const elements = new Map();
  function element(id) {
    if (!elements.has(id))
      elements.set(id, {
        value: '',
        textContent: '',
        innerHTML: '',
        hidden: false,
        classList: { contains: name => name === 'active' },
        events: {},
        addEventListener(name, handler) {
          this.events[name] = handler;
        },
        setCustomValidity(message) {
          this.validationMessage = message;
        },
        reportValidity() {
          return !this.validationMessage;
        },
        focus() {},
      });
    return elements.get(id);
  }
  const edit = element('edit');
  edit.dataset = { editSong: '7' };
  // Row actions are delegated to the table, so the fake row button only needs to resolve itself.
  edit.closest = (selector) => (selector === '[data-edit-song]' ? edit : null);
  const calls = [];
  const escapeHtml = (input) => String(input).replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;');
  const window = {
    addEventListener() {},
    AdminApp: {
      utils: {
        escapeHtml,
        escapeAttr: escapeHtml,
        value: (id) => element(id).value.trim(),
        setValue: (id, next) => {
          element(id).value = String(next ?? '');
        },
        toast: (message) => calls.push({ toast: message }),
        api: async (url, body) => calls.push({ url, body }),
        debounce: (handler) => handler,
      },
    },
  };
  const document = {
    getElementById: element,
    querySelector: selector => selector === '#songForm button[type="submit"]' ? element('songSubmit') : null,
    querySelectorAll: () => [],
    addEventListener() {},
  };
  const utils = window.AdminApp.utils;
  const { loadModuleExports } = require('../helpers/frontend-modules');
  const { createSongs } = await loadModuleExports(path.resolve(__dirname, '../../public/js/admin/songs.js'), {
    window,
    document,
    MutationObserver: class { observe() {} disconnect() {} },
  });
  const songs = createSongs({ utils, state: { reloadAll: async () => {} } });
  songs.initSongForm();
  const submit = () => element('songForm').events.submit({ preventDefault() {} });
  const render = (price, clip = '') =>
    songs.renderSongs(
      [
        {
          id: 7,
          name: '测试歌',
          artist: '歌手',
          is_enabled: true,
          request_price: price,
          song_clip: clip,
        },
      ],
      new Set(),
      new Set(),
      new Set(),
    );
  const clickEdit = () => element('songsTable').events.click({ target: edit });
  return { element, edit, songs, calls, submit, render, clickEdit };
}

test('song form edits and clears price and clip and escapes list metadata', async () => {
  const { element, calls, submit, render, clickEdit } = await createForm();
  const price = '舰长 "原文"\n<script>价格</script>';
  render(price, 'BV1\n<img>');
  assert.match(element('songsTable').innerHTML, /&lt;script&gt;价格&lt;\/script&gt;/);
  assert.match(element('songsTable').innerHTML, /&lt;img&gt;/);
  await clickEdit();
  assert.equal(element('songRequestPrice').value, price);
  assert.equal(element('songClip').value, 'BV1\n<img>');
  await submit();
  assert.equal(calls.find((call) => call.url).body.requestPrice, price);
  assert.equal(calls.find((call) => call.url).body.songClip, 'BV1\n<img>');
  for (const id of ['songId', 'songRequestPrice', 'songClip', 'songPricePreset']) assert.equal(element(id).value, '');
  await clickEdit();
  element('songRequestPrice').value = '';
  element('songClip').value = '';
  await submit();
  assert.equal(calls.filter((call) => call.url).at(-1).body.requestPrice, '');
  assert.equal(calls.filter((call) => call.url).at(-1).body.songClip, '');
});

test('price length uses UTF-16 units, preserves historical values and blocks overlength saves', async () => {
  const { element, calls, submit, render, clickEdit } = await createForm();
  const historical = '🎵'.repeat(500) + '字';
  render(historical);
  await clickEdit();
  assert.equal(element('songRequestPrice').value, historical);
  await submit();
  assert.equal(calls.filter((call) => call.url).length, 0);
  element('songRequestPrice').value = '🎵'.repeat(500);
  element('songRequestPrice').events.input();
  await submit();
  assert.equal(calls.filter((call) => call.url).length, 1);
});
