/**
 * Chooses how the hero background is drawn:
 * - live WebGL liquid + 3D rings (hero-3d.js, loads three.js) when WebGL2 is available;
 * - otherwise, or if anything fails, the original background video.
 * With "reduce motion" the 3D hero renders a single still frame, and the fallback shows the poster only.
 */
const banner = document.querySelector('.banner');
const video = document.getElementById('background-video');
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

if (banner && hasWebGL2()) {
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
