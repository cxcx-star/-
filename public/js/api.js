/* 与服务器的极简通道：HTTP 写入 + SSE 订阅 */
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

  var API = {
    health: function () { return request('/api/health'); },
    listRooms: function () { return request('/api/rooms'); },
    createRoom: function () { return request('/api/rooms', { method: 'POST', body: '{}' }); },
    getRoom: function (code) { return request('/api/room/' + code); },
    intent: function (code, intent) {
      return request('/api/room/' + code + '/intent', { method: 'POST', body: JSON.stringify(intent) });
    },
    stream: function (code, role, handlers) {
      handlers = handlers || {};
      var es = new EventSource('/api/room/' + code + '/stream?role=' + encodeURIComponent(role || 'grimoire'));
      es.addEventListener('state', function (e) {
        var data = null;
        try { data = JSON.parse(e.data); } catch (err) { return; }
        if (handlers.onState) handlers.onState(data);
      });
      es.addEventListener('presence', function (e) {
        var data = null;
        try { data = JSON.parse(e.data); } catch (err) { return; }
        if (handlers.onPresence) handlers.onPresence(data);
      });
      es.onopen = function () { if (handlers.onStatus) handlers.onStatus('online'); };
      es.onerror = function () { if (handlers.onStatus) handlers.onStatus('offline'); };
      return es;
    }
  };

  global.API = API;
})(window);
