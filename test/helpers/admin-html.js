'use strict';

const path = require('node:path');
const { composeAdminHtml, readAdminFragment } = require('../../src/server/admin-page');

const PUBLIC_DIR = path.resolve(__dirname, '..', '..', 'public');

function readAdminHtml() {
  return composeAdminHtml(PUBLIC_DIR);
}

// One admin fragment with its nested admin-fragment includes expanded, as the server composes it.
function readAdminFragmentHtml(relativePath) {
  return readAdminFragment(PUBLIC_DIR, relativePath);
}

module.exports = { readAdminFragmentHtml, readAdminHtml };
