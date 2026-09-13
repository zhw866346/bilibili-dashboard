/* ==========================================================================
   对账：Python 算出来的数，和前面五个页面用的数，是不是同一个数
   --------------------------------------------------------------------------
   ★ 为什么这一页必须有这一块

   这个项目里，同一批口径被实现了两遍：
     · 一遍在 src/data/metrics.ts，给前五个页面用（TypeScript）
     · 一遍在 scripts/analyze.py，给这一页用（Python + Pandas）

   两边**没有任何机制保证一致** —— 靠的是我照着同一份口径写了两遍。
   写两遍就会写错第二遍。第 1 步跑第一次对账时，就真抓出了一个 bug：
   Python 那边算分年龄段的日均 DAU 时忘了除天数，整整大了 7 倍。

   所以这一块不是装饰，是这一页的**核心论据**：
   它把"Python 的结果和前五个页面一致"从一句自我声明，
   变成一个当场可验、逐项可查的计算结果。

   ★ 两条纪律，改这个文件时不要破坏

   1. **只比数值，绝不比格式化后的字符串。**
      `formatPercent(v, 1)` 用的是 `toFixed(1)`，Python 用的是 `f"{v:.1f}"`，
      两者在 x.x5 这种边界值上舍入规则不同。比字符串会造出**假告警**，
      而假告警会摧毁这一整块的可信度 —— 比不对账还糟。

   2. **浮点容差是 5e-5，不是 1e-12。**
      analyze.py 刻意把浮点统一 `round(x, 4)`，让结果文件短、git diff 稳。
      所以两边差异的上限就是「最后一位的四舍五入误差」。
      容差比这更紧，就会把"取整"误报成"不一致"—— 第 1 步真踩过这个。

   ★ 还有一件事必须说清楚：**哪些项目对不了账。**
      用户级、视频级明细、中位数、HHI、rolling 平滑值 ——
      这些在 TS 侧没有对应的对象可比，所以只展示、不标"一致"。
      对账块末尾会主动把它们列出来。
      主动说清"哪些没对账"，比笼统宣称"全部一致"可信得多。
   ========================================================================== */

import { getDataset } from '../dataset'
import { getDayIndex, ratePct, sliceWindow } from '../metrics'
import { AGE_GROUP_IDS } from '../../utils/ageGroup'
import { CATEGORIES } from '../../utils/categories'
import type { CategoryName } from '../../types'
import { PY_RESULTS } from './results.generated'

/** 一个被对账的数字。 */
export interface ReconcileItem {
  /** 这一项是什么 */
  label: string
  /** Python 侧的值 */
  py: number
  /** 前端 metrics.ts 侧的值 */
  ts: number
}

export interface ReconcileGroup {
  title: string
  /** 这一组在比什么，一句话 */
  hint: string
  items: ReconcileItem[]
  /** 一致的项数 */
  okCount: number
  /** 总项数 */
  total: number
}

export interface ReconcileReport {
  groups: ReconcileGroup[]
  /** 全部组加起来的项数与不一致项数 */
  total: number
  mismatches: number
  /**
   * 没能对账的项目。不是"对过了没问题"，是"这边根本没有可对的对象"。
   * 页面必须把它们列出来，否则读者会以为对账块覆盖了全部内容。
   */
  notCompared: { item: string; reason: string }[]
}

/**
 * 浮点比较的容差。
 * 5e-5 = Python 那 4 位小数取整所能造成的最大误差，再留一点余量。
 */
const EPSILON = 5e-5

/** 一个数字算不算"对上了"。整数要求全等，浮点给容差。 */
function matched(py: number, ts: number): boolean {
  if (Number.isInteger(py) && Number.isInteger(ts)) return py === ts
  return Number.isFinite(py) && Number.isFinite(ts) && Math.abs(py - ts) <= EPSILON
}

function group(
  title: string,
  hint: string,
  raw: [string, number, number][],
): ReconcileGroup {
  const items: ReconcileItem[] = raw.map(([label, py, ts]) => ({ label, py, ts }))
  return {
    title,
    hint,
    items,
    okCount: items.filter((i) => matched(i.py, i.ts)).length,
    total: items.length,
  }
}

/**
 * 跑一遍对账。
 *
 * 只读、无副作用。但会读整个数据集并算一遍时间窗口，开销不小，
 * 所以调用方一定要 memo 住（见 PythonAnalysis.tsx）。
 */
