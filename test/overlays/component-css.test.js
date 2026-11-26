'use strict';

const assert = require('node:assert/strict');
const path = require('node:path');
const test = require('node:test');
const { createFakeDocument } = require('../helpers/fake-dom');
const { loadModuleExports } = require('../helpers/frontend-modules');

test('late stylesheet events leave the replacement for the same URL under the loader’s control', async () => {
  const document = createFakeDocument();
  document.head = document.createElement('head');
  const { createComponentCss } = await loadModuleExports(path.resolve(__dirname, '../../public/js/overlays/component-css.js'), { document });
  const css = createComponentCss();
  const config = { cssStyle: { src: '/component-web/12345678-1234-4234-8234-123456789abc/queue.css' } };
  const cancelled = assert.rejects(css.update(config));
  const [oldLink] = document.head.children;
  css.dispose();
  const ready = css.update(config);
  const [replacement] = document.head.children;
  replacement.sheet = { cssRules: [{}] };
  replacement.listeners.load();
  await Promise.all([cancelled, ready]);

  oldLink.listeners.error();
  oldLink.listeners.load();
  assert.equal(document.head.children[0], replacement);
  css.dispose();
  assert.equal(document.head.children.length, 0);
});
