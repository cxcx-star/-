/* 官方魔典 → 城镇广场 的状态桥
   官方魔典是个前端 Vue 应用，状态全在 Vuex 里。这里读它的 store，
   把「座位 / 名字 / 角色 / 生死 / 鬼票」整份快照推给本地服务，
   平板端的城镇广场就能跟着变。 */
(function () {
  'use strict';

  var q = new URLSearchParams(location.search);
  var code = String(q.get('room') || '').toUpperCase();
  if (!/^[A-Z0-9]{4}$/.test(code)) return;

  var store = null;
  var last = '';
  var inflight = false;
  var retryAt = 0;

  function getStore() {
    var app = document.getElementById('app');
    if (!app || !app.__vue__ || !app.__vue__.$store) return null;
    return app.__vue__.$store;
  }

  function snapshot() {
    var s = (store && store.state && store.state.players) || {};
    var arr = Array.isArray(s.players) ? s.players : [];
    return arr.map(function (p, i) {
      p = p || {};
      return {
        seat: i + 1,
        name: String(p.name || '').trim() || ('座位' + (i + 1)),
        character: p.role && p.role.id ? String(p.role.id) : null,
        status: p.isDead ? (p.isVoteless ? 'deadNone' : 'deadVote') : 'alive'
      };
    });
  }

  function push(force) {
    if (!store) {
      store = getStore();
      if (!store) return;
    }
    if (inflight || Date.now() < retryAt) return;
    var snap;
    try {
      snap = snapshot();
    } catch (err) {
      return;
    }
    var sig = JSON.stringify(snap);
    if (!force && sig === last) return;
    last = sig;
    inflight = true;
    fetch('/api/room/' + code + '/phone', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ players: snap })
    }).then(function (res) {
      inflight = false;
      if (!res.ok) throw new Error('HTTP ' + res.status);
    }).catch(function () {
      inflight = false;
      last = '';
      retryAt = Date.now() + 2500;
    });
  }

  function start() {
    store = getStore();
    if (!store) {
      setTimeout(start, 300);
      return;
    }
    try {
      store.subscribe(function () { push(false); });
    } catch (err) {
      /* 没有 subscribe 就靠轮询 */
    }
    push(true);
    setInterval(function () { push(false); }, 900);
  }

  /* 官方网页版加座位只有键盘 [A]，手机上没有键盘。
     触屏设备补一个小按钮，点它等价于按一下 A。 */
  function addSeatButton() {
    if (document.getElementById('gs-add-seat')) return;
    var b = document.createElement('button');
    b.id = 'gs-add-seat';
    b.type = 'button';
    b.textContent = '＋ 座位';
    b.setAttribute('aria-label', '添加座位');
    b.style.cssText = [
      'position:fixed',
      'right:14px',
      'bottom:calc(16px + env(safe-area-inset-bottom))',
      'z-index:2147483000',
      'padding:10px 15px',
      'border-radius:99px',
      'border:1px solid rgba(226,200,150,.5)',
      'background:rgba(22,17,12,.84)',
      'color:#f0e2c4',
      'font:600 13px/1 -apple-system,BlinkMacSystemFont,"PingFang SC",sans-serif',
      'letter-spacing:.08em',
      'box-shadow:0 10px 26px -10px #000',
      '-webkit-backdrop-filter:blur(6px)',
      'backdrop-filter:blur(6px)',
      '-webkit-tap-highlight-color:transparent'
    ].join(';');
    b.addEventListener('click', function (e) {
      e.preventDefault();
      e.stopPropagation();
      var app = document.getElementById('app');
      if (app) app.dispatchEvent(new KeyboardEvent('keyup', { key: 'a', bubbles: true }));
    });
    document.body.appendChild(b);
  }

  /* 信息提示：说书人常用的一句话提示工具，点开就是大字号，直接递给玩家看 */
  function hintButton() {
    if (document.getElementById('gs-hint')) return;
    var b = document.createElement('button');
    b.id = 'gs-hint';
    b.type = 'button';
    b.textContent = '提示';
    b.setAttribute('aria-label', '打开信息提示');
    b.style.cssText = [
      'position:fixed',
      'right:14px',
      'bottom:calc(64px + env(safe-area-inset-bottom))',
      'z-index:2147483000',
      'padding:10px 15px',
      'border-radius:99px',
      'border:1px solid rgba(204,4,255,.45)',
      'background:rgba(28,16,34,.86)',
      'color:#e9d5ff',
      'font:600 13px/1 -apple-system,BlinkMacSystemFont,"PingFang SC",sans-serif',
      'letter-spacing:.08em',
      'box-shadow:0 10px 26px -10px #000',
      '-webkit-backdrop-filter:blur(6px)',
      'backdrop-filter:blur(6px)',
      '-webkit-tap-highlight-color:transparent'
    ].join(';');
    b.addEventListener('click', function (e) {
      e.preventDefault();
      e.stopPropagation();
      openHint();
    });
    document.body.appendChild(b);
  }

  /* 提示工具用页内浮层打开，关掉就回到魔典原状（不会离开这一页） */
  var hintLayer = null;
  function openHint() {
    if (!hintLayer) {
      hintLayer = document.createElement('div');
      hintLayer.id = 'gs-hint-layer';
      hintLayer.style.cssText = [
        'position:fixed', 'inset:0', 'z-index:2147483600',
        'background:#08070b', 'display:none',
        '-webkit-tap-highlight-color:transparent'
      ].join(';');

      var frame = document.createElement('iframe');
      frame.id = 'gs-hint-frame';
      frame.setAttribute('title', '信息提示');
      frame.style.cssText = 'position:absolute;inset:0;width:100%;height:100%;border:0;background:#08070b';
      frame.src = '/xrh';

      var close = document.createElement('button');
      close.type = 'button';
      close.textContent = '关闭';
      close.style.cssText = [
        'position:absolute',
        'right:12px',
        'top:calc(10px + env(safe-area-inset-top))',
        'z-index:2',
        'padding:9px 14px',
        'border-radius:99px',
        'border:1px solid rgba(217,185,120,.45)',
        'background:rgba(16,12,18,.9)',
        'color:#f0e2c4',
        'font:600 13px/1 -apple-system,BlinkMacSystemFont,"PingFang SC",sans-serif',
        'letter-spacing:.08em',
        '-webkit-tap-highlight-color:transparent'
      ].join(';');
      close.addEventListener('click', function (ev) {
        ev.preventDefault();
        ev.stopPropagation();
        hintLayer.style.display = 'none';
      });

      hintLayer.appendChild(frame);
      hintLayer.appendChild(close);
      document.body.appendChild(hintLayer);

      /* 工具里按 Esc 或自己退出时也能关掉浮层 */
      window.addEventListener('message', function (ev) {
        if (ev && ev.data === 'xrh-close') hintLayer.style.display = 'none';
      });
    }
    hintLayer.style.display = 'block';
    push(true);
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start);
  else start();

  if (window.matchMedia && window.matchMedia('(pointer: coarse)').matches) {
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', function () { addSeatButton(); hintButton(); });
    else { addSeatButton(); hintButton(); }
  }

  document.addEventListener('visibilitychange', function () {
    if (!document.hidden) push(true);
  });
})();
