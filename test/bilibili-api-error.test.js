'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { formatBilibiliApiError } = require('../src/bilibili/api-error');

test('Bilibili errors retain upstream hints, fallback messages and bounded data', () => {
  for (const [code, hint] of [
    [-352, '风控/校验失败'],
    [60004, '直播间不存在'],
    [-400, '请求参数错误'],
    [-412, '请求被风控拦截'],
    [99, '非成功业务码'],
  ]) {
    const data = { value: 'x'.repeat(300) };
    const message = formatBilibiliApiError(
      'fixture',
      { status: 403 },
      {
        code: String(code),
        msg: 'upstream',
        data,
      },
      'extra',
    );
    assert.ok(message.startsWith(`直播平台 API fixture failed: http=403 code=${code} message=upstream.`));
    assert.ok(message.includes(hint));
    assert.ok(message.endsWith(` extra data=${JSON.stringify(data).slice(0, 220)}`));
  }
  const message = formatBilibiliApiError('fixture', { status: 500 }, null);
  assert.ok(message.includes('message=未知错误.'));
  assert.equal(message.includes(' data='), false);
});
