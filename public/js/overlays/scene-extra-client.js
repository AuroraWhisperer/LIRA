import { normalizeBilibiliAvatarUrl } from '../shared/bilibili-avatar.js';
import { isComponentPreview, createComponentPreviewClient } from './component-preview-client.js';

export function sceneAvatarSource(value) {
  if (/^\/img\/overlays\/danmaku-ranked\/(viewer|captain|admiral)\.webp$/.test(value)) return value;
  return normalizeBilibiliAvatarUrl(value);
}

export function mountSceneExtraClient(type, callbacks) {
  if (!isComponentPreview()) return null;
  document.documentElement.dataset.sceneComponent = type;
  const styles = document.createElement('link');
  styles.rel = 'stylesheet';
  styles.href = '/css/overlays/scene-components.css';
  document.head.append(styles);
  return createComponentPreviewClient(callbacks);
}
