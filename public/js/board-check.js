/*
 * Dev aid for the board layout. Open /board.html?check:
 *  - check():  finds overlaps (cars on cars, cars over other cities, labels on cars/cities/labels),
 *              circles them in red and lists them in window.boardIssues;
 *  - suggestLabels(): tries many positions around every city and picks the clearest one for its name
 *              (window.suggestLabels() in the console; prints lines to paste into map-data.js).
 */
(function (root) {
  'use strict';
  const CAR_W = 13, HALO = 17;

  function carsOf(board) {
    const M = root.TTR_MAP;
    const byId = Object.fromEntries(M.routes.map((r) => [r.id, r]));
    const cities = Object.values(M.cities);
    const cars = [];
    for (const [id, lay] of Object.entries(board.layout)) {
      const r = byId[id];
      lay.slots.forEach((s, i) => cars.push({ id, r, i, s, pad: r.tunnel ? 1.6 : 0 }));
    }
    for (const c of cars) {
      const a = c.s.angle * Math.PI / 180, ca = Math.cos(a), sa = Math.sin(a);
      const hw = c.s.len / 2 + c.pad, hh = CAR_W / 2 + c.pad;
      c.pts = [];
      for (let lx = -hw; lx <= hw + 0.01; lx += 1.5) {
        for (let ly = -hh; ly <= hh + 0.01; ly += 1.5) c.pts.push([c.s.x + lx * ca - ly * sa, c.s.y + lx * sa + ly * ca]);
      }
      c.near = cities.filter((k) => Math.hypot(k.x - c.s.x, k.y - c.s.y) < c.s.len / 2 + CAR_W + HALO);
    }
    return cars;
  }

  function labelBoxes(board) {
    return [...board.svg.querySelectorAll('.ttr-city-label')].map((t) => {
      const b = t.getBBox();
      return { el: t, id: t.dataset.city, x0: b.x, x1: b.x + b.width, y0: b.y + 2.5, y1: b.y + b.height - 2.5 };
    });
  }

  function check(board) {
    const M = root.TTR_MAP, cities = Object.values(M.cities);
    const cars = carsOf(board);
    const local = (c, x, y) => {
      const a = -c.s.angle * Math.PI / 180, dx = x - c.s.x, dy = y - c.s.y;
      return [dx * Math.cos(a) - dy * Math.sin(a), dx * Math.sin(a) + dy * Math.cos(a)];
    };
    const inside = (c, x, y, extra = 0) => {
      const [lx, ly] = local(c, x, y);
      return Math.abs(lx) <= c.s.len / 2 + c.pad + extra && Math.abs(ly) <= CAR_W / 2 + c.pad + extra;
    };
    const nearCity = (car, x, y) => car.near.some((k) => Math.hypot(k.x - x, k.y - y) < HALO);

    const issues = [];
    const add = (kind, a, b, pts) => { if (pts.length) issues.push({ kind, a, b, n: pts.length, at: pts[Math.floor(pts.length / 2)] }); };

    // cars of different routes (and the two lanes of a double route) must not touch
    const pairs = new Map();
    for (let i = 0; i < cars.length; i++) {
      const A = cars[i];
      for (let j = i + 1; j < cars.length; j++) {
        const B = cars[j];
        if (A.id === B.id) continue;
        if (Math.hypot(A.s.x - B.s.x, A.s.y - B.s.y) > (A.s.len + B.s.len) / 2 + 2 * CAR_W) continue;
        const hits = A.pts.filter(([x, y]) => inside(B, x, y, 0.8) && !nearCity(A, x, y));
        if (!hits.length) continue;
        const key = A.id + ' × ' + B.id;
        const prev = pairs.get(key);
        if (prev) prev.push(...hits); else pairs.set(key, hits);
      }
    }
    for (const [key, pts] of pairs) { const [a, b] = key.split(' × '); add('cars', a, b, pts); }

    // cars running through a city that is not one of their ends
    for (const A of cars) {
      for (const k of A.near) {
        if (k.id === A.r.a || k.id === A.r.b) continue;
        add('car-city', A.id, k.id, A.pts.filter(([x, y]) => Math.hypot(k.x - x, k.y - y) < HALO));
      }
    }

    // city labels
    const labels = labelBoxes(board);
    const inBox = (L, x, y) => x >= L.x0 && x <= L.x1 && y >= L.y0 && y <= L.y1;
    for (const L of labels) {
      for (const A of cars) {
        if (A.s.x < L.x0 - 40 || A.s.x > L.x1 + 40 || A.s.y < L.y0 - 40 || A.s.y > L.y1 + 40) continue;
        add('label-car', L.id, A.id, A.pts.filter(([x, y]) => inBox(L, x, y)));
      }
      for (const k of cities) {
        const dx = Math.max(L.x0 - k.x, 0, k.x - L.x1), dy = Math.max(L.y0 - k.y, 0, k.y - L.y1);
        if (Math.hypot(dx, dy) < (k.id === L.id ? 8.5 : HALO)) add('label-city', L.id, k.id, [[k.x, k.y]]);
      }
      for (const O of labels) {
        if (O.id <= L.id) continue;
        if (L.x0 < O.x1 && O.x0 < L.x1 && L.y0 < O.y1 && O.y0 < L.y1) add('label-label', L.id, O.id, [[(L.x0 + L.x1) / 2, (L.y0 + L.y1) / 2]]);
      }
    }
    return issues;
  }

  function show(board, issues) {
    const NS = 'http://www.w3.org/2000/svg';
    let g = board.svg.querySelector('.ttr-check');
    if (g) g.remove();
    g = document.createElementNS(NS, 'g');
    g.setAttribute('class', 'ttr-check');
    g.setAttribute('pointer-events', 'none');
    for (const it of issues) {
      const c = document.createElementNS(NS, 'circle');
      c.setAttribute('cx', it.at[0]); c.setAttribute('cy', it.at[1]); c.setAttribute('r', 11);
      c.setAttribute('fill', 'none'); c.setAttribute('stroke', '#ff0033'); c.setAttribute('stroke-width', 3);
      g.appendChild(c);
    }
    board.svg.appendChild(g);
  }

  /** Picks a clear spot for every city name and moves the labels there. Returns { cityId: [dx, dy, anchor] }. */
  function suggestLabels(board) {
    const M = root.TTR_MAP, { width: W, height: H, track: T } = M.BOARD;
    const cities = Object.values(M.cities);
    const cars = carsOf(board);
    const degree = (id) => M.routes.filter((r) => r.a === id || r.b === id).length;
    const blocks = [
      { x0: 368, y0: 58, x1: 528, y1: 184 },          // route scoring legend
      { x0: 56, y0: 560, x1: 152, y1: 660 },          // compass
    ];
    const placed = [];
    const result = {};
    const labels = labelBoxes(board).sort((a, b) => degree(b.id) - degree(a.id));
    for (const L of labels) {
      const c = M.cities[L.id], t = L.el;
      const bb = t.getBBox(), base = +t.getAttribute('y');
      const top = bb.y - base + 2.5, bottom = bb.y + bb.height - base - 2.5, w = bb.width;
      let best = null;
      for (let k = 0; k < 24; k++) {
        const ang = k * Math.PI / 12, ca = Math.cos(ang), sa = Math.sin(ang);
        for (const d of [12, 15, 19, 24, 30, 36]) {
          const px = c.x + d * ca, py = c.y + d * sa;
          const anchor = ca > 0.3 ? 'start' : ca < -0.3 ? 'end' : 'middle';
          const x0 = anchor === 'start' ? px : anchor === 'end' ? px - w : px - w / 2;
          const baseY = sa < -0.3 ? py - bottom : sa > 0.3 ? py - top : py - (top + bottom) / 2;
          const box = { x0, x1: x0 + w, y0: baseY + top, y1: baseY + bottom };
          let score = d * 0.6;
          if (box.x0 < T + 3 || box.x1 > W - T - 3 || box.y0 < T + 3 || box.y1 > H - T - 3) score += 1000;
          for (const car of cars) {
            if (car.s.x < box.x0 - 30 || car.s.x > box.x1 + 30 || car.s.y < box.y0 - 30 || car.s.y > box.y1 + 30) continue;
            for (const [x, y] of car.pts) if (x >= box.x0 - 1 && x <= box.x1 + 1 && y >= box.y0 - 1 && y <= box.y1 + 1) score += 4;
          }
          const boxDist = (k2) => Math.hypot(Math.max(box.x0 - k2.x, 0, k2.x - box.x1), Math.max(box.y0 - k2.y, 0, k2.y - box.y1));
          const own = boxDist(c);
          for (const k2 of cities) {
            const d2 = boxDist(k2);
            if (d2 < (k2.id === c.id ? 9 : HALO)) score += 400;
            // A name must clearly belong to its own city, not to a neighbour.
            else if (k2.id !== c.id && d2 < own + 10) score += 150;
          }
          for (const O of placed.concat(blocks)) {
            if (box.x0 < O.x1 + 2 && O.x0 < box.x1 + 2 && box.y0 < O.y1 + 1 && O.y0 < box.y1 + 1) score += 600;
          }
          if (!best || score < best.score) best = { score, box, anchor, x: Math.round(box.x0 - c.x + (anchor === 'start' ? 0 : anchor === 'end' ? w : w / 2)), y: Math.round(baseY - c.y) };
        }
      }
      placed.push(best.box);
      result[c.id] = [best.x, best.y, best.anchor];
      t.setAttribute('x', c.x + best.x);
      t.setAttribute('y', c.y + best.y);
      t.setAttribute('text-anchor', best.anchor);
      if (best.score > 40) console.warn('Label ' + c.id + ' has no clear spot (score ' + best.score.toFixed(0) + ')');
    }
    return result;
  }

  root.TTRBoardCheck = { check, show, suggestLabels };
})(window);
