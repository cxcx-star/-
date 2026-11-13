/* 血染钟楼 · 桌面助手 —— 零依赖 Node 服务
   静态页面 + 房间同步（SSE 推送 / HTTP 写入）+ JSON 落盘
   启动：node server.js        （可选 PORT=8787 node server.js） */
'use strict';

const http = require('node:http');
const https = require('node:https');
const fs = require('node:fs');
const fsp = require('node:fs/promises');
const path = require('node:path');
const os = require('node:os');
const tls = require('node:tls');
const crypto = require('node:crypto');
const Model = require('./public/js/model.js');

const ROOT = __dirname;
const PUBLIC = path.join(ROOT, 'public');
const DATA = path.join(ROOT, 'data', 'rooms');
/* 端口：命令行 --port 8787 > 环境变量 CT_PORT > 默认 8787。
   刻意不读 PORT —— 很多调度环境会把自己的 PORT 塞进来。 */
const ARG_PORT = (() => {
  const i = process.argv.indexOf('--port');
  const v = i >= 0 ? Number(process.argv[i + 1]) : NaN;
  return Number.isFinite(v) && v > 0 ? v : NaN;
})();
const START_PORT = ARG_PORT || Number(process.env.CT_PORT) || 8787;
const HTTPS_PORT = Number(process.env.CT_HTTPS_PORT) || 8443;
const HOST = '0.0.0.0';

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.webmanifest': 'application/manifest+json',
  '.ico': 'image/x-icon',
  '.txt': 'text/plain; charset=utf-8',
  '.apk': 'application/vnd.android.package-archive'
};

/** @type {Map<string, {doc: any, clients: Set<any>, saveTimer: any}>} */
const rooms = new Map();

/* ---------- 小工具 ---------- */

function json(res, code, body) {
  const buf = Buffer.from(JSON.stringify(body));
  res.writeHead(code, {
    'Content-Type': 'application/json; charset=utf-8',
    'Content-Length': buf.length,
    'Cache-Control': 'no-store'
  });
  res.end(buf);
}

function readBody(req, limit = 256 * 1024) {
  return new Promise((resolve, reject) => {
    let size = 0;
    const chunks = [];
    req.on('data', (c) => {
      size += c.length;
      if (size > limit) {
        reject(new Error('payload too large'));
        req.destroy();
        return;
      }
      chunks.push(c);
    });
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
    req.on('error', reject);
  });
}

function lanAddresses() {
  const out = [];
  const nets = os.networkInterfaces();
  for (const name of Object.keys(nets)) {
    for (const net of nets[name] || []) {
      if (net.family === 'IPv4' && !net.internal) out.push({ iface: name, address: net.address });
    }
  }
  // 手机可能同时有移动数据（rmnet）和 Wi-Fi，优先给平板能连的那个
  const score = (x) => {
    let s = 0;
    if (x.address.startsWith('192.168.')) s += 100;
    else if (x.address.startsWith('10.')) s += 60;
    else if (/^172\.(1[6-9]|2\d|3[01])\./.test(x.address)) s += 50;
    if (/^(wlan|wl|en|eth)/.test(x.iface)) s += 40;
    if (/^(rmnet|wwan|ppp|tun|tap|docker|br-|veth|virbr)/.test(x.iface)) s -= 120;
    return s;
  };
  return out.sort((a, b) => score(b) - score(a));
}

/* ---------- 房间 ---------- */

function roomFile(code) {
  if (!/^[A-Z0-9]{4}$/.test(code)) throw new Error('bad code');
  return path.join(DATA, code + '.json');
}

function newRoom(code) {
  const room = { doc: Model.newDoc(code), clients: new Set(), saveTimer: null };
  rooms.set(room.doc.code, room);
  return room;
}

async function getRoom(code) {
  if (!Model.isCode(code)) return null;
  let room = rooms.get(code);
  if (room) return room;
  try {
    const raw = JSON.parse(await fsp.readFile(roomFile(code), 'utf8'));
    room = { doc: Model.ensureDoc(raw, code), clients: new Set(), saveTimer: null };
    rooms.set(code, room);
    return room;
  } catch (err) {
    if (err.code === 'ENOENT') return null;
    console.warn('[room] 读取失败', code, err.message);
    return null;
  }
}

