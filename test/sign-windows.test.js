'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const { inspect } = require('node:util');
const vm = require('node:vm');

function signFixture(options = {}) {
  const password = 'synthetic PFX $ecret! "quoted"';
  const username = 'syntheticProxyUser';
  const proxyPassword = 'syntheticProxy@Password';
  const proxy = `http://${username}:${encodeURIComponent(proxyPassword)}@proxy.invalid:7890`;
  const logs = [];
  const calls = [];
  const output = `Synthetic certificate failure: ${password}; proxy=${proxy}; password=${proxyPassword}`;
  const error = Object.assign(new Error(`Command failed: signtool sign /p ${password}\n${output}`), {
    status: 17, code: 'SYNTHETIC_SIGN_FAILURE', signal: null,
    stdout: Buffer.from(output), stderr: Buffer.from(output),
    output: [null, Buffer.from(output), Buffer.from(output)],
    spawnargs: ['sign', '/p', password],
  });
  error.stack += `\nTool details: ${proxy}`;
  function execFileSync(command, args, executionOptions) {
    calls.push({ command, args, options: executionOptions });
    if (command === 'where') return 'synthetic-signtool.exe';
    if (executionOptions.stdio === 'inherit' || !executionOptions.stdio) logs.push(output);
    if (options.succeed) return Buffer.from(output);
    throw error;
  }
  const filename = path.resolve(__dirname, '../scripts/sign-windows.js');
  const module = { exports: {} };
  vm.runInNewContext(fs.readFileSync(filename, 'utf8'), {
    module, exports: module.exports, Buffer, __dirname: path.dirname(filename),
    process: { env: { WINDOWS_CERT_FILE: 'synthetic.pfx', WINDOWS_CERT_PASSWORD: password, HTTPS_PROXY: proxy } },
    console: Object.fromEntries(['log', 'warn', 'error'].map((name) => [name, (...args) => logs.push(args.join(' '))])),
    require(name) {
      if (name === './release-output') return require('../scripts/release-output');
      if (name === 'node:child_process') return {
        execFileSync,
        spawnSync(command, args, executionOptions) {
          try {
            return { status: 0, stdout: execFileSync(command, args, executionOptions), stderr: Buffer.from(`Synthetic warning ${output}`) };
          } catch (error) {
            return { error: options.nonzeroExit ? undefined : error, status: error.status, stdout: error.stdout, stderr: error.stderr, output: error.output };
          }
        },
      };
      return require(name);
    },
  }, { filename });
  return { sign: module.exports.default, calls, logs, password,
    secrets: [password, username, proxyPassword, encodeURIComponent(proxyPassword)] };
}

test('signing failure redacts command errors, final stack and child output without changing arguments', async () => {
  const f = signFixture();
  const error = await f.sign({ path: 'synthetic-setup.exe' }).catch((failure) => failure);
  const rendered = [f.logs.join('\n'), error?.message, error?.stack, inspect(error, { depth: 8 }), JSON.stringify(error)].join('\n');
  for (const secret of f.secrets) assert.equal(rendered.includes(secret), false, 'synthetic secret leaked');
  assert.equal(error.status, 17);
  assert.equal(error.code, 'SYNTHETIC_SIGN_FAILURE');
  assert.match(error.message, /Synthetic certificate failure/);
  const signs = f.calls.filter((call) => call.args[0] === 'sign');
  assert.equal(signs.length, 3);
  for (const call of signs) {
    assert.equal(call.args[call.args.indexOf('/p') + 1], f.password);
    assert.equal(call.options.shell, false);
    assert.notEqual(call.options.stdio, 'inherit');
  }
});

test('successful signing also sanitizes tool output and retains useful diagnostics', async () => {
  const f = signFixture({ succeed: true });
  await f.sign({ path: 'synthetic-setup.exe' });
  for (const secret of f.secrets) assert.equal(f.logs.join('\n').includes(secret), false, 'synthetic secret leaked');
  assert.match(f.logs.join('\n'), /Signed successfully with timestamp/);
  assert.match(f.logs.join('\n'), /Synthetic warning/);
  assert.match(f.logs.join('\n'), /proxy.invalid:7890/);
  assert.equal(f.calls.filter((call) => call.args[0] === 'sign').length, 1);
});

test('signing handles nonzero exit results without a spawn error object', async () => {
  const f = signFixture({ nonzeroExit: true });
  const error = await f.sign({ path: 'synthetic-setup.exe' }).catch((failure) => failure);
  assert.equal(error.status, 17);
  assert.match(error.message, /Synthetic certificate failure/);
  for (const secret of f.secrets) assert.equal(inspect(error, { depth: 8 }).includes(secret), false);
});
