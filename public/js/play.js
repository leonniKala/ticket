/* Phone view: a player's cards, tickets and moves. */
(function () {
  'use strict';
  const { h, card, toast, CARD_NAMES, CARD_ORDER, ROUTE_COLOR_NAMES, PLAYER_COLOR_NAMES } = TTR;
  const M = TTR_MAP;
  const ROUTES = Object.fromEntries(M.routes.map((r) => [r.id, r]));
  const $ = (id) => document.getElementById(id);

  const code = new URLSearchParams(location.search).get('code');
  const session = TTR.playerSession.get();
  if (!code || !session || session.code !== code || !session.token) {
    location.replace('/?code=' + (code || ''));
    return;
  }

  const socket = TTR.connect();
  TTR.keepAlive();
  let view = null, board = null, pz = null, boardLoading = false;
  const ui = { highlight: null, sheet: null, sel: new Set(), offerKey: '', prevDrawn: [], wasMyTurn: false, resultsSeen: false };

  // ------------------------------------------------------------------ connection
  socket.on('connect', async () => {
    try {
      await socket.request('hello', { role: 'player', code, token: session.token });
    } catch (e) {
      toast(e.message, 'error');
      if (/έληξε|Δεν υπάρχει/.test(e.message)) {
        TTR.playerSession.del();
        setTimeout(() => location.replace('/?code=' + code), 1800);
      }
    }
  });
  socket.on('state', (v) => { view = v; render(); });
  socket.on('closed', () => {
    toast('Ο admin έκλεισε αυτό το παιχνίδι');
    TTR.playerSession.del();
    setTimeout(() => location.replace('/'), 2000);
  });

  async function act(payload) {
    try {
      await socket.request('action', payload);
      return true;
    } catch (e) {
      toast(e.message, 'error');
      return false;
    }
  }

  let wakeLock = null;
  async function keepAwake() {
    try { if ('wakeLock' in navigator && !wakeLock) wakeLock = await navigator.wakeLock.request('screen'); } catch (e) { /* not allowed */ }
  }
  document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') { wakeLock = null; keepAwake(); } });
  keepAwake();

  // ------------------------------------------------------------------ helpers
  const game = () => view && view.game;
  const me = () => view && view.me;
  const myId = () => view && view.myId;
  const pubMe = () => game() && game().players.find((p) => p.id === myId());
  const playerName = (pid) => { const p = game().players.find((x) => x.id === pid); return p ? p.name : '?'; };
  const isMyTurn = () => game() && game().phase === 'playing' && game().current === myId();
  const stage = () => game() && game().turn.stage;

  function blockReason(r) {
    const g = game(), p = pubMe();
    if (g.claims[r.id]) return null;
    if (r.twin && g.claims[r.twin]) {
      if (g.claims[r.twin] === myId()) return 'Έχεις ήδη την παράλληλη διαδρομή· δεν μπορείς να πάρεις και τις δύο.';
      if (g.players.length < M.RULES.doubleRoutesMinPlayers) return 'Με 2–3 παίκτες χρησιμοποιείται μόνο η μία από τις παράλληλες διαδρομές.';
    }
    if (p && p.trains < r.length) return `Σου έχουν μείνει μόνο ${p.trains} βαγόνια.`;
    return null;
  }

  function stageNote() {
    if (!isMyTurn()) return 'Περίμενε τη σειρά σου.';
    const s = stage();
    if (s === 'drew') return 'Τράβηξες ήδη μία κάρτα: τώρα πρέπει να τραβήξεις και δεύτερη.';
    if (s === 'tunnel') return 'Πρώτα ολοκλήρωσε τη σήραγγα.';
    if (s === 'tickets') return 'Πρώτα διάλεξε κάρτες προορισμού.';
    return null;
  }

  function swatch(color) {
    const hex = color === 'gray' ? 'var(--c-gray)' : `var(--c-${color})`;
    return h('span', { class: 'swatch', style: `background:${hex}` });
  }

  // ------------------------------------------------------------------ board
  async function ensureBoard() {
    if (board || boardLoading) return;
    boardLoading = true;
    const land = await TTR.loadLand();
    board = TTRBoard.create($('board'), { land });
    pz = TTRPanZoom.attach(board.svg, { onTap });
    $('zin').onclick = () => pz.zoomIn();
    $('zout').onclick = () => pz.zoomOut();
    $('zfit').onclick = () => pz.reset();
    updateBoard();
  }

  function updateBoard() {
    if (board && game()) board.setState(TTR.boardState(game(), ui.highlight));
  }

  function onTap(bx, by, pxPerUnit) {
    if (!game() || game().phase === 'setup') return;
    let best = null, bestD = Infinity;
    for (const c of Object.values(M.cities)) {
      const d = Math.hypot(c.x - bx, c.y - by);
      if (d < bestD) { bestD = d; best = c; }
    }
    if (bestD * pxPerUnit < 24 || bestD < 18) return openSheet('city', best.id);
    let bestR = null, bestRD = Infinity;
    for (const [rid, lay] of Object.entries(board.layout)) {
      for (const s of lay.slots) {
        const a = s.angle * Math.PI / 180, dx = bx - s.x, dy = by - s.y;
        const along = Math.max(-s.len / 2, Math.min(s.len / 2, dx * Math.cos(a) + dy * Math.sin(a)));
        const d = Math.hypot(dx - along * Math.cos(a), dy - along * Math.sin(a));
        if (d < bestRD) { bestRD = d; bestR = rid; }
      }
    }
    if (bestRD * pxPerUnit < 22 || bestRD < 9) return openSheet('route', bestR);
    ui.highlight = null;
    updateBoard();
  }

  // ------------------------------------------------------------------ render
  function render() {
    if (!view) return;
    const { room } = view;
    const member = room.members.find((m) => m.id === myId());
    if (!member) {
      toast('Ο admin σε αφαίρεσε από το παιχνίδι', 'error');
      TTR.playerSession.del();
      socket.close();
      setTimeout(() => location.replace('/?code=' + code), 2000);
      return;
    }
    $('me-dot').className = 'pdot ' + (member ? member.color : '');
    $('me-name').textContent = member ? member.name : '';
    const p = pubMe();
    const final = game() && game().results && game().results.find((r) => r.id === myId());
    $('me-score').textContent = final ? final.total : p ? p.score : 0;
    $('me-trains').textContent = p ? p.trains : M.RULES.trainsPerPlayer;
    $('me-stations').textContent = p ? p.stationsLeft : M.RULES.stationsPerPlayer;
    $('me-tix').textContent = me() ? me().tickets.length : 0;

    const inLobby = room.phase === 'lobby' || !game();
    $('lobby').classList.toggle('hidden', !inLobby);
    for (const id of ['board-wrap', 'market', 'hand']) $(id).classList.toggle('hidden', inLobby);
    $('tickets-btn').classList.toggle('hidden', inLobby);
    if (inLobby) {
      closeSheet();
      return renderLobby();
    }
    ensureBoard();
    renderStatus();
    renderMarket();
    renderHand();
    feedback();
    renderSheet();
    updateBoard();
  }

  function renderLobby() {
    const { room } = view;
    $('status').className = '';
    $('status').textContent = `Παιχνίδι ${room.code} · περιμένουμε να ξεκινήσει`;
    const box = $('lobby');
    box.textContent = '';
    const mine = room.members.find((m) => m.id === myId());
    const taken = new Set(room.members.map((m) => m.color));
    box.append(
      h('h1', null, 'Είσαι μέσα!'),
      h('div', { class: 'muted' }, 'Ο admin θα ξεκινήσει το παιχνίδι όταν μπουν όλοι. Κράτα αυτή τη σελίδα ανοιχτή.'),
      h('div', { class: 'members' }, room.members.map((m) => h('div', { class: 'member' },
        h('span', { class: 'pdot ' + m.color }), m.name + (m.id === myId() ? ' (εσύ)' : ''),
        h('span', { class: 'on' + (m.online ? ' yes' : '') }, m.online ? 'συνδεδεμένος' : 'εκτός')))),
      h('div', { class: 'field' }, h('label', null, 'Άλλαξε χρώμα'),
        h('div', { style: 'display:flex;gap:8px;flex-wrap:wrap' }, Object.keys(PLAYER_COLOR_NAMES).map((c) =>
          h('button', {
            class: 'btn small' + (mine && mine.color === c ? ' primary' : ''),
            disabled: taken.has(c) && !(mine && mine.color === c),
            onclick: async () => { try { await socket.request('color', { color: c }); } catch (e) { toast(e.message, 'error'); } },
          }, h('span', { class: 'pdot ' + c }), PLAYER_COLOR_NAMES[c])))),
      h('button', {
        class: 'btn ghost small', style: 'margin-top:20px',
        onclick: () => { TTR.playerSession.del(); location.href = '/'; },
      }, 'Έξοδος από αυτό το κινητό'),
    );
  }

  function renderStatus() {
    const g = game(), st = $('status');
    st.className = '';
    st.textContent = '';
    if (g.phase === 'setup') {
      const waiting = g.players.filter((p) => !p.ready).map((p) => p.name);
      st.textContent = me().offer.length
        ? 'Διάλεξε κάρτες προορισμού (τουλάχιστον 2)'
        : 'Περιμένουμε: ' + waiting.join(', ');
      return;
    }
    if (g.phase === 'finished') {
      st.append('Τέλος παιχνιδιού · ', h('a', { href: '#', style: 'color:var(--gold-2)', onclick: (e) => { e.preventDefault(); openSheet('results'); } }, 'Αποτελέσματα'));
      return;
    }
    if (isMyTurn()) {
      st.className = 'myturn';
      const s = stage();
      st.textContent = s === 'drew' ? 'Τράβα και δεύτερη κάρτα (όχι ανοιχτή ατμομηχανή)'
        : s === 'tunnel' ? 'Σήραγγα: αποφάσισε αν θα πληρώσεις'
          : s === 'tickets' ? 'Διάλεξε κάρτες προορισμού'
            : 'Σειρά σου! Κάρτες, διαδρομή, προορισμοί ή σταθμός';
    } else {
      const cur = g.players.find((p) => p.id === g.current);
      st.append('Παίζει: ', h('span', { class: 'pdot ' + cur.color, style: 'vertical-align:-2px;margin:0 6px' }), cur.name);
    }
    if (g.finalTurns !== null) st.append(h('span', { class: 'last' }, `· Τελευταίος γύρος (${g.finalTurns})`));
  }

  function renderMarket() {
    const g = game(), row = $('market-row');
    row.textContent = '';
    const s = stage();
    const canDraw = isMyTurn() && (s === 'start' || s === 'drew');
    g.faceUp.forEach((c, i) => {
      const el = card(c);
      const ok = c && canDraw && !(c === 'loco' && s === 'drew');
      if (!ok) el.classList.add('disabled');
      el.addEventListener('click', () => {
        if (!canDraw) return toast(stageNote() || 'Δεν μπορείς να τραβήξεις τώρα', 'error');
        if (c === 'loco' && s === 'drew') return toast('Δεν παίρνεις ανοιχτή ατμομηχανή ως δεύτερη κάρτα', 'error');
        if (c) act({ type: 'drawFaceUp', slot: i });
      });
      row.append(el);
    });
    row.append(h('div', { class: 'sep' }));
    const deck = h('div', { class: 'deckbtn', onclick: () => {
      if (!canDraw) return toast(stageNote() || 'Δεν μπορείς να τραβήξεις τώρα', 'error');
      act({ type: 'drawBlind' });
    } }, card('back', g.deckCount + g.discardCount), 'Τράπουλα');
    if (!canDraw) deck.style.opacity = 0.5;
    const tix = h('div', { class: 'deckbtn', onclick: () => {
      if (!isMyTurn() || s !== 'start') return toast(stageNote() || 'Δεν μπορείς τώρα', 'error');
      if (!g.ticketDeckCount) return toast('Δεν έχουν μείνει κάρτες προορισμού', 'error');
      confirmSheet('Κάρτες προορισμού', 'Θα τραβήξεις 3 κάρτες προορισμού και θα κρατήσεις τουλάχιστον 1. Αυτή είναι όλη η κίνησή σου.',
        'Τράβηξε', () => act({ type: 'drawTickets' }));
    } }, h('div', { class: 'tix-back' }, String(g.ticketDeckCount)), 'Προορ.');
    if (!isMyTurn() || s !== 'start') tix.style.opacity = 0.5;
    row.append(deck, tix);
    $('deck-info').textContent = `Τράπουλα ${g.deckCount} · Πεταμένες ${g.discardCount}`;
  }

  function renderHand() {
    const hand = me().hand, row = $('hand-row');
    row.textContent = '';
    const total = CARD_ORDER.reduce((n, c) => n + hand[c], 0);
    $('hand-count').textContent = `${total} κάρτες`;
    if (!total) row.append(h('div', { class: 'hand-empty' }, 'Δεν έχεις κάρτες. Τράβηξε από τις ανοιχτές ή από την τράπουλα.'));
    for (const c of CARD_ORDER) if (hand[c]) row.append(card(c, hand[c]));
  }

  function feedback() {
    const drawn = me().drawn || [], prev = ui.prevDrawn;
    const extends_ = drawn.length > prev.length && prev.every((c, i) => drawn[i] === c);
    const fresh = extends_ ? drawn.slice(prev.length) : JSON.stringify(drawn) !== JSON.stringify(prev) ? drawn : [];
    if (fresh.length) toast('Τράβηξες: ' + fresh.map((c) => CARD_NAMES[c]).join(', '), 'ok');
    ui.prevDrawn = drawn;

    const mine = isMyTurn();
    if (mine && !ui.wasMyTurn) {
      toast('Σειρά σου!', 'ok');
      const touched = !navigator.userActivation || navigator.userActivation.hasBeenActive;
      if (navigator.vibrate && touched) navigator.vibrate([120, 60, 120]);
    }
    ui.wasMyTurn = mine;
    if (game().phase === 'finished' && !ui.resultsSeen) { ui.resultsSeen = true; openSheet('results'); }
    if (game().phase !== 'finished') ui.resultsSeen = false;
  }

  // ------------------------------------------------------------------ sheets
  function openSheet(kind, arg) {
    ui.sheet = { kind, arg };
    renderSheet();
    updateBoard();
  }
  function closeSheet() {
    ui.sheet = null;
    ui.renderedKey = null;
    $('sheet-root').textContent = '';
  }

  function confirmSheet(title, text, okLabel, onOk) {
    ui.sheet = { kind: 'confirm', arg: { title, text, okLabel, onOk } };
    renderSheet();
  }

  function shell(title, sub, body, { closable = true, actions = [] } = {}) {
    const overlay = h('div', { class: 'overlay' + (closable ? ' light' : ''), onclick: (e) => { if (closable && e.target === overlay) { closeSheet(); ui.highlight = null; updateBoard(); } } });
    const sheet = h('div', { class: 'sheet' }, h('h2', null, title), sub ? h('div', { class: 'sub' }, sub) : null, body);
    const acts = actions.slice();
    if (closable) acts.push(h('button', { class: 'btn ghost', onclick: () => { closeSheet(); ui.highlight = null; updateBoard(); } }, 'Κλείσιμο'));
    if (acts.length) sheet.append(h('div', { class: 'actions' }, acts));
    overlay.append(sheet);
    return overlay;
  }

  function renderSheet() {
    const root = $('sheet-root');
    const g = game();
    let node = null, key = null;
    // Forced choices come first.
    if (g && g.phase === 'setup' && me().offer.length) { node = ticketChooser(true); key = 'setup'; }
    else if (g && isMyTurn() && stage() === 'tickets') { node = ticketChooser(false); key = 'tickets'; }
    else if (g && isMyTurn() && stage() === 'tunnel') { node = tunnelSheet(); key = 'tunnel'; }
    else if (ui.sheet) {
      const { kind, arg } = ui.sheet;
      key = kind + ':' + (typeof arg === 'string' ? arg : '');
      node = kind === 'route' ? routeSheet(arg) : kind === 'city' ? citySheet(arg)
        : kind === 'tickets' ? myTicketsSheet() : kind === 'results' ? resultsSheet()
          : kind === 'confirm' ? confirmNode(arg) : null;
    }
    // Re-rendering the same sheet: no slide-in animation and keep the scroll position.
    const old = root.querySelector('.sheet');
    const scroll = old ? old.scrollTop : 0;
    const same = node && key === ui.renderedKey && old;
    root.textContent = '';
    ui.renderedKey = node ? key : null;
    if (!node) return;
    root.append(node);
    if (same) {
      const sh = node.querySelector('.sheet');
      sh.style.animation = 'none';
      sh.scrollTop = scroll;
    }
  }

  function confirmNode({ title, text, okLabel, onOk }) {
    return shell(title, null, h('div', { class: 'note' }, text), {
      actions: [h('button', { class: 'btn primary', onclick: () => { closeSheet(); onOk(); } }, okLabel)],
    });
  }

  function payList(options, onPick, label) {
    return h('div', { class: 'pay-list' }, options.map((o) =>
      h('div', { class: 'pay-opt', onclick: onPick.bind(null, o) }, TTR.paymentChips(o), h('span', { class: 'go' }, label))));
  }

  function routeSheet(id) {
    const r = ROUTES[id], g = game();
    ui.highlight = { routes: [id], cities: [r.a, r.b] };
    const body = h('div');
    const badges = h('div', { class: 'badges' },
      h('span', { class: 'badge' }, swatch(r.color), ROUTE_COLOR_NAMES[r.color]),
      r.tunnel ? h('span', { class: 'badge tunnel' }, 'Σήραγγα') : null,
      r.ferry ? h('span', { class: 'badge ferry' }, `Πορθμείο: ${r.ferry} ${r.ferry === 1 ? 'ατμομηχανή' : 'ατμομηχανές'}`) : null,
      r.double ? h('span', { class: 'badge' }, 'Διπλή') : null);
    body.append(badges);
    const owner = g.claims[id];
    const blocked = blockReason(r);
    const note = stageNote();
    if (owner) {
      body.append(h('div', { class: 'note' }, 'Την έχει ο/η ', h('b', null, playerName(owner)), '.'));
    } else if (blocked) {
      body.append(h('div', { class: 'note warn' }, blocked));
    } else if (note) {
      body.append(h('div', { class: 'note' }, note));
    } else {
      const opts = TTRPay.route(r, me().hand);
      if (r.tunnel) body.append(h('div', { class: 'note', style: 'margin-bottom:10px' }, 'Σήραγγα: μόλις πληρώσεις ανοίγουν 3 κάρτες από την τράπουλα. Για κάθε μία στο χρώμα σου ή ατμομηχανή πληρώνεις 1 κάρτα επιπλέον.'));
      if (!opts.length) {
        const what = r.color === 'gray' ? `${r.length} κάρτες ίδιου χρώματος` : TTR.cardsName(r.length, r.color);
        const ferry = r.ferry ? `, από τις οποίες ${TTR.cardsName(r.ferry, 'loco')}` : '';
        body.append(h('div', { class: 'note warn' }, `Δεν έχεις αρκετές κάρτες: χρειάζεσαι ${what}${ferry}. Οι ατμομηχανές μετράνε για οποιοδήποτε χρώμα.`));
      } else {
        body.append(payList(opts, async (o) => { if (await act({ type: 'claimRoute', routeId: id, payment: o })) { closeSheet(); } }, 'Πάρ\' τη'));
      }
    }
    const actions = [];
    if (r.twin) {
      const tw = ROUTES[r.twin];
      actions.push(h('button', { class: 'btn', onclick: () => openSheet('route', tw.id) }, swatch(tw.color), 'Παράλληλη'));
    }
    return shell(TTR.routeLabel(r), `${r.length} ${r.length === 1 ? 'βαγόνι' : 'βαγόνια'} · ${r.points} ${r.points === 1 ? 'πόντος' : 'πόντοι'}`, body, { actions });
  }

  function citySheet(cid) {
    const c = M.cities[cid], g = game(), p = pubMe();
    const incident = M.routes.filter((r) => r.a === cid || r.b === cid);
    ui.highlight = { cities: [cid], routes: incident.map((r) => r.id) };
    const body = h('div');
    const list = h('div', { class: 'city-routes' });
    for (const r of incident) {
      const other = M.cities[r.a === cid ? r.b : r.a];
      const own = g.claims[r.id];
      const ownerP = own && g.players.find((x) => x.id === own);
      list.append(h('div', { class: 'city-route', onclick: () => openSheet('route', r.id) },
        swatch(r.color), h('span', { class: 'to' }, other.name),
        h('span', { class: 'len' }, `${r.length}${r.tunnel ? ' · σήραγγα' : ''}${r.ferry ? ' · πορθμείο' : ''}`),
        ownerP ? h('span', { class: 'pdot ' + ownerP.color }) : h('span', { class: 'len' }, 'ελεύθερη')));
    }
    body.append(list, h('h3', { style: 'margin:18px 0 8px;font-size:19px' }, 'Σταθμός'));
    const owner = g.stations[cid];
    if (owner) {
      body.append(h('div', { class: 'note' }, 'Έχει σταθμό ο/η ', h('b', null, playerName(owner)), '.'));
    } else {
      const note = stageNote();
      const cost = me().stationCost;
      if (note) {
        body.append(h('div', { class: 'note' }, `Κανείς δεν έχει σταθμό εδώ. ${note}`));
      } else if (!p.stationsLeft) {
        body.append(h('div', { class: 'note' }, 'Δεν σου έχουν μείνει σταθμοί.'));
      } else {
        const opts = TTRPay.station(cost, me().hand);
        body.append(h('div', { class: 'sub' }, `Χτίσε σταθμό: ${cost} ${cost === 1 ? 'κάρτα' : 'κάρτες ίδιου χρώματος'}. Στο τέλος θα μπορείς να χρησιμοποιήσεις μία διαδρομή άλλου παίκτη από αυτή την πόλη. Κάθε σταθμός που δεν χτίζεις αξίζει 4 πόντους.`));
        if (opts.length) {
          body.append(payList(opts, (o) => confirmSheet('Σταθμός στο ' + c.name, `Σίγουρα; Θα πληρώσεις ${TTR.paymentText(o)} και θα χάσεις 4 πόντους από τον σταθμό που δεν χτίζεις.`,
            'Χτίσε', () => act({ type: 'buildStation', cityId: cid, payment: o })), 'Χτίσε'));
        } else {
          body.append(h('div', { class: 'note warn' }, 'Δεν έχεις αρκετές κάρτες.'));
        }
      }
    }
    return shell(c.name, null, body);
  }

  function myTicketsSheet() {
    const list = me().tickets;
    const done = list.filter((t) => t.done);
    const body = h('div', { class: 'tix-list' });
    if (!list.length) body.append(h('div', { class: 'note' }, 'Δεν έχεις κάρτες προορισμού.'));
    for (const t of list) {
      body.append(TTR.ticketEl(t, { onclick: () => {
        ui.highlight = { cities: [t.a, t.b], routes: [] };
        closeSheet();
        updateBoard();
        if (pz) pz.focus([[M.cities[t.a].x, M.cities[t.a].y], [M.cities[t.b].x, M.cities[t.b].y]]);
      } }));
    }
    const plus = done.reduce((n, t) => n + t.points, 0), minus = list.filter((t) => !t.done).reduce((n, t) => n + t.points, 0);
    return shell('Οι προορισμοί μου', `Ολοκληρωμένοι ${done.length}/${list.length} · +${plus} / −${minus} πόντοι. Πάτα έναν για να τον δεις στον χάρτη.`, body);
  }

  function ticketChooser(setup) {
    const offer = me().offer, min = me().offerMin;
    const key = offer.map((t) => t.id).join(',');
    if (key !== ui.offerKey) { ui.offerKey = key; ui.sel = new Set(); }
    ui.highlight = { cities: offer.filter((t) => ui.sel.has(t.id)).flatMap((t) => [t.a, t.b]), routes: [] };
    const list = h('div', { class: 'tix-list' });
    for (const t of offer) {
      const el = TTR.ticketEl(t, { onclick: () => {
        if (ui.sel.has(t.id)) ui.sel.delete(t.id); else ui.sel.add(t.id);
        renderSheet();
        updateBoard();
      } });
      el.classList.add(ui.sel.has(t.id) ? 'sel' : 'unsel');
      list.append(el);
    }
    const ok = h('button', {
      class: 'btn primary', disabled: ui.sel.size < min,
      onclick: async () => {
        const ids = [...ui.sel];
        if (await act({ type: setup ? 'keepSetupTickets' : 'keepTickets', ids })) { ui.sel = new Set(); ui.highlight = null; }
      },
    }, `Κράτα ${ui.sel.size}`);
    return shell(setup ? 'Αρχικοί προορισμοί' : 'Νέοι προορισμοί',
      `Κράτα τουλάχιστον ${min}. Όσους κρατήσεις δίνουν πόντους αν τους ολοκληρώσεις και αφαιρούν αν όχι.` + (setup ? ' Η μπλε κάρτα είναι μεγάλη διαδρομή.' : ''),
      list, { closable: false, actions: [ok] });
  }

  function tunnelSheet() {
    const t = game().turn, r = ROUTES[t.routeId];
    ui.highlight = { routes: [r.id], cities: [r.a, r.b] };
    const match = (c) => c === 'loco' || (t.paid.color && c === t.paid.color);
    const body = h('div');
    body.append(h('div', { class: 'revealed' }, t.revealed.map((c) => {
      const el = card(c);
      if (match(c)) el.classList.add('hit');
      return el;
    })));
    const what = t.paid.color ? `${CARD_NAMES[t.paid.color].toLowerCase()} ή ατμομηχανές` : 'ατμομηχανές';
    body.append(h('div', { class: 'note', style: 'margin-bottom:12px' }, `${t.extra === 1 ? 'Χρειάζεται 1 επιπλέον κάρτα' : `Χρειάζονται ${t.extra} επιπλέον κάρτες`} (${what}). Έβαλες ήδη: ${TTR.paymentText(t.paid)}.`));
    const opts = TTRPay.tunnelExtra(t.paid, t.extra, me().hand);
    if (opts.length) body.append(payList(opts, (o) => act({ type: 'tunnelPay', payment: o }), 'Πλήρωσε'));
    else body.append(h('div', { class: 'note warn' }, 'Δεν έχεις αρκετές κάρτες. Παίρνεις πίσω τις κάρτες σου και η σειρά σου τελειώνει.'));
    return shell('Σήραγγα: ' + TTR.routeLabel(r), null, body, {
      closable: false,
      actions: [h('button', { class: 'btn danger', onclick: () => act({ type: 'tunnelCancel' }) }, 'Άσ\' το (πίσω οι κάρτες)')],
    });
  }

  function resultsSheet() {
    const res = game().results || [];
    const table = h('table', { class: 'results' },
      h('tr', null, ['#', 'Παίκτης', 'Διαδρ.', 'Προορ.', 'Σταθμ.', 'Εξπρές', 'Σύνολο'].map((t) => h('th', null, t))),
      res.map((r) => h('tr', { class: r.rank === 1 ? 'win' : '' },
        h('td', null, String(r.rank)),
        h('td', null, h('span', { class: 'pdot ' + r.color, style: 'margin-right:6px;vertical-align:-2px' }), r.name),
        h('td', null, String(r.routePoints)), h('td', null, (r.ticketPoints > 0 ? '+' : '') + r.ticketPoints),
        h('td', null, String(r.stationPoints)), h('td', null, r.express ? '+10' : '–'), h('td', null, h('b', null, String(r.total))))));
    const mine = res.find((r) => r.id === myId());
    const body = h('div', null, table);
    if (mine) {
      body.append(h('h3', { style: 'margin:18px 0 8px' }, 'Οι προορισμοί μου'));
      const list = h('div', { class: 'tix-list' });
      for (const t of mine.tickets) list.append(TTR.ticketEl({ ...M.tickets.find((x) => x.id === t.id), done: t.done }));
      body.append(list);
    }
    const winners = res.filter((r) => r.rank === 1).map((r) => r.name).join(' & ');
    return shell('Αποτελέσματα', `Νικητής: ${winners}`, body);
  }

  $('tickets-btn').addEventListener('click', () => openSheet('tickets'));
})();
