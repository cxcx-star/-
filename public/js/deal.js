/* 下发身份：一人一牌，传递手机领取
   座位与角色来自房间（魔典会把「已分配角色」同步进来）；角色说明取自本地角色表。 */
(function () {
  'use strict';

  var $ = function (s) { return document.querySelector(s); };

  var q = new URLSearchParams(location.search);
  var code = String(q.get('room') || '').toUpperCase();
  var embedded = (function () { try { return window.self !== window.top; } catch (e) { return true; } })();

  var TEAM = { townsfolk: '镇民', outsider: '外来者', minion: '爪牙', demon: '恶魔', traveler: '旅行者', fabled: '传奇' };

  var onlyRoles = (q.get('roles') || '').split(',').map(function (x) { return x.trim(); }).filter(Boolean);
  var onlyEdition = (q.get('edition') || '').toLowerCase();
  var scriptName = q.get('name') || '';

  var rolesById = {};   // id -> {name, team, ability, image}
  var scriptPool = [];  // 当前剧本的角色（随机模式用这个池）
  var players = [];     // [{seat, name, character}]
  var queue = [];       // 领取顺序（座位数组）
  var pool = [];        // 待领的角色（[{id,name,team,ability,image}]）
  var picked = {};      // seat -> role
  var idx = 0;          // 当前队列位置
  var mode = 'assigned';
  var order = 'asc';

  function toast(msg) {
    var t = $('#toast');
    t.textContent = msg;
    t.classList.add('show');
    clearTimeout(t._t);
    t._t = setTimeout(function () { t.classList.remove('show'); }, 1800);
  }

  function show(id) {
    ['scSetup', 'scPick', 'scReveal', 'scPass', 'scDone'].forEach(function (x) {
      $('#' + x).hidden = (x !== id);
    });
  }

  /* ---------- 数据 ---------- */
  function loadRoles() {
    return fetch('/ct-role-data.json', { cache: 'force-cache' })
      .then(function (r) { return r.json(); })
      .then(function (d) {
        var list = (d && d.data && d.data.role) || [];
        list.forEach(function (r) {
          rolesById[r.id] = {
            id: r.id,
            name: r.name,
            team: r.team || '',
            edition: r.edition || '',
            ability: r.ability || '',
            image: String(r.image || '').replace(/^\/oss\//, '/gs/oss/')
          };
        });
        buildScriptPool();
      })
      .catch(function () { rolesById = {}; });
  }

  function buildScriptPool() {
    if (onlyRoles.length) {
      scriptPool = onlyRoles.map(function (id) { return rolesById[id]; }).filter(Boolean);
    } else if (onlyEdition) {
      scriptPool = Object.keys(rolesById).map(function (k) { return rolesById[k]; })
        .filter(function (r) { return r.edition === onlyEdition; });
    }
    if (!scriptPool.length) scriptPool = Object.keys(rolesById).map(function (k) { return rolesById[k]; });
  }

  function loadRoom() {
    if (!/^[A-Z0-9]{4}$/.test(code)) return Promise.resolve([]);
    return fetch('/api/room/' + code, { cache: 'no-store' })
      .then(function (r) { return r.json(); })
      .then(function (d) {
        var list = (d && d.doc && d.doc.players) || [];
        return list.map(function (p) {
          return { seat: p.seat, name: p.name || ('玩家' + p.seat), character: p.character || null };
        }).sort(function (a, b) { return a.seat - b.seat; });
      })
      .catch(function () { return []; });
  }

  /* ---------- 设置 ---------- */
  function bindSeg(sel, key, onChange) {
    var box = $(sel);
    Array.prototype.forEach.call(box.querySelectorAll('button'), function (b) {
      b.addEventListener('click', function () {
        Array.prototype.forEach.call(box.querySelectorAll('button'), function (x) { x.classList.remove('on'); });
        b.classList.add('on');
        onChange(b.dataset.v);
      });
    });
  }

  function renderSetup() {
    var box = $('#segMode');
    Array.prototype.forEach.call(box.querySelectorAll('button'), function (b) {
      b.classList.toggle('on', b.dataset.v === mode);
    });
    var box2 = $('#segOrder');
    Array.prototype.forEach.call(box2.querySelectorAll('button'), function (b) {
      b.classList.toggle('on', b.dataset.v === order);
    });

    $('#castLine').textContent = (scriptName ? scriptName + ' · ' : '') + (players.length
      ? ('共 ' + players.length + ' 人 · ' + players.map(function (p) { return p.seat + '号'; }).join(' '))
      : '这个房间还没有座位');

    var missing = players.filter(function (p) { return !p.character; }).length;
    if (mode === 'assigned') {
      $('#modeHint').textContent = missing
        ? ('有 ' + missing + ' 个座位还没分配角色，这些位置会从剩余角色里随机补')
        : '按魔典里已经分配好的角色下发';
    } else {
      $('#modeHint').textContent = '把已分配的角色打乱后随机下发';
    }
    $('#btnStart').disabled = players.length === 0;
    $('#btnStart').textContent = players.length ? ('开始下发 · ' + players.length + ' 人') : '开始下发';
  }

  /* ---------- 开始 ---------- */
  function startDeal() {
    var assigned = players.filter(function (p) { return p.character && rolesById[p.character]; })
      .map(function (p) { return rolesById[p.character]; });

    if (mode === 'assigned' && !assigned.length) {
      mode = 'random';
      renderSetup();
      toast('魔典里还没有分配角色，已改用随机下发');
    }

    if (mode === 'random' || assigned.length < players.length) {
      // 以已分配角色为底，不足的部分从当前剧本里随机补
      var base = assigned.slice();
      var extra = scriptPool.filter(function (r) {
        return !base.some(function (x) { return x.id === r.id; });
      });
      if (!extra.length) extra = scriptPool.slice();
      while (base.length < players.length && extra.length) {
        base.push(extra.splice(Math.floor(Math.random() * extra.length), 1)[0]);
      }
      while (base.length < players.length) base.push(base[Math.floor(Math.random() * base.length)]);
      pool = shuffle(base).slice(0, players.length);
    } else {
      pool = shuffle(assigned);
    }

    queue = players.slice();
    if (order === 'desc') queue.reverse();
    if (order === 'shuffle') queue = shuffle(queue);

    picked = {};
    idx = 0;
    nextTurn(true);
  }

  function shuffle(a) {
    var r = a.slice();
    for (var i = r.length - 1; i > 0; i--) {
      var j = Math.floor(Math.random() * (i + 1));
      var t = r[i]; r[i] = r[j]; r[j] = t;
    }
    return r;
  }

  /* ---------- 流程 ---------- */
  function nextTurn(first) {
    if (idx >= queue.length) { showDone(); return; }
    var p = queue[idx];
    if (first) { renderPick(p); return; }
    // 交接屏
    $('#passNum').textContent = p.seat;
    $('#passName').textContent = p.seat + ' 号' + (p.name && p.name !== '玩家' + p.seat ? ' · ' + p.name : '');
    $('#btnClaim').textContent = '我是 ' + p.seat + ' 号，开始领取';
    show('scPass');
  }

  function renderPick(p) {
    $('#pickTitle').textContent = p.seat + ' 号，请选择一张牌堆';
    $('#pickLeft').textContent = '剩余 ' + pool.length + ' 张';
    var deck = $('#deck');
    deck.innerHTML = '';
    pool.forEach(function (role, i) {
      var b = document.createElement('button');
      b.type = 'button';
      b.className = 'card';
      b.textContent = '染';
      b.addEventListener('click', function () {
        b.classList.add('picked');
        setTimeout(function () { reveal(p, role, i); }, 160);
      });
      deck.appendChild(b);
    });
    show('scPick');
  }

  function reveal(p, role, i) {
    pool.splice(i, 1);
    picked[p.seat] = role;

    $('#revealTitle').textContent = p.seat + ' 号，你的身份是';
    $('#roleImg').src = role.image || '';
    $('#roleImg').style.display = role.image ? '' : 'none';
    $('#roleName').textContent = role.name || '—';
    $('#roleTeam').textContent = TEAM[role.team] || '';
    $('#roleAbility').textContent = role.ability || '（这个角色没有填写能力说明）';

    var last = idx >= queue.length - 1;
    $('#btnNext').textContent = last ? '记住了，交给说书人' : '记住了，将设备交给下一位';
    if (navigator.vibrate) { try { navigator.vibrate(18); } catch (e) {} }
    show('scReveal');
  }

  function showDone() {
    var n = Object.keys(picked).length;
    $('#doneSub').textContent = '共下发 ' + n + ' 人，把手机还给说书人';
    show('scDone');
  }

  /* ---------- 完成 ---------- */
  function finish() {
    if (embedded) {
      try { window.parent.postMessage('deal-close', '*'); } catch (e) { /* noop */ }
      return;
    }
    if (history.length > 1) history.back();
    else location.href = '/';
  }

  /* ---------- 事件 ---------- */
  bindSeg('#segMode', 'mode', function (v) { mode = v; renderSetup(); });
  bindSeg('#segOrder', 'order', function (v) { order = v; renderSetup(); });

  $('#btnStart').addEventListener('click', startDeal);
  $('#btnClaim').addEventListener('click', function () { renderPick(queue[idx]); });
  $('#btnNext').addEventListener('click', function () {
    idx++;
    if (idx >= queue.length) { showDone(); return; }
    nextTurn(false);
  });
  $('#btnFinish').addEventListener('click', finish);

  /* 内嵌在魔典浮层里时，右上角给个关闭 */
  if (embedded) {
    var c = document.createElement('button');
    c.type = 'button';
    c.className = 'x-close';
    c.textContent = '关闭';
    c.addEventListener('click', function () {
      try { window.parent.postMessage('deal-close', '*'); } catch (e) { /* noop */ }
    });
    document.body.appendChild(c);
  }

  /* ---------- 启动 ---------- */
  Promise.all([loadRoles(), loadRoom()]).then(function (res) {
    players = res[1] || [];
    renderSetup();
    show('scSetup');
  });
})();
