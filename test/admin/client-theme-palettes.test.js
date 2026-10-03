'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const css = fs.readFileSync(path.resolve(__dirname, '../../public/css/desktop/palettes.css'), 'utf8');
const blocks = [...css.matchAll(/([^{}]+)\{([^{}]+)\}/g)];
const declarations = (body) => Object.fromEntries([...body.matchAll(/(--[\w-]+):\s*([^;]+);/g)].map(([, key, value]) => [key, value]));
const palettes = {
  terracotta: declarations(blocks[0][2]),
  neutral: declarations(blocks[1][2]),
  classic: declarations(blocks[2][2]),
};
const aliases = declarations(blocks[3][2]);

function luminance(hex) {
  const channels = hex.slice(1).match(/../g).map((part) => parseInt(part, 16) / 255);
  const linear = channels.map((value) => value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4);
  return linear[0] * 0.2126 + linear[1] * 0.7152 + linear[2] * 0.0722;
}

function contrast(first, second) {
  const values = [luminance(first), luminance(second)].sort((a, b) => b - a);
  return (values[0] + 0.05) / (values[1] + 0.05);
}

test('all client palettes define the same colors and rebind compatibility aliases in samples', () => {
  const keys = Object.keys(palettes.neutral).sort();
  for (const [id, palette] of Object.entries(palettes)) {
    assert.deepEqual(Object.keys(palette).sort(), keys, `${id} must not inherit a missing color from another palette`);
    for (const value of Object.values(palette)) assert.match(value, /^#[0-9a-f]{6}$/);
    for (const value of Object.values(aliases)) {
      for (const [, reference] of value.matchAll(/var\((--[\w-]+)\)/g)) {
        assert.ok(reference in palette || reference in aliases, `missing ${reference} in ${id}`);
      }
    }
  }
  assert.match(blocks[0][1], /html\.desktop-shell/);
  assert.match(blocks[0][1], /html\[data-client-theme\]/);
  assert.match(blocks[1][1], /html\[data-client-theme='neutral'\]/);
  assert.match(blocks[3][1], /\[data-client-theme-preview\]/);
  assert.equal(aliases['--primary'], 'var(--color-primary)');
  assert.equal(aliases['--color-control-focus'], 'var(--color-primary-text)');
  assert.doesNotMatch(css, /:root|body\s*\{/);
});

test('client text, action states, semantic pairs and functional boundaries meet their contrast budgets', () => {
  for (const [id, palette] of Object.entries(palettes)) {
    const check = (foreground, background, minimum) => {
      const ratio = contrast(palette[foreground] || foreground, palette[background] || background);
      assert.ok(ratio >= minimum, `${id}: ${foreground} on ${background} is ${ratio.toFixed(3)}; expected ${minimum}`);
    };
    for (const surface of ['--color-bg-page', '--color-bg-primary', '--color-bg-secondary', '--color-control-surface']) {
      for (const text of ['--color-text-primary', '--color-text-secondary', '--color-text-muted']) check(text, surface, 4.5);
      check('--color-control-border', surface, 3);
      check('--color-control-border-hover', surface, 3);
      check('--color-primary-text', surface, 3);
    }
    for (const action of ['--color-primary', '--color-primary-strong', '--color-primary-active']) check('#ffffff', action, 4.5);
    check('--color-primary-text', '--color-primary-light', 4.5);
    for (const role of ['success', 'warning', 'danger', 'info']) check(`--color-${role}`, `--color-${role}-light`, 4.5);
    check('--color-danger', '--color-danger-active', 4.5);
    for (const surface of ['--color-toast-start', '--color-toast-mid', '--color-toast-end']) {
      check('--color-toast-text', surface, 4.5);
      check('--color-toast-secondary', surface, 4.5);
      for (const role of ['accent', 'success', 'warning', 'error']) check(`--color-toast-${role}`, surface, 3);
    }
    for (const role of ['accent', 'success', 'warning', 'error']) check('#ffffff', `--color-toast-${role}`, 4.5);
  }
});
