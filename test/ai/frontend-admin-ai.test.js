'use strict';

const { readAdminHtml } = require('../helpers/admin-html');

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const ROOT_DIR = path.join(__dirname, '../..');

test('the complete admin document contains no hardcoded AI API key', () => {
  assert.doesNotMatch(readAdminHtml(), /sk-[A-Za-z0-9_-]{8,}/);
});

test('AI configuration renders API text without HTML injection', () => {
  for (const name of ['ai-assistant-settings.js', 'ai-assistant-config-view.js']) {
    const source = fs.readFileSync(path.join(ROOT_DIR, 'public/js/admin', name), 'utf8');
    assert.doesNotMatch(source, /innerHTML\s*=/);
  }
});
