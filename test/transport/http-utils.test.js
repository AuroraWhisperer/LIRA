'use strict';

const assert = require('node:assert/strict');
const { EventEmitter } = require('node:events');
const test = require('node:test');
const httpUtils = require('../../src/server/http-utils');

test('sendStableError maps known failures and never exposes internal details', () => {
  const stackError = new Error('Critical failure');
  stackError.stack = 'Error: Critical failure\n    at Object.<anonymous> (/app/src/secret-module.js:10:15)';
  for (const [name, error, status, message, hidden] of [
    ['malformed JSON', new Error('Invalid JSON body.'), 400, 'Request body must be valid JSON.', ['stack']],
    ['oversized body', new Error('Request body is too large.'), 413, 'Request body exceeds size limit.', []],
    [
      'unexpected exception',
      new Error('Unexpected database connection failed at /internal/path/db.js:42'),
      500,
      'Internal server error.',
      ['database', '/internal/path'],
    ],
    ['null error', null, 500, 'Internal server error.', []],
    ['error with stack trace', stackError, 500, 'Internal server error.', ['secret-module', 'Critical failure']],
  ]) {
    const response = createMockResponse();
    httpUtils.sendStableError(response, error);
    assert.equal(response.statusCode, status, name);
    assert.deepEqual(response.body, { ok: false, error: message }, name);
    for (const value of hidden) assert.ok(!JSON.stringify(response.body).includes(value), `${name} leaked ${value}`);
  }
});

test('readJsonBody enforces the byte limit and JSON syntax and treats an empty body as an object', async () => {
  await assert.rejects(httpUtils.readJsonBody(createMockRequest('{"data": "large payload"}'), 10), {
    message: 'Request body is too large.',
  });
  await assert.rejects(httpUtils.readJsonBody(createMockRequest('not valid json {]'), 1000), {
    message: 'Invalid JSON body.',
  });
  assert.deepEqual(await httpUtils.readJsonBody(createMockRequest('{"test": "value"}'), 1000), { test: 'value' });
  assert.deepEqual(await httpUtils.readJsonBody(createMockRequest(''), 1000), {});
});

function createMockResponse() {
  return {
    statusCode: 0,
    headers: {},
    body: null,
    writeHead(status, headers) {
      this.statusCode = status;
      this.headers = headers || {};
    },
    end(data) {
      if (data) this.body = JSON.parse(data);
    },
  };
}

function createMockRequest(data) {
  const req = new EventEmitter();
  req.destroy = function () {
    this.emit('close');
  };
  req.resume = function () {};
  setImmediate(() => {
    if (data) req.emit('data', Buffer.from(data));
    req.emit('end');
  });
  return req;
}
