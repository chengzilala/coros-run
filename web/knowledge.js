/* 跑步知识库：列表页 → 详情页（数据驱动渲染）
 *
 * 内容整理自中国田径协会、国家体育总局、世界田联等官方公开资料；
 * 每个条目底部都以「官方来源」列出原始链接做背书（硬性要求）。
 * 依赖：ui.js（CorosUI.esc）、store.js（CorosStore 主题）。
 */
(function () {
  var doc = document;
  var UI = window.CorosUI || {};
  var esc = UI.esc || function (s) { return String(s == null ? '' : s); };
  var Store = window.CorosStore;
  var $ = function (id) { return doc.getElementById(id); };

  /* ------------------------- 数据 ------------------------- */

  // 大众选手等级（2024 版）8 个年龄组
  var AGE_GROUPS = ['34 岁以下组', '35-39 岁组', '40-44 岁组', '45-49 岁组', '50-54 岁组', '55-59 岁组', '60-64 岁组', '65 岁以上组'];
  // 每项目：[精英, 一级, 二级] × 8 年龄组
  var AM_FULL = {
    m: [
      ['3:00:00', '3:10:00', '3:15:00', '3:20:00', '3:30:00', '3:40:00', '3:50:00', '4:00:00'],
      ['3:30:00', '3:40:00', '3:45:00', '3:50:00', '4:00:00', '4:10:00', '4:20:00', '4:30:00'],
      ['4:00:00', '4:10:00', '4:15:00', '4:20:00', '4:30:00', '4:40:00', '4:50:00', '5:00:00']
    ],
    w: [
      ['3:20:00', '3:30:00', '3:35:00', '3:40:00', '3:50:00', '4:00:00', '4:20:00', '4:30:00'],
      ['3:50:00', '4:00:00', '4:05:00', '4:10:00', '4:20:00', '4:30:00', '4:50:00', '5:00:00'],
      ['4:20:00', '4:30:00', '4:35:00', '4:40:00', '4:50:00', '5:00:00', '5:20:00', '5:30:00']
    ]
  };
  var AM_HALF = {
    m: [
      ['1:25:00', '1:30:00', '1:32:00', '1:35:00', '1:40:00', '1:45:00', '1:50:00', '1:55:00'],
      ['1:35:00', '1:40:00', '1:42:00', '1:45:00', '1:50:00', '1:55:00', '2:00:00', '2:05:00'],
      ['1:55:00', '2:00:00', '2:02:00', '2:05:00', '2:10:00', '2:15:00', '2:20:00', '2:25:00']
    ],
    w: [
      ['1:35:00', '1:40:00', '1:42:00', '1:45:00', '1:50:00', '1:55:00', '2:05:00', '2:10:00'],
      ['1:45:00', '1:50:00', '1:52:00', '1:55:00', '2:00:00', '2:05:00', '2:15:00', '2:20:00'],
      ['2:05:00', '2:10:00', '2:12:00', '2:15:00', '2:20:00', '2:25:00', '2:35:00', '2:40:00']
    ]
  };

  // 按 8 个年龄组生成「组别 / 等级 / 全马 / 半马」表格
  function amTables() {
    var out = [];
    AGE_GROUPS.forEach(function (g, i) {
      var rows = [];
      [['男', 'm'], ['女', 'w']].forEach(function (sex) {
        [['精英', 0], ['一级', 1], ['二级', 2]].forEach(function (lv) {
          rows.push([sex[0], lv[0], AM_FULL[sex[1]][lv[1]][i], AM_HALF[sex[1]][lv[1]][i]]);
        });
      });
      out.push({ type: 'h', text: g });
      out.push({
        type: 'table',
        head: ['组别', '等级', '全马', '半马'],
        rows: rows,
        name: 0, grade: 1, num: [2, 3]
      });
    });
    return out;
  }

  // 短中长跑（场地）世界纪录，截至 2025-03-09；(i) = 室内
  var WR_MEN = [
    ['50 米', '5.56', '1996/02/09'],
    ['60 米', '6.34', '2018/02/18'],
    ['100 米', '9.58', '2009/08/16'],
    ['200 米', '19.19', '2009/08/20'],
    ['200 米(i)', '19.92', '1996/02/18'],
    ['400 米', '43.03', '2016/08/14'],
    ['400 米(i)', '44.57', '2005/03/12'],
    ['800 米', '1:40.91', '2012/08/09'],
    ['800 米(i)', '1:42.67', '1997/03/09'],
    ['1000 米', '2:11.96', '1999/09/05'],
    ['1000 米(i)', '2:14.20', '2016/02/17'],
    ['1500 米', '3:26.00', '1998/07/14'],
    ['1500 米(i)', '3:29.63', '2025/02/13'],
    ['1 英里', '3:43.13', '1999/07/07'],
    ['1 英里(i)', '3:45.14', '2025/02/13'],
    ['2000 米', '4:43.13', '2023/09/08'],
    ['3000 米', '7:17.55', '2024/08/25'],
    ['3000 米(i)', '7:22.91', '2025/02/08'],
    ['5000 米', '12:35.36', '2020/08/14'],
    ['5000 米(i)', '12:44.09', '2025/02/14']
  ];
  var WR_WOMEN = [
    ['100 米', '10.49', '1988/07/16'],
    ['200 米', '21.34', '1988/09/29'],
    ['400 米', '47.60', '1985/10/06'],
    ['800 米', '1:53.28', '1983/07/26'],
    ['1000 米', '2:28.98', '1996/08/23'],
    ['1500 米', '3:49.04', '2024/07/07'],
    ['1 英里', '4:07.64', '2023/07/21'],
    ['2000 米', '5:19.70', '2024/07/12'],
    ['3000 米', '8:06.11', '1993/09/13'],
    ['5000 米', '14:00.21', '2023/09/17']
  ];

  var ENTRIES = [
    /* ---------------- 常用跑步网站（置顶） ---------------- */
    {
      id: 'websites',
      title: '常用跑步网站',
      sub: '官方 · 赛事 · 工具',
      blocks: [
        { type: 'p', text: '这里汇总一些跑步常用的官方与工具网站，方便随时查赛事、查纪录、查等级、查报名（每条后面都标注了用途，点击在新窗口打开）。' },
        { type: 'h', text: '官方机构与纪录' },
        {
          type: 'links',
          items: [
            { label: '中国田径协会（CAA）', url: 'https://www.athletics.org.cn/', note: '赛事认证、官方公告、大众等级办法' },
            { label: '中国马拉松（runchina.org.cn）', url: 'http://www.runchina.org.cn/', note: '赛事查询、成绩与大众等级证书' },
            { label: '世界田联（World Athletics）', url: 'https://worldathletics.org/', note: '官方纪录、世界排名、赛历' },
            { label: '世界田联 · 世界纪录', url: 'https://worldathletics.org/records/by-category/world-records', note: '场地与路跑世界纪录' },
            { label: '国家体育总局', url: 'https://www.sport.gov.cn/', note: '运动员技术等级标准' }
          ]
        },
        { type: 'h', text: '赛事与大满贯' },
        {
          type: 'links',
          items: [
            { label: '世界田联标牌路跑赛事', url: 'https://worldathletics.org/competitions/world-athletics-label-road-races', note: '白金标 / 金标等赛事查询' },
            { label: '世界马拉松大满贯（AbbottWMM）', url: 'https://www.worldmarathonmajors.com/', note: '七大满贯与六星奖牌' },
            { label: '大满贯赛事一览', url: 'https://www.worldmarathonmajors.com/six-star/majors', note: '各场满贯赛事官网入口' },
            { label: 'AIMS（国际马拉松及路跑协会）', url: 'https://aims-worldrunning.org/', note: '赛道丈量与纪录标准' }
          ]
        },
        { type: 'h', text: '越野跑' },
        {
          type: 'links',
          items: [
            { label: 'ITRA（国际越野跑协会）', url: 'https://itra.run/', note: '越野赛事认证与表现指数' },
            { label: 'UTMB World Series', url: 'https://utmb.world/', note: '跑石（Running Stones）与系列赛' }
          ]
        },
        { type: 'h', text: '本站工具' },
        {
          type: 'links',
          items: [
            { label: '马拉松配速计算器', url: 'pace-calc.html', note: '跑力 / 五区配速 / 赛事预测' },
            { label: 'AI 跑步教练', url: 'coach.html', note: '丹尼尔斯体系 · 跑步万事通' }
          ]
        }
      ]
    },

    /* ---------------- 1. 赛事组织和评级 ---------------- */
    {
      id: 'events',
      title: '赛事组织和评级',
      sub: '国际/国内',
      blocks: [
        { type: 'p', text: '世界田联（WA）和中国田协（CAA）对赛事的评级，整体反映出该赛事的办赛水准。下面分别介绍两套体系，并补充越野跑（ITRA / UTMB）的简介。' },
        { type: 'h', text: '中国田径协会（CAA）' },
        { type: 'p', text: '中国田径协会，简称「中国田协」（英文 Chinese Athletics Association，缩写 CAA）。赛事出现 CAA 字母圆形标识，即表示该赛事已成为中国田协的注册赛事；出现带五星红旗的中国田协标识，则表示该赛事由中国田协共办。中国田协在竞赛组织、技术等环节进行合作与指导，以提高并保证赛事的规范水准。' },
        { type: 'p', text: '田协每年按等级评定标准对赛事评级，即金标、银标、铜标，并在马拉松年会上发布，各等级以「CAA」字母加不同颜色圆形底纹区分。此外，田协还将赛事分为 A 类（A1、A2 类）和 B 类（含非标）赛事：A1 类认证标志着赛事的赛道、计时、裁判、兴奋剂检测等核心竞赛组织工作达到中国田协成绩认证标准；A2 类认证标志着赛事的基本竞赛组织工作达标。' },
        { type: 'h', text: '世界田联（WA）' },
        { type: 'p', text: '世界田联（World Athletics），简称「世界田联」，前身为国际田径联合会（IAAF）。世界田联依据赛道情况、计时系统、裁判水平、反兴奋剂等条件，对全球路跑赛事进行认证，设立白金标、金标、精英标、标牌等等级（Label Road Races）。获得标牌认证的赛事，其成绩可用于世界田联的相关排名与纪录认定。' },
        { type: 'h', text: '两套体系对照' },
        {
          type: 'table',
          head: ['机构', '等级体系', '代表标识'],
          rows: [
            ['中国田协 CAA', '金标 / 银标 / 铜标；A1 / A2 / B 类', 'CAA 字母 + 彩色圆底'],
            ['世界田联 WA', '白金标 / 金标 / 精英标 / 标牌', 'WA 标牌 Label']
          ],
          name: 0
        },
        { type: 'h', text: '越野跑（ITRA / UTMB）' },
        { type: 'p', text: 'ITRA（国际越野跑协会）负责越野赛事的赛道认证与「越野表现指数」评定；UTMB（环勃朗峰越野赛）系列以「UTMB Index / Running Stones（跑石）」作为参赛资格与完赛认证体系。越野跑爱好者可以重点关注这两个体系。' },
        { type: 'tip', text: '为什么重要：只有在中国田协 A1 类认证赛事中取得的成绩，才能用于申报大众选手等级、并计入官方排名。' }
      ],
      sources: [
        { tag: '官方', label: '中国田径协会官网（赛事与公告）', url: 'https://www.athletics.org.cn/' },
        { tag: '官方', label: '世界田联 · 标牌路跑赛事（Label Road Races）', url: 'https://worldathletics.org/competitions/world-athletics-label-road-races' },
        { tag: '官方', label: '中国马拉松官网', url: 'http://www.runchina.org.cn/' }
      ]
    },

    /* ---------------- 2. 大众马拉松选手评级 ---------------- */
    {
      id: 'amateur',
      title: '大众马拉松选手评级',
      sub: '大众选手评级',
      blocks: [
        { type: 'p', text: '2024 年 3 月，中国田径协会发布《2024 中国田径协会路跑管理文件汇编》大众选手等级评定实施办法。全程马拉松、半程马拉松均分为精英级、一级和二级，设置 34 岁以下组、35-39 岁组、40-44 岁组、45-49 岁组、50-54 岁组、55-59 岁组、60-64 岁组和 65 岁以上组等 8 个年龄组。此处不再列出 10 公里和 5 公里的级别划分标准。' }
      ].concat(amTables()).concat([
        { type: 'tip', text: '达标条件：须在中国田协 A1 类认证赛事中完成对应项目并达到成绩标准；通过「中国马拉松」官网注册申请，可免费下载电子证书。' }
      ]),
      sources: [
        { tag: '官方', label: '中国田径协会《路跑赛事大众选手等级评定实施办法》', url: 'https://www.athletics.org.cn/bulletin/hygd/mls/2023/0323/464400.html' },
        { tag: '官方', label: '中国马拉松官网（大众等级证书注册 / 查询）', url: 'http://www.runchina.org.cn/' }
      ]
    },

    /* ---------------- 3. 专业马拉松选手评级 ---------------- */
    {
      id: 'pro',
      title: '专业马拉松选手评级',
      sub: '专业选手评级',
      blocks: [
        { type: 'p', text: '近几年国内马拉松选手水平突飞猛进。国家体育总局发布新版《运动员技术等级标准》，自 2025 年 1 月 1 日起实施。专业马拉松选手评级不分年龄组，下表「国际级」全称为「国际级运动健将」。' },
        { type: 'h', text: '男子组' },
        {
          type: 'table',
          head: ['等级', '全马', '半马'],
          rows: [
            ['国际级', '2:12:50', '1:02:50'],
            ['运动健将', '2:19:20', '1:06:00'],
            ['一级', '2:31:10', '1:11:30'],
            ['二级', '2:51:30', '1:17:30'],
            ['三级', '3:00:00', '1:21:30']
          ],
          name: 0, num: [1, 2]
        },
        { type: 'h', text: '女子组' },
        {
          type: 'table',
          head: ['等级', '全马', '半马'],
          rows: [
            ['国际级', '2:33:20', '1:12:15'],
            ['运动健将', '2:39:20', '1:15:35'],
            ['一级', '3:08:40', '1:30:05'],
            ['二级', '3:20:40', '1:33:35'],
            ['三级', '3:32:50', '1:38:25']
          ],
          name: 0, num: [1, 2]
        },
        { type: 'tip', text: '达级须在相应级别的赛事中取得成绩；国际级运动健将、运动健将可通过世界田联白金标赛事达级。' }
      ],
      sources: [
        { tag: '官方', label: '国家体育总局《关于公布 2025 年运动员技术等级称号赛事名录的通知》（含《运动员技术等级标准》）', url: 'https://www.sport.gov.cn/jts/n4998/c28363453/content.html' },
        { tag: '官方', label: '国家体育总局《田径运动员技术等级标准》专题', url: 'https://www.sport.gov.cn/n4/n207/n209/n23554520/c23616565/content.html' }
      ]
    },

    /* ---------------- 4. 短中长跑世界纪录 ---------------- */
    {
      id: 'records',
      title: '短中长跑世界纪录',
      sub: '50米-100公里',
      blocks: [
        { type: 'p', text: '此处列出短中长跑（场地）世界纪录（截至 2025 年 3 月 9 日），(i) 为室内项目。半程马拉松、马拉松、10 公里、5 公里等路跑（公路）世界纪录，见本知识库「路跑世界纪录」条目。' },
        { type: 'h', text: '男子组' },
        { type: 'table', head: ['项目', '成绩', '赛事日期'], rows: WR_MEN, name: 0, num: [1], date: [2] },
        { type: 'h', text: '女子组' },
        { type: 'table', head: ['项目', '成绩', '赛事日期'], rows: WR_WOMEN, name: 0, num: [1], date: [2] }
      ],
      sources: [
        { tag: '官方', label: '世界田联 · 世界纪录（World Records）', url: 'https://worldathletics.org/records/by-category/world-records' }
      ]
    },

    /* ---------------- 5. 路跑世界纪录 ---------------- */
    {
      id: 'road-records',
      title: '路跑世界纪录',
      sub: '5K·10K·半马·全马',
      blocks: [
        { type: 'p', text: '此处列出世界田联（World Athletics）认证的路跑（公路）世界纪录，截至 2026 年 10 月。与场地项目不同，路跑纪录必须在符合标准的赛道、合规的配速条件下创造，并经世界田联正式批准（ratify）后方生效。「5 公里」为 5K 路跑，区别于场地 5000 米。' },
        { type: 'h', text: '男子组' },
        {
          type: 'table',
          head: ['项目', '成绩', '选手', '赛事日期'],
          rows: [
            ['5 公里', '12:49', 'Berihu Aregawi（埃塞俄比亚）', '2021/12/31'],
            ['10 公里', '26:31', 'Yomif Kejelcha（埃塞俄比亚）', '2025/02/16'],
            ['半程马拉松', '56:51', 'Yomif Kejelcha（埃塞俄比亚）', '2026/08/23'],
            ['马拉松', '1:59:30', 'Sabastian Sawe（肯尼亚）', '2026/04/26']
          ],
          name: 0, num: [1], date: [3]
        },
        { type: 'h', text: '女子组' },
        {
          type: 'table',
          head: ['项目', '成绩', '选手', '赛事日期'],
          rows: [
            ['5 公里', '13:54', 'Beatrice Chebet（肯尼亚）', '2024/12/31'],
            ['10 公里', '28:46', 'Agnes Ngetich（肯尼亚）', '2024/01/14'],
            ['半程马拉松', '1:02:52', 'Letesenbet Gidey（埃塞俄比亚）', '2021/10/24'],
            ['马拉松', '2:09:56', 'Ruth Chepngetich（肯尼亚）', '2024/10/13']
          ],
          name: 0, num: [1], date: [3]
        },
        { type: 'tip', text: '女子路跑另设「纯女子（women only）」纪录，与男女混合赛分开统计：半程马拉松 1:05:16（Jepchirchir，Gdynia 2020）、马拉松 2:15:41（Assefa，伦敦 2026）。' },
        { type: 'p', text: '补充：男子 10 公里原纪录 26:24（Kipruto，2020 年）因兴奋剂问题被取消，Kejelcha 的 26:31 于 2026 年 6 月被世界田联正式批准。男子马拉松纪录由 Sawe 在 2026 年伦敦马拉松跑出，是首个在合规比赛中「破二」的正式世界纪录。' }
      ],
      sources: [
        { tag: '官方', label: '世界田联 · 世界纪录（World Records）', url: 'https://worldathletics.org/records/by-category/world-records' },
        { tag: '官方', label: '世界田联 · 路跑各项目历代最好成绩（Toplists）', url: 'https://worldathletics.org/records/toplists' }
      ]
    },

    /* ---------------- 6. 世界马拉松大满贯 ---------------- */
    {
      id: 'majors',
      title: '世界马拉松大满贯',
      sub: '大满贯 · 六星奖牌',
      blocks: [
        { type: 'p', text: '世界马拉松大满贯（Abbott World Marathon Majors，缩写 AbbottWMM）由全球多场顶级城市马拉松组成，设有面向精英选手的年度积分总冠军，以及面向大众跑者的「六星奖牌」（Six Star Medal）。' },
        { type: 'h', text: '七场大满贯赛事' },
        {
          type: 'table',
          head: ['赛事', '城市', '加入年份'],
          rows: [
            ['东京马拉松', '日本 · 东京', '2013'],
            ['波士顿马拉松', '美国 · 波士顿', '创始（2006）'],
            ['伦敦马拉松', '英国 · 伦敦', '创始（2006）'],
            ['悉尼马拉松', '澳大利亚 · 悉尼', '2025'],
            ['柏林马拉松', '德国 · 柏林', '创始（2006）'],
            ['芝加哥马拉松', '美国 · 芝加哥', '创始（2006）'],
            ['纽约马拉松', '美国 · 纽约', '创始（2006）']
          ],
          name: 0
        },
        { type: 'p', text: '该系列 2006 年由波士顿、伦敦、柏林、芝加哥、纽约五场赛事发起；东京 2013 年加入成为第六场，悉尼 2025 年加入成为第七场。开普敦马拉松已确认成为第八场大满贯赛事，自 2027 年 5 月起加入。' },
        { type: 'h', text: '六星奖牌（Six Star）' },
        { type: 'p', text: '跑者完赛最初六场大满贯（东京 / 波士顿 / 伦敦 / 柏林 / 芝加哥 / 纽约），即可获得「六星奖牌」，这是许多大众跑者的终极目标。截至 2025 年底，已有两万余名跑者完成六星。' },
        { type: 'h', text: '精英积分总冠军' },
        { type: 'p', text: '精英选手在大满贯赛事中取得前五名可获积分（第 1~5 名依次为 25、16、9、4、1 分），一个赛季内只取最好两场的成绩计分，男女年终总冠军分获奖金。' }
      ],
      sources: [
        { tag: '官方', label: 'Abbott World Marathon Majors 官网', url: 'https://www.worldmarathonmajors.com/' },
        { tag: '官方', label: 'AbbottWMM · 六星奖牌（Six Star）与统计', url: 'https://www.worldmarathonmajors.com/stars' }
      ]
    },

    /* ---------------- 7. 赛事认证与赛道丈量 ---------------- */
    {
      id: 'certification',
      title: '赛事认证与赛道丈量',
      sub: 'A1/A2/B/C·丈量标准',
      blocks: [
        { type: 'p', text: '你报名的比赛是不是「认证赛事」，直接决定了成绩能否用于排名、申报大众等级，乃至被认定为世界纪录。下面分别说明中国田协的赛事认证分级，以及世界田联对路跑纪录的赛道要求。' },
        { type: 'h', text: '中国田协赛事认证（A 类 / B 类 / C 类）' },
        { type: 'p', text: '依据 2025 年新版《中国田径协会路跑赛事管理制度文件》，中国田协对路跑赛事实行 A 类（含 A1、A2 类）、B 类、C 类分级认证管理。' },
        {
          type: 'table',
          head: ['类别', '核心要求', '成绩用途'],
          rows: [
            ['A1 类', '赛道丈量、计时、裁判、兴奋剂检测等核心竞赛组织工作达到世界田联 / 全国纪录 / 成绩认证标准', '计入中国田协成绩排名；可申报大众选手等级；可申报全国、亚洲及世界纪录'],
            ['A2 类', '竞赛组织工作基本达到中国田协认证标准', '成绩可上传，但不计入排名'],
            ['B 类', '竞赛组织工作达到选手之间公平竞赛的基本标准', '成绩可上传但不计入排名'],
            ['C 类', '由省级体育行政部门认证后报中国田协备案', '属地备案']
          ],
          name: 0
        },
        { type: 'tip', text: '想申报大众选手等级、或让成绩进入官方排名，必须跑中国田协 A1 类认证赛事。' },
        { type: 'h', text: '世界田联路跑纪录的赛道标准' },
        { type: 'p', text: '世界田联对路跑世界纪录的赛道有明确要求：赛道须由世界田联 / AIMS 认证的 A 级或 B 级丈量员丈量并出具报告；起终点之间的直线距离不超过比赛距离的 50%；起终点整体海拔下降不超过千分之一（约每公里 1 米）。正因如此，波士顿马拉松虽然很快，却因起终点相距过远、整体下降而无法认证世界纪录。' },
        { type: 'h', text: '赛道怎么丈量：琼斯计数器与「宁长勿短」' },
        { type: 'p', text: '认证赛道采用「加装琼斯计数器（Jones counter）的自行车」丈量，并按最短路线（SPR）骑行；丈量结果会乘以 1.001 的「短道预防系数」（相当于每公里加 1 米），以保证赛道不会偏短。所以你手表常在马拉松终点显示 42.4–42.7 公里，并不代表赛道不准，而是赛道本就设计得「略长一些」。' }
      ],
      sources: [
        { tag: '官方', label: '中国田径协会 · 路跑赛事认证管理办法', url: 'https://www.athletics.org.cn/bulletin/hygd/mls/2023/0320/452982.html' },
        { tag: '官方', label: 'AIMS · 路跑世界纪录标准（World record criteria）', url: 'https://aims-worldrunning.org/world-records.html' },
        { tag: '官方', label: '中国马拉松官网（赛事认证查询）', url: 'http://www.runchina.org.cn/' }
      ]
    }
  ];

  /* ------------------------- 渲染 ------------------------- */

  function renderList() {
    $('kbList').innerHTML = ENTRIES.map(function (e) {
      return '<button type="button" class="kb-item" data-id="' + esc(e.id) + '">' +
        '<span class="kb-item__title">' + esc(e.title) + '</span>' +
        '<span class="kb-item__sub">' + esc(e.sub) + '</span>' +
        '<span class="kb-item__arrow">›</span>' +
        '</button>';
    }).join('');
  }

  function tableHtml(t) {
    var head = '<thead><tr>' + t.head.map(function (h) { return '<th>' + esc(h) + '</th>'; }).join('') + '</tr></thead>';
    var body = '<tbody>' + t.rows.map(function (row) {
      return '<tr>' + row.map(function (cell, i) {
        var cls = [];
        if (t.name === i) { cls.push('kb-name'); }
        if (t.grade === i) { cls.push('kb-grade'); }
        if (t.num && t.num.indexOf(i) >= 0) { cls.push('kb-num'); }
        if (t.date && t.date.indexOf(i) >= 0) { cls.push('kb-grade'); }
        return '<td' + (cls.length ? ' class="' + cls.join(' ') + '"' : '') + '>' + esc(cell) + '</td>';
      }).join('') + '</tr>';
    }).join('') + '</tbody>';
    return '<div class="kb-table-wrap"><table class="kb-table">' + head + body + '</table></div>';
  }

  function linksHtml(b) {
    return '<ul class="kb-links">' + b.items.map(function (it) {
      return '<li class="kb-links__item">' +
        '<a href="' + esc(it.url) + '" target="_blank" rel="noopener noreferrer">' + esc(it.label) + '</a>' +
        (it.note ? '<span class="kb-links__note">' + esc(it.note) + '</span>' : '') +
        '</li>';
    }).join('') + '</ul>';
  }

  function blockHtml(b) {
    if (b.type === 'h') { return '<div class="kb-h">' + esc(b.text) + '</div>'; }
    if (b.type === 'p') { return '<p class="kb-lead">' + esc(b.text) + '</p>'; }
    if (b.type === 'tip') { return '<div class="kb-tip">' + esc(b.text) + '</div>'; }
    if (b.type === 'links') { return linksHtml(b); }
    if (b.type === 'table') { return tableHtml(b); }
    return '';
  }

  function sourcesHtml(list) {
    if (!list || !list.length) { return ''; }
    return '<div class="kb-src">' +
      '<div class="kb-src__title">官方来源（点击查看原文）</div>' +
      '<ul class="kb-src__list">' + list.map(function (s) {
        return '<li class="kb-src__item">' +
          (s.tag ? '<span class="kb-src__tag">' + esc(s.tag) + '</span>' : '') +
          '<a href="' + esc(s.url) + '" target="_blank" rel="noopener noreferrer">' + esc(s.label) + '</a>' +
          '</li>';
      }).join('') + '</ul>' +
      '</div>';
  }

  function renderDetail(id) {
    var e = null;
    ENTRIES.forEach(function (x) { if (x.id === id) { e = x; } });
    if (!e) { return false; }
    $('kbDetail').innerHTML =
      '<h2 class="kb-detail-title">' + esc(e.title) + '</h2>' +
      '<div class="kb-detail-sub">' + esc(e.sub) + '</div>' +
      e.blocks.map(blockHtml).join('') +
      sourcesHtml(e.sources);
    return true;
  }

  function setView(isDetail) {
    $('kbListCard').hidden = isDetail;
    $('kbDetailCard').hidden = !isDetail;
    $('kbBack').hidden = !isDetail;
    $('kbHead').textContent = isDetail ? '知识库详情' : '跑步知识库';
    var cur = $('kbDetail').querySelector('.kb-detail-title');
    $('kbSubline').textContent = (isDetail && cur) ? cur.textContent : '赛事认证 · 选手等级 · 世界纪录 · 大满贯';
    window.scrollTo(0, 0);
  }

  function route() {
    var id = (location.hash || '').replace(/^#\/?/, '');
    if (id && renderDetail(id)) {
      setView(true);
    } else {
      setView(false);
    }
  }

  /* ------------------------- 交互与初始化 ------------------------- */

  function bindTheme() {
    var btn = $('themeToggle');
    if (!btn || !Store) { return; }
    function isLight() { return doc.documentElement.getAttribute('data-theme') === 'light'; }
    function sync() { Store.paintThemeIcon(btn); }
    sync();
    btn.onclick = function () { Store.applyTheme(isLight() ? 'dark' : 'light'); };
    if (Store.onThemeChange) { Store.onThemeChange(sync); }
  }

  $('kbList').addEventListener('click', function (ev) {
    var item = ev.target.closest ? ev.target.closest('.kb-item') : null;
    if (!item) { return; }
    location.hash = '#/' + item.getAttribute('data-id');
  });
  $('kbBack').addEventListener('click', function () { location.hash = ''; });
  window.addEventListener('hashchange', route);

  renderList();
  bindTheme();
  route();
})();
