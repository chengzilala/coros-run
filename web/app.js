/* 跑不快 —— 未登录一律显示登录引导（不展示任何数据）；已登录读云函数 dashboard（本人数据） */
(function () {
  var SPORT = { 100: "户外跑", 101: "跑步机", 102: "田径场跑", 103: "越野跑", 104: "徒步", 105: "室内骑行", 200: "骑行", 300: "游泳" };
  var DATA = null, charts = [], volumeChart = null, calendarChart = null;
  var VOL_G = "month";   // 跑量趋势粒度：week / month / year
  var CAL_YEAR = null;   // 日历热力图当前年份（null＝跟随最新年）
  var DATA_SOURCE = "local";   // "cloud"＝登录读云端；"local"＝本机预览读本机 dashboard.json（决定复盘走云函数还是本机服务）
  var Store = window.CorosStore, UI = window.CorosUI;

  Store.applyFontScale();   // 套用本机保存的字号档位

  function $(id) { return document.getElementById(id); }
  function fmtPace(sec) { if (!sec && sec !== 0) return "—"; sec = Math.round(sec); return Math.floor(sec / 60) + ":" + ("0" + (sec % 60)).slice(-2); }
  function fmtDur(sec) {
    if (!sec && sec !== 0) return "—"; sec = Math.round(sec);
    var h = Math.floor(sec / 3600), m = Math.floor((sec % 3600) / 60), s = sec % 60;
    return (h ? h + ":" + ("0" + m).slice(-2) : m) + ":" + ("0" + s).slice(-2);
  }
  function fmtDist(m) { if (!m && m !== 0) return "—"; return (m / 1000).toFixed(2) + " km"; }
  // 分段距离契约：两个品牌的适配器都统一成「厘米」（100000 = 1km）
  function fmtDistCm(cm) { if (!cm && cm !== 0) return "—"; return (cm / 100000).toFixed(2) + " km"; }
  function sportName(a) { return SPORT[a.sportType] || a.title || "运动"; }
  function esc(s) { return String(s == null ? "" : s).replace(/[&<>"]/g, function (c) { return ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]; }); }

  function isLight() { return document.documentElement.getAttribute("data-theme") === "light"; }
  function mutedColor() { return isLight() ? "#5c6672" : "#8b949e"; }
  function axisCfg() {
    var light = isLight();
    return {
      axisLine: { show: false },
      axisTick: { show: false },
      axisLabel: { color: light ? "#5c6672" : "#8b949e", fontSize: 11 },
      nameTextStyle: { color: light ? "#5c6672" : "#8b949e", fontSize: 11 },
      splitLine: { lineStyle: { color: light ? "#eef0f3" : "#1b2028", type: "dashed" } }
    };
  }
  function mk(id) {
    var c = echarts.init($(id), null, { renderer: "canvas" });
    charts.push(c);
    return c;
  }

  // ---------- 顶部 ----------
  function renderHero() {
    var p = DATA.profile || {}, dev = (DATA.devices || [])[0] || {};
    $("nickname").textContent = p.nickname || "我的跑步";
    var parts = [];
    if (dev["Model Name"]) parts.push(dev["Model Name"]);
    if (p.heightCm) parts.push(Math.round(p.heightCm) + "cm " + (p.weightKg || "") + "kg");
    parts.push(DATA.activities.length + " 次记录");
    $("subline").textContent = parts.join(" · ");
    var f = DATA.fitness || {}, pl = (f.predictions || {}), h = DATA.dailyHealth || {};
    var paces = f.paces || {};
    // 跑力值只有高驰有；佳明缺这项 → 用同一套 VDOT 推算值顶上，并明确标注口径，不假装是跑力值
    var lvl = (f.runningLevel != null)
      ? ["跑力值", f.runningLevel]
      : (paces.vdot ? ["跑力 VDOT", paces.vdot] : ["跑力值", "—"]);
    var meta = [
      ["VO2max", f.vo2max != null ? f.vo2max : "—"],
      lvl,
      ["阈值配速", f.thresholdPaceSec != null ? fmtPace(f.thresholdPaceSec) + "/km" : "—"],
      ["静息心率", h.restingHr != null ? h.restingHr + " bpm" : "—"],
      ["全马预测", pl["Marathon"] || "—"]
    ];
    $("heroMeta").innerHTML = meta.map(function (m) {
      return '<span class="pill">' + m[0] + ' <b>' + esc(m[1]) + "</b></span>";
    }).join("");
  }

  // ---------- KPI ----------
  // 数据锚点：最近一次训练日（数据可能不是今天抓的，滚动窗口一律以它为准，避免整屏变 0）
  function latestActivityDate() {
    var latest = "";
    (DATA.activities || []).forEach(function (a) { if (a.date && a.date > latest) { latest = a.date; } });
    return latest || todayLocalStr();
  }
  // 滚动窗口统计（近 N 天 / 再往前 N 天），以最近训练日为终点，用于 KPI 环比
  function windowStats(from, to) {
    var anchor = latestActivityDate();
    var s = rangeStats(DATA.activities || [], shiftDate(anchor, -(to - 1)), shiftDate(anchor, -from));
    return { count: s.count, km: s.distKm, pace: s.paceSec, hr: s.avgHr };
  }
  // 近 7 天跑量迷你柱（纯展示：高度按当天跑量占 7 天峰值的比例）
  function volumeSpark() {
    var byDate = {};
    (DATA.activities || []).forEach(function (a) { byDate[a.date] = (byDate[a.date] || 0) + (a.distanceM || 0); });
    var anchor = latestActivityDate(), vals = [];
    for (var i = 6; i >= 0; i--) { vals.push((byDate[shiftDate(anchor, -i)] || 0) / 1000); }
    var max = Math.max.apply(null, vals);
    return '<span class="spark">' + vals.map(function (v) {
      var h = max > 0 ? Math.max(3, Math.round(v / max * 20)) : 3;
      return '<i class="' + (v > 0 ? "on" : "") + '" style="height:' + h + 'px"></i>';
    }).join("") + "</span>";
  }
  function deltaTag(text, cls) { return '<span class="delta ' + cls + '">' + esc(text) + "</span>"; }

  function renderKpis() {
    var acts = DATA.activities || [];
    var cur = windowStats(0, 30), prev = windowStats(30, 60);
    var foots = [];

    // ① 近 30 天跑量：环比 + 近 7 天迷你柱
    if (prev.km > 0) {
      var d = Math.round((cur.km - prev.km) / prev.km * 100);
      foots.push(deltaTag((d > 0 ? "↑ " : (d < 0 ? "↓ " : "→ ")) + Math.abs(d) + "%", d > 0 ? "up" : (d < 0 ? "down" : "flat")) + volumeSpark());
    } else {
      foots.push('<span class="delta flat">前 30 天无记录</span>' + volumeSpark());
    }
    // ② 累计跑量：没有"上期"可比，给记录条数
    foots.push('<span class="delta flat">共 ' + acts.length + " 次记录</span>");
    // ③ 平均配速：前 30 天 → 近 30 天，快 / 慢多少秒
    if (cur.pace != null && prev.pace != null) {
      var pd = Math.round(prev.pace - cur.pace);   // >0 表示现在更快
      foots.push(pd === 0
        ? '<span class="delta flat">较前 30 天持平</span>'
        : deltaTag("较前 30 天" + (pd > 0 ? "快 " : "慢 ") + Math.abs(pd) + "s", pd > 0 ? "up" : "down"));
    } else {
      foots.push('<span class="delta flat">数据不足</span>');
    }
    // ④ 平均心率：只报变化值，不作好/坏判断
    if (cur.hr != null && prev.hr != null) {
      var hd = cur.hr - prev.hr;
      foots.push('<span class="delta flat">较前 30 天' + (hd > 0 ? "+" : (hd < 0 ? "−" : "±")) + Math.abs(hd) + " bpm</span>");
    } else {
      foots.push('<span class="delta flat">数据不足</span>');
    }

    $("kpis").innerHTML = computeKpis().map(function (c, i) {
      return '<div class="kpi"><div class="k">' + c[0] + '</div><div class="v">' + esc(c[1]) + "<small>" + c[2] + "</small></div>" +
        '<div class="kpi-foot">' + foots[i] + "</div></div>";
    }).join("");
  }

  // ---------- 训练配速（丹尼尔斯 VDOT 五区）----------
  function renderPaces() {
    var card = $("paceCard"), p = (DATA.fitness || {}).paces;
    if (!card) { return; }
    if (!p) { card.hidden = true; return; }
    card.hidden = false;
    $("paceHint").textContent = "依据 " + p.anchorLabel + "预测 " + p.anchorTime + " · VDOT " + p.vdot;
    var rows = [
      ["E", "轻松跑", p.E + " /km", "打底慢跑，能边跑边聊天"],
      ["M", "马拉松配速", p.M + " /km", "比赛目标配速"],
      ["T", "阈值跑", p.T + " /km", "乳酸门槛，提升耐速"],
      ["I", "间歇", "400m " + p.I400 + " · 1km " + p.I1000, "提升最大摄氧"],
      ["R", "冲刺", "200m " + p.R200 + " · 400m " + p.R400, "配速与跑步经济性"]
    ];
    $("paceTable").innerHTML = rows.map(function (r) {
      return '<div class="pace-row">' +
        '<span class="pace-zone pace-zone--' + r[0] + '">' + r[0] + "</span>" +
        '<span class="pace-name">' + r[1] + "</span>" +
        '<span class="pace-val">' + esc(r[2]) + "</span>" +
        '<span class="pace-desc">' + r[3] + "</span>" +
        "</div>";
    }).join("");
  }

  // ---------- 今日状态（首屏恢复度环）----------
  var RING_C = 2 * Math.PI * 70;   // 与 index.html 里 svg 的 r=70 对应（viewBox 单位）
  function renderReadiness() {
    var r = DATA.readiness || {};
    var ring = $("focusRingFg"), score = $("focusScore"), level = $("focusLevel");
    var label = $("focusLabel"), sum = $("focusSummary");
    if (!ring || !score || !level || !label) { return; }
    var known = !!r.status && r.status !== "unknown";

    // 恢复度优先用高驰的 recoveryPct；佳明没有恢复度 → 用厂商自己的训练准备度分数（有才用，不臆造）
    var pct = (typeof r.recoveryPct === "number") ? r.recoveryPct
      : (typeof r.garminTrainingReadiness === "number") ? r.garminTrainingReadiness : null;
    var pctName = (typeof r.recoveryPct === "number") ? "恢复度" : "训练准备度";

    score.classList.remove("txt");
    if (pct != null) {
      score.textContent = Math.round(pct);
      level.textContent = pctName;
      ring.setAttribute("stroke-dashoffset", (RING_C * (1 - Math.max(0, Math.min(100, pct)) / 100)).toFixed(1));
    } else if (known) {
      score.classList.add("txt");
      score.textContent = r.label || "—";
      level.textContent = "今日状态";
      ring.setAttribute("stroke-dashoffset", RING_C.toFixed(1));
    } else {
      score.classList.add("txt");
      score.textContent = "—";
      level.textContent = "暂无状态数据";
      ring.setAttribute("stroke-dashoffset", RING_C.toFixed(1));
    }
    ring.style.stroke = r.status === "ok" ? "#3fb950"
      : r.status === "caution" ? "#e8a33d"
      : r.status === "recover" ? "#f85149"
      : "var(--v3-ring-track)";

    label.textContent = known ? (r.label || "今日状态") : "暂无恢复度数据";
    label.classList.toggle("is-muted", !known);

    var parts = [];
    if (r.summary) { parts.push(r.summary); }
    if (r.flags && r.flags.length) { parts.push("红旗：" + r.flags.join("；")); }
    // 佳明独有：今日身体电量（高驰无此数据 → 不显示，不臆造）；摘要里已写过就不重复
    var bb = (DATA.bodyBattery || []).slice().sort(function (a, b) { return a.date < b.date ? -1 : 1; }).pop();
    if (bb && bb.high != null && (r.summary || "").indexOf("身体电量") < 0) {
      parts.push("身体电量 " + (bb.low != null ? bb.low + "~" : "") + bb.high);
    }
    sum.textContent = parts.length ? parts.join(" · ") : (known ? "" : "本次数据里没有恢复度 / HRV 等信号，先按身体感觉安排训练。");
    sum.classList.toggle("is-empty", !sum.textContent);
  }

  // ---------- 首屏：近 7 天核心数字 + 每日跑量柱 ----------
  function renderFocus() {
    var stats = $("focusStats"), week = $("focusWeek");
    if (!stats || !week) { return; }
    var w = weeklyWindows();
    if (!w) { stats.innerHTML = ""; week.innerHTML = ""; return; }
    var cur = w.cur;

    stats.innerHTML = [
      ["近 7 天跑量", cur.distKm.toFixed(1), "km"],
      ["训练时长", cur.durSec ? fmtDur(cur.durSec) : "—", ""],
      ["平均配速", cur.paceSec ? fmtPace(cur.paceSec) : "—", "/km"]
    ].map(function (s) {
      return "<div><b>" + esc(s[1]) + "<small>" + s[2] + "</small></b><span>" + s[0] + "</span></div>";
    }).join("");

    var byDate = {};
    (DATA.activities || []).forEach(function (a) { byDate[a.date] = (byDate[a.date] || 0) + (a.distanceM || 0); });
    var WD = ["日", "一", "二", "三", "四", "五", "六"], days = [], max = 0;
    for (var i = 0; i < 7; i++) {
      var d = shiftDate(w.curStart, i), km = (byDate[d] || 0) / 1000;
      if (km > max) { max = km; }
      days.push({ d: d, km: km });
    }
    week.innerHTML = days.map(function (x) {
      var h = max > 0 ? Math.max(x.km / max * 70, x.km > 0 ? 8 : 3) : 3;
      var wd = WD[new Date(x.d + "T00:00:00Z").getUTCDay()];
      return '<div class="d' + (x.km > 0 ? " has" : "") + '" title="' + x.d + " · " + x.km.toFixed(1) + ' km">' +
        '<i style="height:' + h.toFixed(1) + '%"></i><em>' + wd + "</em></div>";
    }).join("");
  }

  // ---------- KPI 计算（供分享图复用）----------
  function computeKpis() {
    var acts = DATA.activities, anchor = latestActivityDate();
    var last30 = acts.filter(function (a) { return a.date >= shiftDate(anchor, -29) && a.date <= anchor; });
    var sum = function (xs, k) { return xs.reduce(function (s, a) { return s + (a[k] || 0); }, 0); };
    var pace = acts.filter(function (a) { return a.paceSec; });
    var avgPace = pace.length ? pace.reduce(function (s, a) { return s + a.paceSec; }, 0) / pace.length : null;
    var hr = acts.filter(function (a) { return a.avgHr; });
    var avgHr = hr.length ? Math.round(hr.reduce(function (s, a) { return s + a.avgHr; }, 0) / hr.length) : null;
    return [
      ["最近 30 天跑量", (sum(last30, "distanceM") / 1000).toFixed(2), "km"],
      ["累计跑量", (sum(acts, "distanceM") / 1000).toFixed(1), "km"],
      ["平均配速", fmtPace(avgPace), "/km"],
      ["平均心率", avgHr != null ? avgHr : "—", "bpm"]
    ];
  }

  // ---------- 打卡分享图（纯前端 canvas 绘制 1080×1440 PNG）----------
  var SHARE_FONT = '-apple-system,BlinkMacSystemFont,"PingFang SC","Microsoft YaHei",sans-serif';
  var ZONE_COLOR = { E: "#3fb950", M: "#58a6ff", T: "#ffa64d", I: "#ff6b1a", R: "#f85149" };

  function drawShareImage() {
    var W = 1080, H = 1440, P = 72, iw = W - P * 2;
    var cv = document.createElement("canvas");
    cv.width = W; cv.height = H;
    var c = cv.getContext("2d");
    var p = DATA.profile || {};

    function rr(x, y, w, h, r) {
      c.beginPath();
      c.moveTo(x + r, y);
      c.arcTo(x + w, y, x + w, y + h, r);
      c.arcTo(x + w, y + h, x, y + h, r);
      c.arcTo(x, y + h, x, y, r);
      c.arcTo(x, y, x + w, y, r);
      c.closePath();
    }
    function txt(s, x, y, font, color, align) {
      c.font = font; c.fillStyle = color; c.textAlign = align || "left"; c.textBaseline = "alphabetic";
      c.fillText(String(s), x, y);
    }

    // 背景（分享图固定深色，与页面主题无关）
    var bg = c.createLinearGradient(0, 0, W, H);
    bg.addColorStop(0, "#141b24"); bg.addColorStop(1, "#0b0f14");
    c.fillStyle = bg; c.fillRect(0, 0, W, H);

    // 简笔轨迹底纹：与 logo / 首屏同一套线条语言（一条线 + 一个橙点）
    c.save();
    c.globalAlpha = 0.1;
    c.strokeStyle = "#f2ede4"; c.lineWidth = 14; c.lineCap = "round"; c.lineJoin = "round";
    c.beginPath();
    c.moveTo(-40, H * 0.92);
    c.bezierCurveTo(W * 0.26, H * 0.86, W * 0.28, H * 0.5, W * 0.54, H * 0.56);
    c.bezierCurveTo(W * 0.72, H * 0.6, W * 0.78, H * 0.38, W * 0.86, H * 0.33);
    c.stroke();
    c.globalAlpha = 0.55;
    c.fillStyle = "#ff6b1a";
    c.beginPath(); c.arc(W * 0.86, H * 0.33, 12, 0, Math.PI * 2); c.fill();
    c.restore();

    // 顶部装饰条
    c.fillStyle = "#ff6b1a"; c.fillRect(P, P, 72, 8);

    // 头像 + 昵称 + 副标题
    var avY = P + 92;
    c.fillStyle = "#ff6b1a";
    c.beginPath(); c.arc(P + 34, avY, 34, 0, Math.PI * 2); c.fill();
    c.textAlign = "center"; c.textBaseline = "middle"; c.fillStyle = "#101418"; c.font = "700 34px " + SHARE_FONT;
    c.fillText((p.nickname || "跑").slice(0, 1), P + 34, avY + 2);
    txt(p.nickname || "我的跑步", P + 92, avY - 4, "700 42px " + SHARE_FONT, "#e6edf3");
    txt("跑不快 · 数据更新于 " + ((DATA.generatedAt || "").slice(0, 10) || "—"), P + 92, avY + 40, "400 24px " + SHARE_FONT, "#8b949e");

    var y = P + 160;

    // 今日状态灯
    var r = DATA.readiness;
    if (r && r.status !== "unknown") {
      var rc = r.status === "ok" ? "#3fb950" : (r.status === "caution" ? "#d29922" : "#f85149");
      rr(P, y, iw, 76, 16); c.fillStyle = "#1a2129"; c.fill();
      c.fillStyle = rc; c.fillRect(P, y, 6, 76);
      c.beginPath(); c.arc(P + 44, y + 38, 11, 0, Math.PI * 2); c.fill();
      txt(r.label || "", P + 70, y + 48, "700 30px " + SHARE_FONT, rc);
      txt((r.summary || "") + ((r.flags && r.flags.length) ? " · " + r.flags.join("；") : ""), P + iw - 24, y + 47, "400 24px " + SHARE_FONT, "#8b949e", "right");
      y += 76 + 28;
    }

    // KPI 2×2
    var kpis = computeKpis(), gap = 20, cw = (iw - gap) / 2, ch = 160;
    kpis.forEach(function (k, i) {
      var cx = P + (i % 2) * (cw + gap);
      var cy = y + Math.floor(i / 2) * (ch + gap);
      rr(cx, cy, cw, ch, 18); c.fillStyle = "#1c232c"; c.fill();
      c.fillStyle = "#ff6b1a"; c.fillRect(cx, cy, 44, 4);
      txt(k[0], cx + 28, cy + 56, "400 26px " + SHARE_FONT, "#8b949e");
      txt(k[1], cx + 28, cy + 128, "700 60px " + SHARE_FONT, "#e6edf3");
      var w = c.measureText(k[1]).width;
      txt(k[2], cx + 28 + w + 10, cy + 128, "400 26px " + SHARE_FONT, "#8b949e");
    });
    y += ch * 2 + gap + 44;

    // 五区配速
    var pc = (DATA.fitness || {}).paces;
    if (pc) {
      txt("训练配速 · 五区", P, y + 30, "700 32px " + SHARE_FONT, "#e6edf3");
      txt("依据 " + pc.anchorLabel + "预测 " + pc.anchorTime + " · VDOT " + pc.vdot, P + iw, y + 28, "400 24px " + SHARE_FONT, "#8b949e", "right");
      y += 58;
      var rows = [
        ["E", "轻松跑", pc.E + " /km"],
        ["M", "马拉松配速", pc.M + " /km"],
        ["T", "阈值跑", pc.T + " /km"],
        ["I", "间歇", "400m " + pc.I400 + " · 1km " + pc.I1000],
        ["R", "冲刺", "200m " + pc.R200 + " · 400m " + pc.R400]
      ];
      var rh = 84, rg = 12;
      rows.forEach(function (row, i) {
        var ry = y + i * (rh + rg);
        rr(P, ry, iw, rh, 14); c.fillStyle = "#1c232c"; c.fill();
        rr(P + 18, ry + 20, 44, 44, 10); c.fillStyle = ZONE_COLOR[row[0]]; c.fill();
        c.textAlign = "center"; c.textBaseline = "middle"; c.fillStyle = "#101418"; c.font = "700 26px " + SHARE_FONT;
        c.fillText(row[0], P + 40, ry + 43);
        txt(row[1], P + 84, ry + 54, "400 28px " + SHARE_FONT, "#e6edf3");
        txt(row[2], P + iw - 28, ry + 54, "700 32px " + SHARE_FONT, "#ffa64d", "right");
      });
    }

    // 页脚
    txt("数据来自你的高驰账号（只读）· coros-run", W / 2, H - P + 8, "400 24px " + SHARE_FONT, "#5c6672", "center");

    return cv.toDataURL("image/png");
  }

  function bindShare() {
    var btn = $("shareBtn");
    if (!btn) { return; }
    btn.onclick = function () {
      try {
        var url = drawShareImage();
        var stamp = (DATA.generatedAt || "").slice(0, 10).replace(/-/g, "") || "today";
        var a = document.createElement("a");
        a.href = url; a.download = "coros-run-" + stamp + ".png";
        document.body.appendChild(a); a.click(); document.body.removeChild(a);
        UI.toast("打卡图已生成，开始下载");
      } catch (e) {
        UI.toast("打卡图生成失败：" + e.message);
      }
    };
  }

  // ---------- 图表 ----------
  // ---------- 跑量趋势（周 / 月 / 年 可切换）----------
  function volKeysBy(g) {
    var map = {};
    DATA.activities.forEach(function (a) {
      if (!a.date) { return; }
      var k = g === "year" ? a.date.slice(0, 4) : (g === "week" ? weekKey(a.date) : a.date.slice(0, 7));
      if (!map[k]) { map[k] = { d: 0, n: 0, p: [], h: [] }; }
      map[k].d += a.distanceM || 0; map[k].n++;
      if (a.paceSec) { map[k].p.push(a.paceSec); }
      if (a.avgHr) { map[k].h.push(a.avgHr); }
    });
    return map;
  }
  function avgOf(xs) { return xs.length ? xs.reduce(function (s, v) { return s + v; }, 0) / xs.length : null; }
  function renderVolume() {
    var g = VOL_G, map = volKeysBy(g);
    var keys = Object.keys(map).sort();
    var avgName = g === "week" ? "周均" : (g === "year" ? "年均" : "月均");
    var unit = g === "week" ? "周" : (g === "year" ? "年" : "月");
    if (g === "week" && keys.length > 16) { keys = keys.slice(-16); }   // 周粒度只显示最近 16 周，避免过密
    var xLabel = function (k) { return g === "year" ? k + "年" : (g === "week" ? k.slice(5) : k.slice(2)); };
    var x = keys.map(xLabel);
    var dist = keys.map(function (k) { return +(map[k].d / 1000).toFixed(2); });
    var cnt = keys.map(function (k) { return map[k].n; });
    var avgKm = avgOf(dist) || 0;
    var hint = $("volHint"); if (hint) { hint.textContent = "按" + unit; }
    if (!volumeChart) { volumeChart = mk("chartVolume"); }
    volumeChart.setOption({
      tooltip: {
        trigger: "axis",
        formatter: function (ps) {
          var i = ps[0].dataIndex, k = keys[i], m = map[k];
          var pa = avgOf(m.p), ha = avgOf(m.h);
          return "<b>" + k + "</b><br/>跑量 " + dist[i] + " km · " + cnt[i] + " 次<br/>" +
            "平均配速 " + (pa != null ? fmtPace(pa) + "/km" : "—") + " · 平均心率 " + (ha != null ? Math.round(ha) + " bpm" : "—");
        }
      },
      legend: { data: ["跑量(km)", "次数"], textStyle: { color: mutedColor(), fontSize: 10 }, itemWidth: 10, itemHeight: 8, icon: "roundRect", right: 0, top: 0 },
      grid: { left: 44, right: 40, top: 36, bottom: 28 },
      xAxis: Object.assign({ type: "category", data: x }, axisCfg()),
      yAxis: [
        Object.assign({ type: "value", name: "km" }, axisCfg()),
        Object.assign(axisCfg(), { type: "value", name: "次", splitLine: { show: false } })
      ],
      series: [
        { name: "跑量(km)", type: "bar", data: dist, barMaxWidth: 22,
          itemStyle: {
            borderRadius: [6, 6, 0, 0],
            color: new echarts.graphic.LinearGradient(0, 0, 0, 1, [
              { offset: 0, color: "#ff7a33" },
              { offset: 1, color: "rgba(255,90,31,.28)" }
            ])
          },
          markLine: { silent: true, symbol: "none", data: [{ yAxis: +avgKm.toFixed(1) }], lineStyle: { type: "dashed", color: mutedColor() }, label: { formatter: avgName + " " + avgKm.toFixed(0) + " km", color: mutedColor(), fontSize: 10 } } },
        { name: "次数", type: "line", yAxisIndex: 1, data: cnt, smooth: true, symbol: "none", lineStyle: { width: 1.6 }, itemStyle: { color: "#58a6ff" } }
      ]
    }, true);
    // 脚注：本期 vs 上期 + 均值
    var foot = $("volumeFoot");
    if (foot) {
      if (dist.length >= 2) {
        var cur = dist[dist.length - 1], prev = dist[dist.length - 2];
        var diff = prev ? Math.round((cur - prev) / prev * 100) : 0;
        foot.textContent = "本" + unit + " " + cur.toFixed(1) + " km，较上" + unit + (diff >= 0 ? "增加 " : "减少 ") + Math.abs(diff) + "%，" + avgName + " " + avgKm.toFixed(1) + " km。";
      } else {
        foot.textContent = avgName + " " + avgKm.toFixed(1) + " km（数据不足两期，暂不比较）。";
      }
    }
  }
  function bindVolumeSeg() {
    var seg = $("volSeg"); if (!seg) { return; }
    var btns = [].slice.call(seg.querySelectorAll("button"));
    btns.forEach(function (b) {
      b.onclick = function () {
        var g = b.getAttribute("data-g");
        if (g === VOL_G) { return; }
        VOL_G = g;
        btns.forEach(function (x) { x.classList.toggle("on", x === b); });
        renderVolume();
      };
    });
  }

  // ---------- 跑量日历热力图（日粒度）----------
  // 单年视图（GitHub 贡献图式）+ 年份切换：每格 = 一天，色深 = 当天跑量。
  function calendarYears() {
    var ys = [];
    DATA.activities.forEach(function (a) {
      if (a.date) { var y = a.date.slice(0, 4); if (ys.indexOf(y) < 0) { ys.push(y); } }
    });
    return ys.sort();
  }

  function renderCalendar() {
    var box = $("chartCalendar");
    if (!box) { return; }
    var byDay = {};
    DATA.activities.forEach(function (a) {
      if (!a.date) { return; }
      if (!byDay[a.date]) { byDay[a.date] = { d: 0, n: 0 }; }
      byDay[a.date].d += a.distanceM || 0; byDay[a.date].n++;
    });
    var dates = Object.keys(byDay).sort();
    if (!dates.length) {
      if (calendarChart) { calendarChart.dispose(); calendarChart = null; }
      box.style.height = "auto";
      box.innerHTML = UI.stateHtml("empty", "这段时间还没有跑步记录，日历先空着");
      return;
    }
    var years = calendarYears();
    var y = (CAL_YEAR && years.indexOf(CAL_YEAR) >= 0) ? CAL_YEAR : years[years.length - 1];
    var data = dates
      .filter(function (x) { return x.slice(0, 4) === y; })
      .map(function (x) { return [x, +(byDay[x].d / 1000).toFixed(2)]; });
    var maxKm = Math.max(5, Math.ceil(Math.max.apply(null, data.map(function (p) { return p[1]; }))));
    var light = isLight();
    // 按卡片可用宽度反推格子大小，让单年日历横向铺满（不再左侧挤一小块）
    var left = 44, right = 14, top = 34, bottom = 44;
    var w = box.clientWidth || box.offsetWidth || 700;
    var cw = Math.floor((w - left - right) / 53);
    cw = Math.max(9, Math.min(cw, 26));
    box.style.height = (top + cw * 7 + bottom) + "px";
    if (!calendarChart) { calendarChart = mk("chartCalendar"); }
    calendarChart.setOption({
      tooltip: {
        formatter: function (p) {
          var k = p.data[0], v = p.data[1], n = byDay[k].n;
          return k + "<br/>跑量 " + v + " km" + (n > 1 ? "（" + n + " 次）" : "");
        }
      },
      visualMap: {
        min: 0, max: maxKm, orient: "horizontal", left: "center", bottom: 0,
        itemWidth: 120, itemHeight: 10, text: ["多", "少"], textStyle: { color: mutedColor(), fontSize: 10 },
        inRange: { color: light ? ["#ffe6d1", "#f2620a"] : ["#2a1a10", "#ff6b1a"] }
      },
      calendar: {
        range: y, top: top, left: left, right: right, cellSize: [cw, cw],
        splitLine: { show: false },
        itemStyle: { color: light ? "#eef2f7" : "#1c232c", borderColor: light ? "#f7fafc" : "#0d1117" },
        dayLabel: { nameMap: ["日", "一", "二", "三", "四", "五", "六"], color: mutedColor(), fontSize: 10 },
        monthLabel: { nameMap: "cn", color: mutedColor(), fontSize: 10 },
        yearLabel: { show: false }
      },
      series: [{ type: "heatmap", coordinateSystem: "calendar", calendarIndex: 0, data: data }]
    }, true);
    calendarChart.resize();
  }

  // 年份分段切换（按钮按数据里出现过的年份生成，默认选最新一年）
  function bindCalendarSeg() {
    var seg = $("calSeg");
    if (!seg) { return; }
    var years = calendarYears();
    if (!years.length) { seg.innerHTML = ""; return; }
    if (!CAL_YEAR || years.indexOf(CAL_YEAR) < 0) { CAL_YEAR = years[years.length - 1]; }
    seg.innerHTML = years.map(function (y) {
      return '<button type="button" data-y="' + y + '"' + (y === CAL_YEAR ? ' class="on"' : "") + ">" + y + "</button>";
    }).join("");
    var btns = [].slice.call(seg.querySelectorAll("button"));
    btns.forEach(function (b) {
      b.onclick = function () {
        var y = b.getAttribute("data-y");
        if (y === CAL_YEAR) { return; }
        CAL_YEAR = y;
        btns.forEach(function (x) { x.classList.toggle("on", x === b); });
        renderCalendar();
      };
    });
  }

  // ---------- 跑量规律 & 纪录（频率 / 连续性 / 极值 / 环比-同比）----------
  function computeStats() {
    var acts = DATA.activities.filter(function (a) { return a.date; });
    if (!acts.length) { return null; }
    var byDay = {};
    acts.forEach(function (a) { byDay[a.date] = (byDay[a.date] || 0) + (a.distanceM || 0); });
    var days = Object.keys(byDay).sort();
    var first = Date.parse(days[0] + "T00:00:00Z"), last = Date.parse(days[days.length - 1] + "T00:00:00Z");
    var span = Math.round((last - first) / 86400000) + 1;
    var best = 0, cur = 0, prev = null;
    days.forEach(function (d) {
      var ts = Date.parse(d + "T00:00:00Z");
      cur = (prev !== null && ts - prev === 86400000) ? cur + 1 : 1;
      if (cur > best) { best = cur; }
      prev = ts;
    });
    var wmap = {}, mmap = {};
    acts.forEach(function (a) {
      var wk = weekKey(a.date), mo = a.date.slice(0, 7);
      wmap[wk] = (wmap[wk] || 0) + (a.distanceM || 0);
      mmap[mo] = (mmap[mo] || 0) + (a.distanceM || 0);
    });
    var maxOf = function (o) { return Math.max.apply(null, Object.keys(o).map(function (k) { return o[k]; })); };
    var weeks = Object.keys(wmap).length;
    return {
      span: span, trainDays: days.length, restDays: span - days.length, best: best,
      perWeek: weeks ? acts.length / weeks : 0,
      maxRun: Math.max.apply(null, acts.map(function (a) { return a.distanceM || 0; })),
      maxDay: maxOf(byDay), maxWeek: maxOf(wmap), maxMonth: maxOf(mmap),
      lastDate: days[days.length - 1]
    };
  }
  function pct(cur, prev) { return prev ? Math.round((cur - prev) / prev * 100) : null; }
  // 同期对比用的日期小工具（ISO 字符串可直接比大小）
  function dayDiff(a, b) { return Math.round((Date.parse(b + "T00:00:00Z") - Date.parse(a + "T00:00:00Z")) / 86400000); }
  function addDays(dateStr, n) { return new Date(Date.parse(dateStr + "T00:00:00Z") + n * 86400000).toISOString().slice(0, 10); }
  function prevMonthStart(m0) {
    var y = +m0.slice(0, 4), m = +m0.slice(5, 7) - 1;
    if (m === 0) { m = 12; y -= 1; }
    return y + "-" + ("0" + m).slice(-2) + "-01";
  }
  function sumWindow(from, to) {
    var s = 0;
    DATA.activities.forEach(function (a) { if (a.date && a.date >= from && a.date <= to) { s += a.distanceM || 0; } });
    return s;
  }
  function signedPct(d) { return d == null ? "" : "（" + (d >= 0 ? "+" : "") + d + "%）"; }
  function renderStats() {
    var grid = $("statGrid"), foot = $("statFoot");
    if (!grid) { return; }
    var s = computeStats();
    if (!s) { grid.innerHTML = ""; return; }
    var tiles = [
      ["数据跨度", s.span, "天"],
      ["训练天数", s.trainDays, "天 · " + Math.round(s.trainDays / s.span * 100) + "%"],
      ["休息天数", s.restDays, "天"],
      ["平均每周", s.perWeek.toFixed(1), "次"],
      ["最长连训", s.best, "天"],
      ["最长单次", (s.maxRun / 1000).toFixed(1), "km"],
      ["最大单日", (s.maxDay / 1000).toFixed(1), "km"],
      ["最大单周", (s.maxWeek / 1000).toFixed(1), "km"],
      ["最大单月", (s.maxMonth / 1000).toFixed(1), "km"]
    ];
    grid.innerHTML = tiles.map(function (t) {
      return '<div class="stat"><div class="k">' + t[0] + '</div><div class="v">' + t[1] + ' <small>' + t[2] + "</small></div></div>";
    }).join("");
    if (foot) {
      var last = s.lastDate;                          // 数据最后一天当作“今天”
      var seg = [];
      // 本月至今 vs 上月同期（截至同一天，避免“整月 vs 不足月”误导）
      var curM = last.slice(0, 7), curMStart = curM + "-01";
      var prevMStart = prevMonthStart(curM), prevMEnd = addDays(curMStart, -1);
      var prevMSameEnd = addDays(prevMStart, dayDiff(curMStart, last));
      if (prevMSameEnd > prevMEnd) { prevMSameEnd = prevMEnd; }
      var curMv = sumWindow(curMStart, last), prevMv = sumWindow(prevMStart, prevMSameEnd);
      seg.push("本月至今（" + last.slice(5) + "）" + (curMv / 1000).toFixed(1) + " km" +
        (prevMv ? "，上月同期 " + (prevMv / 1000).toFixed(1) + " km" + signedPct(pct(curMv, prevMv)) : ""));
      // 本年至今 vs 去年同期（截至同一天）
      var curY = last.slice(0, 4), prevY = String(+curY - 1);
      var curYStart = curY + "-01-01", prevYStart = prevY + "-01-01";
      var prevYSameEnd = addDays(prevYStart, dayDiff(curYStart, last));
      var curYv = sumWindow(curYStart, last), prevYv = sumWindow(prevYStart, prevYSameEnd);
      var dY = pct(curYv, prevYv);
      seg.push("本年至今 " + (curYv / 1000).toFixed(1) + " km" +
        (prevYv ? "，去年同期 " + (prevYv / 1000).toFixed(1) + " km" +
          (dY != null && Math.abs(dY) > 999 ? "（去年同期基数过小，不作百分比）" : signedPct(dY)) : ""));
      foot.innerHTML = "环比 / 同比（同期对比）　·　" + seg.join("　·　");
    }
  }

  function renderPace() {
    var acts = DATA.activities.slice(0, 40).slice().reverse();
    var x = acts.map(function (a) { return a.date.slice(5); });
    var pace = acts.map(function (a) { return a.paceSec ? +(a.paceSec / 60).toFixed(2) : null; });
    var hr = acts.map(function (a) { return a.avgHr || null; });
    mk("chartPace").setOption({
      tooltip: {
        trigger: "axis", formatter: function (ps) {
          var i = ps[0].dataIndex, a = acts[i];
          return a.date + " " + sportName(a) + "<br/>" + fmtDist(a.distanceM) + " · 配速 " + fmtPace(a.paceSec) + "/km · 心率 " + (a.avgHr || "—") + " bpm";
        }
      },
      legend: { data: ["配速(min/km)", "心率(bpm)"], textStyle: { color: mutedColor(), fontSize: 10 }, itemWidth: 10, itemHeight: 8, icon: "roundRect", right: 0, top: 0 },
      grid: { left: 44, right: 46, top: 36, bottom: 28 },
      xAxis: Object.assign({ type: "category", data: x, boundaryGap: false }, axisCfg()),
      yAxis: [
        Object.assign({ type: "value", inverse: true, name: "配速", min: function (v) { return Math.max(3, Math.floor(v.min * 2) / 2 - 0.5); } }, axisCfg()),
        Object.assign(axisCfg(), { type: "value", name: "心率", splitLine: { show: false } })
      ],
      series: [
        { name: "配速(min/km)", type: "line", data: pace, smooth: true, symbol: "none", connectNulls: true,
          lineStyle: { width: 1.8, color: "#ff6b1a" },
          itemStyle: { color: "#ff6b1a" },
          areaStyle: {
            color: new echarts.graphic.LinearGradient(0, 0, 0, 1, [
              { offset: 0, color: "rgba(255,107,26,.20)" },
              { offset: 1, color: "rgba(255,107,26,0)" }
            ])
          } },
        { name: "心率(bpm)", type: "line", yAxisIndex: 1, data: hr, smooth: true, symbol: "none", connectNulls: true,
          lineStyle: { width: 1.3, opacity: .55 }, itemStyle: { color: "#f85149" } }
      ]
    });
  }

  function renderLoad() {
    var rows = (DATA.trainingLoad || []).slice().sort(function (a, b) { return a.date < b.date ? -1 : 1; });
    if (rows.length < 2) {
      var why = (DATA.capabilities || {}).loadHistory === false
        ? "该品牌暂未提供负荷历史" : ("仅 " + rows.length + " 天");
      $("chartLoad").innerHTML = UI.stateHtml("empty", "负荷" + why + "，画不出趋势");
      return;
    }
    var x = rows.map(function (r) { return r.date.slice(5); });
    mk("chartLoad").setOption({
      // 负荷比口径按品牌标注来源：佳明 = Garmin ACWR；高驰 = COROS Load Ratio（不把两个口径合成一个数）
      tooltip: {
        trigger: "axis",
        formatter: function (ps) {
          var i = ps.length ? ps[0].dataIndex : 0;
          var r = rows[i] || {};
          var lines = [r.date || ""];
          ps.forEach(function (p) {
            lines.push(p.marker + p.seriesName + "：" + (p.value == null ? "—" : p.value));
          });
          if (r.ratio != null) {
            lines.push("负荷比：" + r.ratio + (r.comment ? "（" + r.comment + "）" : ""));
          }
          return lines.join("<br>");
        }
      },
      legend: { data: ["短期负荷", "长期负荷"], textStyle: { color: mutedColor() }, right: 0, top: 0 },
      grid: { left: 40, right: 16, top: 36, bottom: 28 },
      xAxis: Object.assign({ type: "category", data: x, boundaryGap: false }, axisCfg()),
      yAxis: Object.assign({ type: "value" }, axisCfg()),
      series: [
        { name: "短期负荷", type: "line", data: rows.map(function (r) { return r.shortLoad; }), smooth: true, symbolSize: 4, areaStyle: { opacity: .18 }, itemStyle: { color: "#ff6b1a" } },
        { name: "长期负荷", type: "line", data: rows.map(function (r) { return r.longLoad; }), smooth: true, symbolSize: 4, itemStyle: { color: "#58a6ff" } }
      ]
    });
  }

  // ---------- 强度分布（80/20 极化）----------
  // 口径：把五区配速的阈值 T（秒/公里）当分界——配速慢于 T = 轻松，快于 T = 高强度；
  //      按周汇总公里数。缺 paces / 缺距离的条不计入（绝不臆造）。
  function parsePaceStr(s) {
    if (!s) { return null; }
    var p = String(s).split(":");
    if (p.length !== 2) { return null; }
    var m = parseInt(p[0], 10), sec = parseInt(p[1], 10);
    if (isNaN(m) || isNaN(sec)) { return null; }
    return m * 60 + sec;
  }
  function weekKey(dateStr) {           // "2026-02-19" → 当周周一 "2026-02-16"（按 UTC 解析，避免时区偏移）
    var d = new Date(dateStr + "T00:00:00Z");
    d.setUTCDate(d.getUTCDate() - ((d.getUTCDay() + 6) % 7));
    return d.toISOString().slice(0, 10);
  }
  function computeIntensity(paces, weeks) {
    var T = parsePaceStr(paces && paces.T);
    if (!T) { return null; }
    var map = {};
    DATA.activities.forEach(function (a) {
      if (!a.paceSec || !a.distanceM || !a.date) { return; }
      var wk = weekKey(a.date);
      if (!map[wk]) { map[wk] = { easy: 0, hard: 0 }; }
      if (a.paceSec >= T) { map[wk].easy += a.distanceM / 1000; } else { map[wk].hard += a.distanceM / 1000; }
    });
    var keys = Object.keys(map).sort();
    if (keys.length > (weeks || 12)) { keys = keys.slice(-(weeks || 12)); }
    var rows = keys.map(function (k) {
      var e = +map[k].easy.toFixed(2), h = +map[k].hard.toFixed(2), tot = e + h;
      return { week: k, easy: e, hard: h, total: +tot.toFixed(2), hardPct: tot ? Math.round(h / tot * 100) : 0 };
    });
    return { thresholdSec: T, rows: rows };
  }
  function renderIntensity() {
    var card = $("intensityCard");
    var data = computeIntensity((DATA.fitness || {}).paces, 12);
    if (!data || !data.rows.length) { if (card) { card.hidden = true; } return; }
    if (card) { card.hidden = false; }
    var rows = data.rows;
    mk("chartIntensity").setOption({
      tooltip: {
        trigger: "axis", formatter: function (ps) {
          var r = rows[ps[0].dataIndex];
          return r.week + " 当周<br/>轻松 " + r.easy + " km · 高强度 " + r.hard + " km<br/>高强度占比 " + r.hardPct + "%";
        }
      },
      legend: { data: ["轻松(km)", "高强度(km)", "高强度占比(%)"], textStyle: { color: mutedColor() }, right: 0, top: 0 },
      grid: { left: 44, right: 46, top: 36, bottom: 28 },
      xAxis: Object.assign({ type: "category", data: rows.map(function (r) { return r.week.slice(5); }) }, axisCfg()),
      yAxis: [
        Object.assign({ type: "value", name: "km" }, axisCfg()),
        Object.assign({ type: "value", name: "%", max: 100, splitLine: { show: false } }, axisCfg())
      ],
      series: [
        { name: "轻松(km)", type: "bar", stack: "km", data: rows.map(function (r) { return r.easy; }), itemStyle: { color: "#3fb950" }, barMaxWidth: 26 },
        { name: "高强度(km)", type: "bar", stack: "km", data: rows.map(function (r) { return r.hard; }), itemStyle: { color: "#ff6b1a" }, barMaxWidth: 26 },
        { name: "高强度占比(%)", type: "line", yAxisIndex: 1, data: rows.map(function (r) { return r.hardPct; }), smooth: true, symbolSize: 5, itemStyle: { color: "#58a6ff" },
          markLine: { silent: true, symbol: "none", data: [{ yAxis: 20 }], lineStyle: { type: "dashed", color: mutedColor() }, label: { formatter: "目标 ≤20%", color: mutedColor(), fontSize: 10 } } }
      ]
    });
    var last = rows.slice(-4);
    var tot = last.reduce(function (s, r) { return s + r.total; }, 0);
    var hd = last.reduce(function (s, r) { return s + r.hard; }, 0);
    var pct = tot ? Math.round(hd / tot * 100) : 0;
    var judge = pct <= 20 ? "处于极化区间，强度控制良好" : "高强度偏高，可适当增加轻松跑";
    var foot = $("intensityFoot");
    if (foot) {
      foot.textContent = "近 " + last.length + " 周：轻松 " + (tot - hd).toFixed(1) + " km、高强度 " + hd.toFixed(1)
        + " km，高强度占比 " + pct + "%——" + judge + "（阈值配速 " + fmtPace(data.thresholdSec) + "/km）。";
    }
  }

  // ---------- 心率效率（速度 ÷ 心率）----------
  // 口径：只取「有距离 + 有时长 + 有平均心率」的训练，效率 = 速度(m/min) ÷ 平均心率；
  //      只比同类（同 sportType 各一条线），点数 <3 的类型不画。
  function computeHrGroups() {
    var groups = {};
    DATA.activities.forEach(function (a) {
      if (!a.distanceM || !a.durationSec || !a.avgHr) { return; }
      var eff = (a.distanceM / (a.durationSec / 60)) / a.avgHr;
      var st = (a.sportType == null ? -1 : a.sportType);
      if (!groups[st]) { groups[st] = {}; }
      groups[st][a.date] = +eff.toFixed(2);
    });
    return groups;
  }
  function renderHrEfficiency() {
    var card = $("hrEffCard");
    var groups = computeHrGroups();
    var sports = Object.keys(groups).filter(function (k) { return Object.keys(groups[k]).length >= 3; })
      .sort(function (a, b) { return Object.keys(groups[b]).length - Object.keys(groups[a]).length; })
      .slice(0, 3);
    if (!sports.length) { if (card) { card.hidden = true; } return; }
    if (card) { card.hidden = false; }
    var allDates = {};
    sports.forEach(function (s) { Object.keys(groups[s]).forEach(function (d) { allDates[d] = 1; }); });
    var dates = Object.keys(allDates).sort();
    var allVals = [];
    sports.forEach(function (s) { Object.keys(groups[s]).forEach(function (d) { allVals.push(groups[s][d]); }); });
    var mean = allVals.length ? allVals.reduce(function (a, b) { return a + b; }, 0) / allVals.length : 0;
    var COLORS = ["#ff6b1a", "#58a6ff", "#3fb950"];
    mk("chartHrEff").setOption({
      tooltip: { trigger: "axis" },
      legend: { data: sports.map(function (s) { return SPORT[s] || "其他"; }), textStyle: { color: mutedColor() }, right: 0, top: 0 },
      grid: { left: 44, right: 16, top: 36, bottom: 28 },
      xAxis: Object.assign({ type: "category", data: dates.map(function (d) { return d.slice(5); }), boundaryGap: false }, axisCfg()),
      yAxis: Object.assign({ type: "value", name: "效率", scale: true }, axisCfg()),
      series: sports.map(function (s, i) {
        return {
          name: SPORT[s] || "其他", type: "line",
          data: dates.map(function (d) { return groups[s][d] != null ? groups[s][d] : null; }),
          smooth: true, symbolSize: 5, connectNulls: true, itemStyle: { color: COLORS[i % COLORS.length] },
          markLine: i === 0 ? { silent: true, symbol: "none", data: [{ yAxis: +mean.toFixed(2) }], lineStyle: { type: "dashed", color: mutedColor() }, label: { formatter: "均值 " + mean.toFixed(2), color: mutedColor(), fontSize: 10 } } : undefined
        };
      })
    });
    // 脚注：同类最近一次 vs 该类均值
    var foot = $("hrEffFoot");
    if (foot) {
      var primary = sports[0];
      var pds = Object.keys(groups[primary]).sort();
      var lastVal = groups[primary][pds[pds.length - 1]];
      var pv = pds.map(function (d) { return groups[primary][d]; });
      var pmean = pv.reduce(function (a, b) { return a + b; }, 0) / pv.length;
      var diff = pmean ? Math.round((lastVal - pmean) / pmean * 100) : 0;
      foot.textContent = "只比同类（" + (SPORT[primary] || "其他") + "）：最近一次效率 " + lastVal.toFixed(2)
        + "，较同类均值 " + pmean.toFixed(2) + (diff >= 0 ? " 高 " : " 低 ") + Math.abs(diff) + "%"
        + (diff >= 0 ? "——同等心率下跑得更快。" : "。") + "（效率 = 速度 m/min ÷ 平均心率）";
    }
  }

  // ---------- 近一周小结（最近 7 天 vs 前 7 天）----------
  // 口径：以「最近一次训练日」为终点，取**滚动 7 天窗口**——两段各是完整 7 天，比"自然周"更公平
  //      （数据滞后时"本周"不会只有半天）。全部用真实数据；缺失（某段无记录 / 无心率）不臆造，显示「—」。
  function shiftDate(dateStr, days) {
    var d = new Date(dateStr + "T00:00:00Z");
    d.setUTCDate(d.getUTCDate() + days);
    return d.toISOString().slice(0, 10);
  }
  function todayLocalStr() {
    var d = new Date();
    return d.getFullYear() + "-" + ("0" + (d.getMonth() + 1)).slice(-2) + "-" + ("0" + d.getDate()).slice(-2);
  }
  function rangeStats(acts, start, end) {
    var rows = acts.filter(function (a) { return a.date >= start && a.date <= end; });
    var distM = rows.reduce(function (s, a) { return s + (a.distanceM || 0); }, 0);
    var durSec = rows.reduce(function (s, a) { return s + (a.durationSec || 0); }, 0);
    var hrNum = 0, hrDen = 0;
    rows.forEach(function (a) { if (a.avgHr && a.distanceM) { hrNum += a.avgHr * a.distanceM; hrDen += a.distanceM; } });
    return {
      count: rows.length,
      distKm: distM / 1000,
      durSec: durSec,
      paceSec: distM > 0 ? durSec / (distM / 1000) : null,   // 加权配速：总时长 ÷ 总公里
      avgHr: hrDen ? Math.round(hrNum / hrDen) : null
    };
  }
  // 抽出「滚动 7 天窗口」原始数据，供 近一周小结 / 下周训练建议 共用
  function weeklyWindows() {
    var acts = (DATA.activities || []).filter(function (a) { return a.date; });
    if (!acts.length) { return null; }
    var latest = acts[0].date;
    acts.forEach(function (a) { if (a.date > latest) { latest = a.date; } });
    var end = latest, curStart = shiftDate(end, -6);
    var prevEnd = shiftDate(end, -7), prevStart = shiftDate(end, -13);
    var cur = rangeStats(acts, curStart, end), prev = rangeStats(acts, prevStart, prevEnd);

    var T = parsePaceStr((DATA.fitness || {}).paces && DATA.fitness.paces.T);
    function hardPct(start, stop) {                             // 用五区阈值 T 分「轻松 / 高强度」
      if (!T) { return null; }
      var hard = 0, tot = 0;
      acts.forEach(function (a) {
        if (a.date < start || a.date > stop || !a.paceSec || !a.distanceM) { return; }
        tot += a.distanceM; if (a.paceSec < T) { hard += a.distanceM; }
      });
      return tot > 0 ? Math.round(hard / tot * 100) : null;
    }
    function loadPeak(start, stop) {                            // 该窗口「短期负荷」峰值；无数据则 null
      var ls = (DATA.trainingLoad || []).filter(function (r) { return r.date >= start && r.date <= stop; });
      if (!ls.length) { return null; }
      return ls.reduce(function (m, r) { return Math.max(m, r.shortLoad || 0); }, 0);
    }
    return {
      end: end, curStart: curStart, prevStart: prevStart, prevEnd: prevEnd,
      cur: cur, prev: prev, T: T,
      curHard: hardPct(curStart, end), prevHard: hardPct(prevStart, prevEnd),
      curLoad: loadPeak(curStart, end), prevLoad: loadPeak(prevStart, prevEnd)
    };
  }
  function computeWeekly() {
    var w = weeklyWindows();
    if (!w) { return null; }
    var cur = w.cur, prev = w.prev, curHard = w.curHard, prevHard = w.prevHard;
    var curLoad = w.curLoad, prevLoad = w.prevLoad;
    var end = w.end, curStart = w.curStart;

    // 变化列：数值用 % 环比；次数用 +n；配速用快/慢秒数；占比用百分点（pp）
    function pctDelta(c, p) {
      if (!p) { return { s: "—", cls: "wk-flat" }; }
      var d = Math.round((c - p) / p * 100);
      if (d === 0) { return { s: "→ 持平", cls: "wk-flat" }; }
      return { s: (d > 0 ? "↑ " : "↓ ") + Math.abs(d) + "%", cls: d > 0 ? "wk-up" : "wk-down" };
    }
    function countDelta(c, p) {
      var d = c - p;
      if (d === 0) { return { s: "→ 持平", cls: "wk-flat" }; }
      return { s: (d > 0 ? "+" : "−") + Math.abs(d), cls: d > 0 ? "wk-up" : "wk-down" };
    }
    function paceDelta(c, p) {
      if (c == null || p == null) { return { s: "—", cls: "wk-flat" }; }
      var d = Math.round(c - p);
      if (d === 0) { return { s: "→ 持平", cls: "wk-flat" }; }
      return { s: (d < 0 ? "快 " : "慢 ") + Math.abs(d) + "s", cls: d < 0 ? "wk-fast" : "wk-slow" };
    }
    function ppDelta(c, p) {
      if (c == null || p == null) { return { s: "—", cls: "wk-flat" }; }
      var d = c - p;
      if (d === 0) { return { s: "→ 持平", cls: "wk-flat" }; }
      return { s: (d > 0 ? "↑ " : "↓ ") + Math.abs(d) + "pp", cls: "wk-flat" };
    }
    function bpmDelta(c, p) {
      if (c == null || p == null) { return { s: "—", cls: "wk-flat" }; }
      var d = c - p;
      if (d === 0) { return { s: "→ 持平", cls: "wk-flat" }; }
      return { s: (d > 0 ? "+" : "−") + Math.abs(d) + " bpm", cls: "wk-flat" };
    }
    function numDelta(c, p) {
      if (c == null || p == null) { return { s: "—", cls: "wk-flat" }; }
      var d = c - p;
      if (d === 0) { return { s: "→ 持平", cls: "wk-flat" }; }
      return { s: (d > 0 ? "+" : "−") + Math.abs(d), cls: "wk-flat" };
    }

    var rows = [];
    rows.push(["跑量", cur.distKm.toFixed(1) + " km", prev.distKm.toFixed(1) + " km", pctDelta(cur.distKm, prev.distKm)]);
    rows.push(["时长", cur.count ? fmtDur(cur.durSec) : "—", prev.count ? fmtDur(prev.durSec) : "—", pctDelta(cur.durSec, prev.durSec)]);
    rows.push(["次数", cur.count + " 次", prev.count + " 次", countDelta(cur.count, prev.count)]);
    rows.push(["平均配速", cur.paceSec ? fmtPace(cur.paceSec) + "/km" : "—", prev.paceSec ? fmtPace(prev.paceSec) + "/km" : "—", paceDelta(cur.paceSec, prev.paceSec)]);
    if (cur.avgHr != null || prev.avgHr != null) {
      rows.push(["平均心率", cur.avgHr != null ? cur.avgHr + " bpm" : "—", prev.avgHr != null ? prev.avgHr + " bpm" : "—", bpmDelta(cur.avgHr, prev.avgHr)]);
    }
    if (curHard != null || prevHard != null) {
      rows.push(["高强度占比", curHard != null ? curHard + "%" : "—", prevHard != null ? prevHard + "%" : "—", ppDelta(curHard, prevHard)]);
    }
    if (curLoad != null || prevLoad != null) {
      rows.push(["短期负荷", curLoad != null ? String(curLoad) : "—", prevLoad != null ? String(prevLoad) : "—", numDelta(curLoad, prevLoad)]);
    }

    // 一句话点评
    var comment;
    if (prev.count === 0) {
      comment = "前 7 天没有训练记录；最近 7 天 " + cur.distKm.toFixed(1) + " km / " + cur.count + " 次。";
    } else if (prev.distKm <= 0) {
      comment = "最近 7 天 " + cur.distKm.toFixed(1) + " km / " + cur.count + " 次。";
    } else {
      var dd = Math.round((cur.distKm - prev.distKm) / prev.distKm * 100);
      comment = (dd > 0 ? "跑量较前 7 天增加 " + dd + "%" : (dd < 0 ? "跑量较前 7 天减少 " + Math.abs(dd) + "%" : "跑量与前 7 天持平"))
        + "（最近 7 天 " + cur.distKm.toFixed(1) + " km / " + cur.count + " 次）";
      if (curHard != null) {
        comment += "；高强度占比 " + curHard + "%" + (curHard > 20 ? "（高于 20% 目标，注意多安排轻松跑）" : "（在极化区间内）");
      }
      comment += "。";
    }
    if (end !== todayLocalStr()) { comment = "（数据截至 " + end.slice(5).replace("-", "/") + "）" + comment; }

    return {
      range: curStart.slice(5).replace("-", "/") + "–" + end.slice(5).replace("-", "/"),
      rows: rows,
      comment: comment
    };
  }
  function renderWeekly() {
    var card = $("weeklyCard");
    if (!card) { return; }
    var s = computeWeekly();
    if (!s) { card.hidden = true; return; }
    card.hidden = false;
    $("weekHint").textContent = s.range;
    var html = '<div class="wk-row wk-head"><span class="wk-k">指标</span><span class="wk-v">近 7 天</span><span class="wk-v">前 7 天</span><span class="wk-d">变化</span></div>';
    s.rows.forEach(function (r) {
      html += '<div class="wk-row"><span class="wk-k">' + esc(r[0]) + '</span><span class="wk-v">' + esc(r[1])
        + '</span><span class="wk-v">' + esc(r[2]) + '</span><span class="wk-d ' + r[3].cls + '">' + esc(r[3].s) + '</span></div>';
    });
    $("weekTable").innerHTML = html;
    $("weekFoot").textContent = s.comment;
  }

  // ---------- 下周训练建议（前端规则生成，不填目标也能用）----------
  // 依据：最近 7 天 vs 前 7 天的跑量环比、强度占比、训练频次、今日状态灯、五区配速。
  // 只给「量 / 强度 / 频次 / 配速参考」几类通用建议，非课表、非医疗建议。
  function computeNextWeek() {
    var w = weeklyWindows();
    if (!w) { return null; }
    var cur = w.cur, prev = w.prev;
    var items = [];

    // 跑量环比（前 7 天有量才算，否则无法比较）
    var dd = (prev.count > 0 && prev.distKm > 0)
      ? Math.round((cur.distKm - prev.distKm) / prev.distKm * 100) : null;
    var r = DATA.readiness || {};
    var needRecover = !!r.status && r.status !== "ok";

    // 档位：恢复 / 减量 / 加量 / 保持
    var stance;
    if (cur.count === 0) { stance = "restart"; }
    else if (needRecover) { stance = "recover"; }
    else if (dd != null && dd > 30) { stance = "cut"; }
    else if (dd != null && dd < -30) { stance = "build"; }
    else { stance = "hold"; }

    function km(x) { return Math.round(x); }

    // ① 量
    if (stance === "restart") {
      items.push(["恢复", "nw-recover", "本周没有训练记录。下周先恢复规律：安排 2–3 次轻松跑，每次 20–30 分钟即可，别一上来就冲强度。"]);
    } else if (stance === "recover") {
      items.push(["减量", "nw-cut", "今日状态灯建议「" + (r.label || "恢复") + "」。下周先降量，目标约 " + km(cur.distKm * 0.8) + " km（较本周 -20%），全程轻松跑。"]);
    } else if (stance === "cut") {
      items.push(["减量", "nw-cut", "本周跑量较前 7 天增加 " + dd + "%，增量偏快（一般每周 ≤10%）。下周别再加量，保持或回调到 " + km(cur.distKm * 0.9) + " km 左右。"]);
    } else if (stance === "build") {
      items.push(["加量", "nw-build", "本周跑量较前 7 天减少 " + Math.abs(dd) + "%。下周可逐步回升到 " + km(cur.distKm * 1.1) + " km 左右（增幅 ≤10%）。"]);
    } else {
      items.push(["保持", "nw-hold", "本周跑量 " + cur.distKm.toFixed(1) + " km，节奏稳定。下周保持相近水平，小幅加量也别超过 " + km(cur.distKm * 1.1) + " km。"]);
    }

    // ② 强度占比（需有阈值配速才算得出）
    if (w.curHard != null) {
      if (w.curHard > 20) {
        items.push(["强度", "nw-intensity", "本周高强度占比 " + w.curHard + "%（高于 20% 目标）。下周多安排轻松跑，把高强度压回 ≤20%，形成 80/20 极化。"]);
      } else {
        items.push(["强度", "nw-intensity", "本周高强度占比 " + w.curHard + "%（在 ≤20% 目标内）。下周保持：轻松跑打底，强度课 1–2 次。"]);
      }
    }

    // ③ 频次
    if (cur.count > 0 && cur.count < 3) {
      items.push(["频次", "nw-hold", "本周只练了 " + cur.count + " 次，偏少。下周争取 3–4 次，把跑量摊开、别一次练太猛。"]);
    } else if (cur.count >= 6) {
      items.push(["恢复", "nw-recover", "本周练了 " + cur.count + " 次，密度偏高。下周保证至少 1 天完全休息，给身体恢复时间。"]);
    }

    // ④ 配速参考（五区）
    var paces = (DATA.fitness || {}).paces;
    if (paces && paces.E) {
      items.push(["配速", "nw-pace", "轻松跑参考配速 " + paces.E + " /km（E 区间）；阈值跑 " + paces.T + " /km。慢下来，才能快起来。"]);
    }

    var headline;
    if (stance === "restart") { headline = "下周：先从恢复规律开始"; }
    else if (stance === "recover") { headline = "下周：以恢复为主，先别上强度"; }
    else if (stance === "cut") { headline = "下周：稳住别加量，控制强度"; }
    else if (stance === "build") { headline = "下周：逐步回升，稳步加量"; }
    else { headline = "下周：保持稳定节奏"; }

    return { headline: headline, items: items };
  }
  function renderNextWeek() {
    var card = $("nextWeekCard");
    if (!card) { return; }
    var s = computeNextWeek();
    if (!s || !s.items.length) { card.hidden = true; return; }
    card.hidden = false;
    $("nextWeekHeadline").textContent = s.headline;
    $("nextWeekList").innerHTML = s.items.map(function (it) {
      return '<div class="nw-item"><span class="nw-tag ' + it[1] + '">' + esc(it[0])
        + '</span><span class="nw-text">' + esc(it[2]) + "</span></div>";
    }).join("");
    $("nextWeekFoot").textContent = "按最近 7 天数据自动生成，仅作训练参考，非医疗建议。";
  }

  // ---------- 活动列表 ----------
  var shown = 20;
  function renderList() {
    var acts = DATA.activities;
    $("actCount").textContent = "共 " + acts.length + " 次";
    var html = acts.slice(0, shown).map(function (a) {
      return '<div class="act" data-id="' + a.labelId + '">' +
        '<div><div class="date">' + a.date + '</div></div>' +
        '<div><div class="title">' + esc(sportName(a)) + (a.location ? '<span class="badge">' + esc(a.location) + "</span>" : "") + "</div></div>" +
        '<div><div class="dist">' + fmtDist(a.distanceM) + '</div><div class="pace">' + (a.paceSec ? fmtPace(a.paceSec) + "/km · " + (a.avgHr || "—") + "bpm" : "") + "</div></div>" +
        "</div>";
    }).join("");
    $("activityList").innerHTML = html;
    $("moreBtn").hidden = shown >= acts.length;
    Array.prototype.forEach.call(document.querySelectorAll(".act"), function (el) {
      el.onclick = function () { openDetail(el.getAttribute("data-id")); };
    });
  }

  // ---------- 单次详情弹窗 ----------
  function openDetail(labelId) {
    var a = DATA.activities.filter(function (x) { return x.labelId === labelId; })[0];
    if (!a) return;
    var d = (DATA.details || {})[labelId] || {};
    var cells = [
      ["距离", fmtDist(a.distanceM)], ["用时", fmtDur(a.durationSec)], ["平均配速", fmtPace(a.paceSec) + "/km"],
      ["平均心率", (d.avgHr || a.avgHr || "—") + " bpm"], ["平均步频", (d.avgCadence || "—") + " spm"], ["平均功率", (d.avgPowerW || "—") + " W"],
      ["平均步幅", (d.avgStrideM ? d.avgStrideM + " m" : "—")], ["累计爬升", (d.elevGainM != null ? d.elevGainM + " m" : "—")], ["消耗", (a.calories || "—") + " kcal"],
      ["训练负荷", d.trainingLoad != null ? d.trainingLoad : "—"], ["有氧效果", d.aerobicTE != null ? d.aerobicTE : "—"], ["训练重点", d.trainingFocus || "—"]
    ];
    var body = '<div class="m-title">' + esc(sportName(a)) + (a.location ? " · " + esc(a.location) : "") + "</div>" +
      '<div class="m-sub">' + a.date + (d.performance ? " · 表现：" + esc(d.performance) : "") + "</div>" +
      '<div class="m-grid">' + cells.map(function (c) { return '<div class="m-cell"><div class="k">' + c[0] + '</div><div class="v">' + esc(c[1]) + "</div></div>"; }).join("") + "</div>" +
      '<h3 style="font-size:14px;margin:16px 0 8px">分段配速 / 心率</h3><div id="lapChart" style="width:100%;height:260px"></div>';
    $("modalBody").innerHTML = body;
    $("modal").hidden = false;
    drawLaps(labelId);
  }

  function pickLapGroup(laps) {
    if (!laps || !laps.lapGroups || !laps.lapGroups.length) return null;
    var g = laps.lapGroups.filter(function (x) { return x.type === 2 && x.laps && x.laps.length > 1; })[0];
    if (g) return g;
    return laps.lapGroups.slice().sort(function (a, b) { return (b.laps || []).length - (a.laps || []).length; })[0];
  }

  function drawLaps(labelId) {
    var laps = (DATA.laps || {})[labelId];
    var g = pickLapGroup(laps);
    var el = $("lapChart");
    if (!g || !g.laps || !g.laps.length) { el.innerHTML = '<div style="color:var(--muted);padding:16px 4px">该次没有分段数据</div>'; return; }
    var rows = g.laps;
    var x = rows.map(function (l, i) { return "第" + (i + 1) + "段"; });
    var pace = rows.map(function (l) { return l.avgPace ? +(l.avgPace / 60).toFixed(2) : null; });
    var hr = rows.map(function (l) { return l.avgHr || null; });
    echarts.init(el).setOption({
      tooltip: {
        trigger: "axis", formatter: function (ps) {
          var i = ps[0].dataIndex, l = rows[i];
          return "第" + (i + 1) + " 段 · " + fmtDistCm(l.distance) + "<br/>配速 " + fmtPace(l.avgPace) + "/km · 心率 " + (l.avgHr || "—") + " bpm";
        }
      },
      legend: { data: ["配速(min/km)", "心率(bpm)"], textStyle: { color: mutedColor() }, right: 0, top: 0 },
      grid: { left: 44, right: 46, top: 32, bottom: 26 },
      xAxis: Object.assign({ type: "category", data: x, boundaryGap: false }, axisCfg()),
      yAxis: [
        Object.assign({ type: "value", inverse: true, name: "配速" }, axisCfg()),
        Object.assign({ type: "value", name: "心率", splitLine: { show: false } }, axisCfg())
      ],
      series: [
        { name: "配速(min/km)", type: "line", data: pace, smooth: true, symbolSize: 6, itemStyle: { color: "#ff6b1a" }, label: { show: true, color: isLight() ? "#1f2328" : "#c9d1d9", fontSize: 10, formatter: function (p) { return fmtPace(rows[p.dataIndex].avgPace); } } },
        { name: "心率(bpm)", type: "line", yAxisIndex: 1, data: hr, smooth: true, symbolSize: 6, itemStyle: { color: "#f85149" } }
      ]
    });
  }

  // ---------- 比赛模块 ----------
  // 目的：把「比赛」从普通训练里拎出来单独管理——
  //   ① 标记已跑比赛（从记录里选一次，设为比赛）② 添加计划比赛（倒计时）
  //   ③ 比赛专项分析（前后半程 / 负分割 / 半程比值 R / 配速波动 CV / 心率漂移 / 撞墙）
  //   ④ 个人 PB（按最接近的标准距离自动归类）
  // 存储：本机服务端 /api/races（按账户码存 races.json，仅本人可见、不上传）；公网云端版无此接口时退回本机缓存。
  var RACES = [];
  var RACES_READY = false;
  var RACE_LS = "coros_races_cache";
  var RACE_CATS = { "": "不设", A: "A 目标赛", B: "B 次目标", C: "C 体验赛" };
  var RACE_STD = [
    { key: "5K", label: "5K", m: 5000, tol: 500 },
    { key: "10K", label: "10K", m: 10000, tol: 700 },
    { key: "Half", label: "半马", m: 21097, tol: 1500 },
    { key: "Marathon", label: "全马", m: 42195, tol: 3000 }
  ];

  function isRunSport(t) { return t === 100 || t === 101 || t === 102; }
  function actById(labelId) {
    return (DATA.activities || []).filter(function (x) { return x.labelId === labelId; })[0];
  }
  function stdFor(m) {
    var best = null, gap = Infinity;
    RACE_STD.forEach(function (s) { var g = Math.abs(m - s.m); if (g <= s.tol && g < gap) { best = s; gap = g; } });
    return best;
  }
  function daysUntil(dateStr) {
    var d = new Date(dateStr + "T00:00:00");
    var t = new Date(); t.setHours(0, 0, 0, 0);
    return Math.round((d.getTime() - t.getTime()) / 86400000);
  }
  function todayStr() {
    var t = new Date();
    return t.getFullYear() + "-" + ("0" + (t.getMonth() + 1)).slice(-2) + "-" + ("0" + t.getDate()).slice(-2);
  }
  function raceById(id) { return scopedRaces().filter(function (x) { return x.id === id; })[0]; }

  // 比赛记录按品牌隔离：同一账户可能先后用高驰/佳明，两边的比赛不能串台。
  // 老记录没有 provider 字段 → 视为 coros（兼容历史数据）。
  function raceProvider() { return (DATA && DATA.provider === "garmin") ? "garmin" : "coros"; }
  function scopedRaces() {
    var p = raceProvider();
    return RACES.filter(function (r) { return (r.provider || "coros") === p; });
  }

  // ---- 读写：本机服务端优先，失败（云端版 / 服务未开）退回本机缓存 ----
  function raceLoad() {
    return fetch(Store.apiUrl("api/races") + "?device=" + encodeURIComponent(Store.getDeviceId()))
      .then(function (r) { return r.json(); })
      .then(function (j) {
        if (j && j.error) { throw new Error(j.error); }
        RACES = (j && j.races) || [];
        RACES_READY = true;
        return RACES;
      })
      .catch(function () {
        try { RACES = JSON.parse(localStorage.getItem(RACE_LS) || "[]") || []; } catch (e) { RACES = []; }
        RACES_READY = true;
        return RACES;
      });
  }
  function racePersist() {
    try { localStorage.setItem(RACE_LS, JSON.stringify(RACES)); } catch (e) { /* 忽略 */ }
    fetch(Store.apiUrl("api/races"), {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ device: Store.getDeviceId(), races: RACES })
    }).catch(function () { /* 云端版无此接口：已存本机缓存 */ });
    renderRaces();
  }

  // ---- 弹窗表单小工具（复用站内 #modal）----
  function showModal(html) { $("modalBody").innerHTML = html; $("modal").hidden = false; }
  function field(label, inner) {
    return '<label class="race-field"><span class="race-field__k">' + esc(label) + "</span>" + inner + "</label>";
  }
  function catSelect(cur) {
    return '<select id="rfCat">' + ["A", "B", "C", ""].map(function (v) {
      return '<option value="' + v + '"' + (v === (cur || "") ? " selected" : "") + ">" + esc(RACE_CATS[v]) + "</option>";
    }).join("") + "</select>";
  }

  // ---- ① 添加计划比赛 ----
  function openAddRace() {
    showModal(
      '<div class="m-title">添加计划比赛</div>' +
      '<div class="race-form">' +
        field("比赛名称", '<input id="rfName" type="text" maxlength="40" placeholder="如：南昌马拉松">') +
        field("比赛日期", '<input id="rfDate" type="date" value="' + todayStr() + '">') +
        field("距离（km）", '<input id="rfDist" type="number" min="0" step="0.1" inputmode="decimal" placeholder="42.195">') +
        field("定位", catSelect("A")) +
        field("目标", '<input id="rfTarget" type="text" maxlength="40" placeholder="如：sub-3:30">') +
        '<div class="race-form__actions"><button type="button" class="race-btn" id="rfSave">保存</button></div>' +
      "</div>"
    );
    $("rfSave").onclick = function () {
      var name = ($("rfName").value || "").trim();
      var date = ($("rfDate").value || "").trim();
      if (!name) { UI.toast("请填比赛名称"); return; }
      if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) { UI.toast("请选比赛日期"); return; }
      var km = parseFloat($("rfDist").value);
      RACES.push({
        id: "r" + Date.now().toString(36), kind: "planned", labelId: "",
        provider: raceProvider(),
        name: name, date: date, distanceM: isFinite(km) ? Math.round(km * 1000) : 0,
        category: $("rfCat").value || "", target: ($("rfTarget").value || "").trim(),
        note: "", createdAt: Date.now(), updatedAt: Date.now()
      });
      $("modal").hidden = true;
      racePersist();
      UI.toast("已添加计划比赛");
    };
  }

  // ---- ② 从记录里标记已跑比赛（含自动识别）----
  // 基线：全体跑步的配速中位数、距离 90/95 分位——用来判断「比日常明显快 / 明显长」。
  function raceBaseline() {
    var runs = (DATA.activities || []).filter(function (a) { return isRunSport(a.sportType) && a.paceSec && a.distanceM; });
    if (!runs.length) { return null; }
    var paces = runs.map(function (a) { return a.paceSec; }).sort(function (x, y) { return x - y; });
    var dists = runs.map(function (a) { return a.distanceM; }).sort(function (x, y) { return x - y; });
    return {
      medPace: paces[Math.floor(paces.length / 2)],
      p90: dists[Math.floor(dists.length * 0.9)],
      p95: dists[Math.floor(dists.length * 0.95)]
    };
  }
  // 标准距离（含权重：越难在日常跑到的距离，命中越像比赛）
  var RACE_STD_SCORE = [
    { label: "全马", m: 42195, tol: 3000, w: 50 },
    { label: "半马", m: 21097, tol: 1500, w: 40 },
    { label: "10K", m: 10000, tol: 700, w: 18 },
    { label: "5K", m: 5000, tol: 500, w: 10 }
  ];
  // 自动识别「疑似比赛」：命中标准距离 + 配速明显快于日常 + 超出日常长距离 + 户外/周末 加分，跑步机减分。
  function detectRaces() {
    var base = raceBaseline();
    if (!base) { return []; }
    var marked = {};
    scopedRaces().forEach(function (r) { if (r.labelId) { marked[r.labelId] = 1; } });
    var out = [];
    (DATA.activities || []).forEach(function (a) {
      if (!isRunSport(a.sportType) || !a.paceSec || !a.distanceM || marked[a.labelId]) { return; }
      var s = 0, why = [];
      RACE_STD_SCORE.forEach(function (st) {
        var gap = Math.abs(a.distanceM - st.m);
        if (gap <= st.tol && gap / st.m <= 0.09) { s += st.w; why.push(st.label + "距离"); }
      });
      var pr = a.paceSec / base.medPace;
      if (pr <= 0.80) { s += 30; why.push("明显快于日常"); }
      else if (pr <= 0.88) { s += 18; why.push("快于日常"); }
      else if (pr <= 0.94) { s += 8; }
      if (a.distanceM >= base.p95) { s += 20; why.push("超长距离"); }
      else if (a.distanceM >= base.p90) { s += 10; }
      if (a.sportType === 101) { s -= 15; }
      else if (a.sportType === 100) { s += 5; }
      var wd = new Date(a.date + "T00:00:00").getDay();
      if (wd === 0 || wd === 6) { s += 8; why.push("周末"); }
      if (s >= 50) { out.push({ act: a, score: s, reason: why.join(" · ") }); }
    });
    out.sort(function (x, y) { return y.score - x.score; });
    return out;
  }
  function pickRow(a, extra) {
    return '<button type="button" class="race-pick" data-id="' + esc(a.labelId) + '">' +
      '<span class="race-pick__d">' + esc(a.date) + "</span>" +
      '<span class="race-pick__t">' + esc(sportName(a)) + (a.location ? " · " + esc(a.location) : "") +
        (extra ? " · " + esc(extra) : "") + "</span>" +
      '<span class="race-pick__v">' + fmtDist(a.distanceM) + " · " + fmtPace(a.paceSec) + "</span>" +
      "</button>";
  }
  function defaultRaceName(a) {
    var std = stdFor(a.distanceM || 0);
    return (a.location || sportName(a)) + (std ? " " + std.label : "");
  }
  function addCompletedRace(a, name, cat, target) {
    RACES.push({
      id: "r" + Date.now().toString(36) + Math.floor(Math.random() * 1e3).toString(36),
      kind: "completed", labelId: a.labelId, name: name || defaultRaceName(a), date: a.date,
      provider: raceProvider(),
      distanceM: a.distanceM || 0, category: cat || "", target: target || "", note: "",
      createdAt: Date.now(), updatedAt: Date.now()
    });
  }
  function openMarkRace() {
    var acts = (DATA.activities || []).filter(function (a) { return isRunSport(a.sportType); });
    if (!acts.length) { UI.toast("还没有可标记的跑步记录"); return; }
    var cands = detectRaces();
    var marked = {};
    scopedRaces().forEach(function (r) { if (r.labelId) { marked[r.labelId] = 1; } });
    var candIds = {};
    cands.forEach(function (c) { candIds[c.act.labelId] = 1; });
    var rest = acts.filter(function (a) { return !candIds[a.labelId]; });

    var html = '<div class="m-title">标记比赛</div>';
    if (cands.length) {
      html += '<div class="race-sec"><span>系统识别到 <b>' + cands.length + '</b> 场疑似比赛</span>' +
        '<button type="button" class="race-btn race-btn--mini" id="raceBulk">一键标记</button></div>' +
        '<div class="race-pick-list">' + cands.map(function (c) { return pickRow(c.act, c.reason); }).join("") + "</div>";
    } else {
      html += '<div class="m-sub">没识别到疑似比赛，可在下面手动挑一次跑步记录。</div>';
    }
    html += '<div class="race-sec"><span>全部跑步记录</span></div>' +
      '<div class="race-pick-list">' + rest.slice(0, 80).map(function (a) {
        var done = marked[a.labelId];
        return '<button type="button" class="race-pick' + (done ? " is-done" : "") + '" data-id="' + esc(a.labelId) + '"' + (done ? " disabled" : "") + ">" +
          '<span class="race-pick__d">' + esc(a.date) + "</span>" +
          '<span class="race-pick__t">' + esc(sportName(a)) + (a.location ? " · " + esc(a.location) : "") + "</span>" +
          '<span class="race-pick__v">' + fmtDist(a.distanceM) + (done ? " · 已标记" : "") + "</span></button>";
      }).join("") + "</div>";
    showModal(html);
    Array.prototype.forEach.call(document.querySelectorAll(".race-pick:not(.is-done)"), function (el) {
      el.onclick = function () { openMarkForm(el.getAttribute("data-id")); };
    });
    var bulk = $("raceBulk");
    if (bulk) {
      bulk.onclick = function () {
        cands.forEach(function (c) { addCompletedRace(c.act, "", "A", ""); });
        $("modal").hidden = true;
        racePersist();
        UI.toast("已标记 " + cands.length + " 场，可点卡片改名");
      };
    }
  }
  function openMarkForm(labelId) {
    var a = actById(labelId);
    if (!a) { return; }
    var defName = defaultRaceName(a);
    showModal(
      '<div class="m-title">标记为比赛</div>' +
      '<div class="m-sub">' + esc(a.date) + " · " + fmtDist(a.distanceM) + " · " + fmtPace(a.paceSec) + "/km</div>" +
      '<div class="race-form">' +
        field("比赛名称", '<input id="rfName" type="text" maxlength="40" value="' + esc(defName) + '">') +
        field("定位", catSelect("A")) +
        field("目标 / 备注", '<input id="rfTarget" type="text" maxlength="40" placeholder="如：目标 3:30 完赛">') +
        '<div class="race-form__actions"><button type="button" class="race-btn" id="rfSave">保存</button></div>' +
      "</div>"
    );
    $("rfSave").onclick = function () {
      addCompletedRace(a, ($("rfName").value || "").trim(), $("rfCat").value || "", ($("rfTarget").value || "").trim());
      $("modal").hidden = true;
      racePersist();
      UI.toast("已标记为比赛");
    };
  }

  // ---- 编辑 / 删除 ----
  function openEditRace(id) {
    var r = raceById(id);
    if (!r) { return; }
    var planned = r.kind === "planned";
    showModal(
      '<div class="m-title">' + (planned ? "编辑计划比赛" : "编辑比赛") + "</div>" +
      '<div class="race-form">' +
        field("比赛名称", '<input id="rfName" type="text" maxlength="40" value="' + esc(r.name) + '">') +
        (planned
          ? field("比赛日期", '<input id="rfDate" type="date" value="' + esc(r.date) + '">') +
            field("距离（km）", '<input id="rfDist" type="number" min="0" step="0.1" value="' + (r.distanceM ? r.distanceM / 1000 : "") + '">')
          : '<div class="race-ro">比赛数据来自训练记录：' + esc(r.date) + " · " + fmtDist(r.distanceM) + "</div>") +
        field("定位", catSelect(r.category)) +
        field("目标 / 备注", '<input id="rfTarget" type="text" maxlength="40" value="' + esc(r.target || "") + '">') +
        '<div class="race-form__actions">' +
          '<button type="button" class="race-btn" id="rfSave">保存</button>' +
          '<button type="button" class="race-btn race-btn--ghost" id="rfDel">删除</button>' +
        "</div>" +
      "</div>"
    );
    $("rfSave").onclick = function () {
      r.name = ($("rfName").value || "").trim() || r.name;
      r.category = $("rfCat").value || "";
      r.target = ($("rfTarget").value || "").trim();
      if (planned) {
        var date = ($("rfDate").value || "").trim();
        if (/^\d{4}-\d{2}-\d{2}$/.test(date)) { r.date = date; }
        var km = parseFloat($("rfDist").value);
        if (isFinite(km)) { r.distanceM = Math.round(km * 1000); }
      }
      r.updatedAt = Date.now();
      $("modal").hidden = true;
      racePersist();
      UI.toast("已保存");
    };
    $("rfDel").onclick = function () { askDeleteRace(id); };
  }
  function askDeleteRace(id) {
    var r = raceById(id);
    if (!r) { return; }
    UI.confirmDialog({
      title: r.kind === "planned" ? "删除计划比赛" : "取消比赛标记",
      html: "确定「" + esc(r.name) + "」？" + (r.kind === "completed" ? "（只取消标记，不删除这次训练记录）" : ""),
      confirmLabel: "删除", danger: true
    }).then(function (ok) {
      if (!ok) { return; }
      RACES = RACES.filter(function (x) { return x.id !== id; });
      $("modal").hidden = true;
      racePersist();
      UI.toast("已删除");
    });
  }

  // ---- ③ 比赛专项分析 ----
  // 分段数据（laps）：distance 单位为厘米、time 为秒、avgPace 为 秒/公里。按「距离中点」切前后半程。
  function raceSplits(labelId) {
    var g = pickLapGroup((DATA.laps || {})[labelId]);
    if (!g || !g.laps || g.laps.length < 4) { return null; }
    var rows = g.laps;
    var totalM = rows.reduce(function (s, l) { return s + (l.distance || 0); }, 0) / 100;
    if (!totalM) { return null; }
    var halfM = totalM / 2, cum = 0, fT = 0, sT = 0, fHrW = 0, sHrW = 0;
    rows.forEach(function (l) {
      var dm = (l.distance || 0) / 100, t = l.time || 0, hr = l.avgHr || 0, a, b;
      if (cum + dm <= halfM) { a = t; b = 0; }
      else if (cum >= halfM) { a = 0; b = t; }
      else { var fr = (halfM - cum) / dm; a = t * fr; b = t * (1 - fr); }
      fT += a; sT += b; fHrW += a * hr; sHrW += b * hr;
      cum += dm;
    });
    var halfKm = totalM / 2 / 1000;
    var fPace = fT / halfKm, sPace = sT / halfKm;
    var paces = rows.map(function (l) { return l.avgPace; }).filter(function (x) { return x; });
    var mean = paces.reduce(function (x, y) { return x + y; }, 0) / (paces.length || 1);
    var sd = Math.sqrt(paces.reduce(function (x, y) { return x + (y - mean) * (y - mean); }, 0) / (paces.length || 1));
    // 末段（后 20% 距离）配速
    var back = totalM * 0.2, acc = 0, bt = 0, bd = 0;
    for (var i = rows.length - 1; i >= 0 && acc < back; i -= 1) {
      var dm2 = (rows[i].distance || 0) / 100, t2 = rows[i].time || 0;
      if (acc + dm2 <= back) { bt += t2; bd += dm2; acc += dm2; }
      else { var fr2 = (back - acc) / dm2; bt += t2 * fr2; bd += dm2 * fr2; acc = back; }
    }
    return {
      totalM: totalM, fPace: fPace, sPace: sPace, fT: fT, sT: sT,
      fHr: fT ? fHrW / fT : 0, sHr: sT ? sHrW / sT : 0,
      cv: mean ? sd / mean * 100 : 0, neg: sT < fT,
      lastPace: bd ? bt / (bd / 1000) : 0
    };
  }
  function raRow(k, v) { return '<div class="ra-row"><span class="ra-k">' + k + '</span><span class="ra-v">' + esc(v) + "</span></div>"; }
  function analysisHtml(id) {
    var r = raceById(id);
    if (!r) { return ""; }
    var a = actById(r.labelId);
    if (!a) { return '<div class="ra-note">这次训练记录已不在当前数据里（可能超出了抓取范围）。</div>'; }
    var s = raceSplits(r.labelId);
    if (!s) {
      var d = (DATA.details || {})[r.labelId] || {};
      var html = raRow("完赛用时", fmtDur(a.durationSec) + " · " + fmtPace(a.paceSec) + "/km") +
        raRow("平均心率", (a.avgHr || "—") + " bpm");
      if (d.bestKmSec) { html += raRow("最快 1km", fmtPace(d.bestKmSec) + "/km"); }
      html += '<div class="ra-note">这次没记录到分段，只有整体指标。长距离比赛通常会自动分公里段。</div>';
      return html;
    }
    var out = raRow("前半程", fmtPace(s.fPace) + "/km" + (s.fHr ? " · 心率 " + Math.round(s.fHr) : "")) +
      raRow("后半程", fmtPace(s.sPace) + "/km" + (s.sHr ? " · 心率 " + Math.round(s.sHr) : "")) +
      '<div class="ra-tags"><span class="ra-tag ' + (s.neg ? "ra-tag--good" : "ra-tag--warn") + '">' +
        (s.neg ? "负分割 · 后半程更快" : "正分割 · 后半程偏慢") + "</span></div>" +
      raRow("半程比值 R", (s.fT / s.sT).toFixed(3) + (s.neg ? "（>1，后半程更快）" : "（<1，前半程更快）")) +
      raRow("配速波动 CV", s.cv.toFixed(1) + "%" + (s.cv <= 3 ? "（很稳）" : s.cv <= 6 ? "（较稳）" : "（波动偏大）"));
    if (s.fHr && s.sHr) {
      var drift = (s.sHr - s.fHr) / s.fHr * 100;
      out += raRow("心率漂移", (drift >= 0 ? "+" : "") + drift.toFixed(1) + "%" +
        (Math.abs(drift) <= 5 ? "（稳定）" : drift > 5 ? "（偏大，后半程略吃力）" : "（后半程更轻松）"));
    }
    if (s.lastPace) {
      var wall = (s.lastPace - s.fPace) / s.fPace * 100;
      out += raRow("末段(后 20%)", fmtPace(s.lastPace) + "/km" + (wall > 12 ? " ⚠ 掉速明显" : ""));
    }
    return out;
  }
  function toggleAnalysis(id, btn) {
    var box = document.querySelector('.race-analysis[data-an="' + id + '"]');
    if (!box) { return; }
    if (box.hidden) { box.innerHTML = analysisHtml(id); box.hidden = false; btn.textContent = "比赛分析 ▴"; }
    else { box.hidden = true; btn.textContent = "比赛分析 ▾"; }
  }

  // ---- ④ 渲染：卡片 + 个人 PB ----
  function delBtn(id) { return '<button type="button" class="race-x" data-act="del" data-id="' + esc(id) + '" title="删除">×</button>'; }
  function catBadge(cat) { return cat ? '<span class="race-cat race-cat--' + cat + '">' + esc(RACE_CATS[cat]) + "</span>" : ""; }
  function plannedCard(r) {
    var days = daysUntil(r.date);
    var num = days > 0 ? days : 0;
    var when = days > 0 ? "天" : (days === 0 ? "今天" : "已过");
    var meta = [];
    if (r.distanceM) { meta.push((r.distanceM / 1000).toFixed(r.distanceM % 1000 ? 1 : 0) + " km"); }
    if (r.target) { meta.push("目标 " + r.target); }
    return '<article class="race-card race-card--planned" data-act="edit" data-id="' + esc(r.id) + '">' +
      delBtn(r.id) +
      '<div class="race-top"><span class="race-emoji"><svg class="ico" viewBox="0 0 24 24" aria-hidden="true"><path d="M6.2 20.6V3.8"/><path d="M6.2 4.4h11.6l-2.3 3.9 2.3 3.9H6.2"/></svg></span><span class="race-name">' + esc(r.name) + "</span></div>" +
      '<div class="race-meta">' + esc(meta.join(" · ") || "—") + "</div>" +
      catBadge(r.category) +
      '<div class="race-num"><b>' + num + "</b><small>" + esc(when) + "</small></div>" +
      '<div class="race-date">' + esc(r.date) + "</div>" +
      "</article>";
  }
  function completedCard(r) {
    var a = actById(r.labelId);
    var meta = [];
    if (r.distanceM) { meta.push(fmtDist(r.distanceM)); }
    if (a && a.paceSec) { meta.push(fmtPace(a.paceSec) + "/km"); }
    if (a && a.location) { meta.push(a.location); }
    return '<article class="race-card race-card--done">' +
      delBtn(r.id) +
      '<div class="race-top"><span class="race-emoji"><svg class="ico" viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="14.6" r="4.8"/><path d="M8.8 10.8L6.2 3.9M15.2 10.8l2.6-6.9"/></svg></span>' +
        '<span class="race-name" data-act="edit" data-id="' + esc(r.id) + '">' + esc(r.name) + "</span></div>" +
      '<div class="race-meta">' + esc(meta.join(" · ") || "—") + "</div>" +
      catBadge(r.category) +
      '<div class="race-num"><b>' + esc(a ? fmtDur(a.durationSec) : "—") + "</b><small>完赛</small></div>" +
      '<div class="race-date">' + esc(r.date) + "</div>" +
      (a ? '<button type="button" class="race-toggle" data-act="an" data-id="' + esc(r.id) + '">比赛分析 ▾</button>' +
        '<div class="race-analysis" data-an="' + esc(r.id) + '" hidden></div>' : "") +
      "</article>";
  }
  function renderRaces() {
    var list = $("raceList");
    if (!list) { return; }
    var mine = scopedRaces();
    var planned = mine.filter(function (r) { return r.kind === "planned"; })
      .sort(function (a, b) { return a.date < b.date ? -1 : a.date > b.date ? 1 : 0; });
    var done = mine.filter(function (r) { return r.kind === "completed"; })
      .sort(function (a, b) { return a.date > b.date ? -1 : a.date < b.date ? 1 : 0; });
    var found = !RACES_READY ? 0 : detectRaces().length;
    $("raceHint").textContent = mine.length
      ? ("计划 " + planned.length + " · 已完赛 " + done.length + (found ? " · 识别到 " + found + " 场疑似比赛" : ""))
      : "";
    if (!mine.length) {
      var emptyMsg = RACES_READY
        ? (found
          ? "系统已识别到 " + found + " 场疑似比赛，点右上「标记比赛」一键确认；或「＋ 计划比赛」加一场目标赛。"
          : "还没有比赛。点右上「标记比赛」把某次跑步记录标为比赛，或「＋ 计划比赛」加一场未来的目标赛。")
        : "正在读取比赛…";
      list.innerHTML = UI.stateHtml(RACES_READY ? "empty" : "loading", emptyMsg);
    } else {
      list.innerHTML = planned.map(plannedCard).join("") + done.map(completedCard).join("");
    }
    Array.prototype.forEach.call(list.querySelectorAll("[data-act]"), function (el) {
      el.onclick = function (e) {
        e.stopPropagation();
        var act = el.getAttribute("data-act"), id = el.getAttribute("data-id");
        if (act === "del") { askDeleteRace(id); }
        else if (act === "edit") { openEditRace(id); }
        else if (act === "an") { toggleAnalysis(id, el); }
      };
    });
    renderRacePb();
    $("raceFoot").textContent = "比赛数据（名称 / 目标）按账户码存在本机，不上传；仅本人可见。";
  }
  function renderRacePb() {
    var wrap = $("racePbWrap"), box = $("racePb");
    if (!wrap || !box) { return; }
    var acts = (DATA.activities || []).filter(function (a) {
      return isRunSport(a.sportType) && a.distanceM > 0 && a.durationSec > 0;
    });
    var rows = RACE_STD.map(function (std) {
      var best = null;
      acts.forEach(function (a) {
        if (Math.abs(a.distanceM - std.m) <= std.tol && (!best || a.durationSec < best.durationSec)) { best = a; }
      });
      return { std: std, best: best };
    }).filter(function (x) { return x.best; });
    if (!rows.length) { wrap.hidden = true; return; }
    wrap.hidden = false;
    box.innerHTML = '<div class="pb-head"><span>距离</span><span>成绩</span><span>配速</span><span>日期</span></div>' +
      rows.map(function (x) {
        return '<div class="pb-row"><span class="pb-d">' + esc(x.std.label) + "</span>" +
          '<span class="pb-t">' + fmtDur(x.best.durationSec) + "</span>" +
          '<span class="pb-p">' + fmtPace(x.best.paceSec) + "/km</span>" +
          '<span class="pb-date">' + esc(x.best.date) + "</span></div>";
      }).join("");
  }
  function bindRaces() {
    var addBtn = $("raceAddBtn"), markBtn = $("raceMarkBtn");
    if (addBtn) { addBtn.onclick = openAddRace; }
    if (markBtn) { markBtn.onclick = openMarkRace; }
  }

  // ---------- AI 复盘 ----------
  function bindAI() {
    function renderError(msg) {
      var box = $("aiBox");
      box.innerHTML = UI.stateHtml("error", msg, "重试");
      var rb = box.querySelector('[data-action="retry"]');
      if (rb) { rb.onclick = runReview; }
    }
    // 未配置自己的 AI Key：引导去「我的账户」填写
    function renderNoKey() {
      var box = $("aiBox");
      box.innerHTML = UI.stateHtml("error", "还没有配置 AI Key：请到「我的账户 → AI 复盘 Key」填入你自己的 Key（支持 DeepSeek / 通义 / Kimi / 智谱 / 豆包等），填一次即可。", "去配置 Key");
      var b = box.querySelector('[data-action="retry"]');
      if (b) { b.onclick = function () { location.href = "account.html"; }; }
    }
    function done(ok, payload, quota) {
      var btn = $("aiBtn"), box = $("aiBox");
      if (ok) {
        box.innerHTML = UI.md(payload);
        UI.toast(quota ? ("复盘已生成（今日剩余 " + quota.remaining + " 次）") : "复盘已生成");
      } else {
        renderError(payload);
      }
      btn.disabled = false;
    }
    function runReview() {
      var btn = $("aiBtn"), box = $("aiBox");
      var scope = $("aiScope").value;
      btn.disabled = true;
      box.innerHTML = UI.stateHtml("loading", "AI 正在读你的训练数据，分析中…（需几秒）");
      // 登录读云端 → 走云函数 review（用户自填 Key 优先）；本机预览 → 走本机服务 /api/review
      if (DATA_SOURCE === "cloud" && window.CorosAuth && window.CorosAuth.callFunction) {
        window.CorosAuth.callFunction("review", { scope: scope, lang: (window.I18N && window.I18N.lang) || "hans" }).then(function (res) {
          if (res && res.ok && res.text) { done(true, res.text, res.quota); }
          else if (res && res.code === "ai_nokey") { btn.disabled = false; renderNoKey(); }
          else { done(false, (res && res.error) || "AI 没有返回内容"); }
        }, function (e) {
          done(false, "调用失败：" + e.message);
        });
        return;
      }
      fetch("api/review", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ scope: scope, device: Store.getDeviceId(),
                               lang: (window.I18N && window.I18N.lang) || "hans",
                               source: DATA_SOURCE === "garmin" ? "garmin" : "" })
      }).then(function (r) { return r.json(); })
        .then(function (j) {
          if (j && j.error) { done(false, j.error); }
          else { done(true, (j && j.text) || "(AI 没有返回内容)"); }
        }).catch(function (e) {
          done(false, "调用失败：" + e.message + "（请用 web/serve.py 启动，并先在「我的账户」配好 Key）");
        });
    }
    $("aiBtn").onclick = runReview;
  }

  // ---------- 主题：图表随主题重绘 ----------
  function renderCharts() {
    charts.forEach(function (c) { c.dispose(); });
    charts = []; volumeChart = null; calendarChart = null;
    renderVolume(); renderPace(); renderLoad(); renderIntensity(); renderHrEfficiency(); renderCalendar();
    // 地点分布（地图维度）挂在同一次重绘里：主题切换 / 数据刷新都会跟着更新
    if (window.CorosPlaces && DATA) { window.CorosPlaces.render(DATA, DATA_SOURCE); }
    // 本轮渲染会「显隐」若干卡片（如「强度分布」显示后，同行的「训练负荷」由整宽变半宽）。
    // ECharts 只在 init 时量一次容器宽度，卡片宽度随后变化不会自动跟随——必须按最终布局重算一次，
    // 否则图表（尤其图例 / 坐标轴）仍按旧宽度绘制，溢出到相邻卡片造成错位。
    charts.forEach(function (c) { c.resize(); });
  }
  // ---------- 顶部「工具」下拉：点按钮后收起；点面板外也收起 ----------
  var toolsWired = false;
  function bindTools() {
    var menu = $("toolsMenu");
    if (!menu || toolsWired) { return; }
    toolsWired = true;
    menu.addEventListener("click", function (e) {
      var t = e.target;
      if (t && t.closest && t.closest("button")) { menu.removeAttribute("open"); }
    });
    document.addEventListener("click", function (e) {
      if (menu.open && !menu.contains(e.target)) { menu.removeAttribute("open"); }
    });
  }

  var themeWired = false;
  function bindTheme() {
    var btn = $("themeToggle");
    if (!btn) { return; }
    function sync() {
      Store.paintThemeIcon(btn);
      btn.title = isLight() ? "切换到黑夜" : "切换到白天";
    }
    sync();
    // 默认按时间自动；点一下改为手动指定白天 / 黑夜，再点即来回切
    btn.onclick = function () {
      Store.applyTheme(isLight() ? "dark" : "light");
    };
    // 自动模式（按时间）下外观可能自行切换：同步图标并重绘图表
    if (!themeWired && Store.onThemeChange) {
      themeWired = true;
      Store.onThemeChange(function () { sync(); renderCharts(); });
    }
  }

  // ---------- 吸顶分区导航 ----------
  // 隐藏「目标卡片被隐藏」的导航项（模块按数据显隐，导航跟着走），并做滚动高亮。
  function bindNav() {
    var nav = $("boardNav");
    if (!nav) { return; }
    var links = [].slice.call(nav.querySelectorAll("a[data-target]"));
    function target(a) { return $(a.getAttribute("data-target")); }
    links.forEach(function (a) { var t = target(a); a.hidden = !t || t.hidden; });
    function spy() {
      var active = null;
      links.forEach(function (a) {
        if (a.hidden) { return; }
        var t = target(a);
        if (t && t.getBoundingClientRect().top <= 80) { active = a; }
      });
      links.forEach(function (a) { a.classList.toggle("active", a === active && !a.hidden); });
    }
    spy();
    window.addEventListener("scroll", spy, { passive: true });
  }

  // ---------- 数据源：登录读云端「本人」数据；（本机预览时）云端取不到才读本机 dashboard.json；未登录一律引导登录 ----------
  function applyData(j) {
    DATA = j;
    renderHero(); renderReadiness(); renderFocus(); renderKpis(); renderPaces(); renderWeekly(); renderNextWeek(); renderCharts(); renderStats(); renderList(); renderRaces(); bindAI(); bindTheme(); bindTools(); bindShare(); bindVolumeSeg(); bindCalendarSeg(); bindNav(); bindRaces();
    raceLoad().then(function () { renderRaces(); });
    $("genAt").textContent = "数据更新于 " + (j.generatedAt || "—");
    // 数据源标注 + 一键切换（高驰 / 佳明 各自独立文件，不混用）
    var isGarmin = (j.provider === "garmin");
    if ($("dataFrom")) {
      $("dataFrom").textContent = "数据来自你的" + (isGarmin ? "佳明" : "高驰") + "账号（只读）";
    }
    if ($("devicesLink")) {
      // 接入设备：可同时接入多个品牌，切换当前显示的那一台
      $("devicesLink").onclick = function (e) { e.preventDefault(); renderDevices(); };
    }
    if ($("srcSwitch")) {
      // 只有本机（本地有两份数据文件）才能切；线上云端只有一份数据，切换无意义 → 直接隐藏
      var canSwitch = isLocalHost() && DATA_SOURCE !== "cloud";
      $("srcSwitch").hidden = !canSwitch;
      if (canSwitch) {
        $("srcSwitch").textContent = isGarmin ? "切换到高驰" : "切换到佳明";
        $("srcSwitch").onclick = function (e) {
          e.preventDefault();
          try { localStorage.setItem(SOURCE_KEY, isGarmin ? "coros" : "garmin"); } catch (err) { /* 忽略 */ }
          location.reload();
        };
      }
    }
    $("moreBtn").onclick = function () { shown = DATA.activities.length; renderList(); };
    $("modalClose").onclick = function () { $("modal").hidden = true; };
    $("modal").onclick = function (e) { if (e.target === $("modal")) { $("modal").hidden = true; } };
    window.addEventListener("resize", function () { charts.forEach(function (c) { c.resize(); }); renderCalendar(); });
  }

  /** 仅本机预览（localhost/127.0.0.1）才回退到本机数据；线上不回退，避免把本机数据外泄 */
  function isLocalHost() {
    var h = location.hostname;
    return h === "127.0.0.1" || h === "localhost" || h === "::1" || h === "";
  }

  /** 当前看板数据源：coros（默认，读 dashboard.json）/ garmin（读 dashboard.garmin.json）。
   *  取值优先级：URL ?source= → 本机上次选择 → coros；多品牌各自独立文件，互不混用。 */
  var SOURCE_KEY = "coros.dataSource";
  function pickedSource() {
    var q = "";
    try { q = (new URLSearchParams(location.search).get("source") || "").toLowerCase(); } catch (e) { q = ""; }
    if (q === "garmin" || q === "coros") {
      try { localStorage.setItem(SOURCE_KEY, q); } catch (e) { /* 隐私模式忽略 */ }
      return q;
    }
    try { return localStorage.getItem(SOURCE_KEY) === "garmin" ? "garmin" : "coros"; } catch (e) { return "coros"; }
  }

  function loadLocal() {
    var src = pickedSource();
    DATA_SOURCE = src === "garmin" ? "garmin" : "local";
    return fetch(src === "garmin" ? "data/dashboard.garmin.json" : "data/dashboard.json")
      .then(function (r) { return r.json(); });
  }

  var NEED_LOGIN = "__NEED_LOGIN__";
  var NEED_PICK_PROVIDER = "__NEED_PICK_PROVIDER__";
  var GARMIN_ONLINE = "__GARMIN_ONLINE__";

  /** 云端（线上）二选一：高驰 / 佳明。取值优先级：URL ?provider= → 上次选择 → 空（待选） */
  var PROVIDER_KEY = "coros.dataProvider";
  function cloudProvider() {
    var q = "";
    try { q = (new URLSearchParams(location.search).get("provider") || "").toLowerCase(); } catch (e) { q = ""; }
    if (q === "garmin" || q === "coros") {
      try { localStorage.setItem(PROVIDER_KEY, q); } catch (e) { /* 隐私模式忽略 */ }
      return q;
    }
    try { return localStorage.getItem(PROVIDER_KEY) || ""; } catch (e) { return ""; }
  }
  function setCloudProvider(p) {
    try { localStorage.setItem(PROVIDER_KEY, p); } catch (e) { /* 忽略 */ }
  }

  /** 未登录：不展示任何个人数据，直接转到「官网落地页」（介绍 + 登录 / 绑定引导）（本机与公网一致）
   *  统一账户登录回跳会带 ?ps_ticket=xxx：先等身份桥把一次性票据换成登录态（成功会自己刷新页面），
   *  否则一跳到官网就把换票打断、票据白费。等待最多 8 秒，然后照旧带查询串转落地页。 */
  function renderNeedLogin() {
    var go = function () { location.replace("landing.html" + (location.search || "")); };
    var ps = window.CorosPS;
    if (ps && typeof ps.whenSettled === "function") {
      var done = false;
      var once = function () { if (done) { return; } done = true; go(); };
      setTimeout(once, 8000);
      ps.whenSettled().then(once, once);
      return;
    }
    go();
  }

  /** 云端模式：登录 → 二选一（高驰可用 / 佳明引导占位）→ 读云函数 dashboard 返回的**本人**数据 */
  function loadCloud() {
    var auth = window.CorosAuth;
    return auth.current().then(function (u) {
      // 未登录：线上不展示任何个人数据，引导去登录；
      // 本机预览（127.0.0.1/localhost）直接读本机文件——自用看板不必先登录
      if (!u) {
        if (isLocalHost()) { return loadLocal(); }
        return Promise.reject(new Error(NEED_LOGIN));
      }
      var pv = cloudProvider();
      // 本机预览：没选过品牌时按本机文件走（本机有自己的「选择手表」页），不弹线上选择页
      if (!pv) {
        if (isLocalHost()) { return loadLocal(); }
        return Promise.reject(new Error(NEED_PICK_PROVIDER));
      }
      if (pv === "garmin") {
        if (isLocalHost()) { return loadLocal(); }
        return Promise.reject(new Error(GARMIN_ONLINE));
      }
      return auth.callFunction("dashboard", { provider: pv }).then(function (res) {
        if (res && res.ok) { DATA_SOURCE = "cloud"; return res; }
        if (isLocalHost()) { return loadLocal(); }
        var err = new Error((res && res.error) || "云端暂无数据");
        err.code = (res && res.code) || "";
        throw err;
      }, function (e) {
        if (isLocalHost()) { return loadLocal(); }
        throw e;
      });
    });
  }

  /** 线上「选择手表」：高驰可绑可用，佳明说明「线上暂不支持、本机可用」 */
  function renderCloudPicker() {
    var wrap = document.createElement("div");
    wrap.className = "modal";
    wrap.id = "sourcePicker";
    wrap.innerHTML = '<div class="modal-panel" style="max-width:560px">' +
      '<div class="m-title">选择你的手表</div>' +
      '<div class="m-sub">线上版目前只支持高驰账号（只读授权）；佳明可以看说明后在本机使用。</div>' +
      '<button type="button" class="sp-card" data-pv="coros" style="display:block;width:100%;text-align:left;background:var(--panel2);border:1px solid var(--line);border-radius:12px;padding:14px 16px;margin-top:10px;color:var(--text);cursor:pointer;font-family:inherit">' +
        '<b style="font-size:15px">高驰 COROS</b>' +
        '<div style="color:var(--muted);font-size:12.5px;margin-top:4px">官方 MCP 授权 · 只读 · 线上可用</div>' +
        '<div id="pvCorosState" style="color:var(--muted);font-size:12px;margin-top:6px">检查云端数据…</div>' +
      "</button>" +
      '<button type="button" class="sp-card" data-pv="garmin" style="display:block;width:100%;text-align:left;background:var(--panel2);border:1px solid var(--line);border-radius:12px;padding:14px 16px;margin-top:10px;color:var(--text);cursor:pointer;font-family:inherit">' +
        '<b style="font-size:15px">佳明 Garmin</b>' +
        '<div style="color:var(--muted);font-size:12.5px;margin-top:4px">线上暂不支持（官方接口无法替他人授权）· 本机可用</div>' +
        '<div style="color:var(--muted);font-size:12px;margin-top:6px">点进去看原因与本机接入方式</div>' +
      "</button>" +
      "</div>";
    document.body.appendChild(wrap);

    // 探一下云端有没有高驰数据，让用户点之前就知道状态（不猜、不装）
    var auth = window.CorosAuth;
    if (auth && auth.callFunction) {
      auth.callFunction("dashboard", { provider: "coros" }).then(function (res) {
        var el = $("pvCorosState");
        if (!el) { return; }
        if (res && res.ok) {
          el.textContent = "已同步 " + ((res.activities || []).length) + " 次记录 · 更新于 " + (res.generatedAt || "—");
        } else {
          el.textContent = (res && res.error) || "云端暂无数据（可先去账户页绑定并同步）";
        }
      }, function () {
        var el = $("pvCorosState");
        if (el) { el.textContent = "读取云端状态失败（不影响继续选择）"; }
      });
    }

    Array.prototype.forEach.call(wrap.querySelectorAll(".sp-card"), function (btn) {
      btn.onclick = function () {
        setCloudProvider(btn.getAttribute("data-pv"));
        location.reload();
      };
    });
  }

  /** 佳明线上不可用：讲清楚原因 + 给回高驰的出口（不用空数据假装支持） */
  function renderGarminOnline() {
    var wrap = document.createElement("div");
    wrap.className = "modal";
    wrap.id = "garminOnline";
    wrap.innerHTML = '<div class="modal-panel" style="max-width:600px">' +
      '<div class="m-title">佳明暂不支持在线接入</div>' +
      '<div class="m-sub" style="line-height:1.7">' +
        "原因：佳明的官方接口只能读<b>开发者本人</b>的账号，没有「替其他用户读取」的授权；第三方方案需要你把佳明账号密码交给本站保管，不合规，我们不做。" +
      "</div>" +
      '<div class="m-sub" style="line-height:1.7;margin-top:10px">' +
        "现在可以：① 线上先用高驰（下方按钮）；② 在自己电脑上运行本机版，就能接入佳明（含身体电量、真 ACWR）。" +
      "</div>" +
      '<div style="display:flex;gap:10px;margin-top:14px;flex-wrap:wrap">' +
        '<button type="button" id="garminUseCoros" class="m-btn" style="padding:9px 16px;border-radius:9px;border:1px solid var(--line);background:var(--panel2);color:var(--text);cursor:pointer;font-family:inherit">改用高驰</button>' +
        '<a href="landing.html" class="m-btn" style="padding:9px 16px;border-radius:9px;border:1px solid var(--line);color:var(--muted);text-decoration:none">返回首页</a>' +
      "</div>" +
      "</div>";
    document.body.appendChild(wrap);
    $("garminUseCoros").onclick = function () {
      setCloudProvider("coros");
      location.reload();
    };
  }

  /** 接入设备：可以**同时**接入高驰和佳明（不是二选一）；看板一次显示一台，点「显示」随时切换。
   *  本机：看两份本机文件谁有数据；云端：高驰可接入，佳明线上暂不支持（给本机用法）。
   *  状态一律以实际数据/接口为准，取不到就如实写「还没有数据」，不假装已接入。 */
  function renderDevices() {
    var cloud = (DATA_SOURCE === "cloud");
    var cur = (DATA && DATA.provider === "garmin") ? "garmin" : "coros";
    var avail = {};

    var cardHtml = function (src, name, sub) {
      var tag = (src === cur) ? '<span style="color:var(--accent,#f2620a);font-size:12px;font-weight:400;margin-left:6px">正在显示</span>' : "";
      return '<div style="border:1px solid var(--line);border-radius:12px;padding:14px 16px;margin-top:10px;background:var(--panel2)">' +
        '<div style="display:flex;align-items:center;justify-content:space-between;gap:10px">' +
          "<b style=\"font-size:15px\">" + name + tag + "</b>" +
          '<button type="button" class="dv-btn" data-src="' + src + '" style="padding:6px 14px;border-radius:8px;border:1px solid var(--line);background:transparent;color:var(--text);cursor:pointer;font-family:inherit">显示</button>' +
        "</div>" +
        '<div style="color:var(--muted);font-size:12.5px;margin-top:4px">' + sub + "</div>" +
        '<div class="dv-state" data-state="' + src + '" style="color:var(--muted);font-size:12px;margin-top:6px">检查中…</div>' +
        "</div>";
    };

    var wrap = document.createElement("div");
    wrap.className = "modal";
    wrap.id = "deviceModal";
    wrap.innerHTML = '<div class="modal-panel" style="max-width:600px">' +
      '<button class="modal-close" id="devClose">×</button>' +
      '<div class="m-title">接入设备</div>' +
      '<div class="m-sub">可以同时接入高驰和佳明；看板一次显示一台，点「显示」随时切换，互不影响。</div>' +
      cardHtml("coros", "高驰 COROS", cloud ? "官方 MCP 只读授权 · 线上可接入" : "官方 MCP 只读授权") +
      cardHtml("garmin", "佳明 Garmin", cloud ? "线上暂不支持（官方接口只能读开发者本人）" : "本机脚本抓取 · 含身体电量 / 真 ACWR") +
      "</div>";
    document.body.appendChild(wrap);

    var setState = function (src, text, ok) {
      avail[src] = !!ok;
      var el = wrap.querySelector('[data-state="' + src + '"]');
      if (el) { el.textContent = text; }
      var btn = wrap.querySelector('.dv-btn[data-src="' + src + '"]');
      if (btn) {
        btn.disabled = !ok;
        if (!ok) { btn.style.opacity = "0.45"; btn.style.cursor = "default"; }
        if (src === cur) { btn.textContent = "正在显示"; }
      }
    };

    // 本机：直接看两份文件有没有数据（不猜）
    var probeLocal = function (src, file) {
      fetch(file, { cache: "no-store" }).then(function (r) {
        if (!r.ok) { throw new Error("no file"); }
        return r.json();
      }).then(function (j) {
        setState(src, "已接入 · " + ((j.activities || []).length) + " 次记录 · 更新于 " + (j.generatedAt || "—"), true);
      }).catch(function () {
        setState(src, src === "garmin"
          ? "还没有数据：在项目目录运行 GARMIN_REGION=cn .venv-garmin/bin/python tools/source_garmin.py"
          : "还没有数据：运行 python3 tools/fetch_data.py", false);
      });
    };

    if (cloud) {
      setState("coros", "已接入 · 已同步 " + ((DATA.activities || []).length) + " 次记录 · 更新于 " + (DATA.generatedAt || "—"), true);
      setState("garmin", "线上暂不支持 · 在自己电脑上运行本机版即可接入佳明", false);
    } else {
      probeLocal("coros", "data/dashboard.json");
      probeLocal("garmin", "data/dashboard.garmin.json");
    }

    var close = function () { wrap.remove(); };
    $("devClose").onclick = close;
    wrap.onclick = function (e) { if (e.target === wrap) { close(); } };

    Array.prototype.forEach.call(wrap.querySelectorAll(".dv-btn"), function (btn) {
      btn.onclick = function () {
        var src = btn.getAttribute("data-src");
        if (src === cur || !avail[src]) { if (src === cur) { close(); } return; }
        if (cloud) { setCloudProvider(src); } else {
          try { localStorage.setItem(SOURCE_KEY, src); } catch (e) { /* 忽略 */ }
        }
        location.reload();
      };
    });
  }

  function bindModalScrollLock() {
    var modal = $("modal");
    if (!modal || !window.MutationObserver) { return; }
    var sync = function () { document.body.classList.toggle("modal-open", !modal.hidden); };
    new MutationObserver(sync).observe(modal, { attributes: true, attributeFilter: ["hidden"] });
    sync();
  }

  // ---------- 本机首次进入：选择手表（高驰 / 佳明）----------
  // 只有「本机 + 没选过 + 没带 ?source=」才弹；线上由登录/绑定流程负责，不弹。
  function needPickSource() {
    if (!isLocalHost()) { return false; }
    try { if (localStorage.getItem(SOURCE_KEY)) { return false; } } catch (e) { return false; }
    var q = "";
    try { q = (new URLSearchParams(location.search).get("source") || "").toLowerCase(); } catch (e) { q = ""; }
    return q !== "garmin" && q !== "coros";
  }

  function renderSourcePicker() {
    var card = function (src, name, desc) {
      return '<button type="button" class="sp-card" data-src="' + src + '" ' +
        'style="display:block;width:100%;text-align:left;background:var(--panel2);border:1px solid var(--line);' +
        'border-radius:12px;padding:14px 16px;margin-top:10px;color:var(--text);cursor:pointer;font-family:inherit">' +
        '<b style="font-size:15px">' + name + '</b>' +
        '<div style="color:var(--muted);font-size:12.5px;margin-top:4px">' + desc + '</div>' +
        '<div class="sp-state" data-state="' + src + '" style="color:var(--muted);font-size:12px;margin-top:6px">检查本机数据…</div>' +
        "</button>";
    };
    var wrap = document.createElement("div");
    wrap.className = "modal";
    wrap.id = "sourcePicker";
    wrap.innerHTML = '<div class="modal-panel" style="max-width:560px">' +
      '<div class="m-title">选择你的手表</div>' +
      '<div class="m-sub">两个品牌可以<b>同时</b>接入（各一份数据、互不混用）；这里先选一个显示，之后页脚「接入设备」随时切换。</div>' +
      card("coros", "高驰 COROS", "官方 MCP · 只读授权 · 有恢复度 / 跑力值") +
      card("garmin", "佳明 Garmin", "本机脚本抓取 · 有身体电量 / 真 ACWR") +
      '<div class="m-sub" style="margin-top:12px">还没有数据也能进，页面会提示先运行抓取脚本。</div>' +
      "</div>";
    document.body.appendChild(wrap);

    var probe = function (src, file) {
      fetch(file, { cache: "no-store" }).then(function (r) {
        if (!r.ok) { throw new Error("no file"); }
        return r.json();
      }).then(function (j) {
        var el = wrap.querySelector('[data-state="' + src + '"]');
        if (el) { el.textContent = "已抓取 · " + ((j.activities || []).length) + " 次记录 · 更新于 " + (j.generatedAt || "—"); }
      }).catch(function () {
        var el = wrap.querySelector('[data-state="' + src + '"]');
        if (el) { el.textContent = "本机还没有数据（先运行对应抓取脚本）"; }
      });
    };
    probe("coros", "data/dashboard.json");
    probe("garmin", "data/dashboard.garmin.json");

    Array.prototype.forEach.call(wrap.querySelectorAll(".sp-card"), function (btn) {
      btn.onclick = function () {
        try { localStorage.setItem(SOURCE_KEY, btn.getAttribute("data-src")); } catch (e) { /* 忽略 */ }
        location.reload();
      };
    });
  }

  function start() {
    bindModalScrollLock();
    if (needPickSource()) { renderSourcePicker(); return; }
    var p = (window.CorosAuth && window.CorosAuth.current) ? loadCloud() : loadLocal();
    p.then(applyData).catch(function (e) {
      var msg = e && e.message;
      if (msg === NEED_LOGIN) { renderNeedLogin(); return; }
      if (msg === NEED_PICK_PROVIDER) { renderCloudPicker(); return; }
      if (msg === GARMIN_ONLINE) { renderGarminOnline(); return; }
      var tip = "读取数据失败：" + esc(e.message) + (isLocalHost() ? "（本机请用 web/serve.py 启动服务后访问）" : "");
      document.body.insertAdjacentHTML("afterbegin", '<div style="padding:20px;color:#f85149">' + tip + "</div>");
    });
  }

  // app.js 在 auth.js 之前加载，等全部脚本就绪（DOMContentLoaded）后再取数
  if (document.readyState === "loading") { document.addEventListener("DOMContentLoaded", start); } else { start(); }
})();
