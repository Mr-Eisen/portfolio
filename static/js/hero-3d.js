/**
 * Hero background: real-time black "liquid satin" plus 3D brand rings (three.js r170).
 *
 * Replaces the looping background video with a shader that keeps the same look
 * (dark glossy folds, soft grey highlights) but reacts to the cursor, and turns the
 * flat concentric-rings SVG into 3D rings that tilt toward the pointer.
 * The video stays as the fallback: see effects-loader.js.
 *
 * Also used without rings for the footer, so the page starts and ends with the
 * same live liquid; the footer's static footer.svg stays underneath as fallback.
 */
import {
  WebGLRenderer,
  Scene,
  Camera,
  PerspectiveCamera,
  Mesh,
  PlaneGeometry,
  TorusGeometry,
  ShaderMaterial,
  WebGLRenderTarget,
  LinearFilter,
  Vector2,
  Vector3,
  Group,
} from './three.module.min.js';

// Brand gradient from the rings SVG, kept in sRGB (custom shaders write values as-is).
const hex = (h) => new Vector3(...[1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16) / 255));
const VIOLET = hex('#3C02B6');
const PINK = hex('#DE53F5');

// Geometry of the original rings SVG (274x194 viewBox): ring centre and radii.
const SVG_W = 274;
const SVG_H = 194;
const RING_CX = 142.709;
const RING_CY = 50.67;
const RING_RADII = Array.from({ length: 12 }, (_, i) => 32 + i * 10);
const GRAD_LEFT = 28; // #DE53F5 end of the SVG gradient
const GRAD_RIGHT = 302; // #3C02B6 end

const FULLSCREEN_VERT = /* glsl */ `
  varying vec2 vUv;
  void main() {
    vUv = uv;
    gl_Position = vec4(position.xy, 0.0, 1.0);
  }
`;

