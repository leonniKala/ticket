/* ============================================================
   Μικρός server: σερβίρει τις σελίδες και κρατά τα δωμάτια στη μνήμη.
   Καμία βάση δεδομένων — αν πέσει ο server, χάνονται τα τρέχοντα παιχνίδια.
   ============================================================ */
'use strict';
const http = require('http');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { WebSocketServer } = require('ws');
const E = require('./public/engine.js');

const PORT = process.env.PORT || 3000;
const PUBLIC = path.join(__dirname, 'public');
const ROUTES = JSON.parse(fs.readFileSync(path.join(PUBLIC, 'routes.json'), 'utf8'));

/* ---------- δωμάτια ---------- */
const rooms = new Map();                      // code -> {code, G, sockets:Set, hostToken, lastSeen}
const ROOM_TTL = 1000 * 60 * 60 * 6;          // 6 ώρες χωρίς κίνηση -> σβήνει

function newCode() {
  let c;
  do { c = String(Math.floor(1000 + Math.random() * 9000)); } while (rooms.has(c));
  return c;
}
function createRoom() {
  const code = newCode();
  const room = {
    code,
    G: E.createGame(ROUTES),
    sockets: new Set(),
    hostToken: crypto.randomBytes(12).toString('hex'),
    lastSeen: Date.now()
  };
  rooms.set(code, room);
  return room;
}
setInterval(() => {
  const now = Date.now();
  for (const [code, r] of rooms) if (now - r.lastSeen > ROOM_TTL) rooms.delete(code);
}, 1000 * 60 * 10).unref();

/* ---------- στατικά αρχεία ---------- */
const MIME = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8', '.json': 'application/json; charset=utf-8',
  '.png': 'image/png', '.svg': 'image/svg+xml', '.ico': 'image/x-icon'
};
const server = http.createServer((req, res) => {
  let url = req.url.split('?')[0];
  if (url === '/') url = '/index.html';
  if (url === '/tv') url = '/tv.html';
  if (url === '/play') url = '/play.html';
  if (url === '/health') { res.writeHead(200); return res.end('ok'); }

  const file = path.join(PUBLIC, path.normalize(url).replace(/^(\.\.[\/\\])+/, ''));
  if (!file.startsWith(PUBLIC)) { res.writeHead(403); return res.end('no'); }
  fs.readFile(file, (err, data) => {
    if (err) { res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' }); return res.end('Δεν βρέθηκε'); }
    res.writeHead(200, { 'Content-Type': MIME[path.extname(file)] || 'application/octet-stream' });
    res.end(data);
  });
});

/* ---------- WebSocket ---------- */
const wss = new WebSocketServer({ server });

function send(ws, msg) {
  if (ws.readyState === 1) ws.send(JSON.stringify(msg));
}
function broadcast(room) {
  room.lastSeen = Date.now();
  for (const ws of room.sockets) {
    send(ws, { t: 'state', code: room.code, state: E.publicState(room.G, ws.playerId || null), isHost: !!ws.isHost });
  }
}

wss.on('connection', ws => {
  ws.isAlive = true;
  ws.on('pong', () => { ws.isAlive = true; });

  ws.on('message', raw => {
    let m;
    try { m = JSON.parse(raw); } catch (e) { return; }

    /* --- η τηλεόραση φτιάχνει δωμάτιο --- */
    if (m.t === 'host') {
      let room = m.code ? rooms.get(String(m.code)) : null;
      if (!room) room = createRoom();
      ws.room = room; ws.isHost = true; ws.playerId = null;
      room.sockets.add(ws);
      send(ws, { t: 'hosted', code: room.code, hostToken: room.hostToken });
      broadcast(room);
      return;
    }

    /* --- παίκτης μπαίνει ή ξανασυνδέεται --- */
    if (m.t === 'join') {
      const room = rooms.get(String(m.code || ''));
      if (!room) return send(ws, { t: 'error', msg: 'Δεν υπάρχει δωμάτιο με αυτόν τον κωδικό' });
      const name = String(m.name || '').trim();
      const pin = String(m.pin || '');
      const existing = room.G.players.find(p => p.name.toLowerCase() === name.toLowerCase());

      if (existing) {                                  // επιστροφή στη θέση του
        if (existing.pin && existing.pin !== pin)
          return send(ws, { t: 'error', msg: 'Λάθος κωδικός για αυτό το όνομα' });
        existing.connected = true;
        ws.room = room; ws.playerId = existing.id; ws.isHost = false;
        room.sockets.add(ws);
        send(ws, { t: 'joined', code: room.code, playerId: existing.id, name: existing.name });
        broadcast(room);
        return;
      }
      const id = crypto.randomBytes(8).toString('hex');
      const r = E.addPlayer(room.G, id, name, pin);
      if (!r.ok) return send(ws, { t: 'error', msg: r.error });
      ws.room = room; ws.playerId = id; ws.isHost = false;
      room.sockets.add(ws);
      send(ws, { t: 'joined', code: room.code, playerId: id, name });
      broadcast(room);
      return;
    }

    const room = ws.room;
    if (!room) return;
    room.lastSeen = Date.now();

    if (m.t === 'start') {                             // μόνο η τηλεόραση ξεκινά
      if (!ws.isHost) return send(ws, { t: 'error', msg: 'Μόνο ο οικοδεσπότης ξεκινά το παιχνίδι' });
      const r = E.start(room.G);
      if (!r.ok) return send(ws, { t: 'error', msg: r.error });
      broadcast(room);
      return;
    }

    if (m.t === 'reset') {
      if (!ws.isHost) return;
      const names = room.G.players.map(p => ({ id: p.id, name: p.name, pin: p.pin }));
      room.G = E.createGame(ROUTES);
      names.forEach(n => E.addPlayer(room.G, n.id, n.name, n.pin));
      broadcast(room);
      return;
    }

    if (m.t === 'action') {
      if (!ws.playerId) return send(ws, { t: 'error', msg: 'Δεν είσαι παίκτης' });
      const r = E.apply(room.G, ws.playerId, m.action || {});
      if (!r.ok) return send(ws, { t: 'error', msg: r.error });
      broadcast(room);
      return;
    }
  });

  ws.on('close', () => {
    const room = ws.room;
    if (!room) return;
    room.sockets.delete(ws);
    if (ws.playerId) {
      const p = room.G.players.find(x => x.id === ws.playerId);
      if (p && ![...room.sockets].some(s => s.playerId === ws.playerId)) p.connected = false;
    }
    broadcast(room);
  });
});

// κρατά ζωντανές τις συνδέσεις (κάποιοι proxy κόβουν τις αδρανείς)
setInterval(() => {
  wss.clients.forEach(ws => {
    if (ws.isAlive === false) return ws.terminate();
    ws.isAlive = false;
    try { ws.ping(); } catch (e) {}
  });
}, 25000).unref();

server.listen(PORT, () => console.log('Ο server ακούει στη θύρα ' + PORT));
