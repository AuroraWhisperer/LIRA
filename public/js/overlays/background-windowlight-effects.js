const WIDTH = 1920;
const HEIGHT = 1080;

// Illumination is projected onto fixed surfaces. A local wind field moves the
// penumbra within each patch; the room and the broad sun shafts never translate.
const LIGHT_FRAGMENT = `
precision mediump float;
varying vec2 uv;
uniform sampler2D daylight;
uniform sampler2D prism;
uniform sampler2D lamp;
uniform vec3 amounts;
uniform float time;
uniform float warmth;
float hash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
float noise(vec2 p) {
  vec2 i = floor(p), f = fract(p); f = f * f * (3.0 - 2.0 * f);
  return mix(mix(hash(i), hash(i + vec2(1,0)), f.x),
    mix(hash(i + vec2(0,1)), hash(i + vec2(1,1)), f.x), f.y);
}
void main() {
  vec2 p = uv * vec2(16.0, 9.0);
  vec2 breeze = vec2(sin(time * .79 + p.y * .67), cos(time * .61 + p.x * .53));
  float canopy = noise(p * 2.4 + breeze * .48 + vec2(time * .12, 0.0));
  canopy = .68 * canopy + .32 * noise(p * 5.3 + breeze * .8);
  float transmission = smoothstep(.24, .73, canopy);
  vec4 sun = texture2D(daylight, uv);
  vec2 bend = vec2(sin(time * 1.13 + p.y), cos(time * .87 + p.x)) * .003;
  vec4 rainbow = texture2D(prism, uv + bend);
  vec4 reflection = texture2D(lamp, uv + bend * .6);
  float shimmer = smoothstep(.25, .8, noise(p * 3.2 + breeze + vec2(time * .16, 0.0)));
  vec3 sunColor = mix(sun.rgb, sun.rgb * vec3(1.0, .74, .46), warmth);
  vec3 a = sunColor * sun.a * (.21 + .79 * transmission) * amounts.x;
  vec3 b = rainbow.rgb * rainbow.a * (.12 + .88 * shimmer) * amounts.y;
  vec3 c = reflection.rgb * reflection.a * (.14 + .86 * shimmer) * amounts.z;
  gl_FragColor = vec4(1.0 - (1.0 - a) * (1.0 - b) * (1.0 - c), 1.0);
}`;

function createIllumination(canvas, images) {
  const gl = canvas.getContext('webgl', { alpha: false, antialias: false, depth: false, preserveDrawingBuffer: true });
  if (!gl) return null;
  const compile = (type, source) => {
    const shader = gl.createShader(type);
    gl.shaderSource(shader, source);
    gl.compileShader(shader);
    if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(shader));
    return shader;
  };
  const vertex = compile(gl.VERTEX_SHADER, 'attribute vec2 position; varying vec2 uv; void main(){ uv = vec2((position.x + 1.0) * .5, (1.0 - position.y) * .5); gl_Position = vec4(position, 0, 1); }');
  const fragment = compile(gl.FRAGMENT_SHADER, LIGHT_FRAGMENT);
  const program = gl.createProgram();
  gl.attachShader(program, vertex);
  gl.attachShader(program, fragment);
  gl.linkProgram(program);
  if (!gl.getProgramParameter(program, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(program));
  gl.useProgram(program);
  const buffer = gl.createBuffer();
  gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
  gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 1, -1, -1, 1, -1, 1, 1, -1, 1, 1]), gl.STATIC_DRAW);
  const position = gl.getAttribLocation(program, 'position');
  gl.enableVertexAttribArray(position);
  gl.vertexAttribPointer(position, 2, gl.FLOAT, false, 0, 0);
  const textures = ['dappled-light', 'prismatic-light', 'lamp-light'].map((name, index) => {
    const texture = gl.createTexture();
    gl.activeTexture(gl.TEXTURE0 + index);
    gl.bindTexture(gl.TEXTURE_2D, texture);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, images.get(name));
    gl.uniform1i(gl.getUniformLocation(program, ['daylight', 'prism', 'lamp'][index]), index);
    return texture;
  });
  const uniforms = Object.fromEntries(['time', 'amounts', 'warmth'].map(name => [name, gl.getUniformLocation(program, name)]));
  gl.viewport(0, 0, canvas.width, canvas.height);
  return {
    draw(time, amounts, warmth) {
      gl.uniform1f(uniforms.time, time);
      gl.uniform3fv(uniforms.amounts, amounts);
      gl.uniform1f(uniforms.warmth, warmth);
      gl.drawArrays(gl.TRIANGLES, 0, 6);
    },
    dispose() {
      textures.forEach(texture => gl.deleteTexture(texture));
      gl.deleteBuffer(buffer);
      gl.deleteProgram(program);
      gl.deleteShader(vertex);
      gl.deleteShader(fragment);
      gl.getExtension('WEBGL_lose_context')?.loseContext();
    },
  };
}

