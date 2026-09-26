const E = require('./public/engine.js');
const routes = require('/home/claude/ttr/routes.json');

let pass = 0, fail = 0;
function ok(name, cond, extra) {
  if (cond) { pass++; console.log('PASS  ' + name); }
  else { fail++; console.log('FAIL  ' + name + (extra ? '\n      ' + extra : '')); }
}
function game(n, seed) {
  const G = E.createGame(routes, seed || 12345);
  for (let i = 0; i < n; i++) E.addPlayer(G, 'p' + i, 'Παίκτης' + i, '111' + i);
  E.start(G);
  return G;
}

/* --- στήσιμο --- */
let G = game(3);
ok('μοιράζονται 4 κάρτες σε καθέναν', G.players.every(p => E.handSize(p.hand) === 4));
ok('5 φανερές κάρτες', G.faceUp.length === 5);
ok('σύνολο τράπουλας 110', G.deck.length + G.faceUp.length + 3 * 4 === 110,
   'βρέθηκε ' + (G.deck.length + G.faceUp.length + 12));
ok('45 βαγόνια ο καθένας', G.players.every(p => p.wagons === 45));
ok('ποτέ 3+ ατμομηχανές φανερές', G.faceUp.filter(c => c === 'L').length < 3);

/* --- σειρά --- */
G = game(2);
let r = E.apply(G, 'p1', { type: 'drawDeck' });
ok('δεν παίζει όποιος δεν έχει σειρά', !r.ok && /σειρά/.test(r.error));
E.apply(G, 'p0', { type: 'drawDeck' });
ok('μετά από 1 κάρτα η σειρά μένει ίδια', G.turn === 0);
E.apply(G, 'p0', { type: 'drawDeck' });
ok('μετά από 2 κάρτες περνά η σειρά', G.turn === 1);
ok('το χέρι μεγάλωσε κατά 2', E.handSize(G.players[0].hand) === 6);

/* --- ατμομηχανή από τις φανερές τελειώνει τη σειρά --- */
G = game(2);
G.faceUp[0] = 'L';
E.apply(G, 'p0', { type: 'drawFaceUp', index: 0 });
ok('φανερή ατμομηχανή = ολόκληρη σειρά', G.turn === 1 && G.players[0].hand.L >= 1);

G = game(2);
G.faceUp = ['r', 'L', 'g', 'b', 'y'];
E.apply(G, 'p0', { type: 'drawFaceUp', index: 0 });
const before = G.turn;
r = E.apply(G, 'p0', { type: 'drawFaceUp', index: G.faceUp.indexOf('L') });
ok('απαγορεύεται φανερή ατμομηχανή ως δεύτερη κάρτα', !r.ok && G.turn === before);

/* --- διεκδίκηση διαδρομής --- */
function findRoute(fn) { const i = routes.findIndex(fn); return i; }
const iEdLon = findRoute(x => x[0] === 'Edinburgh' && x[3] === 'o');   // 4 πορτοκαλί
G = game(2);
G.players[0].hand = { r: 0, o: 4, y: 0, g: 0, b: 0, k: 0, w: 0, p: 0, L: 0 };
r = E.apply(G, 'p0', { type: 'claim', index: iEdLon, color: 'o', locos: 0 });
ok('διεκδίκηση με σωστό χρώμα', r.ok && G.owned[iEdLon] === 'p0');
ok('αφαιρέθηκαν 4 βαγόνια', G.players[0].wagons === 41);
ok('δόθηκαν 7 πόντοι για μήκος 4', G.players[0].score === 7);
ok('ξοδεύτηκαν οι κάρτες', G.players[0].hand.o === 0);
ok('οι κάρτες πήγαν στα σκουπίδια', G.discard.length === 4);
ok('πέρασε η σειρά', G.turn === 1);

G = game(2);
G.players[0].hand = { r: 0, o: 3, y: 0, g: 0, b: 0, k: 0, w: 0, p: 0, L: 0 };
r = E.apply(G, 'p0', { type: 'claim', index: iEdLon, color: 'o', locos: 0 });
ok('χωρίς αρκετές κάρτες δεν γίνεται', !r.ok);

