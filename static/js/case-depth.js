/**
 * Depth for the case studies: no WebGL, just CSS 3D on the existing layers.
 *
 * Every case is already a stack of layers (background photo, desktop screen, phone,
 * round badge, decorations). With the cursor over a case, the image cards tilt
 * toward it and the layers shift by different amounts, so the stack reads as real
 * depth. While scrolling, near layers move faster than far ones and the phone rolls
 * slightly as it slides out from under the desktop screen. Text never moves.
 *
 * Uses the individual `translate` / `rotate` properties so the existing reveal
 * animation (on `transform`) and the badge's spin keep working untouched.
 */

// depth: how far a layer travels (negative = moves against the cursor, i.e. sits behind);
// tilt: whether the layer is a card that tilts with the cursor.
const LAYERS = [
  ['.design-experience__img-bg', -0.35, true],
  ['.design-experience__img-dots', -0.2, false],
  ['.design-experience__img-dots-2', -0.25, false],
  ['.design-experience__img-dots-mobile', -0.2, false],
  ['.design-experience__img-screen', 0.55, true],
  ['.design-experience__img-mob', 1, true],
  ['.design-experience__img-rose', 0.9, false],
  ['.design-experience__img-icon', 1.3, false],
  ['.design-experience__img-icon-golf', 1.5, false],
  ['.design-experience__img-golf', 1.5, false],
  ['.design-experience__img-decor', 1.2, false],
  ['.design-experience__img-decor-2', 0.8, false],
  ['.design-experience__circle', 1.4, false],
  ['.design-experience__triangle', 1.1, false],
  ['.design-experience__square', 0.8, false],
];

const SHIFT_X = 18; // px at depth 1 with the cursor at the edge of the case
const SHIFT_Y = 14;
const SCROLL_SHIFT = 46; // px at depth 1 when the case is one viewport away from centre
const TILT = 5; // deg
const PHONE_ROLL = 6; // deg

const clamp = (x, a, b) => Math.min(b, Math.max(a, x));
const near = (a, b) => Math.abs(a - b) < 0.002;

let active = null;

/** For visual checks: virtual cursor at (x, y) in -1..1 over case `index`, applied at once. */
export function poseCase(index, x, y) {
  active?.pose(index, x, y);
}

