/* 魔典（手机）——钟楼夜色里的一圈杯子
   点杯子改名字 / 分配身份 / 标记存亡；所有改动实时同步到平板的城镇广场 */
(function () {
  'use strict';

  var $ = function (s) { return document.querySelector(s); };
  var $$ = function (s) { return Array.prototype.slice.call(document.querySelectorAll(s)); };

  var code = (location.hash || '').replace(/^#\/?/, '').toUpperCase();
  if (!/^[A-Z0-9]{4}$/.test(code)) {
    location.replace('/');
    return;
  }

  var doc = Model.newDoc(code);
  var presence = { grimoire: 0, square: 0, total: 0 };
  var ui = {
    openId: null,
    tab: 'all',
    q: '',
    seats: Number(localStorage.getItem('ct.seats')) || 8,
    hide: localStorage.getItem('ct.hide') === '1'
  };
  var nodes = new Map();
  var store = null;
  var toastEl = $('#toast');
  var toastTimer = null;

  function toast(msg) {
    toastEl.textContent = msg;
    toastEl.classList.add('show');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(function () { toastEl.classList.remove('show'); }, 2200);
  }

  function player(id) {
    var target = id || ui.openId;
    for (var i = 0; i < doc.players.length; i++) if (doc.players[i].id === target) return doc.players[i];
    return null;
  }

  function roleIcon(id) {
    if (!id || id.indexOf('custom:') === 0) return '';
    return '/assets/gt/roles/' + id + '.webp';
  }

  /* ---------- 圆环排布 ---------- */

  function geometry(n) {
    var W = window.innerWidth;
    var H = window.innerHeight;
    var cx = 0.5;
    var cy = 0.482;
    var rx = Math.min(W * 0.405, 176);
    var ry = Math.min(H * 0.335, 296);

    if (n <= 1) {
      return { W: W, H: H, cx: cx, cy: cy, rx: 0, ry: 0, size: Math.min(120, W * 0.3), tag: Math.min(150, W * 0.36), pos: [{ x: 50, y: cy * 100 }] };
    }

    // 相邻两杯的最小中心距：椭圆两端更近，用短半轴估
    var chord = 2 * Math.min(rx, ry) * Math.sin(Math.PI / n);
    var size = Math.max(44, Math.min(96, chord * 0.82));
    var tag = Math.max(54, Math.min(size * 1.62, chord * 0.99));

    // 别让最外侧的杯子（和鬼票）跑出屏幕，也别顶到顶栏/底栏
    var half = size / 2;
    var cyPx = cy * H;
    rx = Math.max(40, Math.min(rx, W / 2 - half - 8));
    ry = Math.max(40, Math.min(ry, cyPx - 66 - half, H - 62 - cyPx - half));

    var pos = [];
    for (var i = 0; i < n; i++) {
      var t = -Math.PI / 2 + (i * Math.PI * 2) / n;
      pos.push({
        x: 50 + (rx * Math.cos(t) * 100) / W,
        y: cy * 100 + (ry * Math.sin(t) * 100) / H
      });
    }
    return { W: W, H: H, cx: cx, cy: cy, rx: rx, ry: ry, size: size, tag: tag, pos: pos };
  }

  /* ---------- 杯子 ---------- */

  function createToken(id) {
    var li = document.createElement('li');
    li.className = 'seat';
    li.dataset.id = id;
    li.innerHTML =
      '<button class="tk" type="button">' +
      '<span class="tk-face">' +
      '<span class="tk-disc"></span>' +
      '<img class="tk-icon" alt="" hidden>' +
      '<span class="tk-shroud"></span>' +
      '</span>' +
      '<span class="tk-vote">票</span>' +
      '<span class="tk-tag"><b></b><span></span></span>' +
      '</button>';
    li.querySelector('.tk').addEventListener('click', function () { openSheet(id); });
    return li;
  }

  function updateToken(li, p, clip) {
    var prev = li.dataset.status;

    li.dataset.status = p.status;
    li.classList.toggle('no-char', !p.character);
    li.style.setProperty('--x', clip.x.toFixed(3) + '%');
    li.style.setProperty('--y', clip.y.toFixed(3) + '%');

    var icon = li.querySelector('.tk-icon');
    var src = roleIcon(p.character);
    if (src) {
      if (icon.getAttribute('src') !== src) icon.src = src;
      icon.hidden = false;
    } else {
      icon.hidden = true;
      icon.removeAttribute('src');
    }

    li.querySelector('.tk-tag b').textContent = p.seat;
    li.querySelector('.tk-tag span').textContent = p.name;
    li.querySelector('.tk').setAttribute(
      'aria-label',
      p.seat + ' 号 ' + p.name + '，' +
      (p.status === 'alive' ? '存活' : p.status === 'deadVote' ? '已亡，仍有票' : '已亡，无票') +
      (p.character ? '，' + (charInfo(p.character) || {}).cn : '')
    );

    if (prev && prev !== p.status) {
      li.classList.remove('flash');
      void li.offsetWidth;
      li.classList.add('flash');
      setTimeout(function () { li.classList.remove('flash'); }, 760);
    }
  }

  function renderRing() {
    var players = doc.players;
    var g = geometry(players.length);
    var ring = $('#ring');
    ring.style.setProperty('--s', g.size.toFixed(1) + 'px');
    ring.style.setProperty('--tag-w', g.tag.toFixed(1) + 'px');

    var seen = {};
    players.forEach(function (p, i) {
      seen[p.id] = true;
      var li = nodes.get(p.id);
      if (!li) {
        li = createToken(p.id);
        nodes.set(p.id, li);
        ring.appendChild(li);
        li.dataset.status = p.status;
      }
      updateToken(li, p, g.pos[i]);
    });

    Array.from(nodes.keys()).forEach(function (id) {
      if (seen[id]) return;
      var li = nodes.get(id);
      if (li && li.parentNode) li.parentNode.removeChild(li);
      nodes.delete(id);
    });

    $('#empty').hidden = players.length > 0;
    document.body.classList.toggle('is-empty', players.length === 0);
  }

  /* ---------- 顶栏 / 底栏 ---------- */

  function renderHeader() {
    document.body.dataset.phase = doc.meta.phase === 'night' ? 'night' : 'day';
    $('#phaseText').textContent = doc.meta.phase === 'night' ? '夜晚' : '白天';
    $('#phaseIcon').textContent = doc.meta.phase === 'night' ? '☾' : '☀';
    $('#dayText').textContent = '第 ' + doc.meta.day + ' 天';
    $('#menuDay').textContent = doc.meta.day;
    $('#menuCode').textContent = doc.code;

    var c = Model.counts(doc);
    $('#sAlive').textContent = c.alive;
    $('#sVote').textContent = c.deadVote;
    $('#sNone').textContent = c.deadNone;

    var comp = { townsfolk: 0, outsider: 0, minion: 0, demon: 0 };
    doc.players.forEach(function (p) {
      var info = p.character ? charInfo(p.character) : null;
      if (info && comp[info.type] != null) comp[info.type]++;
    });
    $('#cT').textContent = comp.townsfolk;
    $('#cO').textContent = comp.outsider;
    $('#cM').textContent = comp.minion;
    $('#cD').textContent = comp.demon;
  }

  function renderPresence() {
    $('#menuSquare').textContent = presence.square;
    var el = $('#menuSync');
    var on = presence.square > 0;
    el.textContent = on ? '已连接' : '等待连接';
    el.classList.toggle('off', !on);
  }

  function render(next) {
    doc = next;
    renderHeader();
    renderRing();
    if (ui.openId) {
      if (player(ui.openId)) syncSheet();
      else closeSheet();
    }
  }

  /* ---------- 详情面板 ---------- */

  function buildTabs() {
    var tabs = [{ key: 'all', label: '全部' }].concat(
      ['townsfolk', 'outsider', 'minion', 'demon'].map(function (k) {
        return { key: k, label: CHAR_TYPES[k].label };
      })
    );
    var box = $('#shTabs');
    box.innerHTML = '';
    tabs.forEach(function (t) {
      var b = document.createElement('button');
      b.type = 'button';
      b.className = 'sh-tab' + (ui.tab === t.key ? ' active' : '');
      b.dataset.tab = t.key;
      b.textContent = t.label;
      b.addEventListener('click', function () {
        ui.tab = t.key;
        $$('#shTabs .sh-tab').forEach(function (x) { x.classList.toggle('active', x.dataset.tab === ui.tab); });
        renderGrid();
      });
      box.appendChild(b);
    });
  }

  function chip(id, label, typeKey) {
    var p = player();
    var active = p && ((p.character || '') === id);
    var b = document.createElement('button');
    b.type = 'button';
    b.className = 'chip' + (active ? ' active' : '') + (id ? '' : ' empty-chip');
    b.dataset.char = id;

    var ic = document.createElement('span');
    ic.className = 'chip-ic';
    var src = roleIcon(id);
    if (src) {
      var img = document.createElement('img');
      img.alt = '';
      img.src = src;
      ic.appendChild(img);
    } else {
      ic.textContent = '?';
    }

    var nm = document.createElement('span');
    nm.className = 'chip-nm';
    nm.textContent = label;

    b.appendChild(ic);
    b.appendChild(nm);
    b.addEventListener('click', function () {
      var cur = player();
      if (!cur) return;
      if ((cur.character || '') === id) return;
      store.send({ type: 'character', id: cur.id, character: id || null });
    });
    return b;
  }

  function renderGrid() {
    var p = player();
    if (!p) return;
    var grid = $('#shGrid');
    grid.innerHTML = '';

    if (!ui.q.trim() && ui.tab === 'all') grid.appendChild(chip('', '未指定', 'custom'));

    var q = ui.q.trim().toLowerCase();
    CHARACTERS.forEach(function (c) {
      if (ui.tab !== 'all' && c.type !== ui.tab) return;
      if (q && c.cn.indexOf(q) < 0 && c.en.toLowerCase().indexOf(q) < 0) return;
      grid.appendChild(chip(c.id, c.cn, c.type));
    });

    if (p.character && p.character.indexOf('custom:') === 0) {
      grid.appendChild(chip(p.character, p.character.slice(7), 'custom'));
    }

    var info = p.character ? charInfo(p.character) : null;
    var ability = $('#shAbility');
    ability.innerHTML = '';
    if (info) {
      var b = document.createElement('b');
      b.textContent = info.cn + (info.en && info.en !== '自定义' ? ' · ' + info.en : '');
      ability.appendChild(b);
      ability.appendChild(document.createTextNode(info.ability ? '　' + info.ability : '　自定义身份，没有内置技能说明。'));
    } else {
      ability.textContent = '还没分配身份。点上面的角色即可。';
    }
  }

  function syncSheet() {
    var p = player();
    if (!p) return;
    $('#shName').textContent = p.name;
    $('#shSeat').textContent = p.seat + ' 号座位';
    if (document.activeElement !== $('#shNameInput')) $('#shNameInput').value = p.name;

    var img = $('#shAvatarImg');
    var src = roleIcon(p.character);
    if (src) {
      if (img.getAttribute('src') !== src) img.src = src;
    } else {
      img.removeAttribute('src');
    }

    $$('#shStatus button').forEach(function (b) { b.classList.toggle('active', b.dataset.st === p.status); });
    renderGrid();

    $$('.seat').forEach(function (li) { li.classList.toggle('open', li.dataset.id === p.id); });
  }

  function openSheet(id) {
    ui.openId = id;
    ui.tab = 'all';
    ui.q = '';
    $('#shSearch').value = '';
    buildTabs();
    syncSheet();
    $('#mask').classList.add('show');
    $('#sheet').classList.add('show');
    $('#sheet').setAttribute('aria-hidden', 'false');
  }

  function closeSheet() {
    ui.openId = null;
    $('#mask').classList.remove('show');
    $('#sheet').classList.remove('show');
    $('#sheet').setAttribute('aria-hidden', 'true');
    $$('.seat.open').forEach(function (li) { li.classList.remove('open'); });
    if (document.activeElement && document.activeElement.blur) document.activeElement.blur();
  }

  /* ---------- 交互 ---------- */

  $('#mask').addEventListener('click', closeSheet);
  $('#shClose').addEventListener('click', closeSheet);

  $$('#shStatus button').forEach(function (b) {
    b.addEventListener('click', function () {
      var p = player();
      if (!p) return;
      store.send({ type: 'status', id: p.id, status: b.dataset.st });
      if (b.dataset.st !== 'alive') {
        try { if (navigator.vibrate) navigator.vibrate(12); } catch (err) { /* noop */ }
      }
    });
  });

  function doRename() {
    var p = player();
    if (!p) return;
    var v = $('#shNameInput').value.trim();
    if (!v) return toast('名字不能为空');
    if (v === p.name) return $('#shNameInput').blur();
    store.send({ type: 'rename', id: p.id, name: v });
    $('#shNameInput').blur();
  }
  $('#shRename').addEventListener('click', doRename);
  $('#shNameInput').addEventListener('keydown', function (e) {
    if (e.key === 'Enter') { e.preventDefault(); doRename(); }
  });

  $('#shSearch').addEventListener('input', function (e) {
    ui.q = e.target.value || '';
    renderGrid();
  });

  $('#shCustomBtn').addEventListener('click', function () {
    var p = player();
    if (!p) return;
    var v = $('#shCustom').value.trim();
    if (!v) return toast('先输入角色名');
    store.send({ type: 'character', id: p.id, character: 'custom:' + v });
    $('#shCustom').value = '';
  });

  $('#shRemove').addEventListener('click', function () {
    var p = player();
    if (!p) return;
    if (!window.confirm('确定移除 ' + p.seat + ' 号「' + p.name + '」吗？')) return;
    store.send({ type: 'remove', id: p.id });
    closeSheet();
  });

  $('#btnAdd').addEventListener('click', function () { store.send({ type: 'add' }); });
  $('#btnAddOne').addEventListener('click', function () { store.send({ type: 'add' }); });

  function syncSeatCount() {
    ui.seats = Math.min(15, Math.max(5, ui.seats));
    $('#cntNum').textContent = ui.seats;
    $('#cntNum2').textContent = ui.seats;
    try { localStorage.setItem('ct.seats', String(ui.seats)); } catch (err) { /* noop */ }
  }
  $('#cntMinus').addEventListener('click', function () { ui.seats--; syncSeatCount(); });
  $('#cntPlus').addEventListener('click', function () { ui.seats++; syncSeatCount(); });
  $('#btnSeed').addEventListener('click', function () {
    store.send({ type: 'seed', count: ui.seats });
    toast('摆好 ' + ui.seats + ' 个杯子');
  });

  $('#phaseBtn').addEventListener('click', function () {
    store.send({ type: 'meta', phase: doc.meta.phase === 'night' ? 'day' : 'night' });
  });
  $('#dayMinus').addEventListener('click', function () {
    store.send({ type: 'meta', day: Math.max(1, doc.meta.day - 1) });
  });
  $('#dayPlus').addEventListener('click', function () {
    store.send({ type: 'meta', day: Math.min(99, doc.meta.day + 1) });
  });

  function syncHide() {
    document.body.classList.toggle('hide-chars', ui.hide);
    $('#btnHide').setAttribute('aria-pressed', ui.hide ? 'true' : 'false');
    try { localStorage.setItem('ct.hide', ui.hide ? '1' : '0'); } catch (err) { /* noop */ }
  }
  $('#btnHide').addEventListener('click', function () {
    ui.hide = !ui.hide;
    syncHide();
    toast(ui.hide ? '身份已遮住' : '身份已显示');
  });

  $('#btnMenu').addEventListener('click', function () { $('#menu').classList.add('show'); });
  $('#menu').addEventListener('click', function (e) {
    if (e.target === $('#menu') || e.target.hasAttribute('data-close')) $('#menu').classList.remove('show');
  });
  $('#btnReset').addEventListener('click', function () {
    if (!window.confirm('清空本局？所有杯子与身份都会被移除。')) return;
    store.send({ type: 'reset' });
    $('#menu').classList.remove('show');
    closeSheet();
    toast('已清空，可以重新摆杯子了');
  });

  document.addEventListener('keydown', function (e) {
    if (e.key !== 'Escape') return;
    if ($('#menu').classList.contains('show')) $('#menu').classList.remove('show');
    else closeSheet();
  });

  function setSync(status) {
    document.body.classList.toggle('offline', status === 'offline');
  }

  function setPresence(p) {
    if (p && typeof p === 'object') presence = p;
    renderPresence();
  }

  window.addEventListener('resize', function () { renderRing(); });
  window.addEventListener('orientationchange', function () { setTimeout(renderRing, 260); });

  /* ---------- 启动 ---------- */

  store = createStore(code, {
    role: 'grimoire',
    onChange: render,
    onStatus: setSync,
    onPresence: setPresence,
    onError: function (err) {
      var msg = String((err && err.message) || '');
      if (msg.indexOf('房间不存在') >= 0) {
        toast('这个房间已经不存在了，回首页重新开一局');
        setTimeout(function () { location.href = '/'; }, 1600);
      } else {
        toast('同步失败：' + (msg || '检查是否还在同一网络'));
      }
    }
  });

  syncHide();
  syncSeatCount();
  renderPresence();
  store.start();
})();
