'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const { DEFAULT_CLIENT_THEME_ID } = require('../../src/shared/client-theme');

const css = fs.readFileSync(path.resolve(__dirname, '../../public/css/desktop/palettes.css'), 'utf8');
const blocks = [...css.matchAll(/([^{}]+)\{([^{}]+)\}/g)];
const declarations = (body) => Object.fromEntries([...body.matchAll(/(--[\w-]+):\s*([^;]+);/g)].map(([, key, value]) => [key, value]));
const defaultBlock = blocks.find(([, selector, body]) => selector.includes('html[data-client-theme],') && /--color-primary:/.test(body));
const aliasBlock = blocks.find(([, , body]) => /--primary:/.test(body));
const paletteBlocks = Object.fromEntries(blocks.flatMap((block) => {
  const id = block[1].match(/(?:^|[,\n])\s*html\[data-client-theme='([^']+)'\](?:\s*,|\s*$)/)?.[1];
  return id ? [[id, block]] : [];
}));
paletteBlocks[DEFAULT_CLIENT_THEME_ID] = defaultBlock;
const palettes = Object.fromEntries(Object.entries(paletteBlocks).map(([id, block]) => [id, declarations(block[2])]));
const aliases = declarations(aliasBlock[2]);

function resolveColor(palette, value) {
  const tokens = { ...aliases, ...palette };
  return (tokens[value] || value).replace(/var\((--[\w-]+)\)/g, (_, name) => resolveColor(palette, name));
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
  for (const [id, palette] of Object.entries(palettes)) {
    const check = (foreground, background, minimum) => {
      const ratio = contrast(resolveColor(palette, foreground), resolveColor(palette, background));
      assert.ok(ratio >= minimum, `${id}: ${foreground} on ${background} is ${ratio.toFixed(3)}; expected ${minimum}`);
    };
    for (const surface of ['--color-bg-page', '--color-bg-primary', '--color-bg-secondary', '--color-control-surface']) {
      for (const text of ['--color-text-primary', '--color-text-secondary', '--color-text-muted']) check(text, surface, 4.5);
      check('--color-control-border', surface, 3);
      check('--color-control-border-hover', surface, 3);
      check('--color-primary-text', surface, 3);
    }
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
