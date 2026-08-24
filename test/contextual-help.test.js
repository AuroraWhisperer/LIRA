'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const { readAdminHtml } = require('./helpers/admin-html');
const { loadModuleExports } = require('./helpers/frontend-modules');

const ROOT_DIR = path.resolve(__dirname, '..');
const COMPONENT_PATH = path.join(ROOT_DIR, 'public', 'js', 'admin', 'contextual-help.js');

test('Admin optional explanations use one contextual help component', () => {
  const html = readAdminHtml();
  const entrySource = fs.readFileSync(path.join(ROOT_DIR, 'public', 'js', 'admin', 'index.js'), 'utf8');
  const componentSource = fs.readFileSync(COMPONENT_PATH, 'utf8');
  const styles = fs.readFileSync(path.join(ROOT_DIR, 'public', 'css', 'components', 'contextual-help.css'), 'utf8');
  const overtimeSource = fs.readFileSync(path.join(ROOT_DIR, 'public', 'js', 'admin', 'overtime-rule-editor.js'), 'utf8');

  const helpImport = entrySource.indexOf("import './contextual-help.js';");
  const featureImport = entrySource.indexOf("import './settings.js';");
  assert.ok(helpImport > -1 && helpImport < featureImport);
  assert.match(componentSource, /const HELP_ELEMENT_NAME = ['"]lira-help['"]/);
  assert.match(componentSource, /customElements\.define\(HELP_ELEMENT_NAME/);
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
  assert.match(componentSource, /onPointerLeave\(\)[\s\S]*?this\.matches\(['"]:focus-visible['"]\)[\s\S]*?this\.hideTooltip\(\)/);
  assert.match(componentSource, /onClick\(event\)[\s\S]*?event\.preventDefault\(\)[\s\S]*?event\.stopPropagation\(\)/);
  assert.doesNotMatch(componentSource, /onClick\(event\)\s*\{[^}]*this\.(?:show|toggle)Tooltip\(\)/);
  assert.doesNotMatch(componentSource, /toggleTooltip\(\)/);
  assert.match(componentSource, /event\.key === ['"]Escape['"]/);
  assert.match(componentSource, /event\.key !== ['"]Enter['"] && event\.key !== ['"] ['"]/);
  assert.match(componentSource, /event\.key !== ['"]Enter['"][\s\S]*?this\.showTooltip\(\)/);
  assert.match(styles, /lira-help:focus-visible/);
  assert.match(styles, /align-self:\s*center/);
  assert.match(styles, /vertical-align:\s*0\.125em/);
  assert.match(styles, /\.lira-help-glyph\s*\{[^}]*font:\s*700 12px\/1 ['"]Segoe UI['"], Arial, sans-serif/s);
  assert.match(styles, /lira-help-tooltip:popover-open/);
  assert.match(styles, /:has\(> lira-help\)[^{]*\{[^}]*white-space:\s*nowrap/s);
  assert.match(styles, /overflow:\s*hidden\s*!important/);
  assert.match(styles, /scrollbar-width:\s*none/);
  assert.match(styles, /background:\s*#eaf6ff/);
  assert.match(styles, /color:\s*#174f73/);
  assert.match(styles, /\.lira-help-tooltip::\-webkit-scrollbar/);
  assert.doesNotMatch(styles, /\.lira-help-tooltip::after/);
  assert.doesNotMatch(styles, /lira-help--[\w-]+/);

  const retainedCopy = [
    '1 最慢，100 最快',
    '留空时使用文字色',
    '设置后倒计时会重置并暂停',
    '接受服务根地址、v1 地址或完整接口地址',
    '会增加合成压力',
    '正值让歌词提前'
  ];
  for (const copy of retainedCopy) {
    assert.match(html, new RegExp(`<lira-help[^>]*>[^<]*(?:<[^>]+>)*[^<]*${copy}`));
  }

  const redundantHelpLabels = [
    '开场文案',
    '礼物姬',
    '小游戏',
    '连接状态',
    'AI 互动助手',
    '扩展能力',
    '高级设置',
    '固定回复',
    '快捷入口',
    '点歌匹配诊断',
    '显示礼物提示',
    '歌曲排序方式',
    '圆角大小'
  ];
  for (const label of redundantHelpLabels) {
    assert.doesNotMatch(html, new RegExp(`>${label} <lira-help`));
  }

  for (const statusId of ['xiaomiAiSaveState', 'giftStatusLine', 'desktopLyricAutosaveState']) {
    const owner = html.match(new RegExp(`<([\\w-]+)[^>]*id="${statusId}"`));
    assert.ok(owner, `${statusId} should remain in the page`);
    assert.notEqual(owner[1], 'lira-help', `${statusId} should stay visible instead of becoming help`);
  }

  assert.match(overtimeSource, /document\.createElement\(['"]lira-help['"]\)/);
});

test('contextual help placement prefers above and clamps to the viewport', async () => {
  class FakeHTMLElement {}
  const registry = new Map();
  const module = await loadModuleExports(COMPONENT_PATH, {
    HTMLElement: FakeHTMLElement,
    customElements: {
      define(name, constructor) { registry.set(name, constructor); },
      get(name) { return registry.get(name); }
    }
  });

  assert.equal(typeof module.calculateContextualHelpPosition, 'function');
  assert.deepEqual(
    JSON.parse(JSON.stringify(module.calculateContextualHelpPosition(
      { left: 200, right: 216, top: 200, bottom: 216 },
      { width: 240, height: 80 },
      { width: 800, height: 600 }
    ))),
    { left: 88, top: 112, placement: 'top' }
  );
  assert.deepEqual(
    JSON.parse(JSON.stringify(module.calculateContextualHelpPosition(
      { left: 780, right: 796, top: 20, bottom: 36 },
      { width: 240, height: 80 },
      { width: 800, height: 600 }
    ))),
    { left: 548, top: 44, placement: 'bottom' }
  );
});