G = game(2);
G.players[0].hand = { r: 4, o: 0, y: 0, g: 0, b: 0, k: 0, w: 0, p: 0, L: 0 };
r = E.apply(G, 'p0', { type: 'claim', index: iEdLon, color: 'r', locos: 0 });
ok('λάθος χρώμα απορρίπτεται', !r.ok);

/* --- γκρι διαδρομή: οποιοδήποτε χρώμα --- */
const iGrey = findRoute(x => x[3] === 'x' && x[2] === 2 && !x[4]);
G = game(2);
G.players[0].hand = { r: 0, o: 0, y: 0, g: 2, b: 0, k: 0, w: 0, p: 0, L: 0 };
r = E.apply(G, 'p0', { type: 'claim', index: iGrey, color: 'g', locos: 0 });
ok('γκρι διαδρομή δέχεται οποιοδήποτε χρώμα', r.ok);

/* --- ατμομηχανές ως μπαλαντέρ --- */
G = game(2);
G.players[0].hand = { r: 0, o: 2, y: 0, g: 0, b: 0, k: 0, w: 0, p: 0, L: 2 };
r = E.apply(G, 'p0', { type: 'claim', index: iEdLon, color: 'o', locos: 2 });
ok('ατμομηχανές συμπληρώνουν χρώμα', r.ok && G.players[0].hand.L === 0);

/* --- πορθμεία --- */
const iFerry = findRoute(x => x[4] === 'f2');
G = game(2);
const fr = routes[iFerry];
G.players[0].hand = { r: 0, o: 0, y: 0, g: 0, b: 0, k: 0, w: 0, p: 0, L: 0 };
G.players[0].hand.g = fr[2];
r = E.apply(G, 'p0', { type: 'claim', index: iFerry, color: 'g', locos: 0 });
ok('πορθμείο χωρίς ατμομηχανές απορρίπτεται', !r.ok && /πορθμείο/.test(r.error));
G.players[0].hand.L = 2; G.players[0].hand.g = fr[2] - 2;
r = E.apply(G, 'p0', { type: 'claim', index: iFerry, color: 'g', locos: 2 });
ok('πορθμείο με τις σωστές ατμομηχανές', r.ok);

/* --- παράλληλες διαδρομές --- */
const iPar = findRoute(x => x[0] === 'Frankfurt' && x[1] === 'Berlin' && x[3] === 'k');
const iPar2 = findRoute(x => x[0] === 'Frankfurt' && x[1] === 'Berlin' && x[3] === 'r');
G = game(2);
G.players[0].hand = { r: 3, o: 0, y: 0, g: 0, b: 0, k: 3, w: 0, p: 0, L: 0 };
E.apply(G, 'p0', { type: 'claim', index: iPar, color: 'k', locos: 0 });
G.turn = 0;
r = E.apply(G, 'p0', { type: 'claim', index: iPar2, color: 'r', locos: 0 });
ok('με 2 παίκτες κλειδώνει η παράλληλη', !r.ok);

G = game(4);
G.players[0].hand = { r: 3, o: 0, y: 0, g: 0, b: 0, k: 3, w: 0, p: 0, L: 0 };
E.apply(G, 'p0', { type: 'claim', index: iPar, color: 'k', locos: 0 });
G.turn = 0;
r = E.apply(G, 'p0', { type: 'claim', index: iPar2, color: 'r', locos: 0 });
ok('με 4 παίκτες ο ίδιος δεν παίρνει και τις δύο', !r.ok);
G.turn = 1;
G.players[1].hand = { r: 3, o: 0, y: 0, g: 0, b: 0, k: 0, w: 0, p: 0, L: 0 };
r = E.apply(G, 'p1', { type: 'claim', index: iPar2, color: 'r', locos: 0 });
ok('με 4 παίκτες άλλος παίκτης παίρνει την παράλληλη', r.ok);

/* --- δεν διεκδικείς αφού τράβηξες --- */
G = game(2);
G.players[0].hand = { r: 0, o: 4, y: 0, g: 0, b: 0, k: 0, w: 0, p: 0, L: 0 };
E.apply(G, 'p0', { type: 'drawDeck' });
r = E.apply(G, 'p0', { type: 'claim', index: iEdLon, color: 'o', locos: 0 });
ok('απαγορεύεται διεκδίκηση μετά από τράβηγμα', !r.ok);

