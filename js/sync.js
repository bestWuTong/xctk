/* ==========================================================================
   云同步层（GitHub Gist 单文件快照）
   - 同步范围：练习记录 + 错题本（不含界面偏好）
   - 冲突策略：只有一端改过 → 直接采用它；
              两端都改过 → 合并（记录按 id 并集、错题按 id 并集）后再推送
   - 失败策略：网络 / 5xx / 429 自动重试 3 次；仍失败则保留本地数据，只提示
   - 令牌只存在本机 localStorage，不经过任何第三方服务器
   ========================================================================== */

(function (global) {
  'use strict';

  var Store = global.XCTKStore;
  var CFG_KEY = 'xctk.sync.v1';
  var STATE_KEY = 'xctk.sync.state.v1';
  var TYPE = 'xctk-sync';
  var VERSION = 1;
  var DEFAULT_FILE = 'xctk-sync.json';
  var API = 'https://api.github.com';
  var RETRY = 3;
  var TIMEOUT = 15000;

  var listeners = [];
  var pending = null;

  /* ---------------------------------------------------------------- 配置 */
  function readJSON(key, fallback) {
    try {
      var raw = global.localStorage.getItem(key);
      if (!raw) return fallback;
      var v = JSON.parse(raw);
      return v === null || v === undefined ? fallback : v;
    } catch (e) {
      return fallback;
    }
  }

  function writeJSON(key, value) {
    try { global.localStorage.setItem(key, JSON.stringify(value)); } catch (e) {}
  }

  function config() {
    var c = readJSON(CFG_KEY, {});
    return {
      gistId: typeof c.gistId === 'string' ? c.gistId.trim() : '',
      token: typeof c.token === 'string' ? c.token.trim() : '',
      filename: typeof c.filename === 'string' ? c.filename.trim() : '',
      autoSync: c.autoSync !== false
    };
  }

  function saveConfig(patch) {
    var before = config();
    var c = config();
    Object.keys(patch || {}).forEach(function (k) { c[k] = patch[k]; });
    writeJSON(CFG_KEY, c);
    /* 换了 Gist 就重置比对基准，否则会拿旧仓库的时间跟新仓库比 */
    if (patch && typeof patch.gistId === 'string' && patch.gistId !== before.gistId) {
      saveState({ lastSyncAt: 0, lastError: '' });
    }
    return c;
  }

  function configured() {
    var c = config();
    return !!(c.gistId && c.token);
  }

  function autoEnabled() {
    var c = config();
    return c.autoSync && configured();
  }

  /* ---------------------------------------------------------------- 状态 */
  function rawState() {
    var s = readJSON(STATE_KEY, {});
    return (s && typeof s === 'object' && !Array.isArray(s)) ? s : {};
  }

  function state() {
    var s = rawState();
    if (typeof s.deviceId !== 'string' || !s.deviceId) {
      s.deviceId = 'web-' + Math.random().toString(36).slice(2, 8);
      writeJSON(STATE_KEY, s);
    }
    return {
      deviceId: s.deviceId,
      lastSyncAt: typeof s.lastSyncAt === 'number' ? s.lastSyncAt : 0,
      lastError: typeof s.lastError === 'string' ? s.lastError : ''
    };
  }

  function saveState(patch) {
    var s = rawState();
    Object.keys(patch || {}).forEach(function (k) { s[k] = patch[k]; });
    writeJSON(STATE_KEY, s);
    return s;
  }

  /* ---------------------------------------------------------- 快照构建 */
  function buildSnapshot() {
    var units = {};
    var wrongAll = Store.Wrong.all();

    /* 以错题本里出现过的单元为骨架 */
    Object.keys(wrongAll).forEach(function (uid) {
      units[uid] = { wrong: wrongAll[uid], records: [] };
    });

    Store.Records.list().forEach(function (r) {
      var uid = r.unit;
      if (!uid) return;
      if (!units[uid]) units[uid] = { wrong: [], records: [] };
      units[uid].records.push(r);
    });

    return {
      type: TYPE,
      version: VERSION,
      updatedAt: new Date().toISOString(),
      deviceId: state().deviceId,
      units: units
    };
  }

  /** 把快照写回本地（静默，避免触发推送回环） */
  function applySnapshot(snap) {
    if (!snap || snap.type !== TYPE || typeof snap.units !== 'object') {
      throw new Error('同步数据格式不正确');
    }
    var wrongObj = {};
    var records = [];
    Object.keys(snap.units).forEach(function (uid) {
      var u = snap.units[uid] || {};
      if (Array.isArray(u.wrong) && u.wrong.length) wrongObj[uid] = u.wrong;
      if (Array.isArray(u.records)) records = records.concat(u.records);
    });
    Store.Wrong.replace(wrongObj);
    Store.replaceRecords(records);
  }

  /* ------------------------------------------------------------ 合并 */
  function mergeUnits(a, b) {
    var out = {};
    var ids = {};
    Object.keys(a || {}).forEach(function (k) { ids[k] = 1; });
    Object.keys(b || {}).forEach(function (k) { ids[k] = 1; });

    Object.keys(ids).forEach(function (uid) {
      var x = (a && a[uid]) || {};
      var y = (b && b[uid]) || {};
      out[uid] = {
        wrong: Store.uniq([].concat(x.wrong || [], y.wrong || [])),
        records: Store.mergeRecords(x.records || [], y.records || [])
      };
    });
    return out;
  }

  function mergeSnapshots(local, remote) {
    return {
      type: TYPE,
      version: VERSION,
      updatedAt: new Date().toISOString(),
      deviceId: local.deviceId || state().deviceId,
      units: mergeUnits(local.units, remote.units)
    };
  }

  function stamp(snap) {
    var t = snap && snap.updatedAt ? Date.parse(snap.updatedAt) : NaN;
    return isNaN(t) ? 0 : t;
  }

  function hasAnyData(snap) {
    var units = (snap && snap.units) || {};
    return Object.keys(units).some(function (k) {
      var u = units[k] || {};
      return (u.wrong && u.wrong.length) || (u.records && u.records.length);
    });
  }

  /* ------------------------------------------------------------ 网络 */
  function errorText(status, data) {
    if (status === 401) return '令牌无效或已过期（401）';
    if (status === 403) return '权限不足或触发限速（403），令牌需 gists 读写权限';
    if (status === 404) return '找不到 Gist（404），请检查 Gist ID 与令牌权限';
    if (status === 422) return '文件名或内容不合法（422）';
    if (status >= 500) return 'GitHub 服务异常（' + status + '）';
    var msg = data && data.message ? data.message : '';
    return '请求失败（' + status + '）' + (msg ? '：' + msg : '');
  }

  function request(method, path, body) {
    var cfg = config();
    var headers = {
      'Accept': 'application/vnd.github+json',
      'Authorization': 'Bearer ' + cfg.token
    };
    if (body) headers['Content-Type'] = 'application/json';

    var controller = null, timer = null;
    var opts = { method: method, headers: headers, cache: 'no-store' };
    if (body) opts.body = JSON.stringify(body);

    if (typeof AbortController === 'function') {
      controller = new AbortController();
      opts.signal = controller.signal;
      timer = setTimeout(function () { controller.abort(); }, TIMEOUT);
    }

    return global.fetch(API + path, opts).then(function (res) {
      if (timer) clearTimeout(timer);
      return res.text().then(function (text) {
        var data = null;
        try { data = text ? JSON.parse(text) : null; } catch (e) { data = null; }
        if (!res.ok) {
          var err = new Error(errorText(res.status, data));
          err.status = res.status;
          throw err;
        }
        return data;
      });
    }, function (err) {
      if (timer) clearTimeout(timer);
      var e = new Error(err && err.name === 'AbortError' ? '请求超时' : '网络不可用');
      e.network = true;
      throw e;
    });
  }

  function withRetry(fn) {
    var attempt = 0;
    function run() {
      attempt++;
      return fn().catch(function (err) {
        var retryable = err.network || err.status === 429 || err.status >= 500;
        if (!retryable || attempt >= RETRY) throw err;
        return new Promise(function (resolve) { setTimeout(resolve, 700 * attempt); }).then(run);
      });
    }
    return run();
  }

  function filename() {
    return config().filename || DEFAULT_FILE;
  }

  function pull() {
    var cfg = config();
    return withRetry(function () {
      return request('GET', '/gists/' + encodeURIComponent(cfg.gistId) + '?t=' + Date.now());
    }).then(function (data) {
      var file = data && data.files && data.files[filename()];
      if (!file || typeof file.content !== 'string' || !file.content) return null;
      try {
        var snap = JSON.parse(file.content);
        return snap && snap.type === TYPE ? snap : null;
      } catch (e) {
        return null;   /* 内容损坏：当作没有远端数据，下次推送覆盖 */
      }
    });
  }

  function push(snap) {
    var cfg = config();
    var body = { files: {} };
    body.files[filename()] = { content: JSON.stringify(snap, null, 1) };
    return withRetry(function () {
      return request('PATCH', '/gists/' + encodeURIComponent(cfg.gistId), body);
    });
  }

  /* ------------------------------------------------------------ 同步 */
  function syncOnce() {
    var st = state();
    var local = buildSnapshot();
    var localAt = Store.updatedAt();

    return pull().then(function (remote) {
      if (!remote) {
        return push(local).then(function () { return { action: 'push', snap: local }; });
      }
      var remoteAt = stamp(remote);
      var localChanged = localAt > st.lastSyncAt;
      /* 老数据没有时间信标但本地有内容：按「本地有改动」处理，走合并 */
      if (!localChanged && !localAt && hasAnyData(local)) localChanged = true;
      var remoteChanged = remoteAt > st.lastSyncAt;

      if (!localChanged && !remoteChanged) {
        return { action: 'none', snap: remote };
      }
      if (!localChanged && remoteChanged) {
        applySnapshot(remote);
        return { action: 'pull', snap: remote };
      }
      if (localChanged && !remoteChanged) {
        return push(local).then(function () { return { action: 'push', snap: local }; });
      }
      var merged = mergeSnapshots(local, remote);
      applySnapshot(merged);
      return push(merged).then(function () { return { action: 'merge', snap: merged }; });
    }).then(function (res) {
      saveState({ lastSyncAt: Date.now(), lastError: '' });
      notify({ action: 'done', result: res });
      return res;
    }, function (err) {
      saveState({ lastError: err && err.message ? err.message : '同步失败' });
      notify({ action: 'error', error: err });
      throw err;
    });
  }

  function sync() {
    if (pending) return pending;
    if (!configured()) return Promise.reject(new Error('请先填写 Gist ID 与访问令牌'));
    pending = syncOnce().then(function (res) {
      pending = null;
      return res;
    }, function (err) {
      pending = null;
      throw err;
    });
    return pending;
  }

  function syncWithNotice() {
    if (!configured()) return Promise.reject(new Error('请先填写 Gist ID 与访问令牌'));
    notify({ action: 'start' });
    return sync();
  }

  /** 进入页面时调用：只有配置了且开着自动同步才需要等它 */
  function bootSync() {
    if (!autoEnabled()) return null;
    return syncWithNotice().catch(function () { return null; });
  }

  function testConnection() {
    if (!configured()) return Promise.reject(new Error('请先填写 Gist ID 与访问令牌'));
    return pull().then(function (snap) {
      return { ok: true, hasData: !!snap, updatedAt: snap ? snap.updatedAt : null };
    });
  }

  /* ------------------------------------------------------- 剪贴板同步 */
  function exportText() {
    return JSON.stringify(buildSnapshot(), null, 2);
  }

  function importText(text) {
    var snap = null;
    try { snap = JSON.parse(String(text || '')); } catch (e) { snap = null; }
    if (!snap || snap.type !== TYPE) throw new Error('不是本应用的同步数据');
    if (!snap.units || typeof snap.units !== 'object') throw new Error('同步数据缺少内容');

    var merged = mergeSnapshots(buildSnapshot(), snap);
    applySnapshot(merged);
    /* 手动导入算本地改动：把时间信标推到最新，之后云同步会把这份数据推上去 */
    try { global.localStorage.setItem(Store.keys.updatedAt, String(Date.now())); } catch (e) {}

    var records = 0, wrong = 0;
    Object.keys(merged.units).forEach(function (k) {
      records += (merged.units[k].records || []).length;
      wrong += (merged.units[k].wrong || []).length;
    });
    return { records: records, wrong: wrong };
  }

  function copyToClipboard(text) {
    if (global.navigator && global.navigator.clipboard && global.navigator.clipboard.writeText) {
      return global.navigator.clipboard.writeText(text).then(function () { return true; });
    }
    return new Promise(function (resolve, reject) {
      try {
        var ta = document.createElement('textarea');
        ta.value = text;
        ta.setAttribute('readonly', '');
        ta.style.position = 'fixed';
        ta.style.top = '-1000px';
        ta.style.opacity = '0';
        document.body.appendChild(ta);
        ta.select();
        ta.setSelectionRange(0, ta.value.length);
        var ok = document.execCommand && document.execCommand('copy');
        document.body.removeChild(ta);
        ok ? resolve(true) : reject(new Error('浏览器不允许写入剪贴板'));
      } catch (e) {
        reject(new Error('复制失败：' + (e && e.message ? e.message : '未知错误')));
      }
    });
  }

  function readClipboard() {
    if (global.navigator && global.navigator.clipboard && global.navigator.clipboard.readText) {
      return global.navigator.clipboard.readText();
    }
    return Promise.reject(new Error('浏览器不允许读取剪贴板，请手动粘贴'));
  }

  /* ------------------------------------------------------------ 订阅 */
  function notify(event) {
    listeners.forEach(function (fn) {
      try { fn(event); } catch (e) {}
    });
  }

  function subscribe(fn) { listeners.push(fn); }

  global.XCTKSync = {
    subscribe: subscribe,
    config: config,
    saveConfig: saveConfig,
    configured: configured,
    autoEnabled: autoEnabled,
    state: state,
    sync: sync,
    syncWithNotice: syncWithNotice,
    bootSync: bootSync,
    testConnection: testConnection,
    exportText: exportText,
    importText: importText,
    copyToClipboard: copyToClipboard,
    readClipboard: readClipboard,
    buildSnapshot: buildSnapshot,
    applySnapshot: applySnapshot,
    isSyncing: function () { return !!pending; }
  };
})(window);
