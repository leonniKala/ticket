'use strict';
/*
 * Ticket to Ride – Europe rules engine.
 *
 * The whole game lives in one plain JSON-serialisable state object so it can be saved to disk.
 * Every move goes through applyAction(), which throws GameError for anything illegal.
 */
const MAP = require('../public/js/map-data.js');

const { COLORS, RULES, cities, routes, tickets } = MAP;
const ROUTES = Object.fromEntries(routes.map((r) => [r.id, r]));
const TICKETS = Object.fromEntries(tickets.map((t) => [t.id, t]));
const PLAYER_COLORS = ['red', 'blue', 'green', 'yellow', 'black'];
const CARD_TYPES = [...COLORS, 'loco'];

const GR = {
  purple: 'μωβ', white: 'λευκή', blue: 'μπλε', yellow: 'κίτρινη', orange: 'πορτοκαλί',
  black: 'μαύρη', red: 'κόκκινη', green: 'πράσινη', loco: 'ατμομηχανή', gray: 'γκρι',
};
const GR_PL = {
  purple: 'μωβ', white: 'λευκές', blue: 'μπλε', yellow: 'κίτρινες', orange: 'πορτοκαλί',
  black: 'μαύρες', red: 'κόκκινες', green: 'πράσινες', loco: 'ατμομηχανές',
};
const cardsName = (n, c) => `${n} ${n === 1 ? GR[c] : GR_PL[c]}`;

class GameError extends Error {}
const fail = (msg) => { throw new GameError(msg); };
// Look up client-supplied keys without reaching inherited properties like __proto__.
const own = (obj, key) => (typeof key === 'string' && Object.prototype.hasOwnProperty.call(obj, key) ? obj[key] : null);