const LIQUID_FRAG = /* glsl */ `
  uniform float uTime;
  uniform float uAspect;
  uniform vec2 uMouse;
  uniform vec2 uVel;
  uniform float uPush;
  uniform float uScroll;
  uniform float uFreq;
  uniform float uExposure;
  uniform vec3 uViolet;
  uniform vec3 uPink;
  varying vec2 vUv;

  vec3 hash3(vec3 p) {
    p = vec3(dot(p, vec3(127.1, 311.7, 74.7)),
             dot(p, vec3(269.5, 183.3, 246.1)),
             dot(p, vec3(113.5, 271.9, 124.6)));
    return -1.0 + 2.0 * fract(sin(p) * 43758.5453123);
  }

  // Gradient noise with quintic fade.
  float gnoise(vec3 p) {
    vec3 i = floor(p);
    vec3 f = fract(p);
    vec3 u = f * f * f * (f * (f * 6.0 - 15.0) + 10.0);
    float n000 = dot(hash3(i), f);
    float n100 = dot(hash3(i + vec3(1.0, 0.0, 0.0)), f - vec3(1.0, 0.0, 0.0));
    float n010 = dot(hash3(i + vec3(0.0, 1.0, 0.0)), f - vec3(0.0, 1.0, 0.0));
    float n110 = dot(hash3(i + vec3(1.0, 1.0, 0.0)), f - vec3(1.0, 1.0, 0.0));
    float n001 = dot(hash3(i + vec3(0.0, 0.0, 1.0)), f - vec3(0.0, 0.0, 1.0));
    float n101 = dot(hash3(i + vec3(1.0, 0.0, 1.0)), f - vec3(1.0, 0.0, 1.0));
    float n011 = dot(hash3(i + vec3(0.0, 1.0, 1.0)), f - vec3(0.0, 1.0, 1.0));
    float n111 = dot(hash3(i + vec3(1.0, 1.0, 1.0)), f - vec3(1.0, 1.0, 1.0));
    return mix(mix(mix(n000, n100, u.x), mix(n010, n110, u.x), u.y),
               mix(mix(n001, n101, u.x), mix(n011, n111, u.x), u.y), u.z);
  }

  float fbm(vec3 p) {
    float s = 0.0;
    float a = 0.5;
    for (int i = 0; i < 3; i++) {
      s += a * gnoise(p);
      p = p * 2.02 + vec3(3.1, 1.7, 0.0);
      a *= 0.5;
    }
    return s;
  }

  vec2 toPlane(vec2 uv) {
    return (uv - 0.5) * vec2(uAspect, 1.0) * uFreq * (1.0 - uScroll * 0.206);
  }

  // Height of the satin surface. Domain-warped noise gives the long folds,
  // a ridged layer adds the thin glossy strands seen in the original video.
  float field(vec2 uv) {
    vec2 p = toPlane(uv);
    vec2 d = p - toPlane(uMouse);
    float f = exp(-dot(d, d) * 3.0);
    p += vec2(-d.y, d.x) * f * uPush * 0.7;  // swirl around the cursor
    p -= uVel * f;                            // drag along the cursor's motion

    float t = uTime * 0.06;
    vec2 w = vec2(fbm(vec3(p * 0.8, t)), fbm(vec3(p * 0.8 + vec2(5.2, 1.3), t + 3.7)));
    vec2 q = p + 1.6 * w;
    float h = fbm(vec3(q * 1.1, t * 1.5 + 7.0));
    float r = 1.0 - abs(gnoise(vec3(q * 2.4, t * 2.2 + 11.0)));
    h += r * r * r * 0.08;
    h += f * uPush * 0.24; // the surface lifts under the cursor
    return h;
  }

  void main() {
    const float EPS = 0.0025;
    float h = field(vUv);
    vec2 g = vec2(field(vUv + vec2(EPS, 0.0)) - h, field(vUv + vec2(0.0, EPS)) - h) / EPS;
    vec3 n = normalize(vec3(-g * 0.2, 1.0));

    vec3 V = vec3(0.0, 0.0, 1.0);
    vec3 L1 = normalize(vec3(-0.55, 0.7, 0.55)); // key light, top-left
    vec3 L2 = normalize(vec3(0.75, -0.35, 0.5)); // brand-tinted fill, bottom-right
    float nh1 = max(dot(n, normalize(L1 + V)), 0.0);
    float nh2 = max(dot(n, normalize(L2 + V)), 0.0);

    // black satin: almost no diffuse, a broad soft sheen and a tight glossy highlight
    float spec = pow(nh1, 90.0) * 0.85 + pow(nh1, 22.0) * 0.16 + pow(nh1, 6.0) * 0.025;
    float fill = pow(nh2, 40.0) * 0.07;
    float rim = pow(1.0 - n.z, 3.0) * 0.03;

    vec3 tint = mix(uPink, uViolet, vUv.x);
    vec3 col = vec3(spec + rim) * vec3(0.9, 0.9, 0.93) + tint * fill;

    // faint brand glow where the cursor touches the surface
    vec2 dm = toPlane(vUv) - toPlane(uMouse);
    col += tint * exp(-dot(dm, dm) * 6.0) * uPush * 0.025;

    col = pow(col, vec3(1.15)); // deepen the mid-tones, keep highlights
    float vig = smoothstep(1.25, 0.25, length((vUv - 0.5) * vec2(1.15, 1.0)));
    col *= mix(0.35, 1.0, vig) * (1.0 - uScroll * 0.45) * uExposure;

    float dither = fract(sin(dot(gl_FragCoord.xy, vec2(12.9898, 78.233))) * 43758.5453);
    col += (dither - 0.5) / 255.0;
    gl_FragColor = vec4(col, 1.0);
  }
`;

const BLIT_FRAG = /* glsl */ `
  uniform sampler2D tLiquid;
  varying vec2 vUv;
  void main() {
    vec3 c = texture2D(tLiquid, vUv).rgb;
    float dither = fract(sin(dot(gl_FragCoord.xy, vec2(12.9898, 78.233))) * 43758.5453);
    gl_FragColor = vec4(c + (dither - 0.5) / 255.0, 1.0);
  }
`;

const RING_VERT = /* glsl */ `
  uniform float uGradLeft;
  uniform float uGradRight;
  varying float vT;
  varying float vShine;
  void main() {
    vT = clamp((uGradRight - position.x) / (uGradRight - uGradLeft), 0.0, 1.0);
    // A glint runs along the part of the hoop that tilts toward the light.
    vec3 radial = normalize(normalMatrix * vec3(normalize(position.xy), 0.0));
    vec3 axis = normalize(normalMatrix * vec3(0.0, 0.0, 1.0));
    float tilt = 1.0 - abs(axis.z);
    vShine = clamp(pow(max(dot(radial, normalize(vec3(-0.5, 0.65, 0.6))), 0.0), 3.0) * tilt * 4.0, 0.0, 1.0);
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  }
`;

const RING_FRAG = /* glsl */ `
  uniform vec3 uViolet;
  uniform vec3 uPink;
  uniform float uOpacity;
  varying float vT;
  varying float vShine;
  void main() {
    vec3 c = mix(uViolet, uPink, vT) + vec3(vShine * 0.75);
    gl_FragColor = vec4(c, uOpacity * (0.8 + vShine * 0.6));
  }
`;

