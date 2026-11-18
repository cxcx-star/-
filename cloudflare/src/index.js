/* 血染钟楼 · Cloudflare Worker 后端
   静态资源由 Workers Assets 直接提供，/api/* 与 /ct/* 走这里。
   每个房间一个 Durable Object：状态持久化 + SSE 长连接广播。
   （本文件里的 model.js 是 Node 版同一份，UMD 载入后挂在 globalThis.Model） */

import * as modelNs from '../../public/js/model.js';

/* model.js 是 UMD：在 Workers 的打包里会走 CJS 分支（module.exports = api），
   也可能走 ESM 副作用（globalThis.Model）。两种都兜住 ——
   漏掉的话 Model 会是 undefined，建房间时直接 1101。 */
const Model =
  modelNs && modelNs.newDoc ? modelNs :
  modelNs && modelNs.default && modelNs.default.newDoc ? modelNs.default :
  globalThis && globalThis.Model;

if (!Model || !Model.newDoc) throw new Error('model.js 未能载入');

/* 闲置房间 TTL：一小时没有操作就清除 */
const ROOM_TTL = 60 * 60 * 1000;

const JSON_HEADERS = {
  'Content-Type': 'application/json; charset=utf-8',
  'Cache-Control': 'no-store',
  'Access-Control-Allow-Origin': '*',
};

function json(body, status) {
  return new Response(JSON.stringify(body), { status: status || 200, headers: JSON_HEADERS });
}

function text(body, status, type) {
  return new Response(body, {
    status: status || 200,
    headers: { 'Content-Type': type || 'text/plain; charset=utf-8', 'Cache-Control': 'no-store' },
  });
}

/* ================= 房间列表（单例 DO） ================= */

export class IndexDO {
  constructor(state) {
    this.state = state;
  }

  async read() {
    if (!this.rooms) this.rooms = (await this.state.storage.get('rooms')) || {};
    return this.rooms;
  }

  async fetch(req) {
    const url = new URL(req.url);
    const rooms = await this.read();

    if (url.pathname === '/list') {
      const list = Object.keys(rooms)
        .map((code) => rooms[code])
        .sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0))
        .slice(0, 50);
      return json({ rooms: list });
    }

    if (url.pathname === '/put') {
      const b = await req.json();
      rooms[b.code] = {
        code: b.code,
        players: b.players || 0,
        alive: b.alive || 0,
        updatedAt: b.updatedAt || Date.now(),
        presence: b.presence || { total: 0, grimoire: 0, square: 0 },
      };
      await this.state.storage.put('rooms', rooms);
      return json({ ok: true });
    }

    if (url.pathname === '/del') {
      delete rooms[url.searchParams.get('code')];
      await this.state.storage.put('rooms', rooms);
      return json({ ok: true });
    }

    if (url.pathname === '/has') {
      return json({ has: !!rooms[url.searchParams.get('code')] });
    }

    return json({ error: 'not found' }, 404);
  }
}

/* ================= 房间（每房一个 DO） ================= */

export class RoomDO {
  constructor(state, env) {
    this.state = state;
    this.env = env;
    this.sse = new Set(); // { writer, enc, role }
    this.doc = null;
  }

  async load(code) {
    if (this.doc) return this.doc;
    let saved = null;
    try {
      saved = await this.state.storage.get('doc');
    } catch (e) {
      saved = null;
    }
    this.doc = saved ? Model.ensureDoc(saved, code) : Model.newDoc(code);
    return this.doc;
  }

  presence() {
    const out = { total: 0, grimoire: 0, square: 0 };
    this.sse.forEach((c) => {
      out.total++;
      if (c.role === 'square') out.square++;
      else out.grimoire++;
    });
    let sockets = [];
    try {
      sockets = this.state.getWebSockets() || [];
    } catch (e) {
      sockets = [];
    }
    for (const ws of sockets) {
      let role = 'grimoire';
      try {
        const a = ws.deserializeAttachment();
        if (a && a.role) role = a.role;
      } catch (e) {
        /* 休眠后取不到就按魔典算 */
      }
      out.total++;
      if (role === 'square') out.square++;
      else out.grimoire++;
    }
    return out;
  }

  payload() {
    return { doc: this.doc, rev: this.doc.rev, presence: this.presence(), watch: null };
  }