function presenceOf(room) {
  const out = { total: 0, grimoire: 0, square: 0 };
  for (const c of room.clients) {
    out.total++;
    if (c.role === 'square') out.square++;
    else out.grimoire++;
  }
  return out;
}

function payload(room) {
  return { doc: room.doc, rev: room.doc.rev, presence: presenceOf(room), watch: watchInfo(room.doc.code) };
}

function scheduleSave(room) {
  clearTimeout(room.saveTimer);
  room.saveTimer = setTimeout(() => {
    room.saveTimer = null;
    const file = roomFile(room.doc.code);
    const tmp = file + '.' + process.pid + '.tmp';
    fsp
      .writeFile(tmp, JSON.stringify(room.doc, null, 2))
      .then(() => fsp.rename(tmp, file))
      .catch((err) => console.warn('[room] 落盘失败', room.doc.code, err.message));
  }, 180);
}


/* ================= 官方魔典 · 线上房间监听 =================
   官方「创建小镇」是一个 WebSocket 中继：主持人在 <channel>/host，
   旁观者在 <channel>/<playerId>。旁观者发 direct getGamestate 就能拿到
   整份状态，之后主持人每次改动都会广播 ["gs", {...}]。
   这里用一条自带的极简 WS 客户端（Node 20+ 内置 WebSocket 会被对方断开）。 */

class MiniWS {
  constructor(host, port, path, origin) {
    this.host = host;
    this.port = port;
    this.path = path;
    this.origin = origin;
    this.buf = Buffer.alloc(0);
    this.onmessage = null;
    this.onclose = null;
    this.closed = false;
  }

  connect() {
    return new Promise((resolve, reject) => {
      const key = crypto.randomBytes(16).toString('base64');
      let done = false;
      const sock = tls.connect({ host: this.host, port: this.port, servername: this.host }, () => {
        sock.write(
          'GET ' + this.path + ' HTTP/1.1\r\n' +
          'Host: ' + this.host + ':' + this.port + '\r\n' +
          'Upgrade: websocket\r\n' +
          'Connection: Upgrade\r\n' +
          'Sec-WebSocket-Key: ' + key + '\r\n' +
          'Sec-WebSocket-Version: 13\r\n' +
          (this.origin ? 'Origin: ' + this.origin + '\r\n' : '') +
          '\r\n'
        );
      });
      this.sock = sock;
      sock.on('data', (d) => {
        this.buf = Buffer.concat([this.buf, d]);
        if (!done) {
          const idx = this.buf.indexOf('\r\n\r\n');
          if (idx < 0) return;
          const head = this.buf.slice(0, idx).toString();
          if (!/^HTTP\/1\.1 101/.test(head)) {
            done = true;
            reject(new Error('handshake ' + (head.split('\r\n')[0] || 'fail')));
            sock.destroy();
            return;
          }
          done = true;
          this.buf = this.buf.slice(idx + 4);
          resolve(this);
        }
        this.parse();
      });
      sock.on('error', (err) => { if (!done) { done = true; reject(err); } });
      sock.on('close', () => {
        this.closed = true;
        if (this.onclose) this.onclose();
      });
      setTimeout(() => { if (!done) { done = true; reject(new Error('timeout')); } }, 8000);
    });
  }

  parse() {
    while (this.buf.length >= 2) {
      const b0 = this.buf[0];
      const b1 = this.buf[1];
      const opcode = b0 & 0x0f;
      const masked = (b1 & 0x80) !== 0;
      let len = b1 & 0x7f;
      let off = 2;
      if (len === 126) {
        if (this.buf.length < 4) return;
        len = this.buf.readUInt16BE(2);
        off = 4;
      } else if (len === 127) {
        if (this.buf.length < 10) return;
        len = Number(this.buf.readBigUInt64BE(2));
        off = 10;
      }
      let mask = null;
      if (masked) {
        if (this.buf.length < off + 4) return;
        mask = this.buf.slice(off, off + 4);
        off += 4;
      }
      if (this.buf.length < off + len) return;
      let payload = this.buf.slice(off, off + len);
      if (mask) {
        payload = Buffer.from(payload);
        for (let i = 0; i < payload.length; i++) payload[i] ^= mask[i % 4];
      }
      this.buf = this.buf.slice(off + len);
      if (opcode === 0x1 && this.onmessage) this.onmessage(payload.toString('utf8'));
      else if (opcode === 0x9) this.pong(payload);
      else if (opcode === 0x8) { this.close(); return; }
    }
  }

