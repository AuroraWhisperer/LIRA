'use strict';

export function bindAudioAssistantSpeed({ audio, getTrackKey, bridge = window.audioAssistant }) {
  if (!bridge) return () => {};
  let owned = false;
  let trackKey = '';
  let waitingForStop = false;
  let revision = 0;

  function restore() {
    if (owned) audio.playbackRate = 1;
    owned = false;
  }

  function checkTrack() {
    if (!owned || getTrackKey() === trackKey) return;
    waitingForStop = true;
    restore();
    void bridge.invoke({ op: 'stop' }).catch((error) => console.warn('电音助手停止失败：', error.message));
  }

  const unsubscribe = bridge.onState((state) => {
    if (state.revision && state.revision < revision) return;
    revision = state.revision || revision;
    if (!state.running && !state.starting) waitingForStop = false;
    if (!state.ready || !state.running || !state.internalSource || waitingForStop) {
      restore();
      return;
    }
    checkTrack();
    if (waitingForStop || !getTrackKey()) return;
    trackKey = getTrackKey();
    owned = true;
    audio.preservesPitch = true;
    const speed = state.settings?.speedPercent;
    const rate = state.original || !Number.isInteger(speed) ? 1 : Math.max(50, Math.min(200, speed)) / 100;
    if (audio.playbackRate !== rate) audio.playbackRate = rate;
  });

  audio.addEventListener('loadstart', checkTrack);
  return () => {
    unsubscribe();
    audio.removeEventListener('loadstart', checkTrack);
    restore();
  };
}
