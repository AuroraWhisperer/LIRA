'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const { readAdminHtml } = require('../helpers/admin-html');
const { loadModuleExports } = require('../helpers/frontend-modules');

const ROOT_DIR = path.resolve(__dirname, '../..');
const COMPONENT_PATH = path.join(ROOT_DIR, 'public', 'js', 'admin', 'contextual-help.js');

test('Admin optional explanations use one contextual help component', () => {
  const html = readAdminHtml();
  const entrySource = fs.readFileSync(path.join(ROOT_DIR, 'public', 'js', 'admin', 'index.js'), 'utf8');
  const componentSource = fs.readFileSync(COMPONENT_PATH, 'utf8');
  const styles = fs.readFileSync(path.join(ROOT_DIR, 'public', 'css', 'components', 'contextual-help.css'), 'utf8');
  const overtimeSource = ['overtime-rule-editor.js', 'overtime-rule-effect-editor.js']
    .map((file) => fs.readFileSync(path.join(ROOT_DIR, 'public', 'js', 'admin', file), 'utf8'))
    .join('\n');

  const helpImport = entrySource.indexOf("import './contextual-help.js';");
  const featureImport = entrySource.indexOf("import './app.js';");
  assert.ok(helpImport > -1 && helpImport < featureImport);
  assert.match(componentSource, /setAttribute\(['"]role['"], ['"]tooltip['"]\)/);
  assert.match(componentSource, /popover\s*=\s*['"]manual['"]/);
  assert.match(componentSource, /showPopover\(\)/);
  assert.match(componentSource, /hidePopover\(\)/);
  assert.match(componentSource, /addEventListener\(['"]mouseenter['"], this\.handlePointerEnter\)/);
  assert.match(componentSource, /addEventListener\(['"]mouseleave['"], this\.handlePointerLeave\)/);
  assert.match(componentSource, /addEventListener\(['"]focus['"], this\.handleFocus\)/);
  assert.match(componentSource, /addEventListener\(['"]blur['"], this\.handleBlur\)/);
  assert.match(componentSource, /addEventListener\(['"]click['"], this\.handleClick\)/);
  assert.match(componentSource, /setAttribute\(['"]aria-expanded['"], ['"]false['"]\)/);
  assert.match(
    componentSource,
    /onPointerLeave\(\)[\s\S]*?this\.matches\(['"]:focus-visible['"]\)[\s\S]*?this\.hideTooltip\(\)/,
  );
  assert.match(componentSource, /onClick\(event\)[\s\S]*?event\.preventDefault\(\)[\s\S]*?event\.stopPropagation\(\)/);
  assert.doesNotMatch(componentSource, /onClick\(event\)\s*\{[^}]*this\.(?:show|toggle)Tooltip\(\)/);
  assert.doesNotMatch(componentSource, /toggleTooltip\(\)/);
  assert.match(componentSource, /event\.key === ['"]Escape['"]/);
  assert.match(componentSource, /event\.key !== ['"]Enter['"] && event\.key !== ['"] ['"]/);
  assert.match(componentSource, /event\.key !== ['"]Enter['"][\s\S]*?this\.showTooltip\(\)/);
  assert.match(styles, /lira-help:focus-visible/);
  assert.match(styles, /lira-help-tooltip:popover-open/);
  assert.match(styles, /:has\(\s*>\s*lira-help\s*\)[^{]*\{[^}]*white-space:\s*nowrap/s);
  assert.match(styles, /overflow:\s*hidden\s*!important/);
  assert.match(styles, /scrollbar-width:\s*none/);
  assert.match(styles, /\.lira-help-tooltip::\-webkit-scrollbar/);

  for (const statusId of ['xiaomiAiSaveState', 'desktopLyricAutosaveState']) {
    const owner = html.match(new RegExp(`<([\\w-]+)[^>]*id="${statusId}"`));
    assert.ok(owner, `${statusId} should remain in the page`);
    assert.notEqual(owner[1], 'lira-help', `${statusId} should stay visible instead of becoming help`);
  }

  assert.match(overtimeSource, /(?:document|documentRef)\.createElement\(['"]lira-help['"]\)/);
});

test('contextual help placement prefers above and clamps to the viewport', async () => {
  class FakeHTMLElement {}
  const registry = new Map();
  const module = await loadModuleExports(COMPONENT_PATH, {
    HTMLElement: FakeHTMLElement,
    customElements: {
      define(name, constructor) {
        registry.set(name, constructor);
      },
      get(name) {
        return registry.get(name);
      },
    },
  });

  assert.equal(typeof registry.get('lira-help'), 'function');
  const above = module.calculateContextualHelpPosition(
    { left: 200, right: 216, top: 200, bottom: 216 },
    { width: 240, height: 80 },
    { width: 800, height: 600 },
  );
  assert.equal(above.placement, 'top');
  assert.equal(above.left + 120, 208, 'center over the anchor when space allows');
  assert.ok(above.top >= 0 && above.top + 80 <= 200);

  const edge = module.calculateContextualHelpPosition(
    { left: 780, right: 796, top: 20, bottom: 36 },
    { width: 240, height: 80 },
    { width: 800, height: 600 },
  );
  assert.equal(edge.placement, 'bottom');
  assert.ok(edge.left >= 0 && edge.left + 240 <= 800);
  assert.ok(edge.top >= 36 && edge.top + 80 <= 600);
});
