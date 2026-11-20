/**
 * Main buttons lean slightly toward a nearby cursor (at most 7px), in the same spirit
 * as the rest of the page reacting to the pointer. Mouse/pen only; off with reduced motion.
 *
 * Uses the individual `translate` property, so the CSS hover lift (on `transform`) still applies.
 */
const TARGETS = '.design-experience-text a, .description-links .contact-btn';
const REACH = 28; // px around the button where the pull starts
const MAX_X = 7;
const MAX_Y = 5;

const clamp = (x, a, b) => Math.min(b, Math.max(a, x));

let active = null;

/** For visual checks: pull button `index` toward a point given in viewport pixels. */
export function pullButton(index, clientX, clientY) {
  active?.pull(index, clientX, clientY);
}

export function initButtonMagnet({ reduceMotion = false } = {}) {
  if (active || reduceMotion || !window.matchMedia('(hover: hover) and (pointer: fine)').matches) return null;
  const items = [...document.querySelectorAll(TARGETS)].map((el) => ({ el, x: 0, y: 0, tx: 0, ty: 0, visible: false }));
  if (!items.length) return null;

  const pointer = { x: -1e5, y: -1e5 };

  function targetFor(item, px, py) {
    const r = item.el.getBoundingClientRect();
    const inside = px > r.left - REACH && px < r.right + REACH && py > r.top - REACH && py < r.bottom + REACH;
    if (!inside) {
      item.tx = 0;
      item.ty = 0;
      return;
    }
    item.tx = clamp((px - (r.left + r.width / 2)) * 0.22, -MAX_X, MAX_X);
    item.ty = clamp((py - (r.top + r.height / 2)) * 0.3, -MAX_Y, MAX_Y);
  }

  let raf = 0;
  let last = 0;
  function frame(now) {
    const dt = Math.min(Math.max((now - last) / 1000, 1 / 240), 0.05);
    last = now;
    const k = 1 - Math.exp(-12 * dt);
    let moving = false;
    for (const item of items) {
      if (!item.visible && item.x === 0 && item.y === 0) continue;
      item.x += (item.tx - item.x) * k;
      item.y += (item.ty - item.y) * k;
      if (Math.abs(item.tx - item.x) < 0.05 && Math.abs(item.ty - item.y) < 0.05) {
        item.x = item.tx;
        item.y = item.ty;
      } else {
        moving = true;
      }
      item.el.style.translate = item.x || item.y ? `${item.x.toFixed(2)}px ${item.y.toFixed(2)}px` : '';
    }
    raf = moving ? requestAnimationFrame(frame) : 0;
  }
  function wake() {
    if (raf) return;
    last = performance.now();
    raf = requestAnimationFrame(frame);
  }

  const onPointer = (e) => {
    if (e.pointerType === 'touch') return;
    pointer.x = e.clientX;
    pointer.y = e.clientY;
    for (const item of items) if (item.visible) targetFor(item, pointer.x, pointer.y);
    wake();
  };
  const release = () => {
    for (const item of items) {
      item.tx = 0;
      item.ty = 0;
    }
    wake();
  };

  const observer = new IntersectionObserver((entries) => {
    for (const entry of entries) {
      const item = items.find((i) => i.el === entry.target);
      if (!item) continue;
      item.visible = entry.isIntersecting;
      if (!item.visible) {
        item.tx = 0;
        item.ty = 0;
      }
    }
    wake();
  });
  items.forEach((item) => observer.observe(item.el));
  window.addEventListener('pointermove', onPointer, { passive: true });
  document.documentElement.addEventListener('pointerleave', release);
  window.addEventListener('scroll', release, { passive: true });

  active = {
    pull(index, x, y) {
      const item = items[index];
      if (!item) return;
      targetFor(item, x, y);
      item.x = item.tx;
      item.y = item.ty;
      item.el.style.translate = item.x || item.y ? `${item.x.toFixed(2)}px ${item.y.toFixed(2)}px` : '';
    },
    destroy() {
      cancelAnimationFrame(raf);
      observer.disconnect();
      window.removeEventListener('pointermove', onPointer);
      document.documentElement.removeEventListener('pointerleave', release);
      window.removeEventListener('scroll', release);
      items.forEach((item) => (item.el.style.translate = ''));
      active = null;
    },
  };
  return active;
}
