/* hero-animation.js  |  "Silk Topography"
   Draws on <canvas id="bg"> inside .hero-section.
   A slowly evolving terrain is rendered as soft, glowing gradient ribbons
   (no hard lines), lit from one side for a sense of depth, with a bloom halo.
   The cursor raises a soft hill that the ribbons flow around, and tiny lights
   drift along the ribbons. The text area stays calm and readable. */
(() => {
  'use strict';

  /* ================= SETTINGS (safe to tweak) ================= */
  const SPEED = 1;                       // global motion speed (0.5 = half)

  const BG_CENTER = '#01131F';
  const BG_EDGE   = '#02060C';
  const LOW    = [36, 100, 200];         // ribbon colour in the low areas (r,g,b)
  const HIGH   = [150, 226, 242];        // ribbon colour on the high areas
  const ACCENT = [110, 225, 215];        // faint teal that drifts through the ribbons

  // Terrain + ribbons
  const FLOW         = 0.000040;         // how fast the terrain evolves (lower = calmer)
  const WARP         = 0.60;             // how swirly / organic the shapes are
  const BAND_COUNT   = 4.0;              // ribbons per unit of terrain height (higher = more ribbons)
  const BAND_DRIFT   = 0.000025;         // how fast ribbons slowly glide across the terrain
  const RIDGE_SHARP  = 2.4;              // lower = softer, wider ribbons; higher = thinner
  const RIDGE_ALPHA  = 0.55;             // brightness of the ribbons
  const WASH_ALPHA   = 0.16;             // brightness of the broad gradient between ribbons
  const LIGHT        = 0.55;             // 3D shading strength (0 = flat)
  const BLOOM        = 0.55;             // glow halo strength (0 = off)

  // Cursor
  const CURSOR_RADIUS = 200;             // size of the hill under the cursor (px)
  const CURSOR_HEIGHT = 0.80;            // how tall the hill is
  const CURSOR_LIGHT  = 0.50;            // how much the ribbons brighten near the cursor
  const PARALLAX      = 14;              // px the terrain shifts with the cursor

  // Tiny lights that ride the ribbons (set to 0 to remove)
  const MOTE_COUNT = 36;
  const MOTE_COUNT_MOBILE = 18;

  // Text protection
  const QUIET_MIN  = 0.30;               // how visible the ribbons stay directly behind text
  const QUIET_PAD  = 10;                 // clear margin around text (px)
  const QUIET_FADE = 260;                // distance over which ribbons fade back in (px)

  const FIELD_MS = 32;                   // terrain refresh interval (ms). 0 = every frame

  // Ambient light blobs (x, y, radius as fractions of the screen)
  const GLOWS = [
    { x: 0.06, y: 0.95, r: 0.50, c: '40, 120, 190', a: 0.13, p: 0 },
    { x: 0.96, y: 0.05, r: 0.45, c: '50, 150, 180', a: 0.10, p: 2 },
    { x: 0.90, y: 0.88, r: 0.38, c: '70, 110, 200', a: 0.07, p: 4 }
  ];

  /* ================= SETUP ================= */
  const canvas = document.getElementById('bg');
  const hero = document.querySelector('.hero-section');
  if (!canvas || !hero) return;
  const ctx = canvas.getContext('2d');

  const TAU = Math.PI * 2;
  const rand = (a, b) => a + Math.random() * (b - a);
  const clamp01 = v => Math.max(0, Math.min(1, v));
  const smooth = v => { v = clamp01(v); return v * v * (3 - 2 * v); };

  const reduce = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  let W = 0, H = 0, scale = 0.0029;
  let clock = reduce ? 9000 : 0;         // own clock (ms), only advances while visible
  let intro = 0;
  let quiet = [];
  let motes = [];
  const cursor = { x: 0, y: 0, tx: 0, ty: 0, k: 0, amp: 0, px: 0, py: 0, inside: false };

  /* ================= SIMPLEX NOISE (3D) ================= */
  const grad3 = new Float32Array([
    1, 1, 0, -1, 1, 0, 1, -1, 0, -1, -1, 0,
    1, 0, 1, -1, 0, 1, 1, 0, -1, -1, 0, -1,
    0, 1, 1, 0, -1, 1, 0, 1, -1, 0, -1, -1
  ]);
  const perm = new Uint8Array(512), pm12 = new Uint8Array(512);
  (function () {
    const p = new Uint8Array(256);
    for (let i = 0; i < 256; i++) p[i] = i;
    let s = 1337;
    for (let i = 255; i > 0; i--) {
      s = (s * 1664525 + 1013904223) >>> 0;
      const j = s % (i + 1);
      const t = p[i]; p[i] = p[j]; p[j] = t;
    }
    for (let i = 0; i < 512; i++) { perm[i] = p[i & 255]; pm12[i] = perm[i] % 12; }
  })();

  function noise3(x, y, z) {
    const F3 = 1 / 3, G3 = 1 / 6;
    const s = (x + y + z) * F3;
    const i = Math.floor(x + s), j = Math.floor(y + s), k = Math.floor(z + s);
    const t = (i + j + k) * G3;
    const x0 = x - (i - t), y0 = y - (j - t), z0 = z - (k - t);
    let i1, j1, k1, i2, j2, k2;
    if (x0 >= y0) {
      if (y0 >= z0) { i1 = 1; j1 = 0; k1 = 0; i2 = 1; j2 = 1; k2 = 0; }
      else if (x0 >= z0) { i1 = 1; j1 = 0; k1 = 0; i2 = 1; j2 = 0; k2 = 1; }
      else { i1 = 0; j1 = 0; k1 = 1; i2 = 1; j2 = 0; k2 = 1; }
    } else {
      if (y0 < z0) { i1 = 0; j1 = 0; k1 = 1; i2 = 0; j2 = 1; k2 = 1; }
      else if (x0 < z0) { i1 = 0; j1 = 1; k1 = 0; i2 = 0; j2 = 1; k2 = 1; }
      else { i1 = 0; j1 = 1; k1 = 0; i2 = 1; j2 = 1; k2 = 0; }
    }
    const x1 = x0 - i1 + G3, y1 = y0 - j1 + G3, z1 = z0 - k1 + G3;
    const x2 = x0 - i2 + 2 * G3, y2 = y0 - j2 + 2 * G3, z2 = z0 - k2 + 2 * G3;
    const x3 = x0 - 1 + 3 * G3, y3 = y0 - 1 + 3 * G3, z3 = z0 - 1 + 3 * G3;
    const ii = i & 255, jj = j & 255, kk = k & 255;
    let n0 = 0, n1 = 0, n2 = 0, n3 = 0, gi;
    let t0 = 0.6 - x0 * x0 - y0 * y0 - z0 * z0;
    if (t0 > 0) {
      gi = pm12[ii + perm[jj + perm[kk]]] * 3; t0 *= t0;
      n0 = t0 * t0 * (grad3[gi] * x0 + grad3[gi + 1] * y0 + grad3[gi + 2] * z0);
    }
    let t1 = 0.6 - x1 * x1 - y1 * y1 - z1 * z1;
    if (t1 > 0) {
      gi = pm12[ii + i1 + perm[jj + j1 + perm[kk + k1]]] * 3; t1 *= t1;
      n1 = t1 * t1 * (grad3[gi] * x1 + grad3[gi + 1] * y1 + grad3[gi + 2] * z1);
    }
    let t2 = 0.6 - x2 * x2 - y2 * y2 - z2 * z2;
    if (t2 > 0) {
      gi = pm12[ii + i2 + perm[jj + j2 + perm[kk + k2]]] * 3; t2 *= t2;
      n2 = t2 * t2 * (grad3[gi] * x2 + grad3[gi + 1] * y2 + grad3[gi + 2] * z2);
    }
    let t3 = 0.6 - x3 * x3 - y3 * y3 - z3 * z3;
    if (t3 > 0) {
      gi = pm12[ii + 1 + perm[jj + 1 + perm[kk + 1]]] * 3; t3 *= t3;
      n3 = t3 * t3 * (grad3[gi] * x3 + grad3[gi + 1] * y3 + grad3[gi + 2] * z3);
    }
    return 32 * (n0 + n1 + n2 + n3);
  }

  /* ================= TERRAIN ================= */
  let tz = 0;          // terrain time
  let phaseT = 0;      // slow ribbon glide
  const CURSOR_REACH2 = (CURSOR_RADIUS * 3) * (CURSOR_RADIUS * 3);

  // Height of the terrain at a point (domain-warped noise = organic swirls)
  function terrain(x, y) {
    const sx = x * scale, sy = y * scale;
    const wx = noise3(sx * 0.7 + 11.3, sy * 0.7, tz * 0.7);
    const wy = noise3(sx * 0.7, sy * 0.7 + 27.1, tz * 0.7 + 5.2);
    const px = sx + wx * WARP, py = sy + wy * WARP;
    return noise3(px, py, tz) * 0.66 + noise3(px * 2.2 + 7.7, py * 2.2, tz * 1.5 + 3.1) * 0.26;
  }

  // The soft hill under the cursor
  function bump(x, y) {
    if (cursor.amp < 0.01) return 0;
    const dx = x - cursor.x, dy = y - cursor.y, d2 = dx * dx + dy * dy;
    if (d2 > CURSOR_REACH2) return 0;
    return cursor.amp * Math.exp(-d2 / (2 * CURSOR_RADIUS * CURSOR_RADIUS));
  }

  const sampleField = (x, y) => terrain(x, y) + bump(x, y);
  const ridgeAt = f => Math.pow(0.5 + 0.5 * Math.cos(TAU * (f * BAND_COUNT - phaseT)), RIDGE_SHARP);

  /* ================= TEXTURE (the glowing ribbons) ================= */
  // The terrain is sampled on a coarse grid, turned into soft ribbons of light in a
  // small image, then scaled up smoothly. Scaling is what makes everything silky.
  const MARGIN = 28;                     // extra texture around the screen (for parallax)
  const off = document.createElement('canvas');
  const offCtx = off.getContext('2d');
  const bloomCv = document.createElement('canvas');
  const bloomCtx = bloomCv.getContext('2d');
  let res = 10, tuned = false;
  let gw = 0, gh = 0, F = new Float32Array(1), Bm = new Float32Array(1), maskG = new Float32Array(1), img = null;
  let fieldAcc = 1e9;

  function buildGrid() {
    if (!tuned) res = W < 768 ? 8 : Math.max(8, Math.min(14, Math.round(W / 190)));
    gw = Math.ceil((W + 2 * MARGIN) / res) + 1;
    gh = Math.ceil((H + 2 * MARGIN) / res) + 1;
    F = new Float32Array(gw * gh);
    Bm = new Float32Array(gw * gh);
    maskG = new Float32Array(gw * gh);
    off.width = gw; off.height = gh;
    img = offCtx.createImageData(gw, gh);
    bloomCv.width = Math.max(2, Math.ceil(gw / 3));
    bloomCv.height = Math.max(2, Math.ceil(gh / 3));
    buildMask();
    fieldAcc = 1e9;
  }

  // Per-pixel visibility: dimmed behind the heading and paragraph
  function buildMask() {
    if (!maskG.length || !gw) return;
    let n = 0;
    for (let j = 0; j < gh; j++) {
      const y = -MARGIN + j * res;
      for (let i = 0; i < gw; i++) {
        const x = -MARGIN + i * res;
        maskG[n++] = QUIET_MIN + (1 - QUIET_MIN) * quietMask(x, y);
      }
    }
  }

  function updateTexture() {
    const data = img.data;
    const x0 = -MARGIN, y0 = -MARGIN;
    let n = 0;
    for (let j = 0; j < gh; j++) {
      const y = y0 + j * res;
      for (let i = 0; i < gw; i++, n++) {
        const x = x0 + i * res;
        const b = bump(x, y);
        Bm[n] = b;
        F[n] = terrain(x, y) + b;
      }
    }

    for (let j = 0; j < gh; j++) {
      const y = y0 + j * res;
      const jm = j > 0 ? -gw : 0, jp = j < gh - 1 ? gw : 0;
      for (let i = 0; i < gw; i++) {
        const k = j * gw + i;
        const x = x0 + i * res;
        const im = i > 0 ? -1 : 0, ip = i < gw - 1 ? 1 : 0;
        const f = F[k];

        // soft ribbon + broad wash
        const c = 0.5 + 0.5 * Math.cos(TAU * (f * BAND_COUNT - phaseT));
        const ridge = Math.pow(c, RIDGE_SHARP);
        const w = 0.5 + 0.5 * Math.cos(TAU * (f * BAND_COUNT * 0.45 + phaseT * 0.6 + 0.25));
        let v = ridge * RIDGE_ALPHA + w * w * WASH_ALPHA;

        // light from the top-left across the slope = relief
        const gx = F[k + ip] - F[k + im], gy = F[k + jp] - F[k + jm];
        const s = clamp01(0.5 - (gx * 0.6 + gy * 0.8) * 14);
        v *= 1 + LIGHT * (s - 0.5) * 2;

        // brighten near the cursor
        v *= 1 + CURSOR_LIGHT * Math.min(1, Bm[k] / CURSOR_HEIGHT);

        // colour: low = deep blue, high = pale cyan, with a faint teal drift
        const h = clamp01((f + 0.85) / 1.7);
        const drift = 0.35 * (0.5 + 0.5 * Math.sin(x * 0.0038 + y * 0.0029 + clock * 0.00005 * SPEED));
        const r = LOW[0] + (HIGH[0] - LOW[0]) * h;
        const g = LOW[1] + (HIGH[1] - LOW[1]) * h;
        const bl = LOW[2] + (HIGH[2] - LOW[2]) * h;

        const p = k * 4;
        data[p]     = r + (ACCENT[0] - r) * drift;
        data[p + 1] = g + (ACCENT[1] - g) * drift;
        data[p + 2] = bl + (ACCENT[2] - bl) * drift;
        data[p + 3] = clamp01(v * maskG[k] * intro) * 255;
      }
    }
    offCtx.putImageData(img, 0, 0);
  }

  function drawTexture() {
    const dw = gw * res, dh = gh * res;
    const dx = -MARGIN - res / 2 - cursor.px * PARALLAX;
    const dy = -MARGIN - res / 2 - cursor.py * PARALLAX;
    ctx.save();
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = 'high';
    ctx.drawImage(off, dx, dy, dw, dh);

    if (BLOOM > 0) {                     // cheap glow: shrink, then stretch back over the top
      bloomCtx.imageSmoothingEnabled = true;
      bloomCtx.imageSmoothingQuality = 'high';
      bloomCtx.clearRect(0, 0, bloomCv.width, bloomCv.height);
      bloomCtx.drawImage(off, 0, 0, bloomCv.width, bloomCv.height);
      ctx.globalCompositeOperation = 'lighter';
      ctx.globalAlpha = BLOOM;
      ctx.drawImage(bloomCv, dx, dy, dw, dh);
    }
    ctx.restore();
  }

  /* ================= QUIET ZONE (keeps text readable) ================= */
  function measure() {
    const hr = hero.getBoundingClientRect();
    quiet = [];
    document.querySelectorAll('.hero-heading, .hero-heading-image, .hero-description').forEach(el => {
      const r = el.getBoundingClientRect();
      if (r.width < 2 || r.height < 2) return;
      quiet.push({ cx: r.left - hr.left + r.width / 2, cy: r.top - hr.top + r.height / 2, hw: r.width / 2, hh: r.height / 2 });
    });
    buildMask();
  }

  // 0 inside the text area, rising smoothly to 1 further away
  function quietMask(x, y) {
    let d = Infinity;
    for (const r of quiet) {
      const dx = Math.max(Math.abs(x - r.cx) - r.hw, 0);
      const dy = Math.max(Math.abs(y - r.cy) - r.hh, 0);
      d = Math.min(d, Math.hypot(dx, dy));
    }
    return smooth((d - QUIET_PAD) / QUIET_FADE);
  }

  function drawVignette() {
    const v = ctx.createRadialGradient(W / 2, H / 2, Math.min(W, H) * 0.35, W / 2, H / 2, Math.hypot(W / 2, H / 2));
    v.addColorStop(0, 'rgba(2, 6, 12, 0)');
    v.addColorStop(1, `rgba(2, 6, 12, ${0.5 * intro})`);
    ctx.fillStyle = v;
    ctx.fillRect(0, 0, W, H);
  }

  /* ================= MOTES (tiny lights riding the ribbons) ================= */
  function makeDot() {
    const S = 32, c = document.createElement('canvas');
    c.width = c.height = S;
    const x = c.getContext('2d');
    const gr = x.createRadialGradient(S / 2, S / 2, 0, S / 2, S / 2, S / 2);
    gr.addColorStop(0, 'rgba(235, 250, 255, 1)');
    gr.addColorStop(0.18, 'rgba(180, 225, 245, 0.7)');
    gr.addColorStop(0.5, 'rgba(120, 190, 230, 0.16)');
    gr.addColorStop(1, 'rgba(120, 190, 230, 0)');
    x.fillStyle = gr;
    x.fillRect(0, 0, S, S);
    return c;
  }
  const dotSprite = makeDot();

  function spawnMote(m, initial) {
    m.x = rand(0, W); m.y = rand(0, H);
    m.life = rand(9000, 16000);
    m.age = initial ? rand(0, m.life) : 0;
    m.size = rand(0.6, 1.4);
    m.spd = rand(10, 20);
    m.dir = Math.random() < 0.5 ? -1 : 1;
    m.ph = rand(0, TAU);
    m.glow = 0;
  }
  function buildMotes() {
    motes = [];
    const n = W < 768 ? MOTE_COUNT_MOBILE : MOTE_COUNT;
    for (let i = 0; i < n; i++) { const m = {}; spawnMote(m, true); motes.push(m); }
  }

  function updateMotes(dt) {
    for (const m of motes) {
      m.age += dt;
      if (m.age > m.life || m.x < -30 || m.x > W + 30 || m.y < -30 || m.y > H + 30) { spawnMote(m, false); continue; }
      const f0 = sampleField(m.x, m.y);
      const gx = sampleField(m.x + 5, m.y) - f0;
      const gy = sampleField(m.x, m.y + 5) - f0;
      const len = Math.hypot(gx, gy) || 1;
      // travel along the ribbon (perpendicular to the slope)
      const k = m.spd * SPEED * dt / 1000;
      m.x += (-gy / len) * m.dir * k + Math.cos(clock * 0.0009 + m.ph) * 0.006 * dt;
      m.y += ( gx / len) * m.dir * k + Math.sin(clock * 0.0011 + m.ph) * 0.006 * dt;
      m.glow = ridgeAt(f0);              // lights glow brighter while riding a bright ribbon
    }
  }

  function drawMotes() {
    if (!motes.length) return;
    ctx.save();
    ctx.globalCompositeOperation = 'lighter';
    for (const m of motes) {
      const fade = smooth(m.age / 1500) * smooth((m.life - m.age) / 1500);
      const twinkle = 0.7 + 0.3 * Math.sin(clock * 0.0016 + m.ph);
      const a = fade * twinkle * 0.55 * intro * (0.3 + 0.7 * quietMask(m.x, m.y)) * (0.25 + 0.75 * m.glow);
      if (a < 0.01) continue;
      const rad = 3 + m.size * 3;
      ctx.globalAlpha = a;
      ctx.drawImage(dotSprite, m.x - rad, m.y - rad, rad * 2, rad * 2);
    }
    ctx.restore();
  }

  /* ================= LIGHT ================= */
  function drawGlows() {
    for (const g of GLOWS) {
      const x = (g.x + Math.sin(clock * 0.00007 * SPEED + g.p) * 0.04) * W;
      const y = (g.y + Math.cos(clock * 0.00006 * SPEED + g.p * 1.7) * 0.04) * H;
      const r = g.r * Math.max(W, H);
      const gr = ctx.createRadialGradient(x, y, 0, x, y, r);
      gr.addColorStop(0, `rgba(${g.c}, ${g.a * intro})`);
      gr.addColorStop(0.5, `rgba(${g.c}, ${g.a * 0.35 * intro})`);
      gr.addColorStop(1, `rgba(${g.c}, 0)`);
      ctx.fillStyle = gr;
      ctx.fillRect(0, 0, W, H);
    }
  }

  function drawCursorGlow() {
    if (cursor.k < 0.01) return;
    const gr = ctx.createRadialGradient(cursor.x, cursor.y, 0, cursor.x, cursor.y, 420);
    gr.addColorStop(0, `rgba(90, 170, 220, ${0.07 * cursor.k})`);
    gr.addColorStop(0.5, `rgba(90, 170, 220, ${0.025 * cursor.k})`);
    gr.addColorStop(1, 'rgba(90, 170, 220, 0)');
    ctx.fillStyle = gr;
    ctx.fillRect(0, 0, W, H);
  }

  /* ================= UPDATE + DRAW ================= */
  function step(dt, force) {
    const e = rate => 1 - Math.exp(-rate * dt / 1000);

    // cursor eases toward the pointer, so the hill trails it softly
    cursor.x += (cursor.tx - cursor.x) * e(4);
    cursor.y += (cursor.ty - cursor.y) * e(4);
    cursor.k += ((cursor.inside ? 1 : 0) - cursor.k) * e(2.2);
    const lag = Math.hypot(cursor.tx - cursor.x, cursor.ty - cursor.y);
    cursor.amp = CURSOR_HEIGHT * (0.7 + 0.3 * clamp01(lag / 160)) * cursor.k;
    const nx = W ? (cursor.x / W - 0.5) * 2 : 0, ny = H ? (cursor.y / H - 0.5) * 2 : 0;
    cursor.px += ((cursor.inside ? nx : 0) - cursor.px) * e(1.5);
    cursor.py += ((cursor.inside ? ny : 0) - cursor.py) * e(1.5);

    tz = clock * FLOW * SPEED;
    phaseT = clock * BAND_DRIFT * SPEED;
    intro = smooth(clock / 2500);

    fieldAcc += dt;
    if (force || fieldAcc >= FIELD_MS) { fieldAcc = 0; updateTexture(); }
    updateMotes(dt);
  }

  function draw() {
    const bg = ctx.createRadialGradient(W / 2, H / 2, 0, W / 2, H / 2, Math.hypot(W / 2, H / 2));
    bg.addColorStop(0, BG_CENTER);
    bg.addColorStop(1, BG_EDGE);
    ctx.fillStyle = bg;
    ctx.fillRect(0, 0, W, H);

    drawGlows();
    drawCursorGlow();
    drawTexture();
    drawVignette();
    drawMotes();
  }

  /* ================= LOOP ================= */
  let raf = 0, last = 0, visible = true, ema = 16, slow = 0;

  function watchPerformance(dt) {
    // if the device struggles, quietly use a coarser terrain grid
    ema += (dt - ema) * 0.05;
    slow = ema > 27 ? slow + 1 : Math.max(0, slow - 1);
    if (slow > 90 && res < 18) { tuned = true; res += 2; buildGrid(); slow = 0; ema = 16; }
  }

  function frame(now) {
    raf = 0;
    if (!visible || document.hidden) { last = 0; return; }
    const dt = last ? Math.min(now - last, 50) : 16;
    last = now;
    clock += dt;
    watchPerformance(dt);
    step(dt, false);
    draw();
    raf = requestAnimationFrame(frame);
  }

  function start() {
    if (!raf && !reduce) { last = 0; raf = requestAnimationFrame(frame); }
  }

  /* ================= LAYOUT & EVENTS ================= */
  function layout(rebuild) {
    const dpr = Math.min(window.devicePixelRatio || 1, 1.5);
    const w = hero.clientWidth, h = hero.clientHeight;
    const widthChanged = w !== W;
    canvas.width = Math.round(w * dpr);
    canvas.height = Math.round(h * dpr);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    W = w; H = h;
    scale = 3.2 / Math.max(W, 1100);
    measure();
    buildGrid();
    if (rebuild || widthChanged || !motes.length) buildMotes();
    if (reduce) { step(0, true); draw(); }
  }

  window.addEventListener('resize', () => layout(false));
  window.addEventListener('load', () => layout(true));
  hero.querySelectorAll('img').forEach(img => img.addEventListener('load', () => { measure(); if (reduce) { step(0, true); draw(); } }));
  if (document.fonts && document.fonts.ready) document.fonts.ready.then(() => { measure(); if (reduce) { step(0, true); draw(); } });
  document.addEventListener('visibilitychange', () => { if (!document.hidden) start(); });

  if (!reduce) {
    const setPointer = (cx, cy) => {
      const r = hero.getBoundingClientRect();
      const x = cx - r.left, y = cy - r.top;
      const inside = x >= 0 && x <= r.width && y >= 0 && y <= r.height;
      if (inside) {
        if (!cursor.inside && cursor.k < 0.02) { cursor.x = x; cursor.y = y; }
        cursor.tx = x; cursor.ty = y;
      }
      cursor.inside = inside;
    };
    window.addEventListener('mousemove', e => setPointer(e.clientX, e.clientY), { passive: true });
    const touch = e => { const t = e.touches[0]; if (t) setPointer(t.clientX, t.clientY); };
    window.addEventListener('touchstart', touch, { passive: true });
    window.addEventListener('touchmove', touch, { passive: true });
    window.addEventListener('touchend', () => { cursor.inside = false; });
    document.addEventListener('mouseleave', () => { cursor.inside = false; });

    // Pause when the hero is scrolled out of view
    if ('IntersectionObserver' in window) {
      new IntersectionObserver(entries => {
        visible = entries[0].isIntersecting;
        if (visible) start();
      }).observe(hero);
    }
  }

  layout(true);
  start();
})();
