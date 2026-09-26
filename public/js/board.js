/*
 * Ticket to Ride – Europe board renderer (SVG).
 *
 *   const board = TTRBoard.create(containerElement, { land, interactive: true });
 *   board.setState({ claims: { routeId: 'red' }, stations: { cityId: 'blue' },
 *                    scores: [{ color: 'red', score: 12 }], highlight: { routes: [], cities: [] } });
 *   board.on('route', (route) => ...);  board.on('city', (city) => ...);
 *
 * Needs map-data.js (window.TTR_MAP) and the warped geography from data/land.json.
 */
(function (root) {
  'use strict';

  const NS = 'http://www.w3.org/2000/svg';
  const MAP = root.TTR_MAP;
  const { BOARD, cities, routes, ROUTE_POINTS } = MAP;
  const W = BOARD.width, H = BOARD.height, T = BOARD.track;

  // margin: distance from a city centre to the first car; busy cities push it up to maxMargin.
  const CAR = { width: 13, maxLength: 47, gap: 4, margin: 13, maxMargin: 30, clearance: 0.8, laneGap: 1.6 };

  const SLOT_COLORS = {
    red: '#d0342c', orange: '#ec8a24', yellow: '#f1cf36', green: '#5aa83c', blue: '#2f8fd0',
    purple: '#a266bf', black: '#3a3d42', white: '#f4f2ea', gray: '#a9aaa6',
  };
  const PLAYER_COLORS = {
    red: '#c62828', blue: '#1565c0', green: '#2e7d32', yellow: '#f9b700', black: '#1d1d1f',
  };

  // ---------------------------------------------------------------- geometry helpers
  const dist = (a, b) => Math.hypot(b[0] - a[0], b[1] - a[1]);

  function polyLength(pts) {
    let L = 0;
    for (let i = 1; i < pts.length; i++) L += dist(pts[i - 1], pts[i]);
    return L;
  }

  // Centripetal Catmull–Rom through all points, sampled into a polyline.
  function spline(points, perSeg = 24) {
    if (points.length === 2) {
      const [a, b] = points, out = [];
      for (let i = 0; i <= perSeg; i++) out.push([a[0] + (b[0] - a[0]) * i / perSeg, a[1] + (b[1] - a[1]) * i / perSeg]);
      return out;
    }
    const n = points.length;
    const ext = [
      [2 * points[0][0] - points[1][0], 2 * points[0][1] - points[1][1]],
      ...points,
      [2 * points[n - 1][0] - points[n - 2][0], 2 * points[n - 1][1] - points[n - 2][1]],
    ];
    const knot = (a, b) => Math.max(Math.sqrt(dist(a, b)), 1e-4);
    const lerp = (a, b, ta, tb, t) => {
      const u = (t - ta) / (tb - ta);
      return [a[0] + (b[0] - a[0]) * u, a[1] + (b[1] - a[1]) * u];
    };
    const out = [];
    for (let i = 1; i < ext.length - 2; i++) {
      const [p0, p1, p2, p3] = [ext[i - 1], ext[i], ext[i + 1], ext[i + 2]];
      const t0 = 0, t1 = t0 + knot(p0, p1), t2 = t1 + knot(p1, p2), t3 = t2 + knot(p2, p3);
      for (let s = 0; s < perSeg; s++) {
        const t = t1 + (t2 - t1) * s / perSeg;
        const a1 = lerp(p0, p1, t0, t1, t), a2 = lerp(p1, p2, t1, t2, t), a3 = lerp(p2, p3, t2, t3, t);
        const b1 = lerp(a1, a2, t0, t2, t), b2 = lerp(a2, a3, t1, t3, t);
        out.push(lerp(b1, b2, t1, t2, t));
      }
    }
    out.push(points[n - 1]);
    return out;
  }

  function quadratic(a, c, b, n = 32) {
    const out = [];
    for (let i = 0; i <= n; i++) {
      const t = i / n, u = 1 - t;
      out.push([u * u * a[0] + 2 * u * t * c[0] + t * t * b[0], u * u * a[1] + 2 * u * t * c[1] + t * t * b[1]]);
    }
    return out;
  }

  function offsetPoly(pts, d) {
    if (!d) return pts;
    return pts.map((p, i) => {
      const a = pts[Math.max(0, i - 1)], b = pts[Math.min(pts.length - 1, i + 1)];
      const len = dist(a, b) || 1;
      return [p[0] - (b[1] - a[1]) / len * d, p[1] + (b[0] - a[0]) / len * d];
    });
  }

  function pointAt(pts, cum, s) {
    s = Math.max(0, Math.min(cum[cum.length - 1], s));
    let i = 1;
    while (i < cum.length - 1 && cum[i] < s) i++;
    const seg = cum[i] - cum[i - 1] || 1, u = (s - cum[i - 1]) / seg;
    return [pts[i - 1][0] + (pts[i][0] - pts[i - 1][0]) * u, pts[i - 1][1] + (pts[i][1] - pts[i - 1][1]) * u];
  }

  function cumulative(pts) {
    const cum = [0];
    for (let i = 1; i < pts.length; i++) cum.push(cum[i - 1] + dist(pts[i - 1], pts[i]));
    return cum;
  }

  // Centre line of a route between its two cities (before lane offset).
  function centerLine(route) {
    const A = [cities[route.a].x, cities[route.a].y], B = [cities[route.b].x, cities[route.b].y];
    if (route.via) return spline([A, ...route.via, B]);
    const need = route.length * (38 + CAR.gap) + 2 * CAR.margin;
    const d = dist(A, B);
    if (d >= need || !route.bend) return spline([A, B]);
    // Bow the track sideways until it is long enough for all of its cars.
    const mid = [(A[0] + B[0]) / 2, (A[1] + B[1]) / 2];
    const nx = -(B[1] - A[1]) / d, ny = (B[0] - A[0]) / d;
    let lo = 0, hi = d;
    for (let k = 0; k < 30; k++) {
      const h = (lo + hi) / 2;
      const L = polyLength(quadratic(A, [mid[0] + nx * h * route.bend, mid[1] + ny * h * route.bend], B));
      if (L < need) lo = h; else hi = h;
    }
    return quadratic(A, [mid[0] + nx * hi * route.bend, mid[1] + ny * hi * route.bend], B);
  }

  function laneLine(route) {
    return offsetPoly(centerLine(route), route.lane * (CAR.width / 2 + CAR.laneGap));
  }

  function distToPoly(p, pts) {
    let best = Infinity;
    for (let i = 1; i < pts.length; i++) {
      const [ax, ay] = pts[i - 1], [bx, by] = pts[i];
      const dx = bx - ax, dy = by - ay, l2 = dx * dx + dy * dy;
      const t = l2 ? Math.max(0, Math.min(1, ((p[0] - ax) * dx + (p[1] - ay) * dy) / l2)) : 0;
      best = Math.min(best, Math.hypot(ax + t * dx - p[0], ay + t * dy - p[1]));
    }
    return best;
  }

  // Part of a lane between `from` and `to` (distance along it, measured from its start).
  function slice(pts, from, to) {
    const cum = cumulative(pts), out = [pointAt(pts, cum, from)];
    for (let i = 0; i < pts.length; i++) if (cum[i] > from && cum[i] < to) out.push(pts[i]);
    out.push(pointAt(pts, cum, to));
    return out;
  }

  /*
   * Where the first car starts at each end of each lane. Lanes that leave a busy city in similar
   * directions start further out, so that their first cars don't touch.
   */
  function endMargins(lines) {
    const ends = {};
    for (const r of routes) {
      const pts = lines[r.id];
      for (const [city, oriented] of [[r.a, pts], [r.b, pts.slice().reverse()]]) {
        (ends[city] = ends[city] || []).push({ r, pts: oriented, near: slice(oriented, CAR.margin, CAR.margin + 70) });
      }
    }
    const margins = {};
    for (const list of Object.values(ends)) {
      for (const A of list) {
        const cum = cumulative(A.pts);
        let m = CAR.margin, by = null;
        for (const B of list) {
          if (B === A || B.r.twin === A.r.id) continue;
          const need = CAR.width + CAR.clearance + (A.r.tunnel ? 1.6 : 0) + (B.r.tunnel ? 1.6 : 0);
          let s = m;
          while (s < CAR.maxMargin && distToPoly(pointAt(A.pts, cum, s), B.near) < need) s += 1;
          if (s > m) { m = s; by = B.r.id; }
        }
        const key = A.r.id + '@' + (A.pts === lines[A.r.id] ? 'a' : 'b');
        margins[key] = m;
        if (by) margins[key + ':by'] = by; // which neighbouring lane pushed the cars out (debug aid)
      }
    }
    return margins;
  }

  // Slot rectangles (centre, angle, length) for every car of a route.
  function layoutRoute(route, line = laneLine(route), m0 = CAR.margin, m1 = CAR.margin) {
    const cum = cumulative(line), L = cum[cum.length - 1];
    const s0 = m0, s1 = L - m1, pitch = (s1 - s0) / route.length;
    const len = Math.min(pitch - CAR.gap, CAR.maxLength);
    if (len < 32 && root.console) console.warn('Route ' + route.id + ' is cramped: car length ' + len.toFixed(1));
    const slots = [];
    for (let i = 0; i < route.length; i++) {
      const s = s0 + pitch * (i + 0.5);
      const p = pointAt(line, cum, s - len / 2), q = pointAt(line, cum, s + len / 2);
      slots.push({
        x: (p[0] + q[0]) / 2, y: (p[1] + q[1]) / 2, len,
        angle: Math.atan2(q[1] - p[1], q[0] - p[0]) * 180 / Math.PI,
      });
    }
    // Hit/highlight path trimmed to the car span.
    const trimmed = line.filter((_, i) => cum[i] >= s0 - 1 && cum[i] <= s1 + 1);
    return { slots, line: trimmed.length > 1 ? trimmed : line };
  }

  // ---------------------------------------------------------------- svg helpers
  function el(name, attrs, parent) {
    const e = document.createElementNS(NS, name);
    if (attrs) for (const k in attrs) if (attrs[k] !== undefined && attrs[k] !== null) e.setAttribute(k, attrs[k]);
    if (parent) parent.appendChild(e);
    return e;
  }
  const fx = (v) => Math.round(v * 10) / 10;
  const pathD = (pts) => 'M' + pts.map((p) => fx(p[0]) + ' ' + fx(p[1])).join('L');

  function paperTexture() {
    // Small tileable speckle texture generated once, used as a pattern over land and frame.
    const size = 160, c = document.createElement('canvas');
    c.width = c.height = size;
    const g = c.getContext('2d');
    const img = g.createImageData(size, size);
    let seed = 7;
    const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
    for (let i = 0; i < size * size; i++) {
      const v = rnd();
      img.data[i * 4] = 90; img.data[i * 4 + 1] = 60; img.data[i * 4 + 2] = 30;
      img.data[i * 4 + 3] = v < 0.5 ? v * 36 : 0;
    }
    g.putImageData(img, 0, 0);
    for (let k = 0; k < 18; k++) {
      const x = rnd() * size, y = rnd() * size, r = 8 + rnd() * 26;
      // Draw every blotch at all 9 wrap offsets so the tile repeats seamlessly.
      for (const ox of [-size, 0, size]) {
        for (const oy of [-size, 0, size]) {
          const grad = g.createRadialGradient(x + ox, y + oy, 0, x + ox, y + oy, r);
          grad.addColorStop(0, 'rgba(120,80,40,0.07)'); grad.addColorStop(1, 'rgba(120,80,40,0)');
          g.fillStyle = grad;
          g.beginPath(); g.arc(x + ox, y + oy, r, 0, Math.PI * 2); g.fill();
        }
      }
    }
    return c.toDataURL();
  }

  function buildDefs(svg) {
    const defs = el('defs', null, svg);
    defs.innerHTML = `
      <pattern id="ttr-waves" width="46" height="22" patternUnits="userSpaceOnUse">
        <path d="M2 8 q5.5 -4 11 0 t11 0" fill="none" stroke="#ffffff" stroke-opacity="0.28" stroke-width="1"/>
        <path d="M25 19 q5.5 -4 11 0 t11 0" fill="none" stroke="#2c6a80" stroke-opacity="0.12" stroke-width="1"/>
      </pattern>
      <pattern id="ttr-paper" width="160" height="160" patternUnits="userSpaceOnUse">
        <image href="${paperTexture()}" width="160" height="160"/>
      </pattern>
      <radialGradient id="ttr-sea" cx="50%" cy="45%" r="75%">
        <stop offset="0" stop-color="#c9e0e4"/><stop offset="1" stop-color="#a8c8d1"/>
      </radialGradient>
      <radialGradient id="ttr-land" cx="55%" cy="45%" r="70%">
        <stop offset="0" stop-color="#f1e4c3"/><stop offset="0.7" stop-color="#e8d5ad"/><stop offset="1" stop-color="#dcc497"/>
      </radialGradient>
      <radialGradient id="ttr-vignette" cx="50%" cy="50%" r="72%">
        <stop offset="0.62" stop-color="#5a3a18" stop-opacity="0"/><stop offset="1" stop-color="#5a3a18" stop-opacity="0.28"/>
      </radialGradient>
      <radialGradient id="ttr-city" cx="38%" cy="35%" r="70%">
        <stop offset="0" stop-color="#ffe19a"/><stop offset="0.45" stop-color="#f09a2e"/><stop offset="1" stop-color="#a4460f"/>
      </radialGradient>
      <radialGradient id="ttr-halo" cx="50%" cy="50%" r="50%">
        <stop offset="0" stop-color="#fff6e0" stop-opacity="0.95"/><stop offset="0.75" stop-color="#f6e3bd" stop-opacity="0.75"/>
        <stop offset="1" stop-color="#e9cf9c" stop-opacity="0.35"/>
      </radialGradient>
      <linearGradient id="ttr-shade" x1="0" y1="0" x2="0" y2="1">
        <stop offset="0" stop-color="#fff" stop-opacity="0.38"/><stop offset="0.45" stop-color="#fff" stop-opacity="0"/>
        <stop offset="1" stop-color="#000" stop-opacity="0.22"/>
      </linearGradient>
      <radialGradient id="ttr-cell" cx="40%" cy="35%" r="70%">
        <stop offset="0" stop-color="#5b9db0"/><stop offset="0.6" stop-color="#2b6377"/><stop offset="1" stop-color="#173e4d"/>
      </radialGradient>
      <linearGradient id="ttr-frame" x1="0" y1="0" x2="1" y2="1">
        <stop offset="0" stop-color="#2f4d5c"/><stop offset="0.5" stop-color="#27414f"/><stop offset="1" stop-color="#1e3542"/>
      </linearGradient>
      <filter id="ttr-shadow" x="-30%" y="-30%" width="160%" height="160%">
        <feDropShadow dx="0.8" dy="1.4" stdDeviation="1.1" flood-color="#000" flood-opacity="0.45"/>
      </filter>
      <filter id="ttr-glow" x="-50%" y="-50%" width="200%" height="200%">
        <feGaussianBlur stdDeviation="3.5"/>
      </filter>
      <symbol id="ttr-loco" viewBox="0 0 24 14">
        <path d="M1 11h20l2-2V8h-5V4h2V2h-7v2h1v4h-3V3H5v5H3V5H1z" fill="#3a2a1a"/>
        <circle cx="6" cy="12" r="2" fill="#3a2a1a"/><circle cx="12" cy="12" r="2" fill="#3a2a1a"/>
        <circle cx="18" cy="12" r="2" fill="#3a2a1a"/>
      </symbol>
      <clipPath id="ttr-mapclip"><rect x="${T}" y="${T}" width="${W - 2 * T}" height="${H - 2 * T}"/></clipPath>`;
    return defs;
  }

  // ---------------------------------------------------------------- static layers
  function drawGeography(g, land) {
    el('rect', { x: 0, y: 0, width: W, height: H, fill: 'url(#ttr-sea)' }, g);
    el('rect', { x: 0, y: 0, width: W, height: H, fill: 'url(#ttr-waves)' }, g);
    if (!land) return;
    // Coastal ripples: wide strokes under the land fill only show on the sea side.
    el('path', { d: land.land, fill: 'none', stroke: '#8fb6c3', 'stroke-width': 16, 'stroke-opacity': 0.35, 'stroke-linejoin': 'round' }, g);
    el('path', { d: land.land, fill: 'none', stroke: '#e3eff1', 'stroke-width': 7, 'stroke-opacity': 0.7, 'stroke-linejoin': 'round' }, g);
    el('path', { d: land.land, fill: 'url(#ttr-land)' }, g);
    el('path', { d: land.land, fill: 'url(#ttr-paper)' }, g);
    el('path', { d: land.borders, fill: 'none', stroke: '#9a5f3e', 'stroke-opacity': 0.55, 'stroke-width': 0.9, 'stroke-dasharray': '4 2.5' }, g);
    el('path', { d: land.land, fill: 'none', stroke: '#5b3f25', 'stroke-width': 1.1, 'stroke-linejoin': 'round' }, g);
  }

  function drawLegend(g) {
    const x = 372, y = 62, w = 152, h = 118;
    const box = el('g', { class: 'ttr-legend', transform: `translate(${x},${y})` }, g);
    el('rect', { x: 0, y: 0, width: w, height: h, rx: 6, fill: '#f4e8cb', stroke: '#6b4a2c', 'stroke-width': 1.4, filter: 'url(#ttr-shadow)' }, box);
    el('rect', { x: 3.5, y: 3.5, width: w - 7, height: h - 7, rx: 4, fill: 'none', stroke: '#b38b52', 'stroke-width': 0.8 }, box);
    const rows = [1, 2, 3, 4, 6, 8];
    rows.forEach((n, i) => {
      const ry = 16 + i * 17;
      const t = el('text', { x: 12, y: ry + 4, class: 'ttr-legend-num' }, box);
      t.textContent = n;
      for (let k = 0; k < n; k++) {
        el('rect', { x: 26 + k * 10, y: ry - 3, width: 8.5, height: 6.5, rx: 1.2, fill: '#8a8f93', stroke: '#3b2a1a', 'stroke-width': 0.7 }, box);
      }
      const p = el('text', { x: w - 12, y: ry + 4, class: 'ttr-legend-pts', 'text-anchor': 'end' }, box);
      p.textContent = ROUTE_POINTS[n];
    });
  }

  function drawCompass(g) {
    const c = el('g', { class: 'ttr-compass', transform: 'translate(104,612)', opacity: 0.8 }, g);
    el('circle', { r: 36, fill: 'none', stroke: '#5b3f25', 'stroke-width': 1 }, c);
    el('circle', { r: 31, fill: 'none', stroke: '#5b3f25', 'stroke-width': 0.6, 'stroke-dasharray': '1.5 2.5' }, c);
    for (let k = 0; k < 8; k++) {
      const long = k % 2 === 0, r = long ? 44 : 26, a = k * Math.PI / 4;
      const tip = [Math.sin(a) * r, -Math.cos(a) * r];
      const l = [Math.sin(a - Math.PI / 2) * 5, -Math.cos(a - Math.PI / 2) * 5];
      const rr = [-l[0], -l[1]];
      el('path', { d: `M0 0L${fx(l[0])} ${fx(l[1])}L${fx(tip[0])} ${fx(tip[1])}Z`, fill: long ? '#5b3f25' : '#8c6a45' }, c);
      el('path', { d: `M0 0L${fx(rr[0])} ${fx(rr[1])}L${fx(tip[0])} ${fx(tip[1])}Z`, fill: long ? '#e9d6ae' : '#f1e4c6', stroke: '#5b3f25', 'stroke-width': 0.5 }, c);
    }
    const n = el('text', { x: 0, y: -48, 'text-anchor': 'middle', class: 'ttr-compass-n' }, c);
    n.textContent = 'N';
  }

  function trackCells() {
    const cells = [], side = (H - 2 * T) / 20, top = (W - 2 * T) / 28;
    for (let i = 0; i < 100; i++) {
      let x, y;
      if (i === 0) [x, y] = [T / 2, H - T / 2];
      else if (i <= 20) [x, y] = [T / 2, H - T - (i - 0.5) * side];
      else if (i === 21) [x, y] = [T / 2, T / 2];
      else if (i <= 49) [x, y] = [T + (i - 22 + 0.5) * top, T / 2];
      else if (i === 50) [x, y] = [W - T / 2, T / 2];
      else if (i <= 70) [x, y] = [W - T / 2, T + (i - 51 + 0.5) * side];
      else if (i === 71) [x, y] = [W - T / 2, H - T / 2];
      else [x, y] = [W - T - (i - 72 + 0.5) * top, H - T / 2];
      cells.push({ i, x, y, corner: i === 0 || i === 21 || i === 50 || i === 71 });
    }
    return cells;
  }

  function drawFrame(g, cells) {
    const frame = el('path', {
      d: `M0 0H${W}V${H}H0Z M${T} ${T}V${H - T}H${W - T}V${T}Z`,
      fill: 'url(#ttr-frame)', 'fill-rule': 'evenodd',
    }, g);
    frame.setAttribute('class', 'ttr-frame');
    el('rect', { x: 1.5, y: 1.5, width: W - 3, height: H - 3, fill: 'none', stroke: '#c9a55a', 'stroke-width': 1.5 }, g);
    el('rect', { x: T - 1, y: T - 1, width: W - 2 * T + 2, height: H - 2 * T + 2, fill: 'none', stroke: '#c9a55a', 'stroke-width': 2 }, g);
    el('rect', { x: T + 2.5, y: T + 2.5, width: W - 2 * T - 5, height: H - 2 * T - 5, fill: 'none', stroke: '#6b4a2c', 'stroke-width': 0.8, 'stroke-opacity': 0.6 }, g);
    for (const c of cells) {
      const r = c.corner ? 14.5 : 12.5;
      el('circle', { cx: c.x, cy: c.y, r: r + 1.6, fill: '#c9a55a', 'fill-opacity': c.i % 5 === 0 ? 1 : 0.45 }, g);
      el('circle', { cx: c.x, cy: c.y, r, fill: 'url(#ttr-cell)', class: 'ttr-cell', 'data-score': c.i }, g);
      const t = el('text', { x: c.x, y: c.y + 4, 'text-anchor': 'middle', class: 'ttr-cell-num' + (c.corner ? ' corner' : '') }, g);
      t.textContent = c.i;
    }
  }

  function drawRoutes(g, layout) {
    for (const r of routes) {
      const grp = el('g', { class: 'ttr-route' + (r.tunnel ? ' tunnel' : '') + (r.ferry ? ' ferry' : ''), 'data-route': r.id }, g);
      const { slots, line } = layout[r.id];
      el('path', { d: pathD(line), class: 'ttr-route-glow' }, grp);
      const locoAt = new Set();
      if (r.ferry) {
        // Spread the locomotive symbols evenly over the cars.
        for (let k = 0; k < r.ferry; k++) locoAt.add(Math.round((k + 0.5) * r.length / r.ferry - 0.5));
      }
      slots.forEach((s, i) => {
        const car = el('g', { transform: `translate(${fx(s.x)},${fx(s.y)}) rotate(${fx(s.angle)})` }, grp);
        const hw = s.len / 2, hh = CAR.width / 2;
        if (r.tunnel) {
          el('rect', { x: -hw - 1.6, y: -hh - 1.6, width: s.len + 3.2, height: CAR.width + 3.2, rx: 2.5, class: 'ttr-tunnel' }, car);
        }
        el('rect', { x: -hw, y: -hh, width: s.len, height: CAR.width, rx: 2.4, fill: SLOT_COLORS[r.color], class: 'ttr-slot' }, car);
        el('rect', { x: -hw, y: -hh, width: s.len, height: CAR.width, rx: 2.4, fill: 'url(#ttr-shade)', 'pointer-events': 'none' }, car);
        if (locoAt.has(i)) {
          el('rect', { x: -8, y: -4.6, width: 16, height: 9.2, rx: 1.6, fill: '#f7efd9', stroke: '#3a2a1a', 'stroke-width': 0.6 }, car);
          el('use', { href: '#ttr-loco', x: -6.8, y: -3.6, width: 13.6, height: 7.6 }, car);
        }
      });
      el('path', { d: pathD(line), class: 'ttr-route-hit' }, grp);
    }
  }

  const LABEL_OFFSETS = {
    n: [0, -14, 'middle'], s: [0, 23, 'middle'], e: [13, 5, 'start'], w: [-13, 5, 'end'],
    ne: [9, -10, 'start'], nw: [-9, -10, 'end'], se: [9, 21, 'start'], sw: [-9, 21, 'end'],
  };

  function drawCities(gCities, gLabels) {
    for (const c of Object.values(cities)) {
      const cg = el('g', { class: 'ttr-city', 'data-city': c.id, transform: `translate(${c.x},${c.y})` }, gCities);
      el('circle', { r: 16.5, class: 'ttr-city-halo' }, cg);
      el('circle', { r: 7.6, fill: 'url(#ttr-city)', class: 'ttr-city-dot' }, cg);
      const [dx, dy, anchor] = Array.isArray(c.label) ? c.label : LABEL_OFFSETS[c.label] || LABEL_OFFSETS.n;
      const t = el('text', { x: c.x + dx, y: c.y + dy, 'text-anchor': anchor, class: 'ttr-city-label', 'data-city': c.id }, gLabels);
      t.textContent = c.name;
    }
  }

  // ---------------------------------------------------------------- dynamic layers
  function drawTrain(g, slot, color) {
    const car = el('g', { transform: `translate(${fx(slot.x)},${fx(slot.y)}) rotate(${fx(slot.angle)})`, filter: 'url(#ttr-shadow)' }, g);
    const len = slot.len + 0.5, w = CAR.width + 1;
    el('rect', { x: -len / 2, y: -w / 2, width: len, height: w, rx: 3, fill: PLAYER_COLORS[color] || color, class: 'ttr-train' }, car);
    el('rect', { x: -len / 2, y: -w / 2, width: len, height: w, rx: 3, fill: 'url(#ttr-shade)' }, car);
    for (const ox of [-len / 4, len / 4]) {
      el('rect', { x: ox - 3.5, y: -2, width: 7, height: 4, rx: 0.8, fill: '#ffffff', 'fill-opacity': 0.55 }, car);
    }
  }

  function drawStation(g, city, color) {
    const s = el('g', { class: 'ttr-station', transform: `translate(${city.x},${city.y - 2})`, filter: 'url(#ttr-shadow)' }, g);
    el('path', {
      d: 'M-8 7V-2L0 -10L8 -2V7Z', fill: PLAYER_COLORS[color] || color, stroke: '#fff', 'stroke-width': 1.4, 'stroke-linejoin': 'round',
    }, s);
    el('rect', { x: -2.4, y: 1, width: 4.8, height: 6, fill: '#fff', 'fill-opacity': 0.7 }, s);
  }

  function drawMarkers(g, cells, scores) {
    const byCell = {};
    for (const s of scores || []) {
      const idx = ((s.score % 100) + 100) % 100;
      (byCell[idx] = byCell[idx] || []).push(s);
    }
    for (const idx in byCell) {
      const list = byCell[idx], c = cells[idx];
      list.forEach((s, k) => {
        const a = (k / list.length) * Math.PI * 2 - Math.PI / 2, off = list.length > 1 ? 7 : 0;
        const x = c.x + Math.cos(a) * off, y = c.y + Math.sin(a) * off;
        const m = el('g', { class: 'ttr-marker', transform: `translate(${fx(x)},${fx(y)})`, filter: 'url(#ttr-shadow)' }, g);
        el('circle', { r: 8.5, fill: PLAYER_COLORS[s.color] || s.color, stroke: '#fff', 'stroke-width': 1.8 }, m);
        if (s.score >= 100) {
          const t = el('text', { y: 3.5, 'text-anchor': 'middle', class: 'ttr-marker-lap' }, m);
          t.textContent = '+' + Math.floor(s.score / 100) * 100;
        }
      });
    }
  }

  // ---------------------------------------------------------------- public API
  function create(container, opts = {}) {
    const svg = el('svg', { viewBox: `0 0 ${W} ${H}`, class: 'ttr-board', preserveAspectRatio: 'xMidYMid meet' });
    container.appendChild(svg);
    buildDefs(svg);

    const layout = {};
    const lines = Object.fromEntries(routes.map((r) => [r.id, laneLine(r)]));
    const margins = endMargins(lines);
    for (const r of routes) layout[r.id] = layoutRoute(r, lines[r.id], margins[r.id + '@a'], margins[r.id + '@b']);
    const cells = trackCells();

    const map = el('g', { 'clip-path': 'url(#ttr-mapclip)' }, svg);
    drawGeography(el('g', { class: 'ttr-geo' }, map), opts.land);
    drawLegend(map);
    drawCompass(map);
    el('rect', { x: 0, y: 0, width: W, height: H, fill: 'url(#ttr-vignette)', 'pointer-events': 'none' }, map);
    const gRoutes = el('g', { class: 'ttr-routes' }, map);
    const gTrains = el('g', { class: 'ttr-trains' }, map);
    const gCities = el('g', { class: 'ttr-cities' }, map);
    const gStations = el('g', { class: 'ttr-stations' }, map);
    const gLabels = el('g', { class: 'ttr-labels' }, map);
    drawRoutes(gRoutes, layout);
    drawCities(gCities, gLabels);
    const gFrame = el('g', { class: 'ttr-track' }, svg);
    drawFrame(gFrame, cells);
    const gMarkers = el('g', { class: 'ttr-markers' }, svg);

    const handlers = { route: [], city: [] };
    const routeById = Object.fromEntries(routes.map((r) => [r.id, r]));
    svg.addEventListener('click', (ev) => {
      const rEl = ev.target.closest('[data-route]');
      if (rEl) return handlers.route.forEach((h) => h(routeById[rEl.dataset.route], ev));
      const cEl = ev.target.closest('[data-city]');
      if (cEl) handlers.city.forEach((h) => h(cities[cEl.dataset.city], ev));
    });
    if (opts.interactive) svg.classList.add('interactive');

    function setState(state = {}) {
      gTrains.textContent = ''; gStations.textContent = ''; gMarkers.textContent = '';
      const claims = state.claims || {};
      for (const [id, color] of Object.entries(claims)) {
        if (!layout[id]) continue;
        for (const slot of layout[id].slots) drawTrain(gTrains, slot, color);
      }
      for (const [cid, color] of Object.entries(state.stations || {})) {
        if (cities[cid]) drawStation(gStations, cities[cid], color);
      }
      drawMarkers(gMarkers, cells, state.scores);
      const hl = state.highlight || {};
      const hr = new Set(hl.routes || []), hc = new Set(hl.cities || []);
      gRoutes.querySelectorAll('.ttr-route').forEach((e) => {
        e.classList.toggle('highlight', hr.has(e.dataset.route));
        e.classList.toggle('claimed', !!claims[e.dataset.route]);
      });
      gCities.querySelectorAll('.ttr-city').forEach((e) => e.classList.toggle('highlight', hc.has(e.dataset.city)));
    }

    return {
      svg, layout, margins,
      setState,
      on(type, fn) { handlers[type].push(fn); return this; },
    };
  }

  root.TTRBoard = { create, PLAYER_COLORS, SLOT_COLORS, layoutRoute };
})(typeof self !== 'undefined' ? self : this);
