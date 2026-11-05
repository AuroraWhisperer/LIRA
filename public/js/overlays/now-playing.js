import { createNowPlayingRenderer } from '../shared/now-playing-renderer.js';
import { mountSceneExtraClient } from './scene-extra-client.js';
import { createOverlaySocket } from './socket-client.js';

const renderer = createNowPlayingRenderer(document.getElementById('nowPlayingSurface'));
const client = mountSceneExtraClient('now-playing', {
  onConfig: config => renderer.updateConfig(config),
  onData: data => renderer.updateState(data?.nowPlaying),
  onDispose: () => renderer.dispose(),
});

if (!client) {
  const socket = createOverlaySocket({
    onMessage(payload) {
      if (payload.type === 'snapshot') {
        renderer.updateConfig(payload.state?.nowPlayingConfig);
        renderer.updateState(payload.state?.nowPlaying);
      } else if (payload.type === 'now-playing') {
        renderer.updateState(payload.state);
      }
    },
    onClose: () => renderer.updateState(null),
  });
  socket.start();
  window.addEventListener('pagehide', () => { socket.dispose(); renderer.dispose(); }, { once: true });
}