  frame(opcode, data) {
    const mask = crypto.randomBytes(4);
    let head;
    if (data.length < 126) head = Buffer.from([opcode, 0x80 | data.length]);
    else if (data.length < 65536) {
      head = Buffer.alloc(4);
      head[0] = opcode;
      head[1] = 0x80 | 126;
      head.writeUInt16BE(data.length, 2);
    } else {
      head = Buffer.alloc(10);
      head[0] = opcode;
      head[1] = 0x80 | 127;
      head.writeBigUInt64BE(BigInt(data.length), 2);
    }
    const body = Buffer.from(data);
    for (let i = 0; i < body.length; i++) body[i] ^= mask[i % 4];
    return Buffer.concat([head, mask, body]);
  }

  send(text) {
    if (!this.sock || this.closed) return;
    try { this.sock.write(this.frame(0x81, Buffer.from(text))); } catch (err) { /* noop */ }
  }

  pong(payload) {
    if (!this.sock || this.closed) return;
    try { this.sock.write(this.frame(0x8a, payload)); } catch (err) { /* noop */ }
  }

  close() {
    this.closed = true;
    try { this.sock.end(); } catch (err) { /* noop */ }
  }
}

const WATCH_HOST = 'clocktower.gstonegames.com';
const WATCH_PORT = 8081;
const WATCH_ORIGIN = 'https://clocktower.gstonegames.com';
const watchers = new Map(); // code -> { room, ws, id, timers, connected, lastAt }

function watchInfo(code) {
  const w = watchers.get(code);
  if (!w) return null;
  return { room: w.room, connected: !!w.connected, lastAt: w.lastAt || 0 };
}

function applyGamestate(room, gs) {
  if (!gs || typeof gs !== 'object') return;
  const list = Array.isArray(gs.gamestate) ? gs.gamestate : [];
  const prev = new Map();
  room.doc.players.forEach((x) => prev.set(x.seat, x));
  const next = list.slice(0, 24).map((raw, i) => {
    raw = raw || {};
    const seat = i + 1;
    const old = prev.get(seat);
    return {
      id: old ? old.id : Model.uid(),
      seat: seat,
      name: Model.text(raw.name, 24) || ('座位' + seat),
      character: raw.roleId ? Model.text(raw.roleId, 32) : null,
      status: raw.isDead ? (raw.isVoteless ? 'deadNone' : 'deadVote') : 'alive'
    };
  });
  const phase = typeof gs.isNight === 'boolean' ? (gs.isNight ? 'night' : 'day') : room.doc.meta.phase;
  const sig = (arr) => JSON.stringify(arr.map((x) => [x.seat, x.name, x.character, x.status]));
  if (sig(next) !== sig(room.doc.players) || phase !== room.doc.meta.phase) {
    room.doc.players = next;
    room.doc.meta.phase = phase;
    room.doc.rev = (Number(room.doc.rev) || 0) + 1;
    room.doc.updatedAt = Date.now();
    Model.relayoutAuto(room.doc);
    scheduleSave(room);
    broadcast(room, 'state', payload(room));
  }
}