const smooth = (rate, dt) => 1 - Math.exp(-rate * dt);
const easeOutCubic = (x) => 1 - Math.pow(1 - x, 3);
const clamp01 = (x) => Math.min(1, Math.max(0, x));

let active = null;

/** Renders one frame at a fixed time (used for reduced motion; handy for visual checks). */
export function renderHeroAt(seconds, mouseX = 0.62, mouseY = 0.55, pushStrength = 0.35) {
  active?.renderAt(seconds, mouseX, mouseY, pushStrength);
}

/**
 * @param {object} o
 * @param {HTMLElement} o.banner  container the canvas fills (the hero banner, or the footer)
 * @param {SVGElement} [o.rings]  flat rings SVG to replace with 3D rings (hero only)
 * @param {number} [o.exposure]   brightness multiplier; a short strip catches fewer highlights
 */
export function initHero3D({ banner, rings: ringsSvg = null, reduceMotion = false, exposure = 1, onFail = () => {} }) {
  if (banner.querySelector(':scope > .hero-canvas')) return null; // already running here
  // Only the instance that draws the 3D rings hides the flat SVG ones.
  const hidesSvgRings = !!ringsSvg;
  let renderer;
  try {
    renderer = new WebGLRenderer({ antialias: true, powerPreference: 'high-performance' });
  } catch (err) {
    onFail(err);
    return null;
  }

  const canvas = renderer.domElement;
  canvas.className = 'hero-canvas';
  canvas.setAttribute('aria-hidden', 'true');
  renderer.autoClear = false;
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));

  const video = banner.querySelector('video');
  if (video) video.after(canvas);
  else banner.prepend(canvas);

  // --- liquid pass (rendered at reduced resolution: the surface is soft anyway)
  let liquidScale = 0.6; // of CSS pixels
  const rt = new WebGLRenderTarget(2, 2, { minFilter: LinearFilter, magFilter: LinearFilter, depthBuffer: false });
  const quad = new PlaneGeometry(2, 2);
  const fsCamera = new Camera();

  const liquidMat = new ShaderMaterial({
    vertexShader: FULLSCREEN_VERT,
    fragmentShader: LIQUID_FRAG,
    depthTest: false,
    depthWrite: false,
    uniforms: {
      uTime: { value: 0 },
      uAspect: { value: 1 },
      uMouse: { value: new Vector2(0.62, 0.55) },
      uVel: { value: new Vector2() },
      uPush: { value: 0.35 },
      uScroll: { value: 0 },
      uFreq: { value: 1.7 },
      uExposure: { value: exposure },
      uViolet: { value: VIOLET },
      uPink: { value: PINK },
    },
  });
  const liquidScene = new Scene();
  const liquidMesh = new Mesh(quad, liquidMat);
  liquidMesh.frustumCulled = false;
  liquidScene.add(liquidMesh);

  const blitMat = new ShaderMaterial({
    vertexShader: FULLSCREEN_VERT,
    fragmentShader: BLIT_FRAG,
    depthTest: false,
    depthWrite: false,
    uniforms: { tLiquid: { value: rt.texture } },
  });
  const blitScene = new Scene();
  const blitMesh = new Mesh(quad, blitMat);
  blitMesh.frustumCulled = false;
  blitScene.add(blitMesh);

  // --- rings (1 world unit = 1 CSS pixel on the z = 0 plane)
  const FOV = 30;
  const ringCamera = new PerspectiveCamera(FOV, 1, 1, 10000);
  const ringScene = new Scene();
  const ringGroup = new Group();
  ringScene.add(ringGroup);
  const rings = RING_RADII.map(() => {
    const mat = new ShaderMaterial({
      vertexShader: RING_VERT,
      fragmentShader: RING_FRAG,
      transparent: true,
      depthTest: false,
      depthWrite: false,
      uniforms: {
        uViolet: { value: VIOLET },
        uPink: { value: PINK },
        uOpacity: { value: 0 },
        uGradLeft: { value: 0 },
        uGradRight: { value: 1 },
      },
    });
    const mesh = new Mesh(undefined, mat);
    ringGroup.add(mesh);
    return { mesh, mat, rotX: 0, rotY: 0 };
  });
  let ringScale = 0;
  let ringsVisible = false;

  // --- layout
  let W = 1;
  let H = 1;
  const drawSize = new Vector2();

  function layoutRings(bannerRect) {
    // getClientRects() is empty only when the SVG is not rendered (display: none).
    ringsVisible = !!ringsSvg && ringsSvg.getClientRects().length > 0;
    ringGroup.visible = ringsVisible;
    if (!ringsVisible) return;
    // The SVG may be mid scale-in animation (its rect can even be 0x0), but its centre
    // does not move, and its untransformed size comes from the width attribute.
    const r = ringsSvg.getBoundingClientRect();
    const k = (ringsSvg.width?.baseVal?.value || SVG_W) / SVG_W;
    const cx = r.left + r.width / 2 - bannerRect.left + (RING_CX - SVG_W / 2) * k;
    const cy = r.top + r.height / 2 - bannerRect.top + (RING_CY - SVG_H / 2) * k;
    ringGroup.position.set(cx - W / 2, H / 2 - cy, 0);
    if (k !== ringScale) {
      ringScale = k;
      rings.forEach((ring, i) => {
        ring.mesh.geometry?.dispose();
        ring.mesh.geometry = new TorusGeometry(RING_RADII[i] * k, 0.55 * k, 6, 220);
        ring.mat.uniforms.uGradLeft.value = (GRAD_LEFT - RING_CX) * k;
        ring.mat.uniforms.uGradRight.value = (GRAD_RIGHT - RING_CX) * k;
      });
    }
  }

  function layout() {
    const rect = banner.getBoundingClientRect();
    W = Math.max(1, Math.round(rect.width));
    H = Math.max(1, Math.round(rect.height));
    renderer.setSize(W, H, false);
    renderer.getDrawingBufferSize(drawSize);
    rt.setSize(Math.max(2, Math.round(W * liquidScale)), Math.max(2, Math.round(H * liquidScale)));
    liquidMat.uniforms.uAspect.value = W / H;
    // keep folds and the cursor's reach the same size in pixels as in a full-screen hero,
    // so a shorter container (the footer) shows the same liquid, not a busier one
    liquidMat.uniforms.uFreq.value = 1.7 * Math.min(1, H / window.innerHeight);
    ringCamera.aspect = W / H;
    ringCamera.position.set(0, 0, H / 2 / Math.tan((FOV * Math.PI) / 360));
    ringCamera.updateProjectionMatrix();
    layoutRings(rect);
  }

  // --- input
  const pointer = { x: 0, y: 0, at: -Infinity };
  const onPointer = (e) => {
    pointer.x = e.clientX;
    pointer.y = e.clientY;
    pointer.at = performance.now();
  };

  // --- animation state
  const mouse = new Vector2(0.62, 0.55);
  const prevMouse = mouse.clone();
  const vel = new Vector2();
  const target = new Vector2();
  let push = 0.35;
  let time = 8; // start mid-flow rather than from the noise origin
  let introStart = performance.now();
  let frameEma = 1 / 60;
  let framesSinceTune = 0;

  function update(dt, now) {
    const rect = banner.getBoundingClientRect();
    const inside = pointer.x >= rect.left && pointer.x <= rect.right && pointer.y >= rect.top && pointer.y <= rect.bottom;
    if (now - pointer.at < 2500 && inside) {
      target.set((pointer.x - rect.left) / W, 1 - (pointer.y - rect.top) / H);
    } else {
      // idle drift keeps the surface alive on touch screens and when the cursor rests
      target.set(0.55 + 0.25 * Math.sin(time * 0.21), 0.5 + 0.2 * Math.sin(time * 0.17 + 1.3));
    }
    prevMouse.copy(mouse);
    mouse.lerp(target, smooth(4, dt));
    const vx = (mouse.x - prevMouse.x) / dt;
    const vy = (mouse.y - prevMouse.y) / dt;
    vel.x += (vx - vel.x) * smooth(6, dt);
    vel.y += (vy - vel.y) * smooth(6, dt);
    push += (0.35 + Math.min(vel.length() * 0.6, 0.9) - push) * smooth(3, dt);

    const scroll = clamp01(-rect.top / H);
    const u = liquidMat.uniforms;
    u.uTime.value = time;
    u.uMouse.value.copy(mouse);
    u.uVel.value.set(vel.x * 0.12 * (W / H), vel.y * 0.12);
    u.uPush.value = push;
    u.uScroll.value = scroll;

    if (!ringsVisible) return;
    const intro = (now - introStart) / 1000;
    const mx = mouse.x * 2 - 1;
    const my = mouse.y * 2 - 1;
    rings.forEach((ring, i) => {
      const inner = 1 - i / (rings.length - 1);
      const follow = smooth(1.8 + 3 * inner, dt); // inner rings react first: a wave through the set
      ring.rotY += (mx * 0.55 - ring.rotY) * follow;
      ring.rotX += (-my * 0.45 - ring.rotX) * follow;
      const wob = 0.05;
      ring.mesh.rotation.set(
        ring.rotX + Math.sin(time * 0.5 + i * 0.45) * wob + scroll * 0.9,
        ring.rotY + Math.cos(time * 0.4 + i * 0.45) * wob,
        0,
      );
      ring.mesh.position.z = scroll * (i - 5.5) * 30;
      const e = easeOutCubic(clamp01((intro - i * 0.06) / 0.9));
      ring.mesh.scale.setScalar(Math.max(0.001, e));
      ring.mat.uniforms.uOpacity.value = 0.55 * e;
    });
  }

  function draw() {
    renderer.setRenderTarget(rt);
    renderer.render(liquidScene, fsCamera);
    renderer.setRenderTarget(null);
    renderer.clear();
    renderer.render(blitScene, fsCamera);
    if (ringsVisible) renderer.render(ringScene, ringCamera);
  }

  // --- loop
  let raf = 0;
  let running = false;
  let last = 0;
  let inView = true;

  function frame(now) {
    raf = requestAnimationFrame(frame);
    const dt = Math.min(Math.max((now - last) / 1000, 1 / 240), 0.05);
    last = now;
    time += dt;
    update(dt, now);
    draw();
    adaptQuality(dt);
  }

  // Drop the liquid's internal resolution on slow GPUs (down to 35% of CSS pixels).
  function adaptQuality(dt) {
    frameEma += (dt - frameEma) * 0.05;
    if (++framesSinceTune < 90) return;
    framesSinceTune = 0;
    if (frameEma > 1 / 40 && liquidScale > 0.35) {
      liquidScale = Math.max(0.35, liquidScale - 0.1);
      rt.setSize(Math.max(2, Math.round(W * liquidScale)), Math.max(2, Math.round(H * liquidScale)));
    }
  }

  function start() {
    if (running || reduceMotion || !inView) return;
    running = true;
    last = performance.now();
    raf = requestAnimationFrame(frame);
  }
  function stop() {
    running = false;
    cancelAnimationFrame(raf);
  }

  function renderAt(seconds, mx = 0.62, my = 0.55, pushStrength = 0.35) {
    time = seconds;
    mouse.set(mx, my);
    prevMouse.copy(mouse);
    vel.set(0, 0);
    push = pushStrength;
    introStart = -1e9; // rings fully in
    pointer.at = -Infinity;
    target.copy(mouse);
    update(1 / 60, performance.now());
    liquidMat.uniforms.uMouse.value.set(mx, my);
    draw();
  }

  const resizeObserver = new ResizeObserver(() => {
    layout();
    if (!running) draw();
  });
  const viewObserver = new IntersectionObserver(([entry]) => {
    inView = entry.isIntersecting;
    if (inView) start();
    else stop();
  });

  function destroy() {
    stop();
    resizeObserver.disconnect();
    viewObserver.disconnect();
    window.removeEventListener('pointermove', onPointer);
    rings.forEach((ring) => {
      ring.mesh.geometry?.dispose();
      ring.mat.dispose();
    });
    quad.dispose();
    liquidMat.dispose();
    blitMat.dispose();
    rt.dispose();
    renderer.dispose();
    canvas.remove();
    if (hidesSvgRings) document.documentElement.classList.remove('hero-3d-on');
    if (active === controller) active = null;
  }

  canvas.addEventListener('webglcontextlost', (e) => {
    e.preventDefault();
    destroy();
    onFail(new Error('WebGL context lost'));
  });

  const controller = { renderAt, destroy };

  try {
    layout();
    if (reduceMotion) {
      renderAt(18);
    } else {
      update(1 / 60, performance.now());
      draw();
      window.addEventListener('pointermove', onPointer, { passive: true });
    }
  } catch (err) {
    destroy();
    onFail(err);
    return null;
  }

  resizeObserver.observe(banner);
  viewObserver.observe(banner);
  active = controller;
  // Reveal only after the first frame exists, so the poster never flashes to black.
  setTimeout(() => {
    canvas.classList.add('is-ready');
    if (hidesSvgRings) document.documentElement.classList.add('hero-3d-on');
  }, 0);
  start();
  return controller;
}
