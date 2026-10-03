'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const { readAdminHtml } = require('../helpers/admin-html');
const { readCssBundle } = require('../helpers/css-bundle');

const ROOT = path.join(__dirname, '../..');
const TYPE_PROPERTIES = new Set(['font-family', 'font-size', 'font-weight', 'line-height', 'letter-spacing']);
const REQUIRED_TOKENS = [
  '--font-ui',
  '--font-display',
  '--font-mono',
  '--type-size-display',
  '--type-size-page-title',
  '--type-size-section-title',
  '--type-size-card-title',
  '--type-size-body',
  '--type-size-control',
  '--type-size-caption',
  '--type-size-micro',
  '--type-size-metric-sm',
  '--type-size-metric-md',
  '--type-size-metric-lg',
  '--type-weight-regular',
  '--type-weight-medium',
  '--type-weight-semibold',
  '--type-weight-bold',
  '--type-leading-display',
  '--type-leading-page-title',
  '--type-leading-section-title',
  '--type-leading-card-title',
  '--type-leading-body',
  '--type-leading-control',
  '--type-leading-caption',
  '--type-leading-micro',
  '--type-tracking-tight',
  '--type-tracking-normal',
  '--type-tracking-eyebrow',
];
const ROLES = [
  ['ui-display', 'display', 'bold', 'display', 'tight', 'display'],
  ['ui-page-title', 'page-title', 'bold', 'page-title', 'tight', 'display'],
  ['ui-page-subtitle', 'body', 'regular', 'body', 'normal', 'ui'],
  ['ui-section-title', 'section-title', 'bold', 'section-title', 'tight', 'display'],
  ['ui-section-description', 'caption', 'regular', 'caption', 'normal', 'ui'],
  ['ui-card-title', 'card-title', 'semibold', 'card-title', 'normal', 'ui'],
  ['ui-body', 'body', 'regular', 'body', 'normal', 'ui'],
  ['ui-control-label', 'control', 'semibold', 'control', 'normal', 'ui'],
  ['ui-caption', 'caption', 'regular', 'caption', 'normal', 'ui'],
  ['ui-eyebrow', 'micro', 'bold', 'micro', 'eyebrow', 'ui'],
];
const MICRO_ALLOWLIST = [
  /\.ui-eyebrow\b/,
  /\.queue-eyebrow\b/,
  /\.panel-kicker\b/,
  /\b(?:thead|table)\b[^,]*\bth\b/,
  /\.(?:status-badge|status-chip|source-badge)\b/,
];
const SMALL_PRESENTATION_ALLOWLIST = [
  /\.player-fs-(?:lyric|translation|romanization)\b/,
  /\.desktop-lyric-preview-row-(?:text|translation|roma)\b/,
  /\.(?:chart|sparkline)-(?:axis|label|tick)\b/,
  /\.(?:clock|overtime)-(?:timer|time|countdown)-(?:digit|value)\b/,
];
const HEAVY_ALLOWLIST = [
  /\.ui-metric\b/,
  /\.(?:metric|stat|total)-value\b/,
  /\.(?:clock|overtime)-(?:timer|time|countdown)(?:-|\b)/,
  /\.player-fs-(?:title|time|lyric|translation|romanization)\b/,
  /\.(?:artwork|display)-heading\b/,
];

const read = (...parts) => fs.readFileSync(path.join(ROOT, ...parts), 'utf8');

function readEntry(...parts) {
  const entryPath = path.join(ROOT, ...parts);
  return fs.readFileSync(entryPath, 'utf8').replace(/@import\s+url\(['"]([^'"]+)['"]\);/g, (_all, imported) => {
    const target = path.resolve(path.dirname(entryPath), imported.split('?')[0]);
    return readCssBundle(...path.relative(ROOT, target).split(path.sep));
  });
}

function desktopCss() {
  return [
    read('public', 'css', 'styles-base.css'),
    readEntry('public', 'css', 'styles-admin.css'),
    readCssBundle('public', 'css', 'styles-playback.css'),
    readCssBundle('public', 'css', 'overlays', 'desktop.css'),
    read('public', 'css', 'admin', 'toolbox', 'interactive-tour.css'),
  ].join('\n');
}

