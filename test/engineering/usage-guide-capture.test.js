'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const http = require('node:http');
const { createRequire } = require('node:module');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');

function loadScript(name, overrides, args = []) {
  const filename = path.resolve(__dirname, '../../scripts/usage-guide-shots', name);
  const projectRequire = createRequire(filename);
  const module = { exports: {} };
  const logs = [];
  vm.runInNewContext(`${fs.readFileSync(filename, 'utf8')}\nmodule.exports.main = main;`, {
    module, __dirname: path.dirname(filename), Buffer, URL,
    process: { argv: ['node', filename, ...args], exit: code => assert.fail(`Unexpected exit ${code}`) },
    console: { log: (...values) => logs.push(values.join(' ')), error: () => {} },
    require: name => Object.hasOwn(overrides, name) ? overrides[name] : projectRequire(name),
  }, { filename });
  return { main: module.exports.main, logs };
}

test('explicit screenshot IDs respect deferred shots and group filters before starting resources', async () => {
  const manifest = require('../../scripts/usage-guide-shots/manifest');
  const deferred = manifest.SHOTS.find(shot => shot.skip);
  const available = manifest.SHOTS.find(shot => !shot.skip);
  assert.ok(deferred && available);
  const selected = new Error('a runnable shot reached resource setup');
  const overrides = {
    playwright: {},
    '../../src/server': { createServerRuntime() { assert.fail('No runtime is needed'); } },
    './seed-data.cjs': {},
    './lib/page-tools.cjs': {},
    'node:http': { request() { throw selected; } },
  };
  for (const args of [[`--only=${deferred.id}`], [`--only=${available.id}`, '--group=missing']]) {
    const script = loadScript('capture.cjs', overrides, args);
    await script.main();
    assert.ok(script.logs.includes('没有匹配的镜头。'));
  }
  const script = loadScript('capture.cjs', overrides, [`--only=${available.id}`]);
  await assert.rejects(script.main(), error => error === selected);
});

for (const failureAt of ['launch', 'close']) {
  test(`web screenshot fixture closes its listener after browser ${failureAt} failure`, async t => {
    const server = http.createServer();
    t.after(() => { server.closeAllConnections(); server.close(); });
    const failure = new Error(`synthetic ${failureAt} failure`);
    const script = loadScript('web-supplement.cjs', {
      './web-fixture.cjs': { async start() {
        await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
        return { server, baseUrl: `http://127.0.0.1:${server.address().port}` };
      } },
      playwright: { chromium: { async launch() {
        if (failureAt === 'launch') throw failure;
        return { newPage: async () => ({}), close: async () => { throw failure; } };
      } } },
    }, ['--only=no-such-shot']);
    await assert.rejects(script.main(), error => error === failure);
    assert.equal(server.listening, false);
  });
}
