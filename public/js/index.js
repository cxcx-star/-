/* 首页：选择设备角色、展示局域网地址、列出房间 */
(function () {
  'use strict';

  var $ = function (s) { return document.querySelector(s); };
  var toastEl = $('#toast');
  var toastTimer = null;
  var healthCache = null;

  function toast(msg) {
    toastEl.textContent = msg;
    toastEl.classList.add('show');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(function () { toastEl.classList.remove('show'); }, 2200);
  }

  function ago(ts) {
    var s = Math.max(0, Math.round((Date.now() - ts) / 1000));
    if (s < 45) return '刚刚';
    if (s < 3600) return Math.round(s / 60) + ' 分钟前';
    if (s < 86400) return Math.round(s / 3600) + ' 小时前';
    return Math.round(s / 86400) + ' 天前';
  }

  function setConn(kind, text) {
    var el = $('#conn');
    el.className = 'conn' + (kind ? ' ' + kind : '');
    el.innerHTML = '<i></i>' + text;
  }

  function go(role, code) {
    if (role === 'grimoire') {
      // 手机端直接用官方魔典本体，?room= 让桥接脚本知道同步到哪个房间
      location.href = '/gs/index.html?room=' + code;
    } else {
      location.href = '/square.html#' + code;
    }
  }

  function copy(text) {
    if (navigator.clipboard && window.isSecureContext) {
      return navigator.clipboard.writeText(text).then(function () { toast('已复制：' + text); });
    }
    var ta = document.createElement('textarea');
    ta.value = text;
    ta.style.position = 'fixed';
    ta.style.opacity = '0';
    document.body.appendChild(ta);
    ta.select();
    try { document.execCommand('copy'); toast('已复制：' + text); }
    catch (err) { toast('复制失败，请手动选中地址'); }
    document.body.removeChild(ta);
    return Promise.resolve();
  }

  function renderRooms(rooms) {
    var box = $('#roomList');
    if (!rooms.length) {
      box.innerHTML = '<p class="empty">还没有房间 —— 点上面任意一张卡片开始一局，另一台设备再打开同一地址就能加入。</p>';
      return;
    }
    box.innerHTML = '';
    rooms.forEach(function (r) {
      var row = document.createElement('div');
      row.className = 'room';
      var live = (r.presence && r.presence.total)
        ? '<span class="live"><i></i>' + (r.presence.square ? '广场已开' : '') + (r.presence.square && r.presence.grimoire ? ' · ' : '') + (r.presence.grimoire ? '魔典在线' : '') + '</span>'
        : '';
      row.innerHTML =
        '<span class="code">' + r.code + '</span>' +
        '<span class="meta">' + r.players + ' 人 · ' + r.alive + ' 存活 · ' + ago(r.updatedAt) + ' ' + live + '</span>' +
        '<span class="acts">' +
        '<a class="btn sm" href="/gs/index.html?room=' + r.code + '">魔典</a>' +
        '<a class="btn sm primary" href="/square.html#' + r.code + '">广场</a>' +
        '</span>';
      box.appendChild(row);
    });
  }

  function refresh() {
    return API.listRooms().then(function (res) {
      setConn('ok', '服务已连接');
      renderRooms(res.rooms || []);
      return res.rooms || [];
    }).catch(function () {
      setConn('bad', '服务未连接');
      $('#roomList').innerHTML = '<p class="empty">连不上本机服务。请确认 <code>node server.js</code> 还在运行，然后刷新本页。</p>';
      return [];
    });
  }

  function showPicker(role, rooms) {
    var modal = $('#modal');
    var list = $('#pickList');
    list.innerHTML = '';
    rooms.forEach(function (r) {
      var b = document.createElement('button');
      b.type = 'button';
      b.className = 'pick';
      b.innerHTML = '<b>' + r.code + '</b><span>' + r.players + ' 人 · ' + ago(r.updatedAt) + '</span>';
      b.addEventListener('click', function () { go(role, r.code); });
      list.appendChild(b);
    });
    modal.classList.add('show');
    modal.dataset.role = role;
  }

  function chooseRole(role) {
    var hash = (location.hash || '').replace(/^#\/?/, '').toUpperCase();
    if (/^[A-Z0-9]{4}$/.test(hash)) return go(role, hash);
    refresh().then(function (rooms) {
      if (rooms.length === 0) {
        return API.createRoom().then(function (res) { go(role, res.code); });
      }
      if (rooms.length === 1) return go(role, rooms[0].code);
      showPicker(role, rooms);
    }).catch(function () {
      toast('服务未连接，无法创建房间');
    });
  }

  Array.prototype.forEach.call(document.querySelectorAll('.role'), function (el) {
    el.addEventListener('click', function () { chooseRole(el.dataset.role); });
  });

  var hintBtn = document.getElementById('hintBtn');
  if (hintBtn) hintBtn.addEventListener('click', function () { window.open('/xrh', '_blank', 'noopener'); });

  $('#copyUrl').addEventListener('click', function () {
    copy($('#lanUrl').textContent.trim());
  });

  $('#modal').addEventListener('click', function (e) {
    if (e.target === $('#modal') || e.target.hasAttribute('data-close')) $('#modal').classList.remove('show');
  });

  $('#newRoomBtn').addEventListener('click', function () {
    var role = $('#modal').dataset.role || 'grimoire';
    API.createRoom().then(function (res) { go(role, res.code); }).catch(function () { toast('创建失败'); });
  });

  API.health().then(function (h) {
    healthCache = h;
    if (h.cloud) {
      $('#lanUrl').textContent = location.origin + '/';
      $('#localUrl').textContent = '云端服务 · 手机和平板不用连同一个 Wi-Fi，发给朋友也能打开';
      return;
    }
    var port = h.port || location.port || 80;
    var ip = (h.ips && h.ips[0]) || location.hostname;
    var lan = h.httpsPort
      ? 'https://' + ip + ':' + h.httpsPort + '/'
      : 'http://' + ip + ':' + port + '/';
    if (location.protocol === 'https:') lan = location.origin + '/';
    $('#lanUrl').textContent = lan;
    /* 手机同时开着 Wi-Fi 和热点时会有多个地址，都列出来，平板连哪个就用哪个 */
    var others = (h.ips || []).slice(1).map(function (x) {
      return 'http://' + x + ':' + port + '/';
    });
    if (others.length) {
      $('#localUrl').textContent = '其他可用地址（连热点就用这条）：' + others.join('   ');
    } else {
      $('#localUrl').textContent = h.httpsPort
        ? '自签名证书：手机首次打开点「高级 → 继续前往」即可'
        : '本机地址 ' + location.origin + '/ · 手机与平板需连同一个 Wi-Fi';
    }
  }).catch(function () {
    $('#lanUrl').textContent = location.origin + '/';
  });

  refresh();
  setInterval(refresh, 6000);
})();
