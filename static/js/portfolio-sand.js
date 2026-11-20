/**
 * Sand made from the lavender glow behind the "PORTFOLIO" title (three.js r170).
 *
 * The glow image (the section's ::before) is sampled into tens of thousands of
 * grains in its own colours, so at rest the section looks as designed. The cursor
 * behaves like in the hero: it pushes grains aside and swirls them around itself,
 * and a fast stroke drags sand along. The trail fills back in slowly. Without a
 * cursor (touch screens, idle) a soft gust drifts across now and then, and the
 * sand settles into place when the section first appears.
 *
 * The canvas sits between the glow (dimmed while the sand is on) and the title.
 */
import { WebGLRenderer, Scene, OrthographicCamera, Points, BufferGeometry, BufferAttribute, ShaderMaterial } from './three.module.min.js';

const VERT = /* glsl */ `
  attribute vec3 aColor;
  attribute float aSize;
  attribute float aSeed;
  uniform float uDpr;
  uniform float uTime;
  uniform float uAlpha;
  varying vec3 vColor;
  varying float vAlpha;
  void main() {
    vec2 p = position.xy;
    // faint shimmer, as if a light breeze moves the surface
    p += vec2(sin(uTime * 0.9 + aSeed * 6.283 + p.y * 0.02),
              cos(uTime * 0.7 + aSeed * 4.0 + p.x * 0.015)) * 0.45;
    vColor = aColor;
    vAlpha = uAlpha;
    gl_PointSize = aSize * uDpr;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(p, 0.0, 1.0);
  }
`;

const FRAG = /* glsl */ `
  varying vec3 vColor;
  varying float vAlpha;
  void main() {
    float d = length(gl_PointCoord - 0.5);
    if (d > 0.5) discard;
    gl_FragColor = vec4(vColor, vAlpha * smoothstep(0.5, 0.28, d));
  }
`;

// Physics, in CSS pixels and seconds. Sand is heavily damped and returns slowly.
const SPRING = 2.0;
const DAMPING = 4.6;
const PUSH = 2600;
const SWIRL = 1300;
const DRAG = 5.5;

const BRAND = [
  [0xde / 255, 0x53 / 255, 0xf5 / 255],
  [0xc1 / 255, 0x63 / 255, 0xee / 255],
  [0x3c / 255, 0x02 / 255, 0xb6 / 255],
];

const clamp = (x, a, b) => Math.min(b, Math.max(a, x));
const gauss = () => (Math.random() + Math.random() + Math.random() - 1.5) * 1.15;

let active = null;

/**
 * Steps the simulation `frames` frames (1/60 s each) with the cursor at (x, y) in canvas
 * pixels, or with no cursor when x is null; then draws. For visual checks.
 */
export function simulateSand(frames, x = null, y = null) {
  active?.simulate(frames, x, y);
}

