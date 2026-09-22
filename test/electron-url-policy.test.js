// 编写人：Aurora
// 单元测试：Electron 外部 URL 安全策略
'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const {
  isAllowedExternal,
  isAllowedLocalUrl,
  isAllowedLoginNavigation,
} = require('../src/electron/external-url-policy');

describe('external-url-policy', () => {
  describe('isAllowedExternal', () => {
    const cases = [
      ['https://example.com', true],
      ['https://github.com/user/repo', true],
      ['https://sub.domain.example.com/path?query=1', true],
      ['http://example.com', false],
      ['file:///C:/Windows/System32/calc.exe', false],
      ['file:///etc/passwd', false],
      ['javascript:alert(1)', false],
      ['data:text/html,<script>alert(1)</script>', false],
      ['ms-settings:network-proxy', false],
      ['customapp://open', false],
      ['spotify:track:123', false],
      ['not a url', false],
      ['', false],
      ['://invalid', false],
    ];

    for (const [url, expected] of cases) {
      it(`${expected ? 'allows' : 'rejects'} ${url || '(empty URL)'}`, () => {
        assert.strictEqual(isAllowedExternal(url), expected);
      });
    }
  });
  describe('isAllowedLoginNavigation', () => {
    const testDomains = ['example.com', 'login.example.com', 'bilibili.com'];
    const cases = [
      ['https://example.com', true],
      ['https://example.com/login', true],
      ['https://bilibili.com', true],
      ['https://api.example.com', true],
      ['https://www.example.com', true],
      ['https://passport.bilibili.com', true],
      ['http://example.com', false],
      ['http://bilibili.com', false],
      ['https://evil.com', false],
      ['https://notexample.com', false],
      ['https://fakeexample.com', false],
      ['https://example.com.evil.com', false],
      ['file:///example.com/path', false],
      ['javascript:alert(1)', false],
      ['data:text/html,<h1>Test</h1>', false],
      ['not a url', false],
      ['', false],
      ['https://EXAMPLE.COM', true],
      ['https://Example.Com', true],
      ['https://API.EXAMPLE.COM', true],
      ['https://example.com', false, []],
      ['https://any.com', false, []],
      ['https://a.b.c.example.com', true],
      ['https://deep.sub.bilibili.com', true],
    ];

    for (const [url, expected, domains = testDomains] of cases) {
      it(
        `${expected ? 'allows' : 'rejects'} ${url || '(empty URL)'}` +
          (domains.length ? '' : ' with no allowed domains'),
        () => {
          assert.strictEqual(isAllowedLoginNavigation(url, domains), expected);
        },
      );
    }
  });
  describe('isAllowedLocalUrl', () => {
    const cases = [
      ['http://127.0.0.1/overtime', true],
      ['http://127.0.0.1:4312/overtime?quality=low', true],
      ['http://localhost/overtime', false],
      ['http://127.0.0.2/overtime', false],
      ['http://127.0.0.1.evil.example/overtime', false],
      ['http://user:pass@127.0.0.1/overtime', false],
      ['https://127.0.0.1/overtime', false],
    ];

    for (const [url, expected] of cases) {
      it(`${expected ? 'allows' : 'rejects'} ${url || '(empty URL)'}`, () => {
        assert.strictEqual(isAllowedLocalUrl(url), expected);
      });
    }
  });
});
