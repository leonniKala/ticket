#!/usr/bin/env node
'use strict';
/*
 * Generates public/data/land.json: Natural Earth coastlines and borders, warped with a
 * thin-plate spline so that every city's real lat/lon lands on its board position.
 * Run it again whenever a city is moved in public/js/map-data.js:   node tools/build-land.js
 */
const fs = require('fs');
const path = require('path');
const { BOARD, cities } = require('../public/js/map-data.js');

const SRC = 'https://cdn.jsdelivr.net/npm/world-atlas@2';
const OUT = path.join(__dirname, '..', 'public', 'data', 'land.json');
const GEO_CLIP = [-32, 24, 66, 74];   // lon/lat window kept before warping
const PAD = 50;                         // board-space margin kept around the board
const SIMPLIFY = 0.45;                  // Douglas–Peucker tolerance in board units
const LAT0 = 48 * Math.PI / 180;

const project = ([lon, lat]) => [lon * Math.cos(LAT0), -lat];

// ------------------------------------------------------------------ thin-plate spline
function solve(A, b) {
  const n = b.length, M = A.map((row, i) => [...row, b[i]]);
  for (let c = 0; c < n; c++) {
    let p = c;
    for (let r = c + 1; r < n; r++) if (Math.abs(M[r][c]) > Math.abs(M[p][c])) p = r;
    [M[c], M[p]] = [M[p], M[c]];
    for (let r = 0; r < n; r++) {
      if (r === c) continue;
      const f = M[r][c] / M[c][c];
      if (f) for (let k = c; k <= n; k++) M[r][k] -= f * M[c][k];
    }
  }
  return M.map((row, i) => row[n] / row[i]);
}

function fitTPS(src, dst) {
  const n = src.length, U = (d2) => (d2 > 0 ? 0.5 * d2 * Math.log(d2) : 0);
  const A = [];
  for (let i = 0; i < n + 3; i++) A.push(new Array(n + 3).fill(0));
  for (let i = 0; i < n; i++) {
    for (let j = 0; j < n; j++) {
      const dx = src[i][0] - src[j][0], dy = src[i][1] - src[j][1];
      A[i][j] = U(dx * dx + dy * dy);
    }
    A[i][n] = A[n][i] = 1;
    A[i][n + 1] = A[n + 1][i] = src[i][0];
    A[i][n + 2] = A[n + 2][i] = src[i][1];
  }
  const wx = solve(A, [...dst.map((d) => d[0]), 0, 0, 0]);
  const wy = solve(A, [...dst.map((d) => d[1]), 0, 0, 0]);
  return ([x, y]) => {
    let fx = wx[n] + wx[n + 1] * x + wx[n + 2] * y;
    let fy = wy[n] + wy[n + 1] * x + wy[n + 2] * y;
    for (let i = 0; i < n; i++) {
      const dx = x - src[i][0], dy = y - src[i][1], u = U(dx * dx + dy * dy);
      fx += wx[i] * u; fy += wy[i] * u;
    }
    return [fx, fy];
  };
}

// ------------------------------------------------------------------ topojson
function decodeArcs(topo) {
  const [sx, sy] = topo.transform.scale, [tx, ty] = topo.transform.translate;
  return topo.arcs.map((arc) => {
    let x = 0, y = 0;
    return arc.map(([dx, dy]) => { x += dx; y += dy; return [x * sx + tx, y * sy + ty]; });
  });
}
function ringFromArcs(arcs, ids) {
  const pts = [];
  for (const i of ids) {
    const a = i >= 0 ? arcs[i] : arcs[~i].slice().reverse();
    for (let k = pts.length ? 1 : 0; k < a.length; k++) pts.push(a[k]);
  }
  return pts;
}
const polygonsOf = (g) => (g.type === 'Polygon' ? [g.arcs] : g.type === 'MultiPolygon' ? g.arcs : []);

