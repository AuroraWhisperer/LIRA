'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { createLicenseOperations } = require('../../src/electron/license/license-operations');

test('PK reads/writes reject late old-account responses and automatic retries after switching', async () => {
  for (const method of ['getPkReportSettings', 'updatePkReportSettings']) {
    let owner = 'one',
      resolve,
      retry,
      calls = 0;
    const operations = createLicenseOperations({
      remote: {
        [method]: () => {
          calls++;
          return new Promise((done) => {
            resolve = done;
          });
        },
      },
      getOverlayOwner: () => owner,
      isDisposed: () => false,
      withAuthorizedToken: (operation) => {
        retry = operation;
        return operation('one-token');
      },
    });
    const pending = operations[method]({ enabled: true });
    owner = 'two';
    resolve({ ok: true, enabled: true });
    await assert.rejects(pending, { code: 'LICENSE_NOT_AUTHORIZED' });
    await assert.rejects(retry('two-token'), { code: 'LICENSE_NOT_AUTHORIZED' });
    assert.equal(calls, 1);
  }
});
