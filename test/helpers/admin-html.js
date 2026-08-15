'use strict';

const path = require('node:path');
const { composeAdminHtml } = require('../../src/server/admin-page');

const PUBLIC_DIR = path.resolve(__dirname, '..', '..', 'public');

function readAdminHtml() {
  return composeAdminHtml(PUBLIC_DIR);
}

module.exports = { readAdminHtml };
