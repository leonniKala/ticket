/* ============================================================
   Ζωγραφική του ταμπλό — κοινή για τηλεόραση και κινητά.
   const view = BoardView(svgEl, {onRoute:idx=>{}});
   ============================================================ */
(function (root) {
  'use strict';
  const NS = 'http://www.w3.org/2000/svg';

  const COLORS = {
    r: '#cf4436', o: '#e8892c', y: '#edc12f', g: '#4f9e48',
    b: '#3785c4', k: '#3f4048', w: '#f7f4ea', p: '#bd6fc4', x: '#b9c0c9'
  };
  const EDGE = {            // σκούρα απόχρωση για το «πάτωμα» του βαγονιού
    r: '#8f2a20', o: '#a25a12', y: '#a4801a', g: '#2f6a2b',
    b: '#20567f', k: '#232429', w: '#b6b0a1', p: '#7c4382', x: '#7d848d'
  };
  const COLOR_NAMES = {
    r: 'κόκκινο', o: 'πορτοκαλί', y: 'κίτρινο', g: 'πράσινο', b: 'μπλε',
    k: 'μαύρο', w: 'λευκό', p: 'μοβ', x: 'γκρι', L: 'ατμομηχανή'
  };
  const shade = hex => {
    const n = parseInt(hex.slice(1), 16);
    const f = 0.55;
    return '#' + [16, 8, 0].map(s => Math.round(((n >> s) & 255) * f).toString(16).padStart(2, '0')).join('');
  };

  function el(tag, attrs, parent) {
    const e = document.createElementNS(NS, tag);
    for (const k in attrs) e.setAttribute(k, attrs[k]);
    if (parent) parent.appendChild(e);
    return e;
  }

  function BoardView(svg, opts) {
    opts = opts || {};
    const D = root.BOARD;
    const groups = [];
    let cam = { x: 0, y: 0, k: 1 }, moved = false, camG = null;

    const pairCount = {}, pairSeen = {};
    D.routes.forEach(r => { const k = [r[0], r[1]].sort().join('|'); pairCount[k] = (pairCount[k] || 0) + 1; });

    function geom(r, idx) {
      const A = D.P[r[0]], B = D.P[r[1]];
      const key = [r[0], r[1]].sort().join('|');
      const total = pairCount[key];
      const n = (pairSeen[key] = (pairSeen[key] || 0) + 1) - 1;
      const dx = B.x - A.x, dy = B.y - A.y, dist = Math.hypot(dx, dy);
      const px = -dy / dist, py = dx / dist;
      const off = (total > 1) ? (n - (total - 1) / 2) * 15 : 0;
      const bow = (D.bows && D.bows[idx]) || 0;
      const P0 = { x: A.x + px * off, y: A.y + py * off };
      const P2 = { x: B.x + px * off, y: B.y + py * off };
      const P1 = { x: (A.x + B.x) / 2 + px * (bow + off * 1.12), y: (A.y + B.y) / 2 + py * (bow + off * 1.12) };
      const at = t => { const u = 1 - t; return { x: u * u * P0.x + 2 * u * t * P1.x + t * t * P2.x, y: u * u * P0.y + 2 * u * t * P1.y + t * t * P2.y }; };
      const tan = t => { const u = 1 - t; return { x: 2 * u * (P1.x - P0.x) + 2 * t * (P2.x - P1.x), y: 2 * u * (P1.y - P0.y) + 2 * t * (P2.y - P1.y) }; };
      const NSS = 160, cum = [0]; let prev = at(0);
      for (let i = 1; i <= NSS; i++) { const q = at(i / NSS); cum.push(cum[i - 1] + Math.hypot(q.x - prev.x, q.y - prev.y)); prev = q; }
      const L = cum[NSS];
      const tAt = s => { let i = 1; while (i <= NSS && cum[i] < s) i++; const s0 = cum[i - 1], s1 = cum[i] || s0 + 1e-6; return ((i - 1) + (s - s0) / (s1 - s0)) / NSS; };
      return { at, tan, tAt, L };
    }

    function drawRoute(parent, r, idx) {
      const [a, b, len, col, flags] = r;
      const { at, tan, tAt, L } = geom(r, idx);

      /* Τα βαγόνια είναι κολλητά και κεντραρισμένα στη διαδρομή, όπως στο αληθινό ταμπλό. */
      const CARW = 15, GAPC = 4;
      const carL = Math.min(36, Math.max(20, (L - 36 - GAPC * (len - 1)) / len));
      const block = carL * len + GAPC * (len - 1);
      const s0 = (L - block) / 2;

      const g = el('g', { class: 'route' }, parent);
      const cars = [], glyphs = [];
      for (let k = 0; k < len; k++) {
        const t = tAt(s0 + carL * (k + 0.5) + GAPC * k);
        const c = at(t), d = tan(t);
        const ang = Math.atan2(d.y, d.x) * 180 / Math.PI;
        const tf = `translate(${c.x.toFixed(1)},${c.y.toFixed(1)}) rotate(${ang.toFixed(1)})`;
        const slot = el('g', { transform: tf, class: 'slot' }, g);
        // σκιά / πάτωμα
        el('rect', { x: (-carL / 2).toFixed(1), y: (-CARW / 2 + 2).toFixed(1), width: carL.toFixed(1),
                     height: CARW, rx: 4.5, fill: 'rgba(0,0,0,.22)', class: 'shadow' }, slot);
        const rect = el('rect', {
          x: (-carL / 2).toFixed(1), y: (-CARW / 2).toFixed(1), width: carL.toFixed(1), height: CARW,
          rx: 4.5, fill: COLORS[col], stroke: EDGE[col], 'stroke-width': 1.6,
          class: 'car' + (flags === 't' ? ' tunnel' : '')
        }, slot);
        // λάμψη στο πάνω μέρος
        el('rect', { x: (-carL / 2 + 3).toFixed(1), y: (-CARW / 2 + 2.2).toFixed(1),
                     width: (carL - 6).toFixed(1), height: 3.4, rx: 1.7,
                     fill: '#fff', opacity: .30, class: 'gloss' }, slot);
        cars.push(rect);

        if (flags && flags[0] === 'f' && k < +flags[1]) {          // ατμομηχανή στα πορθμεία
          const s = 5.2;
          glyphs.push(el('path', {
            d: `M ${-s * 1.5} ${s * .55} L ${s * 1.5} ${s * .55} L ${s * 1.5} ${-s * .1} L ${s * .35} ${-s * .1}` +
               ` L ${s * .1} ${-s * .95} L ${-s * .75} ${-s * .95} L ${-s * .75} ${-s * .1} L ${-s * 1.5} ${-s * .1} Z`,
            fill: '#23242a', opacity: .8, class: 'glyph'
          }, slot));
          glyphs.push(el('circle', { cx: -s * .8, cy: s * .75, r: 1.7, fill: '#23242a', opacity: .8, class: 'glyph' }, slot));
          glyphs.push(el('circle', { cx: s * .8, cy: s * .75, r: 1.7, fill: '#23242a', opacity: .8, class: 'glyph' }, slot));
        }
      }
      if (flags === 't') {                                         // στόμια τούνελ
        [s0 - 9, s0 + block + 9].forEach(s => {
          if (s < 2 || s > L - 2) return;
          const c = at(tAt(s)), d = tan(tAt(s));
          const ang = Math.atan2(d.y, d.x) * 180 / Math.PI;
          el('path', {
            d: 'M -7 5 A 7 7 0 0 1 7 5 Z',
            transform: `translate(${c.x.toFixed(1)},${c.y.toFixed(1)}) rotate(${ang.toFixed(1)})`,
            fill: 'none', stroke: '#6b5a3e', 'stroke-width': 2.2, opacity: .75, class: 'glyph'
          }, parent);
        });
      }
      groups[idx] = { g, cars, glyphs, color: col };

      g.addEventListener('pointerenter', e => { g.classList.add('hot'); if (opts.onHover) opts.onHover(idx, e); });
      g.addEventListener('pointerleave', () => { g.classList.remove('hot'); if (opts.onHover) opts.onHover(null); });
      g.addEventListener('click', () => { if (!moved && opts.onRoute) opts.onRoute(idx); });
    }

    function build() {
      svg.setAttribute('viewBox', '0 0 ' + D.W + ' ' + D.H);
      svg.innerHTML = '';
      const defs = el('defs', {}, svg);
      const lg = el('linearGradient', { id: 'landGrad', x1: '0', y1: '0', x2: '0', y2: '1' }, defs);
      el('stop', { offset: '0', 'stop-color': '#efe4c9' }, lg);
      el('stop', { offset: '1', 'stop-color': '#e2d3b0' }, lg);
      const f = el('filter', { id: 'landShadow', x: '-5%', y: '-5%', width: '110%', height: '110%' }, defs);
      el('feDropShadow', { dx: 0, dy: 3, stdDeviation: 5, 'flood-color': '#20404f', 'flood-opacity': .35 }, f);

      camG = el('g', { id: 'cam' }, svg);
      el('path', { d: D.gratPath, class: 'grat' }, camG);
      el('path', { d: D.landPath, class: 'land', filter: 'url(#landShadow)' }, camG);
      el('path', { d: D.landPath, class: 'coast' }, camG);

      const gR = el('g', { class: 'routes' }, camG);
      const gC = el('g', { class: 'cities' }, camG);
      D.routes.forEach((r, i) => drawRoute(gR, r, i));

      const LBL = D.labels || {};
      for (const [name, p] of Object.entries(D.P)) {
        const g = el('g', { class: 'city' }, gC);
        el('circle', { cx: p.x, cy: p.y, r: 9.5, class: 'halo' }, g);
        el('circle', { cx: p.x, cy: p.y, r: 6.5, class: 'pin' }, g);
        const c = LBL[name] || [0, -15, 'middle'];
        const t = el('text', { x: (p.x + c[0]).toFixed(1), y: (p.y + c[1]).toFixed(1), 'text-anchor': c[2] }, g);
        t.textContent = name;
      }
      applyCam();
    }

    /* ---------- κάμερα ---------- */
    function applyCam() { if (camG) camG.setAttribute('transform', `translate(${cam.x} ${cam.y}) scale(${cam.k})`); }
    function clampCam() {
      cam.k = Math.max(1, Math.min(6, cam.k));
      cam.x = Math.max(D.W * (1 - cam.k), Math.min(0, cam.x));
      cam.y = Math.max(D.H * (1 - cam.k), Math.min(0, cam.y));
    }
    function svgPt(e) {
      const r = svg.getBoundingClientRect();
      const sc = Math.min(r.width / D.W, r.height / D.H);
      return { x: (e.clientX - r.left - (r.width - D.W * sc) / 2) / sc,
               y: (e.clientY - r.top - (r.height - D.H * sc) / 2) / sc };
    }
    function zoomAt(p, f) {
      const k0 = cam.k; cam.k = Math.max(1, Math.min(6, cam.k * f)); const k = cam.k / k0;
      cam.x = p.x - (p.x - cam.x) * k; cam.y = p.y - (p.y - cam.y) * k;
      clampCam(); applyCam();
    }
    function camFill(force) {
      const r = svg.getBoundingClientRect();
      if (!r.width || !r.height) return;
      const k = Math.min(6, Math.max(r.width / D.W, r.height / D.H) / Math.min(r.width / D.W, r.height / D.H));
      if (!force && k < 1.2) return;
      cam.k = k; cam.x = (D.W / 2) * (1 - k); cam.y = (D.H / 2) * (1 - k);
      clampCam(); applyCam();
    }
    function camFit() { cam = { x: 0, y: 0, k: 1 }; applyCam(); }

    if (opts.pan !== false) {
      svg.addEventListener('wheel', e => { e.preventDefault(); zoomAt(svgPt(e), e.deltaY < 0 ? 1.18 : 1 / 1.18); }, { passive: false });
      const ptrs = new Map(); let pinch0 = null, panStart = null;
      svg.addEventListener('pointerdown', e => {
        ptrs.set(e.pointerId, { x: e.clientX, y: e.clientY }); moved = false;
        if (ptrs.size === 1) panStart = { p: svgPt(e), cx: cam.x, cy: cam.y };
        if (ptrs.size === 2) { const [a, b] = [...ptrs.values()]; pinch0 = { d: Math.hypot(a.x - b.x, a.y - b.y), k: cam.k }; }
      });
      svg.addEventListener('pointermove', e => {
        if (!ptrs.has(e.pointerId)) return;
        const st = ptrs.get(e.pointerId);
        if (Math.hypot(e.clientX - st.x, e.clientY - st.y) > 7) moved = true;
        ptrs.set(e.pointerId, { x: e.clientX, y: e.clientY });
        if (ptrs.size === 2 && pinch0) {
          const [a, b] = [...ptrs.values()];
          const d = Math.hypot(a.x - b.x, a.y - b.y);
          zoomAt(svgPt({ clientX: (a.x + b.x) / 2, clientY: (a.y + b.y) / 2 }), (pinch0.k * (d / pinch0.d)) / cam.k);
        } else if (ptrs.size === 1 && panStart && moved) {
          const p = svgPt(e);
          cam.x = panStart.cx + (p.x - panStart.p.x) * cam.k;
          cam.y = panStart.cy + (p.y - panStart.p.y) * cam.k;
          clampCam(); applyCam();
        }
      });
      ['pointerup', 'pointercancel', 'pointerleave'].forEach(t =>
        svg.addEventListener(t, e => { ptrs.delete(e.pointerId); if (ptrs.size < 2) pinch0 = null; if (!ptrs.size) panStart = null; }));
    }

    build();

    return {
      svg, camFit, camFill,
      toggleCam() { (cam.k > 1.02) ? camFit() : camFill(true); },
      setOwned(owned, colorOf) {
        groups.forEach((G, i) => {
          if (!G) return;
          const who = owned ? owned[i] : undefined;
          const hex = (who !== undefined && colorOf) ? colorOf(who) : null;
          G.cars.forEach(c => {
            c.setAttribute('fill', hex || COLORS[G.color]);
            c.setAttribute('stroke', hex ? shade(hex) : EDGE[G.color]);
            c.classList.toggle('taken', !!hex);
          });
          G.glyphs.forEach(x => x.style.opacity = hex ? 0.25 : '');
          G.g.classList.toggle('owned', !!hex);
        });
      },
      setClaimable(set) { groups.forEach((G, i) => { if (G) G.g.classList.toggle('can', !!(set && set.has(i))); }); },
      setSelected(idx) { groups.forEach((G, i) => { if (G) G.g.classList.toggle('sel', i === idx); }); },
      routeLabel(i) {
        const r = root.BOARD.routes[i];
        let s = r[0] + ' – ' + r[1] + ' · ' + r[2] + ' βαγόνια · ' + COLOR_NAMES[r[3]];
        if (r[4] === 't') s += ' · τούνελ';
        if (r[4] && r[4][0] === 'f') s += ' · πορθμείο (' + r[4][1] + ' ατμομηχανές)';
        return s;
      }
    };
  }

  root.BoardView = BoardView;
  root.CARD_COLORS = COLORS;
  root.CARD_EDGE = EDGE;
  root.CARD_NAMES = COLOR_NAMES;
})(window);
