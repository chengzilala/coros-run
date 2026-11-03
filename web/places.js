/* 地点分布（地图维度分析）——本机按坐标聚类 + 离线行政区划自动识别城市/区县
 *
 * 入口：window.CorosPlaces.render(data, source)   —— 由 app.js 的 renderCharts() 调用（单点接入）
 *
 * 数据来源：dashboard.json 每条活动自带 coordinates("lat, lng") 与 sportType。
 *   · 跑步机（sportType 101）无坐标 → 单独归「跑步机」。
 *   · 其余按坐标四舍五入到 0.01°（≈1 公里）聚类成一个「点」。
 *   · 每个点用**离线行政区划**（data/cn_regions.json）最近邻匹配，自动得出「市 区县」。
 *   · 用户可覆盖成自定义名（如「家附近」）；**同名自动合并**。
 *   · 点可标为「跑步机」（并入跑步机）或「忽略」（不计入统计）。
 *
 * 存储（跨设备）：source==="cloud" → 云函数 account(placesGet/placesSave)；
 *   否则 → 本机服务 /api/account（账户体系里的一份 places 字段）。
 *
 * 隐私：离线查表，**坐标绝不上传第三方**，也不调用任何在线地图服务。
 */
window.CorosPlaces = (function () {
  var S = window.CorosStore, U = window.CorosUI;
  var TREADMILL = "__treadmill__";
  var UNLOCATED = "__unlocated__";
  var COLORS = ["#ff6b1a", "#58a6ff", "#3fb950", "#ffa64d", "#f85149", "#a371f7", "#56d4dd"];
  var PLACE_SUFFIX = /[市州区县省镇乡村街路园场校山湖岛湾苑里]$/;

  var chart = null;
  var DATA_SRC = "local";
  var LAST = null;                          // 最近一次 render 的数据
  var PLACES = { v: 1, clusters: {} };      // 账户里的地点映射（用户自定义部分）
  var LOADED = false, LOADING = false, LOAD_ERR = "";
  var BOUND = false;

  // 离线行政区划：[[lng, lat, "市 区县"], ...]（GCJ-02），来自 DataV.GeoAtlas
  var REG = [];
  var REG_READY = false, REG_LOADING = false;
  var GEO_CACHE = {};                       // cid -> 自动识别的地名

  function $(id) { return document.getElementById(id); }
  function muted() { return document.documentElement.getAttribute("data-theme") === "light" ? "#5c6672" : "#8b949e"; }

  function fmtKm(m) {
    if (!m && m !== 0) { return "—"; }
    return (m / 1000).toFixed(1) + " km";
  }
  function fmtDur(sec) {
    if (!sec && sec !== 0) { return "—"; }
    var mins = Math.round(sec / 60);
    if (mins < 60) { return mins + " 分"; }
    return Math.floor(mins / 60) + "h" + ("0" + (mins % 60)).slice(-2);
  }

  /** "39.908001, 116.390999" → "39.91,116.39"（0.01° ≈ 1.1 公里一格） */
  function clusterId(coords) {
    if (!coords) { return ""; }
    var m = String(coords).split(",");
    if (m.length < 2) { return ""; }
    var lat = parseFloat(m[0]), lng = parseFloat(m[1]);
    if (isNaN(lat) || isNaN(lng)) { return ""; }
    return lat.toFixed(2) + "," + lng.toFixed(2);
  }

  function looksPlace(s) { return !!s && PLACE_SUFFIX.test(String(s)); }

  // ---------- 离线行政区划：WGS-84 → GCJ-02 + 最近邻 ----------
  var A_ = 6378245.0, EE_ = 0.00669342162296594323;
  function tLat(x, y) {
    var r = -100 + 2 * x + 3 * y + 0.2 * y * y + 0.1 * x * y + 0.2 * Math.sqrt(Math.abs(x));
    r += (20 * Math.sin(6 * x * Math.PI) + 20 * Math.sin(2 * x * Math.PI)) * 2 / 3;
    r += (20 * Math.sin(y * Math.PI) + 40 * Math.sin(y / 3 * Math.PI)) * 2 / 3;
    r += (160 * Math.sin(y / 12 * Math.PI) + 320 * Math.sin(y * Math.PI / 30)) * 2 / 3;
    return r;
  }
  function tLng(x, y) {
    var r = 300 + x + 2 * y + 0.1 * x * x + 0.1 * x * y + 0.1 * Math.sqrt(Math.abs(x));
    r += (20 * Math.sin(6 * x * Math.PI) + 20 * Math.sin(2 * x * Math.PI)) * 2 / 3;
    r += (20 * Math.sin(x * Math.PI) + 40 * Math.sin(x / 3 * Math.PI)) * 2 / 3;
    r += (150 * Math.sin(x / 12 * Math.PI) + 300 * Math.sin(x / 30 * Math.PI)) * 2 / 3;
    return r;
  }
  function wgs2gcj(lng, lat) {
    var dlat = tLat(lng - 105, lat - 35), dlng = tLng(lng - 105, lat - 35);
    var rl = lat / 180 * Math.PI, m = Math.sin(rl);
    m = 1 - EE_ * m * m;
    var sm = Math.sqrt(m);
    dlat = (dlat * 180) / ((A_ * (1 - EE_)) / (m * sm) * Math.PI);
    dlng = (dlng * 180) / (A_ / sm * Math.cos(rl) * Math.PI);
    return [lng + dlng, lat + dlat];
  }

  function loadRegions() {
    if (REG_READY || REG_LOADING) { return Promise.resolve(); }
    REG_LOADING = true;
    return fetch("data/cn_regions.json", { cache: "force-cache" })
      .then(function (r) { return r.json(); })
      .then(function (j) { if (j && j.d) { REG = j.d; } })
      .catch(function () { REG = []; })
      .then(function () { REG_LOADING = false; REG_READY = true; paint(); });
  }

  /** 由聚类点坐标自动识别「市 区县」（离线最近邻；识别不到返回 ""） */
  function autoName(cid) {
    if (GEO_CACHE.hasOwnProperty(cid)) { return GEO_CACHE[cid]; }
    if (!REG_READY || !REG.length) { return ""; }
    var p = cid.split(",");
    var lat = parseFloat(p[0]), lng = parseFloat(p[1]);
    var g = wgs2gcj(lng, lat), gx = g[0], gy = g[1];
    var best = "", bd = Infinity, coslat = Math.cos(gy * Math.PI / 180);
    for (var i = 0; i < REG.length; i++) {
      var r = REG[i];
      var dx = (r[0] - gx) * coslat, dy = r[1] - gy;
      var d = dx * dx + dy * dy;
      if (d < bd) { bd = d; best = r[2]; }
    }
    GEO_CACHE[cid] = best;
    return best;
  }

  // ---------- 账户读写 ----------
  function normalizePlaces(raw) {
    var out = { v: 1, clusters: {} };
    if (raw && typeof raw === "object" && raw.clusters && typeof raw.clusters === "object") {
      Object.keys(raw.clusters).forEach(function (cid) {
        var e = raw.clusters[cid] || {};
        var name = String(e.n || "").trim().slice(0, 24);
        var kind = (e.k === "treadmill" || e.k === "ignore") ? e.k : "place";
        if (name || kind !== "place") { out.clusters[cid] = { n: name, k: kind }; }
      });
    }
    return out;
  }

  function loadPlaces() {
    if (LOADED || LOADING) { return Promise.resolve(); }
    LOADING = true; LOAD_ERR = "";
    var p;
    if (DATA_SRC === "cloud" && window.CorosAuth && window.CorosAuth.callFunction) {
      p = window.CorosAuth.callFunction("account", { action: "placesGet" }).then(function (res) {
        if (res && res.ok) { PLACES = normalizePlaces(res.places); }
        else if (res && res.error) { LOAD_ERR = res.error; }
      });
    } else {
      p = fetch(S.apiUrl("api/account") + "?device=" + encodeURIComponent(S.getDeviceId()))
        .then(function (r) { return r.json(); })
        .then(function (j) {
          if (j && j.error) { LOAD_ERR = j.error; return; }
          PLACES = normalizePlaces(j && j.places);
        });
    }
    return p.catch(function (e) { LOAD_ERR = "读取地点失败：" + ((e && e.message) || e); })
      .then(function () { LOADING = false; LOADED = true; paint(); });
  }

  function savePlaces(places) {
    if (DATA_SRC === "cloud" && window.CorosAuth && window.CorosAuth.callFunction) {
      return window.CorosAuth.callFunction("account", { action: "placesSave", places: places })
        .then(function (res) {
          if (!res || !res.ok) { throw new Error((res && res.error) || "保存失败"); }
          return true;
        });
    }
    return fetch(S.apiUrl("api/account"), {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "placesSave", device: S.getDeviceId(), places: places })
    }).then(function (r) { return r.json(); }).then(function (j) {
      if (j && j.error) { throw new Error(j.error); }
      return true;
    });
  }

  // ---------- 归类 ----------
  function bucketOf(a) {
    if (a.sportType === 101 || a.location === "跑步机") {
      return { key: TREADMILL, name: "跑步机", kind: "treadmill", cid: "" };
    }
    var cid = clusterId(a.coordinates);
    if (!cid) { return { key: UNLOCATED, name: "未定位", kind: "unlocated", cid: "" }; }
    var e = PLACES.clusters[cid] || {};
    if (e.k === "ignore") { return null; }
    if (e.k === "treadmill") { return { key: TREADMILL, name: "跑步机", kind: "treadmill", cid: "" }; }
    var uname = (e.n || "").trim();
    if (uname) { return { key: "n:" + uname, name: uname, kind: "place", cid: cid }; }
    var auto = autoName(cid);
    if (auto) { return { key: "a:" + auto, name: auto, kind: "auto", cid: cid }; }
    return { key: "c:" + cid, name: "未命名（" + cid + "）", kind: "unnamed", cid: cid };
  }

  function compute(acts) {
    var buckets = {}, order = [];
    var meta = { total: 0, treadmill: 0, unlocated: 0, ignored: 0, auto: 0 };
    acts.forEach(function (a) {
      meta.total += 1;
      var b = bucketOf(a);
      if (!b) { meta.ignored += 1; return; }
      if (b.kind === "treadmill") { meta.treadmill += 1; }
      else if (b.kind === "unlocated") { meta.unlocated += 1; }
      if (!buckets[b.key]) {
        buckets[b.key] = { key: b.key, name: b.name, kind: b.kind, cid: b.cid, count: 0, dist: 0, dur: 0, last: "", first: "" };
        order.push(b.key);
      }
      var x = buckets[b.key];
      x.count += 1;
      x.dist += a.distanceM || 0;
      x.dur += a.durationSec || 0;
      if (!x.last || a.date > x.last) { x.last = a.date; }
      if (!x.first || a.date < x.first) { x.first = a.date; }
    });
    var rows = order.map(function (k) { return buckets[k]; })
      .sort(function (a, b) { return b.dist - a.dist || b.count - a.count; });
    rows.forEach(function (r) { if (r.kind === "auto") { meta.auto += r.count; } });
    return { rows: rows, meta: meta };
  }

  /** 管理弹窗用：所有「坐标点」清单，并给出自动识别的城市 + 记录里的地点文字建议 */
  function clusterList(acts) {
    var m = {};
    acts.forEach(function (a) {
      if (a.sportType === 101 || a.location === "跑步机") { return; }
      var cid = clusterId(a.coordinates);
      if (!cid) { return; }
      if (!m[cid]) { m[cid] = { cid: cid, count: 0, dist: 0, locs: {} }; }
      var x = m[cid];
      x.count += 1; x.dist += a.distanceM || 0;
      var loc = String(a.location || "").trim();
      if (loc && loc !== "跑步机") { x.locs[loc] = (x.locs[loc] || 0) + 1; }
    });
    var list = Object.keys(m).map(function (k) {
      var x = m[k];
      var best = "", bestN = 0, placeBest = "";
      Object.keys(x.locs).forEach(function (loc) {
        var n = x.locs[loc];
        if (n > bestN) { bestN = n; best = loc; }
        if (looksPlace(loc) && (placeBest === "" || n > x.locs[placeBest])) { placeBest = loc; }
      });
      return { cid: x.cid, count: x.count, dist: x.dist, auto: autoName(x.cid), suggest: best, placeSuggest: placeBest };
    });
    list.sort(function (a, b) { return b.count - a.count || b.dist - a.dist; });
    return list;
  }

  // ---------- 渲染 ----------
  function paint() {
    var card = $("placeCard");
    if (!card) { return; }
    var acts = (LAST && LAST.activities) || [];
    var res = compute(acts);
    if (!acts.length || !res.rows.length) {
      card.hidden = true;
      if (chart) { chart.dispose(); chart = null; }
      return;
    }
    card.hidden = false;
    renderChart(res.rows);
    renderTable(res.rows, res.meta);
    renderFoot(res.rows, res.meta);
  }

  function colorAt(i) { return COLORS[i % COLORS.length]; }

  function renderChart(rows) {
    var el = $("chartPlace");
    if (!el || !window.echarts) { return; }
    if (chart) { chart.dispose(); }
    chart = window.echarts.init(el, null, { renderer: "canvas" });
    var useDist = rows.some(function (r) { return r.dist > 0; });
    var items = rows.map(function (r, i) {
      return { name: r.name, value: +(useDist ? r.dist / 1000 : r.count).toFixed(2), color: colorAt(i) };
    }).sort(function (a, b) { return b.value - a.value; });
    var top = items.slice(0, 7);
    if (items.length > 7) {
      var rest = items.slice(7).reduce(function (s, x) { return s + x.value; }, 0);
      top.push({ name: "其他 " + (items.length - 7) + " 处", value: +rest.toFixed(2), color: "#8b949e" });
    }
    chart.setOption({
      tooltip: {
        trigger: "item",
        formatter: function (p) {
          return U.esc(p.name) + "<br/>" + p.value + (useDist ? " km" : " 次") + " · " + p.percent + "%";
        }
      },
      legend: { type: "scroll", bottom: 0, textStyle: { color: muted() }, itemWidth: 11, itemHeight: 11 },
      series: [{
        type: "pie", radius: ["40%", "66%"], center: ["50%", "44%"],
        avoidLabelOverlap: true, label: { show: false }, labelLine: { show: false },
        data: top.map(function (x) { return { name: x.name, value: x.value, itemStyle: { color: x.color } }; })
      }]
    });
  }

  function renderTable(rows, meta) {
    var box = $("placeTable");
    if (!box) { return; }
    var hasDist = rows.some(function (r) { return r.dist > 0; });
    var tot = rows.reduce(function (s, r) { return s + (hasDist ? r.dist : r.count); }, 0) || 1;
    var head = '<div class="pl-row pl-head">' +
      '<span>地点</span><span>次数</span><span>距离</span><span>时长</span><span>占比</span></div>';
    var body = rows.map(function (r) {
      var share = Math.round((hasDist ? r.dist : r.count) / tot * 100);
      var cls = r.kind === "treadmill" ? " pl-tm" : (r.kind === "unnamed" ? " pl-unnamed" : (r.kind === "unlocated" ? " pl-unk" : ""));
      var nameCell = U.esc(r.name);
      if (r.kind === "auto" || r.kind === "unnamed") {
        nameCell += '<button type="button" class="pl-fix" data-cid="' + U.esc(r.cid) + '" title="改成自定义名">改名</button>';
      }
      return '<div class="pl-row' + cls + '">' +
        '<span class="pl-name">' + nameCell + '</span>' +
        '<span class="pl-v">' + r.count + '</span>' +
        '<span class="pl-v">' + fmtKm(r.dist) + '</span>' +
        '<span class="pl-v">' + fmtDur(r.dur) + '</span>' +
        '<span class="pl-v">' + share + '%</span>' +
        '</div>';
    }).join('');
    box.innerHTML = head + body;
    Array.prototype.forEach.call(box.querySelectorAll(".pl-fix"), function (b) {
      b.onclick = function () { openManage(b.getAttribute("data-cid")); };
    });
  }

  function renderFoot(rows, meta) {
    var foot = $("placeFoot");
    if (!foot) { return; }
    var unnamed = rows.filter(function (r) { return r.kind === "unnamed"; }).length;
    var top = rows[0];
    var parts = [];
    parts.push("共 " + meta.total + " 次训练：户外定位 " + (meta.total - meta.treadmill - meta.unlocated - meta.ignored) + " 次、跑步机 " + meta.treadmill + " 次、未定位 " + meta.unlocated + " 次。");
    if (top) { parts.push("最多的是「" + U.esc(top.name) + "」" + top.count + " 次 / " + fmtKm(top.dist) + "。"); }
    if (meta.auto) { parts.push("城市/区县由 GPS 离线自动识别（未联网）。"); }
    if (unnamed) { parts.push("有 " + unnamed + " 处坐标未能识别到城市——点右上「管理地点」可自己命名。"); }
    if (LOAD_ERR) { parts.push(LOAD_ERR); }
    foot.innerHTML = parts.join(" ");
  }

  // ---------- 地点管理弹窗 ----------
  function openManage(focusCid) {
    var acts = (LAST && LAST.activities) || [];
    var list = clusterList(acts);
    if (!list.length) { U.toast("没有可命名的坐标点"); return; }
    var rowsHtml = list.map(function (c) {
      var cur = PLACES.clusters[c.cid] || {};
      var val = cur.n || "";
      var kind = cur.k || "place";
      var title = c.auto ? U.esc(c.auto) : "未识别到城市（" + U.esc(c.cid) + "）";
      var hints = ["坐标 " + U.esc(c.cid)];
      if (c.auto) { hints.push("自动识别：" + U.esc(c.auto)); }
      if (c.suggest) { hints.push("记录地点：" + U.esc(c.suggest)); }
      var opts = [["place", "地点"], ["treadmill", "跑步机"], ["ignore", "忽略"]].map(function (o) {
        return '<option value="' + o[0] + '"' + (kind === o[0] ? " selected" : "") + ">" + o[1] + "</option>";
      }).join("");
      return '<div class="pl-mng-row' + (c.cid === focusCid ? " is-focus" : "") + '">' +
        '<div class="pl-mng-head"><b class="pl-mng-title">' + title + '</b>' +
        '<span class="pl-mng-meta">' + c.count + " 次 · " + fmtKm(c.dist) + "</span></div>" +
        '<div class="pl-mng-ctl">' +
        '<input type="text" maxlength="24" data-cid="' + U.esc(c.cid) + '" placeholder="自定义名（留空＝用自动识别的城市，如 家附近）" value="' + U.esc(val) + '">' +
        '<select data-cid="' + U.esc(c.cid) + '">' + opts + "</select>" +
        "</div><span class=\"pl-hint\">" + hints.join(" · ") + "</span>" +
        "</div>";
    }).join("");
    $("modalBody").innerHTML =
      '<div class="m-title">地点管理</div>' +
      '<div class="m-sub">已按 GPS <b>离线自动识别</b>城市 / 区县（不联网、坐标不出本机）。' +
      '留空即用自动结果，填自定义名可覆盖（<b>同名自动合并</b>）；标为「跑步机」并入跑步机；标为「忽略」不计入统计。</div>' +
      '<div class="pl-mng">' + rowsHtml + "</div>" +
      '<div class="pl-mng-actions"><button type="button" class="ghost" id="plCancel">取消</button>' +
      '<button type="button" class="primary" id="plSave">保存</button></div>';
    $("modal").hidden = false;
    $("plCancel").onclick = function () { $("modal").hidden = true; };
    $("plSave").onclick = function () { saveFromModal(); };
    if (focusCid) {
      var inp = $("modalBody").querySelector('input[data-cid="' + focusCid + '"]');
      if (inp) { inp.focus(); if (inp.scrollIntoView) { inp.scrollIntoView({ block: "center" }); } }
    }
  }

  function saveFromModal() {
    var clusters = {};
    var inputs = $("modalBody").querySelectorAll(".pl-mng input[data-cid]");
    Array.prototype.forEach.call(inputs, function (inp) {
      var cid = inp.getAttribute("data-cid");
      var name = String(inp.value || "").trim().slice(0, 24);
      var sel = $("modalBody").querySelector('select[data-cid="' + cid + '"]');
      var kind = sel ? sel.value : "place";
      if (name || kind !== "place") { clusters[cid] = { n: name, k: kind }; }
    });
    var next = { v: 1, clusters: clusters };
    var btn = $("plSave");
    btn.disabled = true; btn.textContent = "保存中…";
    savePlaces(next).then(function () {
      PLACES = normalizePlaces(next); LOADED = true; LOAD_ERR = "";
      $("modal").hidden = true;
      U.toast("地点已保存");
      paint();
    }, function (e) {
      btn.disabled = false; btn.textContent = "保存";
      U.toast("保存失败：" + ((e && e.message) || e));
    });
  }

  function bindOnce() {
    if (BOUND) { return; }
    BOUND = true;
    var btn = $("placeManageBtn");
    if (btn) { btn.onclick = function () { openManage(""); }; }
    window.addEventListener("resize", function () { if (chart) { chart.resize(); } });
  }

  /** 入口：app.js 在 renderCharts() 里调用（每次重绘都会来一次；含主题切换） */
  function render(data, source) {
    LAST = data || null;
    DATA_SRC = source || "local";
    bindOnce();
    if (!REG_READY && !REG_LOADING) { loadRegions(); }
    if (!LOADED && !LOADING) { loadPlaces(); }
    paint();
  }

  return { render: render };
})();
