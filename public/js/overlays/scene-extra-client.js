import { isComponentPreview, createComponentPreviewClient } from './component-preview-client.js';

export function sceneAvatarSource(value) {
  if (/^\/img\/overlays\/danmaku-ranked\/(viewer|captain|admiral)\.webp$/.test(value)) return value;
  try {
    const url = new URL(String(value || ''));
    if (url.protocol !== 'https:' || !url.hostname.endsWith('.hdslb.com') || url.username || url.password) return '';
    return url.toString();
  } catch {
    return '';
  }
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