function startWatch(code, roomName) {
  stopWatch(code);
  const w = { room: roomName, ws: null, id: 'web-' + crypto.randomBytes(4).toString('hex'), timers: [], connected: false, lastAt: 0 };
  watchers.set(code, w);
  const tick = () => {
    const room = rooms.get(code);
    if (!room) { stopWatch(code); return; }
    const ws = new MiniWS(WATCH_HOST, WATCH_PORT, '/' + encodeURIComponent(w.room) + '/' + w.id, WATCH_ORIGIN);
    w.ws = ws;
    ws.onmessage = (raw) => {
      let msg;
      try { msg = JSON.parse(raw); } catch (err) { return; }
      if (!Array.isArray(msg)) return;
      const [type, data] = msg;
      if (type === 'gs') {
        w.connected = true;
        w.lastAt = Date.now();
        applyGamestate(room, data);
      }
    };
    ws.onclose = () => {
      w.connected = false;
      broadcast(room, 'state', payload(room));
      if (watchers.get(code) !== w) return;
      w.timers.push(setTimeout(tick, 3000));
    };
    ws.connect().then(() => {
      w.connected = true;
      ws.send(JSON.stringify(['direct', { host: ['getGamestate', w.id] }]));
      if (watchers.get(code) !== w) return ws.close();
      // 主持人可能还没上线：每 4 秒再要一次，直到收到 gs
      const ask = () => {
        if (watchers.get(code) !== w || ws.closed) return;
        if (!w.lastAt) ws.send(JSON.stringify(['direct', { host: ['getGamestate', w.id] }]));
        w.timers.push(setTimeout(ask, 4000));
      };
      w.timers.push(setTimeout(ask, 4000));
      // 心跳，别让中间层掐断
      const ping = () => {
        if (watchers.get(code) !== w || ws.closed) return;
        ws.send(JSON.stringify(['ping', [1, 'latency']]));
        w.timers.push(setTimeout(ping, 25000));
      };
      w.timers.push(setTimeout(ping, 25000));
      broadcast(room, 'state', payload(room));
    }).catch(() => {
      w.connected = false;
      if (watchers.get(code) !== w) return;
      w.timers.push(setTimeout(tick, 5000));
    });
  };
  tick();
  return watchInfo(code);
}

function stopWatch(code) {
  const w = watchers.get(code);
  if (!w) return;
  watchers.delete(code);
  w.timers.forEach(clearTimeout);
  if (w.ws) w.ws.close();
  const room = rooms.get(code);
  if (room) broadcast(room, 'state', payload(room));
}

// 房间被删除时一并停掉
const _origDelete = null;

/* ---------- SSE ---------- */

function sseSend(res, event, data) {
  res.write('event: ' + event + '\n' + 'data: ' + JSON.stringify(data) + '\n\n');
}

function broadcast(room, event, data) {
  for (const client of Array.from(room.clients)) {
    try {
      sseSend(client.res, event, data);
    } catch (err) {
      room.clients.delete(client);
    }
  }
}

function broadcastPresence(room) {
  broadcast(room, 'presence', presenceOf(room));
}

function handleStream(req, res, room, role) {
  res.writeHead(200, {
    'Content-Type': 'text/event-stream; charset=utf-8',
    'Cache-Control': 'no-cache, no-transform',
    Connection: 'keep-alive',
    'X-Accel-Buffering': 'no'
  });
  res.write('retry: 1500\n\n');
  if (res.socket) res.socket.setTimeout(0);

  const client = { res, role: role === 'square' ? 'square' : 'grimoire' };
  room.clients.add(client);

  sseSend(res, 'state', payload(room));
  broadcastPresence(room);

  const ping = setInterval(() => {
    try {
      res.write(': ping ' + Date.now() + '\n\n');
    } catch (err) {
      /* closed */
    }
  }, 20000);

  let closed = false;
  const cleanup = () => {
    if (closed) return;
    closed = true;
    clearInterval(ping);
    room.clients.delete(client);
    broadcastPresence(room);
  };
  req.on('close', cleanup);
  req.on('error', cleanup);
  res.on('close', cleanup);
  res.on('error', cleanup);
}

/* ---------- API ---------- */