function rules(source) {
  const parsed = [];
  source = source.replace(/\/\*[\s\S]*?\*\//g, '');
  for (const block of source.matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
    const selector = block[1].trim().replace(/\s+/g, ' ');
    if (!selector || selector.startsWith('@') || /^(?:from|to|\d+%)$/.test(selector)) continue;
    const declarations = {};
    for (const item of block[2].matchAll(/([a-z-]+)\s*:\s*([^;{}]+);?/gi)) {
      declarations[item[1].toLowerCase()] = item[2].trim().replace(/\s*!important$/i, '');
    }
    parsed.push({ selector, declarations });
  }
  return parsed;
}

function properties(source) {
  const result = {};
  for (const item of source.matchAll(/(--[a-z0-9-]+)\s*:\s*([^;{}]+);/gi)) result[item[1]] = item[2].trim();
  return result;
}

function declarationsFor(parsed, pattern) {
  const result = {};
  let count = 0;
  for (const rule of parsed) {
    if (!pattern.test(rule.selector)) continue;
    count += 1;
    Object.assign(result, rule.declarations);
  }
  return { result, count };
}

const allowed = (selector, allowlist) => allowlist.some((pattern) => pattern.test(selector));

function filesBelow(directory, extension) {
  const result = [];
  for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
    const target = path.join(directory, entry.name);
    if (entry.isDirectory()) result.push(...filesBelow(target, extension));
    else if (path.extname(entry.name) === extension) result.push(target);
  }
  return result;
}

test('shared typography tokens are complete, readable and ordered', () => {
  const actual = properties(read('public', 'css', 'styles-base.css'));
  for (const name of REQUIRED_TOKENS) {
    assert.ok(actual[name]?.trim(), `${name} must be defined`);
    if (name.startsWith('--type-size-')) {
      assert.match(actual[name], /^\d+(?:\.\d+)?px$/, name);
      assert.ok(Number.parseFloat(actual[name]) > 0, name);
    } else if (name.startsWith('--type-leading-')) {
      assert.ok(Number.isFinite(Number(actual[name])) && Number(actual[name]) >= 1, name);
    } else if (name.startsWith('--type-weight-')) {
      assert.ok([400, 500, 600, 700].includes(Number(actual[name])), name);
    } else if (name.startsWith('--type-tracking-')) {
      assert.match(actual[name], /^(?:0|-?\d+(?:\.\d+)?em)$/, name);
    }
  }
  for (const names of [
    ['display', 'page-title', 'section-title', 'card-title', 'body', 'control', 'caption', 'micro'],
    ['metric-lg', 'metric-md', 'metric-sm'],
  ]) {
    const sizes = names.map((name) => Number.parseFloat(actual[`--type-size-${name}`]));
    sizes.slice(1).forEach((size, index) => assert.ok(sizes[index] > size, `${names[index]} > ${names[index + 1]}`));
  }
  for (const name of ['body', 'control', 'caption']) {
    assert.ok(Number.parseFloat(actual[`--type-size-${name}`]) >= 12, `${name} must remain readable`);
  }
  assert.ok(Number.parseFloat(actual['--type-size-micro']) >= 11);
});

