'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { loadModuleExports } = require('./helpers/frontend-modules');

test('live poll updates preserve row nodes and scroll position while showing zero and small percentages', async () => {
  function node() {
    return { dataset: {}, children: [], style: {}, textContent: '', scrollTop: 0,
      append(...children) { this.children.push(...children); }, replaceChildren() { this.children = []; },
    };
  }
  const { renderPollRows } = await loadModuleExports(path.resolve(__dirname, '../public/js/shared/interaction-view.js'), { document: { createElement: node } });
  const container = node();
  const session = { sessionId: 'one', phase: 'collecting', options: [
    { text: '<img>', votes: 0, percentage: 0 }, { text: '汉字', votes: 1, percentage: 0.5 },
  ] };
  renderPollRows(container, session);
  const row = container.children[0];
  container.scrollTop = 320;
  session.options[0].votes = 199;
  session.options[0].percentage = 99.5;
  renderPollRows(container, session);
  assert.equal(container.children[0], row);
  assert.equal(container.scrollTop, 320);
  assert.equal(row.children[0].children[1].textContent, '<img>');
  assert.equal(row.children[0].children[0].style.width, '99.5%');
  assert.equal(container.children[1].children[0].children[2].children[0].textContent, '1 票');
  assert.equal(container.children[1].children[0].children[2].children[1].textContent, '0.5%');
  session.phase = 'finished';
  renderPollRows(container, session);
  assert.match(row.children[0].children[1].textContent, /最高票/);
  session.sessionId = 'two';
  session.options.forEach((option) => { option.votes = option.percentage = 0; });
  renderPollRows(container, session);
  assert.notEqual(container.children[0], row);
  assert.equal(container.scrollTop, 0);
  assert.doesNotMatch(container.children[0].children[0].children[1].textContent, /最高/);
});
