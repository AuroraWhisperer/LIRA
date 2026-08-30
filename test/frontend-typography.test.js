'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const { readAdminHtml } = require('./helpers/admin-html');
const { readCssBundle } = require('./helpers/css-bundle');

const ROOT = path.join(__dirname, '..');
const TYPE_PROPERTIES = new Set([
  'font-family',
  'font-size',
  'font-weight',
  'line-height',
  'letter-spacing',
]);
const TOKENS = {
  '--font-ui': 'var(--font)',
  '--font-display':
    '"Segoe UI Variable Display", "Microsoft YaHei UI", "Microsoft YaHei", "PingFang SC", sans-serif',
  '--font-mono': '"Cascadia Mono", Consolas, monospace',
  '--type-size-display': '28px',
  '--type-size-page-title': '24px',
  '--type-size-section-title': '18px',
  '--type-size-card-title': '15px',
  '--type-size-body': '14px',
  '--type-size-control': '13px',
  '--type-size-caption': '12px',
  '--type-size-micro': '11px',
  '--type-size-metric-sm': '20px',
  '--type-size-metric-md': '28px',
  '--type-size-metric-lg': '36px',
  '--type-weight-regular': '400',
  '--type-weight-medium': '500',
  '--type-weight-semibold': '600',
  '--type-weight-bold': '700',
  '--type-leading-display': '1.15',
  '--type-leading-page-title': '1.3',
  '--type-leading-section-title': '1.4',
  '--type-leading-card-title': '1.45',
  '--type-leading-body': '1.55',
  '--type-leading-control': '1.45',
  '--type-leading-caption': '1.5',
  '--type-leading-micro': '1.45',
  '--type-tracking-tight': '-0.01em',
  '--type-tracking-normal': '0',
  '--type-tracking-eyebrow': '0.06em',
};
const ROLES = [
  ['ui-display', 'display', 'bold', 'display', 'tight', 'display'],
  ['ui-page-title', 'page-title', 'bold', 'page-title', 'tight', 'display'],
  ['ui-page-subtitle', 'body', 'regular', 'body', 'normal', 'ui'],
  [
    'ui-section-title',
    'section-title',
    'bold',
    'section-title',
    'tight',
    'display',
  ],
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
  return fs
    .readFileSync(entryPath, 'utf8')
    .replace(/@import\s+url\(['"]([^'"]+)['"]\);/g, (_all, imported) => {
      const target = path.resolve(
        path.dirname(entryPath),
        imported.split('?')[0],
      );
      return readCssBundle(...path.relative(ROOT, target).split(path.sep));
    });
}

function desktopCss() {
  return [
    read('public', 'css', 'styles-base.css'),
    readEntry('public', 'css', 'styles-admin.css'),
    readCssBundle('public', 'css', 'styles-playback.css'),
    read('public', 'css', 'overlays', 'desktop.css'),
    read('public', 'css', 'admin', 'other-features', 'interactive-tour.css'),
  ].join('\n');
}

