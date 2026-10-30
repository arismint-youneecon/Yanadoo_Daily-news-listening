(function () {
  "use strict";
  var CFG = window.CLUB_CONFIG || {};
  var DEMO = !CFG.supabaseUrl;
  var KEY = "enc_code";
  var app = document.getElementById("app");
  var tabs = document.getElementById("tabs");
  var state = { code: null, me: null, stats: null, index: null, days: {} };

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
      login: function (c) { var d = db(), m = find(d, c); if (!m) return p(null); visit(d, m); put(d); return p({ name: m.name, is_admin: m.is_admin }); },
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
          return { id: m.id, name: m.name, is_admin: m.is_admin, active: m.active, created_at: m.created_at, last_visit: vs[vs.length - 1] || null, days_30: vs.filter(function (x) { return x > since(30); }).length, days_total: vs.length, recent_days: vs.filter(function (x) { return x > since(14); }), played: uniq("play"), completed: uniq("complete"), lookups: ev.filter(function (e) { return e.kind === "lookup"; }).length };
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
  function getIndex() { return state.index ? Promise.resolve(state.index) : getJSON("data/index.json").then(function (j) { state.index = j; return j; }); }
  function getDay(date) { return state.days[date] ? Promise.resolve(state.days[date]) : getJSON("data/" + date + ".json").then(function (j) { state.days[date] = j; return j; }); }
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
    return el("a", { class: "card item " + it.section, href: "#/b/" + date + "/" + it.id }, [
      el("span", { class: "tile" }, [icon(it.icon || (it.section === "g" ? "world" : "map-pin"))]),
      el("span", { class: "txt" }, [
        el("span", { class: "hl", text: it.headline }),
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
        render([
          el("div", null, [
            el("p", { class: "eyebrow", text: (isToday ? "오늘의 브리핑 · " : "가장 최근 브리핑 · ") + fmtDate(latest.date) + " · 레벨 " + (day.level || 1) }),
            el("h1", { text: (state.me ? state.me.name + "님, " : "") + "좋은 아침이에요" })
          ]),
          s.streak ? el("div", { class: "row small muted" }, [icon("flame"), "연속 " + s.streak + "일째 접속 중"]) : null,
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

  function viewBriefing(date, id) {
    setTab(date === (state.index && state.index.days[0] && state.index.days[0].date) ? "today" : "archive");
    getDay(date).then(function (day) {
      var it = day.items.filter(function (x) { return x.id === id; })[0];
      if (!it) { render([errBox("브리핑을 찾을 수 없어요.")]); return; }

      var audio = el("audio", { controls: true, preload: "metadata", src: it.audio || null });
      var completeSent = false;
      audio.addEventListener("play", function () { logOnce(it.id, "play"); });
      // "끝까지 들음"은 건너뛰기를 빼고 실제로 재생된 시간이 85%를 넘을 때만 기록합니다.
      var listened = 0, lastT = 0;
      audio.addEventListener("seeking", function () { lastT = audio.currentTime; });
      audio.addEventListener("timeupdate", function () {
        var t = audio.currentTime, dt = t - lastT; lastT = t;
        if (dt > 0 && dt < 1.5 * (audio.playbackRate || 1)) listened += dt;
        if (!completeSent && audio.duration && listened / audio.duration > 0.85) { completeSent = true; logOnce(it.id, "complete"); }
      });
      var noAudio = it.audio ? null : el("p", { class: "note", text: "음성 파일 보관 기간(60일)이 지나 대본만 남아 있어요." });
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
        logOnce(it.id, "lookup", word.toLowerCase());
      }
      scriptBox.addEventListener("click", function (e) { if (e.target.classList && e.target.classList.contains("w")) pick(e.target); });
      scriptBox.addEventListener("keydown", function (e) { if ((e.key === "Enter" || e.key === " ") && e.target.classList && e.target.classList.contains("w")) { e.preventDefault(); pick(e.target); } });

      var sc = el("div", { class: "card pad", hidden: true }, [el("p", { class: "hint", text: "점선 단어는 누르면 바로 뜻이 나와요. 다른 단어는 사전에서 찾아볼 수 있어요." }), scriptBox]);
      var tr = el("div", { class: "card pad tr", hidden: true }, (it.tr || []).map(function (t) { return el("p", { text: t }); }));
      var kv = el("div", { class: "card pad", hidden: true }, [el("div", { class: "kw" }, [].concat.apply([], (it.kw || []).map(function (k) { return [el("span", { class: "en", text: k[0] }), el("span", { class: "ko", text: k[1] })]; })))]);
      function toggle(panel, labelOn, labelOff, kind) {
        var b = el("button", { type: "button", class: "btn small", "aria-expanded": "false", text: labelOff, onclick: function () {
          var open = panel.hidden; panel.hidden = !open; b.setAttribute("aria-expanded", open ? "true" : "false"); b.textContent = open ? labelOn : labelOff;
          if (open) logOnce(it.id, kind);
        } });
        return b;
      }

      render([
        el("a", { href: "#/", class: "small", text: "← 목록으로" }),
        el("div", null, [
          el("p", { class: "eyebrow" }, [el("span", { class: "bd " + it.section, text: sectionName(it.section) }), fmtDate(date) + " · 레벨 " + (day.level || 1) + (it.duration ? " · " + fmtDur(it.duration) : "")]),
          el("h1", { class: "hl", style: "font-size:22px", text: it.headline }),
          el("p", { class: "muted", style: "margin:4px 0 0", text: it.ko })
        ]),
        noAudio || el("div", { class: "card pad", style: "display:flex;flex-direction:column;gap:10px" }, [audio, el("div", { class: "speeds" }, [el("span", { class: "small muted", text: "속도" })].concat(pills))]),
        el("div", { class: "toggles" }, [toggle(sc, "대본 닫기", "대본 보기", "script"), toggle(tr, "해석 닫기", "해석 보기", "translation"), toggle(kv, "단어 닫기", "핵심 단어 " + (it.kw || []).length, "words")]),
        sc, tr, kv,
        it.url ? el("a", { class: "small", href: it.url, target: "_blank", rel: "noopener" }, [icon("external-link"), " 원문 기사 보기 (" + (it.source || "") + ")"]) : null
      ]);
    }).catch(function () { render([errBox("브리핑을 불러오지 못했어요.")]); });
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
      render([
        el("h1", { text: s.name + "님의 기록" }),
        el("div", { class: "tiles" }, [stat(s.streak + "일", "연속 접속"), stat(s.days_30 + "일", "최근 30일 접속"), stat((s.completed || []).length + "개", "끝까지 들은 브리핑"), stat(s.lookups + "번", "찾아본 단어")]),
        el("div", { class: "card pad" }, [el("h2", { text: "최근 5주 접속", style: "margin-bottom:10px" }), el("div", { class: "calh" }, "월화수목금토일".split("").map(function (x) { return el("span", { text: x }); })), el("div", { class: "cal", style: "margin-top:5px" }, cells)]),
        el("button", { class: "btn", type: "button", text: "이 기기에서 로그아웃", onclick: function () { save(KEY, null); state.code = null; state.me = null; state.stats = null; logged = {}; history.replaceState(null, "", location.pathname); viewLogin(); } })
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
            el("div", { class: "top-line" }, [el("span", { class: "nm", text: m.name }), m.is_admin ? el("span", { class: "bd", text: "관리자" }) : null, !m.active ? el("span", { class: "bd", style: "background:var(--danger-bg);color:var(--danger)", text: "중지됨" }) : null, el("span", { class: "small muted", text: "마지막 접속 " + (m.last_visit ? fmtDate(m.last_visit) : "없음") })]),
            el("div", { class: "dots", "aria-label": "최근 14일 접속" }, dots),
            el("div", { class: "nums" }, [el("span", null, ["30일 접속 ", el("b", { text: String(m.days_30) }), "일"]), el("span", null, ["들은 브리핑 ", el("b", { text: String(m.played) })]), el("span", null, ["끝까지 ", el("b", { text: String(m.completed) })]), el("span", null, ["단어 ", el("b", { text: String(m.lookups) })])]),
            el("div", { class: "form" }, [
              el("button", { class: "btn small", type: "button", text: "코드 재발급", onclick: function () { api.resetCode(state.code, m.id).then(function (c) { showCode(m.name + "님의 새 접속 코드", c); window.scrollTo(0, 0); }); } }),
              el("button", { class: "btn small", type: "button", text: m.active ? "접속 중지" : "다시 허용", onclick: function () { api.setActive(state.code, m.id, !m.active).then(loadList).catch(function (er) { showMsg(/cannot_change_self/.test(er.message) ? "본인 계정은 중지할 수 없어요." : "바꾸지 못했어요: " + er.message); }); } })
            ])
          ]));
        });
      }).catch(function (er) { listBox.innerHTML = ""; listBox.appendChild(el("p", { class: "err pad", text: "회원 목록을 불러오지 못했어요: " + er.message })); });
    }

    function csv() {
      var head = ["이름", "관리자", "상태", "마지막 접속", "최근30일 접속일", "전체 접속일", "들은 브리핑", "끝까지 들음", "찾아본 단어"];
      var lines = [head].concat(rows.map(function (m) { return [m.name, m.is_admin ? "Y" : "", m.active ? "사용" : "중지", m.last_visit || "", m.days_30, m.days_total, m.played, m.completed, m.lookups]; }));
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
    if ((m = h.match(/^\/b\/(\d{4}-\d{2}-\d{2})\/([\w-]+)$/))) return viewBriefing(m[1], m[2]);
    if (h === "/archive") return viewArchive();
    if (h === "/me") return viewMe();
    if (h === "/admin") return viewAdmin();
    return viewToday();
  }

  function start(code, me) {
    state.code = code; state.me = me;
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
