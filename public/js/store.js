/* 客户端状态仓库：
   serverDoc 是服务器权威版本；本地先把待确认的意图叠加在上面做乐观更新。
   服务器回包 / SSE 到达后重算，保证不会因为连续点击而回跳。 */
(function (global) {
  'use strict';

  function clone(o) { return JSON.parse(JSON.stringify(o)); }

  function createStore(code, opts) {
    opts = opts || {};
    var serverDoc = Model.newDoc(code);
    var localDoc = serverDoc;
    var pending = new Map();
    var seq = 0;
    var status = 'connecting';
    var es = null;
    var stopped = false;

    function setStatus(next, detail) {
      if (status === next) return;
      status = next;
      if (opts.onStatus) opts.onStatus(status, detail);
    }

    function emit() {
      if (opts.onChange) opts.onChange(localDoc);
    }

    function recompute() {
      var d = clone(serverDoc);
      pending.forEach(function (intent) { Model.applyIntent(d, intent); });
      localDoc = d;
      emit();
    }

    function setServerDoc(doc) {
      if (!doc || !Array.isArray(doc.players)) return;
      if ((Number(doc.rev) || 0) < (Number(serverDoc.rev) || 0)) return;
      serverDoc = doc;
      recompute();
    }

    function post(id, attempt) {
      attempt = attempt || 0;
      var intent = pending.get(id);
      if (!intent) return Promise.resolve(localDoc);
      var body = Object.assign({ __id: id }, intent);
      return API.intent(code, body).then(function (res) {
        pending.delete(id);
        if (res && res.doc) setServerDoc(res.doc);
        else recompute();
        if (res && res.presence && opts.onPresence) opts.onPresence(res.presence);
        setStatus('online');
        return localDoc;
      }, function (err) {
        if (attempt < 2) {
          return new Promise(function (r) { setTimeout(r, 420 * (attempt + 1)); }).then(function () {
            return post(id, attempt + 1);
          });
        }
        pending.delete(id);
        recompute();
        setStatus('offline', err);
        if (opts.onError) opts.onError(err);
        return localDoc;
      });
    }

    function send(intent) {
      var id = 'i' + (++seq) + Math.random().toString(36).slice(2, 6);
      pending.set(id, intent);
      recompute();
      return post(id);
    }

    function start() {
      return API.getRoom(code).then(function (res) {
        if (stopped) return;
        if (res && res.doc) setServerDoc(res.doc);
        if (res && res.presence && opts.onPresence) opts.onPresence(res.presence);
        if (res && opts.onWatch) opts.onWatch(res.watch || null);
        setStatus('online');
        es = API.stream(code, opts.role, {
          onState: function (p) {
            if (p && p.doc) setServerDoc(p.doc);
            if (p && p.presence && opts.onPresence) opts.onPresence(p.presence);
            if (p && opts.onWatch) opts.onWatch(p.watch || null);
            setStatus('online');
          },
          onPresence: function (p) { if (opts.onPresence) opts.onPresence(p); },
          onStatus: function (s) { setStatus(s === 'online' ? 'online' : 'offline'); }
        });
        // 后台标签页回来时补一次，避免 EventSource 静默断开
        document.addEventListener('visibilitychange', function () {
          if (document.visibilityState === 'visible' && !stopped) {
            API.getRoom(code).then(function (r) {
              if (r && r.doc) setServerDoc(r.doc);
              if (r && r.presence && opts.onPresence) opts.onPresence(r.presence);
              setStatus('online');
            }).catch(function () { setStatus('offline'); });
          }
        });
      }).catch(function (err) {
        setStatus('offline', err);
        if (opts.onError) opts.onError(err);
      });
    }

    function close() {
      stopped = true;
      if (es) es.close();
    }

    return {
      code: code,
      start: start,
      close: close,
      send: send,
      get doc() { return localDoc; },
      get status() { return status; }
    };
  }

  global.createStore = createStore;
})(window);
