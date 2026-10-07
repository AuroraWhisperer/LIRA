'use strict';

const test = require('node:test');
const { chromium } = require('playwright');

// Launches one headless Chromium per test file. Each session owns isolated
// browser contexts, so tests keep separate storage and routes without paying
// for another browser process; closing a session closes only its contexts.
function useSharedBrowser() {
  let browser;
  test.before(async () => { browser = await chromium.launch({ headless: true }); });
  test.after(async () => { await browser?.close(); });
  return function openBrowserSession() {
    const contexts = new Set();
    return {
      async newContext(options) {
        const context = await browser.newContext(options);
        contexts.add(context);
        return context;
      },
      async newPage(options) {
        return (await this.newContext(options)).newPage();
      },
      async close() {
        await Promise.all([...contexts].map(context => context.close()));
        contexts.clear();
      },
    };
  };
}

module.exports = { useSharedBrowser };
