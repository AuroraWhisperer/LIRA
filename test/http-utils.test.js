'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const httpUtils = require('../src/server/http-utils');

test('sendStableError maps malformed JSON to 400', () => {
  const mockRes = createMockResponse();
  const error = new Error('Invalid JSON body.');

  httpUtils.sendStableError(mockRes, error);

  assert.equal(mockRes.statusCode, 400);
  assert.equal(mockRes.body.ok, false);
  assert.equal(mockRes.body.error, 'Request body must be valid JSON.');
  assert.ok(!mockRes.body.error.includes('stack'), 'Should not leak stack trace');
});

test('sendStableError maps oversized body to 413', () => {
  const mockRes = createMockResponse();
  const error = new Error('Request body is too large.');

  httpUtils.sendStableError(mockRes, error);

  assert.equal(mockRes.statusCode, 413);
  assert.equal(mockRes.body.ok, false);
  assert.equal(mockRes.body.error, 'Request body exceeds size limit.');
});

test('sendStableError maps unexpected exceptions to 500 without details', () => {
  const mockRes = createMockResponse();
  const error = new Error('Unexpected database connection failed at /internal/path/db.js:42');

  httpUtils.sendStableError(mockRes, error);

  assert.equal(mockRes.statusCode, 500);
  assert.equal(mockRes.body.ok, false);
  assert.equal(mockRes.body.error, 'Internal server error.');
  assert.ok(!mockRes.body.error.includes('database'), 'Should not leak internal details');
  assert.ok(!mockRes.body.error.includes('/internal/path'), 'Should not leak file paths');
});

test('sendStableError handles null/undefined error', () => {
  const mockRes = createMockResponse();

  httpUtils.sendStableError(mockRes, null);

  assert.equal(mockRes.statusCode, 500);
  assert.equal(mockRes.body.ok, false);
  assert.equal(mockRes.body.error, 'Internal server error.');
});

test('sendStableError handles error with stack trace without leaking', () => {
  const mockRes = createMockResponse();
  const error = new Error('Critical failure');
  error.stack = 'Error: Critical failure\n    at Object.<anonymous> (/app/src/secret-module.js:10:15)';

  httpUtils.sendStableError(mockRes, error);

  assert.equal(mockRes.statusCode, 500);
  assert.ok(!JSON.stringify(mockRes.body).includes('secret-module'), 'Should not leak stack trace paths');
  assert.ok(!JSON.stringify(mockRes.body).includes('Critical failure'), 'Should not leak internal error message');
});

test('readJsonBody rejects oversized payload', async () => {
  const mockReq = createMockRequest('{"data": "large payload"}');
  const maxBytes = 10; // Smaller than the payload

  await assert.rejects(
    async () => httpUtils.readJsonBody(mockReq, maxBytes),
    { message: 'Request body is too large.' }
  );
});

test('readJsonBody rejects invalid JSON', async () => {
  const mockReq = createMockRequest('not valid json {]');

  await assert.rejects(
    async () => httpUtils.readJsonBody(mockReq, 1000),
    { message: 'Invalid JSON body.' }
  );
});

test('readJsonBody accepts valid JSON', async () => {
  const mockReq = createMockRequest('{"test": "value"}');

  const result = await httpUtils.readJsonBody(mockReq, 1000);

  assert.deepEqual(result, { test: 'value' });
});

test('readJsonBody handles empty body', async () => {
  const mockReq = createMockRequest('');

  const result = await httpUtils.readJsonBody(mockReq, 1000);

  assert.deepEqual(result, {});
});

// Helper: Create mock response object
function createMockResponse() {
  const res = {
    statusCode: 0,
    headers: {},
    body: null,
    writeHead(status, headers) {
      this.statusCode = status;
      this.headers = headers || {};
    },
    end(data) {
      if (data) {
        this.body = JSON.parse(data);
      }
    }
  };
  return res;
}

// Helper: Create mock request object
function createMockRequest(data) {
  const { EventEmitter } = require('node:events');
  const req = new EventEmitter();

  req.destroy = function() {
    this.emit('close');
  };

  // Simulate async data flow
  setImmediate(() => {
    if (data) {
      req.emit('data', Buffer.from(data));
    }
    req.emit('end');
  });

  return req;
}
