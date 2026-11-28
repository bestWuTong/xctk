/* ==========================================================================
   行测题库速练 · 交互逻辑
   ========================================================================== */

(function () {
  'use strict';

  var Store = window.XCTKStore;
  var Sync = window.XCTKSync;
  var DATA = window.XCTK_DATA || { cats: [], units: [] };

  var UNITS = {};
  DATA.units.forEach(function (u) { UNITS[u.id] = u; });
  var CATS = {};
  DATA.cats.forEach(function (c) { CATS[c.id] = c; });

  var LETTERS = ['A', 'B', 'C', 'D'];

  /* ------------------------------------------------------------ 小工具 */
  function $(sel, root) { return (root || document).querySelector(sel); }
  function $$(sel, root) { return Array.prototype.slice.call((root || document).querySelectorAll(sel)); }

  function el(tag, cls, text) {
    var n = document.createElement(tag);
    if (cls) n.className = cls;
    if (text != null) n.textContent = text;
    return n;
  }

  function esc(s) {
    return String(s == null ? '' : s)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  /** 00:00 / 1:02:03 */
  function fmtClock(ms) {
    var t = Math.max(0, Math.round(ms / 1000));
    var h = Math.floor(t / 3600);
    var m = Math.floor((t % 3600) / 60);
    var s = t % 60;
    var body = String(m).padStart(2, '0') + ':' + String(s).padStart(2, '0');
    return h ? h + ':' + body : body;
  }

  /** 1分20秒 / 45秒 */
  function fmtSpan(ms) {
    var t = Math.max(0, Math.round(ms / 1000));
    if (t < 60) return t + ' 秒';
    var m = Math.floor(t / 60), s = t % 60;
    return m + ' 分' + (s ? ' ' + s + ' 秒' : '');
  }

  function fmtDate(ts) {
    var d = new Date(ts);
    var now = new Date();
    var sameDay = d.toDateString() === now.toDateString();
    var hm = String(d.getHours()).padStart(2, '0') + ':' + String(d.getMinutes()).padStart(2, '0');
    if (sameDay) return '今天 ' + hm;
    var y = new Date(now.getTime() - 86400000);
    if (d.toDateString() === y.toDateString()) return '昨天 ' + hm;
    return (d.getMonth() + 1) + ' 月 ' + d.getDate() + ' 日 ' + hm;
  }

  function pct(n) { return Math.round(n * 100); }

  /* ------------------------------------------------------------ Toast */
  var toastEl = $('#toast');
  var toastTimer = null;
  function toast(msg, kind) {
    toastEl.textContent = msg;
    toastEl.className = 'toast is-show' + (kind === 'err' ? ' err' : '');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(function () { toastEl.className = 'toast'; }, 2600);
  }

  /* --------------------------------------------------------- 对话框 */
  var dialogEl = $('#dialog');
  var dialogResolve = null;

  function closeDialog() {
    dialogEl.classList.remove('is-open');
    dialogEl.setAttribute('aria-hidden', 'true');
    document.removeEventListener('keydown', dialogKey);
  }

  function dialogKey(e) {
    if (e.key === 'Escape' && dialogResolve) {
      var r = dialogResolve;
      dialogResolve = null;
      closeDialog();
      r(null);
    }
  }

  dialogEl.addEventListener('click', function (e) {
    if (e.target === dialogEl && dialogResolve) {
      var r = dialogResolve;
      dialogResolve = null;
      closeDialog();
      r(null);
    }
  });

  function dialog(opts) {
    return new Promise(function (resolve) {
      dialogResolve = resolve;
      $('#dialog-title').textContent = opts.title || '提示';
      $('#dialog-text').textContent = opts.text || '';
      var box = $('#dialog-actions');
      box.innerHTML = '';
      (opts.buttons || [{ label: '知道了', value: true, primary: true }]).forEach(function (b) {
        var btn = el('button', 'btn ' + (b.primary ? 'btn-primary' : 'btn-ghost'), b.label);
        btn.addEventListener('click', function () {
          dialogResolve = null;
          closeDialog();
          resolve(b.value);
        });
        box.appendChild(btn);
      });
      dialogEl.classList.add('is-open');
      dialogEl.setAttribute('aria-hidden', 'false');
      document.addEventListener('keydown', dialogKey);
    });
  }

  /* ------------------------------------------------------------ 视图 */
  var current = null;

  function show(name) {
    if (current === name) return;
    $$('.view').forEach(function (v) {
      v.classList.remove('is-active', 'is-enter');
    });
    var v = $('#view-' + name);
    if (!v) return;
    v.classList.add('is-active', 'is-enter');
    /* 动画结束就摘掉，避免 transform 关键帧把 fixed 子元素钉在本元素上 */
    setTimeout(function () { v.classList.remove('is-enter'); }, 520);
    current = name;
    $$('.nav-link').forEach(function (b) {
      b.classList.toggle('is-active', b.dataset.nav === name);
    });
    window.scrollTo({ top: 0, behavior: 'auto' });
    document.body.dataset.view = name;
  }

  /* ------------------------------------------------------------ 首页 */
  function renderStats() {
    var s = Store.Records.stats();
    $('#stat-sessions').textContent = s.sessions;
    $('#stat-acc').innerHTML = s.acc == null
      ? '—'
      : pct(s.acc) + '<span class="unit">%</span>';
    var mins = Math.round(s.ms / 60000);
    if (mins >= 60) {
      var h = Math.floor(mins / 60), m = mins % 60;
      $('#stat-time').innerHTML = h + '<span class="unit">h</span>' + (m ? ' ' + m + '<span class="unit">m</span>' : '');
    } else {
      $('#stat-time').innerHTML = mins + '<span class="unit">m</span>';
    }
  }

  function unitSummary(u) {
    var last = Store.Records.lastOf(u.id);
    var wrong = Store.Wrong.count(u.id);
    var times = Store.Records.countOf(u.id);
    return { last: last, wrong: wrong, times: times };
  }

  var GROUP_LABELS = { sprint: '冲刺专项' };

  function renderHome() {
    renderStats();
    var host = $('#cat-list');
    host.innerHTML = '';

    DATA.cats.forEach(function (cat) {
      var units = DATA.units.filter(function (u) { return u.cat === cat.id; });
      if (!units.length) return;

      var sec = el('section', 'cat');
      var head = el('div', 'cat-head');
      head.appendChild(el('h2', 'cat-title', cat.name));
      var done = units.reduce(function (n, u) { return n + (Store.Records.countOf(u.id) ? 1 : 0); }, 0);
      head.appendChild(el('span', 'cat-desc', cat.desc + ' · 已练 ' + done + '/' + units.length));
      sec.appendChild(head);

      /* 套卷和冲刺专项分组展示，编号在全分类内连续 */
      var main = units.filter(function (u) { return !u.group; });
      var groups = [];
      var order = [];
      units.forEach(function (u) {
        if (!u.group) return;
        if (!groups[u.group]) { groups[u.group] = []; order.push(u.group); }
        groups[u.group].push(u);
      });

      var seq = 1;
      function grid(items) {
        var g = el('div', 'unit-grid');
        items.forEach(function (u) { g.appendChild(unitCard(u, seq++)); });
        return g;
      }

      if (main.length) sec.appendChild(grid(main));
      order.forEach(function (key) {
        sec.appendChild(el('div', 'group-head', GROUP_LABELS[key] || key));
        sec.appendChild(grid(groups[key]));
      });

      host.appendChild(sec);
    });
  }

  function unitCard(u, num) {
    var s = unitSummary(u);
    var card = el('div', 'unit-card');
    card.setAttribute('role', 'button');
    card.setAttribute('tabindex', '0');
    card.style.animation = 'revealIn .7s var(--ease-out) both';
    card.style.animationDelay = Math.min(num, 12) * 45 + 'ms';

    var top = el('div', 'uc-top');
    top.appendChild(el('span', 'uc-index', String(num).padStart(2, '0')));
    var badge;
    if (s.wrong) badge = el('span', 'uc-badge is-wrong', '错题 ' + s.wrong);
    else if (s.last) badge = el('span', 'uc-badge is-done', '正确率 ' + pct(s.last.correct / (s.last.total || 1)) + '%');
    else badge = el('span', 'uc-badge', '未开始');
    top.appendChild(badge);
    card.appendChild(top);

    card.appendChild(el('div', 'uc-title', u.title));

    var meta = el('div', 'uc-meta');
    meta.appendChild(el('span', null, u.questions.length + ' 题'));
    meta.appendChild(el('span', 'sep'));
    meta.appendChild(el('span', null, '建议 ' + Math.max(5, Math.round(u.questions.length * 0.5)) + ' 分钟'));
    if (s.times) {
      meta.appendChild(el('span', 'sep'));
      meta.appendChild(el('span', null, '练过 ' + s.times + ' 次'));
    }
    card.appendChild(meta);

    var foot = el('div', 'uc-foot');
    foot.appendChild(el('span', null, s.last
      ? '上次 ' + fmtClock(s.last.ms) + ' · 对 ' + s.last.correct + '/' + s.last.total
      : '限时模考 · 交卷即看解析'));
    var go = el('span', 'uc-go');
    go.innerHTML = '开始<svg viewBox="0 0 24 24" width="14" height="14"><path d="M9 5l7 7-7 7" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"/></svg>';
    foot.appendChild(go);
    card.appendChild(foot);

    card.addEventListener('click', function () { openUnit(u.id); });
    card.addEventListener('keydown', function (e) {
      if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); openUnit(u.id); }
    });
    return card;
  }

  /* ------------------------------------------------------------ 答题 */
  var quiz = null;   /* { unit, idx, answers, timer } */

  function T() {
    return {
      base: 0,
      startAt: 0,
      paused: false,
      id: null
    };
  }

  function elapsed() {
    if (!quiz) return 0;
    var t = quiz.timer;
    if (t.paused) return t.base;
    return t.base + (performance.now() - t.startAt);
  }

  function tickTimer() {
    $('#timer-text').textContent = fmtClock(elapsed());
  }

  function timerRun() {
    var t = quiz.timer;
    t.paused = false;
    t.startAt = performance.now();
    clearInterval(t.id);
    t.id = setInterval(tickTimer, 250);
    $('#timer').classList.remove('is-paused');
    $('#pause-veil').classList.remove('is-open');
    $('#pause-veil').setAttribute('aria-hidden', 'true');
    $('#timer-toggle').setAttribute('aria-label', '暂停计时');
    tickTimer();
  }

  function timerHold() {
    var t = quiz.timer;
    if (t.paused) return;
    t.base += performance.now() - t.startAt;
    t.paused = true;
    clearInterval(t.id);
    t.id = null;
    tickTimer();
    $('#timer').classList.add('is-paused');
    $('#pause-veil').classList.add('is-open');
    $('#pause-veil').setAttribute('aria-hidden', 'false');
    $('#timer-toggle').setAttribute('aria-label', '继续计时');
  }

  function timerDestroy() {
    if (quiz && quiz.timer.id) clearInterval(quiz.timer.id);
  }

  async function openUnit(unitId) {
    var unit = UNITS[unitId];
    if (!unit) return;

    var last = Store.Records.lastOf(unitId);
    if (last) {
      var go = await dialog({
        title: '再练一次？',
        text: unit.title + '　共 ' + unit.questions.length + ' 题\n上次最好成绩：对 ' +
          last.correct + '/' + last.total + '，用时 ' + fmtClock(last.ms),
        buttons: [
          { label: '取消', value: false },
          { label: '开始', value: true, primary: true }
        ]
      });
      if (!go) return;
    }
    startQuiz(unit);
  }

  function startQuiz(unit) {
    quiz = {
      unit: unit,
      idx: 0,
      answers: {},
      timer: T(),
      autoTimer: null
    };
    show('quiz');
    document.body.dataset.view = 'quiz';
    renderQuizMeta();
    renderQuestion(true);
    timerRun();
  }

  function renderQuizMeta() {
    var u = quiz.unit;
    $('#quiz-title').textContent = u.title;
    $('#quiz-sub').textContent = (CATS[u.cat] ? CATS[u.cat].name : '') + ' · 共 ' + u.questions.length + ' 题';
  }

  function renderQuestion(initial) {
    var u = quiz.unit;
    var q = u.questions[quiz.idx];
    if (!q) return;

    var card = $('#q-card');
    card.classList.remove('swap');
    void card.offsetWidth;
    if (!initial) card.classList.add('swap');

    $('#q-no').textContent = q.n;
    $('#q-tag').textContent = CATS[u.cat] ? CATS[u.cat].name : '单选题';

    $('#q-stem').textContent = q.s;

    var box = $('#q-options');
    box.innerHTML = '';
    q.o.forEach(function (text, i) {
      var b = el('button', 'opt');
      b.type = 'button';
      b.style.setProperty('--i', i);
      b.dataset.key = LETTERS[i];
      var k = el('span', 'opt-key', LETTERS[i]);
      var t = el('span', 'opt-text', text);
      b.appendChild(k);
      b.appendChild(t);
      if (quiz.answers[q.id] === LETTERS[i]) b.classList.add('is-selected');
      b.addEventListener('click', function () { pick(LETTERS[i]); });
      box.appendChild(b);
    });

    var answered = Object.keys(quiz.answers).length;
    $('#quiz-index').textContent = '第 ' + (quiz.idx + 1) + ' 题 / 共 ' + u.questions.length + ' 题 · 已答 ' + answered;
    $('#quiz-progress').style.width = ((quiz.idx + 1) / u.questions.length * 100) + '%';

    $('#quiz-prev').disabled = quiz.idx === 0;
    var isLast = quiz.idx === u.questions.length - 1;
    var nextBtn = $('#quiz-next');
    nextBtn.textContent = isLast ? '交卷' : '下一题';
    nextBtn.className = 'btn ' + (isLast ? 'btn-primary' : 'btn-ghost');
    if (!isLast && quiz.answers[q.id]) {
      nextBtn.className = 'btn btn-primary';
    }
  }

  function pick(key) {
    var q = quiz.unit.questions[quiz.idx];
    var wasEmpty = !quiz.answers[q.id];
    quiz.answers[q.id] = key;

    $$('#q-options .opt').forEach(function (b) {
      b.classList.toggle('is-selected', b.dataset.key === key);
    });

    var answered = Object.keys(quiz.answers).length;
    $('#quiz-index').textContent = '第 ' + (quiz.idx + 1) + ' 题 / 共 ' + quiz.unit.questions.length + ' 题 · 已答 ' + answered;

    var nextBtn = $('#quiz-next');
    if (quiz.idx < quiz.unit.questions.length - 1) nextBtn.className = 'btn btn-primary';

    /* 首次作答后自动前进，保持速练节奏 */
    clearTimeout(quiz.autoTimer);
    if (wasEmpty && quiz.idx < quiz.unit.questions.length - 1) {
      quiz.autoTimer = setTimeout(function () { goNext(); }, 340);
    }
  }

  function goNext() {
    clearTimeout(quiz.autoTimer);
    if (!quiz) return;
    if (quiz.idx >= quiz.unit.questions.length - 1) { trySubmit(); return; }
    quiz.idx++;
    renderQuestion(false);
  }

  function goPrev() {
    clearTimeout(quiz.autoTimer);
    if (!quiz || quiz.idx === 0) return;
    quiz.idx--;
    renderQuestion(false);
  }

  async function trySubmit() {
    var unit = quiz.unit;
    var unanswered = unit.questions.filter(function (q) { return !quiz.answers[q.id]; });
    if (unanswered.length) {
      var ok = await dialog({
        title: '还有 ' + unanswered.length + ' 题未作答',
        text: '未作答的题目按答错计算，确定现在交卷吗？',
        buttons: [
          { label: '继续答题', value: false },
          { label: '交卷', value: true, primary: true }
        ]
      });
      if (!ok) return;
    }
    submit();
  }

  function submit() {
    var unit = quiz.unit;
    var ms = elapsed();
    timerDestroy();

    var correct = 0;
    var wrongIds = [];
    unit.questions.forEach(function (q) {
      if (quiz.answers[q.id] === q.a) correct++;
      else wrongIds.push(q.id);
    });

    var rec = {
      id: Store.uid(),
      unit: unit.id,
      unitTitle: unit.title,
      cat: unit.cat,
      catName: CATS[unit.cat] ? CATS[unit.cat].name : '',
      at: Date.now(),
      ms: ms,
      total: unit.questions.length,
      correct: correct,
      answers: Object.assign({}, quiz.answers)
    };
    Store.Records.add(rec);
    if (wrongIds.length) Store.Wrong.addMany(unit.id, wrongIds);

    renderResult(rec);
    show('result');

    if (Sync.autoEnabled()) {
      Sync.syncWithNotice().catch(function () {});
    }
    quiz = null;
  }

  /* ------------------------------------------------------------ 结算 */
  var resultState = { rec: null, filter: 'all', expandAll: false };

  function renderResult(rec) {
    resultState.rec = rec;
    resultState.filter = 'all';
    resultState.expandAll = false;

    var unit = UNITS[rec.unit];
    var total = rec.total || 1;
    var acc = rec.correct / total;

    $('#result-title').textContent = rec.unitTitle;
    $('#result-sub').textContent = (rec.catName || '') + ' · ' + fmtDate(rec.at);

    $('#result-correct').textContent = rec.correct;
    $('#result-wrong').textContent = total - rec.correct;
    $('#result-time').textContent = fmtClock(rec.ms);
    $('#result-avg').textContent = fmtSpan(rec.ms / total);

    /* 数字与圆环动画 */
    var numEl = $('#result-acc');
    countUp(numEl, Math.round(acc * 100), 900, '%');

    var ring = $('#ring-fg');
    var C = 339.29;
    ring.classList.remove('is-low', 'is-mid');
    if (acc < 0.6) ring.classList.add('is-low');
    else if (acc < 0.8) ring.classList.add('is-mid');
    ring.style.strokeDashoffset = C;
    /* 强制一次布局，让上面的起点真正生效，再设终值触发过渡 */
    void ring.getBoundingClientRect();
    ring.style.strokeDashoffset = String(C * (1 - acc));

    $$('#result-filter .seg-item').forEach(function (b) {
      b.classList.toggle('is-active', b.dataset.filter === 'all');
    });
    $('#result-expand').textContent = '展开全部解析';

    renderReview();
    if (acc >= 0.8 && total >= 5) burst(acc);
  }

  /** 正确率 80% 以上时的一次性绽放，克制、不打扰 */
  function burst(acc) {
    var hero = $('.result-hero');
    if (!hero) return;
    var layer = el('div', 'confetti-layer');
    var colors = ['var(--accent)', 'var(--ok)', 'var(--ink)', 'var(--accent)'];
    var n = acc >= 0.95 ? 16 : 12;
    for (var i = 0; i < n; i++) {
      var p = el('span', 'confetti-piece');
      var ang = (Math.PI * 2 * i) / n + Math.random() * 0.5;
      var dist = 70 + Math.random() * 90;
      p.style.setProperty('--x', Math.cos(ang) * dist + 'px');
      p.style.setProperty('--y', Math.sin(ang) * dist * 0.8 + 'px');
      p.style.setProperty('--c', colors[i % colors.length]);
      p.style.setProperty('--d', Math.round(Math.random() * 120) + 'ms');
      layer.appendChild(p);
    }
    hero.appendChild(layer);
    setTimeout(function () {
      if (layer.parentNode) layer.parentNode.removeChild(layer);
    }, 1600);
  }

  /** 直接写入最终值，再用一次极短的缩放入场——不依赖 rAF，任何环境下都不会显示错数 */
  function countUp(node, target, dur, suffix) {
    node.innerHTML = target + '<span class="pct">' + (suffix || '') + '</span>';
    node.classList.remove('pop');
    void node.offsetWidth;
    node.classList.add('pop');
  }

  function renderReview() {
    var host = $('#review-list');
    var rec = resultState.rec;
    if (!rec) return;
    var unit = UNITS[rec.unit];
    host.innerHTML = '';

    var rows = unit.questions.filter(function (q) {
      if (resultState.filter === 'wrong') return rec.answers[q.id] !== q.a;
      return true;
    });

    if (!rows.length) {
      var e = el('div', 'empty', '全部答对，没有错题。');
      host.appendChild(e);
      return;
    }

    rows.forEach(function (q, i) {
      host.appendChild(reviewItem(q, rec, i));
    });
  }

  function reviewItem(q, rec, i) {
    var mine = rec.answers[q.id] || '';
    var isOk = mine === q.a;
    var isSkip = !mine;

    var wrap = el('article', 'rv ' + (isOk ? 'is-ok' : isSkip ? 'is-skip' : 'is-bad'));
    wrap.style.setProperty('--i', Math.min(i, 12));
    /* 错题默认展开，答对的收起 */
    if (!isOk || resultState.expandAll) wrap.classList.add('is-open');

    var head = el('button', 'rv-head');
    head.type = 'button';
    var mark = el('span', 'rv-mark', isOk ? '✓' : isSkip ? '–' : '✕');
    var main = el('span', 'rv-main');

    var stem = el('span', 'rv-stem', q.n + '. ' + q.s);
    main.appendChild(stem);

    var tags = el('span', 'rv-tags');
    tags.appendChild(el('span', 'rv-tag', '第 ' + q.n + ' 题'));
    if (isSkip) tags.appendChild(el('span', 'rv-tag bad', '未作答'));
    else if (!isOk) tags.appendChild(el('span', 'rv-tag bad', '你选 ' + mine));
    tags.appendChild(el('span', 'rv-tag ok', '答案 ' + q.a));
    main.appendChild(tags);

    var chev = el('span', 'rv-chev');
    chev.innerHTML = '<svg viewBox="0 0 24 24" width="16" height="16"><path d="M6 9l6 6 6-6" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>';

    head.appendChild(mark);
    head.appendChild(main);
    head.appendChild(chev);
    wrap.appendChild(head);

    var body = el('div', 'rv-body');
    var inner = el('div', 'rv-body-inner');
    var pad = el('div', 'rv-body-pad');

    var opts = el('div', 'rv-opts');
    q.o.forEach(function (text, k) {
      var letter = LETTERS[k];
      var cls = 'rv-opt';
      if (letter === q.a) cls += ' is-answer';
      else if (letter === mine) cls += ' is-mine-bad';
      var o = el('div', cls);
      o.appendChild(el('span', 'k', letter));
      o.appendChild(el('span', null, text));
      opts.appendChild(o);
    });
    pad.appendChild(opts);

    if (q.e) {
      var exp = el('div', 'rv-exp');
      exp.textContent = q.e;
      pad.appendChild(exp);
    } else {
      pad.appendChild(el('div', 'rv-exp', '这份资料只提供了答案，没有逐题解析。'));
    }

    inner.appendChild(pad);
    body.appendChild(inner);
    wrap.appendChild(body);

    head.addEventListener('click', function () { wrap.classList.toggle('is-open'); });
    return wrap;
  }

  /* ------------------------------------------------------------ 题卡 */
  function openSheet() {
    if (!quiz) return;
    var grid = $('#sheet-grid');
    grid.innerHTML = '';
    quiz.unit.questions.forEach(function (q, i) {
      var c = el('button', 'sheet-cell');
      c.type = 'button';
      c.textContent = q.n;
      if (quiz.answers[q.id]) c.classList.add('is-done');
      if (i === quiz.idx) c.classList.add('is-cur');
      c.addEventListener('click', function () {
        quiz.idx = i;
        renderQuestion(false);
        closeSheet();
      });
      grid.appendChild(c);
    });
    $('#sheet-veil').classList.add('is-open');
    $('#sheet-veil').setAttribute('aria-hidden', 'false');
  }

  function closeSheet() {
    $('#sheet-veil').classList.remove('is-open');
    $('#sheet-veil').setAttribute('aria-hidden', 'true');
  }

  /* ------------------------------------------------------------ 记录 */
  function renderRecords() {
    var list = Store.Records.list();

    /* 图表 */
    var chartCard = $('#chart-card');
    var recent = list.slice(0, 12).reverse();
    if (recent.length >= 2) {
      chartCard.hidden = false;
      var chart = $('#chart');
      chart.innerHTML = '';
      recent.forEach(function (r, i) {
        var acc = r.correct / (r.total || 1);
        var col = el('div', 'bar-col');
        col.style.setProperty('--i', i);
        var track = el('div', 'bar-track');
        var bar = el('div', 'bar');
        bar.style.height = Math.max(4, Math.round(acc * 100)) + '%';
        if (acc < 0.6) bar.classList.add('is-low');
        bar.title = r.unitTitle + ' · ' + pct(acc) + '% · ' + fmtClock(r.ms);
        track.appendChild(bar);
        col.appendChild(track);
        var d = new Date(r.at);
        col.appendChild(el('div', 'bar-x', (d.getMonth() + 1) + '/' + d.getDate()));
        chart.appendChild(col);
      });
      var avg = recent.reduce(function (n, r) { return n + r.correct / (r.total || 1); }, 0) / recent.length;
      $('#chart-legend').textContent = '平均 ' + pct(avg) + '%';
    } else {
      chartCard.hidden = true;
    }

    /* 列表 */
    var host = $('#record-list');
    host.innerHTML = '';
    if (!list.length) {
      host.appendChild(el('div', 'empty', '还没有练习记录。从首页挑一个题库开始吧。'));
      return;
    }
    list.forEach(function (r, i) {
      host.appendChild(recordRow(r, i));
    });
  }

  function recordRow(r, i) {
    var row = el('div', 'rec');
    row.style.animation = 'revealIn .6s var(--ease-out) both';
    row.style.animationDelay = Math.min(i * 30, 300) + 'ms';

    var acc = r.correct / (r.total || 1);
    var score = el('div', 'rec-score ' + (acc >= 0.8 ? 'good' : acc < 0.6 ? 'low' : ''));
    score.innerHTML = '<b>' + pct(acc) + '</b><span>%</span>';

    var main = el('div', 'rec-main');
    var unit = UNITS[r.unit];
    /* 政治理论下有小黑、超格两套资料，标题用完整书名才不会混 */
    var fullName = (unit && unit.title) ? unit.title : (r.unitTitle || '练习');
    main.appendChild(el('div', 'rec-title', fullName));
    var meta = el('div', 'rec-meta');
    meta.appendChild(el('span', null, fmtDate(r.at)));
    meta.appendChild(el('span', null, '·'));
    meta.appendChild(el('span', null, fmtClock(r.ms)));
    meta.appendChild(el('span', null, '·'));
    meta.appendChild(el('span', null, r.correct + '/' + r.total));
    main.appendChild(meta);

    var del = el('button', 'rec-del');
    del.type = 'button';
    del.setAttribute('aria-label', '删除这条记录');
    del.innerHTML = '<svg viewBox="0 0 24 24" width="15" height="15"><path d="M6 6l12 12M18 6L6 18" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg>';
    del.addEventListener('click', async function (e) {
      e.stopPropagation();
      Store.Records.remove(r.id);
      renderRecords();
      renderStats();
      toast('已删除这条记录');
    });

    row.appendChild(score);
    row.appendChild(main);
    row.appendChild(del);

    row.addEventListener('click', function () {
      var unit = UNITS[r.unit];
      if (!unit) return;
      /* 回放：用记录里的作答还原结算页 */
      renderResult({
        id: r.id,
        unit: r.unit,
        unitTitle: r.unitTitle || unit.title,
        catName: r.catName || '',
        at: r.at,
        ms: r.ms,
        total: r.total,
        correct: r.correct,
        answers: r.answers || {}
      });
      show('result');
    });
    return row;
  }

  /* ------------------------------------------------------------ 设置 */
  function fillSettings() {
    var c = Sync.config();
    $('#cfg-gist').value = c.gistId;
    $('#cfg-token').value = c.token;
    $('#cfg-file').value = c.filename;
    $('#cfg-auto').setAttribute('aria-checked', c.autoSync ? 'true' : 'false');
    updateSyncUI();
  }

  function updateSyncUI() {
    var c = Sync.config();
    var st = Sync.state();
    var badge = $('#sync-badge');
    var status = $('#sync-status');
    status.className = 'sync-status';

    if (!Sync.configured()) {
      badge.className = 'badge';
      badge.textContent = '未配置';
      status.textContent = '填写 Gist ID 与访问令牌后即可跨设备同步。';
      return;
    }
    if (Sync.isSyncing()) {
      badge.className = 'badge wait';
      badge.textContent = '同步中';
    } else if (st.lastError) {
      badge.className = 'badge err';
      badge.textContent = '同步失败';
    } else if (st.lastSyncAt) {
      badge.className = 'badge ok';
      badge.textContent = '已连接';
    } else {
      badge.className = 'badge wait';
      badge.textContent = '待同步';
    }

    var parts = [];
    if (st.lastSyncAt) parts.push('上次同步 ' + timeAgo(st.lastSyncAt));
    else parts.push('尚未同步');
    parts.push('文件 ' + (c.filename || 'xctk-sync.json'));
    status.textContent = parts.join(' · ');

    if (st.lastError) {
      status.className = 'sync-status err';
      status.textContent += '\n' + st.lastError;
    }
  }

  function timeAgo(ts) {
    var d = Date.now() - ts;
    if (d < 60000) return '刚刚';
    if (d < 3600000) return Math.floor(d / 60000) + ' 分钟前';
    if (d < 86400000) return Math.floor(d / 3600000) + ' 小时前';
    return Math.floor(d / 86400000) + ' 天前';
  }

  /* ------------------------------------------------------------ 事件 */
  function bind() {
    $$('[data-nav]').forEach(function (b) {
      b.addEventListener('click', function (e) {
        e.preventDefault();
        var target = b.dataset.nav;
        if (target === 'home') renderHome();
        if (target === 'records') renderRecords();
        if (target === 'settings') { fillSettings(); }
        show(target);
      });
    });

    $('#quiz-exit').addEventListener('click', async function () {
      if (!quiz) { show('home'); return; }
      var answered = Object.keys(quiz.answers).length;
      if (answered) {
        var ok = await dialog({
          title: '退出答题？',
          text: '本次已作答 ' + answered + ' 题，退出后不会保存成绩。',
          buttons: [{ label: '继续答题', value: false }, { label: '退出', value: true, primary: true }]
        });
        if (!ok) return;
      }
      timerDestroy();
      quiz = null;
      renderHome();
      show('home');
    });

    $('#timer-toggle').addEventListener('click', function () {
      if (!quiz) return;
      if (quiz.timer.paused) timerRun(); else timerHold();
    });

    $('#pause-resume').addEventListener('click', function () {
      if (quiz) timerRun();
    });

    $('#quiz-prev').addEventListener('click', goPrev);
    $('#quiz-next').addEventListener('click', goNext);
    $('#quiz-sheet-open').addEventListener('click', openSheet);
    $('#sheet-close').addEventListener('click', closeSheet);
    $('#sheet-submit').addEventListener('click', function () {
      closeSheet();
      if (quiz) trySubmit();
    });
    $('#sheet-veil').addEventListener('click', function (e) {
      if (e.target === $('#sheet-veil')) closeSheet();
    });

    $('#result-filter').addEventListener('click', function (e) {
      var b = e.target.closest('.seg-item');
      if (!b) return;
      resultState.filter = b.dataset.filter;
      $$('#result-filter .seg-item').forEach(function (x) {
        x.classList.toggle('is-active', x === b);
      });
      renderReview();
    });

    $('#result-expand').addEventListener('click', function () {
      resultState.expandAll = !resultState.expandAll;
      this.textContent = resultState.expandAll ? '收起全部解析' : '展开全部解析';
      renderReview();
    });

    $('#result-back').addEventListener('click', function () {
      renderHome();
      show('home');
    });

    $('#result-retry').addEventListener('click', function () {
      var rec = resultState.rec;
      if (!rec || !UNITS[rec.unit]) return;
      startQuiz(UNITS[rec.unit]);
    });

    /* ---- 设置 ---- */
    var saveTimer = null;
    function savePatch(patch) {
      Sync.saveConfig(patch);
      clearTimeout(saveTimer);
      saveTimer = setTimeout(updateSyncUI, 120);
    }
    $('#cfg-gist').addEventListener('input', function () { savePatch({ gistId: this.value }); });
    $('#cfg-token').addEventListener('input', function () { savePatch({ token: this.value }); });
    $('#cfg-file').addEventListener('input', function () { savePatch({ filename: this.value }); });

    $('#cfg-auto').addEventListener('click', function () {
      var on = this.getAttribute('aria-checked') !== 'true';
      this.setAttribute('aria-checked', on ? 'true' : 'false');
      Sync.saveConfig({ autoSync: on });
    });

    $('#btn-test').addEventListener('click', async function () {
      var btn = this;
      btn.disabled = true;
      var old = btn.textContent;
      btn.textContent = '测试中…';
      try {
        var r = await Sync.testConnection();
        toast(r.hasData ? '连接正常，云端已有数据' : '连接正常，云端暂无数据');
      } catch (err) {
        toast(err.message || '连接失败', 'err');
      } finally {
        btn.disabled = false;
        btn.textContent = old;
        updateSyncUI();
      }
    });

    $('#btn-sync').addEventListener('click', async function () {
      var btn = this;
      btn.disabled = true;
      var old = btn.textContent;
      btn.textContent = '同步中…';
      try {
        var r = await Sync.syncWithNotice();
        var map = { push: '已上传本地数据', pull: '已拉取云端数据', merge: '已合并两端数据', none: '两端一致，无需同步' };
        toast(map[r.action] || '同步完成');
        renderStats();
        if (current === 'records') renderRecords();
        if (current === 'home') renderHome();
      } catch (err) {
        toast(err.message || '同步失败', 'err');
      } finally {
        btn.disabled = false;
        btn.textContent = old;
        updateSyncUI();
      }
    });

    $('#btn-export').addEventListener('click', async function () {
      try {
        await Sync.copyToClipboard(Sync.exportText());
        toast('已复制到剪贴板');
      } catch (e) {
        toast(e.message || '复制失败', 'err');
      }
    });

    $('#btn-import').addEventListener('click', async function () {
      try {
        var text = await Sync.readClipboard();
        var res = Sync.importText(text);
        toast('已导入 ' + res.records + ' 条记录、' + res.wrong + ' 道错题');
        renderStats();
        if (current === 'records') renderRecords();
      } catch (e) {
        toast(e.message || '导入失败', 'err');
      }
    });

    $('#btn-clear-records').addEventListener('click', async function () {
      var ok = await dialog({
        title: '清空练习记录？',
        text: '将删除全部练习记录，错题本不受影响。',
        buttons: [{ label: '取消', value: false }, { label: '清空', value: true, primary: true }]
      });
      if (!ok) return;
      Store.Records.clear();
      renderStats();
      renderRecords();
      toast('练习记录已清空');
    });

    $('#btn-clear-wrong').addEventListener('click', async function () {
      var ok = await dialog({
        title: '清空错题本？',
        text: '清空后无法恢复，下次同步会把云端一并清空。',
        buttons: [{ label: '取消', value: false }, { label: '清空', value: true, primary: true }]
      });
      if (!ok) return;
      Store.Wrong.clear();
      renderHome();
      toast('错题本已清空');
    });

    /* 滚动时给导航加分隔线 */
    window.addEventListener('scroll', function () {
      $('#nav').classList.toggle('is-scrolled', window.scrollY > 4);
    }, { passive: true });

    /* 切走页面自动暂停计时 */
    document.addEventListener('visibilitychange', function () {
      if (!quiz || quiz.timer.paused) return;
      if (document.hidden) {
        timerHold();
      }
    });

    /* 键盘：A-D 选择，←/→ 翻页 */
    document.addEventListener('keydown', function (e) {
      if (!quiz || current !== 'quiz' || e.metaKey || e.ctrlKey || e.altKey) return;
      var tag = (e.target.tagName || '').toLowerCase();
      if (tag === 'input' || tag === 'textarea') return;
      var k = e.key.toUpperCase();
      if (LETTERS.indexOf(k) !== -1) {
        e.preventDefault();
        pick(k);
      } else if (e.key === 'ArrowRight') {
        e.preventDefault(); goNext();
      } else if (e.key === 'ArrowLeft') {
        e.preventDefault(); goPrev();
      } else if (e.key === ' ') {
        e.preventDefault();
        if (quiz.timer.paused) timerRun(); else timerHold();
      }
    });

    /* 同步事件 */
    Sync.subscribe(function (ev) {
      if (ev.action === 'start') updateSyncUI();
      if (ev.action === 'done') {
        updateSyncUI();
        if (current === 'home') renderHome();
      }
      if (ev.action === 'error') updateSyncUI();
    });
  }

  /* ------------------------------------------------------------ 启动 */
  function init() {
    if (!DATA.units.length) {
      $('#cat-list').innerHTML = '<div class="empty">题库数据没有加载成功。</div>';
      return;
    }
    bind();
    renderHome();
    show('home');
    document.body.dataset.view = 'home';

    if (Sync.autoEnabled()) {
      Sync.bootSync().then(function () {
        renderHome();
        updateSyncUI();
      });
    }

    /* 深链接：?u=zz-1 直接开始某一套 */
    var m = /[?&]u=([\w-]+)/.exec(location.search);
    if (m && UNITS[m[1]]) startQuiz(UNITS[m[1]]);
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
