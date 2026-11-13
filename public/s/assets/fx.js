/* Efeitos leves compartilhados; desativados no touch e com movimento reduzido. */
const IS_TOUCH = matchMedia('(hover: none), (pointer: coarse)').matches;
const REDUCED = matchMedia('(prefers-reduced-motion: reduce)').matches;
const SMALL = matchMedia('(max-width: 768px)').matches;

function initTilt(selector) {
  if (IS_TOUCH || REDUCED) return;
  document.querySelectorAll(selector).forEach(card => {
    const glare = card.querySelector('.glare');
    const base = getComputedStyle(card).transform;
    const baseT = base && base !== 'none' ? base + ' ' : '';
    card.addEventListener('pointermove', e => {
      const r = card.getBoundingClientRect();
      const px = (e.clientX-r.left)/r.width, py = (e.clientY-r.top)/r.height;
      const rx = (py-.5)*-14, ry = (px-.5)*14;
      card.style.transform = `${baseT}perspective(900px) rotateX(${rx}deg) rotateY(${ry}deg) translateZ(12px)`;
      if (glare) {
        glare.style.opacity = 1;
        glare.style.background = `radial-gradient(circle at ${px*100}% ${py*100}%, rgba(255,255,255,.32), transparent 55%)`;
      }
    });
    card.addEventListener('pointerleave', () => {
      card.style.transform = `${baseT}perspective(900px) rotateX(0) rotateY(0) translateZ(0)`;
      if (glare) glare.style.opacity = 0;
    });
  });
}

function initParallax() {
  if (SMALL || REDUCED) return;
  const els = [...document.querySelectorAll('[data-plx]')];
  if (!els.length) return;
  const io = new IntersectionObserver(es => es.forEach(e => e.target.dataset.on = e.isIntersecting ? '1' : '0'));
  els.forEach(el => io.observe(el));
  function tick() {
    const vh = innerHeight;
    els.forEach(el => {
      if (el.dataset.on === '0') return;
      const r = el.getBoundingClientRect();
      const prog = (r.top + r.height/2 - vh/2) / vh;
      el.style.transform = `translate3d(0, ${(-prog * (parseFloat(el.dataset.plx)||40)).toFixed(1)}px, 0)`;
    });
    requestAnimationFrame(tick);
  }
  tick();
}

document.addEventListener('DOMContentLoaded', () => {
  try { initTilt('.tilt'); } catch(e) {}
  try { initParallax(); } catch(e) {}
});
