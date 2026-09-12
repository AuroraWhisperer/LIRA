'use strict';

const assert = require('node:assert/strict');
const { X509Certificate } = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');

function der(tag, ...parts) {
  const content = Buffer.concat(parts);
  const length = content.length < 128
    ? Buffer.from([content.length])
    : Buffer.from([0x82, content.length >> 8, content.length & 255]);
  return Buffer.concat([Buffer.from([tag]), length, content]);
}

// Structurally decodable certificate with a dummy public key and dummy signature.
// No key pair, private key, real certificate, or signing operation is involved.
function syntheticCertificate(attributes, serial = 1) {
  const sequence = (...parts) => der(0x30, ...parts);
  const oid = (hex) => der(0x06, Buffer.from(hex, 'hex'));
  const name = (values) => sequence(...values.map(([field, value]) => der(0x31,
    sequence(oid(`5504${field}`), der(0x0c, Buffer.from(value, 'utf8'))),
  )));
  const algorithm = sequence(oid('2a864886f70d01010b'), der(0x05));
  const publicKey = sequence(
    sequence(oid('2a864886f70d010101'), der(0x05)),
    der(0x03, Buffer.from([0]), sequence(
      der(0x02, Buffer.alloc(128, 0x7f)), der(0x02, Buffer.from([1, 0, 1])),
    )),
  );
  return sequence(
    sequence(
      der(0x02, Buffer.from([serial])), algorithm,
      name([['03', 'Synthetic Issuer']]),
      sequence(der(0x17, Buffer.from('250101000000Z')), der(0x17, Buffer.from('300101000000Z'))),
      name(attributes), publicKey,
    ),
    algorithm, der(0x03, Buffer.from([0, 1, 2, 3])),
  );
}

function verifyFixture(expectedPublisher, options = {}) {
  const certificate = syntheticCertificate(options.attributes || [['03', 'Synthetic Publisher']], options.serial);
  const signature = {
    Status: 'Valid', StatusMessage: 'synthetic validity result only',
    SignerCertificateSubject: new X509Certificate(certificate).subject,
    SignerCertificateRawData: certificate.toString('base64'),
    SignerCertificateIssuer: 'CN=Synthetic Issuer',
    SignerCertificateNotAfter: '2030-01-01T00:00:00.000Z',
    TimeStamperCertificateSubject: 'CN=Synthetic Timestamp',
    ...options.signature,
  };
  const logs = [];
  const commands = [];
  let exitCode;
  const filename = path.resolve(__dirname, '../scripts/verify-windows-release.js');
  // A process exit ends this script immediately, even inside its try block.
  const source = fs.readFileSync(filename, 'utf8').replaceAll('process.exit(', 'return process.exit(');
  vm.runInNewContext(`(function () {\n${source}\n})()`, {
    Buffer,
    process: { argv: ['node', filename, "synthetic setup's.exe", expectedPublisher], exit(code) { exitCode = code; } },
    console: Object.fromEntries(['log', 'warn', 'error'].map((name) => [name, (...args) => logs.push(args.join(' '))])),
    require(name) {
      if (name === 'node:fs') return { existsSync: () => true };
      if (name === 'node:child_process') return { execFileSync(command, args, executionOptions) {
        commands.push({ command, args, options: executionOptions });
        return JSON.stringify(signature);
      } };
      return require(name);
    },
  }, { filename });
  return { exitCode, logs: logs.join('\n'), commands };
}

test('publisher verification rejects empty or whitespace expectations before invoking PowerShell', () => {
  for (const expected of ['', ' ', '\t\r\n']) {
    const f = verifyFixture(expected);
    assert.equal(f.exitCode, 1);
    assert.equal(f.commands.length, 0);
    assert.match(f.logs, /publisher.*(empty|blank|required)/i);
  }
});

test('publisher verification rejects a different CN that merely contains the expected name', () => {
  const f = verifyFixture('Synthetic Publisher', { attributes: [['03', 'Other Synthetic Publisher Company']] });
  assert.equal(f.exitCode, 1);
  assert.match(f.logs, /Publisher mismatch/);
});

test('publisher verification never matches organization, organizational unit, issuer or timestamp names', () => {
  for (const attributes of [
    [['03', 'Different Publisher'], ['0a', 'Synthetic Publisher']],
    [['03', 'Different Publisher'], ['0b', 'Synthetic Publisher']],
    [['0a', 'Synthetic Publisher']],
    [['03', 'Different Publisher']],
  ]) {
    const f = verifyFixture('Synthetic Publisher', { attributes, signature: {
      SignerCertificateIssuer: 'CN=Synthetic Publisher', TimeStamperCertificateSubject: 'CN=Synthetic Publisher',
    } });
    assert.equal(f.exitCode, 1);
  }
});

test('publisher verification accepts the complete CN and preserves the execution boundary', () => {
  const f = verifyFixture('Synthetic Publisher');
  assert.equal(f.exitCode, 0);
  assert.match(f.logs, /Signature verification passed/);
  assert.equal(f.commands[0].options.shell, false);
  assert.match(f.commands[0].args.at(-1), /setup''s\.exe/);
  assert.match(f.commands[0].args.at(-1), /SignerCertificate\.RawData/);
});

test('publisher verification handles punctuation, escaped display names and Unicode from certificate data', () => {
  for (const commonName of ['Synthetic, Publisher', 'Synthetic "Publisher"', 'Synthetic + Publisher\\Branch', '合成发布者研发团队']) {
    assert.equal(verifyFixture(commonName, { attributes: [['03', commonName], ['0a', 'Synthetic Org']] }).exitCode, 0);
  }
});

test('publisher verification rejects ambiguous multiple CNs and missing or malformed certificate data', () => {
  assert.equal(verifyFixture('Synthetic Publisher', {
    attributes: [['03', 'Synthetic Publisher'], ['03', 'Other Publisher']],
  }).exitCode, 1);
  for (const raw of [null, '', 'not-a-certificate']) {
    assert.equal(verifyFixture('Synthetic Publisher', { signature: { SignerCertificateRawData: raw } }).exitCode, 1);
  }
});

test('publisher verification requires a valid signature even when CN matches', () => {
  for (const status of ['NotSigned', 'HashMismatch', 'NotTrusted', 'UnknownError']) {
    const f = verifyFixture('Synthetic Publisher', { signature: { Status: status } });
    assert.equal(f.exitCode, 1);
    assert.match(f.logs, /not Valid/);
  }
  assert.equal(verifyFixture('Synthetic Publisher', { signature: {
    Status: 'NotSigned', SignerCertificateSubject: null, SignerCertificateRawData: null,
  } }).exitCode, 1);
});

test('publisher verification retains case handling, certificate rotation and Authenticode validity policy', () => {
  for (const serial of [1, 2]) {
    const f = verifyFixture('synthetic publisher', { serial, signature: { SignerCertificateNotAfter: '2000-01-01T00:00:00.000Z' } });
    assert.equal(f.exitCode, 0);
    assert.match(f.logs, /Certificate expires/);
  }
});