export function initCaseDepth({ reduceMotion = false } = {}) {
  if (reduceMotion || active) return null;
  const sections = [...document.querySelectorAll('.design-experience')];
  if (!sections.length) return null;

  const cases = sections.map((section) => ({
    section,
    layers: LAYERS.flatMap(([selector, depth, tilt]) =>
      [...section.querySelectorAll(selector)].map((el) => {
        el.dataset.depth = depth;
        return { el, depth, tilt, phone: selector.endsWith('img-mob') };
      }),
    ),
    visible: false,
    hover: { x: 0, y: 0 }, // smoothed, -1..1
    scroll: 0, // smoothed, -1..1
    dirty: true,
  }));

  document.documentElement.classList.add('case-depth-on');

  const pointer = { x: -1, y: -1, mouse: false };
  const onPointer = (e) => {
    pointer.x = e.clientX;
    pointer.y = e.clientY;
    pointer.mouse = e.pointerType === 'mouse' || e.pointerType === 'pen';
    wake();
  };
  const onLeave = () => {
    pointer.mouse = false;
    wake();
  };

  function apply(c) {
    const { x, y } = c.hover;
    const s = c.scroll;
    for (const { el, depth, tilt, phone } of c.layers) {
      const tx = x * depth * SHIFT_X;
      const ty = y * depth * SHIFT_Y + s * depth * SCROLL_SHIFT;
      el.style.translate = `${tx.toFixed(2)}px ${ty.toFixed(2)}px`;
      if (!tilt) continue;
      // tilt toward the cursor (+ roll for the phone), as one axis-angle rotation
      const rx = -y * TILT;
      const ry = x * TILT;
      const rz = phone ? -s * PHONE_ROLL : 0;
      const angle = Math.hypot(rx, ry, rz);
      el.style.rotate = angle < 0.01 ? '' : `${(rx / angle).toFixed(4)} ${(ry / angle).toFixed(4)} ${(rz / angle).toFixed(4)} ${angle.toFixed(3)}deg`;
    }
  }

  function reset(c) {
    for (const { el } of c.layers) {
      el.style.translate = '';
      el.style.rotate = '';
    }
  }

  let raf = 0;
  let last = 0;
  function frame(now) {
    const dt = Math.min(Math.max((now - last) / 1000, 1 / 240), 0.05);
    last = now;
    const vh = window.innerHeight;
    let moving = false;
    for (const c of cases) {
      if (!c.visible) continue;
      const r = c.section.getBoundingClientRect();
      let hx = 0;
      let hy = 0;
      if (pointer.mouse && pointer.x >= r.left && pointer.x <= r.right && pointer.y >= r.top && pointer.y <= r.bottom) {
        hx = clamp(((pointer.x - r.left) / r.width) * 2 - 1, -1, 1);
        hy = clamp(((pointer.y - r.top) / r.height) * 2 - 1, -1, 1);
      }
      const sTarget = clamp((r.top + r.height / 2 - vh / 2) / vh, -1, 1);
      const kHover = 1 - Math.exp(-7 * dt);
      const kScroll = 1 - Math.exp(-12 * dt);
      const nx = c.hover.x + (hx - c.hover.x) * kHover;
      const ny = c.hover.y + (hy - c.hover.y) * kHover;
      const ns = c.scroll + (sTarget - c.scroll) * kScroll;
      const changed = c.dirty || !near(nx, c.hover.x) || !near(ny, c.hover.y) || !near(ns, c.scroll);
      c.hover.x = near(nx, hx) ? hx : nx;
      c.hover.y = near(ny, hy) ? hy : ny;
      c.scroll = near(ns, sTarget) ? sTarget : ns;
      if (changed) {
        apply(c);
        c.dirty = false;
        moving = true;
      }
    }
    raf = moving ? requestAnimationFrame(frame) : 0;
  }

  function wake() {
    if (raf) return;
    last = performance.now();
    raf = requestAnimationFrame(frame);
  }

  const observer = new IntersectionObserver(
    (entries) => {
      for (const entry of entries) {
        const c = cases.find((k) => k.section === entry.target);
        if (!c) continue;
        c.visible = entry.isIntersecting;
        if (c.visible) {
          // start from the current scroll position, without easing in from 0
          const r = c.section.getBoundingClientRect();
          c.scroll = clamp((r.top + r.height / 2 - window.innerHeight / 2) / window.innerHeight, -1, 1);
          c.dirty = true;
        } else {
          reset(c);
        }
      }
      wake();
    },
    { rootMargin: '200px 0px' },
  );
  cases.forEach((c) => observer.observe(c.section));

  window.addEventListener('pointermove', onPointer, { passive: true });
  document.documentElement.addEventListener('pointerleave', onLeave);
  window.addEventListener('scroll', wake, { passive: true });
  window.addEventListener('resize', wake);

  active = {
    destroy() {
      cancelAnimationFrame(raf);
      observer.disconnect();
      window.removeEventListener('pointermove', onPointer);
      document.documentElement.removeEventListener('pointerleave', onLeave);
      window.removeEventListener('scroll', wake);
      window.removeEventListener('resize', wake);
      cases.forEach(reset);
      cases.forEach((c) => c.layers.forEach(({ el }) => delete el.dataset.depth));
      document.documentElement.classList.remove('case-depth-on');
      active = null;
    },
    pose(i, x, y) {
      const c = cases[i];
      if (!c) return;
      const r = c.section.getBoundingClientRect();
      c.hover.x = x;
      c.hover.y = y;
      c.scroll = clamp((r.top + r.height / 2 - window.innerHeight / 2) / window.innerHeight, -1, 1);
      apply(c);
    },
  };
  return active;
}
