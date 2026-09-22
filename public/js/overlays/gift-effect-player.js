// 官方全屏特效：有界串行播放，按素材坐标合成 RGB 与 alpha。
'use strict';

const MAX_PENDING = 3;
const MAX_WAIT_MS = 12000;

export function createGiftEffectPlayer({ stage, play, now = Date.now, onError = () => {} }) {
  const startPlayback = play || ((payload) => playVideo(stage, payload.effect));
  const pending = [];
  const seen = new Set();
  let enabled = false;
  let disposed = false;
  let active = null;

  function next() {
    if (active || disposed) return;
    while (pending.length) {
      const item = pending.shift();
      if (now() - item.queuedAt > MAX_WAIT_MS) continue;
      try {
        const playback = startPlayback(item.payload);
        active = { playback, payload: item.payload };
        Promise.resolve(playback.done)
          .catch(onError)
          .finally(() => {
            active = null;
            next();
          });
        return;
      } catch (error) {
        onError(error);
      }
    }
  }

  return {
    enqueue(payload) {
      if (disposed || payload?.type !== 'gift:effect' || !validEffect(payload.effect)) return false;
      if (payload.preview !== true) {
        if (!enabled || payload.source !== 'danmaku' || !payload.eventId || seen.has(payload.eventId)) return false;
        seen.add(payload.eventId);
        if (seen.size > 100) seen.delete(seen.values().next().value);
      }
      if (pending.length >= MAX_PENDING) return false;
      pending.push({ payload, queuedAt: now() });
      next();
      return true;
    },
    setEnabled(value) {
      enabled = value === true;
      if (enabled) return;
      for (let i = pending.length - 1; i >= 0; i--) {
        if (pending[i].payload.preview !== true) pending.splice(i, 1);
      }
      if (active && active.payload.preview !== true) active.playback.stop();
    },
    dispose() {
      disposed = true;
      pending.length = 0;
      active?.playback.stop();
      seen.clear();
    },
  };
}

function validEffect(effect) {
  try {
    const url = new URL(effect?.mp4Url);
    if (url.protocol !== 'https:' || url.username || url.password || url.port || !/\.mp4$/iu.test(url.pathname))
      return false;
    if (
      !['hdslb.com', 'bilibili.com', 'bilivideo.com'].some(
        (host) => url.hostname === host || url.hostname.endsWith(`.${host}`),
      )
    )
      return false;
    const layout = effect.layout;
    const { videoWidth: width, videoHeight: height } = layout;
    if (![width, height].every((value) => Number.isInteger(value) && value > 0 && value <= 8192)) return false;
    return [layout.rgbFrame, layout.alphaFrame].every((frame) => {
      if (!Array.isArray(frame) || frame.length !== 4 || !frame.every(Number.isInteger)) return false;
      const [x, y, w, h] = frame;
      return x >= 0 && y >= 0 && w > 0 && h > 0 && x + w <= width && y + h <= height;
    });
  } catch {
    return false;
  }
}

function playVideo(stage, effect) {
  const video = document.createElement('video');
  const canvas = document.createElement('canvas');
  canvas.className = 'gift-official-effect';
  const [, , width, height] = effect.layout.rgbFrame;
  canvas.width = width;
  canvas.height = height;
  let renderer = null;
  let frameId = null;
  let settled = false;
  let finish;
  const done = new Promise((resolve, reject) => {
    finish = (error) => {
      if (settled) return;
      settled = true;
      clearTimeout(watchdog);
      if (frameId !== null) {
        if (video.cancelVideoFrameCallback) video.cancelVideoFrameCallback(frameId);
        else cancelAnimationFrame(frameId);
      }
      video.removeEventListener('loadeddata', loaded);
      video.removeEventListener('ended', ended);
      video.removeEventListener('error', failed);
      video.pause();
      video.removeAttribute('src');
      video.load();
      renderer?.dispose();
      canvas.remove();
      if (error) reject(error);
      else resolve();
    };
  });
  const watchdog = setTimeout(() => finish(new Error('特效播放超时。')), 30000);
  const ended = () => finish();
  const failed = () => finish(new Error('特效视频加载失败。'));
  const draw = () => {
    if (settled) return;
    try {
      renderer.draw(video);
      frameId = video.requestVideoFrameCallback ? video.requestVideoFrameCallback(draw) : requestAnimationFrame(draw);
    } catch (error) {
      finish(error);
    }
  };
  const loaded = () => {
    if (settled) return;
    if (video.videoWidth !== effect.layout.videoWidth || video.videoHeight !== effect.layout.videoHeight) {
      finish(new Error('特效视频与画面坐标不匹配。'));
      return;
    }
    try {
      renderer = createAlphaRenderer(canvas, effect.layout);
      stage.append(canvas);
      draw();
    } catch (error) {
      finish(error);
    }
  };
  video.crossOrigin = 'anonymous';
  video.referrerPolicy = 'no-referrer';
  video.muted = true;
  video.playsInline = true;
  video.addEventListener('loadeddata', loaded, { once: true });
  video.addEventListener('ended', ended, { once: true });
  video.addEventListener('error', failed, { once: true });
  video.src = effect.mp4Url;
  try {
    Promise.resolve(video.play()).catch(finish);
  } catch (error) {
    finish(error);
  }
  return { done, stop: () => finish() };
}

