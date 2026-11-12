'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { loadModuleExports } = require('../helpers/frontend-modules');

async function createReader(fetchRef) {
  const elements = new Map();
  for (const id of ['licenseAgreementOpen', 'licensePrivacyOpen', 'licenseAgreementDialog', 'licenseAgreementDialogTitle', 'licenseAgreementContent', 'licenseAgreementClose']) {
    elements.set(id, {
      textContent: '', scrollTop: 0, open: false,
      addEventListener(type, listener) { this[type] = listener; },
      showModal() { this.open = true; },
      close() { this.open = false; },
    });
  }
  const { initLicenseAgreement } = await loadModuleExports(path.join(__dirname, '../../public/js/admin/settings-license.js'));
  initLicenseAgreement({ documentRef: { getElementById: id => elements.get(id) }, fetchRef });
  return elements;
}

test('switching legal documents ignores a late response and retains each cached text', async () => {
  const requests = [];
  const reader = await createReader(url => new Promise(resolve => { requests.push({ url, resolve }); }));
  const terms = reader.get('licenseAgreementOpen').click();
  reader.get('licenseAgreementClose').click();
  const privacy = reader.get('licensePrivacyOpen').click();
  requests[1].resolve({ ok: true, text: async () => 'privacy text' });
  await privacy;
  requests[0].resolve({ ok: true, text: async () => 'terms text' });
  await terms;
  assert.equal(reader.get('licenseAgreementContent').textContent, 'privacy text');
  reader.get('licenseAgreementClose').click();
  await reader.get('licenseAgreementOpen').click();
  assert.equal(reader.get('licenseAgreementContent').textContent, 'terms text');
  assert.deepEqual(requests.map(request => request.url), [
    '/pages/admin/toolbox/user-agreement.txt', '/pages/admin/toolbox/privacy-policy.txt',
  ]);
});

test('closing and reopening a pending document reuses its request; a failure can be retried', async () => {
  let attempts = 0;
  let resolveRequest;
  const reader = await createReader(() => {
    attempts += 1;
    return new Promise(resolve => { resolveRequest = resolve; });
  });
  const first = reader.get('licensePrivacyOpen').click();
  reader.get('licenseAgreementClose').click();
  const second = reader.get('licensePrivacyOpen').click();
  assert.equal(attempts, 1);
  resolveRequest({ ok: false, status: 503 });
  await Promise.all([first, second]);
  reader.get('licenseAgreementClose').click();
  const retry = reader.get('licensePrivacyOpen').click();
  resolveRequest({ ok: true, text: async () => 'recovered privacy text' });
  await retry;
  assert.equal(attempts, 2);
  assert.equal(reader.get('licenseAgreementContent').textContent, 'recovered privacy text');
});
