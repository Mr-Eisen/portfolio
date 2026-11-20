/**
 * Loads the WebGL effects (three.js) only where they can run:
 * - hero: live liquid + 3D rings (hero-3d.js); falls back to the background video;
 * - "PORTFOLIO" title: the glow turns into sand that reacts to the cursor (portfolio-sand.js),
 *   loaded when the section gets near the viewport; without it the section stays as designed;
 * - case studies: CSS 3D depth on the existing layers (case-depth.js); no WebGL needed.
 * With "reduce motion" both effects render a single still frame, and the hero
 * fallback shows the poster only.
 */
const banner = document.querySelector('.banner');
const video = document.getElementById('background-video');
const portfolioTitle = document.querySelector('.portfolio-title-static');
const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

function startVideo() {
  const source = video?.querySelector('source[data-src]');
  if (!source || reduceMotion || source.hasAttribute('src')) return;
  source.src = source.dataset.src;
  video.load();
  video.play().catch(() => {});
}

function hasWebGL2() {
  try {
    const gl = document.createElement('canvas').getContext('webgl2');
    gl?.getExtension('WEBGL_lose_context')?.loseContext();
    return !!gl;
  } catch {
    return false;
  }
}

const webgl2 = hasWebGL2();

if (banner && webgl2) {
  import('./hero-3d.js')
    .then(({ initHero3D }) => {
      const hero = initHero3D({
        banner,
        rings: banner.querySelector('.banner-top svg'),
        reduceMotion,
        onFail: startVideo,
      });
      if (!hero) startVideo();
    })
    .catch(startVideo);
} else {
  startVideo();
}

if (portfolioTitle && webgl2) {
  const near = new IntersectionObserver(
    ([entry]) => {
      if (!entry.isIntersecting) return;
      near.disconnect();
      import('./portfolio-sand.js')
        .then(({ initPortfolioSand }) => initPortfolioSand({ section: portfolioTitle, reduceMotion }))
        .catch(() => {}); // the section stays as designed
    },
    { rootMargin: '600px 0px' },
  );
  near.observe(portfolioTitle);
}

if (document.querySelector('.design-experience')) {
  import('./case-depth.js')
    .then(({ initCaseDepth }) => initCaseDepth({ reduceMotion }))
    .catch(() => {}); // the cases keep their original animation
}
