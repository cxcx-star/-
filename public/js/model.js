/* 共享数据模型：服务器与浏览器共用这一份。
   浏览器：window.Model / Node：module.exports */
(function (root, factory) {
  var api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.Model = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';

  var STATUSES = ['alive', 'deadVote', 'deadNone'];
  var STATUS_LABEL = { alive: '存活', deadVote: '已亡 · 带票', deadNone: '已亡 · 无票' };
  var STATUS_SHORT = { alive: '存活', deadVote: '带票', deadNone: '无票' };
  var PHASES = ['day', 'night'];
  var CODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  var DEFAULT_META = { script: 'tb', scriptName: '暗流涌动', phase: 'day', day: 1 };

  var seq = 0;

  function nowMs() { return Date.now(); }
  function r4(n) { return Math.round(n * 10000) / 10000; }
  function isCode(v) { return typeof v === 'string' && /^[A-Z0-9]{4}$/.test(v); }

  function makeCode() {
    var s = '';
    for (var i = 0; i < 4; i++) s += CODE_ALPHABET[Math.floor(Math.random() * CODE_ALPHABET.length)];
    return s;
  }

  function uid() {
    seq = (seq + 1) % 1296;
    return 'p' + nowMs().toString(36).slice(-4) + seq.toString(36) + Math.random().toString(36).slice(2, 5);
  }

  function num(v, lo, hi, dflt) {
    var n = Number(v);
    if (!isFinite(n)) return dflt;
    return Math.min(hi, Math.max(lo, n));
  }
  function int(v, lo, hi, dflt) { return Math.round(num(v, lo, hi, dflt)); }

  function text(v, max) {
    return String(v == null ? '' : v)
      .replace(/[\u0000-\u001f\u007f]/g, ' ')
      .replace(/\s+/g, ' ')
      .trim()
      .slice(0, max || 24);
  }

  function newDoc(code) {
    return {
      code: isCode(code) ? code : makeCode(),
      rev: 0,
      updatedAt: nowMs(),
      meta: Object.assign({}, DEFAULT_META),
      players: [],
      layout: {}
    };
  }

  /* 圆周上的第 i 个位置（服务端兜底用，比例按 1.55 的板宽估算）。
     浏览器会用真实画布比例再算一次。 */
  function ringSlot(i, n) {
    if (n <= 1) return { x: 0.5, y: 0.52 };
    var t = -Math.PI / 2 + (i * Math.PI * 2) / n;
    return { x: r4(0.5 + 0.27 * Math.cos(t)), y: r4(0.52 + 0.335 * Math.sin(t)) };
  }

  /* 只重排「自动摆放」的牌位；手动拖过的（auto:false）保持不动。
     同时清理已不存在玩家的布局。 */
  function relayoutAuto(doc) {
    var list = doc.players.slice().sort(function (a, b) { return a.seat - b.seat; });
    var n = list.length;
    var live = {};
    list.forEach(function (p, i) {
      live[p.id] = true;
      var cur = doc.layout[p.id];
      if (!cur || cur.auto) {
        var pos = ringSlot(i, n);
        doc.layout[p.id] = { x: pos.x, y: pos.y, auto: true };
      }
    });
    Object.keys(doc.layout).forEach(function (id) {
      if (!live[id]) delete doc.layout[id];
    });
  }

  function ensureDoc(raw, fallbackCode) {
    raw = raw && typeof raw === 'object' ? raw : {};
    var rawMeta = raw.meta && typeof raw.meta === 'object' ? raw.meta : {};
    var doc = {
      code: isCode(raw.code) ? raw.code : (isCode(fallbackCode) ? fallbackCode : makeCode()),
      rev: Math.max(0, Math.floor(Number(raw.rev) || 0)),
      updatedAt: Number(raw.updatedAt) || nowMs(),
      meta: {
        script: text(rawMeta.script, 8) || 'tb',
        scriptName: text(rawMeta.scriptName, 20) || '暗流涌动',
        phase: PHASES.indexOf(rawMeta.phase) >= 0 ? rawMeta.phase : 'day',
        day: int(rawMeta.day, 1, 99, 1)
      },
      players: [],
      layout: {}
    };

    var seen = {};
    var rawPlayers = Array.isArray(raw.players) ? raw.players : [];
    rawPlayers.forEach(function (p, i) {
      if (!p || typeof p !== 'object') return;
      var id = text(p.id, 40) || uid();
      if (seen[id]) id = uid();
      seen[id] = true;
      doc.players.push({
        id: id,
        seat: int(p.seat, 1, 99, i + 1),
        name: text(p.name, 24) || ('玩家' + (i + 1)),
        character: typeof p.character === 'string' && p.character ? text(p.character, 32) : null,
        status: STATUSES.indexOf(p.status) >= 0 ? p.status : 'alive'
      });
    });
    doc.players.sort(function (a, b) { return a.seat - b.seat || (a.id < b.id ? -1 : 1); });

    var rawLayout = raw.layout && typeof raw.layout === 'object' ? raw.layout : {};
    doc.players.forEach(function (p) {
      var l = rawLayout[p.id];
      if (l && typeof l === 'object' && isFinite(Number(l.x)) && isFinite(Number(l.y))) {
        doc.layout[p.id] = {
          x: r4(num(l.x, 0, 1, 0.5)),
          y: r4(num(l.y, 0, 1, 0.5)),
          auto: l.auto !== false
        };
      }
    });
    relayoutAuto(doc);
    return doc;
  }

  var INTENTS = ['seed', 'add', 'remove', 'rename', 'status', 'character', 'move', 'layout', 'meta', 'reset'];

  /* 所有写入都走这里：服务器应用后广播；手机端本地先应用一次做乐观更新。 */
  function applyIntent(doc, intent) {
    if (!doc || !intent || typeof intent !== 'object') return doc;
    var type = String(intent.type || '');
    if (INTENTS.indexOf(type) < 0) return doc;

    if (type === 'seed') {
      var n = int(intent.count, 1, 20, 5);
      var fresh = [];
      for (var i = 1; i <= n; i++) {
        fresh.push({ id: uid(), seat: i, name: '玩家' + i, character: null, status: 'alive' });
      }
      doc.players = fresh;
      doc.layout = {};
      relayoutAuto(doc);
    } else if (type === 'add') {
      var maxSeat = 0;
      doc.players.forEach(function (p) { maxSeat = Math.max(maxSeat, p.seat); });
      var seat = Math.min(99, maxSeat + 1);
      doc.players.push({
        id: uid(),
        seat: seat,
        name: text(intent.name, 24) || ('玩家' + seat),
        character: null,
        status: 'alive'
      });
      relayoutAuto(doc);
    } else if (type === 'remove') {
      doc.players = doc.players.filter(function (p) { return p.id !== intent.id; });
      delete doc.layout[intent.id];
      relayoutAuto(doc);
    } else if (type === 'rename') {
      var rp = find(doc, intent.id);
      if (rp) rp.name = text(intent.name, 24) || rp.name;
    } else if (type === 'status') {
      var sp = find(doc, intent.id);
      if (sp && STATUSES.indexOf(intent.status) >= 0) sp.status = intent.status;
    } else if (type === 'character') {
      var cp = find(doc, intent.id);
      if (cp) cp.character = intent.character ? text(intent.character, 32) : null;
    } else if (type === 'move') {
      var mp = find(doc, intent.id);
      if (mp) doc.layout[mp.id] = { x: r4(num(intent.x, 0, 1, 0.5)), y: r4(num(intent.y, 0, 1, 0.5)), auto: false };
    } else if (type === 'layout') {
      var positions = intent.positions && typeof intent.positions === 'object' ? intent.positions : {};
      doc.players.forEach(function (p) {
        var l = positions[p.id];
        if (!l || typeof l !== 'object') return;
        if (!isFinite(Number(l.x)) || !isFinite(Number(l.y))) return;
        doc.layout[p.id] = {
          x: r4(num(l.x, 0, 1, 0.5)),
          y: r4(num(l.y, 0, 1, 0.5)),
          auto: l.auto !== false
        };
      });
    } else if (type === 'meta') {
      if (intent.phase && PHASES.indexOf(intent.phase) >= 0) doc.meta.phase = intent.phase;
      if (intent.day != null) doc.meta.day = int(intent.day, 1, 99, doc.meta.day);
      if (intent.scriptName != null) doc.meta.scriptName = text(intent.scriptName, 20) || doc.meta.scriptName;
    } else if (type === 'reset') {
      doc.players = [];
      doc.layout = {};
      doc.meta = Object.assign({}, DEFAULT_META, { scriptName: doc.meta.scriptName });
    }

    doc.updatedAt = nowMs();
    return doc;
  }

  function find(doc, id) {
    for (var i = 0; i < doc.players.length; i++) if (doc.players[i].id === id) return doc.players[i];
    return null;
  }

  function counts(doc) {
    var out = { alive: 0, deadVote: 0, deadNone: 0, total: 0 };
    (doc.players || []).forEach(function (p) {
      out.total++;
      if (out[p.status] != null) out[p.status]++;
    });
    return out;
  }

  return {
    STATUSES: STATUSES,
    STATUS_LABEL: STATUS_LABEL,
    STATUS_SHORT: STATUS_SHORT,
    PHASES: PHASES,
    DEFAULT_META: DEFAULT_META,
    isCode: isCode,
    makeCode: makeCode,
    uid: uid,
    newDoc: newDoc,
    ensureDoc: ensureDoc,
    applyIntent: applyIntent,
    relayoutAuto: relayoutAuto,
    ringSlot: ringSlot,
    counts: counts,
    text: text,
    num: num,
    int: int
  };
});
