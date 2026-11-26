'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const {
  CLIENT_THEMES,
  CLIENT_THEME_CATEGORIES,
  CLIENT_THEME_CATEGORY_MAP,
  getPairedClientTheme,
} = require('../../src/shared/client-theme');

const css = fs.readFileSync(path.resolve(__dirname, '../../public/css/desktop/palettes.css'), 'utf8');
const baseCss = fs.readFileSync(path.resolve(__dirname, '../../public/css/styles-base.css'), 'utf8');
const strippedCss = css.replace(/\/\*[\s\S]*?\*\//g, '');
const blocks = [...strippedCss.matchAll(/([^{}]+)\{([^{}]+)\}/g)].map(([, selector, body]) => ({
  selectors: selector.split(',').map((part) => part.trim()).filter(Boolean),
  declarations: parseDeclarations(body),
}));
const baseTokens = parseDeclarations(baseCss.replace(/\/\*[\s\S]*?\*\//g, '').match(/:root\s*\{([^}]+)\}/)[1]);

function parseDeclarations(body) {
  const entries = {};
  for (const part of body.split(';')) {
    const trimmed = part.trim();
    if (!trimmed) continue;
    const colon = trimmed.indexOf(':');
    if (colon === -1) continue;
    const key = trimmed.slice(0, colon).trim();
    const value = trimmed.slice(colon + 1).trim();
    if (key) entries[key] = value;
  }
  return entries;
}

function selectorMatches(selector, target) {
  if (target.tag === 'html') {
    if (selector === 'html.desktop-shell' || selector === 'html[data-client-theme]') return true;
    if (selector === `html[data-client-theme='${target.id}']`) return true;
    if (target.mode && selector === `html[data-client-theme-mode='${target.mode}']`) return true;
    if (target.surface && selector === `html[data-client-theme-surface='${target.surface}']`) return true;
    return false;
  }
  if (target.tag === 'preview') {
    if (selector === '[data-client-theme-preview]') return true;
    if (selector === `[data-client-theme-preview='${target.id}']`) return true;
    if (target.mode && selector === `:where([data-client-theme-preview])[data-client-theme-mode='${target.mode}']`) return true;
    if (target.surface && selector === `:where([data-client-theme-preview])[data-client-theme-surface='${target.surface}']`) return true;
    return false;
  }
  return false;
}

function resolveScopeTokens(target, inherited = baseTokens) {
  const tokens = { ...inherited };
  for (const block of blocks) {
    if (!block.selectors.some((selector) => selectorMatches(selector, target))) continue;
    for (const [key, value] of Object.entries(block.declarations)) {
      if (key.startsWith('--') && value === 'initial') delete tokens[key];
      else tokens[key] = value;
    }
  }
  return tokens;
}

function themeTokens(theme, { omitModeAttr = false } = {}) {
  return resolveScopeTokens({
    tag: 'html',
    id: theme.id,
    mode: omitModeAttr ? null : theme.mode,
    surface: omitModeAttr ? null : theme.surface,
  });
}

function splitVarArgs(content) {
  let depth = 0;
  for (let index = 0; index < content.length; index++) {
    const ch = content[index];
    if (ch === '(') depth += 1;
    else if (ch === ')') depth -= 1;
    else if (ch === ',' && depth === 0) {
      return [content.slice(0, index).trim(), content.slice(index + 1).trim()];
    }
  }
  return [content.trim(), undefined];
}

function resolveValue(tokens, rawValue, depth = 0) {
  if (rawValue === undefined || rawValue === null) return '';
  if (depth > 16) throw new Error(`Circular CSS variable resolution for: ${rawValue}`);
  let input = String(rawValue).trim();
  if (/^--[\w-]+$/.test(input)) {
    return input in tokens ? resolveValue(tokens, tokens[input], depth + 1) : '';
  }
  while (input.includes('var(')) {
    const start = input.indexOf('var(');
    let cursor = start + 4;
    let nesting = 1;
    while (cursor < input.length && nesting > 0) {
      if (input[cursor] === '(') nesting += 1;
      else if (input[cursor] === ')') nesting -= 1;
      cursor += 1;
    }
    const inner = input.slice(start + 4, cursor - 1);
    const [varName, fallback] = splitVarArgs(inner);
    const replacement = varName in tokens
      ? resolveValue(tokens, tokens[varName], depth + 1)
      : (fallback !== undefined ? resolveValue(tokens, fallback, depth + 1) : '');
    input = input.slice(0, start) + replacement + input.slice(cursor);
  }
  return input.trim();
}

function hexToRgb(hex) {
  return hex.slice(1).match(/../g).map((part) => parseInt(part, 16));
}

function mixHex(first, percent, second) {
  const a = hexToRgb(first);
  const b = hexToRgb(second);
  const weight = percent / 100;
  return '#' + a.map((channel, index) => Math.round(channel * weight + b[index] * (1 - weight)).toString(16).padStart(2, '0')).join('');
}

function luminance(hex) {
  const channels = hexToRgb(hex).map((value) => value / 255);
  const linear = channels.map((value) => value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4);
  return linear[0] * 0.2126 + linear[1] * 0.7152 + linear[2] * 0.0722;
}

function contrast(first, second) {
  const values = [luminance(first), luminance(second)].sort((a, b) => b - a);
  return (values[0] + 0.05) / (values[1] + 0.05);
}

test('client theme catalog, CSS layering, color-scheme and preview isolation invariants hold', () => {
  const validModes = new Set(['light', 'dark']);
  const validSurfaces = new Set(['solid', 'tinted', 'gradient']);
  const validTemperatures = new Set(['warm', 'cool', 'neutral', 'hybrid']);
  const seenIds = new Set();

  assert.equal(CLIENT_THEME_CATEGORIES.length, 6);
  assert.doesNotMatch(strippedCss, /\.lira-(?:multi)?select/, 'palettes.css must stay pure tokens without .lira-select DOM selectors');
  assert.doesNotMatch(
    baseCss,
    /data-client-theme='(?:cocoa-champagne|black-silver|rose-plum-dark|lotus-violet-dark)'/,
    'styles-base.css must use data-client-theme-mode instead of hardcoded theme IDs',
  );

  for (const theme of CLIENT_THEMES) {
    assert.ok(!seenIds.has(theme.id), `duplicate theme id: ${theme.id}`);
    seenIds.add(theme.id);
    assert.ok(theme.name && typeof theme.name === 'string', `${theme.id}: non-empty name`);
    assert.match(theme.background, /^#[0-9a-f]{6}$/i, `${theme.id}: valid hex background`);
    assert.ok(validModes.has(theme.mode), `${theme.id}: valid mode`);
    assert.ok(Object.hasOwn(CLIENT_THEME_CATEGORY_MAP, theme.category), `${theme.id}: valid category`);
    assert.ok(validSurfaces.has(theme.surface), `${theme.id}: valid surface`);
    assert.ok(validTemperatures.has(theme.temperature), `${theme.id}: valid temperature`);

    if (theme.family) {
      const paired = getPairedClientTheme(theme.id);
      assert.ok(paired, `${theme.id}: paired family theme must exist`);
      assert.notEqual(paired.mode, theme.mode, `${theme.id}: paired theme must have opposite mode`);
      assert.equal(getPairedClientTheme(paired.id)?.id, theme.id, `${theme.id}: pairing must be symmetric`);
    }

    const palette = themeTokens(theme);
    const standalone = themeTokens(theme, { omitModeAttr: true });
    assert.equal(palette['color-scheme'], theme.mode, `${theme.id}: color-scheme matches mode`);
    assert.equal(standalone['color-scheme'], theme.mode, `${theme.id}: standalone fixture inherits color-scheme`);

    const resolvedPageBg = resolveValue(palette, '--page-bg');
    if (theme.surface === 'gradient') {
      assert.match(resolvedPageBg, /gradient\(/i, `${theme.id}: gradient theme must resolve a gradient --page-bg`);
    } else {
      assert.doesNotMatch(resolvedPageBg, /gradient\(/i, `${theme.id}: non-gradient theme must not resolve a gradient --page-bg`);
      assert.equal(palette['--client-gradient-end'], undefined, `${theme.id}: non-gradient theme must not set --client-gradient-end`);
    }
  }

  // Verify nested preview cards isolate cleanly from any parent page theme (solid/gradient × light/dark).
  const parentIds = ['terracotta', 'rose-lustre', 'black-silver', 'abyss-cyan', 'dawn-persimmon'];
  const checkedKeys = [
    'color-scheme',
    '--color-bg-page',
    '--color-bg-primary',
    '--color-bg-chrome',
    '--color-bg-nav',
    '--color-text-primary',
    '--color-primary-fill',
    '--color-selection-marker',
    '--page-bg',
    '--client-gradient-end',
    '--client-select-check-fill',
    '--client-select-check-ink',
    '--client-fan-guard-1',
  ];
  for (const parentId of parentIds) {
    const parentTheme = CLIENT_THEMES.find((item) => item.id === parentId);
    const parentTokens = themeTokens(parentTheme);
    for (const previewTheme of CLIENT_THEMES) {
      const expected = themeTokens(previewTheme);
      const preview = resolveScopeTokens({
        tag: 'preview',
        id: previewTheme.id,
        mode: previewTheme.mode,
        surface: previewTheme.surface,
      }, parentTokens);
      for (const key of checkedKeys) {
        assert.equal(
          resolveValue(preview, key),
          resolveValue(expected, key),
          `preview ${previewTheme.id} inside parent ${parentId}: ${key} leaked or diverged`,
        );
      }
    }
  }
});

test('client text, action states, semantic pairs and functional boundaries meet their contrast budgets', () => {
  const defaultFanGuards = ['#c13e52', '#7c49bc', '#276ab3'];

  for (const theme of CLIENT_THEMES) {
    const { id, background, mode } = theme;
    const isDark = mode === 'dark';
    const palette = themeTokens(theme);
    assert.equal(palette['--color-bg-page'], background, `${id}: native window and page background`);

    const check = (foreground, bg, minimum) => {
      const fgHex = resolveValue(palette, foreground);
      const bgRaw = resolveValue(palette, bg);
      assert.match(fgHex, /^#[0-9a-f]{6}$/i, `${id}: ${foreground} resolved to ${fgHex}`);
      const stops = bgRaw.match(/#[0-9a-f]{6}\b/gi) || [];
      assert.ok(stops.length > 0, `${id}: ${bg} resolved to ${bgRaw} without hex color stops`);
      for (const stop of stops) {
        const ratio = contrast(fgHex, stop);
        assert.ok(ratio >= minimum, `${id}: ${foreground} (${fgHex}) on ${bg} (${stop}) is ${ratio.toFixed(3)}; expected ${minimum}`);
      }
    };

    const surfaces = [
      '--color-bg-page',
      '--color-bg-primary',
      '--color-bg-secondary',
      '--color-bg-tertiary',
      '--color-bg-chrome',
      '--color-bg-nav',
      '--color-floating-surface',
      '--color-control-surface',
      '--color-quick-panel-surface',
    ];
    if (palette['--client-gradient-end']) surfaces.push('--client-gradient-end');

    for (const surface of surfaces) {
      for (const text of ['--color-text-primary', '--color-text-secondary', '--color-text-muted']) check(text, surface, 4.5);
      check('--color-control-border', surface, 3);
      check('--color-control-border-hover', surface, 3);
      check('--color-primary-text', surface, 3);
    }
    check('--color-primary-text', '--color-quick-panel-surface', 4.5);
    check('--color-control-accent', '--color-bg-primary', 3);

    for (const action of ['--color-primary-fill', '--color-primary-fill-hover', '--color-primary-fill-active']) {
      for (const stop of resolveValue(palette, action).match(/#[0-9a-f]{6}\b/gi) || []) {
        check('--color-on-primary', stop, 4.5);
      }
    }
    check('--color-on-control-accent', '--color-control-accent', 4.5);
    check('--color-on-control-accent', '--color-selection-marker', 4.5);
    check('--color-text-selection-text', '--color-text-selection-bg', 4.5);
    check('--color-selection-marker', '--color-primary-light', 3);
    check('--color-selection-text', '--color-primary-light', 4.5);
    check('--color-primary-text', '--color-primary-light', 4.5);
    for (const stop of resolveValue(palette, '--color-selection-fill').match(/#[0-9a-f]{6}\b/gi) || []) {
      check('--color-selection-text', stop, 4.5);
      check('--color-text-secondary', stop, 4.5);
    }

    for (const role of ['success', 'warning', 'danger', 'info']) {
      check(`--color-${role}`, `--color-${role}-light`, 4.5);
      check(`--color-${role}`, '--color-bg-secondary', 4.5);
      check(`--color-${role}`, '--color-quick-panel-surface', 4.5);
      if (palette[`--color-on-${role}`]) {
        check(`--color-on-${role}`, `--color-${role}`, 4.5);
      }
    }
    check('--color-danger', '--color-danger-active', 4.5);
    check('--color-help-accent', '--color-help-surface', 4.5);
    check('--color-help-text', '--color-help-surface', 4.5);
    if (palette['--color-on-help-accent']) {
      check('--color-on-help-accent', '--color-help-accent', 4.5);
    }

    const rangeTrack = resolveValue(palette, '--color-range-track');
    const rangeThumb = resolveValue(palette, '--color-range-thumb');
    const hoverTrack = mixHex(rangeTrack, 82, isDark ? '#ffffff' : '#000000');
    assert.ok(contrast(rangeThumb, rangeTrack) >= 2.8, `${id}: unchecked switch thumb vs track below 2.8`);
    assert.ok(contrast(rangeThumb, hoverTrack) >= 2.5, `${id}: hovered unchecked switch thumb vs track below 2.5`);
    assert.notEqual(
      resolveValue(palette, '--color-disabled-text').toLowerCase(),
      resolveValue(palette, '--color-text-muted').toLowerCase(),
      `${id}: disabled text must stay visually distinct from muted text`,
    );

    for (const surface of ['--color-toast-start', '--color-toast-mid', '--color-toast-end']) {
      check('--color-toast-text', surface, 4.5);
      check('--color-toast-secondary', surface, 4.5);
      for (const role of ['accent', 'success', 'warning', 'error']) check(`--color-toast-${role}`, surface, 3);
    }
    for (const role of ['accent', 'success', 'warning', 'error']) check(`--color-toast-on-${role}`, `--color-toast-${role}`, 4.5);

    const toastStart = resolveValue(palette, '--color-toast-start');
    const toastEnd = resolveValue(palette, '--color-toast-end');
    const toastText = resolveValue(palette, '--color-toast-text');
    const toastSecondary = resolveValue(palette, '--color-toast-secondary');
    const toastAccent = resolveValue(palette, '--color-toast-accent');
    const toastError = resolveValue(palette, '--color-toast-error');
    const dangerLight = resolveValue(palette, '--color-danger-light');
    const toastSurfaceA = mixHex(toastStart, isDark ? 94 : 88, '#ffffff');
    const toastRailBg = mixHex(toastAccent, isDark ? 8 : 4, toastSurfaceA);
    const toastActionInk = mixHex(toastAccent, 88, toastText);
    assert.ok(contrast(toastActionInk, toastRailBg) >= 4.5, `${id}: toast action rail contrast below 4.5`);
    const errSurfaceA = isDark ? mixHex(dangerLight, 68, toastStart) : mixHex(dangerLight, 78, '#ffffff');
    const errSurfaceB = isDark ? mixHex(dangerLight, 55, toastEnd) : dangerLight;
    for (const surface of [errSurfaceA, errSurfaceB]) {
      assert.ok(contrast(toastError, surface) >= 4.5, `${id}: error toast accent contrast below 4.5`);
      assert.ok(contrast(toastText, surface) >= 4.5, `${id}: error toast title contrast below 4.5`);
      assert.ok(contrast(toastSecondary, surface) >= 4.5, `${id}: error toast body contrast below 4.5`);
    }

    const bgPrimary = resolveValue(palette, '--color-bg-primary');
    const primaryLight = resolveValue(palette, '--color-primary-light');
    for (let index = 1; index <= 3; index++) {
      const token = palette[`--client-fan-guard-${index}`];
      const color = token ? resolveValue(palette, token) : defaultFanGuards[index - 1];
      assert.ok(contrast(color, bgPrimary) >= 4.5, `${id}: fan guard ${index} on primary surface below 4.5`);
      if (isDark) assert.ok(contrast(color, primaryLight) >= 4.5, `${id}: fan guard ${index} on selected surface below 4.5`);
    }

    if (palette['--client-select-check-fill'] || palette['--client-select-check-ink']) {
      const fill = resolveValue(palette, '--client-select-check-fill') || resolveValue(palette, '--color-primary-fill');
      const ink = resolveValue(palette, '--client-select-check-ink') || resolveValue(palette, '--color-on-primary');
      for (const stop of fill.match(/#[0-9a-f]{6}\b/gi) || []) {
        const ratio = contrast(ink, stop);
        assert.ok(ratio >= 4.5, `${id}: --client-select-check-ink on ${stop} is ${ratio.toFixed(3)}; expected 4.5`);
      }
    }

    if (isDark) {
      check('--color-danger-border', '--color-bg-primary', 3);
      check('--color-help-border', '--color-bg-primary', 3);
    }
  }
});
