'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const fs = require('node:fs');
const vm = require('node:vm');
const { loadModuleExports } = require('../helpers/frontend-modules');

test('native transport reopens after pause/seek, ignores old packets and disconnects without duplicate output', async () => {
  const { createNativeOutput } = await loadModuleExports(path.resolve('public/js/playback/features/native-output.js'), { setTimeout, clearTimeout });
  const calls = [];
  const audio = new EventTarget();
  Object.assign(audio, { paused: false, ended: false, pause() { this.paused = true; this.dispatchEvent(new Event('pause')); } });
  let node;
  let fault;
  let sequence = 0;
  class Context {
    constructor(options) { calls.push(['context', options]); }
    audioWorklet = { addModule: async () => {} };
    destination = {};
    createMediaElementSource() { return { connect() {}, disconnect() { calls.push(['disconnect']); } }; }
    resume = async () => {};
    setSinkId = async id => { calls.push(['sink', id]); };
    close = async () => { calls.push(['close']); };
  }
  class Worklet {
    constructor() { node = this; }
    port = { onmessage: null, postMessage: value => calls.push(['route', value]), close() {} };
    connect() {}
    disconnect() {}
  }
  const output = createNativeOutput(audio, { AudioContextClass: Context, WorkletNodeClass: Worklet,
    onFault: error => calls.push(['fault', error]), bridge: {
      onFault(callback) { fault = callback; return () => { fault = null; }; },
      async invoke(request) {
        calls.push([request.op, request.value]);
        return { ok: true, data: request.op === 'open' ? { stream: ++sequence } : [] };
      },
    },
  });
  await output.select('directsound:port');
  assert.equal(calls.find(call => call[0] === 'context')[1].sampleRate, 48000);
  assert.ok(calls.findIndex(call => call[0] === 'sink' && call[1] === '') <
    calls.findIndex(call => call[0] === 'open'));
  node.port.onmessage({ data: { stream: 1, pcm: new ArrayBuffer(8192) } });
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(calls.filter(call => call[0] === 'write').length, 1);
  audio.pause();
  node.port.onmessage({ data: { stream: 1, pcm: new ArrayBuffer(8192) } });
  assert.equal(calls.filter(call => call[0] === 'write').length, 1);
  await output.prepare();
  assert.equal(sequence, 2);
  audio.dispatchEvent(new Event('seeking'));
  assert.equal(output.currentId, '');
  await output.prepare();
  assert.equal(sequence, 3);
  fault({ stream: 1, error: 'stale' });
  assert.equal(calls.filter(call => call[0] === 'fault').length, 0);
  fault({ stream: 3, error: 'device lost' });
  assert.equal(calls.at(-1)[0], 'fault');
  await output.browser('browser-port');
  assert.ok(calls.some(call => call[0] === 'sink' && call[1] === 'browser-port'));
  await output.select('waveout:port');
  assert.equal(output.currentId, '', 'validating a saved device must release native output while the song is paused');
  await output.prepare();
  assert.equal(output.currentId, 'waveout:port');
  output.dispose();
  assert.equal(fault, null);
  assert.equal(calls.at(-1)[0], 'close');
});

test('audio worklet sends interleaved stereo while native output is active and never also renders it locally', () => {
  let Processor;
  const messages = [];
  vm.runInNewContext(fs.readFileSync(path.resolve('public/js/playback/features/output-worklet.js'), 'utf8'), {
    AudioWorkletProcessor: class { port = { postMessage: data => messages.push(data) }; },
    registerProcessor: (_name, type) => { Processor = type; },
  });
  const processor = new Processor();
  const mono = new Float32Array(1024).fill(.25);
  const rendered = [new Float32Array(1024), new Float32Array(1024)];
  processor.port.onmessage({ data: { native: true, stream: 12 } });
  processor.process([[mono]], [rendered]);
  assert.equal(messages.length, 1);
  assert.equal(messages[0].stream, 12);
  assert.ok(new Float32Array(messages[0].pcm).every(sample => sample === .25));
  assert.ok(rendered.every(channel => channel.every(sample => sample === 0)));
  processor.port.onmessage({ data: { native: false, stream: 0 } });
  processor.process([[mono]], [rendered]);
  assert.ok(rendered.every(channel => channel.every(sample => sample === .25)));
  assert.equal(messages.length, 1);
});
