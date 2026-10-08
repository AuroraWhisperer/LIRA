// 特效 1 · 林间花信：原生透明视频与独立感谢文字共享 1920×1080 坐标。
'use strict';

import { giftAvatarSource } from '../shared/gift-banner.js';
import { WOODLAND_GIFT_VIDEO } from '../shared/component-resource-style.js';

const AVATAR_PLACEHOLDER = '/img/gift-avatar-placeholder.svg';
export const FRAME_DURATION_MS = 8000;

export function createFrameController({ frameRoot, source = WOODLAND_GIFT_VIDEO }) {
  const video = frameRoot.querySelector('video');
  video.setAttribute('src', source);
  const caption = frameRoot.querySelector('.gift-info');
  const avatar = frameRoot.querySelector('#giftInfoAvatar');
  const gift = frameRoot.querySelector('#giftInfoName');
  const quantity = frameRoot.querySelector('#giftInfoNum');
  let stop = null;
  let disposed = false;
  let needsReload = false;

  function resize() {
    frameRoot.style.setProperty('--frame-scale', Math.min(window.innerWidth / 1920, window.innerHeight / 1080));
  }

  function fitText(node, size, minimum) {
    const row = node.parentElement;
    row.style.fontSize = `${size}px`;
    while (size > minimum && node.scrollWidth > node.clientWidth) {
      size -= 1;
      row.style.fontSize = `${size}px`;
    }
  }

  function updateCaption(time) {
    const enter = smooth((time - 0.65) / 0.45);
    const exitStart = FRAME_DURATION_MS / 1000 - 0.8;
    const exit = smooth((time - exitStart) / 0.5);
    caption.style.opacity = String(enter * (1 - exit));
    const offset = time < 1.1 ? 120 * (1 - time / 1.1) ** 3 : 120 * smooth((time - exitStart) / 0.8);
    caption.style.transform = `translateY(${offset}px)`;
  }

  function play(payload) {
    if (disposed) return Promise.resolve();
    stop?.();
    avatar.alt = `${payload.userName || '送礼人'}的头像`;
    avatar.onerror = () => {
      avatar.onerror = null;
      avatar.src = AVATAR_PLACEHOLDER;
    };
    avatar.src = payload.avatarUrl ? giftAvatarSource(payload.avatarUrl)
      : payload.preview ? '/img/overlays/danmaku-ranked/viewer.webp' : AVATAR_PLACEHOLDER;
    gift.textContent = payload.giftName;
    quantity.textContent = `×${payload.num}`;
    fitText(gift, 38, 26);
    updateCaption(0);

    return new Promise((resolve, reject) => {
      let settled = false;
      let started = false;
      let timer;
      let frameId;
      let lastTime = -1;

      function finish(error) {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        video.cancelVideoFrameCallback?.(frameId);
        video.removeEventListener('playing', onPlaying);
        video.removeEventListener('timeupdate', onProgress);
        video.removeEventListener('ended', onEnded);
        video.removeEventListener('error', onError);
        video.pause();
        frameRoot.classList.remove('is-playing');
        updateCaption(0);
        avatar.onerror = null;
        avatar.removeAttribute('src');
        avatar.alt = '';
        gift.textContent = quantity.textContent = '';
        stop = null;
        if (error) {
          needsReload = true;
          reject(error);
        } else resolve();
      }
      function armTimeout(milliseconds) {
        clearTimeout(timer);
        timer = setTimeout(() => finish(new Error('特效 1 视频加载或播放超时。')), milliseconds);
      }
      function onProgress() {
        updateCaption(video.currentTime);
        if (started && video.currentTime !== lastTime) {
          lastTime = video.currentTime;
          armTimeout(5000);
        }
      }
      function onFrame(_now, metadata) {
        if (settled) return;
        updateCaption(metadata.mediaTime);
        frameId = video.requestVideoFrameCallback(onFrame);
      }
      function onPlaying() {
        started = true;
        frameRoot.classList.add('is-playing');
        onProgress();
      }
      function onEnded() { finish(); }
      function onError() { finish(new Error('特效 1 视频素材加载失败。')); }

      stop = () => finish();
      video.addEventListener('playing', onPlaying);
      video.addEventListener('timeupdate', onProgress);
      video.addEventListener('ended', onEnded);
      video.addEventListener('error', onError);
      armTimeout(10000);
      try {
        video.pause();
        if (needsReload || video.error) video.load();
        needsReload = false;
        video.currentTime = 0;
        if (video.requestVideoFrameCallback) frameId = video.requestVideoFrameCallback(onFrame);
        video.play().catch(finish);
      } catch (error) {
        finish(error);
      }
    });
  }

  window.addEventListener('resize', resize);
  resize();
  return {
    play,
    dispose() {
      disposed = true;
      stop?.();
      window.removeEventListener('resize', resize);
      video.removeAttribute('src');
      video.load();
    },
  };
}

function smooth(value) {
  const progress = Math.max(0, Math.min(1, value));
  return progress * progress * (3 - 2 * progress);
}