function createGlassWater(canvas, painting) {
  const context = canvas.getContext('2d');
  const attached = canvas.ownerDocument.createElement('canvas');
  attached.width = WIDTH;
  attached.height = HEIGHT;
  const still = attached.getContext('2d');
  let seed = 0x57415445;
  const random = () => {
    seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
    return seed / 4294967296;
  };
  const panes = [[1306, 1480], [1520, 1726]];
  const beads = Array.from({ length: 320 }, (_, index) => {
    const [left, right] = panes[index % 2];
    return { x: left + 5 + random() * (right - left - 10), y: random() * 862,
      radius: .55 + random() ** 3 * 2.1, slant: random() * .3 - .15, hiddenUntil: 0 };
  });
  const makeRunner = index => {
    const [left, right] = panes[index % 2];
    return { x: left + 12 + random() * (right - left - 24), y: 5 + random() * 725,
      radius: 1.7 + random() * 1.5, slant: random() * .2 - .1, velocity: 0,
      rest: random() * 5, slide: .35 + random() * 1.3, direction: random() * 2 - 1, trail: [] };
  };
  const runners = Array.from({ length: 18 }, (_, index) => makeRunner(index));
  let dirty = true;
  let nextCondensation = 0;

  function lens(ctx, drop, velocity = 0) {
    const { x, y, radius: r, slant } = drop;
    const stretch = 1.15 + Math.min(.75, velocity / 100);
    ctx.save();
    ctx.translate(x, y);
    ctx.rotate(slant);
    ctx.beginPath();
    ctx.ellipse(0, 0, r, r * stretch, 0, 0, Math.PI * 2);
    ctx.save();
    ctx.clip();
    // Magnified, vertically displaced scenery inside the lens supplies the
    // water's body. Only the narrow rim reflects light; no opaque white fill.
    const sx = painting.naturalWidth / WIDTH;
    const sy = painting.naturalHeight / HEIGHT;
    ctx.drawImage(painting, (x - r * .65) * sx, (y - r * .5 - 5) * sy,
      r * 1.3 * sx, r * 1.2 * stretch * sy, -r, -r * stretch, r * 2, r * 2 * stretch);
    ctx.restore();
    ctx.strokeStyle = 'rgba(24, 53, 66, .34)';
    ctx.lineWidth = .65;
    ctx.stroke();
    ctx.beginPath();
    ctx.ellipse(-r * .14, -r * .09, r * .7, r * stretch * .77, 0, Math.PI * 1.08, Math.PI * 1.68);
    ctx.strokeStyle = 'rgba(233, 250, 255, .68)';
    ctx.lineWidth = .6;
    ctx.stroke();
    ctx.restore();
  }

  return {
    draw(delta, time) {
      context.clearRect(0, 0, WIDTH, HEIGHT);
      for (const [index, drop] of runners.entries()) {
        if (delta > 0) {
          if (drop.rest > 0) {
            drop.rest -= delta;
            drop.velocity *= Math.exp(-12 * delta);
          } else {
            drop.velocity = Math.min(125, drop.velocity + (48 + drop.radius * 23) * delta);
            drop.slide -= delta;
            if (drop.slide <= 0) {
              drop.rest = .25 + random() * 2.5;
              drop.slide = .3 + random() * 1.8;
              drop.direction = random() * 2 - 1;
            }
          }
          drop.y += drop.velocity * delta;
          drop.x += drop.direction * drop.velocity * delta * .025;
          if (drop.velocity > 6) drop.trail.push({ x: drop.x, y: drop.y, time });
          drop.trail = drop.trail.filter(point => time - point.time < 2.6);
          for (const bead of beads) {
            if (bead.hiddenUntil > time || Math.abs(bead.y - drop.y) > drop.radius * 2) continue;
            if (Math.abs(bead.x - drop.x) < drop.radius + bead.radius) {
              bead.hiddenUntil = time + 8 + random() * 9;
              drop.radius = Math.min(4, Math.sqrt(drop.radius ** 2 + bead.radius ** 2 * .32));
              drop.rest = 0;
              dirty = true;
            }
          }
          if (drop.y > 870) Object.assign(drop, makeRunner(index), { y: -5 });
        }
      }
      if (dirty || time >= nextCondensation) {
        still.clearRect(0, 0, WIDTH, HEIGHT);
        for (const bead of beads) if (bead.hiddenUntil <= time) lens(still, bead);
        dirty = false;
        nextCondensation = time + 1;
      }
      context.drawImage(attached, 0, 0);
      for (const drop of runners) {
        for (let index = 1; index < drop.trail.length; index++) {
          const before = drop.trail[index - 1];
          const point = drop.trail[index];
          const freshness = Math.max(0, 1 - (time - point.time) / 2.6);
          context.beginPath();
          context.moveTo(before.x, before.y);
          context.lineTo(point.x, point.y);
          context.lineWidth = .65 + freshness * .8;
          context.strokeStyle = `rgba(194, 219, 226, ${freshness * .3})`;
          context.stroke();
        }
        lens(context, drop, drop.velocity);
      }
    },
  };
}

