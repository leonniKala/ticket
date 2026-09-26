#!/usr/bin/env node
'use strict';
/*
 * Robot players, for trying the game (and the TV screen) without people.
 *
 *   node tools/bot.js --code 1234 --join 3            3 new robots join game 1234
 *   node tools/bot.js --code 1234 --token <token>     a robot takes over an existing player
 *   options: --url http://localhost:3000  --delay 900 (ms between moves)
 *
 * After the robots have joined, start the game from /admin as usual.
 */
const { io } = require('socket.io-client');
const MAP = require('../public/js/map-data.js');
const Pay = require('../public/js/payments.js');

const args = {};
for (let i = 2; i < process.argv.length; i += 2) args[process.argv[i].replace(/^--/, '')] = process.argv[i + 1];
const URL = args.url || 'http://localhost:3000';
const CODE = args.code;
const DELAY = Number(args.delay || 900);
if (!CODE || (!args.join && !args.token)) {
  console.log('Usage: node tools/bot.js --code 1234 (--join 3 | --token <token>) [--url ...] [--delay 900]');
  process.exit(1);
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const pick = (arr) => arr[Math.floor(Math.random() * arr.length)];

// Shortest route (in trains) between two cities over routes not blocked for this player.
function shortestPath(game, pid, from, to) {
  const dist = { [from]: 0 }, prev = {}, done = new Set();
  const cost = (r) => (game.claims[r.id] === pid ? 0 : game.claims[r.id] ? Infinity : r.length);
  while (true) {
    let u = null;
    for (const c in dist) if (!done.has(c) && (u === null || dist[c] < dist[u])) u = c;
    if (u === null || u === to) break;
    done.add(u);
    for (const r of MAP.routes) {
      if (r.a !== u && r.b !== u) continue;
      const v = r.a === u ? r.b : r.a, d = dist[u] + cost(r);
      if (d < (dist[v] ?? Infinity)) { dist[v] = d; prev[v] = r; }
    }
  }
  const path = [];
  for (let c = to; prev[c]; c = prev[c].a === c ? prev[c].b : prev[c].a) path.push(prev[c]);
  return dist[to] === undefined ? [] : path;
}

function wantedRoutes(view) {
  const g = view.game, me = view.me, pid = view.myId;
  const want = new Map();
  for (const t of me.tickets) {
    if (t.done) continue;
    for (const r of shortestPath(g, pid, t.a, t.b)) if (!g.claims[r.id]) want.set(r.id, r);
  }
  return [...want.values()];
}

function decide(view) {
  const g = view.game, me = view.me, t = g.turn;
  const p = g.players.find((x) => x.id === view.myId);
  const blocked = (r) => g.claims[r.id] || (r.twin && g.claims[r.twin] && (g.claims[r.twin] === p.id || g.players.length < 4)) || p.trains < r.length;

  if (g.phase === 'setup') {
    if (!me.offer.length) return null;
    const sorted = me.offer.slice().sort((a, b) => a.points - b.points);
    return { type: 'keepSetupTickets', ids: sorted.slice(0, 2).map((x) => x.id) };
  }
  if (t.stage === 'tunnel') {
    const o = Pay.tunnelExtra(t.paid, t.extra, me.hand);
    return o.length ? { type: 'tunnelPay', payment: o[0] } : { type: 'tunnelCancel' };
  }
  if (t.stage === 'tickets') {
    const sorted = me.offer.slice().sort((a, b) => a.points - b.points);
    return { type: 'keepTickets', ids: [sorted[0].id] };
  }
  const wanted = wantedRoutes(view).filter((r) => !blocked(r));
  const wantColors = new Set(wanted.map((r) => r.color).filter((c) => c !== 'gray'));
  if (t.stage === 'drew') {
    const slot = g.faceUp.findIndex((c) => c && c !== 'loco' && wantColors.has(c));
    if (slot >= 0) return { type: 'drawFaceUp', slot };
    if (g.deckCount + g.discardCount) return { type: 'drawBlind' };
    return { type: 'drawFaceUp', slot: g.faceUp.findIndex((c) => c && c !== 'loco') };
  }
  // Start of turn: claim something useful, else something big near the end, else draw.
  const affordable = (list) => list.filter((r) => !blocked(r) && Pay.route(r, me.hand).length);
  let options = affordable(wanted);
  if (!options.length && (p.trains < 15 || !wanted.length)) options = affordable(MAP.routes).filter((r) => r.length >= 3 || p.trains < 6);
  if (options.length) {
    const r = options.sort((a, b) => b.length - a.length)[0];
    return { type: 'claimRoute', routeId: r.id, payment: Pay.route(r, me.hand)[0] };
  }
  if (!wanted.length && me.tickets.every((x) => x.done) && g.ticketDeckCount && p.trains > 20) return { type: 'drawTickets' };
  if (me.stationCost === 1 && p.stationsLeft === 3 && Math.random() < 0.02) {
    const free = Object.keys(MAP.cities).filter((c) => !g.stations[c]);
    const pay = Pay.station(1, me.hand);
    if (pay.length) return { type: 'buildStation', cityId: pick(free), payment: pay[0] };
  }
  const slot = g.faceUp.findIndex((c) => c === 'loco' || (c && wantColors.has(c)));
  if (slot >= 0) return { type: 'drawFaceUp', slot };
  if (g.deckCount + g.discardCount) return { type: 'drawBlind' };
  const any = g.faceUp.findIndex(Boolean);
  if (any >= 0) return { type: 'drawFaceUp', slot: any };
  return g.ticketDeckCount ? { type: 'drawTickets' } : null;
}

function runBot(label, token) {
  const s = io(URL, { transports: ['websocket'] });
  let view = null, busy = false;
  const req = (ev, payload) => new Promise((resolve, reject) =>
    s.emit(ev, payload, (r) => (r && r.ok ? resolve(r) : reject(new Error(r ? r.error : 'no answer')))));

  async function think() {
    if (busy || !view || !view.game) return;
    const g = view.game;
    const myTurn = (g.phase === 'playing' && g.current === view.myId) || (g.phase === 'setup' && view.me.offer.length);
    if (!myTurn) return;
    busy = true;
    await sleep(DELAY);
    try {
      const action = decide(view);
      if (action) await req('action', action);
    } catch (e) {
      console.log(`[${label}] ${e.message}`);
    }
    busy = false;
    think();
  }

  s.on('connect', async () => {
    try {
      await req('hello', { role: 'player', code: CODE, token });
      console.log(`[${label}] connected`);
    } catch (e) {
      console.log(`[${label}] ${e.message}`);
      process.exit(1);
    }
  });
  s.on('state', (v) => {
    view = v;
    if (v.game && v.game.phase === 'finished' && v.game.results) {
      const me = v.game.results.find((r) => r.id === v.myId);
      if (me && !s.reported) { s.reported = true; console.log(`[${label}] finished: rank ${me.rank}, ${me.total} points`); }
    } else s.reported = false;
    think();
  });
  s.on('closed', () => { console.log(`[${label}] game closed`); process.exit(0); });
}

(async function main() {
  if (args.token) return runBot('bot', args.token);
  const count = Math.min(5, Number(args.join));
  const s = io(URL, { transports: ['websocket'] });
  await new Promise((r) => s.on('connect', r));
  for (let i = 1; i <= count; i++) {
    const name = `Ρομπότ ${i}`;
    const r = await new Promise((resolve) => s.emit('join', { code: CODE, name, pin: '0000' }, resolve));
    if (!r.ok) { console.log(`${name}: ${r.error}`); continue; }
    runBot(name, r.token);
  }
  s.close();
})();
