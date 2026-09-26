'use strict';
/*
 * Ticket to Ride – Europe: web server.
 *   /        players join from their phones
 *   /tv      the shared board for the TV
 *   /admin   create / restart / close games (password: ADMIN_PASSWORD)
 */
const path = require('path');
const http = require('http');
const crypto = require('crypto');
const express = require('express');
const { Server } = require('socket.io');
const QRCode = require('qrcode');
const G = require('./server/game');
const { Rooms } = require('./server/rooms');

const PORT = process.env.PORT || 3000;
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || 'admin';
// DATA_FILE="" disables saving games to disk.
const DATA_FILE = process.env.DATA_FILE !== undefined ? process.env.DATA_FILE : path.join(__dirname, 'data', 'rooms.json');
if (!process.env.ADMIN_PASSWORD) console.warn('ADMIN_PASSWORD is not set, using "admin".');

const adminToken = crypto.createHash('sha256').update('ttr-admin|' + ADMIN_PASSWORD).digest('hex');
const isAdmin = (token) =>
  typeof token === 'string' && token.length === adminToken.length &&
  crypto.timingSafeEqual(Buffer.from(token), Buffer.from(adminToken));

const rooms = new Rooms({ dataFile: DATA_FILE });
const app = express();
const server = http.createServer(app);
const io = new Server(server, { pingInterval: 20000, pingTimeout: 25000 });

// ------------------------------------------------------------------ http
const PUBLIC = path.join(__dirname, 'public');
app.disable('x-powered-by');
const page = (file) => (req, res) => res.sendFile(path.join(PUBLIC, file));
app.get('/', page('index.html'));
app.get('/play', page('play.html'));
app.get('/tv', page('tv.html'));
app.get('/admin', page('admin.html'));
app.get('/api/ping', (req, res) => res.json({ ok: true, t: Date.now() }));
app.get('/api/qr/:code', async (req, res) => {
  const room = rooms.get(req.params.code);
  if (!room) return res.status(404).end();
  const proto = req.get('x-forwarded-proto') || req.protocol;
  const url = `${proto}://${req.get('host')}/?code=${room.code}`;
  res.type('image/svg+xml').set('Cache-Control', 'no-store')
    .send(await QRCode.toString(url, { type: 'svg', margin: 1, color: { dark: '#1b2a33', light: '#ffffff' } }));
});
// maxAge 0: browsers revalidate (ETag) so phones always get the latest code after a deploy.
app.use(express.static(PUBLIC, { extensions: ['html'], maxAge: 0 }));

// ------------------------------------------------------------------ views
function roomInfo(room) {
  const online = new Set();
  for (const id of io.sockets.adapter.rooms.get('room:' + room.code) || []) {
    const s = io.sockets.sockets.get(id);
    if (s && s.data.memberId) online.add(s.data.memberId);
  }
  return {
    code: room.code,
    phase: rooms.phase(room),
    gameNo: room.gameNo,
    members: room.members.map((m) => ({ id: m.id, name: m.name, color: m.color, online: online.has(m.id) })),
  };
}

function viewFor(room, socket) {
  const view = { room: roomInfo(room), game: room.game ? G.publicView(room.game) : null };
  if (socket.data.memberId) {
    view.myId = socket.data.memberId;
    view.me = room.game ? G.privateView(room.game, socket.data.memberId) : null;
  }
  return view;
}

function broadcast(room) {
  for (const id of io.sockets.adapter.rooms.get('room:' + room.code) || []) {
    const s = io.sockets.sockets.get(id);
    if (s) s.emit('state', viewFor(room, s));
  }
  io.to('admins').emit('admin:rooms', rooms.list());
}

// ------------------------------------------------------------------ sockets
function handler(socket, fn) {
  return async (payload, ack) => {
    if (typeof ack !== 'function') ack = () => {};
    try {
      ack({ ok: true, ...(await fn(payload || {})) });
    } catch (e) {
      if (!(e instanceof G.GameError)) console.error(e);
      ack({ ok: false, error: e instanceof G.GameError ? e.message : 'Κάτι πήγε στραβά' });
    }
  };
}