function rules(source) {
  const parsed = [];
  source = source.replace(/\/\*[\s\S]*?\*\//g, '');
  for (const block of source.matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
    const selector = block[1].trim().replace(/\s+/g, ' ');
    if (
      !selector ||
      selector.startsWith('@') ||
      /^(?:from|to|\d+%)$/.test(selector)
    )
      continue;
    const declarations = {};
    for (const item of block[2].matchAll(/([a-z-]+)\s*:\s*([^;{}]+);?/gi)) {
      declarations[item[1].toLowerCase()] = item[2]
        .trim()
        .replace(/\s*!important$/i, '');
    }
    parsed.push({ selector, declarations });
  }
  return parsed;
}

function properties(source) {
  const result = {};
  for (const item of source.matchAll(/(--[a-z0-9-]+)\s*:\s*([^;{}]+);/gi))
    result[item[1]] = item[2].trim();
  return result;
}

function normalizeTokenValue(value) {
  return value.replace(/["']/g, '').replace(/\s+/g, ' ').trim();
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

const allowed = (selector, allowlist) =>
  allowlist.some((pattern) => pattern.test(selector));

function filesBelow(directory, extension) {
  const result = [];
  for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
    const target = path.join(directory, entry.name);
    if (entry.isDirectory()) result.push(...filesBelow(target, extension));
    else if (path.extname(entry.name) === extension) result.push(target);
  }
  return result;
}

test('shared CSS defines the exact monotonic typography token contract', () => {
  const actual = properties(read('public', 'css', 'styles-base.css'));
  assert.deepEqual(
    Object.fromEntries(
      Object.keys(TOKENS).map((name) => [
        name,
        normalizeTokenValue(actual[name]),
      ]),
    ),
    Object.fromEntries(
      Object.entries(TOKENS).map(([name, value]) => [
        name,
        normalizeTokenValue(value),
      ]),
    ),
  );
  const order = [
    'page-title',
    'section-title',
    'card-title',
    'body',
    'control',
    'caption',
    'micro',
  ];
  const sizes = order.map((name) =>
    Number.parseFloat(actual[`--type-size-${name}`]),
  );
  assert.equal(actual['--type-size-body'], '14px');
  assert.equal(actual['--type-size-caption'], '12px');
  sizes
    .slice(1)
    .forEach((size, index) =>
      assert.ok(sizes[index] > size, `${order[index]} > ${order[index + 1]}`),
    );
});

test('Admin semantic roles are app-shell scoped token consumers', () => {
  const parsed = rules(readEntry('public', 'css', 'styles-admin.css'));
  for (const [role, size, weight, leading, tracking, family] of ROLES) {
    const match = declarationsFor(
      parsed,
      new RegExp(`\\.app-shell\\b[^,{]*\\.${role}\\b`),
    );
    assert.ok(match.count, `.${role} must be scoped under .app-shell`);
    assert.equal(match.result['font-family'], `var(--font-${family})`);
    assert.equal(match.result['font-size'], `var(--type-size-${size})`);
    assert.equal(match.result['font-weight'], `var(--type-weight-${weight})`);
    assert.equal(match.result['line-height'], `var(--type-leading-${leading})`);
    assert.equal(
      match.result['letter-spacing'],
      `var(--type-tracking-${tracking})`,
    );
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
    if (
      !Object.keys(rule.declarations).some((name) => TYPE_PROPERTIES.has(name))
    )
      continue;
    rule.selector.split(',').forEach((selector) => {
      if (/^\s*(?:h1|h2|h3|h4|p|small|strong)\s*$/.test(selector))
        violations.push(selector.trim());
    });
  }
  assert.deepEqual(violations, []);
  assert.doesNotMatch(
    source,
    /\.ui-(?:display|page|section|card|body|control|caption|eyebrow|metric)\b/,
  );
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
    for (const match of source.matchAll(pattern))
      violations.push(`${label}: ${match[0]}`);
  }
  assert.deepEqual(violations, []);
});

test('ordinary Admin copy keeps the 12px floor with explicit exceptions', () => {
  const violations = [];
  for (const rule of rules(desktopCss())) {
    const match = /^(\d+(?:\.\d+)?)px$/.exec(
      rule.declarations['font-size'] || '',
    );
    if (!match || Number(match[1]) >= 12) continue;
    const micro =
      Number(match[1]) === 11 && allowed(rule.selector, MICRO_ALLOWLIST);
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
    if (
      !value ||
      /^(?:normal|bold|400|500|600|700|var\(--type-weight-(?:regular|medium|semibold|bold)\))$/.test(
        value,
      )
    )
      continue;
    if (/^(?:800|900)$/.test(value) && allowed(rule.selector, HEAVY_ALLOWLIST))
      continue;
    if (
      /^var\(--preview-weight\)$/.test(value) &&
      /\.desktop-lyric-preview-row-/.test(rule.selector)
    )
      continue;
    if (
      /^var\(--admin-queue-font-weight,\s*700\)$/.test(value) &&
      /\.queue-row \.song/.test(rule.selector)
    )
      continue;
    violations.push(`${value}\t${rule.selector}`);
  }
  assert.deepEqual(violations, []);
});

test('representative desktop selectors resolve to semantic role tokens', () => {
  const parsed = rules(desktopCss());
  const contracts = [
    [
      'common panel title',
      /\.app-shell\b[^,{]*\.panel-header h2\b/,
      'section-title',
      'bold',
    ],
    [
      'point-song subpage',
      /\.app-shell\b[^,{]*\.song-workspace\b[^,{]*\.ui-page-title\b/,
      'page-title',
      'bold',
    ],
    [
      'playback queue group',
      /\.app-shell\b[^,{]*\.playback-queue-section h3\b/,
      'card-title',
      'semibold',
    ],
    [
      'gift heading',
      /\.app-shell\b[^,{]*\.gift-page\b[^,{]*\.panel-header h2\b/,
      'section-title',
      'bold',
    ],
    [
      'toolbox page header',
      /\.app-shell\b[^,{]*\.other-feature-panel-header h2\b/,
      'page-title',
      'bold',
    ],
    [
      'confirmation title',
      /\.lira-confirm-heading h2\b/,
      'section-title',
      'bold',
    ],
    [
      'update toast title',
      /\.desktop-update-toast strong\b/,
      'section-title',
      'bold',
    ],
    ['tour title', /\.lira-tour-title\b/, 'section-title', 'bold'],
    ['shutdown title', /\.shutdown-title\b/, 'page-title', 'bold'],
    ['caption', /\.app-shell\b[^,{]*\.hint\b/, 'caption', 'regular'],
  ];
  for (const [label, selector, size, weight] of contracts) {
    const match = declarationsFor(parsed, selector);
    assert.ok(match.count, `${label} must have a final desktop selector`);
    assert.equal(match.result['font-size'], `var(--type-size-${size})`, label);
    assert.equal(
      match.result['font-weight'],
      `var(--type-weight-${weight})`,
      label,
    );
  }
});

test('OBS and configurable preview typography stay outside Admin roles', () => {
  const overlayRoot = path.join(ROOT, 'public', 'css', 'overlays');
  const overlayCss = filesBelow(overlayRoot, '.css')
    .filter((file) => path.basename(file) !== 'desktop.css')
    .map((file) => fs.readFileSync(file, 'utf8'))
    .join('\n');
  assert.doesNotMatch(
    overlayCss,
    /(?:\.ui-(?:display|page|section|card|body|control|caption|eyebrow|metric)\b|var\(--type-)/,
  );
  const preview = read('public', 'css', 'admin', 'desktop-lyric-preview.css');
  for (const name of [
    '--preview-font',
    '--preview-size',
    '--preview-weight',
    '--preview-line-height',
    '--preview-letter-spacing',
  ]) {
    assert.ok(
      preview.includes(`var(${name})`),
      `${name} must remain user-configurable`,
    );
  }
  const queue = [
    read('public', 'js', 'overlays', 'queue-render.js'),
    read('public', 'js', 'overlays', 'queue-theme.js'),
  ].join('\n');
  assert.match(queue, /--overlay-font-family/);
  assert.match(queue, /settings\.overlayFontFamily/);
});
