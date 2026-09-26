'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { io: connect } = require('socket.io-client');

process.env.ADMIN_PASSWORD = 'test-pw';
process.env.DATA_FILE = '';
const { server, io } = require('../server.js');
const Pay = require('../public/js/payments.js');
const MAP = require('../public/js/map-data.js');

let url;
const sockets = [];
function client() {
  const s = connect(url, { transports: ['websocket'], forceNew: true });
  sockets.push(s);
  s.latest = null;
  s.on('state', (v) => { s.latest = v; });
  s.req = (ev, payload) => new Promise((resolve, reject) =>
    s.emit(ev, payload, (r) => (r.ok ? resolve(r) : reject(new Error(r.error)))));
  return s;
}
const until = async (fn, ms = 2000) => {
  const t0 = Date.now();
  while (!fn()) {
    if (Date.now() - t0 > ms) throw new Error('timeout');
    await new Promise((r) => setTimeout(r, 10));
  }
};

test.before(() => new Promise((resolve) => server.listen(0, () => { url = `http://localhost:${server.address().port}`; resolve(); })));
test.after(() => { for (const s of sockets) s.close(); io.close(); server.close(); });

test('full flow: admin creates, players join, hidden info stays hidden', async () => {
  const admin = client();
  await assert.rejects(admin.req('admin:login', { password: 'nope' }), /Λάθος κωδικός/);
  await assert.rejects(admin.req('admin:create', {}), /admin/);
  await admin.req('admin:login', { password: 'test-pw' });
  const { code } = await admin.req('admin:create', {});
  assert.match(code, /^\d{4}$/);

  const tv = client();
  await tv.req('hello', { role: 'tv', code });

  const players = [];
  for (const [name, color] of [['Άννα', 'red'], ['Βασίλης', 'blue'], ['Γιώργος', null]]) {
    const p = client();
    const r = await p.req('join', { code, name, pin: '1234', color });
    await p.req('hello', { role: 'player', code, token: r.token });
    p.token = r.token;
    players.push(p);
  }
  // wrong PIN for an existing name, bad PIN format, taken colour
  const intruder = client();
  await assert.rejects(intruder.req('join', { code, name: 'άννα', pin: '9999' }), /άλλο PIN/);
  await assert.rejects(intruder.req('join', { code, name: 'Νίκος', pin: '12' }), /4 ψηφία/);
  await assert.rejects(intruder.req('join', { code, name: 'Νίκος', pin: '1111', color: 'red' }), /χρώμα/);
  // actions are refused for non-players
  await assert.rejects(intruder.req('action', { type: 'drawBlind' }));

  await until(() => tv.latest && tv.latest.room.members.length === 3);
  assert.equal(tv.latest.room.members[2].color, 'green');
  assert.equal(tv.latest.game, null);

  await admin.req('admin:start', { code });
  await until(() => tv.latest.game && players.every((p) => p.latest && p.latest.me));
  assert.equal(tv.latest.game.phase, 'setup');
  assert.equal(tv.latest.me, undefined);
  const tvJson = JSON.stringify(tv.latest);
  assert.ok(!tvJson.includes('"hand"') && !tvJson.includes('"offer"'), 'TV must not see hands or ticket offers');
  const p0json = JSON.stringify(players[0].latest);
  assert.ok(!p0json.includes(players[1].token), 'tokens are never broadcast');

  for (const p of players) await p.req('action', { type: 'keepSetupTickets', ids: p.latest.me.offer.slice(0, 2).map((t) => t.id) });
  await until(() => tv.latest.game.phase === 'playing');

  // The current player draws two cards; the others can't move.
  const curId = tv.latest.game.current;
  const cur = players.find((p) => p.latest.myId === curId);
  const other = players.find((p) => p !== cur);
  await assert.rejects(other.req('action', { type: 'drawBlind' }), /σειρά σου/);
  await cur.req('action', { type: 'drawBlind' });
  await until(() => cur.latest.me.drawn.length === 1);
  await cur.req('action', { type: 'drawBlind' });
  await until(() => tv.latest.game.current !== curId);
  assert.equal(cur.latest.me.drawn.length, 2, 'player still sees both drawn cards');
  assert.equal(tv.latest.game.players.find((p) => p.id === curId).handCount, 6);

  // Next player claims something affordable if possible.
  const next = players.find((p) => p.latest.myId === tv.latest.game.current);
  await until(() => next.latest.game.current === next.latest.myId);
  const hand = next.latest.me.hand;
  const route = MAP.routes.find((r) => !r.tunnel && Pay.route(r, hand).length);
  if (route) {
    await next.req('action', { type: 'claimRoute', routeId: route.id, payment: Pay.route(route, hand)[0] });
    await until(() => tv.latest.game.claims[route.id] === next.latest.myId);
    assert.ok(tv.latest.game.events.some((e) => e.type === 'claim' && e.routeId === route.id));
  }

  // Restart keeps the players, closing kicks everyone out.
  await admin.req('admin:restart', { code });
  await until(() => tv.latest.game && tv.latest.game.phase === 'setup' && tv.latest.room.gameNo === 2);
  let closed = false;
  tv.on('closed', () => { closed = true; });
  await admin.req('admin:close', { code });
  await until(() => closed);
  await assert.rejects(tv.req('hello', { role: 'tv', code }), /Δεν υπάρχει/);
});

test('qr code endpoint', async () => {
  const admin = client();
  await admin.req('admin:login', { password: 'test-pw' });
  const { code } = await admin.req('admin:create', {});
  const res = await fetch(`${url}/api/qr/${code}`);
  assert.equal(res.status, 200);
  assert.match(await res.text(), /<svg/);
  assert.equal((await fetch(`${url}/api/qr/0000`)).status, 404);
});
