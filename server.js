const http = require('http');
const fs = require('fs');
const path = require('path');
const { WebSocketServer } = require('ws');

const PORT = process.env.PORT || 3000;

const server = http.createServer((req, res) => {
  const urlPath = req.url.split('?')[0] || '/';
  const safe = urlPath === '/' ? 'index.html' : urlPath.replace(/^\/+/, '');
  const full = path.join(__dirname, safe);
  if (!full.startsWith(__dirname)) { res.writeHead(403); res.end(); return; }
  fs.readFile(full, (err, data) => {
    if (err) { res.writeHead(404); res.end('Not found'); return; }
    const ext = path.extname(full);
    const mime = { '.html':'text/html; charset=utf-8', '.js':'application/javascript; charset=utf-8', '.css':'text/css; charset=utf-8' }[ext] || 'application/octet-stream';
    res.writeHead(200, { 'Content-Type': mime });
    res.end(data);
  });
});

const wss = new WebSocketServer({ server });
const rooms = new Map();
let nextId = 1;

wss.on('connection', (ws, req) => {
  const url = new URL(req.url, 'http://x');
  const roomId = (url.searchParams.get('room') || 'default').slice(0, 32);
  let room = rooms.get(roomId);
  if (!room) { room = { clients: new Map(), hostId: null }; rooms.set(roomId, room); }

  const id = nextId++;
  const isHost = room.hostId === null;
  if (isHost) room.hostId = id;
  room.clients.set(id, ws);

  const others = [...room.clients.keys()].filter(p => p !== id);
  ws.send(JSON.stringify({ t: 'welcome', id, isHost, roomId, players: others }));
  for (const [pid, c] of room.clients) {
    if (pid !== id && c.readyState === 1) c.send(JSON.stringify({ t: 'join', id }));
  }

  ws.on('message', raw => {
    let msg; try { msg = JSON.parse(raw); } catch { return; }
    msg.from = id;
    if (msg.t === 'state' || msg.t === 'hit') {
      const host = room.clients.get(room.hostId);
      if (host && host.readyState === 1 && host !== ws) host.send(JSON.stringify(msg));
    } else if (msg.t === 'enemies' || msg.t === 'players' || msg.t === 'gameStarted') {
      if (id !== room.hostId) return;
      for (const [pid, c] of room.clients) {
        if (pid !== id && c.readyState === 1) c.send(JSON.stringify(msg));
      }
    } else if (msg.t === 'hurt' || msg.t === 'killReward') {
      if (id !== room.hostId) return;
      const target = room.clients.get(msg.targetId);
      if (target && target.readyState === 1) target.send(JSON.stringify(msg));
    }
  });

  ws.on('close', () => {
    room.clients.delete(id);
    for (const [, c] of room.clients) if (c.readyState === 1) c.send(JSON.stringify({ t: 'leave', id }));
    if (room.hostId === id) {
      const nextId2 = room.clients.keys().next().value;
      if (nextId2 !== undefined) {
        room.hostId = nextId2;
        const next = room.clients.get(nextId2);
        if (next && next.readyState === 1) next.send(JSON.stringify({ t: 'becomeHost' }));
      } else {
        room.hostId = null; rooms.delete(roomId);
      }
    }
  });
});

server.listen(PORT, () => console.log('Server on ' + PORT));