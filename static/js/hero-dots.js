/**
 * The dot grids next to the hero title (grain.svg) come alive like the sand below:
 * the cursor pushes dots aside and swirls them around itself, and they spring back.
 * When nothing happens, a faint ripple runs through the grid every few seconds.
 *
 * Canvas 2D only (no WebGL): each grid is ~480 dots read from grain.svg, so the
 * look at rest is identical to the original background image.
 */
const PAD = 32; // room around the grid so pushed dots are not clipped
const SPRING = 12; // stiffer than the sand: the grid should tidy itself up quickly
const DAMPING = 7;
const REACH = 70;
const PUSH = 2400;
const SWIRL = 900;
const DRAG = 3.5;
const RIPPLE_EVERY = 9; // s
const RIPPLE_SPEED = 240; // px/s
const RIPPLE_WIDTH = 26; // px
const RIPPLE_AMP = 2.2; // px

const clamp = (x, a, b) => Math.min(b, Math.max(a, x));

let active = null;

/** For visual checks: push the dots toward/around a point in viewport pixels for n frames, then draw. */
export function stirDots(frames, clientX, clientY) {
  active?.stir(frames, clientX, clientY);
}

export async function initHeroDots({ banner, reduceMotion = false } = {}) {
  if (active || reduceMotion || !banner) return null;
  const blocks = [...banner.querySelectorAll('.grain')];
  if (!blocks.length) return null;

  const url = (getComputedStyle(blocks[0]).backgroundImage.match(/url\(["']?(.*?)["']?\)/) || [])[1];
  if (!url) return null;
  const svg = await fetch(url).then((r) => r.text());
  const R = 0.85; // dot radius in the SVG
  const dots = [...svg.matchAll(/M([\d.]+) ([\d.]+)C/g)].map((m) => [+m[1], +m[2] - 0.858597]);
  const alpha = parseFloat((svg.match(/<g opacity="([\d.]+)"/) || [])[1] || '0.2');
  if (!dots.length) return null;

  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  const grids = blocks.map((block) => {
    const w = block.clientWidth || 195;
    const h = block.clientHeight || 214;
    const canvas = document.createElement('canvas');
    canvas.className = 'grain-canvas';
    canvas.setAttribute('aria-hidden', 'true');
    canvas.width = Math.round((w + PAD * 2) * dpr);
    canvas.height = Math.round((h + PAD * 2) * dpr);
    block.appendChild(canvas);
    block.classList.add('is-live');
    const ctx = canvas.getContext('2d');
    const n = dots.length;
    const home = new Float32Array(n * 2);
    dots.forEach(([x, y], i) => {
      home[i * 2] = x + PAD;
      home[i * 2 + 1] = y + PAD;
    });
    return { block, canvas, ctx, n, home, pos: home.slice(), vel: new Float32Array(n * 2), awake: true };
  });

  function draw(g, ripple) {
    const { ctx, canvas, n, pos } = g;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.fillStyle = `rgba(255, 255, 255, ${alpha})`;
    ctx.beginPath();
    for (let i = 0; i < n; i++) {
      let x = pos[i * 2];
      let y = pos[i * 2 + 1];
      if (ripple) {
        // a ring travelling outward from the ripple origin nudges dots along its radius
        const dx = x - ripple.x;
        const dy = y - ripple.y;
        const d = Math.hypot(dx, dy) + 0.001;
        const k = (d - ripple.front) / RIPPLE_WIDTH;
        const off = Math.exp(-k * k) * RIPPLE_AMP * ripple.fade;
        x += (dx / d) * off;
        y += (dy / d) * off;
      }
      ctx.moveTo(x + R, y);
      ctx.arc(x, y, R, 0, Math.PI * 2);
    }
    ctx.fill();
  }

  // One physics step for one grid; (cx, cy) = cursor in the grid's canvas pixels.
  function step(g, dt, cx, cy, vx, vy, strength) {
    const { n, pos, vel, home } = g;
    const damp = Math.exp(-DAMPING * dt);
    const R2 = REACH * REACH;
    let energy = 0;
    for (let i = 0; i < n; i++) {
      const ix = i * 2;
      const iy = ix + 1;
      let x = pos[ix];
      let y = pos[iy];
      let ax = (home[ix] - x) * SPRING;
      let ay = (home[iy] - y) * SPRING;
      const dx = x - cx;
      const dy = y - cy;
      const d2 = dx * dx + dy * dy;
      if (strength && d2 < R2) {
        const d = Math.sqrt(d2) + 0.001;
        const f = 1 - d / REACH;
        const f2 = f * f;
        ax += ((dx / d) * PUSH * strength - (dy / d) * SWIRL + vx * DRAG) * f2;
        ay += ((dy / d) * PUSH * strength + (dx / d) * SWIRL + vy * DRAG) * f2;
      }
      const nvx = (vel[ix] + ax * dt) * damp;
      const nvy = (vel[iy] + ay * dt) * damp;
      x += nvx * dt;
      y += nvy * dt;
      pos[ix] = x;
      pos[iy] = y;
      vel[ix] = nvx;
      vel[iy] = nvy;
      energy += Math.abs(nvx) + Math.abs(nvy) + Math.abs(home[ix] - x) + Math.abs(home[iy] - y);
    }
    return energy / n;
  }

  // --- input and loop
  const pointer = { x: -1e5, y: -1e5, at: -Infinity, mouse: false };
  const smoothed = { x: -1e5, y: -1e5, vx: 0, vy: 0 };
  const onPointer = (e) => {
    pointer.x = e.clientX;
    pointer.y = e.clientY;
    pointer.at = performance.now();
    pointer.mouse = e.pointerType !== 'touch';
    wake();
  };

  let inView = true;
  let raf = 0;
  let last = 0;
  let quietSince = performance.now();
  let ripple = null;
  let rippleIndex = 0;

  function frame(now) {
    const dt = Math.min(Math.max((now - last) / 1000, 1 / 240), 1 / 30);
    last = now;
    if (!inView) {
      raf = 0;
      return;
    }

    const recent = now - pointer.at < (pointer.mouse ? 6000 : 500);
    if (recent) {
      if (smoothed.x < -1e4) {
        smoothed.x = pointer.x;
        smoothed.y = pointer.y;
      }
      const k = 1 - Math.exp(-16 * dt);
      const nx = smoothed.x + (pointer.x - smoothed.x) * k;
      const ny = smoothed.y + (pointer.y - smoothed.y) * k;
      smoothed.vx = (nx - smoothed.x) / dt;
      smoothed.vy = (ny - smoothed.y) / dt;
      smoothed.x = nx;
      smoothed.y = ny;
      quietSince = now;
    } else {
      smoothed.x = -1e5;
      smoothed.y = -1e5;
      smoothed.vx = 0;
      smoothed.vy = 0;
    }

    // idle ripple through one of the grids
    if (!ripple && now - quietSince > RIPPLE_EVERY * 1000) {
      const visible = grids.filter((g) => g.block.getClientRects().length);
      const g = visible[rippleIndex++ % Math.max(1, visible.length)];
      if (g) {
        const corner = rippleIndex % 2;
        ripple = { grid: g, x: corner ? PAD : g.canvas.width / dpr - PAD, y: corner ? PAD : g.canvas.height / dpr - PAD, t0: now, front: 0, fade: 1 };
      }
      quietSince = now;
    }
    if (ripple) {
      const t = (now - ripple.t0) / 1000;
      ripple.front = t * RIPPLE_SPEED;
      ripple.fade = clamp(1.6 - t, 0, 1);
      if (ripple.fade <= 0) {
        draw(ripple.grid, null); // leave the grid exactly at rest
        ripple = null;
      }
    }

    let moving = !!ripple;
    for (const g of grids) {
      if (!g.block.getClientRects().length) continue;
      const r = g.canvas.getBoundingClientRect();
      const cx = smoothed.x - r.left;
      const cy = smoothed.y - r.top;
      const near = recent && cx > -REACH && cy > -REACH && cx < r.width + REACH && cy < r.height + REACH;
      if (near) g.awake = true;
      if (g.awake) {
        const speed = Math.hypot(smoothed.vx, smoothed.vy);
        const strength = near ? 0.4 + Math.min(speed / 600, 1.1) : 0;
        const energy = step(g, dt, cx, cy, smoothed.vx, smoothed.vy, strength);
        if (energy < 0.02 && !near) g.awake = false;
      }
      if (g.awake || ripple?.grid === g) draw(g, ripple?.grid === g ? ripple : null);
      moving ||= g.awake;
    }
    // keep a slow tick going so the next idle ripple can start
    raf = moving ? requestAnimationFrame(frame) : 0;
    if (!raf) idleTimer = setTimeout(wake, 1000);
  }

  let idleTimer = 0;
  function wake() {
    clearTimeout(idleTimer);
    if (raf || !inView) return;
    last = performance.now();
    raf = requestAnimationFrame(frame);
  }

  const viewObserver = new IntersectionObserver(([entry]) => {
    inView = entry.isIntersecting;
    if (inView) wake();
  });
  viewObserver.observe(banner);
  window.addEventListener('pointermove', onPointer, { passive: true });
  grids.forEach((g) => draw(g, null));
  wake();

  active = {
    stir(frames, clientX, clientY) {
      for (const g of grids) {
        if (!g.block.getClientRects().length) continue;
        const r = g.canvas.getBoundingClientRect();
        for (let f = 0; f < frames; f++) step(g, 1 / 60, clientX - r.left, clientY - r.top, 0, 0, 1);
        draw(g, null);
      }
    },
    destroy() {
      cancelAnimationFrame(raf);
      clearTimeout(idleTimer);
      viewObserver.disconnect();
      window.removeEventListener('pointermove', onPointer);
      grids.forEach((g) => {
        g.canvas.remove();
        g.block.classList.remove('is-live');
      });
      active = null;
    },
  };
  return active;
}
