/* hero-animation.js  |  "Living Topography"
   Draws on <canvas id="bg"> inside .hero-section.
   Layers (back to front):
     1. ambient light + far bokeh
     2. topographic contour lines from a slowly evolving noise terrain
        (the cursor raises a soft hill that the lines flow around)
     3. drifting motes that travel along the contours
     4. near bokeh (large, soft, parallax) for depth
   The heading and paragraph stay readable: the terrain is dimmed behind them. */
(() => {
  'use strict';

  /* ================= SETTINGS (safe to tweak) ================= */
  const SPEED = 1;                       // global motion speed (0.5 = half)

  const BG_CENTER = '#01131F';
  const BG_EDGE   = '#02060C';
  const LOW  = [64, 128, 205];           // colour of the low contour lines (r,g,b)
  const HIGH = [155, 222, 240];          // colour of the high contour lines
  const TINTS = [[170, 220, 245], [140, 235, 225]];   // bokeh colours (blue, teal)

  // Terrain
  const FLOW        = 0.000045;          // how fast the terrain evolves (lower = calmer)
  const WARP        = 0.55;              // how swirly / organic the shapes are
  const LEVEL_MIN   = -0.70;             // lowest contour level
  const LEVEL_STEP  = 0.13;              // gap between contour levels
  const LEVEL_COUNT = 15;                // number of contour lines
  const INDEX_EVERY = 4;                 // every Nth line is drawn stronger (like a map)
  const LINE_ALPHA  = 0.15;
  const INDEX_ALPHA = 0.26;
  const LINE_W      = 0.8;
  const INDEX_W     = 1.3;

  // Cursor
  const CURSOR_RADIUS = 190;             // size of the hill under the cursor (px)
  const CURSOR_HEIGHT = 0.75;            // how tall the hill is
  const PARALLAX_LINES = 10;             // px the terrain shifts with the cursor
  const PARALLAX_BOKEH = 60;             // px near bokeh shifts with the cursor

  // Bokeh
  const BOKEH_COUNT = 34;
  const BOKEH_COUNT_MOBILE = 16;

  // Motes (tiny lights flowing along the contours)
  const MOTE_COUNT = 60;
  const MOTE_COUNT_MOBILE = 28;

  // Text protection
  const QUIET_DIM   = 0.60;              // how much the terrain fades behind the text
  const QUIET_PAD   = 20;                // clear margin around text for bokeh/motes
  const QUIET_FADE  = 220;               // distance over which bokeh/motes fade back in

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
  const lerp = (a, b, t) => a + (b - a) * t;

  const reduce = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  let W = 0, H = 0, scale = 0.0029;
  let clock = reduce ? 9000 : 0;         // own clock (ms), only advances while visible
  let intro = 0;
  let quiet = [];
  let bokehFar = [], bokehNear = [], motes = [];
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
  let tz = 0;                            // terrain time
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

  /* ================= GRID + CONTOURS ================= */
  let cell = 16, tuned = false, cols = 0, rows = 0, ox = 0, oy = 0, F = new Float32Array(1);

  function buildGrid() {
    if (!tuned) cell = W < 768 ? 18 : Math.max(14, Math.min(24, Math.round(W / 110)));
    ox = -cell * 2; oy = -cell * 2;
    cols = Math.ceil(W / cell) + 5;
    rows = Math.ceil(H / cell) + 5;
    F = new Float32Array(cols * rows);
  }

  function computeField() {
    let n = 0;
    for (let j = 0; j < rows; j++) {
      const y = oy + j * cell;
      for (let i = 0; i < cols; i++) {
        const x = ox + i * cell;
        F[n++] = terrain(x, y) + bump(x, y);
      }
    }
  }

  // Marching squares: adds the line segments of one contour level to the current path
  function march(level) {
    for (let j = 0; j < rows - 1; j++) {
      const y0 = oy + j * cell;
      let k = j * cols;
      for (let i = 0; i < cols - 1; i++, k++) {
        const a = F[k], b = F[k + 1], c = F[k + cols + 1], d = F[k + cols];
        const idx = (a > level ? 8 : 0) | (b > level ? 4 : 0) | (c > level ? 2 : 0) | (d > level ? 1 : 0);
        if (idx === 0 || idx === 15) continue;
        const x0 = ox + i * cell;
        const tx = x0 + cell * (level - a) / (b - a), ty = y0;                 // top
        const rx = x0 + cell,                       ry = y0 + cell * (level - b) / (c - b); // right
        const bx = x0 + cell * (level - d) / (c - d), by = y0 + cell;          // bottom
        const lx = x0,                              ly = y0 + cell * (level - a) / (d - a); // left
        switch (idx) {
          case 1: case 14: ctx.moveTo(lx, ly); ctx.lineTo(bx, by); break;
          case 2: case 13: ctx.moveTo(bx, by); ctx.lineTo(rx, ry); break;
          case 3: case 12: ctx.moveTo(lx, ly); ctx.lineTo(rx, ry); break;
          case 4: case 11: ctx.moveTo(tx, ty); ctx.lineTo(rx, ry); break;
          case 6: case 9:  ctx.moveTo(tx, ty); ctx.lineTo(bx, by); break;
          case 7: case 8:  ctx.moveTo(tx, ty); ctx.lineTo(lx, ly); break;
          case 5:
            if ((a + b + c + d) * 0.25 > level) { ctx.moveTo(tx, ty); ctx.lineTo(lx, ly); ctx.moveTo(bx, by); ctx.lineTo(rx, ry); }
            else { ctx.moveTo(tx, ty); ctx.lineTo(rx, ry); ctx.moveTo(lx, ly); ctx.lineTo(bx, by); }
            break;
          case 10:
            if ((a + b + c + d) * 0.25 > level) { ctx.moveTo(tx, ty); ctx.lineTo(rx, ry); ctx.moveTo(lx, ly); ctx.lineTo(bx, by); }
            else { ctx.moveTo(tx, ty); ctx.lineTo(lx, ly); ctx.moveTo(bx, by); ctx.lineTo(rx, ry); }
            break;
        }
      }
    }
  }

  function drawContours() {
    ctx.save();
    ctx.translate(-cursor.px * PARALLAX_LINES, -cursor.py * PARALLAX_LINES);
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    for (let L = 0; L < LEVEL_COUNT; L++) {
      const lv = L / (LEVEL_COUNT - 1);
      const isIndex = L % INDEX_EVERY === 0;
      const fade = smooth((clock - 600 - L * 140) / 1800);      // lines fade in one after another
      const a = (isIndex ? INDEX_ALPHA : LINE_ALPHA) * (0.55 + 0.7 * lv) * fade;
      if (a < 0.004) continue;
      const r = Math.round(lerp(LOW[0], HIGH[0], lv));
      const g = Math.round(lerp(LOW[1], HIGH[1], lv));
      const b = Math.round(lerp(LOW[2], HIGH[2], lv));
      ctx.strokeStyle = `rgba(${r}, ${g}, ${b}, ${a})`;
      ctx.lineWidth = isIndex ? INDEX_W : LINE_W;
      ctx.beginPath();
      march(LEVEL_MIN + L * LEVEL_STEP);
      ctx.stroke();
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
  }

  // 0 inside the text area, rising smoothly to 1 further away
  function mask(x, y) {
    let d = Infinity;
    for (const r of quiet) {
      const dx = Math.max(Math.abs(x - r.cx) - r.hw, 0);
      const dy = Math.max(Math.abs(y - r.cy) - r.hh, 0);
      d = Math.min(d, Math.hypot(dx, dy));
    }
    return smooth((d - QUIET_PAD) / QUIET_FADE);
  }

  function drawShade() {
    // soft dark pools behind the text so the terrain never fights with it
    for (const r of quiet) {
      ctx.save();
      ctx.translate(r.cx, r.cy);
      ctx.scale(r.hw + 130, r.hh + 100);
      const g = ctx.createRadialGradient(0, 0, 0, 0, 0, 1);
      g.addColorStop(0, `rgba(1, 15, 25, ${QUIET_DIM * intro})`);
      g.addColorStop(0.55, `rgba(1, 15, 25, ${QUIET_DIM * 0.85 * intro})`);
      g.addColorStop(1, 'rgba(1, 15, 25, 0)');
      ctx.fillStyle = g;
      ctx.fillRect(-1, -1, 2, 2);
      ctx.restore();
    }
    // gentle edge vignette for depth
    const v = ctx.createRadialGradient(W / 2, H / 2, Math.min(W, H) * 0.35, W / 2, H / 2, Math.hypot(W / 2, H / 2));
    v.addColorStop(0, 'rgba(2, 6, 12, 0)');
    v.addColorStop(1, `rgba(2, 6, 12, ${0.55 * intro})`);
    ctx.fillStyle = v;
    ctx.fillRect(0, 0, W, H);
  }

  /* ================= SPRITES (pre-rendered for speed) ================= */
  // kind 0 = in focus (bright rim), 1 = slightly soft, 2 = very soft glow
  function makeBokeh(tint, kind) {
    const S = 128, c = document.createElement('canvas');
    c.width = c.height = S;
    const x = c.getContext('2d');
    const [r, g, b] = tint;
    const gr = x.createRadialGradient(S / 2, S / 2, 0, S / 2, S / 2, S / 2);
    const stops = [
      [[0, .30], [.80, .42], [.93, .85], [1, 0]],
      [[0, .30], [.70, .38], [.90, .60], [1, 0]],
      [[0, .46], [.50, .30], [.85, .28], [1, 0]]
    ][kind];
    stops.forEach(([o, a]) => gr.addColorStop(o, `rgba(${r}, ${g}, ${b}, ${a})`));
    x.fillStyle = gr;
    x.fillRect(0, 0, S, S);
    return c;
  }
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
  const bokehSprites = TINTS.map(t => [0, 1, 2].map(k => makeBokeh(t, k)));
  const dotSprite = makeDot();

  /* ================= BOKEH ================= */
  function buildBokeh() {
    bokehFar = []; bokehNear = [];
    const n = W < 768 ? BOKEH_COUNT_MOBILE : BOKEH_COUNT;
    for (let i = 0; i < n; i++) {
      const z = Math.random();                       // 0 = far, 1 = near
      const d = Math.abs(z - 0.5);                   // distance from the focal plane
      const b = {
        hx: rand(-0.04, 1.04) * W, hy: rand(-0.04, 1.04) * H,
        z,
        r: lerp(6, 62, Math.pow(z, 1.6)),
        kind: d < 0.18 ? 0 : d < 0.34 ? 1 : 2,
        tint: Math.random() < 0.25 ? 1 : 0,
        a: 0.42 + 0.30 * (1 - d * 1.6),
        ax: rand(10, 26) * (0.4 + z), ay: rand(10, 26) * (0.4 + z),
        s1: rand(0.00006, 0.00013), s2: rand(0.00006, 0.00013),
        p1: rand(0, TAU), p2: rand(0, TAU), p3: rand(0, TAU)
      };
      (z < 0.45 ? bokehFar : bokehNear).push(b);
    }
    bokehFar.sort((p, q) => p.z - q.z);
    bokehNear.sort((p, q) => p.z - q.z);
  }

  function drawBokeh(list, near) {
    ctx.save();
    ctx.globalCompositeOperation = 'lighter';
    for (const b of list) {
      const par = (b.z - 0.35) * PARALLAX_BOKEH / 1;
      const x = b.hx + Math.sin(clock * SPEED * b.s1 + b.p1) * b.ax - cursor.px * par;
      const y = b.hy + Math.cos(clock * SPEED * b.s2 + b.p2) * b.ay - cursor.py * par;
      const breathe = 0.8 + 0.2 * Math.sin(clock * 0.0004 * SPEED + b.p3);
      let a = b.a * 0.55 * breathe * intro;
      if (near) a *= 0.2 + 0.8 * mask(x, y);
      if (cursor.k > 0.01) {                         // lights swell a little near the cursor
        const dx = x - cursor.x, dy = y - cursor.y;
        a *= 1 + 0.7 * cursor.k * Math.exp(-(dx * dx + dy * dy) / (2 * 260 * 260));
      }
      if (a < 0.008) continue;
      ctx.globalAlpha = Math.min(a, 1);
      ctx.drawImage(bokehSprites[b.tint][b.kind], x - b.r, y - b.r, b.r * 2, b.r * 2);
    }
    ctx.restore();
  }

  /* ================= MOTES ================= */
  function spawnMote(m, initial) {
    m.x = rand(0, W); m.y = rand(0, H);
    m.life = rand(9000, 16000);
    m.age = initial ? rand(0, m.life) : 0;
    m.size = rand(0.6, 1.5);
    m.spd = rand(10, 22);
    m.dir = Math.random() < 0.5 ? -1 : 1;
    m.ph = rand(0, TAU);
  }
  function buildMotes() {
    motes = [];
    const n = W < 768 ? MOTE_COUNT_MOBILE : MOTE_COUNT;
    for (let i = 0; i < n; i++) { const m = {}; spawnMote(m, true); motes.push(m); }
  }

  function sampleField(x, y) { return terrain(x, y) + bump(x, y); }

  function updateMotes(dt) {
    for (const m of motes) {
      m.age += dt;
      if (m.age > m.life || m.x < -30 || m.x > W + 30 || m.y < -30 || m.y > H + 30) { spawnMote(m, false); continue; }
      const f0 = sampleField(m.x, m.y);
      const gx = sampleField(m.x + 5, m.y) - f0;
      const gy = sampleField(m.x, m.y + 5) - f0;
      const len = Math.hypot(gx, gy) || 1;
      // move along the contour (perpendicular to the slope), so lights trace the topology
      const k = m.spd * SPEED * dt / 1000;
      m.x += (-gy / len) * m.dir * k + Math.cos(clock * 0.0009 + m.ph) * 0.008 * dt;
      m.y += ( gx / len) * m.dir * k + Math.sin(clock * 0.0011 + m.ph) * 0.008 * dt;
    }
  }

  function drawMotes() {
    ctx.save();
    ctx.globalCompositeOperation = 'lighter';
    for (const m of motes) {
      const fade = smooth(m.age / 1500) * smooth((m.life - m.age) / 1500);
      const twinkle = 0.65 + 0.35 * Math.sin(clock * 0.0016 + m.ph);
      const a = fade * twinkle * 0.6 * intro * (0.25 + 0.75 * mask(m.x, m.y));
      if (a < 0.01) continue;
      const rad = 3 + m.size * 3.2;
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
  function step(dt) {
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
    computeField();
    updateMotes(dt);
  }

  function draw() {
    intro = smooth(clock / 2500);
    const bg = ctx.createRadialGradient(W / 2, H / 2, 0, W / 2, H / 2, Math.hypot(W / 2, H / 2));
    bg.addColorStop(0, BG_CENTER);
    bg.addColorStop(1, BG_EDGE);
    ctx.fillStyle = bg;
    ctx.fillRect(0, 0, W, H);

    drawGlows();
    drawBokeh(bokehFar, false);
    drawCursorGlow();
    drawContours();
    drawShade();
    drawMotes();
    drawBokeh(bokehNear, true);
  }

  /* ================= LOOP ================= */
  let raf = 0, last = 0, visible = true, ema = 16, slow = 0;

  function watchPerformance(dt) {
    // if the device struggles, quietly use a coarser terrain grid
    ema += (dt - ema) * 0.05;
    slow = ema > 27 ? slow + 1 : Math.max(0, slow - 1);
    if (slow > 90 && cell < 30) { tuned = true; cell += 4; buildGrid(); slow = 0; ema = 16; }
  }

  function frame(now) {
    raf = 0;
    if (!visible || document.hidden) { last = 0; return; }
    const dt = last ? Math.min(now - last, 50) : 16;
    last = now;
    clock += dt;
    watchPerformance(dt);
    step(dt);
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
    const oldH = H, widthChanged = w !== W;
    canvas.width = Math.round(w * dpr);
    canvas.height = Math.round(h * dpr);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    W = w; H = h;
    scale = 3.2 / Math.max(W, 1100);
    measure();
    buildGrid();
    if (rebuild || widthChanged || !bokehFar.length && !bokehNear.length) { buildBokeh(); buildMotes(); }
    else if (oldH) { [bokehFar, bokehNear].forEach(l => l.forEach(b => { b.hy *= h / oldH; })); }
    if (reduce) { step(0); draw(); }
  }

  window.addEventListener('resize', () => layout(false));
  window.addEventListener('load', () => layout(true));
  hero.querySelectorAll('img').forEach(img => img.addEventListener('load', () => { measure(); if (reduce) draw(); }));
  if (document.fonts && document.fonts.ready) document.fonts.ready.then(() => { measure(); if (reduce) draw(); });
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
