'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { createPlaybackOutput } = require('../../src/electron/playback-output');
const { createAudioAssistant } = require('../../src/electron/audio-assistant');

async function checkNativePlayback(root) {
  const dataDir = fs.mkdtempSync(path.join(root, 'tmp/playback-output-check-'));
  const executable = path.join(root, 'build/audio-assistant/LiraAudioAssistant.exe');
  const faults = [];
  const output = createPlaybackOutput({ executable, dataDir, onFault: fault => faults.push(fault) });
  const assistant = createAudioAssistant({ executable, dataDir,
    getPlaybackProcessId: () => output.getProcessId(), getProcessIds: () => [output.getProcessId()] });
  try {
    const listed = await output.invoke('list');
    assert.equal(listed.ok, true, JSON.stringify(listed));
    assert.equal(new Set(listed.data.map(device => device.deviceId)).size, listed.data.length);
    const checked = [];
    for (const device of listed.data.filter(item => item.backend !== 'asio')) {
      const opened = await output.invoke('open', { deviceId: device.deviceId });
      assert.equal(opened.ok, true, `${device.name}: ${JSON.stringify(opened)}`);
      assert.equal(opened.data.backend, device.backend);
      for (let frame = 0; frame < 80; frame++) {
        const result = await output.invoke('write', { stream: opened.data.stream, pcm: new ArrayBuffer(8192) });
        assert.equal(result.ok, true, `${device.name}: ${JSON.stringify(result)}`);
        await new Promise(resolve => setTimeout(resolve, 22));
      }
      if (device.backend === 'wasapi') {
        const state = await assistant.invoke('refresh');
        assert.equal(state.ok, true);
        assert.ok(state.state.apps.some(app => app.id === `pid:${output.getProcessId()}` && app.name.startsWith('LIRA')));
      }
      assert.equal((await output.invoke('stop')).ok, true);
      assert.equal((await output.invoke('write', { stream: opened.data.stream, pcm: new ArrayBuffer(8192) })).stale, true);
      checked.push(device.name);
    }
    assert.equal((await output.invoke('open', { deviceId: 'wasapi:missing-device' })).ok, false);
    assert.deepEqual(faults, []);
    console.log('Native playback output checks passed:', JSON.stringify(checked));
    if (listed.data.some(device => device.backend === 'asio')) console.log('ASIO drivers enumerated; hardware playback requires its connected device.');
  } finally {
    await assistant.dispose();
    await output.dispose();
  }
}

module.exports = { checkNativePlayback };
