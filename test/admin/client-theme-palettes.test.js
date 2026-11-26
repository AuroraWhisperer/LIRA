'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const { CLIENT_THEMES } = require('../../src/shared/client-theme');

const css = fs.readFileSync(path.resolve(__dirname, '../../public/css/desktop/palettes.css'), 'utf8');
const blocks = [...css.replace(/\/\*[\s\S]*?\*\//g, '').matchAll(/([^{}]+)\{([^{}]+)\}/g)];
const declarations = (body) => Object.fromEntries([...body.matchAll(/(--[\w-]+):\s*([^;]+);/g)].map(([, key, value]) => [key, value]));
const baseCss = fs.readFileSync(path.resolve(__dirname, '../../public/css/styles-base.css'), 'utf8');
const baseTokens = declarations(baseCss.match(/:root\s*\{([^}]+)\}/)[1]);

function themeTokens(id) {
  const tokens = { ...baseTokens };
  for (const [, selector, body] of blocks) {
    if (!selector.trimStart().startsWith('html')) continue;
    const selectors = selector.split(',').map((part) => part.trim());
    if (selectors.includes('html[data-client-theme]') || selectors.includes(`html[data-client-theme='${id}']`)) {
      Object.assign(tokens, declarations(body));
    }
  }
  return tokens;
}

function resolveColor(tokens, value) {
  return (tokens[value] || value).replace(/var\((--[\w-]+)\)/g, (_, name) => resolveColor(tokens, name));
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

test('client text, action states, semantic pairs and functional boundaries meet their contrast budgets', () => {
  const defaultFanGuards = ['#c13e52', '#7c49bc', '#276ab3'];

  for (const { id, background, mode } of CLIENT_THEMES) {
    const isDark = mode === 'dark';
    const palette = themeTokens(id);
    assert.equal(palette['--color-bg-page'], background, `${id}: native window and page background`);
    const check = (foreground, bg, minimum) => {
      const ratio = contrast(resolveColor(palette, foreground), resolveColor(palette, bg));
      assert.ok(ratio >= minimum, `${id}: ${foreground} on ${bg} is ${ratio.toFixed(3)}; expected ${minimum}`);
    };
    const surfaces = ['--color-bg-page', '--color-bg-primary', '--color-bg-secondary', '--color-control-surface', '--color-quick-panel-surface'];
    if (palette['--client-gradient-end']) surfaces.push('--client-gradient-end');
    for (const surface of surfaces) {
      for (const text of ['--color-text-primary', '--color-text-secondary', '--color-text-muted']) check(text, surface, 4.5);
      check('--color-control-border', surface, 3);
      check('--color-control-border-hover', surface, 3);
      check('--color-primary-text', surface, 3);
    }
    check('--color-primary-text', '--color-quick-panel-surface', 4.5);
    for (const action of ['--color-primary-fill', '--color-primary-fill-hover', '--color-primary-fill-active']) {
      for (const stop of resolveColor(palette, action).match(/#[0-9a-f]{6}/g)) check('--color-on-primary', stop, 4.5);
    }
    check('--color-on-control-accent', '--color-control-accent', 4.5);
    check('--color-on-control-accent', '--color-selection-marker', 4.5);
    check('--color-text-selection-text', '--color-text-selection-bg', 4.5);
    check('--color-selection-marker', '--color-primary-light', 3);
    check('--color-selection-text', '--color-primary-light', 4.5);
    check('--color-primary-text', '--color-primary-light', 4.5);
    for (const stop of resolveColor(palette, '--color-selection-fill').match(/#[0-9a-f]{6}/g)) {
      check('--color-selection-text', stop, 4.5);
      check('--color-text-secondary', stop, 4.5);
    }
    for (const role of ['success', 'warning', 'danger', 'info']) {
      check(`--color-${role}`, `--color-${role}-light`, 4.5);
      check(`--color-${role}`, '--color-bg-secondary', 4.5);
      check(`--color-${role}`, '--color-quick-panel-surface', 4.5);
    }
    check('--color-danger', '--color-danger-active', 4.5);
    check('--color-help-accent', '--color-help-surface', 4.5);
    check('--color-help-text', '--color-help-surface', 4.5);

    const rangeTrack = resolveColor(palette, '--color-range-track');
    const rangeThumb = resolveColor(palette, '--color-range-thumb');
    const hoverTrack = mixHex(rangeTrack, 82, isDark ? '#ffffff' : '#000000');
    assert.ok(contrast(rangeThumb, rangeTrack) >= 2.8, `${id}: unchecked switch thumb vs track below 2.8`);
    assert.ok(contrast(rangeThumb, hoverTrack) >= 2.5, `${id}: hovered unchecked switch thumb vs track below 2.5`);
    assert.notEqual(
      resolveColor(palette, '--color-disabled-text').toLowerCase(),
      resolveColor(palette, '--color-text-muted').toLowerCase(),
      `${id}: disabled text must stay visually distinct from muted text`,
    );

    for (const surface of ['--color-toast-start', '--color-toast-mid', '--color-toast-end']) {
      check('--color-toast-text', surface, 4.5);
      check('--color-toast-secondary', surface, 4.5);
      for (const role of ['accent', 'success', 'warning', 'error']) check(`--color-toast-${role}`, surface, 3);
    }
    for (const role of ['accent', 'success', 'warning', 'error']) check(`--color-toast-on-${role}`, `--color-toast-${role}`, 4.5);

    const toastStart = resolveColor(palette, '--color-toast-start');
    const toastEnd = resolveColor(palette, '--color-toast-end');
    const toastText = resolveColor(palette, '--color-toast-text');
    const toastSecondary = resolveColor(palette, '--color-toast-secondary');
    const toastAccent = resolveColor(palette, '--color-toast-accent');
    const toastError = resolveColor(palette, '--color-toast-error');
    const dangerLight = resolveColor(palette, '--color-danger-light');
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

    const bgPrimary = resolveColor(palette, '--color-bg-primary');
    const primaryLight = resolveColor(palette, '--color-primary-light');
    for (let index = 1; index <= 3; index++) {
      const token = palette[`--client-fan-guard-${index}`];
      const color = token && token !== 'initial' ? resolveColor(palette, token) : defaultFanGuards[index - 1];
      assert.ok(contrast(color, bgPrimary) >= 4.5, `${id}: fan guard ${index} on primary surface below 4.5`);
      if (isDark) assert.ok(contrast(color, primaryLight) >= 4.5, `${id}: fan guard ${index} on selected surface below 4.5`);
    }

    if (isDark) {
      check('--color-danger-border', '--color-bg-primary', 3);
      check('--color-help-border', '--color-bg-primary', 3);
    }
  }

  // Verify custom select-menu checkbox ink overrides meet contrast across gradient stops.
  for (const [, selector, body] of blocks) {
    if (!selector.includes('.lira-multiselect')) continue;
    const decls = declarations(body);
    if (!decls['--select-check-fill'] || !decls['--select-check-ink']) continue;
    for (const stop of decls['--select-check-fill'].match(/#[0-9a-f]{6}/g) || []) {
      const ratio = contrast(decls['--select-check-ink'], stop);
      assert.ok(ratio >= 4.5, `${selector.trim()}: --select-check-ink on ${stop} is ${ratio.toFixed(3)}; expected 4.5`);
    }
  }
});
