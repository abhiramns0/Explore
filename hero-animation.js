/* hero-animation.js  |  "Quiet Constellation"
   Draws on <canvas id="bg"> inside .hero-section.
   Layers: ambient light, flowing contour lines, sparse evolving connections.
   Text zones (title + paragraph) stay clear automatically. */
(() => {
  'use strict';

  /* ================= SETTINGS (safe to tweak) ================= */
  const COLOR  = '140, 200, 235';   // main colour (r, g, b)
  const ACCENT = '120, 225, 220';   // faint teal, used only for the travelling pulse
  const BG_CENTER = '#01131F';
  const BG_EDGE   = '#02060C';
  const SPEED = 1;                  // global motion speed (0.5 = half speed)

  // Quiet zone around text
  const QUIET_PADDING = 40;         // fully empty margin around the text (px)
  const QUIET_FADE    = 170;        // distance over which elements fade back in (px)

  // Nodes
  const NODE_COUNT = 16;
  const NODE_COUNT_MOBILE = 9;
  const NODE_MIN_GAP = 120;         // minimum distance between nodes (prevents clusters)
  const NODE_SIZE_MIN = 1.6;
  const NODE_SIZE_MAX = 4.4;
  const NODE_DRIFT = 8;             // how far a node wanders from its home (px)
  const NODE_LEAN  = 10;            // how far nodes lean toward the cursor (px)
  const NODE_ALPHA = 0.85;

  // Links between nodes
  const LINK_FIRST_MS = 4500;       // first link appears after this time
  const LINK_EVERY_MIN = 2400;      // new link every 2.4 to 4.2 seconds
  const LINK_EVERY_MAX = 4200;
  const LINK_MAX = 6;               // links alive at once
  const LINK_LIFE_MIN = 9000;
  const LINK_LIFE_MAX = 14000;
  const LINK_REACH = 340;           // longest allowed link (px)
  const LINK_ALPHA = 0.32;
  const PULSE_MS = 2200;            // travel time of the light pulse

  // Contour lines
  const LINES = 6;
  const LINE_ALPHA = 0.11;
  const LINE_WAVE = 1;              // wave height multiplier

  // Cursor
  const GLOW_RADIUS = 450;
  const GLOW_ALPHA = 0.045;
  const CURSOR_LINK_REACH = 260;
  const CURSOR_BEND = 30;           // how much contour lines bend around the cursor (px)

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

  let W = 0, H = 0;
  let clock = reduce ? 7000 : 0;    // own clock (ms), only advances while visible
  let intro = 0;
  let quiet = [];
  let nodes = [];
  let links = [];
  let nextLink = LINK_FIRST_MS;
  const cursor = { x: 0, y: 0, tx: 0, ty: 0, k: 0, inside: false };

  /* ================= QUIET ZONE ================= */
  function measure() {
    const hr = hero.getBoundingClientRect();
    quiet = [];
    document.querySelectorAll('.hero-heading, .hero-heading-image, .hero-description').forEach(el => {
      const r = el.getBoundingClientRect();
      if (r.width < 2 || r.height < 2) return;
      quiet.push({
        cx: r.left - hr.left + r.width / 2,
        cy: r.top - hr.top + r.height / 2,
        hw: r.width / 2,
        hh: r.height / 2
      });
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
    return smooth((d - QUIET_PADDING) / QUIET_FADE);
  }

  /* ================= NODES & LINKS ================= */
  function buildNodes() {
    nodes = [];
    links = [];
    nextLink = clock < 3000 ? LINK_FIRST_MS : clock + 2500;
    const count = W < 768 ? NODE_COUNT_MOBILE : NODE_COUNT;
    let tries = 0;
    while (nodes.length < count && tries++ < 4000) {
      const x = rand(0.03, 0.97) * W;
      const y = rand(0.04, 0.96) * H;
      if (mask(x, y) < 0.65) continue;
      if (nodes.some(o => Math.hypot(o.hx - x, o.hy - y) < NODE_MIN_GAP)) continue;
      nodes.push({
        hx: x, hy: y, x, y, ox: 0, oy: 0,
        r: NODE_SIZE_MIN + (NODE_SIZE_MAX - NODE_SIZE_MIN) * Math.pow(Math.random(), 1.5),
        p1: rand(0, TAU), p2: rand(0, TAU),
        s1: rand(0.00008, 0.00016), s2: rand(0.00008, 0.00016),
        intro: 0, ct: 0, cl: 0
      });
    }
  }

  const P = { x: 0, y: 0 };
  // Point on a curved link (quadratic curve). bow = how much it bends.
  function bez(ax, ay, bx, by, bow, t) {
    const cx = (ax + bx) / 2 - (by - ay) * bow;
    const cy = (ay + by) / 2 + (bx - ax) * bow;
    const u = 1 - t;
    P.x = u * u * ax + 2 * u * t * cx + t * t * bx;
    P.y = u * u * ay + 2 * u * t * cy + t * t * by;
  }

  function spawnLink() {
    if (links.length >= LINK_MAX) return false;
    const pool = nodes.filter(n => n.intro > 0.9 && mask(n.x, n.y) > 0.6);
    if (pool.length < 2) return false;
    for (let tries = 0; tries < 8; tries++) {
      const a = pool[(Math.random() * pool.length) | 0];
      const near = pool.filter(o => o !== a)
        .map(o => ({ o, d: Math.hypot(o.x - a.x, o.y - a.y) }))
        .sort((p, q) => p.d - q.d)
        .slice(0, 3);
      const pick = near[(Math.random() * near.length) | 0];
      if (!pick || pick.d > LINK_REACH) continue;
      const b = pick.o;
      if (links.some(l => (l.a === a && l.b === b) || (l.a === b && l.b === a))) continue;
      const bow = (Math.random() < 0.5 ? -1 : 1) * rand(0.15, 0.3);
      bez(a.x, a.y, b.x, b.y, bow, 0.5);
      if (mask(P.x, P.y) < 0.45) continue;   // never cross the text
      links.push({ a, b, bow, born: clock, life: rand(LINK_LIFE_MIN, LINK_LIFE_MAX), ph: rand(0, TAU) });
      return true;
    }
    return false;
  }

  /* ================= UPDATE ================= */
  function step(dt) {
    const e = rate => 1 - Math.exp(-rate * dt / 1000);

    cursor.x += (cursor.tx - cursor.x) * e(6);
    cursor.y += (cursor.ty - cursor.y) * e(6);
    cursor.k += ((cursor.inside ? 1 : 0) - cursor.k) * e(2.5);

    for (let i = 0; i < nodes.length; i++) {
      const n = nodes[i];
      n.intro = clamp01((clock - 1800 - i * 120) / 2200);
      const tx = n.hx + Math.sin(clock * SPEED * n.s1 + n.p1) * NODE_DRIFT;
      const ty = n.hy + Math.cos(clock * SPEED * n.s2 + n.p2) * NODE_DRIFT;
      let px = 0, py = 0;
      if (cursor.k > 0.01) {
        const dx = cursor.x - tx, dy = cursor.y - ty, d = Math.hypot(dx, dy);
        if (d < 280 && d > 1) {
          const f = (1 - d / 280) * NODE_LEAN * cursor.k;
          px = dx / d * f; py = dy / d * f;
        }
      }
      n.ox += (px - n.ox) * e(2);
      n.oy += (py - n.oy) * e(2);
      n.x = tx + n.ox;
      n.y = ty + n.oy;
      n.ct = 0;
    }

    // Cursor becomes a temporary node: link to the 3 nearest nodes
    if (cursor.k > 0.01) {
      nodes.filter(n => n.intro > 0.5)
        .map(n => ({ n, d: Math.hypot(n.x - cursor.x, n.y - cursor.y) }))
        .sort((p, q) => p.d - q.d)
        .slice(0, 3)
        .forEach(({ n, d }) => { if (d < CURSOR_LINK_REACH) n.ct = 1 - d / CURSOR_LINK_REACH; });
    }
    nodes.forEach(n => { n.cl += (n.ct - n.cl) * e(2); });

    if (!reduce) {
      if (clock >= nextLink) {
        nextLink = clock + (spawnLink() ? rand(LINK_EVERY_MIN, LINK_EVERY_MAX) : 900);
      }
      links = links.filter(l => clock - l.born < l.life);
    }
  }

  /* ================= DRAW ================= */
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
    const gr = ctx.createRadialGradient(cursor.x, cursor.y, 0, cursor.x, cursor.y, GLOW_RADIUS);
    gr.addColorStop(0, `rgba(90, 170, 220, ${GLOW_ALPHA * cursor.k})`);
    gr.addColorStop(0.5, `rgba(90, 170, 220, ${GLOW_ALPHA * 0.4 * cursor.k})`);
    gr.addColorStop(1, 'rgba(90, 170, 220, 0)');
    ctx.fillStyle = gr;
    ctx.fillRect(0, 0, W, H);
  }

  function lineY(x, i, base) {
    const t = clock * SPEED;
    let y = base
      + Math.sin(x * 0.0042 + t * 0.00013 + i * 1.3) * 22 * LINE_WAVE
      + Math.sin(x * 0.0012 - t * 0.00008 + i * 2.1) * 42 * LINE_WAVE;
    if (cursor.k > 0.01) {
      const dx = x - cursor.x, dy = y - cursor.y, d = Math.hypot(dx, dy);
      if (d < 220) {
        const f = 1 - d / 220;
        y += Math.tanh(dy / 50) * f * f * CURSOR_BEND * cursor.k;
      }
    }
    return y;
  }

  function drawLines() {
    const STEP = 14;
    ctx.lineWidth = 0.9;
    for (let i = 0; i < LINES; i++) {
      const base = H * (0.08 + i * (0.84 / (LINES - 1)));
      const baseA = LINE_ALPHA * (0.75 + 0.25 * ((i * 7) % 3) / 2) * intro;
      let px = 0, py = lineY(0, i, base);
      for (let x = STEP; x <= W + STEP; x += STEP) {
        const y = lineY(x, i, base);
        const mx = (x + px) / 2, my = (y + py) / 2;
        const shimmer = 0.7 + 0.3 * Math.sin(mx * 0.003 - clock * 0.0002 * SPEED + i * 1.7);
        const a = baseA * shimmer * mask(mx, my);
        if (a > 0.005) {
          ctx.strokeStyle = `rgba(${COLOR}, ${a})`;
          ctx.beginPath();
          ctx.moveTo(px, py);
          ctx.lineTo(x, y);
          ctx.stroke();
        }
        px = x; py = y;
      }
    }
  }

  // Curved line drawn in small pieces so it can fade out near the text
  function drawCurve(ax, ay, bx, by, bow, alpha, color, width) {
    const S = 18;
    let px = ax, py = ay;
    ctx.lineWidth = width;
    for (let i = 1; i <= S; i++) {
      bez(ax, ay, bx, by, bow, i / S);
      const x = P.x, y = P.y;
      const a = mask((x + px) / 2, (y + py) / 2) * alpha;
      if (a > 0.01) {
        ctx.strokeStyle = `rgba(${color}, ${a})`;
        ctx.beginPath();
        ctx.moveTo(px, py);
        ctx.lineTo(x, y);
        ctx.stroke();
      }
      px = x; py = y;
    }
  }

  function drawLinks() {
    for (const l of links) {
      const age = clock - l.born;
      const env = smooth(age / 1500) * smooth((l.life - age) / 2500);
      const bow = l.bow + Math.sin(clock * 0.0003 * SPEED + l.ph) * 0.04;
      const a = LINK_ALPHA * env * Math.min(l.a.intro, l.b.intro);
      drawCurve(l.a.x, l.a.y, l.b.x, l.b.y, bow, a, COLOR, 0.9);

      if (age < PULSE_MS) {
        const p = age / PULSE_MS;
        bez(l.a.x, l.a.y, l.b.x, l.b.y, bow, p * p * (3 - 2 * p));
        const pa = Math.sin(Math.PI * p) * 0.8 * mask(P.x, P.y);
        if (pa > 0.01) {
          const g = ctx.createRadialGradient(P.x, P.y, 0, P.x, P.y, 16);
          g.addColorStop(0, `rgba(${ACCENT}, ${pa})`);
          g.addColorStop(1, `rgba(${ACCENT}, 0)`);
          ctx.fillStyle = g;
          ctx.beginPath();
          ctx.arc(P.x, P.y, 16, 0, TAU);
          ctx.fill();
        }
      }
    }
  }

  function drawCursorLinks() {
    if (cursor.k < 0.01) return;
    nodes.forEach((n, i) => {
      if (n.cl < 0.01) return;
      drawCurve(cursor.x, cursor.y, n.x, n.y, i % 2 ? 0.12 : -0.12, n.cl * 0.45 * cursor.k, COLOR, 0.8);
    });
  }

  function drawNodes() {
    for (const n of nodes) {
      const a = n.intro * NODE_ALPHA * mask(n.x, n.y);
      if (a < 0.01) continue;
      const rad = n.r * 7;
      const g = ctx.createRadialGradient(n.x, n.y, 0, n.x, n.y, rad);
      g.addColorStop(0, `rgba(${COLOR}, ${0.9 * a})`);
      g.addColorStop(0.12, `rgba(${COLOR}, ${0.55 * a})`);
      g.addColorStop(0.3, `rgba(${COLOR}, ${0.14 * a})`);
      g.addColorStop(1, `rgba(${COLOR}, 0)`);
      ctx.fillStyle = g;
      ctx.beginPath();
      ctx.arc(n.x, n.y, rad, 0, TAU);
      ctx.fill();
    }
  }

  function draw() {
    intro = smooth(clock / 2500);
    const bg = ctx.createRadialGradient(W / 2, H / 2, 0, W / 2, H / 2, Math.hypot(W / 2, H / 2));
    bg.addColorStop(0, BG_CENTER);
    bg.addColorStop(1, BG_EDGE);
    ctx.fillStyle = bg;
    ctx.fillRect(0, 0, W, H);

    drawGlows();
    drawCursorGlow();
    drawLines();
    drawLinks();
    drawCursorLinks();
    drawNodes();
  }

  /* ================= LOOP ================= */
  let raf = 0, last = 0, visible = true;

  function frame(now) {
    raf = 0;
    if (!visible) { last = 0; return; }
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
    const oldH = H, widthChanged = w !== W;
    canvas.width = Math.round(w * dpr);
    canvas.height = Math.round(h * dpr);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    W = w; H = h;
    measure();
    if (rebuild || widthChanged || !nodes.length) buildNodes();
    else if (oldH) nodes.forEach(n => { n.hy *= h / oldH; });
    if (reduce) { step(0); draw(); }
  }

  window.addEventListener('resize', () => layout(false));
  window.addEventListener('load', () => layout(true));
  if (document.fonts && document.fonts.ready) document.fonts.ready.then(() => layout(true));

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
