'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const test = require('node:test');

async function createForm() {
  const elements = new Map();
  function element(id) {
    if (!elements.has(id)) elements.set(id, {
      value: '', textContent: '', innerHTML: '', events: {},
      addEventListener(name, handler) { this.events[name] = handler; },
      setCustomValidity(message) { this.validationMessage = message; },
      reportValidity() { return !this.validationMessage; },
      focus() {},
    });
    return elements.get(id);
  }
  const edit = element('edit');
  edit.dataset = { editSong: '7' };
  const calls = [];
  const escapeHtml = (input) => String(input).replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;');
  const window = {
    addEventListener() {},
    AdminApp: { utils: {
      escapeHtml, escapeAttr: escapeHtml,
      value: (id) => element(id).value.trim(),
      setValue: (id, next) => { element(id).value = String(next ?? ''); },
      toast: (message) => calls.push({ toast: message }),
      api: async (url, body) => calls.push({ url, body }),
      debounce: (handler) => handler,
    } },
  };
  const document = {
    getElementById: element,
    querySelectorAll: (selector) => selector === '[data-edit-song]' ? [edit] : [],
    addEventListener() {},
  };
  const context = vm.createContext({ window, document });
  const modules = new Map();
  async function load(file) {
    if (modules.has(file)) return modules.get(file);
    const module = new vm.SourceTextModule(fs.readFileSync(file, 'utf8'), { context, identifier: file });
    modules.set(file, module);
    await module.link((specifier) => load(path.resolve(path.dirname(file), specifier)));
    return module;
  }
  const module = await load(path.resolve(__dirname, '../public/js/admin/songs.js'));
  await module.evaluate();
  const songs = window.AdminApp.songs;
  songs.initSongForm();
  const submit = () => element('songForm').events.submit({ preventDefault() {} });
  const render = (price, clip = '') => songs.renderSongs([
    { id: 7, name: '测试歌', artist: '歌手', is_enabled: true, request_price: price, song_clip: clip },
  ], new Set(), new Set(), new Set());
  return { element, edit, songs, calls, submit, render };
}

test('song form edits and clears price and clip, resets presets, and escapes list metadata', async () => {
  const { element, edit, songs, calls, submit, render } = await createForm();
  const price = '舰长 "原文"\n<script>价格</script>';
  render(price, 'BV1\n<img>');
  assert.match(element('songsTable').innerHTML, /&lt;script&gt;价格&lt;\/script&gt;/);
  assert.match(element('songsTable').innerHTML, /&lt;img&gt;/);
  await edit.events.click();
  assert.equal(element('songRequestPrice').value, price);
  assert.equal(element('songClip').value, 'BV1\n<img>');
  assert.equal(element('songPricePreview').textContent, price);
  await submit();
  assert.equal(calls.find((call) => call.url).body.requestPrice, price);
  assert.equal(calls.find((call) => call.url).body.songClip, 'BV1\n<img>');
  assert.ok(calls.some((call) => call.toast?.includes('本地')));
  for (const id of ['songId', 'songRequestPrice', 'songClip', 'songPricePreset']) assert.equal(element(id).value, '');
  await edit.events.click();
  element('songRequestPrice').value = '';
  element('songClip').value = '';
  await submit();
  assert.equal(calls.filter((call) => call.url).at(-1).body.requestPrice, '');
  assert.equal(calls.filter((call) => call.url).at(-1).body.songClip, '');
  render('');
  assert.doesNotMatch(element('songsTable').innerHTML, />免费</);
  songs.resetSongForm();
  assert.equal(element('songPricePreview').textContent, '');
});

test('price length uses UTF-16 units, preserves historical values and blocks overlength saves', async () => {
  const { element, edit, calls, submit, render } = await createForm();
  const historical = '🎵'.repeat(500) + '字';
  render(historical);
  await edit.events.click();
  assert.equal(element('songRequestPrice').value, historical);
  assert.match(element('songPriceLength').textContent, /1001 \/ 1000/);
  await submit();
  assert.equal(calls.filter((call) => call.url).length, 0);
  element('songRequestPrice').value = '🎵'.repeat(500);
  element('songRequestPrice').events.input();
  await submit();
  assert.equal(calls.filter((call) => call.url).length, 1);
  element('songPricePreset').value = '舰长';
  element('songPricePreset').events.change();
  assert.equal(element('songRequestPrice').value, '舰长');
  element('songRequestPrice').value = '30元SC';
  element('songRequestPrice').events.input();
  assert.equal(element('songPricePreset').value, '');
  assert.equal(element('songPricePreview').textContent, '30元SC');
});
