'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const G = require('../server/game.js');
const Pay = require('../public/js/payments.js');
const MAP = require('../public/js/map-data.js');

function rng(seed = 1) {
  return function () {
    seed |= 0; seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const PLAYERS = (n) => [
  { id: 'p1', name: 'Άννα', color: 'red' }, { id: 'p2', name: 'Βασίλης', color: 'blue' },
  { id: 'p3', name: 'Γιώργος', color: 'green' }, { id: 'p4', name: 'Δήμητρα', color: 'yellow' },
  { id: 'p5', name: 'Ελένη', color: 'black' },
].slice(0, n);

function totalCards(s) {
  let n = s.deck.length + s.discard.length + s.faceUp.filter(Boolean).length;
  for (const p of s.players) n += G.handCount(p.hand);
  if (s.turn.stage === 'tunnel') n += s.turn.paid.n + s.turn.paid.loco + s.turn.revealed.length;
  return n;
}

function readyGame(n = 2, seed = 1) {
  const r = rng(seed);
  const s = G.newGame(PLAYERS(n), r);
  for (const p of s.players) G.applyAction(s, p.id, { type: 'keepSetupTickets', ids: p.offer.slice(0, 2) }, r);
  return { s, r };
}

const cur = (s) => s.players[s.current];
const setHand = (p, cards) => { for (const c of G.CARD_TYPES) p.hand[c] = cards[c] || 0; };

test('map data is complete', () => {
  assert.equal(Object.keys(MAP.cities).length, 47);
  assert.equal(MAP.routes.length, 101);
  assert.equal(MAP.tickets.length, 46);
  assert.equal(MAP.tickets.filter((t) => t.long).length, 6);
  assert.equal(MAP.routes.filter((r) => r.double).length, 22);
  const trains = MAP.routes.reduce((n, r) => n + r.length, 0);
  assert.ok(trains > 250);
});

test('setup deals cards and tickets', () => {
  const s = G.newGame(PLAYERS(3), rng(2));
  assert.equal(totalCards(s), 110);
  for (const p of s.players) {
    assert.equal(G.handCount(p.hand), 4);
    assert.equal(p.offer.length, 4);
    assert.equal(G.TICKETS[p.offer[0]].long, true);
  }
  assert.equal(s.faceUp.filter(Boolean).length, 5);
  assert.throws(() => G.applyAction(s, 'p1', { type: 'keepSetupTickets', ids: [s.players[0].offer[0]] }), /τουλάχιστον 2/);
  const before = s.ticketDeck.length;
  G.applyAction(s, 'p1', { type: 'keepSetupTickets', ids: s.players[0].offer.slice(1, 3) });
  // the long ticket is removed from the game, the unkept regular one goes back
  assert.equal(s.ticketDeck.length, before + 1);
  assert.equal(s.phase, 'setup');
  G.applyAction(s, 'p2', { type: 'keepSetupTickets', ids: s.players[1].offer });
  G.applyAction(s, 'p3', { type: 'keepSetupTickets', ids: s.players[2].offer.slice(0, 2) });
  assert.equal(s.phase, 'playing');
});

test('drawing train cards follows the locomotive rules', () => {
  const { s, r } = readyGame();
  const p = cur(s);
  s.faceUp = ['loco', 'red', 'blue', 'green', 'white'];
  G.applyAction(s, p.id, { type: 'drawFaceUp', slot: 0 }, r);
  assert.notEqual(cur(s).id, p.id, 'face-up locomotive ends the turn');

  const q = cur(s);
  G.applyAction(s, q.id, { type: 'drawFaceUp', slot: 1 }, r);
  assert.equal(s.turn.stage, 'drew');
  s.faceUp[2] = 'loco';
  assert.throws(() => G.applyAction(s, q.id, { type: 'drawFaceUp', slot: 2 }, r), /δεύτερη/);
  assert.throws(() => G.applyAction(s, q.id, { type: 'drawTickets' }, r), /δεύτερη κάρτα/);
  G.applyAction(s, q.id, { type: 'drawBlind' }, r);
  assert.equal(cur(s).id, p.id);
  assert.equal(totalCards(s), 110);
});

test('three face-up locomotives are replaced', () => {
  const { s, r } = readyGame();
  s.deck.push('loco', 'loco');
  s.faceUp = ['loco', 'red', 'blue', 'green', 'white'];
  const base = totalCards(s);
  G.applyAction(s, cur(s).id, { type: 'drawFaceUp', slot: 1 }, r); // refill brings a 2nd loco
  G.applyAction(s, cur(s).id, { type: 'drawFaceUp', slot: 2 }, r); // refill brings a 3rd loco
  assert.ok(s.faceUp.filter((c) => c === 'loco').length < 3);
  assert.ok(s.log.some((l) => /Τρεις ανοιχτές ατμομηχανές/.test(l.text)));
  assert.equal(totalCards(s), base);
});

test('claiming routes: colours, gray, ferries, points', () => {
  const { s, r } = readyGame();
  const p = cur(s);
  setHand(p, { red: 3, blue: 2, loco: 2 });
  assert.throws(() => G.applyAction(s, p.id, { type: 'claimRoute', routeId: 'berlin-frankfurt', payment: { color: 'blue', loco: 1 } }, r), /Λάθος χρώμα/);
  G.applyAction(s, p.id, { type: 'claimRoute', routeId: 'berlin-frankfurt-2', payment: { color: 'red', loco: 0 } }, r);
  assert.equal(s.claims['berlin-frankfurt-2'], p.id);
  assert.equal(s.players.find((x) => x.id === p.id).routePoints, 4);
  assert.equal(s.players.find((x) => x.id === p.id).trains, 42);

  const q = cur(s);
  setHand(q, { green: 2, loco: 1 });
  // ferry London–Amsterdam needs 2 locomotives
  assert.throws(() => G.applyAction(s, q.id, { type: 'claimRoute', routeId: 'amsterdam-london', payment: { color: 'green', loco: 1 } }, r), /ατμομηχανές/);
  // gray route with any colour
  G.applyAction(s, q.id, { type: 'claimRoute', routeId: 'danzig-warszawa', payment: { color: 'green', loco: 0 } }, r);
  assert.equal(s.claims['danzig-warszawa'], q.id);
});

test('double routes: closed with 2–3 players, open with 4+', () => {
  const two = readyGame(2).s;
  two.claims['berlin-frankfurt'] = 'p2';
  const p1 = two.players.find((p) => p.id === 'p1');
  assert.match(G.routeBlockReason(two, G.ROUTES['berlin-frankfurt-2'], p1), /2–3 παίκτες/);

  const four = readyGame(4).s;
  four.claims['berlin-frankfurt'] = 'p2';
  assert.equal(G.routeBlockReason(four, G.ROUTES['berlin-frankfurt-2'], four.players[0]), null);
  assert.match(G.routeBlockReason(four, G.ROUTES['berlin-frankfurt-2'], four.players[1]), /και τις δύο/);
});

test('tunnels: surcharge, paying and giving up', () => {
  const { s, r } = readyGame();
  const p = cur(s);
  setHand(p, { yellow: 3, loco: 1 });
  s.deck.push('red', 'loco', 'yellow'); // top of the deck is the end of the array
  let base = totalCards(s);
  G.applyAction(s, p.id, { type: 'claimRoute', routeId: 'munchen-zurich', payment: { color: 'yellow', loco: 0 } }, r);
  assert.equal(s.turn.stage, 'tunnel');
  assert.equal(s.turn.extra, 2);
  assert.equal(totalCards(s), base);
  assert.throws(() => G.applyAction(s, p.id, { type: 'tunnelPay', payment: { color: 'yellow', loco: 0 } }, r), /Δεν έχεις 2/);
  G.applyAction(s, p.id, { type: 'tunnelPay', payment: { color: 'yellow', loco: 1 } }, r);
  const pAfter = s.players.find((x) => x.id === p.id);
  assert.equal(s.claims['munchen-zurich'], p.id);
  assert.equal(pAfter.hand.yellow + pAfter.hand.loco, 0);
  assert.equal(totalCards(s), base);

  const q = cur(s);
  setHand(q, { purple: 2 });
  s.deck.push('purple', 'blue', 'blue');
  base = totalCards(s);
  G.applyAction(s, q.id, { type: 'claimRoute', routeId: 'marseille-zurich', payment: { color: 'purple', loco: 0 } }, r);
  assert.equal(s.turn.extra, 1);
  G.applyAction(s, q.id, { type: 'tunnelCancel' }, r);
  assert.equal(s.players.find((x) => x.id === q.id).hand.purple, 2);
  assert.equal(s.claims['marseille-zurich'], undefined);
  assert.equal(totalCards(s), base);
});

test('tunnel paid only with locomotives only counts revealed locomotives', () => {
  const { s, r } = readyGame();
  const p = cur(s);
  setHand(p, { loco: 2 });
  s.deck.push('red', 'blue', 'green');
  G.applyAction(s, p.id, { type: 'claimRoute', routeId: 'munchen-zurich', payment: { color: null, loco: 2 } }, r);
  assert.equal(s.claims['munchen-zurich'], p.id);
});

test('destination tickets and stations', () => {
  const { s, r } = readyGame();
  const p = cur(s);
  G.applyAction(s, p.id, { type: 'drawTickets' }, r);
  const offer = s.turn.offer.slice();
  assert.throws(() => G.applyAction(s, p.id, { type: 'keepTickets', ids: [] }, r), /τουλάχιστον 1/);
  G.applyAction(s, p.id, { type: 'keepTickets', ids: [offer[0]] }, r);
  assert.ok(s.players.find((x) => x.id === p.id).tickets.includes(offer[0]));
  assert.deepEqual(s.ticketDeck.slice(-2), offer.slice(1));

  const q = cur(s);
  setHand(q, { red: 5, loco: 1 });
  G.applyAction(s, q.id, { type: 'buildStation', cityId: 'wien', payment: { color: 'red', loco: 0 } }, r);
  G.applyAction(s, cur(s).id, { type: 'drawBlind' }, r);
  G.applyAction(s, cur(s).id, { type: 'drawBlind' }, r);
  assert.throws(() => G.applyAction(s, q.id, { type: 'buildStation', cityId: 'wien', payment: { color: 'red', loco: 1 } }, r), /ήδη σταθμός/);
  // the second station costs two cards
  assert.throws(() => G.applyAction(s, q.id, { type: 'buildStation', cityId: 'roma', payment: { color: 'red', loco: 3 } }, r), /Μη έγκυρη/);
  G.applyAction(s, q.id, { type: 'buildStation', cityId: 'roma', payment: { color: 'red', loco: 1 } }, r);
  const qAfter = s.players.find((x) => x.id === q.id);
  assert.equal(qAfter.stationsLeft, 1);
  assert.equal(qAfter.hand.red, 3);
  assert.equal(qAfter.hand.loco, 0);
});

test('last round: everyone including the trigger player gets one more turn', () => {
  const { s, r } = readyGame(3);
  const trigger = cur(s);
  trigger.trains = 3;
  setHand(trigger, { black: 1 });
  G.applyAction(s, trigger.id, { type: 'claimRoute', routeId: 'amsterdam-bruxelles', payment: { color: 'black', loco: 0 } }, r);
  assert.equal(s.finalTurns, 3);
  for (let i = 0; i < 3; i++) {
    assert.equal(s.phase, 'playing');
    G.applyAction(s, cur(s).id, { type: 'drawBlind' }, r);
    G.applyAction(s, cur(s).id, { type: 'drawBlind' }, r);
  }
  assert.equal(s.phase, 'finished');
  assert.equal(s.results.length, 3);
});

test('scoring: longest trail, tickets and stations borrowing a route', () => {
  const { s } = readyGame(2);
  const [a, b] = s.players;
  for (const id of ['brest-paris', 'paris-zurich', 'munchen-zurich', 'munchen-wien']) s.claims[id] = a.id;
  s.claims['budapest-wien'] = b.id;
  const ticket = (x, y) => MAP.tickets.find((t) => t.a === x && t.b === y).id;
  a.tickets = [ticket('paris', 'wien')]; // 8 points
  b.tickets = [];
  assert.equal(G.longestTrail(Object.keys(s.claims).filter((id) => s.claims[id] === a.id).map((id) => G.ROUTES[id])).length, 11);
  a.tickets.push(ticket('budapest', 'sofia')); // 5 points, not connected even with the station
  s.stations.wien = a.id;
  a.stationsLeft = 2;
  G.finish(s);
  const ra = s.results.find((x) => x.id === a.id);
  assert.equal(ra.longest, 11);
  assert.equal(ra.express, 10);
  assert.equal(ra.stationPoints, 8);
  // Paris–Wien is done, Budapest–Sofia is not
  assert.equal(ra.ticketPoints, 8 - 5);
});

test('malformed moves are rejected without touching the state', () => {
  const { s, r } = readyGame();
  const p = cur(s);
  const before = JSON.stringify(s);
  const bad = [
    { type: 'drawFaceUp', slot: '__proto__' }, { type: 'drawFaceUp', slot: 7 },
    { type: 'claimRoute', routeId: '__proto__', payment: { color: 'red', loco: 0 } },
    { type: 'claimRoute', routeId: 'berlin-wien', payment: 'lots' },
    { type: 'buildStation', cityId: 'constructor', payment: { color: 'red', loco: 0 } },
    { type: 'keepTickets', ids: [{}] }, { type: 'toString' }, { type: '__proto__' }, null,
  ];
  for (const a of bad) assert.throws(() => G.applyAction(s, p.id, a, r), G.GameError);
  assert.equal(JSON.stringify(s), before);
});

test('payment helper offers only valid payments', () => {
  const hand = { purple: 0, white: 2, blue: 1, yellow: 0, orange: 0, black: 0, red: 3, green: 0, loco: 2 };
  const opts = Pay.route(G.ROUTES['bruxelles-paris'], hand); // yellow 2
  assert.deepEqual(opts, [{ color: null, n: 0, loco: 2 }]);
  const gray = Pay.route(G.ROUTES['marseille-paris'], hand); // gray 4
  assert.ok(gray.some((o) => o.color === 'red' && o.n === 3 && o.loco === 1));
  assert.ok(gray.some((o) => o.color === 'white' && o.n === 2 && o.loco === 2));
  assert.ok(!gray.some((o) => o.color === 'blue'));
});

test('random games always finish and never lose a card', () => {
  for (let seed = 1; seed <= 40; seed++) {
    const r = rng(seed);
    const n = 2 + (seed % 4);
    const s = G.newGame(PLAYERS(n), r);
    for (const p of s.players) G.applyAction(s, p.id, { type: 'keepSetupTickets', ids: p.offer.slice(0, 2 + (seed % 3)) }, r);
    let steps = 0;
    while (s.phase === 'playing' && steps++ < 5000) {
      const p = cur(s);
      const t = s.turn;
      try {
        if (t.stage === 'tunnel') {
          const o = Pay.tunnelExtra(t.paid, t.extra, p.hand);
          if (o.length && r() < 0.8) G.applyAction(s, p.id, { type: 'tunnelPay', payment: o[0] }, r);
          else G.applyAction(s, p.id, { type: 'tunnelCancel' }, r);
        } else if (t.stage === 'tickets') {
          G.applyAction(s, p.id, { type: 'keepTickets', ids: [t.offer[0]] }, r);
        } else if (t.stage === 'drew') {
          if (s.deck.length || s.discard.length) G.applyAction(s, p.id, { type: 'drawBlind' }, r);
          else G.applyAction(s, p.id, { type: 'drawFaceUp', slot: s.faceUp.findIndex((c) => c && c !== 'loco') }, r);
        } else {
          const claimable = MAP.routes.filter((rt) => !G.routeBlockReason(s, rt, p) && Pay.route(rt, p.hand).length);
          if (claimable.length && r() < 0.6) {
            const rt = claimable[Math.floor(r() * claimable.length)];
            G.applyAction(s, p.id, { type: 'claimRoute', routeId: rt.id, payment: Pay.route(rt, p.hand)[0] }, r);
          } else if (p.stationsLeft && r() < 0.03 && Pay.station(4 - p.stationsLeft, p.hand).length) {
            const free = Object.keys(MAP.cities).filter((c) => !s.stations[c]);
            G.applyAction(s, p.id, { type: 'buildStation', cityId: free[0], payment: Pay.station(4 - p.stationsLeft, p.hand)[0] }, r);
          } else if (s.ticketDeck.length && r() < 0.05) {
            G.applyAction(s, p.id, { type: 'drawTickets' }, r);
          } else if (s.deck.length || s.discard.length) {
            G.applyAction(s, p.id, { type: 'drawBlind' }, r);
          } else if (s.faceUp.some(Boolean)) {
            G.applyAction(s, p.id, { type: 'drawFaceUp', slot: s.faceUp.findIndex(Boolean) }, r);
          } else if (s.ticketDeck.length) {
            G.applyAction(s, p.id, { type: 'drawTickets' }, r);
          } else {
            G.skipTurn(s);
          }
        }
      } catch (e) {
        if (!(e instanceof G.GameError)) throw e;
        throw new Error(`seed ${seed}: bot made an illegal move: ${e.message}`);
      }
      assert.equal(totalCards(s), 110, `seed ${seed}: card count`);
      for (const pl of s.players) assert.ok(pl.trains >= 0);
      const pub = JSON.stringify(G.publicView(s));
      assert.ok(!pub.includes('"hand"') && !pub.includes('"drawn"'), 'public view leaks private data');
    }
    assert.equal(s.phase, 'finished', `seed ${seed} did not finish`);
    const sum = s.results.map((x) => x.total);
    assert.deepEqual(sum, [...sum].sort((a, b) => b - a));
  }
});
