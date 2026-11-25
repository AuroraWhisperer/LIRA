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

function luminance(hex) {
  const channels = hex.slice(1).match(/../g).map((part) => parseInt(part, 16) / 255);
  const linear = channels.map((value) => value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4);
  return linear[0] * 0.2126 + linear[1] * 0.7152 + linear[2] * 0.0722;
}

function contrast(first, second) {
  const values = [luminance(first), luminance(second)].sort((a, b) => b - a);
  return (values[0] + 0.05) / (values[1] + 0.05);
}

test('client text, action states, semantic pairs and functional boundaries meet their contrast budgets', () => {
  for (const { id, background } of CLIENT_THEMES) {
    const palette = themeTokens(id);
    assert.equal(palette['--color-bg-page'], background, `${id}: native window and page background`);
    const check = (foreground, background, minimum) => {
      const ratio = contrast(resolveColor(palette, foreground), resolveColor(palette, background));
      assert.ok(ratio >= minimum, `${id}: ${foreground} on ${background} is ${ratio.toFixed(3)}; expected ${minimum}`);
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
    check('--color-text-selection-text', '--color-text-selection-bg', 4.5);
    check('--color-selection-marker', '--color-primary-light', 3);
    check('--color-selection-text', '--color-primary-light', 4.5);
    check('--color-primary-text', '--color-primary-light', 4.5);
    for (const stop of resolveColor(palette, '--color-selection-fill').match(/#[0-9a-f]{6}/g)) {
      check('--color-selection-text', stop, 4.5);
      check('--color-text-secondary', stop, 4.5);
    }
    for (const role of ['success', 'warning', 'danger', 'info']) check(`--color-${role}`, `--color-${role}-light`, 4.5);
    check('--color-danger', '--color-danger-active', 4.5);
    for (const surface of ['--color-toast-start', '--color-toast-mid', '--color-toast-end']) {
      check('--color-toast-text', surface, 4.5);
      check('--color-toast-secondary', surface, 4.5);
      for (const role of ['accent', 'success', 'warning', 'error']) check(`--color-toast-${role}`, surface, 3);
    }
    for (const role of ['accent', 'success', 'warning', 'error']) check(`--color-toast-on-${role}`, `--color-toast-${role}`, 4.5);
  }
});
