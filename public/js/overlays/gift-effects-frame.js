// 特效 1 · 林间花信：原生透明视频与独立感谢文字共享 1920×1080 坐标。
'use strict';

export function createFrameController({ frameRoot }) {
  const video = frameRoot.querySelector('video');
  const caption = frameRoot.querySelector('.gift-info');
  const user = frameRoot.querySelector('#giftInfoUser');
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
    const enter = smooth((time - 0.36) / 0.24);
    const exit = smooth((time - 3.6) / 0.26);
    caption.style.opacity = String(enter * (1 - exit) * (1 - smooth((time - 3.6) / 0.4)));
    const offset = time < 0.6 ? 120 * (1 - time / 0.6) ** 3 : 120 * smooth((time - 3.6) / 0.4);
    caption.style.transform = `translateY(${offset}px)`;
  }

  function play(payload) {
    if (disposed) return Promise.resolve();
    stop?.();
    user.textContent = payload.userName;
    gift.textContent = payload.giftName;
    quantity.textContent = `×${payload.num}`;
    fitText(user, 28, 22);
    fitText(gift, 34, 26);
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
        user.textContent = gift.textContent = quantity.textContent = '';
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
