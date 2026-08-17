// 编写人：Aurora
// 单元测试：Electron 外部 URL 安全策略
'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const { isAllowedExternal, isAllowedLoginNavigation } = require('../src/electron/external-url-policy');

describe('external-url-policy', () => {
  describe('isAllowedExternal', () => {
    it('allows https:// URLs', () => {
      assert.strictEqual(isAllowedExternal('https://example.com'), true);
      assert.strictEqual(isAllowedExternal('https://github.com/user/repo'), true);
      assert.strictEqual(isAllowedExternal('https://sub.domain.example.com/path?query=1'), true);
    });

    it('rejects http:// URLs', () => {
      assert.strictEqual(isAllowedExternal('http://example.com'), false);
    });

    it('rejects file:// URLs', () => {
      assert.strictEqual(isAllowedExternal('file:///C:/Windows/System32/calc.exe'), false);
      assert.strictEqual(isAllowedExternal('file:///etc/passwd'), false);
    });

    it('rejects javascript: URLs', () => {
      assert.strictEqual(isAllowedExternal('javascript:alert(1)'), false);
    });

    it('rejects data: URLs', () => {
      assert.strictEqual(isAllowedExternal('data:text/html,<script>alert(1)</script>'), false);
    });

    it('rejects ms-settings: URLs', () => {
      assert.strictEqual(isAllowedExternal('ms-settings:network-proxy'), false);
    });

    it('rejects custom protocol URLs', () => {
      assert.strictEqual(isAllowedExternal('customapp://open'), false);
      assert.strictEqual(isAllowedExternal('spotify:track:123'), false);
    });

    it('rejects invalid URLs', () => {
      assert.strictEqual(isAllowedExternal('not a url'), false);
      assert.strictEqual(isAllowedExternal(''), false);
      assert.strictEqual(isAllowedExternal('://invalid'), false);
    });
  });

  describe('isAllowedLoginNavigation', () => {
    const testDomains = ['example.com', 'login.example.com', 'bilibili.com'];

    it('allows https:// URLs with exact hostname match', () => {
      assert.strictEqual(isAllowedLoginNavigation('https://example.com', testDomains), true);
      assert.strictEqual(isAllowedLoginNavigation('https://example.com/login', testDomains), true);
      assert.strictEqual(isAllowedLoginNavigation('https://bilibili.com', testDomains), true);
    });

    it('allows https:// URLs with subdomain match', () => {
      assert.strictEqual(isAllowedLoginNavigation('https://api.example.com', testDomains), true);
      assert.strictEqual(isAllowedLoginNavigation('https://www.example.com', testDomains), true);
      assert.strictEqual(isAllowedLoginNavigation('https://passport.bilibili.com', testDomains), true);
    });

    it('rejects http:// URLs even with allowed domains', () => {
      assert.strictEqual(isAllowedLoginNavigation('http://example.com', testDomains), false);
      assert.strictEqual(isAllowedLoginNavigation('http://bilibili.com', testDomains), false);
    });

    it('rejects URLs with disallowed hostnames', () => {
      assert.strictEqual(isAllowedLoginNavigation('https://evil.com', testDomains), false);
      assert.strictEqual(isAllowedLoginNavigation('https://notexample.com', testDomains), false);
    });

    it('rejects URLs that only partially match allowed domains', () => {
      assert.strictEqual(isAllowedLoginNavigation('https://fakeexample.com', testDomains), false);
      assert.strictEqual(isAllowedLoginNavigation('https://example.com.evil.com', testDomains), false);
    });

    it('rejects file:// URLs even if hostname matches', () => {
      assert.strictEqual(isAllowedLoginNavigation('file:///example.com/path', testDomains), false);
    });

    it('rejects javascript: URLs', () => {
      assert.strictEqual(isAllowedLoginNavigation('javascript:alert(1)', testDomains), false);
    });

    it('rejects data: URLs', () => {
      assert.strictEqual(isAllowedLoginNavigation('data:text/html,<h1>Test</h1>', testDomains), false);
    });

    it('rejects invalid URLs', () => {
      assert.strictEqual(isAllowedLoginNavigation('not a url', testDomains), false);
      assert.strictEqual(isAllowedLoginNavigation('', testDomains), false);
    });

    it('handles case-insensitive hostname matching', () => {
      assert.strictEqual(isAllowedLoginNavigation('https://EXAMPLE.COM', testDomains), true);
      assert.strictEqual(isAllowedLoginNavigation('https://Example.Com', testDomains), true);
      assert.strictEqual(isAllowedLoginNavigation('https://API.EXAMPLE.COM', testDomains), true);
    });

    it('handles empty domain list', () => {
      assert.strictEqual(isAllowedLoginNavigation('https://example.com', []), false);
      assert.strictEqual(isAllowedLoginNavigation('https://any.com', []), false);
    });

    it('allows nested subdomains', () => {
      assert.strictEqual(isAllowedLoginNavigation('https://a.b.c.example.com', testDomains), true);
      assert.strictEqual(isAllowedLoginNavigation('https://deep.sub.bilibili.com', testDomains), true);
    });
  });
});