export function createWindowlightEffects(root, images) {
  const canvas = name => {
    const node = root.ownerDocument.createElement('canvas');
    node.className = name;
    node.width = WIDTH;
    node.height = HEIGHT;
    node.setAttribute('aria-hidden', 'true');
    root.append(node);
    return node;
  };
  const light = canvas('windowlight-illumination');
  const illumination = createIllumination(light, images);
  root.dataset.illumination = illumination ? 'ready' : 'static';
  if (!illumination) light.hidden = true;
  const rain = canvas('windowlight-rain');
  rain.style.maskImage = `url("${images.get('window-mask').src}")`;
  const water = createGlassWater(rain, images.get('rainy'));
  const levels = { sunny: [1, .75, 0], sunset: [1.2, 1, .14], rainy: [0, 0, .08], night: [0, 0, 1] };
  let scene = root.dataset.scene;
  let amounts = [...levels[scene]];
  let warmth = scene === 'sunset' ? 1 : 0;
  let elapsed = 0;
  let lastFrame = null;
  let frame = null;
  let disposed = false;

  function draw(delta) {
    elapsed += delta;
    illumination?.draw(elapsed, amounts, warmth);
    if (scene === 'rainy') water.draw(delta, elapsed);
  }

  function animate(now) {
    frame = requestAnimationFrame(animate);
    if (lastFrame !== null && now - lastFrame < 32) return;
    const delta = lastFrame === null ? 0 : Math.min(.1, (now - lastFrame) / 1000);
    lastFrame = now;
    const blend = 1 - Math.exp(-delta * 3);
    amounts = amounts.map((value, index) => value + (levels[scene][index] - value) * blend);
    warmth += ((scene === 'sunset' ? 1 : 0) - warmth) * blend;
    draw(delta);
  }

  return {
    update(nextScene, running) {
      if (disposed) return;
      const changed = scene !== nextScene;
      scene = nextScene;
      if (!running) {
        cancelAnimationFrame(frame);
        frame = null;
        lastFrame = null;
        amounts = [...levels[scene]];
        warmth = scene === 'sunset' ? 1 : 0;
      }
      if (frame === null || changed) draw(0);
      if (running && frame === null) frame = requestAnimationFrame(animate);
    },
    dispose() {
      disposed = true;
      cancelAnimationFrame(frame);
      illumination?.dispose();
      light.remove();
      rain.remove();
      delete root.dataset.illumination;
    },
  };
}
