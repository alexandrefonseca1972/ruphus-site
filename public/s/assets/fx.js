/* ============================================================
   Camada 3D + animações compartilhadas — otimizada para mobile
   ============================================================ */

const IS_TOUCH = matchMedia('(hover: none), (pointer: coarse)').matches;
const REDUCED  = matchMedia('(prefers-reduced-motion: reduce)').matches;
const SMALL    = matchMedia('(max-width: 768px)').matches;

/* ---------- 1. Canvas 3D (Three.js) ---------- */
function init3D(canvasId, colorHex, opts) {
  const canvas = document.getElementById(canvasId);
  if (!canvas || typeof THREE === 'undefined' || REDUCED) return;
  const o = Object.assign({
    shapes: SMALL ? 7 : 14,        // menos formas no celular
    opacity: .5, spread: 14
  }, opts || {});

  const renderer = new THREE.WebGLRenderer({ canvas, alpha: true, antialias: !SMALL, powerPreference: 'low-power' });
  renderer.setPixelRatio(Math.min(devicePixelRatio, SMALL ? 1.5 : 2)); // poupa GPU
  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(55, 1, .1, 100);
  camera.position.z = 16;

  const light1 = new THREE.DirectionalLight(0xffffff, 1.6);
  light1.position.set(4, 6, 8);
  scene.add(light1, new THREE.AmbientLight(0xffffff, .7));

  const color = new THREE.Color(colorHex);
  const geos = [
    new THREE.IcosahedronGeometry(1, 0),
    new THREE.TorusGeometry(.8, .28, 24, 48),
    new THREE.OctahedronGeometry(1, 0),
    new THREE.TorusKnotGeometry(.6, .2, 64, 12),
  ];
  const meshes = [];
  for (let i = 0; i < o.shapes; i++) {
    const g = geos[i % geos.length];
    const m = new THREE.MeshStandardMaterial({ color, metalness: .35, roughness: .35, transparent: true, opacity: o.opacity });
    const mesh = new THREE.Mesh(g, m);
    mesh.position.set((Math.random()-.5)*o.spread*2.2, (Math.random()-.5)*o.spread, (Math.random()-.5)*8-2);
    mesh.scale.setScalar(.3 + Math.random()*.8);
    mesh.userData = { rx:(Math.random()-.5)*.012, ry:(Math.random()-.5)*.012,
                      fy:Math.random()*Math.PI*2, fs:.3+Math.random()*.5, baseY:mesh.position.y };
    scene.add(mesh); meshes.push(mesh);
  }

  let mx = 0, my = 0;
  if (!IS_TOUCH) {
    addEventListener('pointermove', e => {
      mx = (e.clientX/innerWidth - .5)*2; my = (e.clientY/innerHeight - .5)*2;
    }, { passive: true });
  }

  /* Pausa quando fora da tela — economia de bateria */
  let running = true;
  new IntersectionObserver(es => { running = es[0].isIntersecting; }).observe(canvas);
  document.addEventListener('visibilitychange', () => { running = !document.hidden && running; });

  function resize() {
    const w = canvas.clientWidth, h = canvas.clientHeight;
    if (canvas.width !== w || canvas.height !== h) {
      renderer.setSize(w, h, false);
      camera.aspect = w/h; camera.updateProjectionMatrix();
    }
  }

  let t = 0;
  (function loop() {
    requestAnimationFrame(loop);
    if (!running) return;
    resize(); t += .016;
    meshes.forEach(m => {
      m.rotation.x += m.userData.rx; m.rotation.y += m.userData.ry;
      m.position.y = m.userData.baseY + Math.sin(t*m.userData.fs + m.userData.fy)*.7;
    });
    camera.position.x += (mx*2.2 - camera.position.x)*.04;
    camera.position.y += (-my*1.4 - camera.position.y)*.04;
    camera.lookAt(scene.position);
    renderer.render(scene, camera);
  })();
}

/* ---------- 2. Tilt 3D + glare (somente desktop com hover) ---------- */
function initTilt(selector) {
  if (IS_TOUCH || REDUCED) return; // touch não tem hover: evita "trava" visual
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

/* ---------- 3. Parallax (desativado em telas pequenas) ---------- */
function initParallax() {
  if (SMALL || REDUCED) return; // mobile: sem parallax = scroll suave
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
