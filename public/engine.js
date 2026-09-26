/* ============================================================
   Πυρήνας κανόνων — καθαρή λογική, χωρίς DOM και χωρίς δίκτυο.
   Τρέχει αυτούσιος και στον server (Node) και στον browser.
   Απλοποιημένη έκδοση: χωρίς τούνελ, σταθμούς και κάρτες αποστολών.
   ============================================================ */
(function (root) {
  'use strict';

  const COLORS = ['r', 'o', 'y', 'g', 'b', 'k', 'w', 'p'];   // 8 χρώματα βαγονιών
  const LOCO = 'L';                                          // ατμομηχανή (μπαλαντέρ)
  const POINTS = { 1: 1, 2: 2, 3: 4, 4: 7, 5: 10, 6: 15, 7: 18, 8: 21 };
  const WAGONS = 45;
  const HAND_START = 4;
  const FACE_UP = 5;

  const PLAYER_COLORS = [
    { id: 'red', name: 'Κόκκινος', hex: '#c62828' },
    { id: 'blue', name: 'Μπλε', hex: '#1565c0' },
    { id: 'green', name: 'Πράσινος', hex: '#2e7d32' },
    { id: 'yellow', name: 'Κίτρινος', hex: '#f9a825' },
    { id: 'black', name: 'Μαύρος', hex: '#37474f' }
  ];

  /* ---------- γεννήτρια τυχαίων με σπόρο (αναπαραγώγιμα τεστ) ---------- */
  function rng(seed) {
    let s = seed >>> 0 || 1;
    return function () {
      s ^= s << 13; s >>>= 0;
      s ^= s >> 17;
      s ^= s << 5; s >>>= 0;
      return s / 4294967296;
    };
  }
  function shuffle(arr, rand) {
    for (let i = arr.length - 1; i > 0; i--) {
      const j = Math.floor(rand() * (i + 1));
      [arr[i], arr[j]] = [arr[j], arr[i]];
    }
    return arr;
  }

  function freshDeck(rand) {
    const d = [];
    COLORS.forEach(c => { for (let i = 0; i < 12; i++) d.push(c); });
    for (let i = 0; i < 14; i++) d.push(LOCO);
    return shuffle(d, rand);
  }

  /* ---------- δημιουργία παιχνιδιού ---------- */
  function createGame(routes, seed) {
    return {
      seed: seed || (Date.now() & 0x7fffffff),
      routes,                       // [a,b,len,color,flags]
      phase: 'lobby',               // lobby | playing | over
      players: [],                  // {id,name,pin,colorIdx,hand:{},wagons,score,connected}
      turn: 0,
      deck: [],
      discard: [],
      faceUp: [],
      owned: {},                    // routeIndex -> playerId
      drawnThisTurn: 0,
      finalRoundFrom: null,         // id του παίκτη που πυροδότησε το τέλος
      log: []
    };
  }

  function emptyHand() {
    const h = {}; COLORS.forEach(c => h[c] = 0); h[LOCO] = 0; return h;
  }
  const handSize = h => Object.values(h).reduce((a, b) => a + b, 0);

  function addPlayer(G, id, name, pin) {
    if (G.phase !== 'lobby') return { ok: false, error: 'Το παιχνίδι έχει ήδη ξεκινήσει' };
    if (G.players.length >= 5) return { ok: false, error: 'Το παιχνίδι είναι γεμάτο (5 παίκτες)' };
    name = String(name || '').trim().slice(0, 14);
    if (!name) return { ok: false, error: 'Χρειάζεται όνομα' };
    if (G.players.some(p => p.name.toLowerCase() === name.toLowerCase()))
      return { ok: false, error: 'Το όνομα χρησιμοποιείται ήδη' };
    G.players.push({
      id, name, pin: String(pin || ''), colorIdx: G.players.length,
      hand: emptyHand(), wagons: WAGONS, score: 0, connected: true
    });
    return { ok: true };
  }

  function start(G) {
    if (G.phase !== 'lobby') return { ok: false, error: 'Έχει ήδη ξεκινήσει' };
    if (G.players.length < 2) return { ok: false, error: 'Χρειάζονται τουλάχιστον 2 παίκτες' };
    const rand = rng(G.seed);
    G.deck = freshDeck(rand);
    G.players.forEach(p => {
      p.hand = emptyHand();
      for (let i = 0; i < HAND_START; i++) p.hand[G.deck.pop()]++;
    });
    G.faceUp = [];
    for (let i = 0; i < FACE_UP; i++) G.faceUp.push(G.deck.pop());
    refreshFaceUp(G);
    G.phase = 'playing';
    G.turn = 0;
    G.drawnThisTurn = 0;
    G.log.push('Το παιχνίδι ξεκίνησε · σειρά: ' + G.players[0].name);
    return { ok: true };
  }

  /* ---------- τράπουλα ---------- */
  function drawFromDeck(G) {
    if (!G.deck.length) {
      if (!G.discard.length) return null;
      G.deck = shuffle(G.discard.slice(), rng((G.seed + G.discard.length) >>> 0));
      G.discard = [];
    }
    return G.deck.pop();
  }
  // Αν τρεις ή περισσότερες φανερές κάρτες είναι ατμομηχανές, όλες πετιούνται και μοιράζονται νέες.
  function refreshFaceUp(G) {
    let guard = 0;
    while (guard++ < 10) {
      while (G.faceUp.length < FACE_UP) {
        const c = drawFromDeck(G);
        if (c === null) break;
        G.faceUp.push(c);
      }
      const locos = G.faceUp.filter(c => c === LOCO).length;
      const stock = G.deck.length + G.discard.length;
      if (locos >= 3 && stock >= FACE_UP) {
        G.discard.push(...G.faceUp);
        G.faceUp = [];
      } else break;
    }
  }

  /* ---------- βοηθητικά διαδρομών ---------- */
  const pairKey = r => [r[0], r[1]].sort().join('|');
  function parallelIndexes(G, idx) {
    const k = pairKey(G.routes[idx]);
    const out = [];
    G.routes.forEach((r, i) => { if (i !== idx && pairKey(r) === k) out.push(i); });
    return out;
  }
  function routeBlocked(G, idx, playerId) {
    if (G.owned[idx] !== undefined) return 'Η διαδρομή είναι ήδη πιασμένη';
    const par = parallelIndexes(G, idx);
    for (const j of par) {
      const o = G.owned[j];
      if (o === undefined) continue;
      // Με 2–3 παίκτες χρησιμοποιείται μόνο η μία από τις δύο παράλληλες.
      if (G.players.length < 4) return 'Με λίγους παίκτες χρησιμοποιείται μόνο η μία παράλληλη διαδρομή';
      if (o === playerId) return 'Δεν μπορείς να πάρεις και τις δύο παράλληλες διαδρομές';
    }
    return null;
  }
  const ferryLocos = r => (r[4] && r[4][0] === 'f') ? +r[4][1] : 0;

  /* ---------- ενέργειες ---------- */
  function current(G) { return G.players[G.turn]; }

  function endTurn(G) {
    const p = current(G);
    if (p.wagons <= 2 && G.finalRoundFrom === null) {
      G.finalRoundFrom = p.id;
      G.log.push('⏳ ' + p.name + ' έμεινε με ' + p.wagons + ' βαγόνια — τελευταίος γύρος!');
    }
    G.drawnThisTurn = 0;
    const next = (G.turn + 1) % G.players.length;
    if (G.finalRoundFrom !== null && G.players[next].id === G.finalRoundFrom) {
      finish(G);
      return;
    }
    G.turn = next;
  }

  function finish(G) {
    G.phase = 'over';
    let best = null;
    G.players.forEach(p => { if (!best || p.score > best.score) best = p; });
    G.winner = best ? best.id : null;
    G.log.push('🏁 Τέλος! Νικητής: ' + (best ? best.name : '—'));
  }

  function apply(G, playerId, act) {
    if (G.phase !== 'playing') return { ok: false, error: 'Το παιχνίδι δεν είναι σε εξέλιξη' };
    const p = current(G);
    if (!p || p.id !== playerId) return { ok: false, error: 'Δεν είναι η σειρά σου' };

    if (act.type === 'drawFaceUp') {
      const i = act.index | 0;
      const card = G.faceUp[i];
      if (card === undefined) return { ok: false, error: 'Δεν υπάρχει κάρτα εκεί' };
      if (card === LOCO && G.drawnThisTurn === 1)
        return { ok: false, error: 'Ατμομηχανή από τις φανερές μετράει για όλη τη σειρά' };
      p.hand[card]++;
      G.faceUp.splice(i, 1);
      refreshFaceUp(G);
      G.log.push(p.name + ' πήρε ' + (card === LOCO ? 'ατμομηχανή' : 'κάρτα') + ' από τις φανερές');
      if (card === LOCO) { endTurn(G); return { ok: true }; }
      G.drawnThisTurn++;
      if (G.drawnThisTurn >= 2) endTurn(G);
      return { ok: true };
    }

    if (act.type === 'drawDeck') {
      const c = drawFromDeck(G);
      if (c === null) return { ok: false, error: 'Η τράπουλα τελείωσε' };
      p.hand[c]++;
      G.log.push(p.name + ' τράβηξε από την τράπουλα');
      G.drawnThisTurn++;
      if (G.drawnThisTurn >= 2) endTurn(G);
      return { ok: true };
    }

    if (act.type === 'claim') {
      if (G.drawnThisTurn > 0) return { ok: false, error: 'Έχεις ήδη τραβήξει κάρτες αυτή τη σειρά' };
      const idx = act.index | 0;
      const r = G.routes[idx];
      if (!r) return { ok: false, error: 'Άγνωστη διαδρομή' };
      const blocked = routeBlocked(G, idx, playerId);
      if (blocked) return { ok: false, error: blocked };

      const len = r[2], routeColor = r[3];
      if (p.wagons < len) return { ok: false, error: 'Δεν έχεις αρκετά βαγόνια' };

      const needLoco = ferryLocos(r);
      let locos = Math.max(0, act.locos | 0);
      const color = act.color;

      if (locos < needLoco) return { ok: false, error: 'Το πορθμείο θέλει ' + needLoco + ' ατμομηχανή/ές' };
      if (locos > len) return { ok: false, error: 'Πολλές ατμομηχανές' };
      const colored = len - locos;

      if (colored > 0) {
        if (!COLORS.includes(color)) return { ok: false, error: 'Διάλεξε χρώμα καρτών' };
        if (routeColor !== 'x' && color !== routeColor)
          return { ok: false, error: 'Η διαδρομή θέλει ' + routeColor };
        if ((p.hand[color] || 0) < colored)
          return { ok: false, error: 'Δεν έχεις αρκετές κάρτες σε αυτό το χρώμα' };
      }
      if ((p.hand[LOCO] || 0) < locos) return { ok: false, error: 'Δεν έχεις τόσες ατμομηχανές' };

      if (colored > 0) { p.hand[color] -= colored; for (let i = 0; i < colored; i++) G.discard.push(color); }
      if (locos > 0) { p.hand[LOCO] -= locos; for (let i = 0; i < locos; i++) G.discard.push(LOCO); }

      p.wagons -= len;
      p.score += POINTS[len] || 0;
      G.owned[idx] = playerId;
      G.log.push(p.name + ' πήρε ' + r[0] + '–' + r[1] + ' (+' + (POINTS[len] || 0) + ')');
      endTurn(G);
      return { ok: true };
    }

    return { ok: false, error: 'Άγνωστη ενέργεια' };
  }

  /* ---------- τι βλέπει ο καθένας ---------- */
  function publicState(G, forId) {
    return {
      phase: G.phase,
      turn: G.turn,
      turnPlayerId: G.players[G.turn] ? G.players[G.turn].id : null,
      drawnThisTurn: G.drawnThisTurn,
      faceUp: G.faceUp.slice(),
      deckLeft: G.deck.length,
      discardLeft: G.discard.length,
      owned: G.owned,
      finalRound: G.finalRoundFrom !== null,
      winner: G.winner || null,
      log: G.log.slice(-8),
      players: G.players.map(p => ({
        id: p.id, name: p.name, colorIdx: p.colorIdx, wagons: p.wagons,
        score: p.score, cards: handSize(p.hand), connected: p.connected
      })),
      you: (() => {
        const me = G.players.find(p => p.id === forId);
        if (!me) return null;
        return { id: me.id, name: me.name, colorIdx: me.colorIdx, hand: me.hand, wagons: me.wagons, score: me.score };
      })()
    };
  }

  const API = {
    COLORS, LOCO, POINTS, WAGONS, PLAYER_COLORS,
    createGame, addPlayer, start, apply, publicState,
    parallelIndexes, routeBlocked, ferryLocos, handSize, current, rng, shuffle
  };

  if (typeof module !== 'undefined' && module.exports) module.exports = API;
  else root.ENGINE = API;
})(typeof window !== 'undefined' ? window : globalThis);
