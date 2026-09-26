/* TV view: the shared board, players, face-up cards and what just happened. */
(function () {
  'use strict';
  const { h, card, store } = TTR;
  const M = TTR_MAP;
  const ROUTES = Object.fromEntries(M.routes.map((r) => [r.id, r]));
  const $ = (id) => document.getElementById(id);

  const params = new URLSearchParams(location.search);
  let code = params.get('code') || store.get('ttr:tv');
  const socket = TTR.connect();
  TTR.keepAlive();

  let view = null, board = null, lastEventSeq = null, prevFaceUp = [];
  let flash = { routes: [], cities: [] }, flashTimer = null, popupTimer = null;

  const ICON = {
    train: '<svg viewBox="0 0 24 24"><path fill="currentColor" d="M3 6h18v10H3zM5 8v4h4V8zm6 0v4h4V8zm6 0v4h2V8zM7 20a2 2 0 110-4 2 2 0 010 4zm10 0a2 2 0 110-4 2 2 0 010 4z"/></svg>',
    cards: '<svg viewBox="0 0 24 24"><path fill="currentColor" d="M7 3h11a2 2 0 012 2v12h-2V5H7zM4 7h11a2 2 0 012 2v10a2 2 0 01-2 2H4a2 2 0 01-2-2V9a2 2 0 012-2z"/></svg>',
    ticket: '<svg viewBox="0 0 24 24"><path fill="currentColor" d="M3 6h18v4a2 2 0 000 4v4H3v-4a2 2 0 000-4zm6 2v8h2V8z"/></svg>',
    station: '<svg viewBox="0 0 24 24"><path fill="currentColor" d="M3 11l9-8 9 8v10H3zm7 3v7h4v-7z"/></svg>',
  };

  // ------------------------------------------------------------------ connection
  async function connectTo(c) {
    try {
      const r = await socket.request('hello', { role: 'tv', code: c });
      code = r.code;
      store.set('ttr:tv', code);
      history.replaceState(null, '', '/tv?code=' + code);
      $('code-screen').classList.add('hidden');
    } catch (e) {
      showCodeScreen(e.message);
    }
  }
  function showCodeScreen(err) {
    $('code-screen').classList.remove('hidden');
    $('tv').classList.add('hidden');
    $('lobby-screen').classList.add('hidden');
    $('results-screen').classList.add('hidden');
    $('code-err').textContent = err || '';
    $('code-in').focus();
  }
  $('code-screen').addEventListener('submit', (e) => { e.preventDefault(); connectTo($('code-in').value.trim()); });
  socket.on('connect', () => (code ? connectTo(code) : showCodeScreen()));
  socket.on('state', (v) => { view = v; render(); });
  socket.on('closed', () => { view = null; store.del('ttr:tv'); code = null; showCodeScreen('Το παιχνίδι έκλεισε. Γράψε νέο κωδικό.'); });

  let wakeLock = null;
  async function keepAwake() {
    try { if ('wakeLock' in navigator && !wakeLock) wakeLock = await navigator.wakeLock.request('screen'); } catch (e) { /* not allowed */ }
  }
  document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') { wakeLock = null; keepAwake(); } });
  keepAwake();

  // ------------------------------------------------------------------ render
  async function ensureBoard() {
    if (board) return;
    board = 'loading';
    const land = await TTR.loadLand();
    board = TTRBoard.create($('board'), { land });
    updateBoard();
  }

  function updateBoard() {
    if (!board || board === 'loading' || !view) return;
    const g = view.game;
    let hl = flash;
    if (g && g.phase === 'finished' && g.results) {
      hl = { routes: g.results.filter((r) => r.express).flatMap((r) => r.longestRoutes), cities: [] };
    } else if (g && g.turn.stage === 'tunnel') {
      const r = ROUTES[g.turn.routeId];
      hl = { routes: [r.id], cities: [r.a, r.b] };
    }
    board.setState(TTR.boardState(g, hl));
  }

  function render() {
    if (!view) return;
    const { room, game } = view;
    $('code-lbl').textContent = room.code;
    ensureBoard();
    const lobby = room.phase === 'lobby' || !game;
    $('tv').classList.remove('hidden');
    $('lobby-screen').classList.toggle('hidden', !lobby);
    if (lobby) {
      renderLobby();
      $('results-screen').classList.add('hidden');
      $('banner').classList.add('hidden');
      $('lastround').classList.add('hidden');
      $('popup-root').textContent = '';
      lastEventSeq = null;
      return;
    }
    renderPlayers();
    renderMarket();
    renderLog();
    renderBanner();
    handleEvent();
    renderTunnel();
    renderResults();
    updateBoard();
  }

  function renderLobby() {
    const { room } = view;
    const box = $('lobby-screen');
    box.textContent = '';
    const url = `${location.host}/`;
    box.append(
      h('div', { class: 'join-box' },
        h('div', { class: 'title' }, 'Ticket to Ride', h('small', null, 'ΕΥΡΩΠΗ')),
        h('div', { class: 'qr' }, h('img', { src: `/api/qr/${room.code}?g=${room.gameNo}`, alt: 'QR' })),
        h('div', { class: 'url' }, `Σκανάρετε ή ανοίξτε ${url} και γράψτε τον κωδικό`),
        h('div', { class: 'bigcode' }, room.code)),
      h('div', { class: 'joined' },
        h('h2', null, `Παίκτες (${room.members.length}/5)`),
        room.members.length ? room.members.map((m) => h('div', { class: 'm' },
          h('span', { class: 'pdot ' + m.color }), m.name, m.online ? null : h('span', { class: 'off' }, 'εκτός σύνδεσης')))
          : h('div', { class: 'wait' }, 'Κανείς ακόμα…'),
        h('div', { class: 'wait' }, room.members.length >= 2 ? 'Ο admin μπορεί να ξεκινήσει το παιχνίδι.' : 'Χρειάζονται τουλάχιστον 2 παίκτες.')),
    );
  }

  function renderPlayers() {
    const g = view.game, online = Object.fromEntries(view.room.members.map((m) => [m.id, m.online]));
    const totals = Object.fromEntries((g.results || []).map((r) => [r.id, r.total]));
    const box = $('players');
    box.textContent = '';
    for (const p of g.players) {
      const stats = h('div', { class: 'stats' });
      stats.innerHTML =
        `<span title="Βαγόνια">${ICON.train}${p.trains}</span>` +
        `<span title="Κάρτες">${ICON.cards}${p.handCount}</span>` +
        `<span title="Προορισμοί">${ICON.ticket}${p.ticketCount}</span>` +
        `<span title="Σταθμοί">${ICON.station}${p.stationsLeft}</span>`;
      if (g.phase === 'setup') stats.append(h('span', { class: p.ready ? 'ready' : '' }, p.ready ? '✓ έτοιμος' : 'διαλέγει…'));
      box.append(h('div', { class: 'pl' + (g.current === p.id ? ' current' : '') + (online[p.id] ? '' : ' offline') },
        h('div', { class: 'bar', style: `background:var(--p-${p.color})` }),
        h('div', { class: 'nm' }, p.name),
        h('div', { class: 'sc' }, String(totals[p.id] !== undefined ? totals[p.id] : p.score)),
        stats));
    }
  }

  function renderMarket() {
    const g = view.game, row = $('faceup');
    row.textContent = '';
    g.faceUp.forEach((c, i) => {
      const el = card(c);
      if (prevFaceUp.length && prevFaceUp[i] !== c) el.classList.add('fresh');
      row.append(el);
    });
    prevFaceUp = g.faceUp.slice();
    $('piles').textContent = '';
    $('piles').append(
      h('span', null, `Τράπουλα: ${g.deckCount}`),
      h('span', null, `Πεταμένες: ${g.discardCount}`),
      h('span', null, `Προορισμοί: ${g.ticketDeckCount}`));
  }

  function renderLog() {
    const g = view.game, box = $('log-items');
    box.textContent = '';
    const colorOf = TTR.playerColorMap(g);
    for (const l of g.log.slice(-12).reverse()) {
      box.append(h('div', { class: 'it', style: l.pid ? `border-left-color:var(--p-${colorOf[l.pid]})` : '' }, l.text));
    }
  }

  function renderBanner() {
    const g = view.game, b = $('banner');
    b.textContent = '';
    b.classList.remove('hidden');
    if (g.phase === 'setup') {
      b.append('Όλοι διαλέγουν κάρτες προορισμού στο κινητό τους');
    } else if (g.phase === 'finished') {
      b.append('Τέλος παιχνιδιού');
    } else {
      const cur = g.players.find((p) => p.id === g.current);
      const hint = { drew: 'τραβάει δεύτερη κάρτα', tunnel: 'περνάει σήραγγα', tickets: 'διαλέγει προορισμούς' }[g.turn.stage];
      b.append(h('span', { class: 'pdot ' + cur.color }), `Σειρά: ${cur.name}`);
      if (hint) b.append(h('span', { class: 'hint' }, '· ' + hint));
    }
    const lr = $('lastround');
    lr.classList.toggle('hidden', !(g.phase === 'playing' && g.finalTurns !== null));
    lr.textContent = `ΤΕΛΕΥΤΑΙΟΣ ΓΥΡΟΣ · απομένουν ${g.finalTurns} σειρές`;
  }

  // ------------------------------------------------------------------ events
  function tvToast(nodes, ms = 4500) {
    const t = h('div', { class: 'tvtoast' }, nodes);
    $('toast-tv').append(t);
    setTimeout(() => t.remove(), ms);
  }

  function flashBoard(hl, ms = 5000) {
    flash = hl;
    clearTimeout(flashTimer);
    flashTimer = setTimeout(() => { flash = { routes: [], cities: [] }; updateBoard(); }, ms);
  }

  function handleEvent() {
    const g = view.game;
    if (lastEventSeq === null || g.seq < lastEventSeq) { lastEventSeq = g.seq; return; } // no replays after (re)connecting
    for (const ev of g.events) if (ev.seq > lastEventSeq) showEvent(g, ev);
    lastEventSeq = g.seq;
  }

  function showEvent(g, ev) {
    const p = g.players.find((x) => x.id === ev.pid);
    const who = p ? [h('span', { class: 'pdot ' + p.color }), p.name] : [];
    if (ev.type === 'claim') {
      const r = ROUTES[ev.routeId];
      flashBoard({ routes: [r.id], cities: [r.a, r.b] });
      tvToast([...who, ` πήρε ${TTR.routeLabel(r)}`, h('span', { class: 'pts' }, ` +${ev.points}`)]);
    } else if (ev.type === 'station') {
      flashBoard({ routes: [], cities: [ev.cityId] });
      tvToast([...who, ` έχτισε σταθμό στο ${M.cities[ev.cityId].name}`]);
    } else if (ev.type === 'tunnelFail') {
      tvToast([...who, ` δεν πέρασε τη σήραγγα ${TTR.routeLabel(ROUTES[ev.routeId])}`]);
    } else if (ev.type === 'tickets') {
      tvToast([...who, ` κράτησε ${ev.count} ${ev.count === 1 ? 'προορισμό' : 'προορισμούς'}`], 3500);
    } else if (ev.type === 'tunnel' && ev.extra === 0) {
      showTunnelPopup(ev, 4000);
    } else if (ev.type === 'lastRound') {
      popup([h('h2', null, 'Τελευταίος γύρος!'), h('div', { class: 'sub' }, [...who, ' έμεινε με 2 ή λιγότερα βαγόνια. Όλοι παίζουν άλλη μία φορά.'])], 6000);
    }
  }

  function popup(children, ms) {
    const root = $('popup-root');
    root.textContent = '';
    root.append(h('div', { class: 'popup' }, children));
    clearTimeout(popupTimer);
    if (ms) popupTimer = setTimeout(() => { root.textContent = ''; }, ms);
  }

  function showTunnelPopup(t, ms) {
    const g = view.game, r = ROUTES[t.routeId], p = g.players.find((x) => x.id === (t.pid || g.current));
    const payColor = t.paid ? t.paid.color : null;
    const matches = (c) => c === 'loco' || (payColor && c === payColor);
    popup([
      h('h2', null, 'Σήραγγα: ' + TTR.routeLabel(r)),
      h('div', { class: 'sub' }, h('span', { class: 'pdot ' + p.color, style: 'margin-right:1vh' }), p.name),
      h('div', { class: 'cards' }, t.revealed.map((c) => {
        const el = card(c);
        if (t.paid && matches(c)) el.classList.add('hit');
        return el;
      })),
      h('div', { class: 'big' }, t.extra === 1 ? 'Χρειάζεται 1 επιπλέον κάρτα' : t.extra ? `Χρειάζονται ${t.extra} επιπλέον κάρτες` : 'Καμία επιπλέον κάρτα!'),
    ], ms);
  }

  let tunnelShownFor = null;
  function renderTunnel() {
    const g = view.game;
    if (g.phase === 'playing' && g.turn.stage === 'tunnel') {
      const key = g.seq + ':' + g.turn.routeId;
      if (tunnelShownFor !== key) { tunnelShownFor = key; showTunnelPopup({ ...g.turn, pid: g.current }, 0); }
    } else if (tunnelShownFor) {
      tunnelShownFor = null;
      $('popup-root').textContent = '';
    }
  }

  function renderResults() {
    const g = view.game, box = $('results-screen');
    if (g.phase !== 'finished' || !g.results) { box.classList.add('hidden'); return; }
    box.classList.remove('hidden');
    box.textContent = '';
    const res = g.results;
    const winners = res.filter((r) => r.rank === 1);
    const expressName = res.filter((r) => r.express).map((r) => `${r.name} (${r.longest})`).join(', ');
    box.append(h('div', { class: 'res' },
      h('h1', null, 'Τέλος παιχνιδιού'),
      h('div', { class: 'winner' }, winners.length > 1 ? 'Ισοπαλία: ' : 'Νικητής: ',
        winners.map((w, i) => [i ? ' & ' : '', h('span', { class: 'pdot ' + w.color, style: 'margin:0 1vh;vertical-align:-0.3vh' }), w.name])),
      h('table', null,
        h('tr', null, ['#', 'Παίκτης', 'Διαδρομές', 'Προορισμοί', 'Σταθμοί', 'Εξπρές', 'Σύνολο'].map((t) => h('th', null, t))),
        res.map((r) => h('tr', { class: r.rank === 1 ? 'first' : '' },
          h('td', null, String(r.rank)),
          h('td', null, h('span', { class: 'pdot ' + r.color }), r.name),
          h('td', null, String(r.routePoints)),
          h('td', { class: r.ticketPoints < 0 ? 'neg' : '' }, `${r.ticketPoints > 0 ? '+' : ''}${r.ticketPoints} (${r.ticketsDone}/${r.tickets.length})`),
          h('td', null, r.stationPoints ? '+' + r.stationPoints : '0'),
          h('td', null, r.express ? '+10' : '–'),
          h('td', { class: 'total' }, String(r.total))))),
      h('div', { class: 'note' }, `Ευρωπαϊκό Εξπρές (μεγαλύτερη συνεχόμενη διαδρομή): ${expressName || '–'}. Φαίνεται φωτισμένη στον χάρτη.`)));
  }

  // Tap/click the results to peek at the final board.
  $('results-screen').addEventListener('click', () => {
    const box = $('results-screen');
    box.style.opacity = box.style.opacity === '0' ? '' : '0';
  });
})();
