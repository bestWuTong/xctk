/* ==========================================================================
   本地存储层
   - 记录：每次交卷存一条（时长、正确率、每题作答）
   - 错题本：按题库单元归档题目 id
   - 写操作会打一个时间信标，同步层据此判断「本地有没有未推送的改动」
   localStorage 不可用时自动降级为内存，功能不中断。
   ========================================================================== */

(function (global) {
  'use strict';

  var K = {
    records: 'xctk.records.v1',
    wrong: 'xctk.wrong.v1',
    sync: 'xctk.sync.v1',
    syncState: 'xctk.sync.state.v1',
    updatedAt: 'xctk.data.updatedAt'
  };

  var MAX_RECORDS = 300;

  /* --------------------------------------------------------- 存储适配层 */
  var memory = {};

  function sget(key) {
    try {
      var v = global.localStorage.getItem(key);
      return v === null ? (key in memory ? memory[key] : null) : v;
    } catch (e) {
      return key in memory ? memory[key] : null;
    }
  }

  function sset(key, value) {
    memory[key] = value;
    try { global.localStorage.setItem(key, value); } catch (e) { /* 隐私模式 */ }
  }

  function read(key, fallback) {
    var raw = sget(key);
    if (!raw) return fallback;
    try {
      var v = JSON.parse(raw);
      return v === null || v === undefined ? fallback : v;
    } catch (e) {
      return fallback;
    }
  }

  function write(key, value) { sset(key, JSON.stringify(value)); }

  /** 数据变更：时间戳 + 事件（同步层用来防抖推送） */
  function touched(silent) {
    sset(K.updatedAt, String(Date.now()));
    if (!silent) {
      try {
        global.dispatchEvent(new CustomEvent('xctk:data-changed'));
      } catch (e) { /* 忽略 */ }
    }
  }

  function updatedAt() {
    return Number(sget(K.updatedAt) || 0) || 0;
  }

  function uniq(list) {
    var seen = {}, out = [];
    (list || []).forEach(function (v) {
      if (typeof v !== 'string' || !v || seen[v]) return;
      seen[v] = 1;
      out.push(v);
    });
    return out;
  }

  function uid() {
    return Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 7);
  }

  /* ------------------------------------------------------------- 记录 */
  var Records = {
    list: function () {
      var list = read(K.records, []);
      if (!Array.isArray(list)) return [];
      return list.slice().sort(function (a, b) { return (b.at || 0) - (a.at || 0); });
    },

    add: function (rec) {
      var list = read(K.records, []);
      if (!Array.isArray(list)) list = [];
      rec.id = rec.id || uid();
      list.push(rec);
      if (list.length > MAX_RECORDS) {
        list.sort(function (a, b) { return (a.at || 0) - (b.at || 0); });
        list = list.slice(list.length - MAX_RECORDS);
      }
      write(K.records, list);
      touched();
      return rec;
    },

    remove: function (id) {
      var list = read(K.records, []);
      if (!Array.isArray(list)) return;
      write(K.records, list.filter(function (r) { return r.id !== id; }));
      touched();
    },

    clear: function () {
      write(K.records, []);
      touched();
    },

    /** 汇总：次数 / 总正确率 / 累计时长 */
    stats: function () {
      var list = this.list();
      var total = 0, correct = 0, ms = 0;
      list.forEach(function (r) {
        total += r.total || 0;
        correct += r.correct || 0;
        ms += r.ms || 0;
      });
      return {
        sessions: list.length,
        total: total,
        correct: correct,
        ms: ms,
        acc: total ? correct / total : null
      };
    },

    /** 某个单元的最近一次记录 */
    lastOf: function (unitId) {
      var list = this.list();
      for (var i = 0; i < list.length; i++) {
        if (list[i].unit === unitId) return list[i];
      }
      return null;
    },

    /** 某个单元练习过几次 */
    countOf: function (unitId) {
      return this.list().filter(function (r) { return r.unit === unitId; }).length;
    }
  };

  /* ----------------------------------------------------------- 错题本 */
  var Wrong = {
    all: function () {
      var v = read(K.wrong, {});
      if (!v || typeof v !== 'object' || Array.isArray(v)) return {};
      var out = {};
      Object.keys(v).forEach(function (k) {
        out[k] = uniq(Array.isArray(v[k]) ? v[k] : []);
      });
      return out;
    },

    get: function (unitId) {
      var all = this.all();
      return all[unitId] || [];
    },

    count: function (unitId) {
      return this.get(unitId).length;
    },

    total: function () {
      var all = this.all(), n = 0;
      Object.keys(all).forEach(function (k) { n += all[k].length; });
      return n;
    },

    /** 批量加入（交卷时调用），返回实际新增数 */
    addMany: function (unitId, ids) {
      var all = this.all();
      var cur = all[unitId] || [];
      var seen = {};
      cur.forEach(function (id) { seen[id] = 1; });
      var added = 0;
      (ids || []).forEach(function (id) {
        if (typeof id !== 'string' || !id || seen[id]) return;
        seen[id] = 1;
        cur.push(id);
        added++;
      });
      if (added) {
        all[unitId] = cur;
        write(K.wrong, all);
        touched();
      }
      return added;
    },

    remove: function (unitId, qid) {
      var all = this.all();
      var cur = all[unitId] || [];
      var next = cur.filter(function (id) { return id !== qid; });
      if (next.length === cur.length) return false;
      if (next.length) all[unitId] = next; else delete all[unitId];
      write(K.wrong, all);
      touched();
      return true;
    },

    removeMany: function (unitId, ids) {
      var all = this.all();
      var drop = {};
      (ids || []).forEach(function (id) { drop[id] = 1; });
      var cur = all[unitId] || [];
      var next = cur.filter(function (id) { return !drop[id]; });
      if (next.length === cur.length) return;
      if (next.length) all[unitId] = next; else delete all[unitId];
      write(K.wrong, all);
      touched();
    },

    clear: function () {
      write(K.wrong, {});
      touched();
    },

    /** 同步/导入时整表替换（静默，不发事件） */
    replace: function (obj) {
      var out = {};
      Object.keys(obj || {}).forEach(function (k) {
        var ids = uniq(Array.isArray(obj[k]) ? obj[k] : []);
        if (ids.length) out[k] = ids;
      });
      write(K.wrong, out);
    }
  };

  /* ------------------------------------------- 记录整表替换（同步用） */
  function replaceRecords(list) {
    var clean = (Array.isArray(list) ? list : []).filter(function (r) {
      return r && typeof r.unit === 'string' && typeof r.at === 'number';
    }).sort(function (a, b) { return (a.at || 0) - (b.at || 0); });
    if (clean.length > MAX_RECORDS) clean = clean.slice(clean.length - MAX_RECORDS);
    write(K.records, clean);
  }

  /** 合并两条记录流：按 id 去重，保留时间较新的字段 */
  function mergeRecords(a, b) {
    var map = {};
    var order = [];
    (a || []).concat(b || []).forEach(function (r) {
      if (!r || !r.id) return;
      if (!map[r.id]) {
        map[r.id] = r;
        order.push(r.id);
      } else if ((r.at || 0) > (map[r.id].at || 0)) {
        map[r.id] = r;
      }
    });
    return order.map(function (id) { return map[id]; });
  }

  global.XCTKStore = {
    keys: K,
    Records: Records,
    Wrong: Wrong,
    replaceRecords: replaceRecords,
    mergeRecords: mergeRecords,
    updatedAt: updatedAt,
    touch: function () { touched(); },
    read: read,
    write: write,
    uid: uid,
    uniq: uniq
  };
})(window);
