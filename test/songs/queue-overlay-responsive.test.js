'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const path = require('node:path');
const { loadModuleExports } = require('../helpers/frontend-modules');

const ROOT_DIR = path.join(__dirname, '../..');

test('classic queue scrolls only when its rendered rows overflow available height', async () => {
  const { configureClassicVerticalScroll } = await loadModuleExports(path.join(ROOT_DIR, 'public/js/overlays/queue-scroll.js'), {
    URLSearchParams,
    location: { search: '' },
    document: { documentElement: { style: { setProperty() {} } } },
  });
  const createList = (scrollHeight) => {
    const list = {
      scrollHeight,
      duplicatedHtml: '',
      classList: { add() {}, remove() {} },
      insertAdjacentHTML(_position, html) {
        list.duplicatedHtml += html;
      },
    };
    return list;
  };
  const viewport = () => ({ clientHeight: 235, style: {}, getBoundingClientRect: () => ({ top: 100 }) });

  const fitting = createList(230);
  assert.equal(configureClassicVerticalScroll(viewport(), fitting, {}, '<div>rows</div>', 5), false);
  assert.equal(fitting.duplicatedHtml, '', 'rows that fit must not be duplicated');

  const overflowing = createList(900);
  assert.equal(configureClassicVerticalScroll(viewport(), overflowing, { queueScrollMode: 'loop' }, '<div>rows</div>', 5), true);
});