function enterRoom(socket, room) {
  for (const r of socket.rooms) if (r.startsWith('room:')) socket.leave(r);
  socket.join('room:' + room.code);
  socket.data.code = room.code;
}

function requireRoom(code) {
  const room = rooms.get(code);
  if (!room) throw new G.GameError('Δεν υπάρχει παιχνίδι με αυτόν τον κωδικό');
  return room;
}

function adminOnly(socket) {
  if (!socket.data.admin) throw new G.GameError('Χρειάζεται σύνδεση admin');
}

io.on('connection', (socket) => {
  socket.data = {};

  // Join form: who is already in the room (so taken colours can be greyed out).
  socket.on('peek', handler(socket, ({ code }) => {
    const room = requireRoom(code);
    return { phase: rooms.phase(room), members: room.members.map((m) => ({ name: m.name, color: m.color })) };
  }));

  // Players: join (first time or with name + PIN again).
  socket.on('join', handler(socket, ({ code, name, pin, color }) => {
    const room = requireRoom(code);
    const member = rooms.join(room, { name, pin, color });
    return { token: member.token, code: room.code };
  }));

  // Everyone: attach this socket to a room as tv / player / admin viewer.
  socket.on('hello', handler(socket, ({ role, code, token }) => {
    const room = requireRoom(code);
    if (role === 'player') {
      const member = rooms.byToken(room, token);
      if (!member) throw new G.GameError('Η σύνδεση έληξε, μπες ξανά');
      socket.data.memberId = member.id;
    } else {
      delete socket.data.memberId;
    }
    socket.data.role = role;
    enterRoom(socket, room);
    broadcast(room);
    return { code: room.code };
  }));

  socket.on('color', handler(socket, ({ color }) => {
    const room = requireRoom(socket.data.code);
    const member = room.members.find((m) => m.id === socket.data.memberId);
    if (!member) throw new G.GameError('Δεν είσαι παίκτης σε αυτό το παιχνίδι');
    rooms.setColor(room, member, color);
    broadcast(room);
  }));

  socket.on('action', handler(socket, (action) => {
    const room = requireRoom(socket.data.code);
    if (!socket.data.memberId) throw new G.GameError('Δεν είσαι παίκτης σε αυτό το παιχνίδι');
    rooms.action(room, socket.data.memberId, action);
    broadcast(room);
  }));

  // ---------------------------------------------------------------- admin
  socket.on('admin:login', handler(socket, ({ password, token }) => {
    const t = token || crypto.createHash('sha256').update('ttr-admin|' + String(password || '')).digest('hex');
    if (!isAdmin(t)) throw new G.GameError('Λάθος κωδικός admin');
    socket.data.admin = true;
    socket.join('admins');
    socket.emit('admin:rooms', rooms.list());
    return { token: t };
  }));

  socket.on('admin:create', handler(socket, () => {
    adminOnly(socket);
    const room = rooms.create();
    io.to('admins').emit('admin:rooms', rooms.list());
    return { code: room.code };
  }));

  const adminRoomAction = (event, fn) => socket.on(event, handler(socket, ({ code, memberId }) => {
    adminOnly(socket);
    const room = requireRoom(code);
    fn(room, memberId);
    broadcast(room);
  }));
  adminRoomAction('admin:start', (room) => rooms.start(room));
  adminRoomAction('admin:restart', (room) => rooms.start(room));
  adminRoomAction('admin:lobby', (room) => rooms.toLobby(room));
  adminRoomAction('admin:kick', (room, memberId) => rooms.kick(room, memberId));
  adminRoomAction('admin:skip', (room) => rooms.skip(room));

  socket.on('admin:close', handler(socket, ({ code }) => {
    adminOnly(socket);
    const room = requireRoom(code);
    io.to('room:' + room.code).emit('closed');
    io.in('room:' + room.code).socketsLeave('room:' + room.code);
    rooms.close(room.code);
    io.to('admins').emit('admin:rooms', rooms.list());
  }));

  socket.on('disconnect', () => {
    const room = socket.data.code && rooms.get(socket.data.code);
    if (room) broadcast(room);
  });
});

if (require.main === module) {
  server.listen(PORT, () => console.log(`Ticket to Ride server on http://localhost:${PORT}`));
}

module.exports = { server, io, rooms };