function shuffle(arr, rng) {
  const a = arr.slice();
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

const emptyHand = () => Object.fromEntries(CARD_TYPES.map((c) => [c, 0]));
const handCount = (hand) => CARD_TYPES.reduce((n, c) => n + hand[c], 0);
const routeName = (r) => `${cities[r.a].name} – ${cities[r.b].name}`;

// ------------------------------------------------------------------ setup

/**
 * players: [{ id, name, color }] in seating order.
 */
function newGame(players, rng = Math.random) {
  if (players.length < RULES.minPlayers || players.length > RULES.maxPlayers) {
    fail(`Χρειάζονται ${RULES.minPlayers}–${RULES.maxPlayers} παίκτες`);
  }
  const deck = [];
  for (const c of COLORS) for (let i = 0; i < RULES.cardsPerColor; i++) deck.push(c);
  for (let i = 0; i < RULES.locomotives; i++) deck.push('loco');

  const s = {
    version: 1,
    phase: 'setup',
    seq: 0,
    turnNo: 0,
    players: players.map((p) => ({
      id: p.id, name: p.name, color: p.color,
      hand: emptyHand(), tickets: [], offer: [], ready: false,
      trains: RULES.trainsPerPlayer, stationsLeft: RULES.stationsPerPlayer, routePoints: 0,
    })),
    deck: shuffle(deck, rng),
    discard: [],
    faceUp: [null, null, null, null, null],
    ticketDeck: shuffle(tickets.filter((t) => !t.long).map((t) => t.id), rng),
    claims: {},
    stations: {},
    current: Math.floor(rng() * players.length),
    turn: { stage: 'setup' },
    finalTurns: null,
    lastRoundBy: null,
    log: [],
    events: [],
    results: null,
  };

  const longs = shuffle(tickets.filter((t) => t.long).map((t) => t.id), rng);
  for (const p of s.players) {
    for (let i = 0; i < RULES.startingHand; i++) p.hand[drawCard(s, rng)]++;
    p.offer = [longs.pop(), ...s.ticketDeck.splice(0, 3)];
  }
  refillFaceUp(s, rng);
  addLog(s, null, 'Νέο παιχνίδι! Κάθε παίκτης κρατάει τουλάχιστον 2 κάρτες προορισμού.');
  return s;
}

// ------------------------------------------------------------------ cards

function drawCard(s, rng) {
  if (!s.deck.length) {
    if (!s.discard.length) return null;
    s.deck = shuffle(s.discard, rng);
    s.discard = [];
  }
  return s.deck.pop();
}

function refillFaceUp(s, rng) {
  const fill = () => {
    for (let i = 0; i < 5; i++) if (!s.faceUp[i]) s.faceUp[i] = drawCard(s, rng);
  };
  fill();
  // Three face-up locomotives: discard all five and deal five new ones (if that can help at all).
  for (let guard = 0; guard < 8; guard++) {
    if (s.faceUp.filter((c) => c === 'loco').length < 3) break;
    const others = s.deck.concat(s.discard).filter((c) => c !== 'loco').length;
    if (others < 3) break;
    s.discard.push(...s.faceUp.filter(Boolean));
    s.faceUp = [null, null, null, null, null];
    fill();
    addLog(s, null, 'Τρεις ανοιχτές ατμομηχανές: οι 5 κάρτες άλλαξαν.');
  }
}

function canDrawAnything(s, second) {
  if (s.deck.length || s.discard.length) return true;
  return s.faceUp.some((c) => c && (!second || c !== 'loco'));
}

// ------------------------------------------------------------------ helpers

function addLog(s, pid, text) {
  s.log.push({ seq: s.seq, pid, text });
  if (s.log.length > 80) s.log.splice(0, s.log.length - 80);
}

// Notable things that happened (for TV animations); several can share one seq.
function setEvent(s, ev) {
  s.events = (s.events || []).filter((e) => e.seq > s.seq - 5);
  s.events.push({ seq: s.seq, ...ev });
}

function playerById(s, pid) {
  const p = s.players.find((x) => x.id === pid);
  if (!p) fail('Άγνωστος παίκτης');
  return p;
}

function requireTurn(s, pid, ...stages) {
  if (s.phase !== 'playing') fail('Το παιχνίδι δεν είναι σε εξέλιξη');
  const p = s.players[s.current];
  if (p.id !== pid) fail('Δεν είναι η σειρά σου');
  if (stages.length && !stages.includes(s.turn.stage)) {
    const why = {
      drew: 'Πρέπει να τραβήξεις και δεύτερη κάρτα βαγονιού',
      tunnel: 'Πρώτα ολοκλήρωσε τη σήραγγα',
      tickets: 'Πρώτα διάλεξε κάρτες προορισμού',
    };
    fail(why[s.turn.stage] || 'Αυτή η κίνηση δεν επιτρέπεται τώρα');
  }
  return p;
}

/** Why a route can't be claimed by player p right now (or null if it can). */
function routeBlockReason(s, route, p) {
  if (s.claims[route.id]) return 'Η διαδρομή έχει ήδη καταληφθεί';
  if (route.twin && s.claims[route.twin]) {
    if (s.claims[route.twin] === p.id) return 'Δεν μπορείς να πάρεις και τις δύο παράλληλες διαδρομές';
    if (s.players.length < RULES.doubleRoutesMinPlayers) {
      return 'Με 2–3 παίκτες χρησιμοποιείται μόνο η μία από τις παράλληλες διαδρομές';
    }
  }
  if (p.trains < route.length) return 'Δεν σου φτάνουν τα βαγόνια';
  return null;
}

/**
 * payment = { color, loco }: `loco` locomotives plus (total - loco) cards of `color`.
 * allowed(color) says which colours may be used.
 */
function checkPayment(hand, payment, total, { minLoco = 0, allowed = () => true } = {}) {
  const loco = payment && typeof payment === 'object' && Number.isInteger(payment.loco) ? payment.loco : -1;
  if (loco < 0 || loco > total) fail('Μη έγκυρη πληρωμή');
  const n = total - loco;
  if (loco < minLoco) fail(minLoco === 1 ? 'Χρειάζεται τουλάχιστον 1 ατμομηχανή' : `Χρειάζονται τουλάχιστον ${minLoco} ατμομηχανές`);
  if (hand.loco < loco) fail('Δεν έχεις αρκετές ατμομηχανές');
  if (n > 0) {
    if (!COLORS.includes(payment.color)) fail('Διάλεξε χρώμα καρτών');
    if (!allowed(payment.color)) fail('Λάθος χρώμα καρτών για αυτή τη διαδρομή');
    if (hand[payment.color] < n) fail(`Δεν έχεις ${cardsName(n, payment.color)}`);
  }
  return { color: n > 0 ? payment.color : null, n, loco };
}

function takeCards(p, pay) {
  if (pay.n) p.hand[pay.color] -= pay.n;
  p.hand.loco -= pay.loco;
  const cards = [];
  for (let i = 0; i < pay.n; i++) cards.push(pay.color);
  for (let i = 0; i < pay.loco; i++) cards.push('loco');
  return cards;
}

function giveBack(p, pay) {
  if (pay.n) p.hand[pay.color] += pay.n;
  p.hand.loco += pay.loco;
}

function payText(pay) {
  const parts = [];
  if (pay.n) parts.push(cardsName(pay.n, pay.color));
  if (pay.loco) parts.push(cardsName(pay.loco, 'loco'));
  return parts.join(' + ');
}

// ------------------------------------------------------------------ turn flow

function endTurn(s) {
  const p = s.players[s.current];
  if (s.finalTurns !== null) {
    s.finalTurns--;
    if (s.finalTurns <= 0) return finish(s);
  } else if (p.trains <= RULES.endGameTrains) {
    s.finalTurns = s.players.length;
    s.lastRoundBy = p.id;
    addLog(s, p.id, `${p.name} έμεινε με ${p.trains} βαγόνια: ΤΕΛΕΥΤΑΙΟΣ ΓΥΡΟΣ για όλους!`);
    setEvent(s, { type: 'lastRound', pid: p.id });
  }
  s.current = (s.current + 1) % s.players.length;
  s.turn = { stage: 'start' };
  s.turnNo++;
}

function startPlaying(s) {
  s.phase = 'playing';
  s.turn = { stage: 'start' };
  s.turnNo = 1;
  addLog(s, s.players[s.current].id, `Ξεκινάει: ${s.players[s.current].name}.`);
}

// ------------------------------------------------------------------ actions

const ACTIONS = {
  keepSetupTickets(s, pid, { ids }, rng) {
    if (s.phase !== 'setup') fail('Η αρχική επιλογή έχει τελειώσει');
    const p = playerById(s, pid);
    if (p.ready) fail('Έχεις ήδη διαλέξει');
    const keep = validateKeep(p.offer, ids, 2);
    p.tickets.push(...keep);
    for (const id of p.offer) {
      if (!keep.includes(id) && !TICKETS[id].long) s.ticketDeck.push(id);
    }
    p.offer = [];
    p.ready = true;
    addLog(s, pid, `${p.name} κράτησε ${keep.length} κάρτες προορισμού.`);
    if (s.players.every((x) => x.ready)) startPlaying(s);
  },

  drawFaceUp(s, pid, { slot }, rng) {
    const p = requireTurn(s, pid, 'start', 'drew');
    if (!Number.isInteger(slot) || slot < 0 || slot > 4) fail('Μη έγκυρη θέση κάρτας');
    const card = s.faceUp[slot];
    if (!card) fail('Δεν υπάρχει κάρτα σε αυτή τη θέση');
    if (card === 'loco' && s.turn.stage === 'drew') fail('Δεν μπορείς να πάρεις ανοιχτή ατμομηχανή ως δεύτερη κάρτα');
    p.hand[card]++;
    s.faceUp[slot] = null;
    refillFaceUp(s, rng);
    addLog(s, pid, `${p.name} πήρε ${GR[card]} από τις ανοιχτές.`);
    setEvent(s, { type: 'drawFaceUp', pid, card });
    if (s.turn.stage === 'start' && card !== 'loco') {
      s.turn = { stage: 'drew', drawn: [] };
      if (!canDrawAnything(s, true)) endTurn(s);
    } else {
      if (s.turn.drawn && s.turn.drawn.length) p.lastDrawn = s.turn.drawn;
      endTurn(s);
    }
  },

  drawBlind(s, pid, _args, rng) {
    const p = requireTurn(s, pid, 'start', 'drew');
    const card = drawCard(s, rng);
    if (!card) fail('Η τράπουλα είναι άδεια');
    p.hand[card]++;
    addLog(s, pid, `${p.name} τράβηξε κάρτα από την τράπουλα.`);
    setEvent(s, { type: 'drawBlind', pid });
    if (s.turn.stage === 'start') {
      s.turn = { stage: 'drew', drawn: [card] };
      if (!canDrawAnything(s, true)) { p.lastDrawn = [card]; endTurn(s); }
    } else {
      // Remember what was drawn so the phone can still show it after the turn passes on.
      p.lastDrawn = [...s.turn.drawn, card];
      endTurn(s);
    }
  },

  claimRoute(s, pid, { routeId, payment }, rng) {
    const p = requireTurn(s, pid, 'start');
    const route = own(ROUTES, routeId);
    if (!route) fail('Άγνωστη διαδρομή');
    const blocked = routeBlockReason(s, route, p);
    if (blocked) fail(blocked);
    const pay = checkPayment(p.hand, payment, route.length, {
      minLoco: route.ferry,
      allowed: (c) => route.color === 'gray' || c === route.color,
    });
    if (!route.tunnel) {
      s.discard.push(...takeCards(p, pay));
      return completeClaim(s, p, route, pay);
    }
    // Tunnel: set the cards aside and reveal three from the deck.
    takeCards(p, pay);
    const revealed = [];
    for (let i = 0; i < 3; i++) {
      const c = drawCard(s, rng);
      if (c) revealed.push(c);
    }
    const extra = revealed.filter((c) => c === 'loco' || (pay.color && c === pay.color)).length;
    setEvent(s, { type: 'tunnel', pid, routeId, revealed, extra });
    if (!extra) {
      s.discard.push(...revealed);
      s.discard.push(...cardsOf(pay));
      addLog(s, pid, `Σήραγγα ${routeName(route)}: καμία επιπλέον κάρτα!`);
      return completeClaim(s, p, route, pay);
    }
    s.turn = { stage: 'tunnel', routeId, paid: pay, revealed, extra };
    addLog(s, pid, `Σήραγγα ${routeName(route)}: ${extra === 1 ? 'χρειάζεται 1 επιπλέον κάρτα' : `χρειάζονται ${extra} επιπλέον κάρτες`}.`);
  },

  tunnelPay(s, pid, { payment }) {
    const p = requireTurn(s, pid, 'tunnel');
    const t = s.turn, route = ROUTES[t.routeId];
    const pay = checkPayment(p.hand, payment, t.extra, {
      minLoco: t.paid.color ? 0 : t.extra,
      allowed: (c) => c === t.paid.color,
    });
    s.discard.push(...takeCards(p, pay), ...cardsOf(t.paid), ...t.revealed);
    completeClaim(s, p, route, { color: t.paid.color, n: t.paid.n + pay.n, loco: t.paid.loco + pay.loco });
  },

  tunnelCancel(s, pid) {
    const p = requireTurn(s, pid, 'tunnel');
    const t = s.turn, route = ROUTES[t.routeId];
    giveBack(p, t.paid);
    s.discard.push(...t.revealed);
    addLog(s, pid, `${p.name} δεν πέρασε τη σήραγγα ${routeName(route)}.`);
    setEvent(s, { type: 'tunnelFail', pid, routeId: route.id });
    endTurn(s);
  },

  drawTickets(s, pid) {
    const p = requireTurn(s, pid, 'start');
    if (!s.ticketDeck.length) fail('Δεν έχουν μείνει κάρτες προορισμού');
    s.turn = { stage: 'tickets', offer: s.ticketDeck.splice(0, 3) };
    addLog(s, pid, `${p.name} τραβάει κάρτες προορισμού.`);
  },

  keepTickets(s, pid, { ids }) {
    const p = requireTurn(s, pid, 'tickets');
    const keep = validateKeep(s.turn.offer, ids, 1);
    p.tickets.push(...keep);
    s.ticketDeck.push(...s.turn.offer.filter((id) => !keep.includes(id)));
    addLog(s, pid, `${p.name} κράτησε ${keep.length} ${keep.length === 1 ? 'κάρτα' : 'κάρτες'} προορισμού.`);
    setEvent(s, { type: 'tickets', pid, count: keep.length });
    endTurn(s);
  },

  buildStation(s, pid, { cityId, payment }) {
    const p = requireTurn(s, pid, 'start');
    const city = own(cities, cityId);
    if (!city) fail('Άγνωστη πόλη');
    if (p.stationsLeft <= 0) fail('Δεν σου έχουν μείνει σταθμοί');
    if (s.stations[cityId]) fail('Υπάρχει ήδη σταθμός σε αυτή την πόλη');
    const cost = RULES.stationsPerPlayer - p.stationsLeft + 1;
    const pay = checkPayment(p.hand, payment, cost);
    s.discard.push(...takeCards(p, pay));
    s.stations[cityId] = pid;
    p.stationsLeft--;
    addLog(s, pid, `${p.name} έχτισε σταθμό στο ${city.name} (${payText(pay)}).`);
    setEvent(s, { type: 'station', pid, cityId });
    endTurn(s);
  },
};

function cardsOf(pay) {
  return [...Array(pay.n).fill(pay.color), ...Array(pay.loco).fill('loco')];
}

function validateKeep(offer, ids, min) {
  if (!Array.isArray(ids) || ids.some((id) => typeof id !== 'string')) fail('Μη έγκυρη επιλογή');
  const keep = [...new Set(ids)];
  if (keep.some((id) => !offer.includes(id))) fail('Μη έγκυρη κάρτα προορισμού');
  const need = Math.min(min, offer.length);
  if (keep.length < need) fail(`Πρέπει να κρατήσεις τουλάχιστον ${need}`);
  return keep;
}

function completeClaim(s, p, route, pay) {
  s.claims[route.id] = p.id;
  p.trains -= route.length;
  p.routePoints += route.points;
  addLog(s, p.id, `${p.name} πήρε ${routeName(route)} (${payText(pay)}): +${route.points}.`);
  setEvent(s, { type: 'claim', pid: p.id, routeId: route.id, points: route.points });
  endTurn(s);
}

/** Admin override: end the current player's turn without a move. */
function skipTurn(s) {
  if (s.phase !== 'playing') fail('Το παιχνίδι δεν είναι σε εξέλιξη');
  const p = s.players[s.current], t = s.turn;
  if (t.stage === 'tunnel') { giveBack(p, t.paid); s.discard.push(...t.revealed); }
  if (t.stage === 'tickets') s.ticketDeck.push(...t.offer);
  addLog(s, p.id, `Παράλειψη σειράς: ${p.name}.`);
  s.seq++;
  endTurn(s);
}

function applyAction(s, pid, action, rng = Math.random) {
  const fn = action && Object.prototype.hasOwnProperty.call(ACTIONS, action.type) && ACTIONS[action.type];
  if (!fn) fail('Άγνωστη κίνηση');
  if (s.phase === 'finished') fail('Το παιχνίδι τελείωσε');
  // Work on a copy so a failed move never leaves the state half-changed.
  const draft = JSON.parse(JSON.stringify(s));
  draft.seq++;
  for (const p of draft.players) if (p.id === pid) delete p.lastDrawn;
  fn(draft, pid, action, rng);
  Object.assign(s, draft);
  return s;
}

// ------------------------------------------------------------------ scoring

function connected(edges, a, b) {
  const parent = {};
  const find = (x) => (parent[x] === undefined || parent[x] === x ? (parent[x] = x) : (parent[x] = find(parent[x])));
  for (const e of edges) parent[find(e.a)] = find(e.b);
  return find(a) === find(b);
}

function longestTrail(edges) {
  const adj = {};
  edges.forEach((e, i) => { (adj[e.a] = adj[e.a] || []).push(i); (adj[e.b] = adj[e.b] || []).push(i); });
  const used = new Array(edges.length).fill(false);
  let best = 0, bestPath = [];
  const path = [];
  function dfs(city, total) {
    if (total > best) { best = total; bestPath = path.slice(); }
    for (const i of adj[city] || []) {
      if (used[i]) continue;
      used[i] = true; path.push(edges[i].id);
      dfs(edges[i].a === city ? edges[i].b : edges[i].a, total + edges[i].length);
      used[i] = false; path.pop();
    }
  }
  for (const c of Object.keys(adj)) dfs(c, 0);
  return { length: best, routes: bestPath };
}

function ownEdges(s, pid) {
  return Object.entries(s.claims).filter(([, owner]) => owner === pid).map(([id]) => ROUTES[id]);
}

/** Ticket results for a player; stations borrow the best possible opponent route. */
function ticketResults(s, p) {
  const own = ownEdges(s, p.id);
  const stationCities = Object.keys(s.stations).filter((c) => s.stations[c] === p.id);
  const options = stationCities.map((c) => [null, ...Object.entries(s.claims)
    .filter(([id, owner]) => owner !== p.id && (ROUTES[id].a === c || ROUTES[id].b === c))
    .map(([id]) => ROUTES[id])]);
  let best = null;
  const evaluate = (borrowed) => {
    const edges = own.concat(borrowed.filter(Boolean));
    const list = p.tickets.map((id) => {
      const t = TICKETS[id];
      return { id, done: connected(edges, t.a, t.b), points: t.points };
    });
    const score = list.reduce((n, t) => n + (t.done ? t.points : -t.points), 0);
    const done = list.filter((t) => t.done).length;
    if (!best || score > best.score || (score === best.score && done > best.done)) {
      best = { score, done, list, borrowed: borrowed.filter(Boolean).map((r) => r.id) };
    }
  };
  const walk = (i, acc) => {
    if (i === options.length) return evaluate(acc);
    for (const o of options[i]) walk(i + 1, acc.concat([o]));
  };
  walk(0, []);
  return best;
}

function finish(s) {
  s.phase = 'finished';
  s.turn = { stage: 'finished' };
  const rows = s.players.map((p) => {
    const tr = ticketResults(s, p);
    const trail = longestTrail(ownEdges(s, p.id));
    return {
      id: p.id, name: p.name, color: p.color,
      routePoints: p.routePoints,
      ticketPoints: tr.score,
      ticketsDone: tr.done,
      tickets: tr.list,
      borrowed: tr.borrowed,
      stationsLeft: p.stationsLeft,
      stationPoints: p.stationsLeft * RULES.stationPoints,
      longest: trail.length,
      longestRoutes: trail.routes,
      express: 0,
    };
  });
  const maxLen = Math.max(...rows.map((r) => r.longest));
  for (const r of rows) {
    if (maxLen > 0 && r.longest === maxLen) r.express = RULES.longestPathBonus;
    r.total = r.routePoints + r.ticketPoints + r.stationPoints + r.express;
  }
  rows.sort((a, b) => b.total - a.total || b.ticketsDone - a.ticketsDone
    || b.stationsLeft - a.stationsLeft || b.express - a.express);
  rows.forEach((r, i) => {
    const prev = rows[i - 1];
    r.rank = prev && prev.total === r.total && prev.ticketsDone === r.ticketsDone
      && prev.stationsLeft === r.stationsLeft && prev.express === r.express ? prev.rank : i + 1;
  });
  s.results = rows;
  addLog(s, rows[0].id, `Τέλος παιχνιδιού! Νικητής: ${rows[0].name} με ${rows[0].total} πόντους.`);
  setEvent(s, { type: 'finish' });
}

// ------------------------------------------------------------------ views

/** Everything everyone may see (TV, all phones). */
function publicView(s) {
  const t = s.turn;
  const turn = { stage: t.stage };
  if (t.stage === 'tunnel') Object.assign(turn, { routeId: t.routeId, revealed: t.revealed, extra: t.extra, paid: t.paid });
  if (t.stage === 'tickets') turn.offerCount = t.offer.length;
  return {
    phase: s.phase,
    seq: s.seq,
    turnNo: s.turnNo,
    players: s.players.map((p) => ({
      id: p.id, name: p.name, color: p.color, trains: p.trains, stationsLeft: p.stationsLeft,
      score: p.routePoints, handCount: handCount(p.hand), ticketCount: p.tickets.length, ready: p.ready,
    })),
    faceUp: s.faceUp,
    deckCount: s.deck.length,
    discardCount: s.discard.length,
    ticketDeckCount: s.ticketDeck.length,
    claims: s.claims,
    stations: s.stations,
    current: s.phase === 'playing' ? s.players[s.current].id : null,
    turn,
    finalTurns: s.finalTurns,
    lastRoundBy: s.lastRoundBy,
    log: s.log.slice(-25),
    events: s.events || [],
    results: s.results,
  };
}

/** A player's own secret information. */
function privateView(s, pid) {
  const p = s.players.find((x) => x.id === pid);
  if (!p) return null;
  const edges = ownEdges(s, pid);
  const isTurn = s.phase === 'playing' && s.players[s.current].id === pid;
  return {
    id: p.id,
    hand: p.hand,
    tickets: p.tickets.map((id) => ({ ...TICKETS[id], done: connected(edges, TICKETS[id].a, TICKETS[id].b) })),
    offer: s.phase === 'setup' ? p.offer.map((id) => TICKETS[id])
      : isTurn && s.turn.stage === 'tickets' ? s.turn.offer.map((id) => TICKETS[id]) : [],
    offerMin: s.phase === 'setup' ? 2 : 1,
    drawn: isTurn && s.turn.stage === 'drew' ? s.turn.drawn : p.lastDrawn || [],
    stationCost: RULES.stationsPerPlayer - p.stationsLeft + 1,
  };
}

module.exports = {
  GameError, PLAYER_COLORS, CARD_TYPES, ROUTES, TICKETS,
  newGame, applyAction, skipTurn, publicView, privateView,
  routeBlockReason, longestTrail, ticketResults, finish, handCount,
};
