/* 与服务器的通道：HTTP 写入 + 实时订阅
   实时优先用 WebSocket（云端 Durable Object 的休眠连接，最稳）；
   WebSocket 打不开就退回 SSE（局域网 Node 服务只支持 SSE）；
   两者都断着的时候用 2.5 秒轮询兜底，保证画面不会停在旧状态。 */
(function (global) {
  'use strict';

  function request(url, opts) {
    opts = opts || {};
    var init = {
      method: opts.method || 'GET',
      cache: 'no-store',
      headers: { 'Content-Type': 'application/json' }
    };
    if (opts.body != null) init.body = opts.body;
    return fetch(url, init).then(function (res) {
      return res.text().then(function (raw) {
        var data = null;
        try { data = raw ? JSON.parse(raw) : null; } catch (err) { data = null; }
        if (!res.ok) {
          var msg = (data && data.error) || ('HTTP ' + res.status);
          throw new Error(msg);
        }
        return data;
      });
    });
  }

  /* 一次订阅：返回 { close() }，与旧的 EventSource 用法兼容 */
  function openStream(code, role, handlers) {
    handlers = handlers || {};
    role = role === 'square' ? 'square' : 'grimoire';

    var ctl = { closed: false };
    var ws = null, es = null, poll = null, reconnectTimer = null, wsOpenTimer = null;
    var backoff = 600;
    var lastWsMsg = 0;
    var status = null;

    function setStatus(next) {
      if (ctl.closed || status === next) return;
      status = next;
      if (handlers.onStatus) handlers.onStatus(next);
    }

    function handle(event, data) {
      if (event === 'state' && handlers.onState) handlers.onState(data);
      else if (event === 'presence' && handlers.onPresence) handlers.onPresence(data);
    }

    /* ---- 轮询兜底 ---- */
    function startPoll() {
      if (poll || ctl.closed) return;
      poll = setInterval(function () {
        if (ctl.closed) return;
        request('/api/room/' + code).then(function (p) {
          if (!p || !p.doc) return;
          handle('state', p);
          if (p.presence) handle('presence', p.presence);
          setStatus('online');
        }).catch(function () { /* 继续等 */ });
      }, 2500);
    }
    function stopPoll() {
      if (poll) { clearInterval(poll); poll = null; }
    }

    /* ---- SSE ---- */
    function connectSse() {
      if (ctl.closed || es) return;
      try {
        es = new EventSource('/api/room/' + code + '/stream?role=' + encodeURIComponent(role));
      } catch (err) {
        return;
      }
      es.addEventListener('state', function (e) {
        var d = null;
        try { d = JSON.parse(e.data); } catch (err) { return; }
        handle('state', d);
      });
      es.addEventListener('presence', function (e) {
        var d = null;
        try { d = JSON.parse(e.data); } catch (err) { return; }
        handle('presence', d);
      });
      es.onopen = function () { backoff = 600; stopPoll(); setStatus('online'); };
      es.onerror = function () { setStatus('offline'); startPoll(); };
    }

    /* ---- WebSocket ---- */
    function fallbackToSse() {
      if (ctl.closed) return;
      if (ws) {
        try { ws.close(); } catch (e) { /* noop */ }
        ws = null;
      }
      startPoll();
      connectSse();
    }

    function scheduleWs() {
      if (ctl.closed) return;
      clearTimeout(reconnectTimer);
      var wait = Math.min(10000, backoff);
      backoff = Math.min(10000, Math.round(backoff * 1.7));
      reconnectTimer = setTimeout(connectWs, wait);
    }

    function connectWs() {
      if (ctl.closed) return;
      var proto = location.protocol === 'https:' ? 'wss:' : 'ws:';
      var url = proto + '//' + location.host + '/api/room/' + code + '/ws?role=' + encodeURIComponent(role);
      var opened = false;
      try {
        ws = new WebSocket(url);
      } catch (err) {
        fallbackToSse();
        return;
      }
      wsOpenTimer = setTimeout(function () {
        if (!opened && ws) {
          try { ws.close(); } catch (e) { /* noop */ }
        }
      }, 3500);

      ws.onopen = function () {
        opened = true;
        clearTimeout(wsOpenTimer);
        backoff = 600;
        if (es) { try { es.close(); } catch (e) { /* noop */ } es = null; }
        stopPoll();
        lastWsMsg = Date.now();
        setStatus('online');
      };

      ws.onmessage = function (ev) {
        lastWsMsg = Date.now();
        var m = null;
        try { m = JSON.parse(ev.data); } catch (err) { return; }
        if (!m || m.t === 'ping') return;
        handle(m.e, m.d);
      };

      ws.onclose = function () {
        clearTimeout(wsOpenTimer);
        if (ctl.closed) return;
        ws = null;
        if (!opened) { fallbackToSse(); return; }
        setStatus('offline');
        startPoll();
        scheduleWs();
      };

      ws.onerror = function () { /* 交给 onclose */ };
    }

    /* ---- 心跳：25 秒没消息就重连（只针对 WebSocket） ---- */
    var heartbeat = setInterval(function () {
      if (ctl.closed) return;
      if (!ws || ws.readyState !== 1) return;
      try { ws.send(JSON.stringify({ t: 'ping' })); } catch (e) { /* noop */ }
      if (lastWsMsg && Date.now() - lastWsMsg > 45000) {
        try { ws.close(); } catch (e) { /* noop */ }
      }
    }, 15000);

    ctl.close = function () {
      ctl.closed = true;
      clearInterval(heartbeat);
      clearTimeout(reconnectTimer);
      clearTimeout(wsOpenTimer);
      stopPoll();
      if (ws) { try { ws.close(); } catch (e) { /* noop */ } }
      if (es) { try { es.close(); } catch (e) { /* noop */ } }
    };

    connectWs();
    return ctl;
  }

  var API = {
    health: function () { return request('/api/health'); },
    listRooms: function () { return request('/api/rooms'); },
    createRoom: function () { return request('/api/rooms', { method: 'POST', body: '{}' }); },
    getRoom: function (code) { return request('/api/room/' + code); },
    intent: function (code, intent) {
      return request('/api/room/' + code + '/intent', { method: 'POST', body: JSON.stringify(intent) });
    },
    stream: openStream
  };

  global.API = API;
})(window);