// ------------------------------------------------------------------ clipping / simplifying
function clipRing(ring, [x0, y0, x1, y1]) {
  const inside = [(p) => p[0] >= x0, (p) => p[0] <= x1, (p) => p[1] >= y0, (p) => p[1] <= y1];
  const cut = [
    (a, b) => [x0, a[1] + (b[1] - a[1]) * (x0 - a[0]) / (b[0] - a[0])],
    (a, b) => [x1, a[1] + (b[1] - a[1]) * (x1 - a[0]) / (b[0] - a[0])],
    (a, b) => [a[0] + (b[0] - a[0]) * (y0 - a[1]) / (b[1] - a[1]), y0],
    (a, b) => [a[0] + (b[0] - a[0]) * (y1 - a[1]) / (b[1] - a[1]), y1],
  ];
  let out = ring;
  for (let e = 0; e < 4 && out.length; e++) {
    const inp = out; out = [];
    for (let i = 0; i < inp.length; i++) {
      const cur = inp[i], prev = inp[(i + inp.length - 1) % inp.length];
      if (inside[e](cur)) { if (!inside[e](prev)) out.push(cut[e](prev, cur)); out.push(cur); }
      else if (inside[e](prev)) out.push(cut[e](prev, cur));
    }
  }
  return out;
}
function splitLine(line, inside) {
  const parts = []; let cur = [];
  for (const p of line) {
    if (inside(p)) cur.push(p);
    else { if (cur.length > 1) parts.push(cur); cur = []; }
  }
  if (cur.length > 1) parts.push(cur);
  return parts;
}
function simplify(pts, tol) {
  if (pts.length < 3) return pts;
  const keep = new Uint8Array(pts.length); keep[0] = keep[pts.length - 1] = 1;
  const stack = [[0, pts.length - 1]], t2 = tol * tol;
  while (stack.length) {
    const [a, b] = stack.pop();
    const [ax, ay] = pts[a], [bx, by] = pts[b];
    const dx = bx - ax, dy = by - ay, len2 = dx * dx + dy * dy;
    let best = -1, bestD = t2;
    for (let i = a + 1; i < b; i++) {
      const [px, py] = pts[i];
      const t = len2 ? Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / len2)) : 0;
      const ex = ax + t * dx - px, ey = ay + t * dy - py, d = ex * ex + ey * ey;
      if (d > bestD) { bestD = d; best = i; }
    }
    if (best >= 0) { keep[best] = 1; stack.push([a, best], [best, b]); }
  }
  return pts.filter((_, i) => keep[i]);
}
const f1 = (v) => (Math.round(v * 10) / 10).toString();
const pathOf = (pts, close) => 'M' + pts.map((p) => f1(p[0]) + ' ' + f1(p[1])).join('L') + (close ? 'Z' : '');

// ------------------------------------------------------------------ main
(async function main() {
  const src = [], dst = [];
  for (const c of Object.values(cities)) { src.push(project([c.lon, c.lat])); dst.push([c.x, c.y]); }
  const warp = fitTPS(src, dst);
  const toBoard = (p) => warp(project(p));
  const boardClip = [-PAD, -PAD, BOARD.width + PAD, BOARD.height + PAD];
  const inBoard = (p) => p[0] >= -PAD && p[0] <= BOARD.width + PAD && p[1] >= -PAD && p[1] <= BOARD.height + PAD;
  const inGeo = (p) => p[0] >= GEO_CLIP[0] && p[0] <= GEO_CLIP[2] && p[1] >= GEO_CLIP[1] && p[1] <= GEO_CLIP[3];

  const [land, countries] = await Promise.all(['land-50m.json', 'countries-50m.json']
    .map((f) => fetch(`${SRC}/${f}`).then((r) => { if (!r.ok) throw new Error(`${f}: ${r.status}`); return r.json(); })));

  const landParts = [];
  const landArcs = decodeArcs(land);
  for (const geom of land.objects.land.geometries) {
    for (const poly of polygonsOf(geom)) {
      for (const ids of poly) {
        let ring = clipRing(ringFromArcs(landArcs, ids), GEO_CLIP);
        if (ring.length < 3) continue;
        ring = clipRing(ring.map(toBoard), boardClip);
        if (ring.length < 3) continue;
        ring = simplify(ring, SIMPLIFY);
        if (ring.length >= 3) landParts.push(pathOf(ring, true));
      }
    }
  }

  // Borders: arcs shared by two countries.
  const cArcs = decodeArcs(countries), use = new Map();
  for (const geom of countries.objects.countries.geometries) {
    const seen = new Set();
    for (const poly of polygonsOf(geom)) for (const ring of poly) for (const i of ring) seen.add(i < 0 ? ~i : i);
    for (const i of seen) use.set(i, (use.get(i) || 0) + 1);
  }
  const borderParts = [];
  for (const [i, n] of use) {
    if (n < 2) continue;
    for (const geoPart of splitLine(cArcs[i], inGeo)) {
      for (const part of splitLine(geoPart.map(toBoard), inBoard)) borderParts.push(pathOf(simplify(part, SIMPLIFY), false));
    }
  }

  const out = {
    source: 'Natural Earth 1:50m via world-atlas@2, warped to board coordinates by tools/build-land.js',
    width: BOARD.width, height: BOARD.height,
    land: landParts.join(''),
    borders: borderParts.join(''),
  };
  fs.writeFileSync(OUT, JSON.stringify(out));
  console.log(`Wrote ${OUT} (${(fs.statSync(OUT).size / 1024).toFixed(0)} KB)`);
})().catch((e) => { console.error(e); process.exit(1); });
