import { startCanvasDataPolling } from './canvas-data-poller.js';

export function startOpeningCanvasData(controller, emit) {
  return startCanvasDataPolling(controller, { type: 'opening', url: '/api/opening/config',
    emit: opening => emit({ previewData: { opening } }) });
}
