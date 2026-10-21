import { coordinates, sunDirection } from './time.js';

const VERTEX = `
  attribute vec2 position;
  void main() { gl_Position = vec4(position, 0.0, 1.0); }
`;
const FRAGMENT = `
  precision highp float;
  uniform vec2 center;
  uniform float radius;
  uniform vec3 east;
  uniform vec3 north;
  uniform vec3 front;
  uniform vec3 sun;
  uniform sampler2D dayMap;
  uniform sampler2D nightMap;
  void main() {
    vec2 p = (gl_FragCoord.xy - center) / radius;
    float distance = length(p);
    if (distance > 1.0) {
      float halo = exp(-(distance - 1.0) * 65.0) * 0.30;
      gl_FragColor = vec4(vec3(0.09, 0.32, 0.48) * halo, halo);
      return;
    }
    vec3 viewNormal = vec3(p, sqrt(max(0.0, 1.0 - dot(p, p))));
    vec3 worldNormal = normalize(east * viewNormal.x + north * viewNormal.y + front * viewNormal.z);
    vec2 uv = vec2(0.5 + atan(worldNormal.z, worldNormal.x) / 6.2831853, 0.5 + asin(worldNormal.y) / 3.14159265);
    vec3 land = texture2D(dayMap, uv).rgb;
    vec3 lights = texture2D(nightMap, uv).rgb;
    float sunlight = dot(worldNormal, sun);
    float daylight = smoothstep(-0.12, 0.32, sunlight);
    vec3 color = land * (0.16 + daylight * (0.60 + 0.40 * max(sunlight, 0.0)));
    color += lights * vec3(1.0, 0.79, 0.50) * (1.0 - smoothstep(-0.16, 0.12, sunlight)) * 1.1;
    float rim = pow(1.0 - viewNormal.z, 3.0);
    color += vec3(0.08, 0.28, 0.42) * rim * (0.35 + daylight * 0.65);
    float edge = 1.0 - smoothstep(0.996, 1.0, distance);
    gl_FragColor = vec4(color * edge, edge);
  }
`;