/* --- τέλος παιχνιδιού --- */
G = game(2);
G.players[0].wagons = 3;                       // λιγότερα από το μήκος 4
G.players[0].hand = { r: 0, o: 4, y: 0, g: 0, b: 0, k: 0, w: 0, p: 0, L: 0 };
r = E.apply(G, 'p0', { type: 'claim', index: iEdLon, color: 'o', locos: 0 });
ok('χωρίς αρκετά βαγόνια η διεκδίκηση απορρίπτεται',
   !r.ok && G.players[0].wagons === 3 && G.owned[iEdLon] === undefined);
G = game(2);
G.players[0].wagons = 4;
G.players[0].hand.o = 4;
E.apply(G, 'p0', { type: 'claim', index: iEdLon, color: 'o', locos: 0 });
ok('με ≤2 βαγόνια ξεκινά ο τελευταίος γύρος', G.finalRoundFrom === 'p0');
E.apply(G, 'p1', { type: 'drawDeck' }); E.apply(G, 'p1', { type: 'drawDeck' });
ok('μετά τον τελευταίο γύρο το παιχνίδι τελειώνει', G.phase === 'over');
ok('ανακηρύχθηκε νικητής', !!G.winner);

/* --- πλήρες παιχνίδι με τυχαίες κινήσεις --- */
function randomGame(seed) {
  const G = game(4, seed);
  const rand = E.rng(seed + 7);
  let steps = 0;
  while (G.phase === 'playing' && steps++ < 6000) {
    const p = E.current(G);
    const tries = [];
    G.routes.forEach((rt, i) => {
      if (G.owned[i] !== undefined) return;
      const need = E.ferryLocos(rt);
      const cols = rt[3] === 'x' ? E.COLORS : [rt[3]];
      for (const c of cols) {
        const locos = Math.max(need, Math.min(p.hand.L, rt[2] - Math.min(p.hand[c], rt[2] - need)));
        if (locos + Math.min(p.hand[c], rt[2] - locos) >= rt[2] && p.hand.L >= locos)
          tries.push({ type: 'claim', index: i, color: c, locos });
      }
    });
    let done = false;
    if (tries.length && rand() < 0.55) {
      const a = tries[Math.floor(rand() * tries.length)];
      done = E.apply(G, p.id, a).ok;
    }
    if (!done) {
      const a = (rand() < 0.5 && G.faceUp.length)
        ? { type: 'drawFaceUp', index: Math.floor(rand() * G.faceUp.length) }
        : { type: 'drawDeck' };
      if (!E.apply(G, p.id, a).ok) E.apply(G, p.id, { type: 'drawDeck' });
    }
  }
  return { G, steps };
}
let finished = 0, cardsOk = true, wagonsOk = true, ownersOk = true;
for (let s = 1; s <= 25; s++) {
  const { G } = randomGame(s * 977);
  if (G.phase === 'over') finished++;
  const totalCards = G.deck.length + G.discard.length + G.faceUp.length +
    G.players.reduce((a, p) => a + E.handSize(p.hand), 0);
  if (totalCards !== 110) { cardsOk = false; console.log('   κάρτες:', totalCards, 'σπόρος', s); }
  if (G.players.some(p => p.wagons < 0)) wagonsOk = false;
  const used = {};
  Object.entries(G.owned).forEach(([i, who]) => { used[who] = (used[who] || 0) + G.routes[i][2]; });
  G.players.forEach(p => { if ((used[p.id] || 0) !== 45 - p.wagons) ownersOk = false; });
}
ok('25 τυχαία παιχνίδια τελειώνουν κανονικά', finished === 25, finished + '/25');
ok('οι 110 κάρτες δεν χάνονται ποτέ', cardsOk);
ok('τα βαγόνια δεν γίνονται αρνητικά', wagonsOk);
ok('βαγόνια και διαδρομές συμφωνούν', ownersOk);

console.log('\n' + pass + ' πέρασαν, ' + fail + ' απέτυχαν');
process.exit(fail ? 1 : 0);