export function initPortfolioSand({ section, reduceMotion = false, onFail = () => {} }) {
  if (section.querySelector('.portfolio-sand-canvas')) return null; // already running
  const before = getComputedStyle(section, '::before');
  const glowUrl = (before.content.match(/url\(["']?(.*?)["']?\)/) || [])[1];
  if (!glowUrl) return null;

  let renderer;
  try {
    renderer = new WebGLRenderer({ antialias: false, alpha: true, powerPreference: 'high-performance' });
  } catch (err) {
    onFail(err);
    return null;
  }
  const canvas = renderer.domElement;
  canvas.className = 'portfolio-sand-canvas';
  canvas.setAttribute('aria-hidden', 'true');
  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  renderer.setPixelRatio(dpr);
  renderer.setClearColor(0x000000, 0);
  renderer.sortObjects = false; // one object; also skips bounding-sphere maths on 2D positions
  section.appendChild(canvas);

  const material = new ShaderMaterial({
    vertexShader: VERT,
    fragmentShader: FRAG,
    transparent: true,
    depthTest: false,
    depthWrite: false,
    uniforms: { uDpr: { value: dpr }, uTime: { value: 0 }, uAlpha: { value: reduceMotion ? 1 : 0 } },
  });
  const geometry = new BufferGeometry();
  const points = new Points(geometry, material);
  points.frustumCulled = false;
  const scene = new Scene();
  scene.add(points);
  const camera = new OrthographicCamera(0, 1, 1, 0, -1, 1);

  // --- grains
  let W = 1;
  let H = 1;
  let n = 0;
  let pos = new Float32Array(0);
  let vel = new Float32Array(0);
  let home = new Float32Array(0);
  let invMass = new Float32Array(0);
  let builtFor = '';

  const glow = new Image();
  glow.src = glowUrl;

  function build() {
    // The canvas covers the glow box, cropped to the section's width (the glow is wider than phones).
    const gw = glow.naturalWidth;
    const gh = glow.naturalHeight;
    const secW = section.clientWidth;
    const gx = parseFloat(before.left);
    const gy = parseFloat(before.top);
    const left = Math.max(0, gx);
    const right = Math.min(secW, gx + gw);
    W = Math.max(1, Math.round(right - left));
    H = gh;
    Object.assign(canvas.style, { left: `${left}px`, top: `${gy}px`, width: `${W}px`, height: `${H}px` });
    renderer.setSize(W, H, false);
    camera.left = 0;
    camera.right = W;
    camera.top = H;
    camera.bottom = 0;
    camera.updateProjectionMatrix();

    // sample the glow at 1/4 scale: how much colour each spot carries decides grain density
    const S = 4;
    const sw = Math.ceil(gw / S);
    const sh = Math.ceil(gh / S);
    const probe = document.createElement('canvas');
    probe.width = sw;
    probe.height = sh;
    const pctx = probe.getContext('2d', { willReadFrequently: true });
    pctx.drawImage(glow, 0, 0, sw, sh);
    const px = pctx.getImageData(0, 0, sw, sh).data;
    const ink = (ix, iy) => {
      const o = (iy * sw + ix) * 4;
      return 1 - (px[o] + px[o + 1] + px[o + 2]) / (3 * 255); // 0 on white
    };

    const target = clamp(Math.round((W * H) / 16), 12000, 70000);
    const xs = [];
    const ys = [];
    const cols = [];
    const sizes = [];
    const seeds = [];
    const offX = left - gx; // canvas x -> glow image x
    let tries = 0;
    while (xs.length < target && tries < target * 30) {
      tries++;
      const x = Math.random() * W;
      const y = Math.random() * H; // image y, top-down
      const ix = Math.min(sw - 1, Math.floor((x + offX) / S));
      const iy = Math.min(sh - 1, Math.floor(y / S));
      const k = ink(ix, iy);
      if (Math.random() > Math.pow(clamp(k * 4.2, 0, 1), 1.3)) continue;
      xs.push(x);
      ys.push(H - y); // y-up for the camera
      const o = (iy * sw + ix) * 4;
      let c;
      if (k > 0.12 && Math.random() < 0.06) {
        c = BRAND[(Math.random() * BRAND.length) | 0]; // sparse brand-coloured grains, only inside the glow
      } else {
        // deepen the pale glow colour so grains read as sand, not haze
        c = [0, 1, 2].map((j) => clamp(1 - (1 - px[o + j] / 255) * 2.3, 0, 1));
      }
      cols.push(...c);
      sizes.push(1.5 + Math.random() * 1.6);
      seeds.push(Math.random());
    }

    n = xs.length;
    home = new Float32Array(n * 2);
    for (let i = 0; i < n; i++) {
      home[i * 2] = xs[i];
      home[i * 2 + 1] = ys[i];
    }
    pos = home.slice();
    vel = new Float32Array(n * 2);
    invMass = new Float32Array(n);
    for (let i = 0; i < n; i++) invMass[i] = 1 / (0.6 + seeds[i] * 0.8);

    geometry.setAttribute('position', new BufferAttribute(pos, 2));
    geometry.setAttribute('aColor', new BufferAttribute(new Float32Array(cols), 3));
    geometry.setAttribute('aSize', new BufferAttribute(new Float32Array(sizes), 1));
    geometry.setAttribute('aSeed', new BufferAttribute(new Float32Array(seeds), 1));
    geometry.setDrawRange(0, n);
    builtFor = `${secW}`;
    awake = true;
  }

  // --- input
  const pointer = { x: -1e5, y: -1e5, at: -Infinity, type: 'mouse' };
  const onPointer = (e) => {
    pointer.x = e.clientX;
    pointer.y = e.clientY;
    pointer.at = performance.now();
    pointer.type = e.pointerType;
  };
  let cx = -1e5;
  let cy = -1e5;
  let cvx = 0;
  let cvy = 0;
  let lastScroll = window.scrollY;
  let time = 0;
  let awake = true;
  let introAt = -1;

  function scatter() {
    // sand blown in from above, settling into the glow
    for (let i = 0; i < n; i++) {
      pos[i * 2] = home[i * 2] + gauss() * 120;
      pos[i * 2 + 1] = home[i * 2 + 1] + 90 + Math.abs(gauss()) * 140;
      vel[i * 2] = 0;
      vel[i * 2 + 1] = 0;
    }
    awake = true;
  }

  // One physics step. (x, y): force centre in canvas pixels (y-up); strength: 0..1.5
  function step(dt, x, y, vx, vy, strength, shake) {
    const R = clamp(W * 0.075, 55, 105);
    const R2 = R * R;
    const damp = Math.exp(-DAMPING * dt);
    const push = PUSH * strength;
    const swirl = SWIRL * Math.min(strength, 1);
    let energy = 0;
    for (let i = 0; i < n; i++) {
      const ix = i * 2;
      const iy = ix + 1;
      let px = pos[ix];
      let py = pos[iy];
      let ax = (home[ix] - px) * SPRING;
      let ay = (home[iy] - py) * SPRING;
      const dx = px - x;
      const dy = py - y;
      const d2 = dx * dx + dy * dy;
      if (d2 < R2) {
        const d = Math.sqrt(d2) + 0.001;
        const f = 1 - d / R;
        const f2 = f * f * invMass[i];
        ax += (dx / d) * push * f2 - (dy / d) * swirl * f2 + vx * DRAG * f2;
        ay += (dy / d) * push * f2 + (dx / d) * swirl * f2 + vy * DRAG * f2;
      }
      if (shake) ay -= shake * invMass[i];
      let vxi = (vel[ix] + ax * dt) * damp;
      let vyi = (vel[iy] + ay * dt) * damp;
      px += vxi * dt;
      py += vyi * dt;
      pos[ix] = px;
      pos[iy] = py;
      vel[ix] = vxi;
      vel[iy] = vyi;
      energy += Math.abs(vxi) + Math.abs(vyi) + Math.abs(home[ix] - px) + Math.abs(home[iy] - py);
    }
    geometry.attributes.position.needsUpdate = true;
    return energy / Math.max(1, n);
  }

  function update(dt, now) {
    const rect = canvas.getBoundingClientRect();
    const recent = now - pointer.at;
    const mouseInside = pointer.x >= rect.left && pointer.x <= rect.right && pointer.y >= rect.top && pointer.y <= rect.bottom;
    let tx;
    let ty;
    let strength = 0;
    if (mouseInside && (pointer.type === 'mouse' ? recent < 8000 : recent < 600)) {
      tx = pointer.x - rect.left;
      ty = H - (pointer.y - rect.top);
    } else if (recent > 4000 && time % 14 < 7) {
      // idle gust, like the hero's drifting touch point: a slow pass across the glow every 14 s
      const phase = (time % 14) / 7;
      const cycle = Math.floor(time / 14);
      tx = W * (-0.1 + phase * 1.2);
      ty = H * (0.42 + 0.14 * Math.sin(cycle * 2.3 + phase * 4));
      strength = 0.35;
    }

    if (tx === undefined) {
      cx = -1e5;
      cy = -1e5;
      cvx = 0;
      cvy = 0;
    } else {
      if (cx < -1e4) {
        cx = tx;
        cy = ty;
      }
      const k = 1 - Math.exp(-14 * dt);
      const nx = cx + (tx - cx) * k;
      const ny = cy + (ty - cy) * k;
      cvx = (nx - cx) / dt;
      cvy = (ny - cy) / dt;
      cx = nx;
      cy = ny;
      if (!strength) strength = 0.45 + Math.min(Math.hypot(cvx, cvy) / 700, 1.05);
      awake = true;
    }

    // scrolling shakes the sand a little: grains lag behind the page and settle
    const sy = window.scrollY;
    const scrollV = (sy - lastScroll) / dt;
    lastScroll = sy;
    const shake = clamp(scrollV * 0.12, -120, 120);
    if (Math.abs(shake) > 6) awake = true;

    if (awake) {
      const energy = step(dt, cx, cy, cvx, cvy, strength, Math.abs(shake) > 6 ? shake : 0);
      if (energy < 0.05 && tx === undefined) awake = false;
    }

    if (introAt >= 0) material.uniforms.uAlpha.value = clamp((now - introAt) / 700, 0, 1);
    material.uniforms.uTime.value = time;
  }

  function draw() {
    renderer.render(scene, camera);
  }

  // --- loop
  let raf = 0;
  let running = false;
  let inView = false;
  let last = 0;
  function frame(now) {
    raf = requestAnimationFrame(frame);
    const dt = Math.min(Math.max((now - last) / 1000, 1 / 240), 1 / 30);
    last = now;
    time += dt;
    update(dt, now);
    draw();
  }
  function start() {
    if (running || reduceMotion || !inView || !n) return;
    if (introAt < 0) {
      scatter();
      introAt = performance.now();
      section.classList.add('sand-on'); // the glow dims as the sand takes over
    }
    running = true;
    last = performance.now();
    lastScroll = window.scrollY;
    raf = requestAnimationFrame(frame);
  }
  function stop() {
    running = false;
    cancelAnimationFrame(raf);
  }

  function simulate(frames, x, y) {
    for (let f = 0; f < frames; f++) {
      if (x === null) {
        cx = -1e5;
        cy = -1e5;
        step(1 / 60, cx, cy, 0, 0, 0, 0);
        continue;
      }
      const nx = x;
      const ny = H - y;
      const vx = cx < -1e4 ? 0 : (nx - cx) * 60;
      const vy = cx < -1e4 ? 0 : (ny - cy) * 60;
      cx = nx;
      cy = ny;
      step(1 / 60, nx, ny, vx, vy, 0.45 + Math.min(Math.hypot(vx, vy) / 700, 1.05), 0);
    }
    material.uniforms.uAlpha.value = 1;
    draw();
  }

  const resizeObserver = new ResizeObserver(() => {
    if (!glow.naturalWidth || builtFor === `${section.clientWidth}`) return;
    build();
    if (introAt >= 0 || reduceMotion) material.uniforms.uAlpha.value = 1;
    draw();
  });
  const viewObserver = new IntersectionObserver(
    ([entry]) => {
      inView = entry.isIntersecting;
      if (inView) start();
      else stop();
    },
    { threshold: 0.12 },
  );

  function destroy() {
    stop();
    resizeObserver.disconnect();
    viewObserver.disconnect();
    window.removeEventListener('pointermove', onPointer);
    geometry.dispose();
    material.dispose();
    renderer.dispose();
    canvas.remove();
    section.classList.remove('sand-on');
    if (active === controller) active = null;
  }
  const controller = { simulate, destroy };

  canvas.addEventListener('webglcontextlost', (e) => {
    e.preventDefault();
    destroy();
    onFail(new Error('WebGL context lost'));
  });

  active = controller;
  const ready = new Promise((resolve, reject) => {
    if (glow.complete && glow.naturalWidth) resolve();
    glow.addEventListener('load', resolve, { once: true });
    glow.addEventListener('error', reject, { once: true });
  });
  ready
    .then(() => {
      if (active !== controller) return;
      build();
      draw();
      if (!reduceMotion) window.addEventListener('pointermove', onPointer, { passive: true });
      resizeObserver.observe(section);
      viewObserver.observe(canvas);
      canvas.classList.add('is-ready');
      if (reduceMotion) section.classList.add('sand-on');
    })
    .catch((err) => {
      destroy();
      onFail(err);
    });

  return controller;
}
