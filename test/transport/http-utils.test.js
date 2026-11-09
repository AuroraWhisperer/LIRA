'use strict';

const assert = require('node:assert/strict');
const { EventEmitter } = require('node:events');
const test = require('node:test');
const httpUtils = require('../../src/server/http-utils');

test('sendStableError maps known failures and never exposes internal details', () => {
  const stackError = new Error('Critical failure');
  stackError.stack = 'Error: Critical failure\n    at Object.<anonymous> (/app/src/secret-module.js:10:15)';
  for (const [name, error, status, message] of [
    ['malformed JSON', Object.assign(new Error('Invalid JSON body.'), { code: 'INVALID_JSON_BODY' }), 400, 'Request body must be valid JSON.'],
    ['oversized body', Object.assign(new Error('Request body is too large.'), { code: 'REQUEST_BODY_TOO_LARGE' }), 413, 'Request body exceeds size limit.'],
    ['XLSX resource limit', Object.assign(new Error('Excel file is too large (expanded bytes).'), { code: 'XLSX_RESOURCE_LIMIT_EXCEEDED' }), 413, 'Request body exceeds size limit.'],
    ['upstream JSON error', new Error('Upstream returned invalid JSON'), 500, 'Internal server error.'],
    ['upstream size error', new Error('Upstream image too large'), 500, 'Internal server error.'],
    [
      'unexpected exception',
      new Error('Unexpected database connection failed at /internal/path/db.js:42'),
      500,
      'Internal server error.',
    ],
    ['null error', null, 500, 'Internal server error.'],
    ['error with stack trace', stackError, 500, 'Internal server error.'],
  ]) {
    const response = createMockResponse();
    httpUtils.sendStableError(response, error);
    assert.equal(response.statusCode, status, name);
    assert.deepEqual(response.body, { ok: false, error: message }, name);
  }
  const response = createMockResponse();
  httpUtils.sendStableError(response, Object.assign(new Error('internal lyric parser detail'), {
    code: 'LYRIC_EXPANSION_LIMIT', statusCode: 400,
  }));
  assert.equal(response.statusCode, 400);
  assert.equal(response.body.code, 'LYRIC_EXPANSION_LIMIT');
  assert.equal(response.body.error.includes('internal lyric parser detail'), false);
  const settingsResponse = createMockResponse();
  httpUtils.sendStableError(settingsResponse, Object.assign(new Error('private account identity'), {
    code: 'CLOUD_SETTINGS_NOT_READY',
  }));
  assert.equal(settingsResponse.statusCode, 503);
  assert.equal(settingsResponse.body.code, 'CLOUD_SETTINGS_NOT_READY');
  assert.equal(settingsResponse.body.error.includes('private account identity'), false);
});

test('readJsonBody enforces the byte limit and JSON syntax and treats an empty body as an object', async () => {
  await assert.rejects(httpUtils.readJsonBody(createMockRequest('{"data": "large payload"}'), 10), {
    code: 'REQUEST_BODY_TOO_LARGE',
  });
  await assert.rejects(httpUtils.readJsonBody(createMockRequest('not valid json {]'), 1000), {
    code: 'INVALID_JSON_BODY',
  });
  assert.deepEqual(await httpUtils.readJsonBody(createMockRequest('{"test": "value"}'), 1000), { test: 'value' });
  assert.deepEqual(await httpUtils.readJsonBody(createMockRequest(''), 1000), {});
});

test('malformed room escapes and unknown superchat actions are typed input errors', () => {
  const { normalizeRoomInput } = require('../../src/bilibili/room-input');
  const { handleSuperChatAction } = require('../../src/bilibili/superchat-service');
  assert.equal(normalizeRoomInput('https%3A%2F%2Flive.bilibili.com%2F123'), '123');
  for (const [operation, code] of [
    [() => normalizeRoomInput('https://live.bilibili.com/123%'), 'INVALID_ROOM_INPUT'],
    [() => handleSuperChatAction({}, 'unknown', 1), 'INVALID_SUPERCHAT_ACTION'],
  ]) {
    assert.throws(operation, (error) => {
      assert.equal(error.code, code);
      const response = createMockResponse();
      httpUtils.sendStableError(response, error);
      assert.equal(response.statusCode, 400);
      return true;
    });
  }
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
