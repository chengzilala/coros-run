/* 官网落地页逻辑：主题切换 + 导航滚动高亮 + 按登录态调整跳转入口
 * 依赖：store.js（主题）、auth.js（登录态，需先加载 lib/cloudbase.full.js）。
 * 无个人数据、无第三方依赖。
 */
(function () {
  // ---------- 主题切换（与看板共用本机偏好） ----------
  var themeBtn = document.getElementById('lpTheme');
  function isLight() { return document.documentElement.getAttribute('data-theme') === 'light'; }
  function syncThemeIcon() {
    if (themeBtn) { window.CorosStore.paintThemeIcon(themeBtn); }
  }
  if (themeBtn) {
    themeBtn.onclick = function () {
      // 默认按时间自动；点一下改为手动指定白天 / 黑夜
      if (window.CorosStore) { window.CorosStore.applyTheme(isLight() ? 'dark' : 'light'); }
    };
  }
  syncThemeIcon();
  if (window.CorosStore && window.CorosStore.onThemeChange) {
    window.CorosStore.onThemeChange(syncThemeIcon);
  }

  // ---------- 顶部导航：一开始透明，滚过首屏 / 鼠标悬停时变实底 ----------
  var topBar = document.getElementById('lpTop');
  // 滞回：滚过 56px 才变实底，回到 24px 以内才恢复透明，避免在阈值附近来回闪
  function syncBar() {
    if (!topBar) { return; }
    var y = window.scrollY;
    var on = topBar.classList.contains('scrolled');
    if (!on && y > 56) { topBar.classList.add('scrolled'); }
    else if (on && y < 24) { topBar.classList.remove('scrolled'); }
  }
  syncBar();
  window.addEventListener('scroll', syncBar, { passive: true });

  // ---------- 吸顶导航：滚到哪个区块就高亮哪一项 ----------
  var navLinks = [].slice.call(document.querySelectorAll('#lpNav a[href^="#"]'));
  if (navLinks.length && 'IntersectionObserver' in window) {
    var byId = {};
    navLinks.forEach(function (a) { byId[a.getAttribute('href').slice(1)] = a; });
    var io = new IntersectionObserver(function (entries) {
      entries.forEach(function (en) {
        if (!en.isIntersecting) { return; }
        navLinks.forEach(function (a) { a.classList.remove('active'); });
        var link = byId[en.target.id];
        if (link) { link.classList.add('active'); }
      });
    }, { rootMargin: '-64px 0px -70% 0px', threshold: 0 });
    Object.keys(byId).forEach(function (id) {
      var el = document.getElementById(id);
      if (el) { io.observe(el); }
    });
  }

  // ---------- 滚动出现 ----------
  var reveals = [].slice.call(document.querySelectorAll('.lp-reveal'));
  if (reveals.length && 'IntersectionObserver' in window) {
    var ro = new IntersectionObserver(function (entries) {
      entries.forEach(function (en) {
        if (!en.isIntersecting) { return; }
        en.target.classList.add('in');
        ro.unobserve(en.target);
      });
    }, { threshold: 0.2 });
    reveals.forEach(function (el) { ro.observe(el); });
  } else {
    reveals.forEach(function (el) { el.classList.add('in'); });
  }

  // ---------- GPS 轨迹：滚多少画多少（可来回，不算播放） ----------
  var routeSvg = document.getElementById('lpRoute');
  if (routeSvg) {
    var track = routeSvg.querySelector('.track');
    var art = routeSvg.parentNode;
    var dots = [].slice.call(routeSvg.querySelectorAll('.kdot'));
    var endDot = routeSvg.querySelector('.end');
    var total = track && track.getTotalLength ? track.getTotalLength() : 0;

    if (total) {
      // 虚线按 SVG 的 pathLength="1400" 归一化坐标算，几何长度只用于取点
      var dashTotal = 1400;
      track.style.strokeDasharray = dashTotal;
      track.style.strokeDashoffset = dashTotal;

      // 一个跟着进度走的“当前位置”光点
      var head = document.createElementNS('http://www.w3.org/2000/svg', 'circle');
      head.setAttribute('class', 'head');
      head.setAttribute('r', '5.5');
      head.setAttribute('cx', '0');
      head.setAttribute('cy', '0');
      routeSvg.appendChild(head);

      // 关键点：采样全长，记下“线画到百分之几时会碰到它”
      var marks = dots.concat(endDot ? [endDot] : []);
      marks.forEach(function (dot) {
        var cx = +dot.getAttribute('cx');
        var cy = +dot.getAttribute('cy');
        var best = 0;
        var bestD = Infinity;
        var steps = 180;
        for (var i = 0; i <= steps; i++) {
          var pt = track.getPointAtLength(total * i / steps);
          var d = (pt.x - cx) * (pt.x - cx) + (pt.y - cy) * (pt.y - cy);
          if (d < bestD) { bestD = d; best = i / steps; }
        }
        dot._at = best;
      });

      var ticking = false;
      var update = function () {
        ticking = false;
        var vh = window.innerHeight || 800;
        // 轨迹顶部从视口 92% 升到 32% 的这段滚动距离 = 画完整条路线
        var p = (vh * 0.92 - art.getBoundingClientRect().top) / (vh * 0.6);
        p = p < 0 ? 0 : (p > 1 ? 1 : p);

        track.style.strokeDashoffset = dashTotal * (1 - p);
        marks.forEach(function (dot) { dot.style.opacity = p > dot._at ? '1' : '0'; });

        if (p > 0 && p < 1) {
          var pos = track.getPointAtLength(total * p);
          head.setAttribute('cx', pos.x);
          head.setAttribute('cy', pos.y);
          head.style.opacity = '1';
        } else {
          head.style.opacity = '0';
        }
      };
      var onScroll = function () {
        if (!ticking) { ticking = true; window.requestAnimationFrame(update); }
      };
      window.addEventListener('scroll', onScroll, { passive: true });
      window.addEventListener('resize', onScroll);
      update();
    }
  }

  // ---------- 登录态：已登录时把入口指向真实看板 ----------
  var A = window.CorosAuth;
  if (A && A.current) {
    A.current().then(function (u) {
      if (!u) { return; }
      // 顶部是图标按钮：只改链接和提示，不塞文字
      var topLogin = document.getElementById('lpTopLogin');
      if (topLogin) {
        topLogin.setAttribute('href', './');
        topLogin.setAttribute('title', '进入看板');
        topLogin.setAttribute('aria-label', '进入看板');
      }
      var bottomLogin = document.getElementById('lpBottomLogin');
      if (bottomLogin) {
        bottomLogin.setAttribute('href', './');
        bottomLogin.textContent = '进入看板';
        bottomLogin.setAttribute('title', '进入看板');
      }
      var primary = document.getElementById('lpPrimary');
      if (primary) {
        primary.setAttribute('href', './');
        primary.textContent = '进入我的看板';
        primary.setAttribute('title', '进入看板');
      }
      // 需要登录的跳转入口（未登录时保持指向登录页）
      [].slice.call(document.querySelectorAll('[data-gate]')).forEach(function (el) {
        el.setAttribute('href', el.getAttribute('data-gate'));
      });
    }).catch(function () { /* 未登录 / 读取失败：保持登录引导 */ });
  }
})();
