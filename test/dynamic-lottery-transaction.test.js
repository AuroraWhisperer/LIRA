'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { DatabaseSync } = require('node:sqlite');
const { transaction } = require('../src/storage/dynamic-lottery-transaction');

test('lottery transaction commits results and rolls back partial writes on failure', () => {
  const db = new DatabaseSync(':memory:');
  try {
    db.exec('CREATE TABLE sample (value INTEGER)');
    assert.equal(transaction(db, () => { db.exec('INSERT INTO sample VALUES (1)'); return 42; }), 42);
    const original = new Error('operation');
    assert.throws(() => transaction(db, () => {
      db.exec('INSERT INTO sample VALUES (2)');
      throw original;
    }), (error) => error === original);
    assert.equal(db.prepare('SELECT count(*) AS count FROM sample').get().count, 1);
    assert.equal(Object.hasOwn(original, 'rollbackError'), false);
  } finally {
    db.close();
  }
});

test('lottery BEGIN failure leaves the operation and rollback untouched', () => {
  const original = new Error('begin');
  const calls = [];
  assert.throws(() => transaction({ exec(sql) { calls.push(sql); throw original; } }, () => {
    calls.push('operation');
  }), (error) => error === original);
  assert.deepEqual(calls, ['BEGIN IMMEDIATE']);
});

test('lottery operation and commit failures retain their identity, cause and rollback diagnostic', () => {
  for (const failureStage of ['operation', 'COMMIT']) {
    for (const rollbackFails of [false, true]) {
      const cause = new Error('upstream cause');
      const original = Object.assign(new Error('primary', { cause }), { code: 'LOTTERY_DRAW_CONFLICT' });
      const rollback = new Error('rollback');
      const calls = [];
      const db = { exec(sql) {
        calls.push(sql);
        if (sql === failureStage) throw original;
        if (sql === 'ROLLBACK' && rollbackFails) throw rollback;
      } };
      assert.throws(() => transaction(db, () => {
        calls.push('operation');
        if (failureStage === 'operation') throw original;
      }), (error) => error === original);
      assert.equal(original.code, 'LOTTERY_DRAW_CONFLICT');
      assert.equal(original.cause, cause);
      assert.equal(original.rollbackError, rollbackFails ? rollback : undefined);
      assert.deepEqual(calls, failureStage === 'operation'
        ? ['BEGIN IMMEDIATE', 'operation', 'ROLLBACK']
        : ['BEGIN IMMEDIATE', 'operation', 'COMMIT', 'ROLLBACK']);
    }
  }
});
