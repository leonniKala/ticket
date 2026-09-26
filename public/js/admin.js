/* Admin page: create games and control them. */
(function () {
  'use strict';
  const { h, toast, store } = TTR;
  const $ = (id) => document.getElementById(id);
  const socket = TTR.connect();
  let rooms = [], freshCode = null;

  const PHASES = { lobby: 'Αναμονή παικτών', setup: 'Επιλογή προορισμών', playing: 'Σε εξέλιξη', finished: 'Τελείωσε' };

  async function login(payload) {
    try {
      const r = await socket.request('admin:login', payload);
      store.set('ttr:admin', r.token);
      $('login').classList.add('hidden');
      $('main').classList.remove('hidden');
    } catch (e) {
      store.del('ttr:admin');
      $('main').classList.add('hidden');
      $('login').classList.remove('hidden');
      if (payload.password !== undefined) $('login-err').textContent = e.message;
    }
  }

  socket.on('connect', () => {
    const token = store.get('ttr:admin');
    if (token) login({ token });
    else $('login').classList.remove('hidden');
  });
  $('login').addEventListener('submit', (e) => { e.preventDefault(); login({ password: $('pw').value }); });
  $('logout').addEventListener('click', () => { store.del('ttr:admin'); location.reload(); });

  socket.on('admin:rooms', (list) => { rooms = list; render(); });

  async function cmd(event, payload, confirmText) {
    if (confirmText && !confirm(confirmText)) return;
    try {
      return await socket.request(event, payload);
    } catch (e) {
      toast(e.message, 'error');
    }
  }

  $('new').addEventListener('click', async () => {
    const r = await cmd('admin:create', {});
    if (r) { freshCode = r.code; toast(`Νέο παιχνίδι: ${r.code}`, 'ok'); render(); }
  });

  function render() {
    const box = $('rooms');
    box.textContent = '';
    if (!rooms.length) {
      box.append(h('div', { class: 'empty' }, 'Δεν υπάρχει ανοιχτό παιχνίδι. Πάτα «Νέο παιχνίδι».'));
      return;
    }
    for (const r of rooms) {
      const code = r.code;
      const btns = h('div', { class: 'btns' });
      if (r.phase === 'lobby') {
        btns.append(h('button', {
          class: 'btn primary', disabled: r.members.length < 2,
          onclick: () => cmd('admin:start', { code }),
        }, r.members.length < 2 ? 'Έναρξη (θέλει 2+ παίκτες)' : `Έναρξη με ${r.members.length} παίκτες`));
      } else {
        btns.append(h('button', { class: 'btn primary', onclick: () => cmd('admin:restart', { code }, 'Restart: νέο μοίρασμα με τους ίδιους παίκτες. Το τρέχον παιχνίδι χάνεται. Σίγουρα;') }, 'Restart (ίδιοι παίκτες)'));
        btns.append(h('button', { class: 'btn', onclick: () => cmd('admin:lobby', { code }, 'Επιστροφή στην αναμονή: το τρέχον παιχνίδι χάνεται, οι παίκτες μένουν και μπορούν να μπουν κι άλλοι. Σίγουρα;') }, 'Πίσω στην αναμονή'));
        if (r.phase === 'playing') {
          const cur = r.members.find((m) => m.id === r.current);
          btns.append(h('button', { class: 'btn', onclick: () => cmd('admin:skip', { code }, `Παράλειψη της σειράς του/της ${cur ? cur.name : ''};`) }, 'Παράλειψη σειράς'));
        }
      }
      btns.append(h('button', { class: 'btn danger', onclick: () => cmd('admin:close', { code }, `Κλείσιμο του παιχνιδιού ${code}; Όλοι αποσυνδέονται.`) }, 'Κλείσιμο'));

      const origin = location.origin;
      box.append(h('div', { class: 'room' + (code === freshCode ? ' fresh' : '') },
        h('div', { class: 'room-head' },
          h('div', { class: 'room-code' }, code),
          h('span', { class: 'phase ' + r.phase }, PHASES[r.phase] || r.phase),
          r.gameNo > 1 ? h('span', { class: 'muted' }, `παρτίδα #${r.gameNo}`) : null,
          h('div', { class: 'qr' }, h('img', { src: `/api/qr/${code}`, alt: 'QR' }))),
        h('div', { class: 'links' },
          h('a', { href: `/tv?code=${code}`, target: '_blank' }, 'Άνοιγμα στην τηλεόραση ↗'),
          h('a', { href: `/?code=${code}`, target: '_blank' }, 'Link για παίκτες ↗'),
          h('span', { class: 'muted' }, `${origin}/?code=${code}`)),
        h('div', { class: 'members' },
          r.members.length ? r.members.map((m) => h('div', { class: 'mem' + (m.id === r.current ? ' current' : '') },
            h('span', { class: 'pdot ' + m.color }), m.name,
            r.phase === 'lobby' ? h('button', { title: 'Αφαίρεση', onclick: () => cmd('admin:kick', { code, memberId: m.id }, `Αφαίρεση του/της ${m.name};`) }, '×') : null))
            : h('span', { class: 'muted' }, 'Δεν έχει μπει κανείς ακόμα.')),
        btns));
    }
  }
})();
