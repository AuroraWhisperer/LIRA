import { localOverlayOrigin } from '../shared/utils.js';

export function sceneSourceUrl({ id, token, item }) {
  const url = new URL('/scene', localOverlayOrigin());
  url.searchParams.set('id', id);
  if (item) url.searchParams.set('item', item);
  url.hash = new URLSearchParams({ token }).toString();
  return url.href;
}
