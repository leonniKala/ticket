/* Helpers shared by the TV, phone and admin pages. */
(function (root) {
  'use strict';

  const CARD_NAMES = {
    purple: 'Μωβ', white: 'Λευκή', blue: 'Μπλε', yellow: 'Κίτρινη', orange: 'Πορτοκαλί',
    black: 'Μαύρη', red: 'Κόκκινη', green: 'Πράσινη', loco: 'Ατμομηχανή', gray: 'Γκρι',
  };
  const CARD_PLURAL = {
    purple: 'μωβ', white: 'λευκές', blue: 'μπλε', yellow: 'κίτρινες', orange: 'πορτοκαλί',
    black: 'μαύρες', red: 'κόκκινες', green: 'πράσινες', loco: 'ατμομηχανές',
  };
  /** "1 κόκκινη", "3 κόκκινες", "2 ατμομηχανές" */
  const cardsName = (n, c) => `${n} ${n === 1 ? CARD_NAMES[c].toLowerCase() : CARD_PLURAL[c]}`;
  const ROUTE_COLOR_NAMES = {
    purple: 'μωβ', white: 'λευκή', blue: 'μπλε', yellow: 'κίτρινη', orange: 'πορτοκαλί',
    black: 'μαύρη', red: 'κόκκινη', green: 'πράσινη', gray: 'γκρι (οποιοδήποτε χρώμα)',
  };
  const PLAYER_COLOR_NAMES = { red: 'Κόκκινο', blue: 'Μπλε', green: 'Πράσινο', yellow: 'Κίτρινο', black: 'Μαύρο' };
  const CARD_ORDER = ['loco', 'red', 'orange', 'yellow', 'green', 'blue', 'purple', 'white', 'black'];

  const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

  function h(tag, attrs, ...children) {
    const e = document.createElement(tag);
    for (const k in attrs || {}) {
      const v = attrs[k];
      if (v === false || v === null || v === undefined) continue;
      if (k === 'class') e.className = v;
      else if (k.startsWith('on')) e.addEventListener(k.slice(2), v);
      else if (k === 'html') e.innerHTML = v;
      else e.setAttribute(k, v === true ? '' : v);
    }
    for (const c of children.flat(Infinity)) if (c !== null && c !== undefined && c !== false) e.append(c.nodeType ? c : document.createTextNode(c));
    return e;
  }

  function card(type, count, extra = {}) {
    const el = h('div', { class: `tcard ${type || 'empty'}`, title: CARD_NAMES[type] || '', ...extra });
    if (count !== undefined && count !== null) el.append(h('span', { class: 'count' }, String(count)));
    return el;
  }

  /** "2 κόκκινες + 1 ατμομηχανή" as card chips. */
  function paymentChips(pay) {
    const wrap = h('div', { class: 'pay-chips' });
    if (pay.n) wrap.append(card(pay.color, pay.n));
    if (pay.loco) wrap.append(card('loco', pay.loco));
    return wrap;
  }

  function paymentText(pay) {
    const parts = [];
    if (pay.n) parts.push(cardsName(pay.n, pay.color));
    if (pay.loco) parts.push(cardsName(pay.loco, 'loco'));
    return parts.join(' + ');
  }

  function ticketEl(t, extra = {}) {
    const M = root.TTR_MAP;
    return h('div', { class: 'ticket' + (t.long ? ' long' : '') + (t.done ? ' done' : ''), ...extra },
      h('div', { class: 'cities' }, `${M.cities[t.a].name} – ${M.cities[t.b].name}`,
        t.done !== undefined ? h('div', { class: 'state' }, t.done ? 'Ολοκληρώθηκε' : '') : null),
      h('div', { class: 'pts' }, String(t.points)));
  }

  function toast(msg, kind = '') {
    let box = document.getElementById('toasts');
    if (!box) { box = h('div', { id: 'toasts' }); document.body.append(box); }
    const t = h('div', { class: 'toast ' + kind }, msg);
    box.append(t);
    setTimeout(() => t.remove(), kind === 'error' ? 4500 : 3200);
  }

  const store = {
    get(k) { try { return JSON.parse(localStorage.getItem(k)); } catch (e) { return null; } },
    set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch (e) { /* private mode */ } },
    del(k) { try { localStorage.removeItem(k); } catch (e) { /* private mode */ } },
  };

  // The player's login: per tab first (several players can share one browser), then per device.
  const playerSession = {
    get() {
      try { const s = JSON.parse(sessionStorage.getItem('ttr:session')); if (s) return s; } catch (e) { /* ignore */ }
      return store.get('ttr:session');
    },
    set(v) {
      try { sessionStorage.setItem('ttr:session', JSON.stringify(v)); } catch (e) { /* ignore */ }
      store.set('ttr:session', v);
    },
    del() {
      try { sessionStorage.removeItem('ttr:session'); } catch (e) { /* ignore */ }
      store.del('ttr:session');
    },
  };

  function connect() {
    const socket = root.io({ transports: ['websocket', 'polling'] });
    const badge = h('div', { class: 'conn hidden' }, 'Σύνδεση…');
    document.addEventListener('DOMContentLoaded', () => document.body.append(badge));
    if (document.body) document.body.append(badge);
    socket.on('connect', () => badge.classList.add('hidden'));
    socket.on('disconnect', () => badge.classList.remove('hidden'));
    socket.request = (event, payload) => new Promise((resolve, reject) => {
      socket.timeout(10000).emit(event, payload, (err, res) => {
        if (err) return reject(new Error('Δεν απαντάει ο server'));
        if (!res || !res.ok) return reject(new Error((res && res.error) || 'Σφάλμα'));
        resolve(res);
      });
    });
    return socket;
  }

  /** Free Render instances sleep without HTTP traffic; ping while a page is open. */
  function keepAlive() {
    setInterval(() => fetch('/api/ping', { cache: 'no-store' }).catch(() => {}), 4 * 60 * 1000);
  }

  function routeLabel(r) {
    const M = root.TTR_MAP;
    return `${M.cities[r.a].name} – ${M.cities[r.b].name}`;
  }

  function playerColorMap(game) {
    const map = {};
    for (const p of (game && game.players) || []) map[p.id] = p.color;
    return map;
  }

  /** Board state (claims coloured by player, stations, score markers) from a public game view. */
  function boardState(game, highlight) {
    if (!game) return { highlight };
    const colorOf = playerColorMap(game);
    const claims = {}, stations = {};
    for (const [rid, pid] of Object.entries(game.claims)) claims[rid] = colorOf[pid];
    for (const [cid, pid] of Object.entries(game.stations)) stations[cid] = colorOf[pid];
    const scores = game.results
      ? game.results.map((r) => ({ color: r.color, score: r.total }))
      : game.players.map((p) => ({ color: p.color, score: p.score }));
    return { claims, stations, scores, highlight };
  }

  async function loadLand() {
    const res = await fetch('/data/land.json');
    return res.json();
  }

  root.TTR = {
    CARD_NAMES, CARD_PLURAL, ROUTE_COLOR_NAMES, PLAYER_COLOR_NAMES, CARD_ORDER, cardsName,
    esc, h, card, paymentChips, paymentText, ticketEl, toast, store, playerSession, connect, keepAlive,
    routeLabel, playerColorMap, boardState, loadLand,
  };
})(window);
