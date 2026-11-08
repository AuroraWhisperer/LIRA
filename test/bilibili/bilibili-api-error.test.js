'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { formatBilibiliApiError } = require('../../src/bilibili/api-error');

test('Bilibili errors bound upstream data in diagnostic output', () => {
  const message = formatBilibiliApiError('fixture', { status: 403 }, {
    code: -352,
    data: { value: `preview-start${'x'.repeat(1000)}preview-end` },
  });
  assert.match(message, /preview-start/);
  assert.doesNotMatch(message, /x{221}|preview-end/);
});

test('Bilibili error data redacts nested credentials before serializing diagnostics', () => {
  const message = formatBilibiliApiError(
    'getDanmuInfo',
    { status: 403 },
    {
      code: -352,
      data: { token: 'synthetic-auth-token', nested: { SESSDATA: 'synthetic-session-cookie', hint: 'retry' } },
    },
  );
  assert.doesNotMatch(message, /synthetic-auth-token|synthetic-session-cookie/);
  assert.match(message, /REDACTED/);
  assert.match(message, /retry/);
});
