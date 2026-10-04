'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const { CLIENT_THEMES, DEFAULT_CLIENT_THEME_ID, CLIENT_THEME_BACKGROUNDS } = require('../../src/shared/client-theme');

const css = fs.readFileSync(path.resolve(__dirname, '../../public/css/desktop/palettes.css'), 'utf8');
const blocks = [...css.matchAll(/([^{}]+)\{([^{}]+)\}/g)];
const declarations = (body) => Object.fromEntries([...body.matchAll(/(--[\w-]+):\s*([^;]+);/g)].map(([, key, value]) => [key, value]));
const defaultBlock = blocks.find(([, selector, body]) => selector.includes('html[data-client-theme],') && /--color-primary:/.test(body));
const aliasBlock = blocks.find(([, , body]) => /--primary:/.test(body));
const paletteBlocks = Object.fromEntries(blocks.flatMap((block) => {
  const id = block[1].match(/html\[data-client-theme='([^']+)'\]/)?.[1];
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

test('all client palettes define their base colors and rebind compatibility aliases in samples', () => {
  assert.deepEqual(Object.keys(palettes).sort(), CLIENT_THEMES.map(({ id }) => id).sort());
  const keys = Object.keys(declarations(defaultBlock[2]));
  for (const [id, palette] of Object.entries(palettes)) {
    assert.equal(palette['--color-bg-page'], CLIENT_THEME_BACKGROUNDS[id], `${id} native and CSS page backgrounds must match`);
    for (const key of keys) {
      assert.ok(Object.hasOwn(palette, key), `${id} must not inherit ${key} from another palette`);
      assert.match(palette[key], /^#[0-9a-f]{6}$/);
    }
    for (const value of Object.values(aliases)) {
      for (const [, reference] of value.matchAll(/var\((--[\w-]+)\)/g)) {
        assert.ok(reference in palette || reference in aliases, `missing ${reference} in ${id}`);
      }
    }
    for (const key of Object.keys(palette)) {
      assert.ok(key in palettes[DEFAULT_CLIENT_THEME_ID] || key in aliases, `${id}: ${key} must reset in other palettes and previews`);
    }
  }
  assert.match(defaultBlock[1], /html\.desktop-shell/);
  assert.match(defaultBlock[1], /html\[data-client-theme\]/);
  assert.match(aliasBlock[1], /\[data-client-theme-preview\]/);
  for (const { id } of CLIENT_THEMES) {
    if (id !== DEFAULT_CLIENT_THEME_ID) assert.ok(paletteBlocks[id][1].includes(`[data-client-theme-preview='${id}']`));
  }
  assert.match(paletteBlocks['black-silver'][2], /color-scheme:\s*dark;/);
  assert.equal(aliases['--primary'], 'var(--color-primary)');
  assert.equal(aliases['--color-control-focus'], 'var(--color-primary-text)');
  assert.doesNotMatch(css, /:root|body\s*\{/);
});

test('client theme selectors stay in the palette owner instead of business styles', () => {
  const cssRoot = path.resolve(__dirname, '../../public/css');
  for (const file of fs.readdirSync(cssRoot, { recursive: true })) {
    if (!file.endsWith('.css') || file.replaceAll('\\', '/') === 'desktop/palettes.css') continue;
    assert.doesNotMatch(fs.readFileSync(path.join(cssRoot, file), 'utf8'), /\[data-client-theme\s*=\s*['"]/, file);
  }
});

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
