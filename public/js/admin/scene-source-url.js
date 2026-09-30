import { localOverlayOrigin } from '../shared/utils.js';

export function sceneSourceUrl({ id, token }) {
  const url = new URL('/scene', localOverlayOrigin());
  url.searchParams.set('id', id);
  url.hash = new URLSearchParams({ token }).toString();
  return url.href;
}
