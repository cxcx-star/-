/* 信息提示工具：说书人点一条短语，把屏幕递给玩家看
   短语列表按线下开团最常用的十句固定下来，带下划线的是需要先选角色的。 */
(function () {
  'use strict';

  var $ = function (s) { return document.querySelector(s); };

  /* ---------- 短语 ---------- */
  var PHRASES = [
    { id: 'you-are', label: '你是', slot: 'role', tpl: '你是 <b>__</b>' },
    { id: 'this-is', label: '这名玩家是', slot: 'role', tpl: '这名玩家是 <b>__</b>' },
    { id: 'affect', label: '该角色的技能作用于你', slot: 'role', tpl: '<b>__</b> 的技能作用于你' },
    { id: 'absent', label: '这些角色不在场', slot: 'roles', tpl: '这些角色不在场：<b>__</b>' },
    { id: 'nominate', label: '你昨天提名了吗' },
    { id: 'vote', label: '你昨天投票了吗' },
    { id: 'choose', label: '做出你的选择' },
    { id: 'ability', label: '你要使用你的能力吗' },
    { id: 'demon', label: '他是恶魔' },
    { id: 'minions', label: '他们是你的爪牙' }
  ];

  var TEAM_NAME = {
    townsfolk: '镇民', outsider: '外来者', minion: '爪牙', demon: '恶魔',
    traveler: '旅行者', fabled: '传奇'
  };

  var roles = [];          // 全部角色
  var pool = [];           // 按当前剧本筛过的角色
  var active = null;       // 正在选角色的短语
  var selected = [];       // 已选角色（多选时用）

  /* 从魔典带过来的剧本信息：?edition=tb 或 ?roles=id1,id2（自定义剧本） */
  var query = new URLSearchParams(location.search);
  var onlyEdition = (query.get('edition') || '').toLowerCase();
  var onlyRoles = (query.get('roles') || '').split(',').map(function (x) { return x.trim(); }).filter(Boolean);
  var scriptName = query.get('name') || '';

  /* ---------- 数据 ---------- */
  function loadRoles() {
    return fetch('/ct-role-data.json', { cache: 'force-cache' })
      .then(function (r) { return r.json(); })
      .then(function (d) {
        var list = (d && d.data && d.data.role) || [];
        roles = list
          .filter(function (r) { return r && r.name && r.team !== 'fabled'; })
          .map(function (r) {
            return {
              id: r.id,
              name: r.name,
              team: r.team || '',
              edition: r.edition || '',
              image: String(r.image || '').replace(/^\/oss\//, '/gs/oss/')
            };
          })
          .sort(function (a, b) { return a.name.localeCompare(b.name, 'zh'); });
        buildPool();
        return roles;
      })
      .catch(function () {
        roles = [];
        pool = [];
      });
  }

  function buildPool() {
    if (onlyRoles.length) {
      var byId = {};
      roles.forEach(function (r) { byId[r.id] = r; });
      pool = onlyRoles.map(function (id) { return byId[id]; }).filter(Boolean);
      if (!pool.length) pool = roles.slice();
      return;
    }
    if (onlyEdition && onlyEdition !== 'custom') {
      var subset = roles.filter(function (r) { return (r.edition || '') === onlyEdition; });
      pool = subset.length ? subset : roles.slice();
      return;
    }
    pool = roles.slice();
  }

  /* ---------- 网格 ---------- */
  function renderGrid() {
    var box = $('#grid');
    box.innerHTML = '';
    PHRASES.forEach(function (p) {
      var b = document.createElement('button');
      b.type = 'button';
      b.className = 'x-card' + (p.slot === 'roles' ? ' wide' : '');
      b.innerHTML = p.label + (p.slot ? '<span class="tpl">需要先选' + (p.slot === 'roles' ? '几个角色' : '角色') + '</span>' : '');
      b.addEventListener('click', function () { start(p); });
      box.appendChild(b);
    });
  }

  /* ---------- 选角色 ---------- */
  var TEAM_ORDER = { townsfolk: 0, outsider: 1, minion: 2, demon: 3, traveler: 4, fabled: 5 };

  function renderRoles(filter) {
    var box = $('#roles');
    var kw = String(filter || '').trim();
    box.innerHTML = '';
    pool.slice().sort(function (a, b) {
      var da = TEAM_ORDER[a.team] == null ? 9 : TEAM_ORDER[a.team];
      var db = TEAM_ORDER[b.team] == null ? 9 : TEAM_ORDER[b.team];
      if (da !== db) return da - db;
      return a.name.localeCompare(b.name, 'zh');
    }).forEach(function (r) {
      if (kw && r.name.indexOf(kw) < 0 && r.id.indexOf(kw) < 0) return;
      var b = document.createElement('button');
      b.type = 'button';
      b.className = 'x-role team-' + r.team + (selected.indexOf(r) >= 0 ? ' on' : '');
      b.innerHTML = (r.image ? '<img src="' + r.image + '" alt="" loading="lazy">' : '') + '<span>' + r.name + '</span>';
      b.addEventListener('click', function () { tapRole(r, b); });
      box.appendChild(b);
    });
    if (!box.children.length) {
      box.innerHTML = '<p style="grid-column:1/-1;color:#7d7264;font-size:13px;padding:12px 4px">没有匹配的角色</p>';
    }
  }

  function tapRole(r, el) {
    if (active.slot === 'roles') {
      var i = selected.indexOf(r);
      if (i >= 0) { selected.splice(i, 1); el.classList.remove('on'); }
      else { selected.push(r); el.classList.add('on'); }
      $('#pickOk').disabled = !selected.length;
      $('#pickOk').textContent = selected.length ? '确定（已选 ' + selected.length + ' 个）' : '确定';
      return;
    }
    selected = [r];
    showPhrase(active, r.name);
  }

  function setClose(visible) {
    var b = document.getElementById('x-close');
    if (b) b.style.display = visible ? '' : 'none';
  }

  function start(p) {
    if (!p.slot) { showPhrase(p, ''); return; }
    active = p;
    selected = [];
    $('#search').value = '';
    $('#pickOk').disabled = true;
    $('#pickOk').textContent = '确定';
    renderRoles('');
    $('#sheet').hidden = false;
    $('#back').hidden = false;
    setClose(false);
    setTimeout(function () { try { $('#search').focus(); } catch (e) {} }, 60);
  }

  function closeSheet() {
    $('#sheet').hidden = true;
    active = null;
    if ($('#show').hidden) { $('#back').hidden = true; setClose(true); }
  }

  /* ---------- 展示 ---------- */
  function showPhrase(p, value) {
    var text;
    if (p.slot === 'roles') {
      text = p.tpl.replace('__', selected.map(function (r) { return r.name; }).join('、'));
    } else if (p.slot === 'role') {
      text = p.tpl.replace('__', value || '');
    } else {
      text = p.label;
    }
    $('#sheet').hidden = true;
    $('#showText').innerHTML = text;
    $('#show').hidden = false;
    $('#back').hidden = false;
    setClose(false);
    if (navigator.vibrate) { try { navigator.vibrate(14); } catch (e) {} }
  }

  function closeShow() {
    $('#show').hidden = true;
    if ($('#sheet').hidden) { $('#back').hidden = true; setClose(true); }
  }

  /* ---------- 事件 ---------- */
  $('#search').addEventListener('input', function (e) { renderRoles(e.target.value); });
  $('#pickCancel').addEventListener('click', closeSheet);
  $('#pickOk').addEventListener('click', function () {
    if (!active || !selected.length) return;
    showPhrase(active, '');
  });
  $('#show').addEventListener('click', closeShow);
  $('#back').addEventListener('click', function () {
    if (!$('#show').hidden) { closeShow(); return; }
    closeSheet();
  });

  window.addEventListener('keydown', function (e) {
    if (e.key !== 'Escape') return;
    if (!$('#show').hidden) { closeShow(); return; }
    if (!$('#sheet').hidden) { closeSheet(); return; }
    // 在魔典的浮层里打开时，Esc 直接通知外层关掉
    try { if (window.self !== window.top) window.parent.postMessage('xrh-close', '*'); } catch (err) { /* noop */ }
  });

  function updateSub() {
    var sub = document.querySelector('.x-sub');
    if (!sub) return;
    var label = scriptName;
    if (!label && onlyEdition) {
      var map = { tb: '暗流涌动', bmr: '黯月初升', snv: '梦殒春宵', hdcs: '华灯初上', exp: '实验性角色', syyl: '山雨欲来' };
      label = map[onlyEdition] || '';
    }
    sub.textContent = label ? ('当前剧本：' + label + ' · 点一条递给玩家') : '点一条，把屏幕递给玩家';
  }

  /* 被魔典浮层内嵌时，自己在右上角提供一个「关闭」 */
  var embedded = (function () {
    try { return window.self !== window.top; } catch (err) { return true; }
  })();

  function addEmbeddedClose() {
    if (!embedded || document.getElementById('x-close')) return;
    var b = document.createElement('button');
    b.id = 'x-close';
    b.type = 'button';
    b.className = 'x-close';
    b.textContent = '关闭';
    b.addEventListener('click', function (e) {
      e.preventDefault();
      e.stopPropagation();
      try { window.parent.postMessage('xrh-close', '*'); } catch (err) { /* noop */ }
    });
    document.body.appendChild(b);
  }

  renderGrid();
  updateSub();
  addEmbeddedClose();
  loadRoles();
})();
