'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');
const { pathToFileURL } = require('node:url');

async function loadCategoryFilterModule() {
  const filePath = path.join(__dirname, '..', 'public', 'js', 'admin', 'song-category-filter.js');
  const module = new vm.SourceTextModule(fs.readFileSync(filePath, 'utf8'), {
    context: vm.createContext({ console, document: {} }),
    identifier: pathToFileURL(filePath).href
  });
  await module.link(() => {
    throw new Error('The category filter module should not import dependencies.');
  });
  await module.evaluate();
  return module.namespace;
}

test('song library multi-select filters allow only one open menu', () => {
  const html = fs.readFileSync(path.join(__dirname, '..', 'public', 'pages', 'admin.html'), 'utf8');

  assert.match(html, /<details id="categoryFilter"[^>]* name="songLibraryFilter">/);
  assert.match(html, /<details id="tagFilter"[^>]* name="songLibraryFilter">/);
});

test('song library filter menus close only when clicking outside', async () => {
  const { closeFilterMenusOnOutsideClick } = await loadCategoryFilterModule();
  const insideTarget = {};
  const outsideTarget = {};
  const filter = {
    open: true,
    contains: (target) => target === insideTarget
  };

  closeFilterMenusOnOutsideClick({ target: insideTarget }, [filter]);
  assert.equal(filter.open, true);

  closeFilterMenusOnOutsideClick({ target: outsideTarget }, [filter]);
  assert.equal(filter.open, false);
});