  /* ---- 推送 ---- */

  send(client, event, data) {
    const line = 'event: ' + event + '\ndata: ' + JSON.stringify(data) + '\n\n';
    return client.writer.write(client.enc.encode(line));
  }

  broadcast(event, data) {
    for (const c of Array.from(this.sse)) {
      this.send(c, event, data).catch(() => this.sse.delete(c));
    }
    const msg = JSON.stringify({ e: event, d: data });
    let sockets = [];
    try {
      sockets = this.state.getWebSockets() || [];
    } catch (e) {
      sockets = [];
    }
    for (const ws of sockets) {
      try {
        ws.send(msg);
      } catch (e) {
        /* 已经断了，等 close 回调清理 */
      }
    }
  }

  broadcastPresence() {
    this.broadcast('presence', this.presence());
  }

  /* ---- WebSocket（DO 休眠连接，最稳的一条路） ---- */

  handleWs(url) {
    const role = url.searchParams.get('role') === 'square' ? 'square' : 'grimoire';
    const pair = new WebSocketPair();
    const client = pair[0];
    const server = pair[1];
    this.state.acceptWebSocket(server);
    try {
      server.serializeAttachment({ role });
    } catch (e) {
      /* noop */
    }
    try {
      server.send(JSON.stringify({ e: 'state', d: this.payload() }));
    } catch (e) {
      /* noop */
    }
    this.broadcastPresence();
    return new Response(null, { status: 101, webSocket: client });
  }

  async webSocketMessage(ws, message) {
    let m = null;
    try {
      m = JSON.parse(typeof message === 'string' ? message : new TextDecoder().decode(message));
    } catch (e) {
      return;
    }
    if (m && m.t === 'ping') {
      try {
        ws.send(JSON.stringify({ e: 'ping', d: Date.now() }));
      } catch (e) {
        /* noop */
      }
    }
  }

  async webSocketClose(ws) {
    try {
      ws.close();
    } catch (e) {
      /* noop */
    }
    this.broadcastPresence();
  }

  async webSocketError(ws) {
    this.broadcastPresence();
  }

  /* ---- 状态变更 ---- */

  async commit() {
    this.doc.updatedAt = Date.now();
    await this.state.storage.put('doc', this.doc);
    const p = this.payload();
    this.broadcast('state', p);
    this.touchIndex();
    return p;
  }

  touchIndex() {
    const doc = this.doc;
    const body = {
      code: doc.code,
      players: doc.players.length,
      alive: doc.players.filter((x) => x.status === 'alive').length,
      updatedAt: doc.updatedAt,
      presence: this.presence(),
    };
    const id = this.env.INDEX.idFromName('index');
    this.env.INDEX.get(id)
      .fetch('https://do/put', { method: 'POST', body: JSON.stringify(body) })
      .catch(() => {});
  }