async function handleApi(req, res, url) {
  const p = url.pathname;

  /* 官方魔典（/gs/）会用 POST 拉角色表；这里用本地缓存顶掉，断网也能用 */
  if (p === '/ct/grimoireRoleJson/') {
    if (req.method !== 'POST' && req.method !== 'GET') return json(res, 405, { error: 'method not allowed' });
    return fs.readFile(path.join(PUBLIC, 'ct-role-data.json'), (err, buf) => {
      if (err) return json(res, 500, { status: 500, reason: '角色表缺失' });
      res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
      res.end(buf);
    });
  }
  if (p === '/ct/grimoire_edition_list/') {
    return json(res, 200, { status: 200, cache_flag: 0, reason: '成功', data: { items: [], total: 0 } });
  }

  if (p === '/api/health') {
    return json(res, 200, {
      ok: true,
      time: Date.now(),
      port: server.address() ? server.address().port : null,
      httpsPort: httpsServer && httpsServer.address() ? httpsServer.address().port : null,
      ips: lanAddresses().map((i) => i.address),
      rooms: rooms.size
    });
  }

  if (p === '/api/rooms') {
    if (req.method === 'GET') {
      const list = Array.from(rooms.values())
        .map((room) => ({
          code: room.doc.code,
          players: room.doc.players.length,
          alive: room.doc.players.filter((x) => x.status === 'alive').length,
          updatedAt: room.doc.updatedAt,
          presence: presenceOf(room)
        }))
        .sort((a, b) => b.updatedAt - a.updatedAt);
      return json(res, 200, { rooms: list });
    }
    if (req.method === 'POST') {
      let code = '';
      try {
        const raw = await readBody(req);
        const body = raw ? JSON.parse(raw) : {};
        if (body && Model.isCode(String(body.code || '').toUpperCase())) code = String(body.code).toUpperCase();
      } catch (err) {
        /* 忽略非法 body，自动生成房间码 */
      }
      if (!code) {
        for (let i = 0; i < 40 && !code; i++) {
          const c = Model.makeCode();
          if (!rooms.has(c) && !fs.existsSync(roomFile(c))) code = c;
        }
      }
      if (!code) return json(res, 500, { error: '房间码生成失败' });
      const room = (await getRoom(code)) || newRoom(code);
      return json(res, 200, { code, doc: room.doc });
    }
    return json(res, 405, { error: 'method not allowed' });
  }

  const m = /^\/api\/room\/([A-Za-z0-9]{4})(\/stream|\/intent|\/phone|\/watch)?$/.exec(p);
  if (!m) return json(res, 404, { error: 'not found' });
  const code = m[1].toUpperCase();
  const sub = m[2] || '';

  if (sub === '/stream') {
    const room = await getRoom(code);
    if (!room) return json(res, 404, { error: '房间不存在' });
    return handleStream(req, res, room, url.searchParams.get('role'));
  }

  /* 连接官方线上房间（只读旁观），把房间状态映射到本地面板 */
  if (sub === '/watch') {
    if (req.method === 'DELETE') {
      stopWatch(code);
      return json(res, 200, { ok: true, watch: null });
    }
    if (req.method !== 'POST') return json(res, 405, { error: 'method not allowed' });
    const room = await getRoom(code);
    if (!room) return json(res, 404, { error: '房间不存在' });
    let body = {};
    try {
      body = JSON.parse(await readBody(req)) || {};
    } catch (err) {
      return json(res, 400, { error: 'JSON 解析失败' });
    }
    const name = Model.text(body.room, 20).replace(/[\\/]/g, '');
    if (!name) return json(res, 400, { error: '房间名不能为空' });
    const info = startWatch(code, name);
    return json(res, 200, { ok: true, watch: info });
  }

  /* 官方魔典的状态桥：整份玩家快照覆盖过来（按座位号复用原有 id，保留摆位） */
  if (sub === '/phone') {
    if (req.method !== 'POST') return json(res, 405, { error: 'method not allowed' });
    const room = await getRoom(code);
    if (!room) return json(res, 404, { error: '房间不存在' });
    let body = {};
    try {
      body = JSON.parse(await readBody(req)) || {};
    } catch (err) {
      return json(res, 400, { error: 'JSON 解析失败' });
    }
    if (watchers.has(code)) {
      return json(res, 200, { ok: true, skipped: 'watching', players: room.doc.players.length });
    }
    const list = Array.isArray(body.players) ? body.players.slice(0, 24) : [];
    const prev = new Map();
    room.doc.players.forEach((x) => prev.set(x.seat, x));
    const nextPlayers = list.map((raw, i) => {
      raw = raw && typeof raw === 'object' ? raw : {};
      const seat = Model.int(raw.seat, 1, 99, i + 1);
      const old = prev.get(seat);
      return {
        id: old ? old.id : Model.uid(),
        seat: seat,
        name: Model.text(raw.name, 24) || ('玩家' + seat),
        character: raw.character ? Model.text(raw.character, 32) : null,
        status: Model.STATUSES.indexOf(raw.status) >= 0 ? raw.status : 'alive'
      };
    });
    // 防止另一个浏览器打开空的官方魔典，把桌上已有的牌全冲掉
    if (nextPlayers.length === 0 && room.doc.players.length > 0 && !body.allowEmpty) {
      return json(res, 200, { ok: true, skipped: 'empty', players: room.doc.players.length });
    }
    const sig = (arr) => JSON.stringify(arr.map((x) => [x.seat, x.name, x.character, x.status]));
    if (sig(nextPlayers) !== sig(room.doc.players)) {
      room.doc.players = nextPlayers;
      room.doc.rev = (Number(room.doc.rev) || 0) + 1;
      room.doc.updatedAt = Date.now();
      Model.relayoutAuto(room.doc);
      scheduleSave(room);
      broadcast(room, 'state', payload(room));
    }
    return json(res, 200, { ok: true, players: room.doc.players.length });
  }

  if (sub === '/intent') {
    if (req.method !== 'POST') return json(res, 405, { error: 'method not allowed' });
    const room = await getRoom(code);
    if (!room) return json(res, 404, { error: '房间不存在' });
    let intent = null;
    try {
      intent = JSON.parse(await readBody(req));
    } catch (err) {
      return json(res, 400, { error: 'JSON 解析失败' });
    }
    Model.applyIntent(room.doc, intent);
    room.doc.rev = (Number(room.doc.rev) || 0) + 1;
    scheduleSave(room);
    broadcast(room, 'state', payload(room));
    const out = payload(room);
    out.id = intent && intent.__id ? String(intent.__id) : null;
    return json(res, 200, out);
  }

  if (req.method === 'DELETE') {
    stopWatch(code);
    const room = rooms.get(code);
    if (room) {
      clearTimeout(room.saveTimer);
      for (const c of room.clients) {
        try {
          c.res.end();
        } catch (err) {
          /* noop */
        }
      }
      rooms.delete(code);
    }
    try {
      await fsp.unlink(roomFile(code));
    } catch (err) {
      /* noop */
    }
    return json(res, 200, { ok: true });
  }

  const room = await getRoom(code);
  if (!room) return json(res, 404, { error: '房间不存在' });
  return json(res, 200, payload(room));
}

