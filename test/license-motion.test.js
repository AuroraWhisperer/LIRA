'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');

const script = fs.readFileSync(path.join(__dirname, '..', 'public', 'js', 'license-motion.js'), 'utf8');

function createPage(reduced = false) {
  const properties = new Map();
  const art = {
    style: { setProperty: (name, value) => properties.set(name, value) },
  };
  const document = new EventTarget();
  document.hidden = false;
  document.getElementById = (id) => (id === 'licenseArt' ? art : null);
  const preference = new EventTarget();
  preference.matches = reduced;
  const window = new EventTarget();
  window.matchMedia = () => preference;
  let onIntersection;
  let disconnected = false;

  vm.runInNewContext(script, {
    document,
    window,
    IntersectionObserver: class {
      constructor(callback) {
        onIntersection = callback;
      }
      observe(target) {
        assert.equal(target, art);
      }
      disconnect() {
        disconnected = true;
      }
    },
  });

  return {
    document,
    preference,
    window,
    intersect: (isIntersecting) => onIntersection([{ isIntersecting }]),
    state: () => properties.get('--license-motion-play-state'),
    disconnected: () => disconnected,
  };
}

test('license page loads welcome artwork styles and the motion controller', () => {
  const css = fs.readFileSync(path.join(__dirname, '..', 'public', 'css', 'license.css'), 'utf8');
  const artworkCss = fs.readFileSync(path.join(__dirname, '..', 'public', 'css', 'license', 'welcome-art.css'), 'utf8');
  const html = fs.readFileSync(path.join(__dirname, '..', 'public', 'pages', 'license.html'), 'utf8');
  assert.match(css, /@import url\('\.\/license\/welcome-art\.css'\);/);
  assert.match(artworkCss, /animation-play-state: var\(--license-motion-play-state, paused\)/);
  assert.match(artworkCss, /@media \(prefers-reduced-motion: no-preference\)/);
  assert.match(html, /id="licenseArt"/);
  assert.doesNotMatch(html, /licenseMotionToggle|license-motion-toggle/);
  assert.match(html, /<script src="\/js\/license-motion\.js"><\/script>/);
});

test('license motion runs only while the artwork and document are visible', () => {
  const page = createPage();
  assert.equal(page.state(), 'paused');
  page.intersect(true);
  assert.equal(page.state(), 'running');
  page.document.hidden = true;
  page.document.dispatchEvent(new Event('visibilitychange'));
  assert.equal(page.state(), 'paused');
  page.document.hidden = false;
  page.document.dispatchEvent(new Event('visibilitychange'));
  assert.equal(page.state(), 'running');
  page.intersect(false);
  assert.equal(page.state(), 'paused');
});

test('reduced motion changes take effect automatically', () => {
  const page = createPage(true);
  page.intersect(true);
  assert.equal(page.state(), 'paused');
  page.preference.matches = false;
  page.preference.dispatchEvent(new Event('change'));
  assert.equal(page.state(), 'running');
  page.preference.matches = true;
  page.preference.dispatchEvent(new Event('change'));
  assert.equal(page.state(), 'paused');
  page.preference.matches = false;
  page.preference.dispatchEvent(new Event('change'));
  assert.equal(page.state(), 'running');
});

test('leaving the license page stops motion and releases its listeners', () => {
  const page = createPage();
  page.intersect(true);
  page.window.dispatchEvent(new Event('pagehide'));
  assert.equal(page.disconnected(), true);
  assert.equal(page.state(), 'paused');
  page.document.dispatchEvent(new Event('visibilitychange'));
  page.preference.dispatchEvent(new Event('change'));
  assert.equal(page.state(), 'paused');
});