test('Admin semantic roles are app-shell scoped token consumers', () => {
  const parsed = rules(readEntry('public', 'css', 'styles-admin.css'));
  for (const [role, size, weight, leading, tracking, family] of ROLES) {
    const match = declarationsFor(parsed, new RegExp(`\\.app-shell\\b[^,{]*\\.${role}\\b`));
    assert.ok(match.count, `.${role} must be scoped under .app-shell`);
    assert.equal(match.result['font-family'], `var(--font-${family})`);
    assert.equal(match.result['font-size'], `var(--type-size-${size})`);
    assert.equal(match.result['font-weight'], `var(--type-weight-${weight})`);
    assert.equal(match.result['line-height'], `var(--type-leading-${leading})`);
    assert.equal(match.result['letter-spacing'], `var(--type-tracking-${tracking})`);
  }
  const metric = declarationsFor(parsed, /\.app-shell\b[^,{]*\.ui-metric\b/);
  assert.ok(metric.count, '.ui-metric must be scoped under .app-shell');
  assert.equal(metric.result['font-size'], 'var(--type-size-metric-sm)');
  assert.equal(metric.result['font-weight'], 'var(--type-weight-bold)');
  assert.equal(metric.result['font-variant-numeric'], 'tabular-nums');
});

test('shared base CSS has no bare text-element typography rules', () => {
  const source = read('public', 'css', 'styles-base.css');
  const violations = [];
  for (const rule of rules(source)) {
    if (!Object.keys(rule.declarations).some((name) => TYPE_PROPERTIES.has(name))) continue;
    rule.selector.split(',').forEach((selector) => {
      if (/^\s*(?:h1|h2|h3|h4|p|small|strong)\s*$/.test(selector)) violations.push(selector.trim());
    });
  }
  assert.deepEqual(violations, []);
  assert.doesNotMatch(source, /\.ui-(?:display|page|section|card|body|control|caption|eyebrow|metric)\b/);
});

test('composed Admin HTML and runtime templates have no inline typography', () => {
  const pattern =
    /style\s*=\s*["'`][^"'`]*(?:font-size|font-weight|font-family|line-height|letter-spacing)[^"'`]*["'`]/gi;
  const sources = [['composed Admin HTML', readAdminHtml()]];
  for (const root of ['public/js/admin', 'public/js/playback']) {
    for (const file of filesBelow(path.join(ROOT, root), '.js'))
      sources.push([path.relative(ROOT, file), fs.readFileSync(file, 'utf8')]);
  }
  const violations = [];
  for (const [label, source] of sources) {
    for (const match of source.matchAll(pattern)) violations.push(`${label}: ${match[0]}`);
  }
  assert.deepEqual(violations, []);
});

test('ordinary Admin copy keeps the 12px floor with explicit exceptions', () => {
  const violations = [];
  for (const rule of rules(desktopCss())) {
    const match = /^(\d+(?:\.\d+)?)px$/.exec(rule.declarations['font-size'] || '');
    if (!match || Number(match[1]) >= 12) continue;
    const micro = Number(match[1]) === 11 && allowed(rule.selector, MICRO_ALLOWLIST);
    if (!micro && !allowed(rule.selector, SMALL_PRESENTATION_ALLOWLIST)) {
      violations.push(`${match[0]}\t${rule.selector}`);
    }
  }
  assert.deepEqual(violations, []);
});

test('common Admin copy uses standard weights with explicit presentation exceptions', () => {
  const violations = [];
  for (const rule of rules(desktopCss())) {
    const value = rule.declarations['font-weight'];
    if (!value || /^(?:normal|bold|400|500|600|700|var\(--type-weight-(?:regular|medium|semibold|bold)\))$/.test(value))
      continue;
    if (/^(?:800|900)$/.test(value) && allowed(rule.selector, HEAVY_ALLOWLIST)) continue;
    if (/^var\(--preview-weight\)$/.test(value) && /\.desktop-lyric-preview-row-/.test(rule.selector)) continue;
    if (/^var\(--admin-queue-font-weight,\s*700\)$/.test(value) && /\.queue-row \.song/.test(rule.selector)) continue;
    violations.push(`${value}\t${rule.selector}`);
  }
  assert.deepEqual(violations, []);
});

test('Browser-source and configurable preview typography stay outside Admin roles', () => {
  const overlayRoot = path.join(ROOT, 'public', 'css', 'overlays');
  const overlayCss = filesBelow(overlayRoot, '.css')
    .filter((file) => path.basename(file) !== 'desktop.css')
    .map((file) => fs.readFileSync(file, 'utf8'))
    .join('\n');
  assert.doesNotMatch(
    overlayCss,
    /(?:\.ui-(?:display|page|section|card|body|control|caption|eyebrow|metric)\b|var\(--type-)/,
  );
  const preview = readCssBundle('public', 'css', 'admin', 'desktop-lyric-preview.css');
  for (const name of [
    '--preview-font',
    '--preview-size',
    '--preview-weight',
    '--preview-line-height',
    '--preview-letter-spacing',
  ]) {
    assert.ok(preview.includes(`var(${name})`), `${name} must remain user-configurable`);
  }
  const queue = [
    read('public', 'js', 'overlays', 'queue-render.js'),
    read('public', 'js', 'overlays', 'queue-theme.js'),
    read('public', 'js', 'overlays', 'overlay-theme.js'),
  ].join('\n');
  assert.match(queue, /--overlay-font-family/);
  assert.match(queue, /settings\.overlayFontFamily/);
});
