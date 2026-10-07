'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const { randomUUID } = require('node:crypto');
const { createTextBoxDefaults, normalizeTextBoxConfig } = require('../../public/js/shared/text-box-config.js');
const { normalizeSceneDocument } = require('../../src/scenes/scene-contract');
const { normalizeSceneConfig } = require('../../src/server/scene-components');
const { validateSceneDocument, exportSceneTemplate, importSceneTemplate } = require('../../public/js/admin/scene-template.js');

function item(config, x = 0) {
  return { id: randomUUID(), type: 'text-box', name: '文本框', x, y: 0, width: 640, height: 180,
    visible: true, locked: false, appearance: { mode: 'independent', config } };
}

test('text boxes preserve structured text, formatting and atomic images without sharing mutable defaults', () => {
  const input = { ...createTextBoxDefaults(), nodes: [
    { type: 'text', text: '你好\r\n(｡･ω･｡)ﾉ♡', bold: true, italic: false, underline: true, stroke: true, shadow: false, fontSize: 48, color: '#AABBCC' },
    { type: 'gift', name: '测试礼物', src: '/overtime-gift-images/123-a1.gif', giftId: 123, fontSize: 40 },
    { type: 'image', name: '上传动图', src: '/scene-text-images/11111111-1111-4111-8111-111111111111.gif' },
  ] };
  const result = normalizeSceneConfig('text-box', input);
  assert.equal(result.nodes[0].text, '你好\n(｡･ω･｡)ﾉ♡');
  assert.equal(result.nodes[0].color, '#aabbcc');
  assert.equal(result.nodes[0].stroke, true);
  assert.equal(result.nodes[0].shadow, false);
  assert.deepEqual(normalizeTextBoxConfig(createTextBoxDefaults()), createTextBoxDefaults());
  assert.equal(result.nodes[1].giftId, '123');
  assert.equal(result.nodes[2].src, input.nodes[2].src);
  result.nodes[0].text = 'changed';
  assert.notEqual(input.nodes[0].text, result.nodes[0].text);
  const first = createTextBoxDefaults();
  first.nodes[0].text = 'changed';
  assert.notEqual(first.nodes[0].text, createTextBoxDefaults().nodes[0].text);
});

test('text box configuration rejects HTML payloads, arbitrary requests, invalid formatting and shared ownership', () => {
  const invalidNodes = [
    { type: 'html', name: 'markup', src: '<script>alert(1)</script>' },
    { type: 'text', text: 'hello', html: '<script>alert(1)</script>' },
    { type: 'text', text: 'hello', bold: 'true' },
    { type: 'text', text: 'hello', fontSize: 1000 },
    { type: 'text', text: 'hello', color: 'url(https://example.test)' },
    { type: 'text', text: 'hello', stroke: 'true' },
    { type: 'text', text: 'hello', shadow: '0 2px 3px red' },
    { type: 'text', text: 'hello', stroke: 1 },
    { type: 'text', text: 'hello', shadow: null },
    { type: 'gift', name: 'gift', src: '/img/gift-placeholder.png', stroke: true },
    ...['javascript:alert(1)', 'data:image/svg+xml,test', 'file:///private.png',
      'https://tracker.example/pixel.gif', '/overtime-gift-images/../private.png',
      'https://i0.hdslb.com/bfs/live/a.png?token=secret',
      'https://i0.hdslb.com.evil.test/bfs/live/a.png'].map(src => ({ type: 'gift', name: 'gift', src })),
    { type: 'image', name: 'image', src: '/img/gift-placeholder.png' },
  ];
  for (const node of invalidNodes) assert.throws(() => normalizeTextBoxConfig({ ...createTextBoxDefaults(), nodes: [node] }),
    { code: 'INVALID_SCENE_CONFIG' });
  const document = { schemaVersion: 1, id: randomUUID(), title: 'test', canvas: { width: 1920, height: 1080 },
    items: [{ ...item(createTextBoxDefaults()), appearance: { mode: 'shared' } }] };
  assert.throws(() => normalizeSceneDocument(document, { normalizeConfig: normalizeSceneConfig }));
});

test('frontend and backend allow more than 32 text boxes while retaining other component and UTF-8 byte limits', () => {
  const document = { schemaVersion: 1, id: randomUUID(), title: 'many text boxes', canvas: { width: 1920, height: 1080 },
    items: Array.from({ length: 40 }, () => item(createTextBoxDefaults())) };
  const ordinaryItem = () => ({ ...item(null), type: 'clock', appearance: { mode: 'shared' } });
  document.items.push(...Array.from({ length: 32 }, ordinaryItem));
  for (const validate of [validateSceneDocument, input => normalizeSceneDocument(input, { normalizeConfig: normalizeSceneConfig })]) {
    assert.equal(validate(document).items.length, 72);
    assert.throws(() => validate({ ...document, items: [...document.items, ordinaryItem()] }));
    assert.equal(validate({ ...document, items: [...document.items, item(createTextBoxDefaults())] }).items.length, 73);
  }
  const bounded = { ...document, items: [item({ ...createTextBoxDefaults(), nodes: [{ type: 'text', text: '中文' }] })] };
  const remaining = 256 * 1024 - Buffer.byteLength(JSON.stringify(bounded), 'utf8');
  bounded.items[0].appearance.config.nodes[0].text += 'a'.repeat(remaining);
  assert.equal(Buffer.byteLength(JSON.stringify(bounded), 'utf8'), 256 * 1024);
  assert.doesNotThrow(() => validateSceneDocument(bounded));
  assert.doesNotThrow(() => normalizeSceneDocument(bounded, { normalizeConfig: normalizeSceneConfig }));
  bounded.items[0].appearance.config.nodes[0].text += 'a';
  assert.throws(() => validateSceneDocument(bounded));
  assert.throws(() => normalizeSceneDocument(bounded, { normalizeConfig: normalizeSceneConfig }));
});

test('text box templates explicitly retain or remove image nodes without changing adjacent content', () => {
  const nodes = [
    { type: 'text', text: '欢迎', bold: true, stroke: true, shadow: true },
    { type: 'gift', name: '舰长', src: '/img/admin/gifts/bilibili-guard-captain.webp' },
    { type: 'image', name: '表情', src: '/scene-text-images/11111111-1111-4111-8111-111111111111.gif' },
    { type: 'text', text: '谢谢支持' },
  ];
  const document = { schemaVersion: 1, id: randomUUID(), title: 'text template', canvas: { width: 1920, height: 1080 },
    items: [item({ ...createTextBoxDefaults(), nodes })] };
  const pending = importSceneTemplate(exportSceneTemplate(document), { createId: randomUUID });
  assert.notEqual(pending.document.items[0].id, document.items[0].id);
  assert.deepEqual(pending.bindings.map(binding => binding.kind), ['media', 'media']);
  assert.throws(() => pending.resolve({}));
  const resolutions = Object.fromEntries(pending.bindings.map(binding => [binding.id, { confirmed: true, value: binding.source }]));
  assert.deepEqual(pending.resolve(resolutions).items[0].appearance.config.nodes, nodes);
  resolutions[pending.bindings[0].id].value = '';
  assert.deepEqual(pending.resolve(resolutions).items[0].appearance.config.nodes, [nodes[0], nodes[2], nodes[3]]);
  resolutions[pending.bindings[1].id].value = '';
  assert.deepEqual(pending.resolve(resolutions).items[0].appearance.config.nodes, [nodes[0], nodes[3]]);
  assert.deepEqual(pending.document.items[0].appearance.config.nodes, nodes);
});