function createAlphaRenderer(canvas, layout) {
  const gl = canvas.getContext('webgl', { alpha: true, premultipliedAlpha: false });
  if (!gl) throw new Error('无法创建特效画面。');
  const shaders = [];
  let program;
  let buffer;
  let texture;
  const dispose = () => {
    if (texture) gl.deleteTexture(texture);
    if (buffer) gl.deleteBuffer(buffer);
    if (program) gl.deleteProgram(program);
    shaders.forEach((shader) => gl.deleteShader(shader));
    gl.getExtension('WEBGL_lose_context')?.loseContext();
  };
  function compile(type, source) {
    const shader = gl.createShader(type);
    shaders.push(shader);
    gl.shaderSource(shader, source);
    gl.compileShader(shader);
    if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) throw new Error('特效着色器编译失败。');
    return shader;
  }
  try {
    program = gl.createProgram();
    gl.attachShader(
      program,
      compile(
        gl.VERTEX_SHADER,
        `
      attribute vec2 position;
      varying vec2 uv;
      void main() {
        uv = vec2((position.x + 1.0) * 0.5, (1.0 - position.y) * 0.5);
        gl_Position = vec4(position, 0.0, 1.0);
      }
    `,
      ),
    );
    gl.attachShader(
      program,
      compile(
        gl.FRAGMENT_SHADER,
        `
      precision mediump float;
      uniform sampler2D video;
      uniform vec4 rgbRect;
      uniform vec4 alphaRect;
      varying vec2 uv;
      void main() {
        vec3 rgb = texture2D(video, rgbRect.xy + uv * rgbRect.zw).rgb;
        float alpha = texture2D(video, alphaRect.xy + uv * alphaRect.zw).r;
        gl_FragColor = vec4(rgb, alpha);
      }
    `,
      ),
    );
    gl.linkProgram(program);
    if (!gl.getProgramParameter(program, gl.LINK_STATUS)) throw new Error('特效着色器连接失败。');
    gl.useProgram(program);
    buffer = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 1, -1, -1, 1, 1, 1]), gl.STATIC_DRAW);
    const position = gl.getAttribLocation(program, 'position');
    gl.enableVertexAttribArray(position);
    gl.vertexAttribPointer(position, 2, gl.FLOAT, false, 0, 0);
    for (const [name, frame] of [
      ['rgbRect', layout.rgbFrame],
      ['alphaRect', layout.alphaFrame],
    ]) {
      const [x, y, w, h] = frame;
      gl.uniform4f(
        gl.getUniformLocation(program, name),
        (x + 0.5) / layout.videoWidth,
        (y + 0.5) / layout.videoHeight,
        (w - 1) / layout.videoWidth,
        (h - 1) / layout.videoHeight,
      );
    }
    texture = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, texture);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    gl.viewport(0, 0, canvas.width, canvas.height);
    return {
      draw(video) {
        if (gl.isContextLost()) throw new Error('特效画面已中断。');
        gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, video);
        gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
      },
      dispose,
    };
  } catch (error) {
    dispose();
    throw error;
  }
}
