/* hero-animation.js  |  "Mist Forest"
   Draws on <canvas id="bg"> inside .hero-section.
     - deep ambient colour pooling at the sides and bottom
     - soft fluid "flows" of light that curve around the centre (they avoid the text and the top menu)
     - drifting banks of mist, with tree silhouettes standing inside it
     - small glowing spores floating around, gently parting around the cursor
   Everything is built from soft gradients, and concentrated at the edges so the centre stays quiet. */
(() => {
  'use strict';

  /* ================= SETTINGS (safe to tweak) ================= */
  const SPEED = 1;                       // global motion speed (0.5 = half, 2 = double)

  const BG_CENTER = '#01131F';
  const BG_EDGE   = '#02060C';

  // ---- Spores (the small glowing dots) ----
  const SPORE_COUNT        = 90;         // number of dots on desktop (0 = off)
  const SPORE_COUNT_MOBILE = 40;
  const SPORE_ALPHA        = 0.95;       // brightness
  const SPORE_SIZE         = 1.15;       // size multiplier (dot + glow together)
  const SPORE_CORE         = 1;          // brightness of the bright centre (0 to 1)
  const SPORE_HALO         = 1.3;        // strength of the soft glow around it (0 = none, 2 = strong)
  const SPORE_CURSOR_GLOW  = 0.8;        // extra brightness near the cursor (0 = none)
  const SPORE_SPEED        = 1.7;        // how lively they drift (1 = slow, 3 = busy)
  const SPORE_TWINKLE      = 1;          // 0 = steady glow, 1 = soft pulse, 2 = strong pulse
  const SPORE_CURSOR_PUSH   = 22;        // max distance (px) a dot is nudged by the cursor
  const SPORE_CURSOR_RADIUS = 200;       // how close the cursor must be to affect dots (px)
  const SPORE_LIFE_MIN = 9;              // each dot fades in, lives, fades out (seconds)
  const SPORE_LIFE_MAX = 20;

  // ---- Fluid flows (the soft curved light in the background) ----
  const FLOW_COUNT        = 5;           // number of flows (0 = off)
  const FLOW_COUNT_MOBILE = 3;
  const FLOW_ALPHA   = 0.07;             // strength (0.04 = very faint, 0.12 = clear)
  const FLOW_WIDTH   = 170;              // thickness (px)
  const FLOW_WOBBLE  = 1;                // how curvy / organic (0 = smooth arcs, 2 = very wavy)
  const FLOW_SPEED   = 1;                // how fast the shapes morph
  const FLOW_CURSOR  = 1;                // reaction to the cursor (0 = none, 2 = strong)
  const FLOW_NEAR    = 0.82;             // closest a flow may sit to the centre (bigger = pushed outward)
  const FLOW_FAR     = 1.10;             // furthest (above ~1.1 goes off screen)

  // ---- Thin fluid lines (drawn along the flows) ----
  const LINE_ALPHA   = 0.22;             // brightness (0 = off, 0.1 = faint, 0.4 = clear)
  const LINE_STRANDS = 3;                // thin lines per flow
  const LINE_WIDTH   = 1;                // line thickness (px)
  const LINE_SPREAD  = 0.045;            // gap between strands (bigger = more spread out)
  const LINE_CURSOR  = 1;                // how much lines bend and swirl near the cursor (0 = none, 2 = strong)
  const LINE_COLOR   = '150, 215, 235';  // r, g, b

  // ---- Mist ----
  const FOG_COUNT        = 13;           // mist banks (desktop)
  const FOG_COUNT_MOBILE = 8;
  const FOG_ALPHA        = 0.11;         // mist strength (lower = subtler)

  // ---- Tree silhouettes ----
  const TRUNKS        = 0;               // per side (0 = off). These made the dark vertical bands
  const TRUNKS_MOBILE = 0;
  const TRUNK_ALPHA   = 0.55;

  // ---- Calm zone: keeps the centre, the text and the top menu quiet ----
  const CALM_X = 0.32;                   // width of the calm ellipse (fraction of screen width)
  const CALM_Y = 0.30;                   // height of the calm ellipse (fraction of screen height)
  const QUIET_PAD  = 30;                 // extra clear margin around the text (px)
  const QUIET_FADE = 420;                // distance over which things fade back in (px)
  const NAV_ZONE_W = 520;                // clear area at the top middle (menu): width (px)
  const NAV_ZONE_H = 90;                 // ...and height (px)

  const GRAIN = 0.02;                    // tiny film grain that hides gradient banding (0 = off)

  // Ambient colour pools (x, y, radius as fractions of the screen)
  const GLOWS = [
    { x: 0.00, y: 0.60, r: 0.55, c: '30, 110, 140', a: 0.16, p: 0 },   // left, teal
    { x: 1.00, y: 0.30, r: 0.50, c: '40, 100, 180', a: 0.14, p: 2 },   // right, blue
    { x: 0.15, y: 1.00, r: 0.45, c: '40, 150, 130', a: 0.12, p: 4 },   // bottom-left, green-teal
    { x: 0.90, y: 1.00, r: 0.40, c: '50, 120, 170', a: 0.10, p: 1 }    // bottom-right
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

  let W = 0, H = 0, ui = 1;
  let clock = reduce ? 9000 : 0;         // own clock (ms), only advances while visible
  let intro = 0;
  let quiet = [];
  let fog = [], spores = [], flows = [];
  const cursor = { x: 0, y: 0, tx: 0, ty: 0, k: 0, px: 0, py: 0, inside: false };

  /* ================= NOISE (for gentle organic drift) ================= */
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

  /* ================= CALM ZONE (keeps the middle, the text and the menu quiet) ================= */
  function measure() {
    const hr = hero.getBoundingClientRect();
    quiet = [];
    document.querySelectorAll('.hero-heading, .hero-heading-image, .hero-description').forEach(el => {
      const r = el.getBoundingClientRect();
      if (r.width < 2 || r.height < 2) return;
      quiet.push({ cx: r.left - hr.left + r.width / 2, cy: r.top - hr.top + r.height / 2, hw: r.width / 2, hh: r.height / 2 });
    });
    // top-middle menu area
    quiet.push({ cx: W / 2, cy: NAV_ZONE_H / 2 + 6, hw: NAV_ZONE_W / 2, hh: NAV_ZONE_H / 2 });
  }

  // 0 in the calm middle / behind text, rising smoothly to 1 toward the edges
  function calmAt(x, y) {
    let d = Infinity;
    for (const r of quiet) {
      const dx = Math.max(Math.abs(x - r.cx) - r.hw, 0);
      const dy = Math.max(Math.abs(y - r.cy) - r.hh, 0);
      d = Math.min(d, Math.hypot(dx, dy));
    }
    const q = smooth((d - QUIET_PAD) / QUIET_FADE);
    const e = Math.hypot((x - W / 2) / (W * CALM_X), (y - H / 2) / (H * CALM_Y));
    return Math.min(q, smooth((e - 0.5) / 0.9));
  }

  /* ================= SPRITES & GRADIENTS ================= */
  // Soft mist gradient on a unit circle (reused for every bank of mist)
  function fogGradient(rgb) {
    const g = ctx.createRadialGradient(0, 0, 0, 0, 0, 1);
    const N = 14, e4 = Math.exp(-4);
    for (let i = 0; i <= N; i++) {
      const t = i / N;
      const a = Math.max(0, (Math.exp(-4 * t * t) - e4) / (1 - e4));
      g.addColorStop(t, `rgba(${rgb}, ${a.toFixed(4)})`);
    }
    return g;
  }
  const FOG_COLORS = ['70, 160, 190', '70, 120, 210', '60, 185, 165'];
  let fogGrads = [];

  // Soft round blob, stamped many times along a curve to make a flow
  function makeSoft(rgb) {
    const S = 128, c = document.createElement('canvas');
    c.width = c.height = S;
    const x = c.getContext('2d');
    const g = x.createRadialGradient(S / 2, S / 2, 0, S / 2, S / 2, S / 2);
    const N = 12, e4 = Math.exp(-4);
    for (let i = 0; i <= N; i++) {
      const t = i / N;
      const a = Math.max(0, (Math.exp(-4 * t * t) - e4) / (1 - e4));
      g.addColorStop(t, `rgba(${rgb}, ${a.toFixed(4)})`);
    }
    x.fillStyle = g;
    x.fillRect(0, 0, S, S);
    return c;
  }
  const flowSprites = ['70, 175, 175', '70, 125, 220', '110, 120, 215'].map(makeSoft);

  // Glowing spores in three tints (cyan-teal, soft blue, faint violet)
  function makeSpore(rgb) {
    const S = 48, c = document.createElement('canvas');
    c.width = c.height = S;
    const x = c.getContext('2d');
    const g = x.createRadialGradient(S / 2, S / 2, 0, S / 2, S / 2, S / 2);
    const h = v => Math.min(1, v * SPORE_HALO).toFixed(3);
    g.addColorStop(0, `rgba(245, 255, 255, ${SPORE_CORE})`);
    g.addColorStop(0.10, `rgba(${rgb}, ${(0.85 * SPORE_CORE).toFixed(3)})`);
    g.addColorStop(0.30, `rgba(${rgb}, ${h(0.30)})`);
    g.addColorStop(0.60, `rgba(${rgb}, ${h(0.07)})`);
    g.addColorStop(1, `rgba(${rgb}, 0)`);
    x.fillStyle = g;
    x.fillRect(0, 0, S, S);
    return c;
  }
  const sporeSprites = ['120, 235, 215', '150, 200, 255', '190, 165, 255'].map(makeSpore);

  // Fine grain: dithers the gradients so there are no visible steps / bands
  function makeGrain() {
    const S = 96, c = document.createElement('canvas');
    c.width = c.height = S;
    const x = c.getContext('2d');
    const id = x.createImageData(S, S);
    for (let i = 0; i < S * S; i++) {
      id.data[i * 4] = id.data[i * 4 + 1] = id.data[i * 4 + 2] = 255;
      id.data[i * 4 + 3] = Math.random() * 255;
    }
    x.putImageData(id, 0, 0);
    return c;
  }
  const grainCv = makeGrain();
  let grainPattern = null;

  /* ================= TREE SILHOUETTES (drawn once, softly) ================= */
  const trunkCv = document.createElement('canvas');
  const TRUNK_PAD = 40, TRUNK_SCALE = 0.5;
  let hasTrunks = false;

  function buildTrunks() {
    const per = W < 768 ? TRUNKS_MOBILE : TRUNKS;
    hasTrunks = per > 0;
    if (!hasTrunks) return;
    trunkCv.width = Math.ceil((W + TRUNK_PAD * 2) * TRUNK_SCALE);
    trunkCv.height = Math.ceil((H + TRUNK_PAD * 2) * TRUNK_SCALE);
    const t = trunkCv.getContext('2d');
    const off = TRUNK_PAD * TRUNK_SCALE;
    t.setTransform(TRUNK_SCALE, 0, 0, TRUNK_SCALE, off, off);
    t.lineJoin = 'round';
    for (const side of [-1, 1]) {
      for (let i = 0; i < per; i++) {
        const depth = Math.random();                       // 0 = far, 1 = near
        const frac = 0.01 + (i / per) * 0.21 + rand(-0.015, 0.015);
        const x = side < 0 ? W * frac : W * (1 - frac);
        const w = lerp(22, 78, depth) * ui;
        const seed = rand(0, 100), lean = rand(-30, 30) * (0.5 + depth);
        const a = TRUNK_ALPHA * (0.35 + 0.65 * depth);
        for (let k = 0; k < 8; k++) {                      // stacked strokes = soft edges
          t.lineWidth = w * (0.55 + 0.9 * k / 7);
          t.strokeStyle = `rgba(1, 5, 10, ${(a * 0.17).toFixed(4)})`;
          t.beginPath();
          for (let y = -30; y <= H + 30; y += 40) {
            const xx = x + Math.sin(y * 0.004 + seed) * 14 * (0.5 + depth) + lean * (y / H);
            if (y === -30) t.moveTo(xx, y); else t.lineTo(xx, y);
          }
          t.stroke();
        }
      }
    }
  }

  /* ================= MIST ================= */
  function buildFog() {
    fogGrads = FOG_COLORS.map(fogGradient);
    fog = [];
    const n = W < 768 ? FOG_COUNT_MOBILE : FOG_COUNT;
    for (let i = 0; i < n; i++) {
      let x, y, tries = 0;
      do { x = rand(-0.05, 1.05) * W; y = rand(0.05, 1.1) * H; tries++; } while (calmAt(x, y) < 0.55 && tries < 40);
      const rx = rand(320, 620) * ui;
      fog.push({
        hx: x, hy: y, rx, ry: rx * rand(0.28, 0.5),
        a: rand(0.55, 1) * FOG_ALPHA,
        variant: x < W * 0.5 ? (Math.random() < 0.6 ? 2 : 0) : (Math.random() < 0.6 ? 1 : 0),
        layer: Math.random() < 0.6 ? 0 : 1,               // 0 = behind the trees, 1 = in front
        ax: rand(60, 140), ay: rand(20, 50),
        sx: TAU / rand(70000, 130000), sy: TAU / rand(70000, 130000),
        p1: rand(0, TAU), p2: rand(0, TAU), p3: rand(0, TAU),
        par: rand(6, 18), ox: 0, oy: 0
      });
    }
  }

  function fogPos(b) {
    return {
      x: b.hx + Math.sin(clock * b.sx * SPEED + b.p1) * b.ax - cursor.px * b.par + b.ox,
      y: b.hy + Math.cos(clock * b.sy * SPEED + b.p2) * b.ay - cursor.py * b.par * 0.5 + b.oy
    };
  }

  function drawFog(layer) {
    for (const b of fog) {
      if (b.layer !== layer) continue;
      const p = fogPos(b);
      const breathe = 0.8 + 0.2 * Math.sin(clock * 0.0003 * SPEED + b.p3);
      const a = b.a * breathe * intro * (layer ? 0.65 : 1) * (0.12 + 0.88 * calmAt(p.x, p.y));
      if (a < 0.004) continue;
      ctx.globalAlpha = a;
      ctx.save();
      ctx.translate(p.x, p.y);
      ctx.scale(b.rx, b.ry);
      ctx.fillStyle = fogGrads[b.variant];
      ctx.fillRect(-1, -1, 2, 2);
      ctx.restore();
    }
    ctx.globalAlpha = 1;
  }

  /* ================= FLUID FLOWS =================
     Each flow is a chain of soft blobs along a curved path that wraps around the
     centre. The path wanders with slow noise, so the shape keeps morphing. */
  function buildFlows() {
    flows = [];
    const n = W < 768 ? FLOW_COUNT_MOBILE : FLOW_COUNT;
    for (let i = 0; i < n; i++) {
      flows.push({
        th0: (i / n) * TAU + rand(-0.45, 0.45),   // where around the screen it starts
        span: rand(1.3, 2.3),                     // how far around it stretches (radians)
        rho: rand(FLOW_NEAR, FLOW_FAR),           // distance from centre
        slope: rand(-0.12, 0.12),                 // slight spiral
        s1: rand(0, 100), s2: rand(0, 100), s3: rand(0, 100),
        width: rand(0.75, 1.35),
        tint: (Math.random() * flowSprites.length) | 0,
        spin: rand(-1, 1) * 0.000004              // very slow rotation
      });
    }
  }

  function drawFlows() {
    if (FLOW_ALPHA <= 0 || !flows.length) return;
    const N = 22, t = clock * 0.00004 * FLOW_SPEED * SPEED;
    ctx.save();
    ctx.globalCompositeOperation = 'lighter';
    for (const f of flows) {
      const sprite = flowSprites[f.tint];
      for (let i = 0; i < N; i++) {
        const u = i / (N - 1);
        const th = f.th0 + clock * f.spin * SPEED + f.span * u + noise3(f.s1 + u * 1.3, t, 0) * 0.22 * FLOW_WOBBLE;
        const rho = f.rho + f.slope * (u - 0.5) + noise3(f.s2 + u * 1.6, t + 3.7, 7) * 0.13 * FLOW_WOBBLE;
        let x = W / 2 + Math.cos(th) * rho * W * 0.56;
        let y = H / 2 + Math.sin(th) * rho * H * 0.60;

        const taper = Math.sin(Math.PI * u);
        let r = FLOW_WIDTH * f.width * ui * (0.45 + 0.55 * taper) * (0.8 + 0.35 * noise3(f.s3 + u * 2, t + 9, 3));
        let boost = 1;

        if (cursor.k > 0.01 && FLOW_CURSOR > 0) {          // parts gently around the cursor
          const dx = x - cursor.x, dy = y - cursor.y, d2 = dx * dx + dy * dy, d = Math.sqrt(d2) || 1;
          const g = Math.exp(-d2 / (2 * 260 * 260)) * cursor.k * FLOW_CURSOR;
          x += dx / d * g * 70;
          y += dy / d * g * 70;
          boost = 1 + 0.6 * g;
        }

        const a = FLOW_ALPHA * intro * Math.pow(taper, 0.7) * boost * calmAt(x, y);
        if (a < 0.002) continue;
        ctx.globalAlpha = Math.min(a, 1);
        ctx.drawImage(sprite, x - r, y - r, r * 2, r * 2);
      }
    }
    ctx.restore();
  }

  /* ================= THIN FLUID LINES =================
     A few fine strands follow each flow, drifting apart and together like water.
     Near the cursor they bend away and swirl slightly, then settle back. */
  function drawFlowLines() {
    if (LINE_ALPHA <= 0 || !flows.length) return;
    const N = 40, K = LINE_STRANDS, t = clock * 0.00004 * FLOW_SPEED * SPEED;
    ctx.save();
    ctx.globalCompositeOperation = 'lighter';
    ctx.lineWidth = LINE_WIDTH;
    ctx.lineCap = 'butt';
    for (const f of flows) {
      const th = [], rh = [];
      for (let i = 0; i < N; i++) {
        const u = i / (N - 1);
        th.push(f.th0 + clock * f.spin * SPEED + f.span * u + noise3(f.s1 + u * 1.3, t, 0) * 0.22 * FLOW_WOBBLE);
        rh.push(f.rho + f.slope * (u - 0.5) + noise3(f.s2 + u * 1.6, t + 3.7, 7) * 0.13 * FLOW_WOBBLE);
      }
      for (let j = 0; j < K; j++) {
        const off = j - (K - 1) / 2;
        let px = 0, py = 0;
        for (let i = 0; i < N; i++) {
          const u = i / (N - 1);
          const rho = rh[i] + off * LINE_SPREAD * (0.55 + 0.45 * Math.sin(u * 5 + f.s3 + clock * 0.00025 * FLOW_SPEED * SPEED));
          let x = W / 2 + Math.cos(th[i]) * rho * W * 0.56;
          let y = H / 2 + Math.sin(th[i]) * rho * H * 0.60;
          let boost = 1;
          if (cursor.k > 0.01 && LINE_CURSOR > 0) {
            const dx = x - cursor.x, dy = y - cursor.y, d2 = dx * dx + dy * dy, d = Math.sqrt(d2) || 1;
            const g = Math.exp(-d2 / (2 * 240 * 240)) * cursor.k * LINE_CURSOR;
            x += dx / d * g * 60 - dy / d * g * 28;
            y += dy / d * g * 60 + dx / d * g * 28;
            boost = 1 + 0.9 * g;
          }
          if (i > 0) {
            const taper = Math.sin(Math.PI * (i - 0.5) / (N - 1));
            const a = LINE_ALPHA * intro * Math.pow(taper, 0.8) * boost * calmAt((x + px) / 2, (y + py) / 2);
            if (a > 0.004) {
              ctx.strokeStyle = `rgba(${LINE_COLOR}, ${Math.min(a, 1).toFixed(3)})`;
              ctx.beginPath();
              ctx.moveTo(px, py);
              ctx.lineTo(x, y);
              ctx.stroke();
            }
          }
          px = x; py = y;
        }
      }
    }
    ctx.restore();
  }

  /* ================= SPORES ================= */
  function spawnSpore(s, initial) {
    let x, y, tries = 0;
    do {
      x = rand(0, W);
      y = rand(0, H);
      tries++;
    } while (calmAt(x, y) < 0.45 && tries < 30);
    s.x = x; s.y = y; s.ox = 0; s.oy = 0;
    s.z = rand(0.25, 1);
    s.rad = lerp(5, 13, s.z * s.z);
    s.tint = Math.random() < 0.7 ? 0 : Math.random() < 0.7 ? 1 : 2;
    s.ph = rand(0, TAU);
    s.life = rand(SPORE_LIFE_MIN, SPORE_LIFE_MAX);
    s.age = initial ? rand(0, s.life) : 0;
  }
  function buildSpores() {
    spores = [];
    const n = W < 768 ? SPORE_COUNT_MOBILE : SPORE_COUNT;
    for (let i = 0; i < n; i++) { const s = {}; spawnSpore(s, true); spores.push(s); }
  }

  function updateSpores(dt) {
    const e = rate => 1 - Math.exp(-rate * dt / 1000);
    const t = clock * 0.00006 * SPEED;
    const k = dt / 1000 * SPEED * SPORE_SPEED;
    for (const s of spores) {
      s.age += dt / 1000;
      if (s.age > s.life || s.x < -40 || s.x > W + 40 || s.y < -40 || s.y > H + 40) { spawnSpore(s, false); continue; }

      // slow flowing drift + a little individual wobble
      const fx = noise3(s.x * 0.0018, s.y * 0.0018, t);
      const fy = noise3(s.x * 0.0018 + 50, s.y * 0.0018, t + 9);
      s.x += (fx * 14 * s.z + Math.sin(clock * 0.0009 + s.ph) * 7 * s.z) * k;
      s.y += (-(2 + 5 * s.z) + fy * 12 * s.z + Math.cos(clock * 0.0007 + s.ph * 1.3) * 5 * s.z) * k;

      // cursor: a small, bounded nudge that eases back quickly (never flings a dot away)
      let tx = 0, ty = 0;
      if (cursor.k > 0.01) {
        const dx = s.x - cursor.x, dy = s.y - cursor.y, d = Math.hypot(dx, dy);
        if (d < SPORE_CURSOR_RADIUS && d > 1) {
          const q = 1 - d / SPORE_CURSOR_RADIUS;
          const f = q * q * SPORE_CURSOR_PUSH * cursor.k;
          tx = dx / d * f; ty = dy / d * f;
        }
      }
      s.ox += (tx - s.ox) * e(3.5);
      s.oy += (ty - s.oy) * e(3.5);
    }
  }

  function drawSpores() {
    if (!spores.length) return;
    const sIntro = smooth(clock / 1200);                     // dots appear quickly
    ctx.save();
    ctx.globalCompositeOperation = 'lighter';
    for (const s of spores) {
      const env = smooth(s.age / 2) * smooth((s.life - s.age) / 2.5);
      const pulse = Math.max(0.15, 1 - 0.65 * SPORE_TWINKLE * (0.5 - 0.5 * Math.sin(clock * 0.0016 * SPEED + s.ph)));
      let a = SPORE_ALPHA * pulse * env * sIntro * (0.35 + 0.65 * s.z);
      const x = s.x + s.ox - cursor.px * s.z * 14, y = s.y + s.oy - cursor.py * s.z * 8;
      a *= 0.1 + 0.9 * calmAt(x, y);
      if (cursor.k > 0.01) {                                // they glow a little brighter near the cursor
        const dx = x - cursor.x, dy = y - cursor.y;
        a *= 1 + SPORE_CURSOR_GLOW * cursor.k * Math.exp(-(dx * dx + dy * dy) / (2 * 220 * 220));
      }
      if (a < 0.01) continue;
      ctx.globalAlpha = Math.min(a, 1);
      const r = s.rad * SPORE_SIZE * ui;
      ctx.drawImage(sporeSprites[s.tint], x - r, y - r, r * 2, r * 2);
    }
    ctx.restore();
  }

  /* ================= LIGHT ================= */
  function drawGlows() {
    for (const g of GLOWS) {
      const x = (g.x + Math.sin(clock * 0.00007 * SPEED + g.p) * 0.03) * W;
      const y = (g.y + Math.cos(clock * 0.00006 * SPEED + g.p * 1.7) * 0.03) * H;
      const r = g.r * Math.max(W, H);
      const gr = ctx.createRadialGradient(x, y, 0, x, y, r);
      gr.addColorStop(0, `rgba(${g.c}, ${g.a * intro})`);
      gr.addColorStop(0.5, `rgba(${g.c}, ${g.a * 0.35 * intro})`);
      gr.addColorStop(1, `rgba(${g.c}, 0)`);
      ctx.fillStyle = gr;
      ctx.fillRect(0, 0, W, H);
    }
  }

  // Dark pools over the centre and the text so it always stays calm
  function drawCalm() {
    const pool = (cx, cy, rx, ry, a) => {
      ctx.save();
      ctx.translate(cx, cy);
      ctx.scale(rx, ry);
      const g = ctx.createRadialGradient(0, 0, 0, 0, 0, 1);
      g.addColorStop(0, `rgba(1, 17, 28, ${a * intro})`);
      g.addColorStop(0.6, `rgba(1, 17, 28, ${a * 0.7 * intro})`);
      g.addColorStop(1, 'rgba(1, 17, 28, 0)');
      ctx.fillStyle = g;
      ctx.fillRect(-1, -1, 2, 2);
      ctx.restore();
    };
    pool(W / 2, H / 2, W * 0.36, H * 0.36, 0.35);
    for (const r of quiet) pool(r.cx, r.cy, r.hw + 130, r.hh + 100, 0.4);
  }

  function drawVignette() {
    const v = ctx.createRadialGradient(W / 2, H / 2, Math.min(W, H) * 0.4, W / 2, H / 2, Math.hypot(W / 2, H / 2));
    v.addColorStop(0, 'rgba(2, 6, 12, 0)');
    v.addColorStop(1, `rgba(2, 6, 12, ${0.45 * intro})`);
    ctx.fillStyle = v;
    ctx.fillRect(0, 0, W, H);
  }

  function drawGrain() {
    if (GRAIN <= 0 || !grainPattern) return;
    ctx.save();
    ctx.globalAlpha = GRAIN;
    ctx.fillStyle = grainPattern;
    ctx.fillRect(0, 0, W, H);
    ctx.restore();
  }

  /* ================= UPDATE + DRAW ================= */
  function step(dt) {
    const e = rate => 1 - Math.exp(-rate * dt / 1000);

    cursor.x += (cursor.tx - cursor.x) * e(4);
    cursor.y += (cursor.ty - cursor.y) * e(4);
    cursor.k += ((cursor.inside ? 1 : 0) - cursor.k) * e(2.2);
    const nx = W ? (cursor.x / W - 0.5) * 2 : 0, ny = H ? (cursor.y / H - 0.5) * 2 : 0;
    cursor.px += ((cursor.inside ? nx : 0) - cursor.px) * e(1.5);
    cursor.py += ((cursor.inside ? ny : 0) - cursor.py) * e(1.5);

    intro = smooth(clock / 3000);

    // the mist gently parts around the cursor
    for (const b of fog) {
      let tx = 0, ty = 0;
      if (cursor.k > 0.01) {
        const dx = b.hx - cursor.x, dy = b.hy - cursor.y, d = Math.hypot(dx, dy) || 1;
        const f = Math.exp(-(d * d) / (2 * 320 * 320)) * 46 * cursor.k;
        tx = dx / d * f; ty = dy / d * f * 0.6;
      }
      b.ox += (tx - b.ox) * e(1.2);
      b.oy += (ty - b.oy) * e(1.2);
    }
    updateSpores(dt);
  }

  function draw() {
    const bg = ctx.createRadialGradient(W / 2, H / 2, 0, W / 2, H / 2, Math.hypot(W / 2, H / 2));
    bg.addColorStop(0, BG_CENTER);
    bg.addColorStop(1, BG_EDGE);
    ctx.fillStyle = bg;
    ctx.fillRect(0, 0, W, H);

    drawGlows();
    drawFlows();
    drawFlowLines();
    drawFog(0);
    if (hasTrunks) {
      ctx.globalAlpha = intro;
      ctx.drawImage(trunkCv, -TRUNK_PAD - cursor.px * 8, -TRUNK_PAD - cursor.py * 4, W + TRUNK_PAD * 2, H + TRUNK_PAD * 2);
      ctx.globalAlpha = 1;
    }
    drawFog(1);
    drawCalm();
    drawSpores();
    drawVignette();
    drawGrain();
  }

  /* ================= LOOP ================= */
  let raf = 0, last = 0, visible = true;

  function frame(now) {
    raf = 0;
    if (!visible || document.hidden) { last = 0; return; }
    const dt = last ? Math.min(now - last, 50) : 16;
    last = now;
    clock += dt;
    step(dt);
    draw();
    raf = requestAnimationFrame(frame);
  }

  function start() {
    if (!raf && !reduce) { last = 0; raf = requestAnimationFrame(frame); }
  }

  /* ================= LAYOUT & EVENTS ================= */
  function layout(rebuild) {
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const w = hero.clientWidth, h = hero.clientHeight;
    const widthChanged = w !== W;
    canvas.width = Math.round(w * dpr);
    canvas.height = Math.round(h * dpr);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    W = w; H = h;
    ui = Math.max(0.55, Math.min(1.3, W / 1440));
    if (!grainPattern) grainPattern = ctx.createPattern(grainCv, 'repeat');
    measure();
    if (rebuild || widthChanged || !fog.length) {
      buildFog(); buildSpores(); buildFlows(); buildTrunks();
    }
    if (reduce) { step(0); draw(); }
  }

  const refresh = () => { measure(); if (reduce) { step(0); draw(); } };

  window.addEventListener('resize', () => layout(false));
  window.addEventListener('load', () => layout(true));
  hero.querySelectorAll('img').forEach(img => img.addEventListener('load', refresh));
  if (document.fonts && document.fonts.ready) document.fonts.ready.then(refresh);
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