/* ---------- 静态文件 ---------- */

function serveStatic(req, res, pathname) {
  let rel = pathname;
  try {
    rel = decodeURIComponent(pathname);
  } catch (err) {
    /* 保留原样 */
  }
  if (rel === '/' || rel === '') rel = '/index.html';
  if (rel.endsWith('/')) rel += 'index.html';

  // 官方魔典放在 /gs/ 下，它内部用的是 /oss /img /static 这三个绝对路径，这里做个别名
  const alias = rel.match(/^\/(oss|img|static)\//);
  const file = path.resolve(PUBLIC, alias ? './gs' + rel : '.' + rel);
  if (file !== PUBLIC && !file.startsWith(PUBLIC + path.sep)) {
    return json(res, 403, { error: 'forbidden' });
  }
  fs.readFile(file, (err, buf) => {
    if (err && err.code === 'EISDIR') {
      return serveStatic(req, res, rel.replace(/\/?$/, '/') + 'index.html');
    }
    if (err) {
      res.writeHead(404, { 'Content-Type': 'text/html; charset=utf-8' });
      return res.end('<meta charset="utf-8"><title>404</title><body style="background:#0a090d;color:#d9b978;font:16px/1.8 system-ui;padding:60px">页面不存在。<a style="color:#f2dfae" href="/">回到首页</a></body>');
    }
    res.writeHead(200, {
      'Content-Type': MIME[path.extname(file).toLowerCase()] || 'application/octet-stream',
      'Content-Length': buf.length,
      'Cache-Control': 'no-cache'
    });
    if (req.method === 'HEAD') return res.end();
    res.end(buf);
  });
}

/* ---------- 启动 ---------- */

let httpsServer = null;

function onRequest(req, res) {
  let url;
  try {
    url = new URL(req.url, 'http://local');
  } catch (err) {
    return json(res, 400, { error: 'bad url' });
  }
  if (url.pathname.startsWith('/api/') || url.pathname.startsWith('/ct/')) {
    handleApi(req, res, url).catch((err) => {
      console.error('[api]', err);
      if (!res.headersSent) json(res, 500, { error: '服务器错误' });
      else res.end();
    });
    return;
  }
  if (req.method !== 'GET' && req.method !== 'HEAD') return json(res, 405, { error: 'method not allowed' });
  serveStatic(req, res, url.pathname);
}

const server = http.createServer(onRequest);

async function loadSavedRooms() {
  try {
    await fsp.mkdir(DATA, { recursive: true });
    const files = await fsp.readdir(DATA);
    for (const f of files) {
      if (!/^[A-Z0-9]{4}\.json$/.test(f)) continue;
      const code = f.slice(0, 4);
      const raw = JSON.parse(await fsp.readFile(path.join(DATA, f), 'utf8'));
      rooms.set(code, { doc: Model.ensureDoc(raw, code), clients: new Set(), saveTimer: null });
    }
  } catch (err) {
    console.warn('[boot] 读取历史房间失败：' + err.message);
  }
}

function banner(port) {
  const ips = lanAddresses();
  const line = '─'.repeat(52);
  const rows = [
    '',
    '  \x1b[38;5;179m血染钟楼 · 桌面助手\x1b[0m   GRIMOIRE & TOWN SQUARE',
    '  ' + line,
    '  本机      \x1b[4mhttp://localhost:' + port + '/\x1b[0m',
  ];
  if (httpsServer) {
    rows.push('  加密      \x1b[4mhttps://localhost:' + HTTPS_PORT + '/\x1b[0m   （自签名证书）');
  }
  if (ips.length) {
    ips.forEach((i, idx) => {
      const scheme = httpsServer ? 'https' : 'http';
      const p2 = httpsServer ? HTTPS_PORT : port;
      rows.push('  ' + (idx === 0 ? '局域网    ' : '          ') + '\x1b[4m' + scheme + '://' + i.address + ':' + p2 + '/\x1b[0m  (' + i.iface + ')');
    });
  } else {
    rows.push('  局域网    未检测到网卡地址，请确认已连 Wi-Fi');
  }
  rows.push('  ' + line);
  rows.push('  平板打开上面的地址 → 选「城镇广场」；手机打开同一地址 → 选「魔典」');
  rows.push('  已载入 ' + rooms.size + ' 个历史房间；Ctrl+C 结束');
  rows.push('');
  console.log(rows.join('\n'));
}

async function listen(port, attemptsLeft) {
  return new Promise((resolve, reject) => {
    const onError = (err) => {
      server.removeListener('listening', onListening);
      if (err.code === 'EADDRINUSE' && attemptsLeft > 0) {
        console.warn('  端口 ' + port + ' 被占用，尝试 ' + (port + 1) + ' …');
        resolve(listen(port + 1, attemptsLeft - 1));
      } else {
        reject(err);
      }
    };
    const onListening = () => {
      server.removeListener('error', onError);
      resolve(port);
    };
    server.once('error', onError);
    server.once('listening', onListening);
    server.listen(port, HOST);
  });
}

function listenTLS() {
  return new Promise((resolve) => {
    let tls;
    try {
      tls = {
        key: fs.readFileSync(path.join(ROOT, 'data', 'tls', 'key.pem')),
        cert: fs.readFileSync(path.join(ROOT, 'data', 'tls', 'cert.pem'))
      };
    } catch (err) {
      return resolve(null);
    }
    const srv = https.createServer(tls, onRequest);
    srv.once('error', (err) => {
      console.warn('  HTTPS 启动失败：' + err.message + '（继续用 http）');
      resolve(null);
    });
    srv.once('listening', () => {
      httpsServer = srv;
      resolve(srv);
    });
    srv.listen(HTTPS_PORT, HOST);
  });
}

(async () => {
  await loadSavedRooms();
  try {
    const port = await listen(START_PORT, 10);
    await listenTLS();
    banner(port);
  } catch (err) {
    console.error('启动失败：' + err.message);
    process.exit(1);
  }
})();

process.on('SIGINT', () => {
  for (const room of rooms.values()) {
    if (room.saveTimer) {
      clearTimeout(room.saveTimer);
      try {
        fs.writeFileSync(roomFile(room.doc.code), JSON.stringify(room.doc, null, 2));
      } catch (err) {
        /* noop */
      }
    }
  }
  console.log('\n  已退出。');
  process.exit(0);
});
