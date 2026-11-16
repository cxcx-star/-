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

  var roles = [];          // {id,name,team,image}
  var active = null;       // 正在选角色的短语
  var selected = [];       // 已选角色（多选时用）

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
              image: String(r.image || '').replace(/^\/oss\//, '/gs/oss/')
            };
          })
          .sort(function (a, b) { return a.name.localeCompare(b.name, 'zh'); });
        return roles;
      })
      .catch(function () { roles = []; });
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
  function renderRoles(filter) {
    var box = $('#roles');
    var kw = String(filter || '').trim();
    box.innerHTML = '';
    roles.forEach(function (r) {
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
    setTimeout(function () { try { $('#search').focus(); } catch (e) {} }, 60);
  }

  function closeSheet() {
    $('#sheet').hidden = true;
    active = null;
    if ($('#show').hidden) $('#back').hidden = true;
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
    if (navigator.vibrate) { try { navigator.vibrate(14); } catch (e) {} }
  }

  function closeShow() {
    $('#show').hidden = true;
    if ($('#sheet').hidden) $('#back').hidden = true;
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

  renderGrid();
  loadRoles();
})();