  async fetch(req) {
    const url = new URL(req.url);
    let code = (url.searchParams.get('code') || '').toUpperCase();
    let path = url.pathname;

    /* WebSocket 升级请求要原样转发（Upgrade 头不能重建），所以这里也认原始路径 */
    const mApi = /^\/api\/room\/([A-Za-z0-9]{4})\/(ws|stream|intent|phone)$/.exec(path);
    if (mApi) {
      code = mApi[1].toUpperCase();
      path = '/r/' + mApi[2];
    }

    await this.load(code);

    if (path === '/r/ws') return this.handleWs(url);

    /* --- SSE 订阅 --- */
    if (path === '/r/stream') {
      const role = url.searchParams.get('role') === 'square' ? 'square' : 'grimoire';
      const { readable, writable } = new TransformStream();
      const client = { writer: writable.getWriter(), enc: new TextEncoder(), role };
      this.sse.add(client);

      this.send(client, 'state', this.payload()).catch(() => {});
      this.broadcastPresence();

      // 心跳：20 秒一次，顺便探活（写失败说明对端已断开）
      const timer = setInterval(() => {
        client.writer.write(client.enc.encode(': ping ' + Date.now() + '\n\n')).catch(() => {
          clearInterval(timer);
          this.sse.delete(client);
          this.broadcastPresence();
        });
      }, 20000);

      return new Response(readable, {
        headers: {
          'Content-Type': 'text/event-stream; charset=utf-8',
          'Cache-Control': 'no-cache, no-transform',
          Connection: 'keep-alive',
          'X-Accel-Buffering': 'no',
          'Access-Control-Allow-Origin': '*',
        },
      });
    }

    /* --- 官方魔典状态桥 --- */
    if (path === '/r/phone' && req.method === 'POST') {
      let body = {};
      try {
        body = (await req.json()) || {};
      } catch (e) {
        return json({ error: 'JSON 解析失败' }, 400);
      }
      const list = Array.isArray(body.players) ? body.players.slice(0, 24) : [];
      const prev = new Map();
      this.doc.players.forEach((x) => prev.set(x.seat, x));
      const next = list.map((raw, i) => {
        raw = raw && typeof raw === 'object' ? raw : {};
        const seat = Model.int(raw.seat, 1, 99, i + 1);
        const old = prev.get(seat);
        return {
          id: old ? old.id : Model.uid(),
          seat,
          name: Model.text(raw.name, 24) || '玩家' + seat,
          character: raw.character ? Model.text(raw.character, 32) : null,
          status: Model.STATUSES.indexOf(raw.status) >= 0 ? raw.status : 'alive',
          traveller: old ? !!old.traveller : false,
        };
      });
      if (next.length === 0 && this.doc.players.length > 0 && !body.allowEmpty) {
        return json({ ok: true, skipped: 'empty', players: this.doc.players.length });
      }
      const sig = (arr) => JSON.stringify(arr.map((x) => [x.seat, x.name, x.character, x.status]));
      if (sig(next) !== sig(this.doc.players)) {
        this.doc.players = next;
        this.doc.rev = (Number(this.doc.rev) || 0) + 1;
        Model.relayoutAuto(this.doc);
        await this.commit();
      }
      const scriptName = typeof body.scriptName === 'string' ? Model.text(body.scriptName, 20) : '';
      if (scriptName && scriptName !== this.doc.meta.scriptName) {
        this.doc.meta.scriptName = scriptName;
        this.doc.rev = (Number(this.doc.rev) || 0) + 1;
        await this.commit();
      }
      return json({ ok: true, players: this.doc.players.length });
    }

    /* --- 意图 --- */
    if (path === '/r/intent' && req.method === 'POST') {
      let intent = null;
      try {
        intent = await req.json();
      } catch (e) {
        return json({ error: 'JSON 解析失败' }, 400);
      }
      Model.applyIntent(this.doc, intent);
      this.doc.rev = (Number(this.doc.rev) || 0) + 1;
      const out = await this.commit();
      out.id = intent && intent.__id ? String(intent.__id) : null;
      return json(out);
    }

    if (path === '/r' && req.method === 'DELETE') {
      await this.state.storage.deleteAll();
      this.doc = Model.newDoc(code);
      const id = this.env.INDEX.idFromName('index');
      this.env.INDEX.get(id).fetch('https://do/del?code=' + code).catch(() => {});
      return json({ ok: true });
    }

    if (path === '/r/reset') {
      return json(this.payload());
    }

    return json(this.payload());
  }
}

/* ================= HTTP 路由 ================= */

async function indexFetch(env, path, init) {
  const id = env.INDEX.idFromName('index');
  return env.INDEX.get(id).fetch('https://do' + path, init);
}

function roomStub(env, code) {
  return env.ROOM.get(env.ROOM.idFromName(code));
}

export default {
  async fetch(req, env) {
    try {
      return await route(req, env);
    } catch (err) {
      /* 把异常暴露成 JSON，方便在没有 wrangler tail 的情况下远程定位 */
      return json(
        {
          error: String((err && err.message) || err),
          stack: String((err && err.stack) || '').slice(0, 900),
        },
        500
      );
    }
  },
};

