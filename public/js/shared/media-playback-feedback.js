import { toast } from './toast.js';

export function isInterruptedMediaPlayError(error) {
  return error?.name === 'AbortError'
    || /play\(\) request was interrupted/i.test(String(error?.message || error || ''));
}

export function notifyMediaPlayFailure(error, audio) {
  // Media element errors already go through the player's error handler.
  if (audio?.error || isInterruptedMediaPlayError(error)) return;
  toast('暂时无法播放，请再点一次播放。', { key: 'playback-resume-error', type: 'error' });
}
