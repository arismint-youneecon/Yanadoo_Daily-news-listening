(function () {
  "use strict";
  var CFG = window.CLUB_CONFIG || {};
  var DEMO = !CFG.supabaseUrl;
  var KEY = "enc_code";
  var LKEY = "enc_level";
  var app = document.getElementById("app");
  var tabs = document.getElementById("tabs");
  var state = { code: null, me: null, level: null, notifyTime: "06:40", stats: null, index: null, days: {} };

  // 난이도 1~5단계. 같은 뉴스를 단계마다 다르게 써서 읽어 줍니다.
  var LEVELS = [
    { n: 1, toeic: "토익 300점 수준", desc: "아주 쉬운 단어와 짧은 문장으로, 문장마다 잠깐씩 쉬면서 천천히 읽어요. 영어 뉴스가 처음이라면 여기서 시작하세요.",
      en: "Food prices went up this month. Many people now spend more money at the store.",
      ko: "이번 달에 식료품 가격이 올랐습니다. 많은 사람들이 이제 가게에서 돈을 더 씁니다." },
    { n: 2, toeic: "토익 500점 수준", desc: "기초 단어로 쓴 짧은 문장이에요. 뉴스에 나오는 말은 쉬운 말로 풀어 주고, 조금 천천히 읽어요.",
      en: "Food prices rose again this month. Many families say they are spending more money on groceries.",
      ko: "이번 달에도 식료품 가격이 올랐습니다. 많은 가정이 장보기에 돈을 더 쓰고 있다고 말합니다." },
    { n: 3, toeic: "토익 700점 수준", desc: "자주 쓰는 뉴스 단어가 나오고, 어려운 말은 한 번씩 풀어 줘요. 보통보다 조금 느린 속도예요.",
      en: "Food prices rose for the third month in a row. Many families say they are feeling the pressure at the supermarket.",
      ko: "식료품 가격이 3개월 연속 올랐습니다. 많은 가정이 마트에서 부담을 느낀다고 말합니다." },
    { n: 4, toeic: "토익 850점 수준", desc: "토익 LC Part 4 같은 라디오 뉴스 말투예요. 뉴스 단어를 풀이 없이 그대로 쓰고, 남성 목소리의 미국 발음이에요.",
      en: "Consumer prices climbed for a third consecutive month, driven largely by higher costs for fresh food and energy. Households are cutting back on spending as a result.",
      ko: "소비자 물가가 주로 신선식품과 에너지 비용 상승 때문에 3개월 연속 올랐습니다. 그 결과 가계는 지출을 줄이고 있습니다." },
    { n: 5, toeic: "토익 만점 수준", desc: "실제 영어 뉴스와 같은 어휘와 긴 문장, 빠른 속도예요. 영국 발음으로 들려줘요.",
      en: "Inflation edged up for a third straight month, as stubbornly high food and energy costs continued to squeeze household budgets and weigh on consumer sentiment.",
      ko: "식품과 에너지 비용이 좀처럼 내려가지 않아 가계 예산을 계속 압박하고 소비 심리를 짓누르면서, 물가 상승률이 3개월 연속 소폭 올랐습니다." }
  ];
  function levelInfo(n) { return LEVELS[(n || 3) - 1]; }

  document.getElementById("brand").textContent = CFG.clubName || "아침 영어 뉴스 클럽";

  /* ---------- storage ---------- */
  function load(k) { try { return localStorage.getItem(k); } catch (e) { return null; } }
  function save(k, v) { try { v == null ? localStorage.removeItem(k) : localStorage.setItem(k, v); } catch (e) {} }

  /* ---------- backend ---------- */
  function realApi() {
    function rpc(fn, args) {
      // 예전 anon key(eyJ...)는 Authorization에도 넣고, 새 publishable key(sb_publishable_...)는 apikey에만 넣습니다.
      var headers = { "Content-Type": "application/json", apikey: CFG.supabaseAnonKey };
      if (/^eyJ/.test(CFG.supabaseAnonKey)) headers.Authorization = "Bearer " + CFG.supabaseAnonKey;
      return fetch(CFG.supabaseUrl.replace(/\/$/, "") + "/rest/v1/rpc/" + fn, {
        method: "POST",
        headers: headers,
        body: JSON.stringify(args)
      }).then(function (r) {
        return r.text().then(function (t) {
          var j = null; try { j = t ? JSON.parse(t) : null; } catch (e) {}
          if (!r.ok) throw new Error((j && (j.message || j.hint)) || ("HTTP " + r.status));
          return j;
        });
      });
    }
    return {
      login: function (c) { return rpc("club_login", { p_code: c }); },
      log: function (c, b, k, d) { return rpc("club_log", { p_code: c, p_briefing: b, p_kind: k, p_detail: d == null ? null : d }); },
      setLevel: function (c, n) { return rpc("club_set_level", { p_code: c, p_level: n }); },
      pushSubscribe: function (c, ep, k, a, dev) { return rpc("club_push_subscribe", { p_code: c, p_endpoint: ep, p_p256dh: k, p_auth: a, p_device: dev }); },
      pushUnsubscribe: function (c, ep) { return rpc("club_push_unsubscribe", { p_code: c, p_endpoint: ep }); },
      setNotifyTime: function (c, t) { return rpc("club_set_notify_time", { p_code: c, p_time: t }); },
      pushTest: function (c) { return rpc("club_push_test", { p_code: c }); },
      myStats: function (c) { return rpc("club_my_stats", { p_code: c }); },
      members: function (c) { return rpc("club_admin_members", { p_code: c }); },
      addMember: function (c, n, a) { return rpc("club_admin_add_member", { p_code: c, p_name: n, p_is_admin: !!a }); },
      resetCode: function (c, id) { return rpc("club_admin_reset_code", { p_code: c, p_member: id }); },
      setActive: function (c, id, a) { return rpc("club_admin_set_active", { p_code: c, p_member: id, p_active: a }); }
    };
  }

  // 데모 모드: 실제 서버 없이 이 브라우저에만 기록합니다.
  function demoApi() {
    var DB = "enc_demo_db";
    function kst(d) { return new Date((d || new Date()).getTime() + 9 * 3600e3).toISOString().slice(0, 10); }
    function db() {
      var s = load(DB); if (s) return JSON.parse(s);
      var init = { members: [{ id: "m1", name: "데모 관리자", code: "DEMO2026", is_admin: true, active: true, created_at: new Date().toISOString() }], visits: [], events: [] };
      save(DB, JSON.stringify(init)); return init;
    }
    function put(d) { save(DB, JSON.stringify(d)); }
    function find(d, c) { c = String(c || "").trim().toUpperCase(); return d.members.filter(function (m) { return m.active && m.code === c; })[0] || null; }
    function visit(d, m) { var t = kst(); if (!d.visits.some(function (v) { return v.member_id === m.id && v.day === t; })) d.visits.push({ member_id: m.id, day: t }); }
    function admin(d, c) { var m = find(d, c); if (!m || !m.is_admin) throw new Error("not_admin"); return m; }
    function newCode() { var a = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789", s = ""; for (var i = 0; i < 8; i++) s += a[Math.floor(Math.random() * a.length)]; return s; }
    function p(v) { return new Promise(function (res) { setTimeout(function () { res(v); }, 60); }); }
    function since(days) { return kst(new Date(Date.now() - days * 864e5)); }
    return {
      login: function (c) { var d = db(), m = find(d, c); if (!m) return p(null); visit(d, m); put(d); return p({ name: m.name, is_admin: m.is_admin, level: m.level || null, notify_time: m.notify_time || "06:40" }); },
      pushSubscribe: function () { return p(true); },
      pushUnsubscribe: function () { return p(true); },
      setNotifyTime: function (c, t) { var d = db(), m = find(d, c); if (!m) return p(null); d.members.forEach(function (x) { if (x.id === m.id) x.notify_time = t; }); put(d); return p(t); },
      pushTest: function () { return p(0); },
      setLevel: function (c, n) { var d = db(), m = find(d, c); if (!m) return p(false); d.members.forEach(function (x) { if (x.id === m.id) x.level = n; }); put(d); return p(true); },
      log: function (c, b, k, det) { var d = db(), m = find(d, c); if (!m) return p(false); visit(d, m); d.events.push({ member_id: m.id, briefing_id: b, kind: k, detail: det || null, at: new Date().toISOString() }); put(d); return p(true); },
      myStats: function (c) {
        var d = db(), m = find(d, c); if (!m) return p(null);
        var days = d.visits.filter(function (v) { return v.member_id === m.id; }).map(function (v) { return v.day; });
        var set = {}; days.forEach(function (x) { set[x] = 1; });
        var streak = 0, t = new Date(); if (!set[kst(t)]) t = new Date(t.getTime() - 864e5);
        while (set[kst(t)]) { streak++; t = new Date(t.getTime() - 864e5); }
        var ev = d.events.filter(function (e) { return e.member_id === m.id; });
        var uniq = function (k) { var o = {}; ev.filter(function (e) { return e.kind === k; }).forEach(function (e) { o[e.briefing_id] = 1; }); return Object.keys(o); };
        return p({ name: m.name, streak: streak, days_total: days.length, days_30: days.filter(function (x) { return x > since(30); }).length, visit_days: days.filter(function (x) { return x > since(35); }).sort(), played: uniq("play").length, completed: uniq("complete"), lookups: ev.filter(function (e) { return e.kind === "lookup"; }).length });
      },
      members: function (c) {
        var d = db(); admin(d, c);
        return p(d.members.map(function (m) {
          var vs = d.visits.filter(function (v) { return v.member_id === m.id; }).map(function (v) { return v.day; }).sort();
          var ev = d.events.filter(function (e) { return e.member_id === m.id; });
          var uniq = function (k) { var o = {}; ev.filter(function (e) { return e.kind === k; }).forEach(function (e) { o[e.briefing_id] = 1; }); return Object.keys(o).length; };
          return { id: m.id, name: m.name, is_admin: m.is_admin, active: m.active, created_at: m.created_at, level: m.level || null, notify_time: m.notify_time || "06:40", push_devices: 0, last_visit: vs[vs.length - 1] || null, days_30: vs.filter(function (x) { return x > since(30); }).length, days_total: vs.length, recent_days: vs.filter(function (x) { return x > since(14); }), played: uniq("play"), completed: uniq("complete"), lookups: ev.filter(function (e) { return e.kind === "lookup"; }).length };
        }));
      },
      addMember: function (c, n, a) { var d = db(); admin(d, c); var code = newCode(), id = "m" + (d.members.length + 1) + Date.now(); d.members.push({ id: id, name: n, code: code, is_admin: !!a, active: true, created_at: new Date().toISOString() }); put(d); return p({ id: id, code: code }); },
      resetCode: function (c, id) { var d = db(); admin(d, c); var code = newCode(); d.members.forEach(function (m) { if (m.id === id) m.code = code; }); put(d); return p(code); },
      setActive: function (c, id, a) { var d = db(), me = admin(d, c); if (me.id === id) throw new Error("cannot_change_self"); d.members.forEach(function (m) { if (m.id === id) m.active = a; }); put(d); return p(true); }
    };
  }

  var api = DEMO ? demoApi() : realApi();

  /* ---------- helpers ---------- */
  function el(tag, attrs, kids) {
    var e = document.createElement(tag);
    if (attrs) Object.keys(attrs).forEach(function (k) {
      var v = attrs[k];
      if (v == null || v === false) return;
      if (k === "text") e.textContent = v;
      else if (k === "class") e.className = v;
      else if (k.slice(0, 2) === "on") e.addEventListener(k.slice(2), v);
      else e.setAttribute(k, v === true ? "" : v);
    });
    (kids || []).forEach(function (c) { if (c != null) e.appendChild(typeof c === "string" ? document.createTextNode(c) : c); });
    return e;
  }
  function icon(name) { return el("i", { class: "ti ti-" + name, "aria-hidden": "true" }); }
  function kstToday() { return new Date(Date.now() + 9 * 3600e3).toISOString().slice(0, 10); }
  function fmtDate(iso) {
    if (!iso) return "-";
    var w = "일월화수목금토"[new Date(iso + "T12:00:00Z").getUTCDay()];
    return Number(iso.slice(5, 7)) + "월 " + Number(iso.slice(8, 10)) + "일 (" + w + ")";
  }
  function fmtDur(s) { s = Math.round(s || 0); return Math.floor(s / 60) + "분 " + (s % 60) + "초"; }
  function sectionName(s) { return s === "g" ? "해외" : "국내"; }
  function render(nodes) { app.innerHTML = ""; nodes.forEach(function (n) { if (n) app.appendChild(n); }); window.scrollTo(0, 0); }
  function setTab(name) { Array.prototype.forEach.call(tabs.querySelectorAll("a"), function (a) { if (a.dataset.tab === name) a.setAttribute("aria-current", "page"); else a.removeAttribute("aria-current"); }); }
  function errBox(msg) { return el("div", { class: "card pad" }, [el("p", { class: "err", text: msg })]); }

  function getJSON(url) { return fetch(url, { cache: "no-cache" }).then(function (r) { if (!r.ok) throw new Error("HTTP " + r.status); return r.json(); }); }
  // 예전 형식(단계 구분 없는 브리핑)은 3단계 버전 하나로 봅니다.
  function normIndex(j) { (j.days || []).forEach(function (d) { d.items.forEach(function (it) { if (!it.h) { it.h = {}; it.h["3"] = it.headline; } }); }); return j; }
  function normDay(j) { (j.items || []).forEach(function (it) { if (!it.levels) { var v = {}; ["headline", "p", "tr", "g", "ph", "kw", "audio", "duration"].forEach(function (k) { v[k] = it[k]; }); it.levels = { "3": v }; } }); return j; }
  function getIndex() { return state.index ? Promise.resolve(state.index) : getJSON("data/index.json").then(function (j) { state.index = normIndex(j); return j; }); }
  function getDay(date) { return state.days[date] ? Promise.resolve(state.days[date]) : getJSON("data/" + date + ".json").then(function (j) { state.days[date] = normDay(j); return j; }); }
  // 원하는 단계가 없으면 가장 가까운 단계(같으면 쉬운 쪽)를 고릅니다.
  function nearestLevel(obj, want) {
    var have = Object.keys(obj || {}).map(Number).filter(function (n) { return n >= 1 && n <= 5; });
    if (!have.length) return null;
    have.sort(function (a, b) { return Math.abs(a - want) - Math.abs(b - want) || a - b; });
    return have[0];
  }
  // 이 기기에 저장하는 단계는 접속 코드와 함께 저장해서, 다른 회원이 같은 기기로 들어와도 섞이지 않게 합니다.
  function localLevel(code) { var v = String(load(LKEY) || "").split(":"); return v[0] === code && Number(v[1]) >= 1 && Number(v[1]) <= 5 ? Number(v[1]) : null; }
  function saveLocalLevel(code, n) { save(LKEY, code + ":" + n); }
  function chooseLevel(n) {
    state.level = n; saveLocalLevel(state.code, n);
    if (state.me) state.me.level = n;
    return api.setLevel(state.code, n).catch(function () { return false; });
  }
  function refreshStats() { return api.myStats(state.code).then(function (s) { state.stats = s; return s; }).catch(function () { return state.stats; }); }
  function isDone(id) { return !!(state.stats && state.stats.completed && state.stats.completed.indexOf(id) >= 0); }

  var logged = {};
  function logOnce(bid, kind, detail) {
    var k = bid + "|" + kind + "|" + (detail || "");
    if (kind !== "lookup" && logged[k]) return; logged[k] = 1;
    api.log(state.code, bid, kind, detail).catch(function () {});
  }

  /* ---------- views ---------- */
  function viewLogin(msg) {
    tabs.hidden = true; document.getElementById("who").textContent = "";
    var input = el("input", { id: "code", type: "text", inputmode: "text", autocomplete: "one-time-code", autocapitalize: "characters", spellcheck: "false", maxlength: "12", placeholder: "접속 코드", "aria-label": "접속 코드" });
    var err = el("p", { class: "err", role: "alert", text: msg || "" });
    var btn = el("button", { class: "btn primary", type: "submit", text: "들어가기" });
    var form = el("form", { class: "login", onsubmit: function (e) {
      e.preventDefault();
      var c = input.value.trim().toUpperCase();
      if (c.length < 4) { err.textContent = "접속 코드를 입력해 주세요."; return; }
      btn.disabled = true; err.textContent = "";
      api.login(c).then(function (me) {
        btn.disabled = false;
        if (!me) { err.textContent = "코드를 찾을 수 없어요. 관리자에게 받은 코드를 다시 확인해 주세요."; return; }
        save(KEY, c); start(c, me);
      }).catch(function (e) {
        btn.disabled = false;
        err.textContent = /too_many/.test(e.message) ? "잘못된 시도가 많아 잠시 막혔어요. 10분 뒤 다시 해 주세요." : "연결에 실패했어요. 잠시 뒤 다시 시도해 주세요.";
      });
    } }, [
      el("div", null, [el("p", { class: "eyebrow", text: "매일 아침 2분 영어 뉴스" }), el("h1", { text: CFG.clubName || "아침 영어 뉴스 클럽" })]),
      el("p", { class: "muted", text: "관리자에게 받은 개인 접속 코드를 입력해 주세요. 한 번 들어오면 이 기기에서는 다시 입력하지 않아도 돼요." }),
      input, err, btn,
      DEMO ? el("p", { class: "note", text: "데모 모드예요. 서버에 연결되지 않아 기록이 이 브라우저에만 저장돼요. 데모 관리자 코드: DEMO2026" }) : null
    ]);
    render([form]); input.focus();
  }

  function briefingCard(it, date) {
    var done = isDone(it.id);
    // 목록(index.json)은 it.h에, 날짜 파일은 it.levels에 단계별 제목이 있습니다.
    var heads = it.h || {};
    if (!it.h && it.levels) Object.keys(it.levels).forEach(function (k) { heads[k] = it.levels[k].headline; });
    var lv = nearestLevel(heads, state.level || 3);
    return el("a", { class: "card item " + it.section, href: "#/b/" + date + "/" + it.id }, [
      el("span", { class: "tile" }, [icon(it.icon || (it.section === "g" ? "world" : "map-pin"))]),
      el("span", { class: "txt" }, [
        el("span", { class: "hl", text: heads[lv] || it.headline || "" }),
        el("span", { class: "sub" }, [el("span", { class: "bd " + it.section, text: sectionName(it.section) }), done ? el("span", { class: "bd done", text: "다 들음" }) : null, it.ko])
      ]),
      el("i", { class: "ti ti-chevron-right chev", "aria-hidden": "true" })
    ]);
  }

  function viewToday() {
    setTab("today");
    Promise.all([getIndex(), refreshStats()]).then(function (r) {
      var idx = r[0]; var latest = idx.days && idx.days[0];
      if (!latest) { render([el("div", { class: "card empty", text: "아직 올라온 브리핑이 없어요. 내일 아침에 다시 와 주세요." })]); return; }
      return getDay(latest.date).then(function (day) {
        var s = state.stats || {};
        var isToday = latest.date === kstToday();
        var li = levelInfo(state.level);
        render([
          el("div", null, [
            el("p", { class: "eyebrow", text: (isToday ? "오늘의 브리핑 · " : "가장 최근 브리핑 · ") + fmtDate(latest.date) }),
            el("h1", { text: (state.me ? state.me.name + "님, " : "") + "좋은 아침이에요" })
          ]),
          el("div", { class: "row small", style: "gap:8px;flex-wrap:wrap" }, [
            el("a", { class: "lvchip", href: "#/level", "aria-label": "단계 바꾸기, 지금 " + li.n + "단계" }, [icon("stairs-up"), li.n + "단계 · " + li.toeic, el("span", { class: "muted", text: "바꾸기" })]),
            s.streak ? el("span", { class: "row muted", style: "gap:4px" }, [icon("flame"), "연속 " + s.streak + "일째 접속 중"]) : null
          ]),
          el("div", { class: "list" }, day.items.map(function (it) { return briefingCard(it, latest.date); })),
          el("p", { class: "small muted", text: "대본 없이 한 번 듣고, 대본을 열어 모르는 단어를 확인한 뒤, 다시 한 번 들어 보세요." })
        ]);
      });
    }).catch(function () { render([errBox("브리핑을 불러오지 못했어요. 잠시 뒤 다시 열어 주세요.")]); });
  }

  function viewArchive() {
    setTab("archive");
    Promise.all([getIndex(), refreshStats()]).then(function (r) {
      var days = (r[0].days || []);
      if (!days.length) { render([el("div", { class: "card empty", text: "지난 브리핑이 아직 없어요." })]); return; }
      render([el("h1", { text: "지난 브리핑" })].concat(days.map(function (d) {
        return el("section", { class: "list" }, [el("h2", { text: fmtDate(d.date) })].concat(d.items.map(function (it) { return briefingCard(it, d.date); })));
      })));
    }).catch(function () { render([errBox("목록을 불러오지 못했어요.")]); });
  }

  function viewBriefing(date, id, askLevel) {
    setTab(date === (state.index && state.index.days[0] && state.index.days[0].date) ? "today" : "archive");
    getDay(date).then(function (day) {
      var story = day.items.filter(function (x) { return x.id === id; })[0];
      if (!story) { render([errBox("브리핑을 찾을 수 없어요.")]); return; }
      var myLv = state.level || 3;
      var lv = nearestLevel(story.levels, askLevel || myLv);
      var it = story.levels[lv];
      var tag = "L" + lv;

      // 단계 바꿔 듣기: 이 뉴스만 다른 단계로 봅니다(내 단계는 그대로).
      var lvPills = LEVELS.map(function (L) {
        var has = !!story.levels[L.n];
        return el("a", { class: "pill" + (has ? "" : " off"), href: has ? "#/b/" + date + "/" + id + "/" + L.n : null, "aria-current": L.n === lv ? "true" : null, "aria-disabled": has ? null : "true", "aria-label": L.n + "단계" + (has ? "" : " (없음)"), text: String(L.n) });
      });
      var lvNote = null;
      if (lv !== myLv && !askLevel) lvNote = el("p", { class: "note", text: "이 뉴스는 " + myLv + "단계 버전이 없어서 " + lv + "단계로 보여 드려요." });
      else if (lv !== myLv) lvNote = el("p", { class: "small muted", style: "margin:0" }, [lv + "단계로 듣는 중이에요. ", el("a", { href: "#/b/" + date + "/" + id, text: "내 단계(" + myLv + "단계)로 돌아가기" })]);

      var audio = el("audio", { controls: true, preload: "metadata", src: it.audio || null });
      var completeSent = false;
      audio.addEventListener("play", function () { logOnce(story.id, "play", tag); });
      // "끝까지 들음"은 건너뛰기를 빼고 실제로 재생된 시간이 85%를 넘을 때만 기록합니다.
      var listened = 0, lastT = 0;
      audio.addEventListener("seeking", function () { lastT = audio.currentTime; });
      audio.addEventListener("timeupdate", function () {
        var t = audio.currentTime, dt = t - lastT; lastT = t;
        if (dt > 0 && dt < 1.5 * (audio.playbackRate || 1)) listened += dt;
        if (!completeSent && audio.duration && listened / audio.duration > 0.85) { completeSent = true; logOnce(story.id, "complete", tag); }
      });
      var noAudio = it.audio ? null : el("p", { class: "note", text: "음성 파일 보관 기간(30일)이 지나 대본만 남아 있어요." });
      var speeds = [0.8, 0.9, 1, 1.1];
      var pills = speeds.map(function (sp) {
        return el("button", { type: "button", class: "pill", "aria-pressed": sp === 1 ? "true" : "false", text: sp + "×", onclick: function (e) {
          audio.playbackRate = sp; pills.forEach(function (p) { p.setAttribute("aria-pressed", "false"); }); e.currentTarget.setAttribute("aria-pressed", "true");
        } });
      });

      // 대본: 단어를 누르면 뜻이 나옵니다.
      var G = it.g || {};
      var PH = (it.ph || []).slice().sort(function (a, b) { return b.length - a.length; }).map(function (s) { return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"); });
      var RX = new RegExp("(" + (PH.length ? PH.join("|") + "|" : "") + "[A-Za-z][A-Za-z.'-]*[A-Za-z]|[A-Za-z])", "gi");
      function look(t) {
        var w = t.toLowerCase().replace(/[.']+$/, ""); if (G[w]) return G[w];
        var sf = ["es", "s", "ed", "d"];
        for (var i = 0; i < sf.length; i++) { var s = sf[i]; if (w.length > s.length + 2 && w.slice(-s.length) === s && G[w.slice(0, -s.length)]) return G[w.slice(0, -s.length)]; }
        return null;
      }
      var scriptBox = el("div", { class: "script" });
      (it.p || []).forEach(function (t) {
        var p = el("p"), last = 0, m; RX.lastIndex = 0;
        while ((m = RX.exec(t)) !== null) {
          if (m.index > last) p.appendChild(document.createTextNode(t.slice(last, m.index)));
          p.appendChild(el("span", { class: "w" + (look(m[0]) ? " gl" : ""), tabindex: "0", text: m[0] }));
          last = m.index + m[0].length;
        }
        if (last < t.length) p.appendChild(document.createTextNode(t.slice(last)));
        scriptBox.appendChild(p);
      });
      var info = el("div", { class: "info" }); info.hidden = true; var cur = null;
      function pick(s) {
        if (cur === s) { s.classList.remove("on"); info.hidden = true; cur = null; return; }
        if (cur) cur.classList.remove("on"); s.classList.add("on"); cur = s;
        var word = s.textContent, mean = look(word);
        info.innerHTML = "";
        info.appendChild(el("span", { class: "iw", text: word }));
        info.appendChild(el("span", { class: "im", text: mean || "목록에 없는 단어예요" }));
        info.appendChild(el("a", { class: "btn small", href: "https://en.dict.naver.com/#/search?query=" + encodeURIComponent(word), target: "_blank", rel: "noopener", text: "사전에서 보기" }));
        s.parentNode.after(info); info.hidden = false;
        logOnce(story.id, "lookup", word.toLowerCase());
      }
      scriptBox.addEventListener("click", function (e) { if (e.target.classList && e.target.classList.contains("w")) pick(e.target); });
      scriptBox.addEventListener("keydown", function (e) { if ((e.key === "Enter" || e.key === " ") && e.target.classList && e.target.classList.contains("w")) { e.preventDefault(); pick(e.target); } });

      var sc = el("div", { class: "card pad", hidden: true }, [el("p", { class: "hint", text: "점선 단어는 누르면 바로 뜻이 나와요. 다른 단어는 사전에서 찾아볼 수 있어요." }), scriptBox]);
      var tr = el("div", { class: "card pad tr", hidden: true }, (it.tr || []).map(function (t) { return el("p", { text: t }); }));
      var kv = el("div", { class: "card pad", hidden: true }, [el("div", { class: "kw" }, [].concat.apply([], (it.kw || []).map(function (k) { return [el("span", { class: "en", text: k[0] }), el("span", { class: "ko", text: k[1] })]; })))]);
      function toggle(panel, labelOn, labelOff, kind) {
        var b = el("button", { type: "button", class: "btn small", "aria-expanded": "false", text: labelOff, onclick: function () {
          var open = panel.hidden; panel.hidden = !open; b.setAttribute("aria-expanded", open ? "true" : "false"); b.textContent = open ? labelOn : labelOff;
          if (open) logOnce(story.id, kind, tag);
        } });
        return b;
      }

      render([
        el("a", { href: "#/", class: "small", text: "← 목록으로" }),
        el("div", null, [
          el("p", { class: "eyebrow" }, [el("span", { class: "bd " + story.section, text: sectionName(story.section) }), fmtDate(date) + " · " + lv + "단계" + (it.duration ? " · " + fmtDur(it.duration) : "")]),
          el("h1", { class: "hl", style: "font-size:22px", text: it.headline }),
          el("p", { class: "muted", style: "margin:4px 0 0", text: story.ko })
        ]),
        el("div", { class: "speeds", role: "group", "aria-label": "다른 단계로 듣기" }, [el("span", { class: "small muted", text: "단계" })].concat(lvPills)),
        lvNote,
        noAudio || el("div", { class: "card pad", style: "display:flex;flex-direction:column;gap:10px" }, [audio, el("div", { class: "speeds" }, [el("span", { class: "small muted", text: "속도" })].concat(pills))]),
        el("div", { class: "toggles" }, [toggle(sc, "대본 닫기", "대본 보기", "script"), toggle(tr, "해석 닫기", "해석 보기", "translation"), toggle(kv, "단어 닫기", "핵심 단어 " + (it.kw || []).length, "words")]),
        sc, tr, kv,
        story.url ? el("a", { class: "small", href: story.url, target: "_blank", rel: "noopener" }, [icon("external-link"), " 원문 기사 보기 (" + (story.source || "") + ")"]) : null
      ]);
    }).catch(function () { render([errBox("브리핑을 불러오지 못했어요.")]); });
  }

  /* ---------- 매일 알림 ---------- */
  var PUSH_KEY = CFG.vapidPublicKey || "";
  function pushEnv() {
    var ua = navigator.userAgent;
    var ios = /iPhone|iPad|iPod/.test(ua) || (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);
    var standalone = (window.matchMedia && matchMedia("(display-mode: standalone)").matches) || navigator.standalone === true;
    var supported = "serviceWorker" in navigator && "PushManager" in window && "Notification" in window;
    var inapp = /KAKAOTALK|NAVER\(|Instagram|FBAN|FBAV|Line\//i.test(ua);
    return { ios: ios, standalone: standalone, supported: supported, inapp: inapp };
  }
  function swReg() { return navigator.serviceWorker.register("sw.js").then(function () { return navigator.serviceWorker.ready; }); }
  function keyBytes(s) {
    var b = atob(s.replace(/-/g, "+").replace(/_/g, "/") + "===".slice((s.length + 3) % 4)), out = new Uint8Array(b.length);
    for (var i = 0; i < b.length; i++) out[i] = b.charCodeAt(i);
    return out;
  }
  function currentSub() { return pushEnv().supported ? swReg().then(function (r) { return r.pushManager.getSubscription(); }) : Promise.resolve(null); }
  function deviceName() {
    var u = navigator.userAgent;
    if (/iPhone/.test(u)) return "iPhone"; if (/iPad/.test(u)) return "iPad";
    if (/Android/.test(u)) return "Android " + (/SamsungBrowser/.test(u) ? "삼성 인터넷" : "크롬");
    return /Mac/.test(u) ? "Mac" : /Windows/.test(u) ? "Windows" : "기기";
  }
  function sendSub(sub) { var j = sub.toJSON(); return api.pushSubscribe(state.code, j.endpoint, j.keys.p256dh, j.keys.auth, deviceName()); }
  // 버튼을 누른 바로 그 순간에 권한을 물어야 아이폰에서도 동작합니다.
  function pushOn() {
    return Notification.requestPermission().then(function (perm) {
      if (perm !== "granted") throw new Error("denied");
      return swReg();
    }).then(function (reg) {
      return reg.pushManager.getSubscription().then(function (s) { return s || reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: keyBytes(PUSH_KEY) }); });
    }).then(function (sub) { return sendSub(sub).then(function () { return sub; }); });
  }
  function pushOff() {
    return currentSub().then(function (sub) {
      if (!sub) return;
      var ep = sub.endpoint;
      return sub.unsubscribe().then(function () { return api.pushUnsubscribe(state.code, ep).catch(function () {}); });
    });
  }
  // 앱을 열 때마다 이 기기의 알림 등록을 서버와 맞춥니다(주소가 바뀌었거나 다른 회원이 쓰던 기기일 때).
  function resyncPush() {
    if (DEMO || !PUSH_KEY || !pushEnv().supported || Notification.permission !== "granted") return;
    currentSub().then(function (sub) { if (sub) sendSub(sub).catch(function () {}); }).catch(function () {});
  }
  function setupMissing(e) { return /PGRST202|Could not find the function|schema cache/i.test(String(e && e.message)); }
  function timeOptions(cur) {
    var list = [];
    for (var h = 5; h <= 23; h++) for (var m = 0; m < 60; m += 10) list.push((h < 10 ? "0" : "") + h + ":" + (m < 10 ? "0" : "") + m);
    if (cur && list.indexOf(cur) < 0) { list.push(cur); list.sort(); }
    return list;
  }

  function notifyCard() {
    var env = pushEnv();
    var msg = el("p", { class: "small", role: "status", style: "margin:0;min-height:1.4em" });
    var status = el("p", { class: "small muted", style: "margin:0", text: "확인하는 중…" });
    var sel = el("select", { class: "sel", "aria-label": "알림 시간" }, timeOptions(state.notifyTime).map(function (t) {
      var o = el("option", { value: t, text: (Number(t.slice(0, 2)) < 12 ? "오전 " : "오후 ") + (Number(t.slice(0, 2)) % 12 || 12) + ":" + t.slice(3) }); if (t === state.notifyTime) o.selected = true; return o;
    }));
    sel.addEventListener("change", function () {
      var t = sel.value; msg.className = "small"; msg.textContent = "저장하는 중…";
      api.setNotifyTime(state.code, t).then(function (r) {
        state.notifyTime = r || t; if (state.me) state.me.notify_time = state.notifyTime;
        msg.textContent = "알림 시간을 바꿨어요: 매일 " + sel.options[sel.selectedIndex].text;
      }).catch(function (e) { msg.className = "small err"; msg.textContent = setupMissing(e) ? "관리자 알림 설정이 아직 끝나지 않았어요." : "저장하지 못했어요. 잠시 뒤 다시 해 주세요."; });
    });
    var btns = el("div", { class: "form" });
    function say(t, bad) { msg.className = "small" + (bad ? " err" : ""); msg.textContent = t; }
    function draw(on) {
      btns.innerHTML = "";
      status.textContent = on ? "이 기기에서 알림을 받고 있어요." : "이 기기에서는 알림이 꺼져 있어요.";
      if (on) {
        btns.appendChild(el("button", { type: "button", class: "btn small", text: "시험 알림 보내기", onclick: function () {
          say("요청하는 중…");
          api.pushTest(state.code).then(function (n) { say(n > 0 ? "1분 안에 시험 알림이 와요." : "이 기기의 알림 등록을 다시 해 주세요(끄고 다시 켜기).", n <= 0); })
            .catch(function (e) { say(setupMissing(e) ? "관리자 알림 설정이 아직 끝나지 않았어요." : "요청하지 못했어요.", true); });
        } }));
        btns.appendChild(el("button", { type: "button", class: "btn small", text: "알림 끄기", onclick: function () {
          pushOff().then(function () { draw(false); say("이 기기의 알림을 껐어요."); }).catch(function () { say("끄지 못했어요. 잠시 뒤 다시 해 주세요.", true); });
        } }));
      } else {
        btns.appendChild(el("button", { type: "button", class: "btn small primary", text: "알림 켜기", onclick: function () {
          say("켜는 중…");
          pushOn().then(function () { draw(true); say("알림을 켰어요. '시험 알림 보내기'로 확인해 보세요."); })
            .catch(function (e) {
              if (String(e && e.message) === "denied") say(Notification.permission === "denied" ? "알림이 차단되어 있어요. 휴대폰 설정에서 이 앱(또는 브라우저)의 알림을 허용한 뒤 다시 눌러 주세요." : "알림을 허용해야 받을 수 있어요.", true);
              else say(setupMissing(e) ? "관리자 알림 설정이 아직 끝나지 않았어요." : "켜지 못했어요. 잠시 뒤 다시 해 주세요.", true);
            });
        } }));
      }
    }

    var guide = null;
    if (DEMO) guide = "데모 모드에서는 알림을 보낼 수 없어요. 시간만 바꿔 볼 수 있어요.";
    else if (!PUSH_KEY) guide = "관리자 알림 설정이 아직 끝나지 않았어요.";
    else if (env.inapp) guide = "카카오톡 같은 앱 안의 브라우저에서는 알림을 받을 수 없어요. 오른쪽 위 메뉴에서 '다른 브라우저로 열기'를 눌러 크롬이나 사파리로 열어 주세요.";
    else if (env.ios && !env.standalone) guide = "아이폰은 홈 화면에 추가한 앱에서만 알림을 받을 수 있어요. Safari 아래쪽 공유 버튼 → '홈 화면에 추가'를 누른 뒤, 홈 화면의 '영어뉴스클럽' 앱으로 열어 여기서 알림을 켜 주세요. (iOS 16.4 이상)";
    else if (!env.supported) guide = "이 브라우저는 알림을 지원하지 않아요. 안드로이드는 크롬이나 삼성 인터넷, 아이폰은 홈 화면에 추가한 앱에서 켜 주세요.";

    if (guide) { status.textContent = guide; status.className = "small note"; }
    else currentSub().then(function (sub) { draw(!!sub); }).catch(function () { draw(false); });

    return el("div", { class: "card pad", style: "display:flex;flex-direction:column;gap:10px" }, [
      el("h2", { text: "매일 알림" }),
      el("label", { class: "row small", style: "gap:10px" }, [el("span", { text: "알림 시간" }), sel]),
      status, btns, msg,
      el("p", { class: "small muted", style: "margin:0", text: "알림 시간은 내 모든 기기에 똑같이 적용돼요. 뉴스는 보통 아침 6시 30분 전에 올라오고, 그보다 이른 시간으로 정하면 뉴스가 올라오는 대로(최대 1시간 뒤) 알려 드려요." })
    ]);
  }

  // 단계 고르기: 설명, 같은 내용을 단계별로 쓴 예문, 맛보기 음성
  var sampleAudio = null, sampleBtn = null;
  function stopSample() {
    if (sampleAudio) { sampleAudio.pause(); }
    if (sampleBtn) { sampleBtn.setAttribute("aria-pressed", "false"); sampleBtn.querySelector("i").className = "ti ti-player-play"; sampleBtn.lastChild.textContent = "들어 보기"; }
    sampleBtn = null;
  }
  function viewLevel() {
    setTab(state.level ? "me" : "");
    stopSample();
    var first = !state.level;
    function playBtn(L) {
      var b = el("button", { type: "button", class: "btn small", "aria-pressed": "false", "aria-label": L.n + "단계 맛보기 듣기" }, [icon("player-play"), "들어 보기"]);
      b.addEventListener("click", function () {
        var same = sampleBtn === b; stopSample(); if (same) return;
        if (!sampleAudio) { sampleAudio = new Audio(); sampleAudio.addEventListener("ended", stopSample); }
        sampleAudio.src = "audio/samples/L" + L.n + ".mp3"; sampleAudio.play().catch(function () {});
        sampleBtn = b; b.setAttribute("aria-pressed", "true"); b.querySelector("i").className = "ti ti-player-stop"; b.lastChild.textContent = "멈추기";
      });
      return b;
    }
    var cards = LEVELS.map(function (L) {
      var cur = L.n === state.level;
      var ex = el("div", { class: "ex" }, [el("p", { class: "ex-en", text: L.en }), el("p", { class: "ex-ko", text: L.ko })]);
      return el("section", { class: "card pad lv" + (cur ? " cur" : ""), "aria-label": L.n + "단계, " + L.toeic }, [
        el("div", { class: "lv-top" }, [el("span", { class: "lv-n", text: L.n + "단계" }), el("span", { class: "bd", text: L.toeic }), cur ? el("span", { class: "bd done", text: "지금 단계" }) : null]),
        el("p", { class: "lv-desc", text: L.desc }),
        ex,
        el("div", { class: "form" }, [playBtn(L), el("button", { type: "button", class: "btn small" + (cur ? "" : " primary"), disabled: cur, text: cur ? "선택됨" : L.n + "단계로 할게요", onclick: function () {
          stopSample();
          chooseLevel(L.n);
          var before = location.hash;
          location.hash = "#/";
          if (before === "#/" || before === "") route();
        } })])
      ]);
    });
    render([
      el("div", null, [
        el("p", { class: "eyebrow", text: first ? "처음 한 번만 고르면 돼요" : "언제든 바꿀 수 있어요" }),
        el("h1", { text: "나에게 맞는 단계 고르기" })
      ]),
      el("p", { class: "muted", style: "margin:0", text: "매일 같은 뉴스를 1~5단계로 다르게 써서 읽어 드려요. 예문을 들어 보고, 대본 없이 70~80% 정도 알아들을 수 있는 단계를 고르세요. 너무 쉬우면 실력이 잘 늘지 않고, 너무 어려우면 금방 지쳐요." })
    ].concat(cards).concat([
      el("p", { class: "small muted", text: "예문은 단계 차이를 보여 드리기 위해 만든 문장이에요. 실제 브리핑은 단계에 따라 1분에서 2분 30초 정도예요." })
    ]));
  }

  function viewMe() {
    setTab("me");
    refreshStats().then(function (s) {
      if (!s) { render([errBox("기록을 불러오지 못했어요.")]); return; }
      var set = {}; (s.visit_days || []).forEach(function (d) { set[d] = 1; });
      var today = kstToday(), t = new Date(today + "T12:00:00Z");
      var dow = (t.getUTCDay() + 6) % 7; // 월요일 시작
      var startMs = t.getTime() - (dow + 28) * 864e5;
      var cells = [];
      for (var i = 0; i < 35; i++) {
        var d = new Date(startMs + i * 864e5).toISOString().slice(0, 10);
        if (d > today) { cells.push(el("span", { style: "background:transparent" })); continue; }
        cells.push(el("span", { class: (set[d] ? "on" : "") + (d === today ? " today" : ""), title: d, text: String(Number(d.slice(8, 10))) }));
      }
      function stat(n, l) { return el("div", { class: "stat" }, [el("div", { class: "n", text: String(n) }), el("div", { class: "l", text: l })]); }
      var li = levelInfo(state.level);
      render([
        el("h1", { text: s.name + "님의 기록" }),
        el("div", { class: "card pad row", style: "justify-content:space-between;flex-wrap:wrap" }, [
          el("div", null, [el("div", { class: "small muted", text: "내 단계" }), el("div", { style: "font-weight:700;font-size:17px", text: li.n + "단계 · " + li.toeic })]),
          el("a", { class: "btn small", href: "#/level", text: "단계 바꾸기" })
        ]),
        notifyCard(),
        el("div", { class: "tiles" }, [stat(s.streak + "일", "연속 접속"), stat(s.days_30 + "일", "최근 30일 접속"), stat((s.completed || []).length + "개", "끝까지 들은 브리핑"), stat(s.lookups + "번", "찾아본 단어")]),
        el("div", { class: "card pad" }, [el("h2", { text: "최근 5주 접속", style: "margin-bottom:10px" }), el("div", { class: "calh" }, "월화수목금토일".split("").map(function (x) { return el("span", { text: x }); })), el("div", { class: "cal", style: "margin-top:5px" }, cells)]),
        el("button", { class: "btn", type: "button", text: "이 기기에서 로그아웃", onclick: function () {
          // 로그아웃하면 이 기기의 알림도 끕니다(다른 사람이 같은 기기를 쓸 수 있으므로).
          var off = (!DEMO && pushEnv().supported) ? pushOff().catch(function () {}) : Promise.resolve();
          off.then(function () { save(KEY, null); save(LKEY, null); state.code = null; state.me = null; state.level = null; state.stats = null; logged = {}; history.replaceState(null, "", location.pathname); viewLogin(); });
        } })
      ]);
    });
  }

  function viewAdmin() {
    setTab("admin");
    if (!state.me || !state.me.is_admin) { render([errBox("관리자만 볼 수 있어요.")]); return; }
    var nameIn = el("input", { type: "text", placeholder: "회원 이름", "aria-label": "회원 이름", maxlength: "40" });
    var adminChk = el("input", { type: "checkbox", id: "isadm" });
    var out = el("div");
    var listBox = el("div", { class: "card" }, [el("p", { class: "empty", text: "불러오는 중…" })]);
    var form = el("form", { class: "form", onsubmit: function (e) {
      e.preventDefault(); var n = nameIn.value.trim();
      if (!n) { out.innerHTML = ""; out.appendChild(el("p", { class: "err", text: "이름을 입력해 주세요." })); return; }
      api.addMember(state.code, n, adminChk.checked).then(function (r) {
        nameIn.value = ""; adminChk.checked = false; showCode(n + "님의 접속 코드", r.code); loadList();
      }).catch(function (er) { out.innerHTML = ""; out.appendChild(el("p", { class: "err", text: "추가하지 못했어요: " + er.message })); });
    } }, [nameIn, el("label", { class: "small row", style: "gap:4px" }, [adminChk, "관리자"]), el("button", { class: "btn primary small", type: "submit", text: "회원 추가" })]);

    function showMsg(t) { out.innerHTML = ""; out.appendChild(el("p", { class: "err", text: t })); window.scrollTo(0, 0); }
    function showCode(title, code) {
      out.innerHTML = "";
      var copyBtn = el("button", { class: "btn small", type: "button", text: "복사", onclick: function () {
        try { navigator.clipboard.writeText(code).then(function () { copyBtn.textContent = "복사했어요"; }, function () {}); } catch (e) {}
      } });
      out.appendChild(el("div", { class: "card pad", style: "display:flex;flex-direction:column;gap:8px" }, [
        el("p", { class: "small", style: "margin:0", text: title + " (이 화면을 벗어나면 다시 볼 수 없어요. 회원에게 전달해 주세요.)" }),
        el("div", { class: "codebox", text: code }), copyBtn
      ]));
    }

    var rows = [];
    function loadList() {
      api.members(state.code).then(function (ms) {
        rows = ms || [];
        listBox.innerHTML = "";
        if (!rows.length) { listBox.appendChild(el("p", { class: "empty", text: "아직 회원이 없어요." })); return; }
        var today = kstToday();
        rows.forEach(function (m) {
          var set = {}; (m.recent_days || []).forEach(function (d) { set[d] = 1; });
          var dots = [];
          for (var i = 13; i >= 0; i--) { var d = new Date(new Date(today + "T12:00:00Z").getTime() - i * 864e5).toISOString().slice(0, 10); dots.push(el("i", { class: set[d] ? "on" : "", title: d })); }
          listBox.appendChild(el("div", { class: "mem" }, [
            el("div", { class: "top-line" }, [el("span", { class: "nm", text: m.name }), el("span", { class: "bd" + (m.level ? " done" : ""), text: m.level ? m.level + "단계" : "단계 미선택" }), m.is_admin ? el("span", { class: "bd", text: "관리자" }) : null, !m.active ? el("span", { class: "bd", style: "background:var(--danger-bg);color:var(--danger)", text: "중지됨" }) : null, el("span", { class: "small muted", text: "마지막 접속 " + (m.last_visit ? fmtDate(m.last_visit) : "없음") })]),
            el("div", { class: "dots", "aria-label": "최근 14일 접속" }, dots),
            el("div", { class: "nums" }, [el("span", null, ["30일 접속 ", el("b", { text: String(m.days_30) }), "일"]), el("span", null, ["들은 브리핑 ", el("b", { text: String(m.played) })]), el("span", null, ["끝까지 ", el("b", { text: String(m.completed) })]), el("span", null, ["단어 ", el("b", { text: String(m.lookups) })]), el("span", null, ["알림 ", el("b", { text: m.push_devices ? (m.notify_time || "06:40") : "꺼짐" })])]),
            el("div", { class: "form" }, [
              el("button", { class: "btn small", type: "button", text: "코드 재발급", onclick: function () { api.resetCode(state.code, m.id).then(function (c) { showCode(m.name + "님의 새 접속 코드", c); window.scrollTo(0, 0); }); } }),
              el("button", { class: "btn small", type: "button", text: m.active ? "접속 중지" : "다시 허용", onclick: function () { api.setActive(state.code, m.id, !m.active).then(loadList).catch(function (er) { showMsg(/cannot_change_self/.test(er.message) ? "본인 계정은 중지할 수 없어요." : "바꾸지 못했어요: " + er.message); }); } })
            ])
          ]));
        });
      }).catch(function (er) { listBox.innerHTML = ""; listBox.appendChild(el("p", { class: "err pad", text: "회원 목록을 불러오지 못했어요: " + er.message })); });
    }

    function csv() {
      var head = ["이름", "단계", "관리자", "상태", "마지막 접속", "최근30일 접속일", "전체 접속일", "들은 브리핑", "끝까지 들음", "찾아본 단어", "알림 시간", "알림 기기 수"];
      var lines = [head].concat(rows.map(function (m) { return [m.name, m.level || "", m.is_admin ? "Y" : "", m.active ? "사용" : "중지", m.last_visit || "", m.days_30, m.days_total, m.played, m.completed, m.lookups, m.notify_time || "06:40", m.push_devices || 0]; }));
      var text = "﻿" + lines.map(function (r) { return r.map(function (v) { v = String(v == null ? "" : v); return /[",\n]/.test(v) ? '"' + v.replace(/"/g, '""') + '"' : v; }).join(","); }).join("\n");
      var a = el("a", { href: URL.createObjectURL(new Blob([text], { type: "text/csv" })), download: "club-members-" + kstToday() + ".csv" });
      document.body.appendChild(a); a.click(); a.remove();
    }

    render([
      el("h1", { text: "회원 관리" }),
      el("div", { class: "card pad", style: "display:flex;flex-direction:column;gap:10px" }, [el("h2", { text: "새 회원 추가" }), form]),
      out,
      el("div", { class: "row", style: "justify-content:space-between" }, [el("h2", { text: "회원별 현황 (최근 14일 접속 표시)" }), el("button", { class: "btn small", type: "button", text: "CSV 받기", onclick: csv })]),
      listBox
    ]);
    loadList();
  }

  /* ---------- routing ---------- */
  function route() {
    if (!state.code) return;
    var h = location.hash.replace(/^#/, "") || "/";
    var m;
    stopSample();
    if (h === "/level" || !state.level) return viewLevel();
    if ((m = h.match(/^\/b\/(\d{4}-\d{2}-\d{2})\/([\w-]+?)(?:\/([1-5]))?$/))) return viewBriefing(m[1], m[2], m[3] ? Number(m[3]) : null);
    if (h === "/archive") return viewArchive();
    if (h === "/me") return viewMe();
    if (h === "/admin") return viewAdmin();
    return viewToday();
  }

  function start(code, me) {
    state.code = code; state.me = me;
    // 서버에 저장된 단계가 먼저이고, 서버 저장 전(업데이트 SQL 실행 전)에는 이 기기에 저장한 단계를 씁니다.
    var local = localLevel(code);
    state.level = me.level || local || null;
    state.notifyTime = me.notify_time || "06:40";
    resyncPush();
    if (me.level) saveLocalLevel(code, me.level);
    else if (local) api.setLevel(code, local).catch(function () {});
    document.getElementById("who").textContent = me.name + "님";
    document.getElementById("adminTab").hidden = !me.is_admin;
    tabs.hidden = false;
    route();
  }

  window.addEventListener("hashchange", route);
  var saved = load(KEY);
  if (saved) {
    api.login(saved).then(function (me) { if (me) start(saved, me); else { save(KEY, null); viewLogin("코드가 바뀌었거나 사용이 중지되었어요. 관리자에게 확인해 주세요."); } })
      .catch(function () { viewLogin("연결에 실패했어요. 잠시 뒤 다시 시도해 주세요."); });
  } else viewLogin();
})();