export async function createGlobe(canvas, markerLayer, onSelect, onRotationChange, onError) {
  const gl = canvas.getContext('webgl', { alpha: true, antialias: false, powerPreference: 'low-power' });
  if (!gl) throw new Error('当前设备无法显示地球');
  const dayMap = gl.getParameter(gl.MAX_TEXTURE_SIZE) >= 8192 ? 'earth-day-8k.png' : 'earth-day.jpg';
  const images = await Promise.all([dayMap, 'earth-night.jpg'].map(async file => {
    const image = new Image();
    image.src = new URL(`../../../img/admin/world-clock/${file}`, import.meta.url).href;
    try { await image.decode(); }
    catch { throw new Error('地球影像加载失败，请刷新重试'); }
    return image;
  }));
  const program = gl.createProgram();
  for (const [kind, source] of [[gl.VERTEX_SHADER, VERTEX], [gl.FRAGMENT_SHADER, FRAGMENT]]) {
    const shader = gl.createShader(kind);
    gl.shaderSource(shader, source);
    gl.compileShader(shader);
    const compiled = gl.getShaderParameter(shader, gl.COMPILE_STATUS);
    if (compiled) gl.attachShader(program, shader);
    gl.deleteShader(shader);
    if (!compiled) {
      gl.deleteProgram(program);
      throw new Error('地球绘制未能启动');
    }
  }
  gl.linkProgram(program);
  if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
    gl.deleteProgram(program);
    throw new Error('地球绘制未能启动');
  }
  gl.useProgram(program);
  const buffer = gl.createBuffer();
  gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
  gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 1, -1, -1, 1, -1, 1, 1, -1, 1, 1]), gl.STATIC_DRAW);
  const position = gl.getAttribLocation(program, 'position');
  gl.enableVertexAttribArray(position);
  gl.vertexAttribPointer(position, 2, gl.FLOAT, false, 0, 0);
  const uniforms = Object.fromEntries(['center', 'radius', 'east', 'north', 'front', 'sun', 'dayMap', 'nightMap']
    .map(name => [name, gl.getUniformLocation(program, name)]));
  const anisotropy = gl.getExtension('EXT_texture_filter_anisotropic');
  const textures = images.map((image, index) => {
    gl.activeTexture(gl.TEXTURE0 + index);
    const texture = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, texture);
    gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, true);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGB, gl.RGB, gl.UNSIGNED_BYTE, image);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    if (index === 0) {
      gl.generateMipmap(gl.TEXTURE_2D);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR_MIPMAP_LINEAR);
      if (anisotropy) gl.texParameterf(gl.TEXTURE_2D, anisotropy.TEXTURE_MAX_ANISOTROPY_EXT, Math.min(8, gl.getParameter(anisotropy.MAX_TEXTURE_MAX_ANISOTROPY_EXT)));
    }
    gl.uniform1i(uniforms[index ? 'nightMap' : 'dayMap'], index);
    return texture;
  });

  let lat = 22;
  let lon = 96;
  let scale = 1;
  let width = 0;
  let height = 0;
  let radius = 0;
  let active = false;
  let disposed = false;
  let contextLost = false;
  let rotating = false;
  let animation = 0;
  let previousFrame = 0;
  let destination = null;
  let points = [];
  let sun = sunDirection();
  let drag = null;
  const events = new AbortController();
  const listen = (name, listener, options = {}) => canvas.addEventListener(name, listener, { ...options, signal: events.signal });
  const reducedMotion = matchMedia('(prefers-reduced-motion: reduce)').matches;
  const limitLatitude = value => Math.max(-75, Math.min(75, value));
  const wrapLongitude = value => ((value % 360) + 540) % 360 - 180;

  function draw() {
    if (!active || disposed || contextLost || !width || !height) return;
    const axes = { front: coordinates(lat, lon), east: coordinates(0, lon + 90), north: coordinates(lat + 90, lon) };
    const pixelRatio = Math.min(devicePixelRatio || 1, 2);
    radius = Math.min(width * 0.43, height * 0.455) * scale;
    const cx = width * 0.5;
    const cy = height * 0.51;
    gl.uniform2f(uniforms.center, cx * pixelRatio, (height - cy) * pixelRatio);
    gl.uniform1f(uniforms.radius, radius * pixelRatio);
    for (const key of ['east', 'north', 'front']) gl.uniform3fv(uniforms[key], axes[key]);
    gl.uniform3fv(uniforms.sun, sun);
    gl.drawArrays(gl.TRIANGLES, 0, 6);
    const occupied = [];
    for (const point of points) {
      const dot = axis => point.vector.reduce((sum, value, index) => sum + value * axis[index], 0);
      const x = cx + dot(axes.east) * radius;
      const y = cy - dot(axes.north) * radius;
      const visible = dot(axes.front) > 0.13 && x >= 8 && x <= width - 8 && y >= 8 && y <= height - 30;
      point.node.hidden = !visible;
      if (!visible) continue;
      const leftLabel = x > width * 0.7;
      point.node.classList.toggle('label-left', leftLabel);
      point.node.style.left = `${x}px`;
      point.node.style.top = `${y}px`;
      const labelWidth = Math.max(76, point.city.name.length * 12 + 20);
      const bounds = { left: leftLabel ? x - labelWidth - 12 : x + 12, top: y - 5, right: leftLabel ? x - 12 : x + labelWidth + 12, bottom: y + 21 };
      const overlaps = occupied.some(box => bounds.left < box.right && bounds.right > box.left && bounds.top < box.bottom && bounds.bottom > box.top);
      point.label.hidden = overlaps && !point.node.classList.contains('is-selected');
      if (!point.label.hidden) occupied.push(bounds);
    }
  }

  function resize() {
    if (!active || disposed || contextLost) return;
    width = canvas.clientWidth;
    height = canvas.clientHeight;
    const pixelRatio = Math.min(devicePixelRatio || 1, 2);
    const pixelWidth = Math.round(width * pixelRatio);
    const pixelHeight = Math.round(height * pixelRatio);
    if (canvas.width !== pixelWidth || canvas.height !== pixelHeight) {
      canvas.width = pixelWidth;
      canvas.height = pixelHeight;
      gl.viewport(0, 0, pixelWidth, pixelHeight);
    }
    startFrame();
  }

  function frame(now) {
    animation = 0;
    if (!active || disposed || contextLost) return;
    const delta = Math.min((now - previousFrame) / 1000 || 0, 0.05);
    previousFrame = now;
    if (destination) {
      const distance = wrapLongitude(destination.lon - lon);
      const factor = 1 - Math.exp(-delta * 6);
      lat += (destination.lat - lat) * factor;
      lon += distance * factor;
      if (Math.abs(distance) + Math.abs(destination.lat - lat) < 0.08) destination = null;
    } else if (rotating) lon += delta * 3;
    lon = wrapLongitude(lon);
    draw();
    if (rotating || destination) animation = requestAnimationFrame(frame);
  }

  function startFrame() {
    if (!animation && active && !disposed && !contextLost) {
      previousFrame = performance.now();
      animation = requestAnimationFrame(frame);
    }
  }

  function setRotating(value) {
    rotating = value;
    onRotationChange(value);
    if (value) { destination = null; startFrame(); }
  }

  function zoom(amount) {
    const next = Math.max(0.75, Math.min(3, scale + amount));
    if (next === scale) return;
    scale = next;
    startFrame();
  }

  listen('pointerdown', event => {
    if (event.button !== 0 || !radius) return;
    drag = { x: event.clientX, y: event.clientY, lat, lon };
    destination = null;
    setRotating(false);
    canvas.setPointerCapture(event.pointerId);
  });
  listen('pointermove', event => {
    if (!drag) return;
    lon = wrapLongitude(drag.lon - (event.clientX - drag.x) / radius * 65);
    lat = limitLatitude(drag.lat + (event.clientY - drag.y) / radius * 65);
    startFrame();
  });
  for (const event of ['pointerup', 'pointercancel', 'lostpointercapture']) listen(event, () => { drag = null; });
  listen('wheel', event => { event.preventDefault(); zoom(event.deltaY < 0 ? 0.06 : -0.06); }, { passive: false });
  listen('keydown', event => {
    const changes = { ArrowLeft: [-8, 0], ArrowRight: [8, 0], ArrowUp: [0, 8], ArrowDown: [0, -8] };
    if (changes[event.key]) {
      event.preventDefault();
      setRotating(false);
      destination = null;
      lon = wrapLongitude(lon + changes[event.key][0]);
      lat = limitLatitude(lat + changes[event.key][1]);
      startFrame();
    } else if (['+', '=', '-'].includes(event.key)) { event.preventDefault(); zoom(event.key === '-' ? -0.1 : 0.1); }
  });
  listen('webglcontextlost', event => {
    event.preventDefault();
    contextLost = true;
    cancelAnimationFrame(animation);
    animation = 0;
    setRotating(false);
    markerLayer.hidden = true;
    onError('地球显示中断，请刷新页面');
  });
  const observer = new ResizeObserver(resize);
  observer.observe(canvas);

  return {
    zoom,
    toggleRotation() { setRotating(!rotating); },
    setActive(value) {
      if (active === value) return;
      active = value;
      if (active) {
        resize();
        if (rotating || destination) startFrame();
      } else {
        cancelAnimationFrame(animation);
        animation = 0;
        drag = null;
      }
    },
    focus(city) {
      setRotating(false);
      destination = { lat: city.lat * 0.65, lon: city.lon - 18 };
      if (reducedMotion) { lat = destination.lat; lon = destination.lon; destination = null; startFrame(); }
      else startFrame();
    },
    setSun(date) { sun = sunDirection(date); startFrame(); },
    setCities(cities, selectedId) {
      markerLayer.replaceChildren();
      points = [...cities].sort((a, b) => Number(b.id === selectedId) - Number(a.id === selectedId)).map(city => {
        const node = document.createElement('button');
        node.type = 'button';
        node.className = `world-clock-marker ghost${city.id === selectedId ? ' is-selected' : ''}`;
        node.setAttribute('aria-label', `查看${city.name}时间并定位`);
        node.setAttribute('aria-pressed', String(city.id === selectedId));
        const dot = document.createElement('i');
        const label = document.createElement('span');
        label.textContent = city.name;
        node.append(dot, label);
        node.addEventListener('click', () => onSelect(city.id));
        markerLayer.append(node);
        return { city, node, label, vector: coordinates(city.lat, city.lon) };
      });
      startFrame();
    },
    destroy() {
      disposed = true;
      cancelAnimationFrame(animation);
      observer.disconnect();
      events.abort();
      markerLayer.replaceChildren();
      for (const texture of textures) gl.deleteTexture(texture);
      gl.deleteBuffer(buffer);
      gl.deleteProgram(program);
    },
  };
}
