import { startCanvasDataPolling } from './canvas-data-poller.js';

export function startGamesCanvasData(controller, emit) {
  return startCanvasDataPolling(controller, { type: 'games', url: '/api/games/session',
    emit: session => emit({ previewData: { games: { preview: true, session } } }) });
}
