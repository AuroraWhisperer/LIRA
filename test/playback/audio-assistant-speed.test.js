'use strict';

const assert = require('node:assert/strict');
const path = require('node:path');
const test = require('node:test');
const { loadModuleExports } = require('../helpers/frontend-modules');

async function fixture() {
  const { bindAudioAssistantSpeed } = await loadModuleExports(path.resolve('public/js/playback/features/audio-assistant-speed.js'));
  const listeners = new Map();
  const audio = {
    playbackRate: 1, preservesPitch: false,
    addEventListener: (event, listener) => listeners.set(event, listener),
    removeEventListener: (event) => listeners.delete(event),
  };
  let trackKey = 'qq:first';
  let receive;
  let stops = 0;
  const dispose = bindAudioAssistantSpeed({
    audio, getTrackKey: () => trackKey,
    bridge: {
      onState(callback) { receive = callback; return () => { receive = null; }; },
      async invoke(request) { assert.deepEqual(JSON.parse(JSON.stringify(request)), { op: 'stop' }); stops++; return { ok: true }; },
    },
  });
  return {
    audio, listeners, dispose, get stops() { return stops; },
    receive: (state) => receive({ ready: true, running: true, internalSource: true, settings: { speedPercent: 150 }, ...state }),
    changeTrack(value) { trackKey = value; listeners.get('loadstart')?.(); },
    hasSubscription: () => receive !== null,
  };
}

test('assistant speed applies only to this instance during processing and restores on bypass, stop, or worker loss', async () => {
  const f = await fixture();
  for (const state of [{ internalSource: false }, { running: false, starting: true }, { running: false }]) {
    f.receive(state);
    assert.equal(f.audio.playbackRate, 1);
  }
  for (const speedPercent of [50, 100, 150, 200]) {
    f.receive({ settings: { speedPercent } });
    assert.equal(f.audio.playbackRate, speedPercent / 100);
    assert.equal(f.audio.preservesPitch, true);
  }
  for (const stopped of [{ original: true }, { running: false }, { ready: false }, { internalSource: false }]) {
    f.receive({});
    assert.equal(f.audio.playbackRate, 1.5);
    f.receive(stopped);
    assert.equal(f.audio.playbackRate, 1);
  }
  f.receive({ revision: 5 });
  f.receive({ revision: 4, settings: { speedPercent: 200 } });
  assert.equal(f.audio.playbackRate, 1.5);
  f.dispose();
  assert.equal(f.audio.playbackRate, 1);
  assert.equal(f.listeners.size, 0);
  assert.equal(f.hasSubscription(), false);
});

test('a new track restores speed immediately and cannot inherit stale running states before stop completes', async () => {
  const f = await fixture();
  f.receive({});
  f.changeTrack('qq:first');
  assert.equal(f.stops, 0, 'Reloading the same track is not a song change');
  f.changeTrack('netease:second');
  assert.equal(f.audio.playbackRate, 1);
  assert.equal(f.stops, 1);
  f.receive({});
  assert.equal(f.audio.playbackRate, 1, 'An in-flight state cannot speed up the new song');
  assert.equal(f.stops, 1);
  f.receive({ running: false });
  f.receive({});
  assert.equal(f.audio.playbackRate, 1.5, 'A new explicit processing session can use the saved speed');
  f.dispose();
});