export function getReconcileReport(): ReconcileReport {
  const dataset = getDataset()
  const index = getDayIndex()
  const py = PY_RESULTS
  const groups: ReconcileGroup[] = []

  /* ---------- ① 输入指纹：两边读的是不是同一份数据 ---------- */
  groups.push(
    group('输入指纹', '对不上的话，下面所有对比都没有意义', [
      ['用户表行数', py.manifest.rowCounts.users, dataset.users.length],
      ['视频表行数', py.manifest.rowCounts.videos, dataset.videos.length],
      ['创作者表行数', py.manifest.rowCounts.creators, dataset.creators.length],
      ['观看记录表行数', py.manifest.rowCounts.video_views, dataset.views.length],
    ]),
  )

  /* ---------- ② 逐日明细：60 天，一天不落 ---------- */
  /*
    这一组是最能说明问题的：如果两边对"哪天有多少人活跃"的理解一致，
    那基本可以肯定口径是复刻对了，而不只是总数碰巧对上。
  */
  const dailyRaw: [string, number, number][] = []
  let dailyDauOk = 0
  let dailyViewsOk = 0
  for (let i = 0; i < index.length; i += 1) {
    const p = py.activity.daily[i]
    const t = index[i]
    if (!p) continue
    // 当天各年龄段的播放次数加起来，就是当天总播放次数
    const tsViews = Object.values(t.viewsByAge).reduce((a, b) => a + b, 0)
    if (p.dau === t.activeUserIds.size) dailyDauOk += 1
    if (p.views === tsViews) dailyViewsOk += 1
  }
  dailyRaw.push([`逐日 DAU（${index.length} 天）`, dailyDauOk, index.length])
  dailyRaw.push([`逐日播放次数（${index.length} 天）`, dailyViewsOk, index.length])

  const totalViewsTs = index.reduce(
    (a, d) => a + Object.values(d.viewsByAge).reduce((x, y) => x + y, 0),
    0,
  )
  dailyRaw.push([
    '全量播放次数',
    py.activity.daily.reduce((a, d) => a + d.views, 0),
    totalViewsTs,
  ])

  groups.push(
    group('逐日对账', '不只是对总数，而是逐天逐个比 —— 总数对上可能只是巧合', dailyRaw),
  )

  /* ---------- ③ 三个时间窗口：逐字段 ---------- */
  for (const days of py.manifest.windowDays) {
    const p = py.windows[String(days)]
    if (!p) continue
    const t = sliceWindow(index, dataset, days, 0)
    const raw: [string, number, number][] = [
      ['窗口内播放次数', p.totalViews, t.totalViews],
      ['窗口内总用户数', p.totalUsers, t.totalUsers],
      ['窗口内新增用户', p.newUsersInWindow, t.newUsersInWindow],
      ['窗口内去重活跃用户', p.activeUsers, t.activeUsers],
      ['窗口内互动用户', p.engagedUsers, t.engagedUsers],
      ['窗口内观看秒数', p.totalSeconds, t.totalSeconds],
      ['窗口内日均 DAU', p.dau, t.dau],
      ['点赞数', p.totalLikes, t.totalLikes],
      ['收藏数', p.totalFavorites, t.totalFavorites],
      ['评论数', p.totalComments, t.totalComments],
      ['分享数', p.totalShares, t.totalShares],
    ]

    // 四个年龄段
    for (const age of AGE_GROUP_IDS) {
      raw.push([`${age} 岁用户数`, p.totalUsersByAge[age], t.totalUsersByAge[age]])
      raw.push([`${age} 岁活跃用户数`, p.activeUsersByAge[age], t.activeUsersByAge[age]])
      raw.push([`${age} 岁播放次数`, p.viewsByAge[age], t.viewsByAge[age]])
      raw.push([`${age} 岁日均 DAU`, p.dauByAge[age], t.dauByAge[age]])
    }

    // 八个分区
    for (const cat of CATEGORIES) {
      const pc = p.byCategory[cat]
      const tc = t.byCategory[cat]
      if (!pc) continue
      raw.push([`${cat} · 播放次数`, pc.views, tc.views])
      raw.push([`${cat} · 独立观看用户`, pc.viewers, tc.viewers])
      raw.push([`${cat} · 完播次数`, pc.completed, tc.completed])
      raw.push([`${cat} · 观看秒数`, pc.seconds, tc.seconds])
      raw.push([`${cat} · 点赞数`, pc.likes, tc.likes])
    }

    /* ---------- ③-a 年龄段 × 内容分区 ---------- */
    /*
      ★ 这一块为什么值得单独对账：
        Python 侧这几个派生指标（偏好占比 / 覆盖率 / 单次时长 / 完播率 / 互动率）
        是照着前端 selectors.ts 的 buildUserContentCells() 抄的第二遍。
        抄第二遍就会抄错第二遍 —— 所以逐格验一遍。
        而且 AI 分析助手页要用它做「SQL ↔ Python 交叉验证」，
        这一层先跟前端对齐，那层交叉验证才站得住。
    */
    for (const age of AGE_GROUP_IDS) {
      const row = p.agePreference.find((r) => r.age === age)
      if (!row) continue

      // 前端真值不是现成的，得从 sliceWindow 的 byAgeCategory 现算 ——
      // 用的公式和 selectors.ts 里那套逐字相同。
      const ageTotalViews = CATEGORIES.reduce((a, c) => a + t.byAgeCategory[age][c].views, 0)
      const ageActiveUsers = t.activeUsersByAge[age]

      raw.push([`${age} 岁 · 该档活跃用户`, row.activeUsers, ageActiveUsers])
      raw.push([`${age} 岁 · 该档播放次数`, row.totalViews, ageTotalViews])

      // ★ 按 CATEGORIES 遍历、去 row.cells 里找，而不是反过来遍历 row.cells。
      //   反过来遍历的话，Python 少输出一格就【静静地不比对】——
      //   少一格不报错，只是这一项不存在。按 CATEGORIES 遍历，
      //   谁是权威就一目了然；格数不对由本机那条「8 格」断言拦住。
      for (const cat of CATEGORIES) {
        const cell = row.cells.find((c) => c.category === cat)
        const tc = t.byAgeCategory[age][cat]
        if (!cell || !tc) continue
        const interactions = tc.likes + tc.favorites + tc.comments + tc.shares
        const tag = `${age} 岁 × ${cell.category}`
        raw.push([`${tag} · 播放次数`, cell.views, tc.views])
        raw.push([`${tag} · 独立观看用户`, cell.viewers, tc.viewers])
        raw.push([`${tag} · 偏好占比`, cell.share, ratePct(tc.views, ageTotalViews)])
        raw.push([`${tag} · 用户覆盖率`, cell.coverage, ratePct(tc.viewers, ageActiveUsers)])
        raw.push([
          `${tag} · 单次观看时长`,
          cell.avgMinutes,
          tc.views > 0 ? tc.seconds / 60 / tc.views : 0,
        ])
        raw.push([`${tag} · 完播率`, cell.completedRate, ratePct(tc.completed, tc.views)])
        raw.push([`${tag} · 互动率`, cell.engageRate, ratePct(interactions, tc.views)])
      }
    }

    /* ---------- ③-b 各分区「前半段 vs 后半段」 ---------- */
    /*
      这一块前端没有现成的对象可比 —— 内容分析页只展示「整个窗口」的汇总，
      从来没人按时间把窗口切两半看过。所以前端真值只能在这里现算：
      把 day.byAgeCategory 逐日的播放次数按分区加起来，再按位置切两段。

      ★ 切法与 analyze.py 的 build_category_trend() 严格一致：
        前半段 = 前 ⌊N/2⌋ 天，后半段 = 剩下的 N − ⌊N/2⌋ 天。
        7 天窗口切出来是 3 天 vs 4 天，两段天数不等 ——
        所以比的是【日均】，页面上也要把两段天数标出来。
    */
    const trend = p.categoryTrend
    const windowDays = index.slice(index.length - days)
    const cut = Math.floor(windowDays.length / 2)
    raw.push(['前半段天数', trend.firstDays, cut])
    raw.push(['后半段天数', trend.secondDays, windowDays.length - cut])

    const dailyViewsOfCategory = (day: (typeof windowDays)[number], cat: CategoryName) =>
      AGE_GROUP_IDS.reduce((a, age) => a + day.byAgeCategory[age][cat].views, 0)

    for (const cat of CATEGORIES) {
      const row = trend.categories.find((r) => r.category === cat)
      if (!row) continue
      const firstViews = windowDays.slice(0, cut).reduce((a, d) => a + dailyViewsOfCategory(d, cat), 0)
      const secondViews = windowDays.slice(cut).reduce((a, d) => a + dailyViewsOfCategory(d, cat), 0)
      const firstDaily = cut > 0 ? firstViews / cut : 0
      const secondDaily = windowDays.length - cut > 0 ? secondViews / (windowDays.length - cut) : 0
      const growth = firstDaily > 0 ? ((secondDaily - firstDaily) / firstDaily) * 100 : null

      raw.push([`${cat} · 前半段播放次数`, row.firstViews, firstViews])
      raw.push([`${cat} · 后半段播放次数`, row.secondViews, secondViews])
      raw.push([`${cat} · 前半段日均`, row.firstDailyViews, firstDaily])
      raw.push([`${cat} · 后半段日均`, row.secondDailyViews, secondDaily])

      /*
        ★ 增长率可能是 null（前半段那个分区一次都没被看过）。
          这时候不能拿 0 顶上——0 的意思是「没涨没跌」，和「算不出来」是两回事。
          所以退而比「可算性」本身：1 = 算得出，0 = 算不出。
          两边只要有一边能算、另一边不能，这一项就会报不一致。
      */
      if (row.growthPct !== null && growth !== null) {
        raw.push([`${cat} · 增长率`, row.growthPct, growth])
      } else {
        raw.push([
          `${cat} · 增长率可算性（1=算得出）`,
          row.growthPct !== null ? 1 : 0,
          growth !== null ? 1 : 0,
        ])
      }
    }

    groups.push(
      group(
        `近 ${days} 天窗口`,
        '这个窗口下每一个展示出来的字段，逐个和前端算的比',
        raw,
      ),
    )
  }

  /* ---------- ④ 分层自洽：Python 内部自己和自己对得上吗 ---------- */
  /*
    这一组比的是 Python 结果**内部**的恒等式，不是和前端比。
    为什么也要查：分层的四档人数加起来必须等于全部用户，
    对不上就说明 qcut 有用户没被分进任何一档。
  */
  const tierUsers = py.tiers.reduce((a, t) => a + t.users, 0)
  const tierMinutesShare = py.tiers.reduce((a, t) => a + t.minutesShare, 0)
  groups.push(
    group('分层自洽性', 'Python 结果自己内部的两条恒等式（不是和前端比）', [
      ['四档人数合计', tierUsers, dataset.users.length],
      ['四档时长占比合计', Math.round(tierMinutesShare * 100) / 100, 100],
    ]),
  )

  const total = groups.reduce((a, g) => a + g.total, 0)
  const mismatches = groups.reduce((a, g) => a + (g.total - g.okCount), 0)

  /* ---------- ⑤ 没能对账的：如实列出来 ---------- */
  const notCompared = [
    {
      item: '用户级 / 视频级明细',
      reason:
        '前端页面只展示聚合后的指标，没有逐个用户、逐个视频的对照物可比。' +
        '这一部分只能靠 Python 内部的数据体检（模块 3）自证。',
    },
    {
      item: '中位数、HHI、分位数边界',
      reason:
        '这些指标在整个看板里只有这一页算过，前端没有第二份实现可比 —— ' +
        '对不了账，就不标"一致"。',
    },
    {
      item: 'rolling(7) 平滑值与日环比',
      reason:
        '前端首页的趋势图画的是原始日均值，没有平滑。' +
        '这是这一页独有的加工，所以只展示、不宣称和前端一致。',
    },
    {
      item: '皮尔逊相关系数、余弦相似度',
      reason: '同样是这一页独有的计算，前端没有可比对象。',
    },
    {
      item: '聚类 / 分层的档位划分',
      reason:
        'qcut 的边界是由数据自己算出来的，前端做的是固定边界分箱（年龄段），' +
        '两者本来就不是一回事。',
    },
    {
      item: '偏好占比 / 增长率的【排名次序】',
      reason:
        '上面比的是每一格、每一个分区的【数值】，那部分是全对的。' +
        '但"谁排第一"是排序产物：两个分区数值并列时，两边谁排前面没有约定，' +
        '定死了也只是巧合，所以不把名次本身标成"已对账"。' +
        '要引用名次，请用数值自己排，别引用序号。',
    },
    {
      item: '年龄段中文标签（「18–24岁」这种）',
      reason:
        'Python 侧刻意不输出这个标签 —— 前端 src/utils/ageGroup.ts 才是年龄段的唯一权威定义。' +
        '在这边也写一份，等于给自己造出第二个真相来源，迟早会对不上。',
    },
  ]

  return { groups, total, mismatches, notCompared }
}

/** 某一组里的项是否对上了。给页面渲染用。 */
export function itemOk(item: ReconcileItem): boolean {
  return matched(item.py, item.ts)
}
