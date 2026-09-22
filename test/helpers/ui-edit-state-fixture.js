'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { chromium } = require('playwright');

const publicRoot = path.join(__dirname, '..', '..', 'public');
const limits = {
  maxEnabledRules: 8,
  minRandomOutcomes: 2,
  maxRandomOutcomes: 10,
  maxDisplayTextLength: 6,
};
const initialState = {
  revision: 10,
  enabled: true,
  status: 'paused',
  initialSeconds: 300,
  effectiveRemainingMs: 300000,
  limits,
  settlements: [],
  rules: [
    {
      giftId: 'synthetic-gift',
      giftName: '测试礼物',
      mode: 'random',
      enabled: true,
      quantityMode: 'group',
      sortOrder: 0,
      outcomes: [60, 120, 180].map((value) => ({
        operation: 'add',
        value,
        weight: 1,
      })),
    },
  ],
};
function createUiFixture() {
  let browser;
  test.before(async () => {
    browser = await chromium.launch({ headless: true });
  });
  test.after(async () => {
    await browser?.close();
  });

  async function fixture(t, kind = 'admin') {
    const context = await browser.newContext({ serviceWorkers: 'block' });
    const page = await context.newPage();
    const errors = [];
    page.on('pageerror', (error) => errors.push(error.message));
    t.after(async () => {
      await context.close();
      assert.deepEqual(errors, []);
    });
    await page.addInitScript(
      ({ state }) => {
        window.initialState = state;
        window.pendingSaves = [];
        window.pendingSnapshots = [];
        window.messages = [];
        window.saveSetting = (key, value) =>
          new Promise((resolve, reject) => {
            window.pendingSaves.push({ key, value, resolve, reject });
          });
        window.fetch = (url) => {
          if (url === '/api/state')
            return new Promise((resolve, reject) => {
              window.pendingSnapshots.push({
                resolve: (overtime) =>
                  resolve({
                    json: async () => ({ ok: true, data: { overtime } }),
                  }),
                reject,
              });
            });
          if (url === '/api/overtime')
            return Promise.resolve({
              json: async () => ({ ok: true, data: state }),
            });
          if (url === '/api/overtime/gifts')
            return Promise.resolve({
              json: async () => ({ ok: true, data: { gifts: [] } }),
            });
          throw new Error(`Unexpected fixture fetch: ${url}`);
        };
      },
      { state: initialState },
    );
    await page.route('**/*', async (route) => {
      const url = new URL(route.request().url());
      if (url.hostname !== 'lira-ui.test') {
        errors.push(`Unexpected external request: ${url.origin}`);
        return route.abort();
      }
      let body;
      let contentType = 'text/javascript';
      if (url.pathname === '/') {
        contentType = 'text/html';
        body =
          kind === 'admin'
            ? fs.readFileSync(path.join(publicRoot, 'pages/admin/toolbox/overtime.html'), 'utf8') +
              '<script type="module">import { initOvertime } from "/js/admin/overtime.js"; initOvertime(); window.ready = true;</script>'
            : kind === 'overlay'
              ? fs.readFileSync(path.join(publicRoot, 'pages/overlays/overtime.html'), 'utf8')
              : '<!doctype html><body></body>';
      } else if (url.pathname === '/js/shared/utils.js') {
        body = `export const api = (url, body) => new Promise((resolve, reject) => window.pendingSaves.push({ url, body: structuredClone(body), resolve, reject }));
          export const copyText = async () => {}; export const localOverlayOrigin = () => 'http://lira-ui.test';
          export const readJsonResponse = (response) => response.json();
          export const showError = (error) => window.messages.push(error.message);
          export const toast = (message) => window.messages.push(message);`;
      } else if (url.pathname === '/js/shared/event-bus.js') {
        body = `const listeners = new Map(); export const eventBus = { on: (name, callback) => listeners.set(name, callback) };
          export const Events = { STATE_LOADED: 'state', OVERTIME_UPDATED: 'overtime', GIFT_CATALOG_UPDATED: 'gifts' };
          window.pushState = (state) => listeners.get('state')({ state: { overtime: state } });`;
      } else if (url.pathname === '/js/overlays/socket-client.js') {
        body =
          'export const createOverlaySocket = (options) => { window.socketOptions = options; return { start() {}, dispose() {} }; };';
      } else if (/^\/js\/[a-z0-9/-]+\.js$/i.test(url.pathname)) {
        body = fs.readFileSync(path.join(publicRoot, url.pathname.slice(1)), 'utf8');
      } else {
        contentType = 'text/html';
        body = '';
      }
      return route.fulfill({ status: 200, contentType, body });
    });
    await page.goto('http://lira-ui.test/');
    if (kind === 'admin') await page.waitForFunction(() => document.querySelector('[data-overtime-rule]'));
    if (kind === 'overlay') await page.waitForFunction(() => window.socketOptions);
    return page;
  }

  return fixture;
}

module.exports = { createUiFixture, limits };
