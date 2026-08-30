'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const ROOT_DIR = path.join(__dirname, '..');
const read = (...parts) =>
  fs.readFileSync(path.join(ROOT_DIR, ...parts), 'utf8');

function assertOpenSelectEscapesCard(styles, selector, description) {
  const selectorPattern = selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const rule = styles.match(
    new RegExp(`${selectorPattern}\\s*\\{([^}]*)\\}`),
  )?.[1];
  assert.ok(rule, `${description} should define an open-select rule`);
  assert.match(rule, /z-index:\s*1/);
  assert.match(rule, /overflow:\s*visible/);
}

test('all audited admin select cards release overflow while a menu is open', () => {
  assertOpenSelectEscapesCard(
    read('public', 'css', 'admin', 'desktop-lyric-preview.css'),
    '.desktop-lyric-settings-group:has(.lira-select.is-open)',
    'desktop lyric settings groups',
  );
  assertOpenSelectEscapesCard(
    read('public', 'css', 'admin', 'other-features', 'ai-assistant.css'),
    '.xiaomi-ai-section:has(.lira-select.is-open)',
    'AI settings cards',
  );
  assertOpenSelectEscapesCard(
    read('public', 'css', 'admin', 'other-features', 'streamer-planner.css'),
    '.planner-notes-panel:has(.lira-select.is-open)',
    'planner notes cards',
  );
  assertOpenSelectEscapesCard(
    read('public', 'css', 'admin', 'other-features', 'games.css'),
    '.game-admin-card:has(.lira-select.is-open)',
    'game cards',
  );
});

test('shared select menus keep their local absolute positioning contract', () => {
  const styles = read('public', 'css', 'components', 'select-menu.css');
  const menuRule = styles.match(/\.lira-select-menu\s*\{([^}]*)\}/)?.[1];

  assert.ok(menuRule, 'shared select menu styles should remain defined');
  assert.match(menuRule, /position:\s*absolute/);
  assert.match(menuRule, /z-index:\s*70/);
});
