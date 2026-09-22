'use strict';

const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const test = require('node:test');
const protocol = require('../src/electron/license/license-protocol');
const { createRemoteLicenseClient } = require('../src/electron/license/remote-license-client');
const { createLicensePage } = require('./helpers/license-page');
const { readServerFixture } = require('../scripts/verify-server-contract');

const samples = readServerFixture('test/fixtures/password-compatibility.json');

for (const sample of samples) {
  test(`license form preserves shared password sample: ${sample.id}`, async () => {
    const page = createLicensePage({
      state: 'needs_activation',
      error: 'INVALID_CREDENTIALS',
    });
    const password = page.getElementById('licensePassword');
    const event = page.dispatchPasswordEvent('beforeinput', {
      data: sample.password,
    });
    assert.equal(event.defaultPrevented, false);
    password.value = sample.password;
    page.dispatchPasswordEvent('input');
    page.dispatchPasswordEvent('compositionend');
    assert.equal(password.value, sample.password);
    await page.submit();
    assert.equal(page.submissions.length, sample.clientSubmits ? 1 : 0);
    if (sample.clientSubmits) {
      assert.equal(page.submissions[0].password, sample.password);
      assert.equal(page.getElementById('licenseStatus').textContent, '用户名或密码错误。');
    } else {
      assert.equal(page.getElementById('licenseStatus').textContent, '请输入密码。');
    }
    assert.equal(password.value, sample.password, 'failed authentication preserves the original input');
  });
}

for (const sample of samples) {
  test(`privileged activation input preserves shared password sample: ${sample.id}`, () => {
    const result = protocol.validateActivationInput({
      accountName: 'sample-account',
      password: sample.password,
      activationCode: 'SYNTHETIC-CODE',
    });
    assert.equal(result.ok, sample.clientSubmits);
    if (result.ok) {
      assert.equal(result.password, sample.password);
      const payload = protocol.buildActivationPayload({
        ...result,
        fingerprint: {},
      });
      const digest = crypto.createHash('sha256').update(sample.password, 'utf8').digest('hex');
      assert.ok(payload.endsWith(`accountPasswordSha256=${digest}`));
    }
  });
}

for (const sample of samples) {
  test(`activation JSON POST preserves shared password sample: ${sample.id}`, async () => {
    const client = createRemoteLicenseClient({
      baseUrl: 'https://synthetic-api.example',
      fetchImpl: async (url, init) => {
        assert.equal(url, 'https://synthetic-api.example/api/device/activate');
        assert.equal(init.method, 'POST');
        assert.equal(new Headers(init.headers).get('content-type'), 'application/json');
        return new Response(init.body);
      },
    });
    const credentials = {
      accountName: 'sample-account',
      password: sample.password,
      activationCode: 'SYNTHETIC-CODE',
    };
    assert.deepEqual(await client.activate(credentials), credentials);
  });
}