async function route(req, env) {
    const url = new URL(req.url);
    const p = url.pathname;

    /* 官方魔典的角色表（本地缓存，POST/GET 都认） */
    if (p === '/ct/grimoireRoleJson/') {
      const asset = await env.ASSETS.fetch(new Request(new URL('/ct-role-data.json', url.origin)));
      return new Response(asset.body, {
        status: 200,
        headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' },
      });
    }
    if (p === '/ct/grimoire_edition_list/') {
      let body = {};
      try {
        body = (await req.json()) || {};
      } catch (e) {
        body = {};
      }
      const tab = Number(body.tab) === 2 ? 2 : 1;
      const asset = await env.ASSETS.fetch(new Request(new URL('/edition-list.json', url.origin)));
      let all = [];
      try {
        all = (await asset.json()).items || [];
      } catch (e) {
        all = [];
      }
      const items = all.filter((x) => (x.tabs || [x.tab || 1]).indexOf(tab) >= 0);
      return json({ status: 200, cache_flag: 0, reason: '成功', data: { items, total: items.length } });
    }

    if (p === '/api/health') {
      let rooms = 0;
      try {
        const r = await indexFetch(env, '/list');
        rooms = ((await r.json()).rooms || []).length;
      } catch (e) {
        rooms = 0;
      }
      return json({
        ok: true,
        cloud: true,
        time: Date.now(),
        port: url.port ? Number(url.port) : url.protocol === 'https:' ? 443 : 80,
        httpsPort: null,
        ips: [],
        rooms,
      });
    }

    if (p === '/api/rooms') {
      if (req.method === 'GET') {
        const r = await indexFetch(env, '/list');
        const data = await r.json();
        const now = Date.now();
        const fresh = [];
        for (const room of data.rooms || []) {
          if (now - (room.updatedAt || 0) > ROOM_TTL) {
            // 一个小时没人动过：清掉这个房间（异步，不阻塞返回）
            roomStub(env, room.code).fetch('https://do/r?code=' + room.code, { method: 'DELETE' }).catch(() => {});
          } else {
            fresh.push(room);
          }
        }
        return json({ rooms: fresh });
      }
      if (req.method === 'POST') {
        let code = '';
        try {
          const raw = await req.text();
          const body = raw ? JSON.parse(raw) : {};
          if (body && Model.isCode(String(body.code || '').toUpperCase())) {
            code = String(body.code).toUpperCase();
          }
        } catch (e) {
          /* 自动生成房间码 */
        }
        if (!code) {
          for (let i = 0; i < 40 && !code; i++) {
            const c = Model.makeCode();
            const r = await indexFetch(env, '/has?code=' + c);
            const has = (await r.json()).has;
            if (!has) code = c;
          }
        }
        if (!code) return json({ error: '房间码生成失败' }, 500);
        const stub = roomStub(env, code);
        const res = await stub.fetch('https://do/r/reset?code=' + code);
        const data = await res.json();
        return json({ code, doc: data.doc });
      }
      return json({ error: 'method not allowed' }, 405);
    }

    const m = /^\/api\/room\/([A-Za-z0-9]{4})(\/stream|\/ws|\/intent|\/phone|\/watch|\/delete)?$/.exec(p);
    if (m) {
      const code = m[1].toUpperCase();
      const sub = m[2] || '';
      if (sub === '/watch') {
        return json({ ok: false, error: '云端版不支持监听官方线上房间（仅局域网版可用）' }, 501);
      }
      if (sub === '/delete') {
        const stub = roomStub(env, code);
        return stub.fetch('https://do/r?code=' + code, { method: 'DELETE' });
      }
      const stub = roomStub(env, code);
      if (sub === '/ws') {
        /* 原样转发，保留 Upgrade / Sec-WebSocket-* 头 */
        return stub.fetch(req);
      }
      const target = 'https://do/r' + (sub || '') + '?code=' + code + (sub === '/stream' ? '&role=' + (url.searchParams.get('role') || 'grimoire') : '');
      const init = { method: req.method, headers: req.headers };
      if (req.method !== 'GET' && req.method !== 'HEAD') {
        const buf = await req.arrayBuffer();
        if (buf.byteLength) init.body = buf;
      }
      return stub.fetch(new Request(target, init));
    }

    if (p.startsWith('/api/')) return json({ error: 'not found' }, 404);

    /* 官方魔典内部用的是 /oss /img /static 三个绝对路径，映射到 /gs/ 下 */
    if (/^\/(oss|img|static)\//.test(p)) {
      const u2 = new URL(req.url);
      u2.pathname = '/gs' + p;
      return env.ASSETS.fetch(new Request(u2.toString(), { method: req.method, headers: req.headers }));
    }

    /* 其余全部交给静态资源（public/ 目录） */
    return env.ASSETS.fetch(req);
}
