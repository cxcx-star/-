/* 城镇广场：只显示公开信息的牌位；位置可拖动并保存在房间状态里 */
(function () {
  'use strict';

  var $ = function (s) { return document.querySelector(s); };

  var code = (location.hash || '').replace(/^#\/?/, '').toUpperCase();
  if (!/^[A-Z0-9]{4}$/.test(code)) {
    location.replace('/');
    return;
  }

  var box = $('#plates');
  var nodes = new Map();
  var doc = Model.newDoc(code);
  var presence = { grimoire: 0, square: 0, total: 0 };
  var watch = null;
  var locked = localStorage.getItem('ct.lock') === '1';
  var drag = null;
  var layoutTimer = null;
  var toastTimer = null;
  var baseUrl = '';
  var wakeLock = null;

  var toastEl = $('#toast');

  function toast(msg) {
    toastEl.textContent = msg;
    toastEl.classList.add('show');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(function () { toastEl.classList.remove('show'); }, 2400);
  }

  function applyPos(el, pos) {
    if (!el || !pos) return;
    el.style.left = (pos.x * 100).toFixed(3) + '%';
    el.style.top = (pos.y * 100).toFixed(3) + '%';
  }

  function buildPlate(p) {
    var el = document.createElement('div');
    el.className = 'plate';
    el.dataset.id = p.id;
    el.dataset.status = p.status;
    el.innerHTML =
      '<span class="coin"><b></b></span>' +
      '<span class="nm"></span>' +
      '<span class="stamp">已 亡</span>' +
      '<span class="token">票</span>';
    return el;
  }

  function updatePlate(el, p, animate) {
    var prev = el.dataset.status;
    var wasDead = prev === 'deadVote' || prev === 'deadNone';
    var isDead = p.status !== 'alive';

    el.dataset.status = p.status;
    el.classList.toggle('is-dead', isDead);
    el.querySelector('.nm').textContent = p.name;
    el.querySelector('.coin b').textContent = String(p.seat);

    if (animate && prev !== p.status) {
      el.classList.remove('flash', 'revive');
      void el.offsetWidth;
      if (!wasDead && isDead) el.classList.add('flash');
      else if (wasDead && !isDead) el.classList.add('revive');
      else if (isDead) el.classList.add('flash');
      setTimeout(function () { el.classList.remove('flash', 'revive'); }, 900);
    }
  }

  function render(next) {
    doc = next;
    document.body.dataset.phase = doc.meta.phase === 'night' ? 'night' : 'day';

    $('#scriptName').textContent = doc.meta.scriptName || '暗流涌动';
    $('#phaseLine').textContent = (doc.meta.phase === 'night' ? '夜晚' : '白天') + ' · 第 ' + doc.meta.day + ' 天';
    $('#codeChip').textContent = doc.code;

    var c = Model.counts(doc);
    $('#cAlive').textContent = c.alive;
    $('#cVote').textContent = c.deadVote;
    $('#cDead').textContent = c.deadNone;

    var seen = {};
    doc.players.forEach(function (p) {
      seen[p.id] = true;
      var el = nodes.get(p.id);
      if (!el) {
        el = buildPlate(p);
        nodes.set(p.id, el);
        box.appendChild(el);
        updatePlate(el, p, false);
      } else {
        updatePlate(el, p, true);
      }
      if (!drag || drag.id !== p.id) {
        applyPos(el, doc.layout[p.id] || { x: 0.5, y: 0.5 });
      }
    });

    Array.from(nodes.keys()).forEach(function (id) {
      if (seen[id]) return;
      var el = nodes.get(id);
      if (el && el.parentNode) el.parentNode.removeChild(el);
      nodes.delete(id);
    });

    $('#empty').hidden = doc.players.length > 0;
    sizeBoard();
    scheduleLayout(false);
  }

  /* ---------- 自动排列 ---------- */

  /* 圆环半径 & 名牌尺寸：
     先按「顶栏与底栏之间的可用区域」定圆心，再用周长算牌宽，
     最后收缩半径，保证最上/最下的牌不会压到顶栏和底栏。 */
  function geom() {
    var W = window.innerWidth;
    var H = window.innerHeight;
    var n = Math.max(1, doc.players.length);
    var topPad = H > 700 ? 92 : 74;
    var botPad = H > 700 ? 76 : 60;
    var availH = H - topPad - botPad;
    var availW = W - 40;
    var R = Math.min(availH, availW) * 0.475;
    var plateW = 198;
    for (var k = 0; k < 5; k++) {
      // 相邻两块牌的中心距是弦长，牌宽按弦长的 0.82 取，留出空隙给座位号/鬼票
      var chord = n <= 1 ? 400 : 2 * R * Math.sin(Math.PI / n);
      plateW = Math.max(76, Math.min(198, chord * 0.82));
      var plateH = plateW * 0.575;
      var maxR = Math.min(availH / 2 - plateH / 2 - 6, availW / 2 - plateW / 2 - 8);
      if (R <= maxR) break;
      R = Math.max(36, maxR);
    }
    return {
      W: W,
      H: H,
      R: R,
      plateW: plateW,
      cx: 0.5,
      cy: (topPad + availH / 2) / H
    };
  }

  function sizeBoard() {
    if (!doc.players.length) return geom();
    var g = geom();
    box.style.setProperty('--plate-w', g.plateW.toFixed(1) + 'px');
    var ring = $('#ring');
    ring.style.setProperty('--ring', (g.R * 2.16).toFixed(0) + 'px');
    ring.style.setProperty('--cy', (g.cy * 100).toFixed(2) + '%');
    return g;
  }

  function scheduleLayout(force) {
    clearTimeout(layoutTimer);
    layoutTimer = setTimeout(function () { ensureLayout(force); }, 300);
  }

  function ensureLayout(force) {
    if (drag) return;
    var players = doc.players;
    if (!players.length) return;

    var g = sizeBoard();
    var W = g.W;
    var H = g.H;
    var R = g.R;
    var n = players.length;

    var cx = g.cx;
    var cy = g.cy;
    var next = {};
    var changed = false;

    players.forEach(function (p, i) {
      var cur = doc.layout[p.id];
      if (cur && cur.auto === false && !force) {
        next[p.id] = { x: cur.x, y: cur.y, auto: false };
        return;
      }
      var t = n === 1 ? 0 : -Math.PI / 2 + (i * Math.PI * 2) / n;
      var pos = {
        x: Math.round((cx + (R * Math.cos(t)) / W) * 10000) / 10000,
        y: Math.round((cy + (R * Math.sin(t)) / H) * 10000) / 10000,
        auto: true
      };
      next[p.id] = pos;
      if (!cur || cur.auto === false || Math.abs(cur.x - pos.x) > 0.0025 || Math.abs(cur.y - pos.y) > 0.0025) {
        changed = true;
      }
    });

    if (!changed) return;
    players.forEach(function (p) {
      if (next[p.id]) applyPos(nodes.get(p.id), next[p.id]);
    });
    store.send({ type: 'layout', positions: next });
  }

  /* ---------- 拖动摆位 ---------- */

  box.addEventListener('pointerdown', function (e) {
    if (locked) return;
    var el = e.target.closest ? e.target.closest('.plate') : null;
    if (!el) return;
    e.preventDefault();
    var r = el.getBoundingClientRect();
    drag = {
      el: el,
      id: el.dataset.id,
      dx: e.clientX - (r.left + r.width / 2),
      dy: e.clientY - (r.top + r.height / 2),
      hw: r.width / 2,
      hh: r.height / 2,
      x: null,
      y: null,
      moved: false
    };
    try { el.setPointerCapture(e.pointerId); } catch (err) { /* noop */ }
    el.classList.add('dragging');
  });

  box.addEventListener('pointermove', function (e) {
    if (!drag) return;
    var W = window.innerWidth;
    var H = window.innerHeight;
    var x = (e.clientX - drag.dx) / W;
    var y = (e.clientY - drag.dy) / H;
    var mx = (drag.hw + 4) / W;
    var my = (drag.hh + 4) / H;
    x = Math.min(1 - mx, Math.max(mx, x));
    y = Math.min(1 - my, Math.max(my, y));
    drag.x = x;
    drag.y = y;
    drag.moved = true;
    applyPos(drag.el, { x: x, y: y });
  });

  function endDrag() {
    if (!drag) return;
    var d = drag;
    drag = null;
    d.el.classList.remove('dragging');
    if (d.moved && d.x != null) {
      store.send({ type: 'move', id: d.id, x: d.x, y: d.y });
    }
  }
  window.addEventListener('pointerup', endDrag);
  window.addEventListener('pointercancel', endDrag);
  window.addEventListener('blur', endDrag);
  window.addEventListener('resize', function () { scheduleLayout(false); });
  window.addEventListener('orientationchange', function () { setTimeout(function () { scheduleLayout(false); }, 260); });

  /* ---------- 顶栏 / 底栏 ---------- */

  function setSync(status) {
    var el = $('#sync');
    el.className = 'sync ' + (status === 'online' ? 'on' : status === 'offline' ? 'off' : '');
    $('#syncText').textContent = status === 'online' ? '已同步' : status === 'offline' ? '重连中' : '连接中';
  }

  function setPresence(p) {
    if (p && typeof p === 'object') presence = p;
    var hint = $('#joinHint');
    if (presence.grimoire > 0) {
      hint.className = 'join-hint on';
      hint.innerHTML = '';
      var dot = document.createElement('span');
      dot.style.color = 'var(--ok)';
      dot.textContent = '● ';
      hint.appendChild(dot);
      hint.appendChild(document.createTextNode('魔典已连接' + (presence.grimoire > 1 ? ' ×' + presence.grimoire : '') + ' · 手机上的改动会实时同步到这里'));
    } else {
      hint.className = 'join-hint';
      hint.innerHTML = '';
      hint.appendChild(document.createTextNode('手机打开 '));
      var b = document.createElement('b');
      b.textContent = baseUrl || '—';
      hint.appendChild(b);
      hint.appendChild(document.createTextNode(' 加入这局'));
    }
  }

  function setWatch(w) {
    watch = w || null;
    var chip = $('#watchChip');
    if (watch && watch.room) {
      chip.hidden = false;
      chip.classList.toggle('on', !!watch.connected);
      $('#watchName').textContent = watch.room;
      chip.title = watch.connected ? '官方房间已连接，主持人改动会实时同步' : '正在连接官方房间…';
    } else {
      chip.hidden = true;
    }
  }

  function startWatch(name, silent) {
    var u = new URL(location.href);
    u.searchParams.set('watch', name);
    history.replaceState(null, '', u);
    return fetch('/api/room/' + code + '/watch', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ room: name })
    }).then(function (res) {
      return res.json().then(function (d) {
        if (!res.ok) throw new Error(d.error || ('HTTP ' + res.status));
        setWatch(d.watch);
        if (!silent) toast('已连接官方房间：' + name);
        return d;
      });
    }).catch(function (err) {
      console.warn('[watch] 失败', err && err.message);
      if (!silent) toast('连接失败：' + err.message);
      var u2 = new URL(location.href);
      u2.searchParams.delete('watch');
      history.replaceState(null, '', u2);
    });
  }

  function syncLock() {
    document.body.dataset.locked = locked ? '1' : '0';
    var btn = $('#btnLock');
    btn.textContent = locked ? '解锁摆位' : '锁定摆位';
    btn.classList.toggle('on', !locked);
    try { localStorage.setItem('ct.lock', locked ? '1' : '0'); } catch (err) { /* noop */ }
  }

  $('#btnWatch').addEventListener('click', function () {
    var current = watch && watch.room ? watch.room : '';
    var name = window.prompt('官方魔典里「创建小镇」时填的房间名（最多 10 个字符）', current);
    if (name == null) return;
    name = String(name).trim();
    if (!name) return;
    startWatch(name, false);
  });

  $('#btnLock').addEventListener('click', function () {
    locked = !locked;
    syncLock();
    toast(locked ? '已锁定，名牌不会被碰歪' : '已解锁：拖动名牌即可调整位置');
  });

  $('#btnArrange').addEventListener('click', function () {
    if (locked) {
      locked = false;
      syncLock();
    }
    clearTimeout(layoutTimer);
    ensureLayout(true);
    toast('已按座位号围成一圈');
  });

  $('#btnFull').addEventListener('click', function () {
    var el = document.documentElement;
    if (document.fullscreenElement) {
      if (document.exitFullscreen) document.exitFullscreen().catch(function () {});
      return;
    }
    if (!el.requestFullscreen) {
      toast('这台设备不支持网页全屏，可以把页面「添加到主屏幕」');
      return;
    }
    el.requestFullscreen().catch(function () { toast('全屏被拒绝了，可以试试「添加到主屏幕」'); });
  });
  document.addEventListener('fullscreenchange', function () {
    $('#btnFull').textContent = document.fullscreenElement ? '退出全屏' : '全屏';
  });

  /* ---- 样式切换：羊皮纸 ⇄ 隐藏模式（官方魔典暗场）---- */
  var STYLE_KEY = 'ct.style';
  var style = 'paper';
  try { style = localStorage.getItem(STYLE_KEY) === 'veil' ? 'veil' : 'paper'; } catch (err) { /* noop */ }

  function applyStyle() {
    document.body.classList.toggle('theme-veil', style === 'veil');
    var btn = $('#btnStyle');
    if (btn) btn.textContent = style === 'veil' ? '样式：隐藏模式' : '样式：羊皮纸';
  }

  $('#btnStyle').addEventListener('click', function () {
    style = style === 'veil' ? 'paper' : 'veil';
    applyStyle();
    try { localStorage.setItem(STYLE_KEY, style); } catch (err) { /* noop */ }
    toast(style === 'veil' ? '隐藏模式：只留座位与姓名，适合摆在桌上' : '已切回羊皮纸样式');
  });

  applyStyle();

  function keepAwake() {
    if (!navigator.wakeLock || !navigator.wakeLock.request) return;
    navigator.wakeLock.request('screen').then(function (lock) {
      wakeLock = lock;
      lock.addEventListener('release', function () { wakeLock = null; });
    }).catch(function () { /* 非 HTTPS 或不允许，忽略 */ });
  }
  document.addEventListener('visibilitychange', function () {
    if (document.visibilityState === 'visible' && !wakeLock) keepAwake();
  });

  /* ---------- 启动 ---------- */

  var store = createStore(code, {
    role: 'square',
    onChange: render,
    onStatus: setSync,
    onPresence: setPresence,
    onWatch: setWatch,
    onError: function (err) {
      var msg = String((err && err.message) || '');
      if (msg.indexOf('房间不存在') >= 0) {
        $('#fatalCode').textContent = code;
        $('#fatal').hidden = false;
      } else {
        toast('同步失败：' + (msg || '检查是否还在同一网络'));
      }
    }
  });

  API.health().then(function (h) {
    var port = h.port || location.port;
    var ip = (h.ips && h.ips[0]) || location.hostname;
    baseUrl = h.httpsPort
      ? 'https://' + ip + ':' + h.httpsPort + '/'
      : 'http://' + ip + ':' + port + '/';
    if (location.protocol === 'https:') baseUrl = location.origin + '/';
    $('#emptyUrl').textContent = baseUrl;
    $('#joinUrl').textContent = baseUrl;
    setPresence(presence);
  }).catch(function () {
    baseUrl = location.origin + '/';
    $('#emptyUrl').textContent = baseUrl;
    $('#joinUrl').textContent = baseUrl;
  });

  syncLock();
  setSync('connecting');

  var watchParam = new URLSearchParams(location.search).get('watch');
  if (watchParam) startWatch(watchParam.trim(), true);
  keepAwake();
  store.start();

  if (!sessionStorage.getItem('ct.hint')) {
    sessionStorage.setItem('ct.hint', '1');
    setTimeout(function () { toast('拖动名牌可以调整位置 · 点右下角「锁定摆位」防误碰'); }, 1400);
  }
})();
