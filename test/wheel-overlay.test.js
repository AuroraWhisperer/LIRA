'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { servePageOrAsset } = require('../src/server/http-utils');

const ROOT_DIR = path.join(__dirname, '..');
const PUBLIC_DIR = path.join(ROOT_DIR, 'public');

test('wheel overlay is mapped, transparent, and renders labels through DOM APIs', () => {
  const html = fs.readFileSync(
    path.join(PUBLIC_DIR, 'pages', 'overlays', 'wheel.html'),
    'utf8',
  );
  const script = fs.readFileSync(
    path.join(PUBLIC_DIR, 'js', 'overlays', 'wheel.js'),
    'utf8',
  );
  const styles = fs.readFileSync(
    path.join(PUBLIC_DIR, 'css', 'overlays', 'wheel.css'),
    'utf8',
  );
  assert.match(html, /id="wheelSvg"/);
  assert.match(html, /id="wheelCenterButton"/);
  assert.match(html, />GO</);
  assert.match(script, /createElementNS/);
  assert.match(script, /spinFromWheel/);
  assert.match(script, /createRadialLabel/);
  assert.match(script, /tspan/);
  assert.match(script, /textContent/);
  assert.doesNotMatch(script, /innerHTML/);
  assert.match(styles, /background:.*transparent/);
  assert.match(script, /wheel:update/);
  assert.match(script, /prefers-reduced-motion/);
  assert.match(script, /cubic-bezier/);
  assert.match(styles, /\.wheel-center-button/);
  assert.match(styles, /\.wheel-center-arrow/);
});

test('wheel overlay page is served without frame protection headers', () => {
  let headers = {};
  const response = {
    setHeader(name, value) {
      headers[name] = value;
    },
    writeHead(status, nextHeaders) {
      headers = { ...headers, ...nextHeaders };
    },
    end() {},
  };
  servePageOrAsset(
    PUBLIC_DIR,
    { method: 'GET' },
    response,
    new URL('http://127.0.0.1/wheel'),
    'test-token',
  );
  assert.equal(headers['Content-Security-Policy'], undefined);
  assert.equal(headers['X-Frame-Options'], undefined);
});
