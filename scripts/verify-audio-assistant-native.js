'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { createAudioAssistant } = require('../src/electron/audio-assistant');

const root = path.resolve(__dirname, '..');
const output = path.join(root, 'tmp/audio-assistant-native-checks');
const scratch = path.join(root, 'tmp/audio-assistant-native-build');
const published = spawnSync('dotnet', ['publish', path.join(root, 'test/desktop/audio-assistant-native/NativeChecks.csproj'),
  '-c', 'Release', '-r', 'win-x64', '--self-contained', 'true', '-o', output,
  `-p:BaseIntermediateOutputPath=${path.join(scratch, 'obj')}${path.sep}`,
  `-p:BaseOutputPath=${path.join(scratch, 'bin')}${path.sep}`], { stdio: 'inherit', windowsHide: true });
if (published.error) throw published.error;
if (published.status !== 0) process.exit(published.status || 1);
const checked = spawnSync(path.join(output, 'NativeChecks.exe'), [], { stdio: 'inherit', windowsHide: true });
if (checked.error) throw checked.error;
if (checked.status !== 0) process.exit(checked.status || 1);

async function checkBridge() {
  const dataDir = fs.mkdtempSync(path.join(root, 'tmp/audio-assistant-protocol-'));
  const options = { executable: path.join(root, 'build/audio-assistant/LiraAudioAssistant.exe'), dataDir };
  let assistant = createAudioAssistant(options);
  try {
    assert.equal((await assistant.invoke('get')).ok, true, 'Hidden worker must initialize its UTF-8 pipes');
    const configured = await assistant.invoke('configure', { strength: -37, semitones: -4, speedPercent: 150, volume: 0, source: 'file' });
    assert.equal(configured.ok, true);
    const rejected = await assistant.invoke('start');
    assert.equal(rejected.ok, false);
    assert.match(rejected.error, /请先选择一首本地歌曲/);
    assert.equal(rejected.state.running, false);
    const recovered = await assistant.invoke('configure', { volume: 200 });
    assert.equal(recovered.ok, true);
    assert.equal(recovered.state.settings.volume, 200);
    assert.equal(recovered.state.status, '设置已保存。');
    await assistant.dispose();
    assistant = createAudioAssistant(options);
    const restored = await assistant.invoke('get');
    assert.equal(restored.ok, true);
    assert.equal(restored.state.settings.strength, -37);
    assert.equal(restored.state.settings.semitones, -4);
    assert.equal(restored.state.settings.speedPercent, 150);
    assert.equal(restored.state.settings.volume, 200, 'Amplified volume must survive settings reload');
    assert.equal(restored.state.running, false, 'Restoring settings must not start a song');
    assert.equal((await assistant.invoke('stop')).ok, true);
    await assistant.dispose();
    fs.writeFileSync(path.join(dataDir, 'audio-assistant/settings.json'), '{"outputId":null,"cableId":null,"volume":-5}');
    assistant = createAudioAssistant(options);
    const normalized = await assistant.invoke('get');
    assert.equal(normalized.ok, true);
    assert.equal(normalized.state.settings.outputId, '');
    assert.equal(normalized.state.settings.volume, 0);
    console.log('Native bridge, UTF-8, validation, persistence and EOF shutdown checks passed.');
  } finally { await assistant.dispose(); }
}

checkBridge().catch((error) => { console.error(error); process.exitCode = 1; });
