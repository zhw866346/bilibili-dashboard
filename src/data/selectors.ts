/* ==========================================================================
   页面数据组装（selectors）
   --------------------------------------------------------------------------
   上一层 metrics.ts 算的是"通用的口径"（谁活跃、看了多久……）。
   这一层负责把那些通用口径，组装成【页面正好要用的形状】：

     · KPI 卡片要的那 5 个数字
     · 柱状图要的「每个年龄段一行」
     · 热力图要的「4 行 × 8 列矩阵」
     · 趋势图要的「每天一个点」

   分开的好处：页面组件只负责"怎么画"，不负责"怎么算"。
   任何一个数字对不上，你都能在这一个文件里找到它的来龙去脉。
   ========================================================================== */

import type {
  AgeGroupId,
  CategoryName,
  CategoryStat,
  Kpi,
  TrendPoint,
} from '../types'
import { AGE_GROUP_IDS, ageGroupLabel } from '../utils/ageGroup'
import { CATEGORIES, categorySlot } from '../utils/categories'
import { formatCount } from '../utils/format'
import { getDataset } from './dataset'
import {
  activeRate,
  avgMinutesPerUser,
  avgViewsPerUser,
  dailyActiveUsers,
  getDayIndex,
  ratePct,
  sliceWindow,
  type WindowSummary,
} from './metrics'

/* ---------------------------------------------------------------
   一、时间窗口（带缓存）
   --------------------------------------------------------------- */

interface WindowPair {
  /** 当前窗口，例如"近 7 天" */
  current: WindowSummary
  /** 上一周期，例如"再往前 7 天"。用来算环比。 */
  previous: WindowSummary
}

const windowCache = new Map<number, WindowPair>()

/**
 * 取某个天数的当前窗口 + 上一周期。
 * 结果缓存起来：在 7/14/30 之间来回切换不会重复计算。
 */
export function getWindowPair(days: number): WindowPair {
  let hit = windowCache.get(days)
  if (!hit) {
    const dataset = getDataset()
    const index = getDayIndex()
    hit = {
      current: sliceWindow(index, dataset, days, 0),
      previous: sliceWindow(index, dataset, days, days),
    }
    windowCache.set(days, hit)
  }
  return hit
}

/** 环比变化百分比。上一周期为 0 时不算环比（避免除以 0 得到无穷大）。 */
function deltaPct(current: number, previous: number): number | undefined {
  if (!Number.isFinite(current) || !Number.isFinite(previous)) return undefined
  if (previous <= 0) return undefined
  return ((current - previous) / previous) * 100
}

/* ---------------------------------------------------------------
   二、年龄段指标（柱状图 + 明细表都用它）
   --------------------------------------------------------------- */

export interface AgeRow {
  id: AgeGroupId
  label: string
  /** 用户规模：该年龄段累计注册用户数 */
  users: number
  /** 日均活跃用户数 */
  dau: number
  /** 活跃率 % = dau ÷ users */
  activeRate: number
  /** 人均单日观看时长（分钟） */
  avgMinutes: number
  /** 人均单日观看视频数（个） */
  avgVideos: number
  /**
   * 单条视频平均观看时长（分钟）= 人均时长 ÷ 人均视频数。
   * 这个指标是"看得深不深"的直接体现：
   * 同样看了 40 分钟，有人是刷了 5 条短视频，有人是认认真真看完 3 条长视频。
   */
  minutesPerVideo: number
}

function buildAgeRows(w: WindowSummary): AgeRow[] {
  return AGE_GROUP_IDS.map((id) => {
    const users = w.totalUsersByAge[id]
    const dau = w.dauByAge[id]
    // 人均指标的分母是"该年龄段的人天数"＝该年龄段日均活跃人数 × 天数，
    // 和全站口径完全一致（见 metrics.ts 里 avgMinutesPerUser 的说明）。
    const avgMinutes = avgMinutesPerUser(w.secondsByAge[id], dau, w.days)
    const avgVideos = avgViewsPerUser(w.viewsByAge[id], dau, w.days)
    return {
      id,
      label: ageGroupLabel(id),
      users,
      dau,
      activeRate: activeRate(dau, users),
      avgMinutes,
      avgVideos,
      minutesPerVideo: avgVideos > 0 ? avgMinutes / avgVideos : 0,
    }
  })
}

/* ---------------------------------------------------------------
   三、内容分区指标（首页排行 + 内容分析页都用它）
   ---------------------------------------------------------------
   数据来源是 metrics.ts 里的 byCategory，它由「用户 → 观看记录 → 视频 → 分区」
   一路关联汇总而来，不是手写的表。
   --------------------------------------------------------------- */

function buildCategoryStats(w: WindowSummary): CategoryStat[] {
  // 全站播放量，用来算各分区的"播放量占比"
  let grandViews = 0
  for (const c of CATEGORIES) grandViews += w.byCategory[c].views

  return CATEGORIES.map((category) => {
    const cell = w.byCategory[category]
    const interactions = cell.likes + cell.favorites + cell.comments + cell.shares

    return {
      category,
      slot: categorySlot(category),
      plays: cell.views,
      playShare: ratePct(cell.views, grandViews),
      totalMinutes: cell.seconds / 60,
      // 分母是"播放次数"：平均点开一次看多久
      avgMinutes: cell.views > 0 ? cell.seconds / cell.views / 60 : 0,

      viewers: cell.viewers,
      // 分母是"独立观看用户"：看过这个分区的人，一共看了几条
      viewsPerViewer: cell.viewers > 0 ? cell.views / cell.viewers : 0,
      // 分母同上：一共看了多久
      minutesPerViewer: cell.viewers > 0 ? cell.seconds / cell.viewers / 60 : 0,
      completedRate: ratePct(cell.completed, cell.views),

      likeRate: ratePct(cell.likes, cell.views),
      favoriteRate: ratePct(cell.favorites, cell.views),
      commentRate: ratePct(cell.comments, cell.views),
      shareRate: ratePct(cell.shares, cell.views),
      engageRate: ratePct(interactions, cell.views),
    }
  })
}

/* ---------------------------------------------------------------
   三点五、内容表现矩阵（内容分析页的第五部分）
   ---------------------------------------------------------------
   横轴 = 人均观看时长（口径 B：总时长 ÷ 独立观看用户）
   纵轴 = 独立观看用户数
   气泡大小 = 播放量

   分界线画在「8 个分区各自的中位数」上，把平面切成四个象限：
     右上 高用户 + 高深度  → 核心内容
     右下 高用户 + 低深度  → 大众流量内容
     左上 低用户 + 高深度  → 小众高粘性内容
     左下 低用户 + 低深度  → 边缘内容

   ⚠️ 为什么用中位数而不是平均值：平均值会被极端值带跑（某个分区播放量特别大，
      平均值就被拉高，可能某个象限里一个点都没有）。用中位数能保证
      「上下各 4 个、左右各 4 个」，四个象限多少都有内容，框架才立得住。
      代价是它是【相对】划分——哪怕 8 个分区其实差不多，也会被切成两半。
      所以页面上必须把中位数的具体数值标出来，读者才知道线画在哪。
   --------------------------------------------------------------- */

/** 求中位数。8 个数就是取第 4、5 个的平均。 */
function median(values: number[]): number {
  if (values.length === 0) return 0
  const sorted = [...values].sort((a, b) => a - b)
  const mid = Math.floor(sorted.length / 2)
  if (sorted.length % 2 === 1) return sorted[mid]
  return (sorted[mid - 1] + sorted[mid]) / 2
}

export type QuadrantKey = 'core' | 'mass' | 'niche' | 'edge'

export interface QuadrantDef {
  key: QuadrantKey
  label: string
  /** 一句话解释这个象限意味着什么 */
  desc: string
  /** 落在这个象限里的分区 */
  items: CategoryName[]
}

export interface MatrixData {
  points: {
    category: CategoryName
    slot: number
    /** 横轴：人均观看时长（分钟） */
    x: number
    /** 纵轴：独立观看用户数 */
    y: number
    /** 气泡大小：播放量 */
    plays: number
    quadrant: QuadrantKey
  }[]
  /** 竖线的位置（人均观看时长的中位数） */
  xMedian: number
  /** 横线的位置（独立观看用户数的中位数） */
  yMedian: number
  quadrants: QuadrantDef[]
}

/*
  ⚠️ 用词注意：这里的"高/低"全部是【相对于本数据集里其他分区的中位数】，
  不是说绝对值上真的高或低。在这套模拟数据里八个分区的独立观看用户数
  都落在全站用户的 77%~99% 之间，没有哪个分区是真的"小众"。
  所以下面一律不用"人多人少"这种绝对说法，改用"相对"，页面上还有一块专门的说明。
*/
const QUADRANT_META: { key: QuadrantKey; label: string; desc: string }[] = [
  {
    key: 'core',
    label: '核心内容',
    desc: '用户覆盖和人均停留双高。平台的当家内容，供给的稳定性最该被关注。',
  },
  {
    key: 'mass',
    label: '大众流量内容',
    desc: '覆盖面在八个分区里靠前，但人均停留偏短。拉新和拉活跃靠它，留住人不能只靠它。',
  },
  {
    key: 'niche',
    label: '小众高粘性内容',
    desc: '用户覆盖相对靠后，但来的人看得更深。受众相对窄、黏性高，适合做垂类深耕。',
  },
  {
    key: 'edge',
    label: '边缘内容',
    desc: '两个维度都在中位数以下。在当前这套模拟数据里，相对规模和人均深度都不占优。',
  },
]

function buildMatrix(stats: CategoryStat[]): MatrixData {
  const xValues = stats.map((s) => s.minutesPerViewer)
  const yValues = stats.map((s) => s.viewers)
  const xMedian = median(xValues)
  const yMedian = median(yValues)

  const bucket: Record<QuadrantKey, CategoryName[]> = { core: [], mass: [], niche: [], edge: [] }

  const points = stats.map((s) => {
    const highX = s.minutesPerViewer >= xMedian // 深度高
    const highY = s.viewers >= yMedian // 用户多
    let quadrant: QuadrantKey = 'edge'
    if (highX && highY) quadrant = 'core'
    else if (!highX && highY) quadrant = 'mass'
    else if (highX && !highY) quadrant = 'niche'
    bucket[quadrant].push(s.category)

    return {
      category: s.category,
      slot: s.slot,
      x: s.minutesPerViewer,
      y: s.viewers,
      plays: s.plays,
      quadrant,
    }
  })

  return {
    points,
    xMedian,
    yMedian,
    quadrants: QUADRANT_META.map((q) => ({ ...q, items: bucket[q.key] })),
  }
}

/* ---------------------------------------------------------------
   四、年龄 × 内容热力图矩阵
   ---------------------------------------------------------------
   数据来源：metrics.ts 里的 byAgeCategory，它是从
   「用户 → 观看记录 → 视频 → 分区」一路关联算出来的，不是手写的表。

   关于颜色用什么：
   单元格上显示的数字是【观看量】（原始次数），但决定颜色深浅的是
   【行内占比】——也就是"这个年龄段把多少观看量花在了这个分区上"。
   为什么用占比上色？因为 18-24 岁有 1913 人、40+ 只有 860 人，
   直接拿观看量比，人多的年龄段整行都会更深，那是"人多"不是"偏爱"。
   换成行内占比，同一行里颜色深的格子才真的代表"更喜欢"。
   --------------------------------------------------------------- */

export interface HeatmapCell {
  category: CategoryName
  /**
   * 决定颜色深浅的值。
   * ⚠️ 三张热力图这个字段的含义不一样，看页面上的 legendLabel：
   *    偏好图 = 行内占比(%)，深度图 = 人均观看时长(分)，互动图 = 综合互动率(%)
   */
  share: number
  /** 格子上直接显示的文字 */
  text: string
  /** 鼠标悬停时逐行显示的明细 */
  detail: { label: string; value: string }[]
  /** 兼容字段：观看量。用户分析页的解读文字还在用它 */
  views: number
}

export interface HeatmapRow {
  /**
   * 这一行的标识。
   * ★ 类型是 string 而不是 AgeGroupId：这张热力图原来只用来画「年龄段 × 分区」，
   *   现在 Python 分析页要拿它画「活跃分层 × 分区」，行标识变成了
   *   "Q1 最低 / Q2 / Q3 / Q4 最高"。放宽成 string 后两种用法都能走。
   *   唯一的消费方是 Users.tsx 的 heatmapNote，它的形参本来就写的 string，
   *   所以这次放宽对已有页面零影响、零运行时变化。
   */
  id: string
  label: string
  /** 该年龄段在窗口内的总观看量 */
  totalViews: number
  cells: HeatmapCell[]
}

export interface HeatmapData {
  rows: HeatmapRow[]
  categories: CategoryName[]
  /** 色阶的上限值（含义跟着这张图的指标走） */
  shareMax: number
  /** 色阶图例左边的文字，例如「颜色 = 该年龄段观看量占比」 */
  legendLabel: string
  /** 色阶图例右边括号里的文字，例如「33.4%」 */
  legendMaxText: string
  /** 全部 32 个格子里数值最大的那个，用于描述"最强偏好" */
  /* age 的类型跟着 HeatmapRow.id 一起放宽成 string，理由见那里 */
  peak: { age: string; category: CategoryName; share: number } | null
}

function buildHeatmap(w: WindowSummary): HeatmapData {
  let shareMax = 0
  const rows: HeatmapRow[] = AGE_GROUP_IDS.map((id) => {
    const activeUsers = w.activeUsersByAge[id]

    let totalViews = 0
    for (const c of CATEGORIES) totalViews += w.byAgeCategory[id][c].views

    const cells: HeatmapCell[] = CATEGORIES.map((category) => {
      const cell = w.byAgeCategory[id][category]
      const share = ratePct(cell.views, totalViews)
      if (share > shareMax) shareMax = share
      const perUser = activeUsers > 0 ? cell.views / activeUsers / w.days : 0
      return {
        category,
        share,
        views: cell.views,
        text: formatCount(cell.views),
        detail: [
          { label: '观看量', value: `${formatCount(cell.views)} 次` },
          { label: '占该年龄段', value: `${share.toFixed(1)}%` },
          { label: '人均每天', value: `${perUser.toFixed(2)} 次` },
        ],
      }
    })

    return { id, label: ageGroupLabel(id), totalViews, cells }
  })

  // 找出全局最深的那个格子——这是数据里真实存在的最大值，不是为了写结论编的
  let peak: HeatmapData['peak'] = null
  for (const row of rows) {
    for (const cell of row.cells) {
      if (!peak || cell.share > peak.share) {
        peak = { age: row.id, category: cell.category, share: cell.share }
      }
    }
  }

  return {
    rows,
    categories: CATEGORIES,
    shareMax: shareMax || 1,
    legendLabel: '颜色 = 该年龄段观看量占比',
    legendMaxText: `${(shareMax || 0).toFixed(1)}%`,
    peak,
  }
}

/* ---------------------------------------------------------------
   五、用户分析页
   --------------------------------------------------------------- */

export interface UserAnalytics {
  days: number
  /** 例如 "2026-08-12 ~ 2026-09-10" */
  rangeLabel: string
  kpis: Kpi[]
  ageRows: AgeRow[]
  heatmap: HeatmapData
  /** 这一页用到的样本量说明，页面上会显示出来，方便核对 */
  sample: {
    users: number
    activeUsers: number
    views: number
    days: number
  }
}

export function getUserAnalytics(days: number): UserAnalytics {
  const { current, previous } = getWindowPair(days)

  const curMinutes = avgMinutesPerUser(current.totalSeconds, current.dau, current.days)
  const prevMinutes = avgMinutesPerUser(previous.totalSeconds, previous.dau, previous.days)
  const curVideos = avgViewsPerUser(current.totalViews, current.dau, current.days)
  const prevVideos = avgViewsPerUser(previous.totalViews, previous.dau, previous.days)

  /*
    活跃率的分子分母必须同口径。分母「用户总量」是截至数据截止日的存量，
    在 7/14/30 天之间是同一个数，所以当前和上一周期都用它，
    这样环比的变化只来自分子（活跃人数），不会掺进别的因素。
  */
  const curActiveRate = activeRate(current.dau, current.totalUsers)
  const prevActiveRate = activeRate(previous.dau, current.totalUsers)

  const kpis: Kpi[] = [
    {
      id: 'totalUsers',
      name: '用户总量',
      value: current.totalUsers,
      unit: 'count',
      // 存量指标：环比百分比对它没有意义，所以不传 deltaPct，
      // 卡片不显示涨跌徽标，只交代口径和窗口内新增。
      deltaLabel: `截至 ${current.endDate} 累计注册 · 近 ${current.days} 天新增 ${current.newUsersInWindow.toLocaleString('zh-CN')} 人`,
      desc:
        '统计截止日为止注册过的用户总数。它是个"存量"：不管你把时间范围切成' +
        ' 7 天还是 30 天，平台今天的用户总量都是这个数。它是下面活跃率的分母。',
    },
    {
      id: 'dau',
      name: '日均活跃用户',
      abbr: 'DAU',
      value: current.dau,
      unit: 'count',
      deltaPct: deltaPct(current.dau, previous.dau),
      deltaLabel: '较上一周期',
      desc:
        '窗口内每天的活跃人数取平均。活跃 = 当天至少看过 1 个视频，' +
        '同一个人一天看 10 个视频也只算 1 个活跃用户（COUNT(DISTINCT user_id)）。',
    },
    {
      id: 'activeRate',
      name: '活跃率',
      value: curActiveRate,
      unit: 'percent',
      deltaPct: deltaPct(curActiveRate, prevActiveRate),
      deltaLabel: '较上一周期',
      desc:
        '日均活跃用户 ÷ 用户总量。分子和分母取的是同一批人、同一个截止日，' +
        '口径一致才不会算出超过 100% 的怪数。',
    },
    {
      id: 'avgMinutes',
      name: '人均观看时长',
      value: curMinutes,
      unit: 'duration',
      deltaPct: deltaPct(curMinutes, prevMinutes),
      deltaLabel: '较上一周期',
      desc:
        '窗口内总观看时长 ÷（日均活跃用户数 × 天数）。' +
        '说白了就是：平均每个活跃用户每天看多久。',
    },
    {
      id: 'avgVideos',
      name: '人均观看视频数',
      value: curVideos,
      unit: 'number',
      deltaPct: deltaPct(curVideos, prevVideos),
      deltaLabel: '较上一周期',
      desc:
        '窗口内总观看次数 ÷（日均活跃用户数 × 天数）。' +
        '和人均时长配合着看：次数多但时长短，说明刷得快、看得浅。',
    },
  ]

  return {
    days,
    rangeLabel: `${current.startDate} ~ ${current.endDate}`,
    kpis,
    ageRows: buildAgeRows(current),
    heatmap: buildHeatmap(current),
    sample: {
      users: current.totalUsers,
      activeUsers: current.activeUsers,
      views: current.totalViews,
      days: current.days,
    },
  }
}

/* ---------------------------------------------------------------
   六、首页概览
   --------------------------------------------------------------- */

export interface OverviewAnalytics {
  days: number
  kpis: Kpi[]
  /** 每天一个点，用于趋势图 */
  trend: TrendPoint[]
  ageRows: AgeRow[]
  categories: CategoryStat[]
  /** 本页用到的样本量，页面上会显示出来方便核对 */
  sample: {
    users: number
    activeUsers: number
    views: number
    days: number
  }
}

export function getOverviewAnalytics(days: number): OverviewAnalytics {
  const { current, previous } = getWindowPair(days)
  const index = getDayIndex()

  const curMinutes = avgMinutesPerUser(current.totalSeconds, current.dau, current.days)
  const prevMinutes = avgMinutesPerUser(previous.totalSeconds, previous.dau, previous.days)
  // 内容互动率 = 互动行为总次数 ÷ 观看总次数
  const curInteractions =
    current.totalLikes + current.totalFavorites + current.totalComments + current.totalShares
  const prevInteractions =
    previous.totalLikes + previous.totalFavorites + previous.totalComments + previous.totalShares
  const curEngageRate = ratePct(curInteractions, current.totalViews)
  const prevEngageRate = ratePct(prevInteractions, previous.totalViews)

  const kpis: Kpi[] = [
    {
      id: 'totalUsers',
      name: '用户总量',
      value: current.totalUsers,
      unit: 'count',
      deltaLabel: `截至 ${current.endDate} 累计注册 · 近 ${current.days} 天新增 ${current.newUsersInWindow.toLocaleString('zh-CN')} 人`,
      desc: '统计截止日为止注册过的用户总数，是下面所有"率"指标的分母。',
    },
    {
      id: 'dau',
      name: '日均活跃用户',
      abbr: 'DAU',
      value: current.dau,
      unit: 'count',
      deltaPct: deltaPct(current.dau, previous.dau),
      deltaLabel: '较上一周期',
      desc: '窗口内每天活跃人数的平均值。活跃 = 当天至少看过 1 个视频的去重用户。',
    },
    {
      id: 'activeRate',
      name: '活跃率',
      value: activeRate(current.dau, current.totalUsers),
      unit: 'percent',
      // 分子分母同口径：当前和上一周期都用同一个「用户总量」作分母
      deltaPct: deltaPct(
        activeRate(current.dau, current.totalUsers),
        activeRate(previous.dau, current.totalUsers),
      ),
      deltaLabel: '较上一周期',
      desc: '日均活跃用户 ÷ 用户总量，反映用户打开 App 的日常习惯有多稳。',
    },
    {
      id: 'avgMinutes',
      name: '人均观看时长',
      value: curMinutes,
      unit: 'duration',
      deltaPct: deltaPct(curMinutes, prevMinutes),
      deltaLabel: '较上一周期',
      desc: '总观看时长 ÷（日均活跃用户数 × 天数），即平均每位活跃用户每天看多久。',
    },
    {
      id: 'engageRate',
      name: '内容互动率',
      value: curEngageRate,
      unit: 'percent',
      deltaPct: deltaPct(curEngageRate, prevEngageRate),
      deltaLabel: '较上一周期',
      desc: '点赞 + 收藏 + 评论 + 分享的总次数 ÷ 观看总次数，衡量内容有多容易让人动手。',
    },
  ]

  return {
    days,
    kpis,
    trend: dailyActiveUsers(index, days),
    ageRows: buildAgeRows(current),
    categories: buildCategoryStats(current),
    sample: {
      users: current.totalUsers,
      activeUsers: current.activeUsers,
      views: current.totalViews,
      days: current.days,
    },
  }
}

/* ---------------------------------------------------------------
   七、内容分析页
   --------------------------------------------------------------- */

export interface ContentAnalytics {
  days: number
  rangeLabel: string
  kpis: Kpi[]
  /** 八个分区的全套指标（顺序 = CATEGORIES 的固定顺序） */
  categories: CategoryStat[]
  /** 内容表现矩阵（含四象限归类） */
  matrix: MatrixData
  /** 这一页用到的样本量，显示在页面上方便核对 */
  sample: {
    /** 窗口内总播放次数 */
    views: number
    /** 窗口内看过内容的去重用户数 */
    viewers: number
    days: number
    /** 本次窗口内有观看记录的分区数 */
    categoriesWithData: number
  }
}

export function getContentAnalytics(days: number): ContentAnalytics {
  const { current, previous } = getWindowPair(days)

  const curInteractions =
    current.totalLikes + current.totalFavorites + current.totalComments + current.totalShares
  const prevInteractions =
    previous.totalLikes + previous.totalFavorites + previous.totalComments + previous.totalShares

  /*
    这一页的 KPI「人均观看时长」用的是【口径 A】：
        总观看秒数 ÷（日均活跃用户数 × 天数）
    也就是"平均每个活跃用户每天看多久"——和首页、用户分析页完全同一个口径，
    这样三个页面上的这个数字可以直接对照，不会打架。
    （分区维度的"人均观看时长"是另一个口径，见 buildCategoryStats 里的注释。）
  */
  const curMinutes = avgMinutesPerUser(current.totalSeconds, current.dau, current.days)
  const prevMinutes = avgMinutesPerUser(previous.totalSeconds, previous.dau, previous.days)

  const categoriesWithData = CATEGORIES.filter((c) => current.byCategory[c].views > 0).length

  const kpis: Kpi[] = [
    {
      id: 'totalViews',
      name: '总播放量',
      value: current.totalViews,
      unit: 'count',
      deltaPct: deltaPct(current.totalViews, previous.totalViews),
      deltaLabel: '较上一周期',
      desc:
        '窗口内全部内容被观看的总次数。一条观看记录算一次，' +
        '同一个人反复看同一个视频会重复计数——所以它是"消费量"，不是"人数"。',
    },
    {
      id: 'viewers',
      name: '独立观看用户数',
      value: current.activeUsers,
      unit: 'count',
      deltaPct: deltaPct(current.activeUsers, previous.activeUsers),
      deltaLabel: '较上一周期',
      desc:
        '窗口内看过至少 1 个视频的用户，跨天去重后计数（COUNT(DISTINCT user_id)）。' +
        '它和总播放量的比值，就是这个窗口里平均每人看了几条。',
    },
    {
      id: 'avgMinutes',
      name: '人均观看时长',
      value: curMinutes,
      unit: 'duration',
      deltaPct: deltaPct(curMinutes, prevMinutes),
      deltaLabel: '较上一周期',
      desc:
        '总观看时长 ÷（日均活跃用户数 × 天数），即平均每个活跃用户每天看多久。' +
        '口径与首页、用户分析页完全一致，三个页面的这个数字可以直接比。',
    },
    {
      id: 'engageRate',
      name: '整体互动率',
      value: ratePct(curInteractions, current.totalViews),
      unit: 'percent',
      deltaPct: deltaPct(
        ratePct(curInteractions, current.totalViews),
        ratePct(prevInteractions, previous.totalViews),
      ),
      deltaLabel: '较上一周期',
      desc:
        '（点赞 + 收藏 + 评论 + 分享）的次数 ÷ 播放次数。' +
        '分子是【行为次数】不是人数：一个人又赞又藏，在这里算 2 次互动，不是 2 个人。',
    },
    {
      id: 'categoryCount',
      name: '内容类别数',
      value: categoriesWithData,
      unit: 'count',
      // 分区数是全站固定定义的，不随窗口变，所以不给环比
      deltaLabel: `全站固定 ${CATEGORIES.length} 个分区 · 本窗口 ${categoriesWithData} 个有观看记录`,
      desc:
        '当前纳入分析的内容分区数量。分区定义是全站统一的，' +
        '与用户分析页的「年龄 × 内容偏好」用的是同一套 CATEGORIES。',
    },
  ]

  const categories = buildCategoryStats(current)

  return {
    days,
    rangeLabel: `${current.startDate} ~ ${current.endDate}`,
    kpis,
    categories,
    matrix: buildMatrix(categories),
    sample: {
      views: current.totalViews,
      viewers: current.activeUsers,
      days: current.days,
      categoriesWithData,
    },
  }
}

/* ---------------------------------------------------------------
   八、用户 × 内容分析页
   ---------------------------------------------------------------
   数据链路：
     用户(users) ──age──▶ 年龄段
        │
     user_id
        │
     观看记录(video_views) ──▶ 次数 / 秒数 / 四种互动
        │
     video_id
        │
     视频(videos) ──category──▶ 内容分区

   上面这条链路在 metrics.ts 里已经跑完了，结果是 byAgeCategory 那 32 个格子
   （4 个年龄段 × 8 个分区），每个格子里有：播放次数、观看秒数、四种互动次数、
   完播次数，以及【独立观看用户数】。

   这一层要做的事只有一件：把 32 个格子重新摆成页面要的几种形状。

   ★ 全页所有指标的分母，都必须是【独立观看用户数】那一类去重后的人数，
     绝不能用播放次数。两者的差别见下面每个 ratePct 的注释。
   --------------------------------------------------------------- */

/**
 * 32 个「年龄段 × 分区」组合里的一个，带上全部分派生指标。
 * 这是整个用户 × 内容分析唯一的基础数据形状——后面所有图表、表格、洞察都从它来。
 */
export interface UserContentCell {
  age: AgeGroupId
  ageLabel: string
  category: CategoryName
  /** 分区在固定配色表里的序号，图表上色用 */
  slot: number

  // —— 原始量 ——
  /** 独立观看用户数（该年龄段里看过这个分区的人，跨天去重） */
  viewers: number
  /** 播放次数 */
  views: number
  /** 观看总秒数 */
  seconds: number

  // —— 派生指标（分母口径都写在注释里）——
  /**
   * 用户覆盖率(%) = 该格子独立观看用户数 ÷ 【该年龄段窗口内总观看用户数】
   * 分母不是"全站用户数"，也不是"播放次数"。
   * 含义：这个年龄段里，有百分之多少的人看过这个分区。
   */
  coverageRate: number
  /**
   * 偏好占比(%) = 该格子播放次数 ÷ 【该年龄段全部 8 个分区的播放次数之和】
   * 行内归一化，四个年龄段加总都是 100%。用来横向比"更爱看哪个"，
   * 不受各年龄段人数多少的影响。
   */
  preferShare: number
  /** 人均观看次数 = 播放次数 ÷ 独立观看用户数（看过的人平均一共看了几条） */
  viewsPerViewer: number
  /** 人均观看时长(分) = 总秒数 ÷ 独立观看用户数（看过的人一共看了多久） */
  minutesPerViewer: number
  /** 单次观看时长(分) = 总秒数 ÷ 播放次数（平均点开一次看多久） */
  avgMinutes: number
  /** 完播率(%) = 高完成度观看次数 ÷ 播放次数 */
  completedRate: number
  likeRate: number
  favoriteRate: number
  commentRate: number
  shareRate: number
  /** 综合互动率(%) = (赞+藏+评+享) ÷ 播放次数。分子是【行为次数】不是人数 */
  engageRate: number
}

/** 某个年龄段的偏好排名（模块 2 用） */
export interface AgePreferenceRow {
  age: AgeGroupId
  ageLabel: string
  /** 该年龄段窗口内的独立观看用户数（覆盖率的分母） */
  viewers: number
  /** 该年龄段窗口内的总播放次数 */
  totalViews: number
  /** 该年龄段的 8 个分区，已按偏好占比降序排好 */
  ranking: UserContentCell[]
}

/** 「内容 → 谁在看」的一行（模块 3 用） */
export interface ContentStructureRow {
  category: CategoryName
  slot: number
  /** 该分区的独立观看用户数（全年龄段） */
  viewers: number
  totalViews: number
  /** 各年龄段在这个分区里的占比，四段加起来 = 100% */
  segments: { age: AgeGroupId; ageLabel: string; share: number; viewers: number }[]
}

/** 机会矩阵里的一个气泡：一个「年龄段 × 分区」组合 */
export interface OpportunityPoint {
  age: AgeGroupId
  ageLabel: string
  category: CategoryName
  slot: number
  /** 横轴：消费深度（人均观看时长，分钟） */
  x: number
  /** 纵轴：用户覆盖率(%) —— 用比例而不是绝对人数，四个面板才能横向比 */
  y: number
  /** 气泡大小：综合互动率(%) */
  size: number
  /** 悬停明细 */
  viewers: number
  coverageRate: number
  minutesPerViewer: number
  engageRate: number
  /** 落在哪个象限 */
  quadrant: OpportunityQuadrantKey
}

export type OpportunityQuadrantKey = 'core' | 'traffic' | 'potential' | 'weak'

export interface OpportunityQuadrantDef {
  key: OpportunityQuadrantKey
  label: string
  desc: string
  /** 落在这一象限的组合，格式「年龄段 · 分区」 */
  members: string[]
}

/** 一个年龄段的面板（模块 6 画四张小图，每张一个面板） */
export interface OpportunityPanel {
  age: AgeGroupId
  ageLabel: string
  points: OpportunityPoint[]
}

export interface OpportunityData {
  /** 四个年龄段各一张 */
  panels: OpportunityPanel[]
  /** 全部 32 个组合 */
  allPoints: OpportunityPoint[]
  /** 分界线的位置（全部 32 个组合的中位数） */
  xMedian: number
  yMedian: number
  xMax: number
  yMax: number
  quadrants: OpportunityQuadrantDef[]
}

/** 推荐策略模拟（模块 7）：某个年龄段的推荐结果 + 理由 */
export interface AgeStrategy {
  age: AgeGroupId
  ageLabel: string
  top: {
    rank: number
    category: CategoryName
    slot: number
    preferShare: number
    minutesPerViewer: number
    engageRate: number
    coverageRate: number
    viewers: number
  }[]
  /** 由实际数据拼出来的推荐理由，不是固定文案 */
  reasons: string[]
}

const OPPORTUNITY_QUADRANTS: Omit<OpportunityQuadrantDef, 'members'>[] = [
  {
    key: 'core',
    label: '核心用户 × 内容组合',
    desc: '覆盖率高、看得也深。这是平台的基本盘，值得优先保障供给。',
  },
  {
    key: 'traffic',
    label: '流量型内容',
    desc: '看的人多，但停留浅。适合做入口和拉新，不适合承担深度消费。',
  },
  {
    key: 'potential',
    label: '潜力垂类',
    desc: '覆盖的人相对少，但一旦看就很投入。适合通过精准推荐扩大覆盖。',
  },
  {
    key: 'weak',
    label: '弱匹配组合',
    desc: '覆盖和深度都靠后。要么内容供给不足，要么这个人群本来就不吃这套。',
  },
]

/**
 * 把 32 个格子组装成整页数据。
 *
 * 关于「偏好集中度」这个 KPI 的口径：
 *   对每个年龄段，把 8 个分区的偏好占比各自平方后加总，得到一个 0~1 的数
 *   （统计学里叫赫芬达尔指数 HHI）。再把 4 个年龄段取平均。
 *   算式的含义：如果 8 个分区完全平均，每份 12.5%，平方和 = 8 × 0.125² = 12.5%；
 *   如果全都挤在一个分区，平方和 = 100%。
 *   所以这个数字越大 = 该年龄段的兴趣越集中、越"偏科"。
 */
export function getUserContentAnalytics(days: number): UserContentAnalytics {
  const { current, previous } = getWindowPair(days)

  const cells = buildUserContentCells(current)

  const preferenceByAge = buildPreferenceByAge(cells, current)
  const structure = buildContentStructure(cells, current)
  const opportunity = buildOpportunity(cells)

  const preferHeatmap = buildPreferHeatmap(cells, current)
  const depthHeatmap = buildDepthHeatmap(cells, current)
  const engageHeatmap = buildEngageHeatmap(cells, current)

  const views = current.totalViews
  const prevViews = previous.totalViews
  const viewers = current.activeUsers
  const prevViewers = previous.activeUsers

  // TOP 内容用户覆盖率：覆盖用户最多的那个分区，占了全部观看用户的百分之多少
  let topCategory = CATEGORIES[0]
  let topViewers = -1
  let lowCategory = CATEGORIES[0]
  let lowViewers = Number.POSITIVE_INFINITY
  for (const c of CATEGORIES) {
    const v = current.byCategory[c].viewers
    if (v > topViewers) {
      topViewers = v
      topCategory = c
    }
    if (v < lowViewers) {
      lowViewers = v
      lowCategory = c
    }
  }
  const topCoverage = ratePct(topViewers, viewers)

  const concentration = averageConcentration(cells)

  const kpis: Kpi[] = [
    {
      id: 'viewers',
      name: '覆盖用户数',
      value: viewers,
      unit: 'count',
      deltaPct: deltaPct(viewers, prevViewers),
      deltaLabel: '较上一周期',
      desc:
        '窗口内产生过观看行为的独立用户数，跨天去重（COUNT(DISTINCT user_id)）。' +
        '它是这一页所有「覆盖率」类指标的分母。',
    },
    {
      id: 'categoryCount',
      name: '内容类别数',
      value: CATEGORIES.length,
      unit: 'count',
      deltaLabel: `全站固定 ${CATEGORIES.length} 个分区 · 与用户分析、内容分析同一套定义`,
      desc:
        '这一页分析的内容分区数量。分区定义全站统一，' +
        '所以这里的 8 个列可以直接和用户分析页的热力图对照着看。',
    },
    {
      id: 'topCoverage',
      name: 'TOP内容用户覆盖率',
      value: topCoverage,
      unit: 'percent',
      deltaLabel: `覆盖最广：${topCategory} ${formatCount(topViewers)} 人 · 最窄：${lowCategory} ${formatCount(lowViewers)} 人`,
      desc:
        `覆盖用户最多的分区（${topCategory}）的独立观看用户数 ÷ 全部观看用户数。` +
        `本窗口八个分区的覆盖人数在 ${formatCount(lowViewers)} ~ ${formatCount(topViewers)} 之间——` +
        '差距越小，说明用户越"什么都看"，没有哪个分区真的小众。',
    },
    {
      id: 'concentration',
      name: '用户偏好集中度',
      value: concentration,
      unit: 'percent',
      deltaLabel: '口径：各年龄段 8 个分区占比的平方和，再取四段平均',
      desc:
        '衡量各年龄段的口味是"偏科"还是"什么都看"。' +
        '八个分区完全平均分配时是 12.5%，全挤在一个分区时是 100%。' +
        '数值越高说明该年龄段越集中在少数几个分区上。',
    },
  ]

  return {
    days,
    rangeLabel: `${current.startDate} ~ ${current.endDate}`,
    kpis,
    cells,
    preferenceByAge,
    structure,
    preferHeatmap,
    depthHeatmap,
    engageHeatmap,
    opportunity,
    insights: buildUserContentInsights(cells, opportunity, preferenceByAge),
    actions: buildUserContentActions(cells, opportunity, preferenceByAge),
    sample: {
      views,
      viewers,
      days: current.days,
      combos: cells.length,
      combosWithData: cells.filter((c) => c.views > 0).length,
    },
  }
}

export interface UserContentAnalytics {
  days: number
  rangeLabel: string
  kpis: Kpi[]
  /** 全部 32 个组合（4 年龄段 × 8 分区），明细表和筛选都基于它 */
  cells: UserContentCell[]
  /** 模块 2：各年龄段的偏好排名 */
  preferenceByAge: AgePreferenceRow[]
  /** 模块 3：内容 → 谁在看 */
  structure: ContentStructureRow[]
  /** 模块 1：年龄 × 内容偏好热力图 */
  preferHeatmap: HeatmapData
  /** 模块 4：年龄 × 内容消费深度热力图 */
  depthHeatmap: HeatmapData
  /** 模块 5：年龄 × 内容互动热力图 */
  engageHeatmap: HeatmapData
  /** 模块 6：用户 × 内容机会矩阵 */
  opportunity: OpportunityData
  /** 核心发现（由数据生成，不是写死的文案） */
  insights: { tag: string; text: string }[]
  /** 业务建议（由数据生成） */
  actions: { tag: string; text: string }[]
  sample: {
    views: number
    viewers: number
    days: number
    combos: number
    combosWithData: number
  }
}

/* ---- 下面是把 32 个格子算出来的每一步，每一步都单独成函数，方便对照 ---- */

/** 第 1 步：把 metrics 给的 32 个格子，算成一格一格的完整指标 */
function buildUserContentCells(w: WindowSummary): UserContentCell[] {
  const out: UserContentCell[] = []

  for (const age of AGE_GROUP_IDS) {
    // 该年龄段窗口内的独立观看用户数 —— 覆盖率的分母
    const ageViewers = w.activeUsersByAge[age]

    // 该年龄段 8 个分区的播放次数之和 —— 偏好占比的分母
    let ageTotalViews = 0
    for (const c of CATEGORIES) ageTotalViews += w.byAgeCategory[age][c].views

    for (const category of CATEGORIES) {
      const cell = w.byAgeCategory[age][category]
      const interactions = cell.likes + cell.favorites + cell.comments + cell.shares

      out.push({
        age,
        ageLabel: ageGroupLabel(age),
        category,
        slot: categorySlot(category),

        viewers: cell.viewers,
        views: cell.views,
        seconds: cell.seconds,

        // 注意这三个分母各不相同，注释写在 UserContentCell 的定义里了
        coverageRate: ratePct(cell.viewers, ageViewers),
        preferShare: ratePct(cell.views, ageTotalViews),
        viewsPerViewer: cell.viewers > 0 ? cell.views / cell.viewers : 0,
        minutesPerViewer: cell.viewers > 0 ? cell.seconds / 60 / cell.viewers : 0,
        avgMinutes: cell.views > 0 ? cell.seconds / 60 / cell.views : 0,

        completedRate: ratePct(cell.completed, cell.views),
        likeRate: ratePct(cell.likes, cell.views),
        favoriteRate: ratePct(cell.favorites, cell.views),
        commentRate: ratePct(cell.comments, cell.views),
        shareRate: ratePct(cell.shares, cell.views),
        engageRate: ratePct(interactions, cell.views),
      })
    }
  }

  return out
}

/** 第 2 步：按年龄段分组并排名 */
function buildPreferenceByAge(cells: UserContentCell[], w: WindowSummary): AgePreferenceRow[] {
  return AGE_GROUP_IDS.map((age) => {
    const mine = cells.filter((c) => c.age === age)
    let totalViews = 0
    for (const c of mine) totalViews += c.views
    return {
      age,
      ageLabel: ageGroupLabel(age),
      viewers: w.activeUsersByAge[age],
      totalViews,
      ranking: [...mine].sort((a, b) => b.preferShare - a.preferShare),
    }
  })
}

/** 第 3 步：反过来，按分区分组，看每个分区由哪些年龄段构成 */
function buildContentStructure(cells: UserContentCell[], w: WindowSummary): ContentStructureRow[] {
  return CATEGORIES.map((category) => {
    const mine = cells.filter((c) => c.category === category)
    let totalViews = 0
    for (const c of mine) totalViews += c.views
    return {
      category,
      slot: categorySlot(category),
      // 分区的独立观看用户数取 metrics 已经去重好的那一份
      // （不能把四个年龄段的人数相加，同一个人不会跨年龄段，这里其实相等，
      //   但用去重后的权威值更稳妥）
      viewers: w.byCategory[category].viewers,
      totalViews,
      segments: mine.map((c) => ({
        age: c.age,
        ageLabel: c.ageLabel,
        share: ratePct(c.views, totalViews),
        viewers: c.viewers,
      })),
    }
  })
}

/** 第 4 步：机会矩阵。四个年龄段各一张面板，共用同一套坐标轴和分界线 */
function buildOpportunity(cells: UserContentCell[]): OpportunityData {
  // 分界线画在【全部 32 个组合】的中位数上，而不是每张面板各自的中位数。
  // 为什么？四张小图的意义就在于横向对比——如果每张图各画各的线，
  // 「18-24 的游戏」和「40+ 的游戏」落点就没法直接比了。
  const xMedian = median(cells.map((c) => c.minutesPerViewer))
  const yMedian = median(cells.map((c) => c.coverageRate))

  const points: OpportunityPoint[] = cells.map((c) => ({
    age: c.age,
    ageLabel: c.ageLabel,
    category: c.category,
    slot: c.slot,
    x: c.minutesPerViewer,
    y: c.coverageRate,
    size: c.engageRate,
    viewers: c.viewers,
    coverageRate: c.coverageRate,
    minutesPerViewer: c.minutesPerViewer,
    engageRate: c.engageRate,
    quadrant: quadrantOf(c.minutesPerViewer, c.coverageRate, xMedian, yMedian),
  }))

  const quadrants: OpportunityQuadrantDef[] = OPPORTUNITY_QUADRANTS.map((q) => ({
    ...q,
    members: points.filter((p) => p.quadrant === q.key).map((p) => `${p.ageLabel} · ${p.category}`),
  }))

  return {
    panels: AGE_GROUP_IDS.map((age) => ({
      age,
      ageLabel: ageGroupLabel(age),
      points: points.filter((p) => p.age === age),
    })),
    allPoints: points,
    xMedian,
    yMedian,
    xMax: Math.max(...points.map((p) => p.x), 1) * 1.18,
    yMax: Math.max(...points.map((p) => p.y), 1) * 1.15,
    quadrants,
  }
}

/** 判断一个组合落在哪个象限：右上=核心，右下=流量，左上=潜力，左下=弱匹配 */
function quadrantOf(
  x: number,
  y: number,
  xMedian: number,
  yMedian: number,
): OpportunityQuadrantKey {
  const deep = x >= xMedian
  const wide = y >= yMedian
  if (deep && wide) return 'core'
  if (!deep && wide) return 'traffic'
  if (deep && !wide) return 'potential'
  return 'weak'
}

/**
 * 偏好集中度：每个年龄段把 8 个占比平方后加总，再对 4 个年龄段取平均。
 * 用播放次数占比算（不是人数占比），因为要衡量的是"注意力花在哪"。
 */
function averageConcentration(cells: UserContentCell[]): number {
  const perAge: number[] = []
  for (const age of AGE_GROUP_IDS) {
    const mine = cells.filter((c) => c.age === age)
    let total = 0
    for (const c of mine) total += c.views
    if (total <= 0) continue
    let sumSquares = 0
    for (const c of mine) {
      const share = c.views / total
      sumSquares += share * share
    }
    perAge.push(sumSquares)
  }
  if (perAge.length === 0) return 0
  return (perAge.reduce((a, b) => a + b, 0) / perAge.length) * 100
}

/* ---- 三张热力图：形状完全一样，只是格子里放不同的指标 ---- */

function buildPreferHeatmap(cells: UserContentCell[], w: WindowSummary): HeatmapData {
  return buildMetricHeatmap(
    cells,
    (c) => c.preferShare,
    (c) => `${c.preferShare.toFixed(1)}%`,
    (c) => [
      { label: '偏好占比', value: `${c.preferShare.toFixed(1)}%` },
      { label: '播放量', value: `${formatCount(c.views)} 次` },
      { label: '观看用户', value: `${formatCount(c.viewers)} 人` },
      { label: '用户覆盖率', value: `${c.coverageRate.toFixed(1)}%` },
    ],
    '颜色 = 该年龄段观看量占比',
    (max) => `${max.toFixed(1)}%`,
  )
}

function buildDepthHeatmap(cells: UserContentCell[], w: WindowSummary): HeatmapData {
  return buildMetricHeatmap(
    cells,
    (c) => c.minutesPerViewer,
    (c) => `${c.minutesPerViewer.toFixed(0)}分`,
    (c) => [
      { label: '人均观看时长', value: `${c.minutesPerViewer.toFixed(1)} 分钟` },
      { label: '单次观看时长', value: `${c.avgMinutes.toFixed(1)} 分钟` },
      { label: '人均观看次数', value: `${c.viewsPerViewer.toFixed(2)} 次` },
      { label: '完播率', value: `${c.completedRate.toFixed(1)}%` },
    ],
    '颜色 = 人均观看时长（分）',
    (max) => `${max.toFixed(0)} 分`,
  )
}

function buildEngageHeatmap(cells: UserContentCell[], w: WindowSummary): HeatmapData {
  return buildMetricHeatmap(
    cells,
    (c) => c.engageRate,
    (c) => `${c.engageRate.toFixed(1)}%`,
    (c) => [
      { label: '综合互动率', value: `${c.engageRate.toFixed(1)}%` },
      { label: '点赞率', value: `${c.likeRate.toFixed(1)}%` },
      { label: '收藏率', value: `${c.favoriteRate.toFixed(1)}%` },
      { label: '评论率', value: `${c.commentRate.toFixed(1)}%` },
      { label: '分享率', value: `${c.shareRate.toFixed(1)}%` },
    ],
    '颜色 = 综合互动率（赞+藏+评+享 ÷ 播放量）',
    (max) => `${max.toFixed(1)}%`,
  )
}

/**
 * 三张热力图共用的组装逻辑。
 * 形状固定是 4 行 × 8 列，变的是：用哪个数上色、格子上写什么、悬停显示什么。
 */
function buildMetricHeatmap(
  cells: UserContentCell[],
  valueOf: (c: UserContentCell) => number,
  textOf: (c: UserContentCell) => string,
  detailOf: (c: UserContentCell) => { label: string; value: string }[],
  legendLabel: string,
  legendMaxText: (max: number) => string,
): HeatmapData {
  let max = 0
  const rows: HeatmapRow[] = AGE_GROUP_IDS.map((age) => {
    const mine = cells.filter((c) => c.age === age)
    let totalViews = 0
    for (const c of mine) totalViews += c.views

    const rowCells: HeatmapCell[] = CATEGORIES.map((category) => {
      const cell = mine.find((c) => c.category === category)!
      const value = valueOf(cell)
      if (value > max) max = value
      return {
        category,
        share: value,
        text: textOf(cell),
        detail: detailOf(cell),
        views: cell.views,
      }
    })

    return { id: age, label: ageGroupLabel(age), totalViews, cells: rowCells }
  })

  let peak: HeatmapData['peak'] = null
  for (const row of rows) {
    for (const cell of row.cells) {
      if (!peak || cell.share > peak.share) {
        peak = { age: row.id, category: cell.category, share: cell.share }
      }
    }
  }

  return {
    rows,
    categories: CATEGORIES,
    shareMax: max || 1,
    legendLabel,
    legendMaxText: legendMaxText(max),
    peak,
  }
}

/* ---- 模块 7：推荐策略模拟 ---- */

/**
 * 给定年龄段，算出推荐内容 TOP3 和推荐理由。
 * 理由的每一句都是拿这个年龄段的真实数字拼出来的，没有一句是写死的文案。
 */
export function getAgeStrategy(days: number, age: AgeGroupId): AgeStrategy {
  const all = getUserContentAnalytics(days)
  const mine = all.cells.filter((c) => c.age === age)

  // 推荐排序依据：先看偏好占比（这个人群把注意力花在哪），
  // 占比接近时再看消费深度。这样避免把"点了就走"的分区推上去。
  const sorted = [...mine].sort(
    (a, b) => b.preferShare - a.preferShare || b.minutesPerViewer - a.minutesPerViewer,
  )

  const top = sorted.slice(0, 3).map((c, i) => ({
    rank: i + 1,
    category: c.category,
    slot: c.slot,
    preferShare: c.preferShare,
    minutesPerViewer: c.minutesPerViewer,
    engageRate: c.engageRate,
    coverageRate: c.coverageRate,
    viewers: c.viewers,
  }))

  const reasons: string[] = []
  const first = top[0]
  const others = mine.filter((c) => c.category !== first.category)

  if (first) {
    reasons.push(
      `该年龄段把 ${first.preferShare.toFixed(1)}% 的观看量花在了${first.category}上，` +
        `是八个分区里最高的；看过的人平均停留 ${first.minutesPerViewer.toFixed(1)} 分钟，` +
        `综合互动率 ${first.engageRate.toFixed(1)}%。`,
    )
  }

  // 拿第一名和「其余分区的平均值」比，才知道它到底领先多少
  if (first && others.length > 0) {
    const avgShare = others.reduce((s, c) => s + c.preferShare, 0) / others.length
    const avgMinutes = others.reduce((s, c) => s + c.minutesPerViewer, 0) / others.length
    const shareGap = first.preferShare - avgShare
    const minuteGap = first.minutesPerViewer - avgMinutes
    reasons.push(
      `和其余七个分区的平均水平比：偏好占比高 ${shareGap.toFixed(1)} 个百分点，` +
        `人均观看时长${minuteGap >= 0 ? '多' : '少'} ${Math.abs(minuteGap).toFixed(1)} 分钟。` +
        (minuteGap >= 0
          ? '既爱看又看得深，属于这个人群的稳定基本盘。'
          : '看得多但停留不算深，更适合作为引流入口而不是深度内容。'),
    )
  }

  /*
    找一个"看的人相对少、但一旦看就很投入"的分区，作为可以尝试扩量的对象。

    ⚠️ 这里必须设一个【最小差距门槛】。
    第一版只判断"覆盖率低于中位数"，结果在某个人群里跑出了
    「科技只有 98.7% 的人看过（低于中位数 98.8%）」这种理由——
    差 0.1 个百分点，根本不是"曝光不足"，是噪声。
    所以现在要求：覆盖率至少比中位数低 5 个百分点，才算真的没铺开。
    没有任何分区满足时，就如实说"没有明显漏掉的人群"，而不是硬凑一条。
  */
  const MIN_COVERAGE_GAP = 5 // 百分点
  const depthMedian = median(mine.map((c) => c.minutesPerViewer))
  const coverMedian = median(mine.map((c) => c.coverageRate))
  const potential = mine
    .filter(
      (c) =>
        c.minutesPerViewer >= depthMedian && coverMedian - c.coverageRate >= MIN_COVERAGE_GAP,
    )
    .sort((a, b) => b.minutesPerViewer - a.minutesPerViewer)[0]

  if (potential) {
    reasons.push(
      `另有一个组合值得单独测：${potential.category}。这个年龄段只有 ` +
        `${potential.coverageRate.toFixed(1)}% 的人看过，比中位数低 ` +
        `${(coverMedian - potential.coverageRate).toFixed(1)} 个百分点；` +
        `但看过的人平均停留 ${potential.minutesPerViewer.toFixed(1)} 分钟，在深度中位数（${depthMedian.toFixed(1)} 分）之上。` +
        `消费深度够，缺的是曝光——适合小流量试探推荐位。`,
    )
  } else {
    reasons.push(
      `这个年龄段没有出现"看得深但没铺开"的分区：` +
        `消费深度排在前一半的分区，覆盖率也都在中位数附近（差距不足 ${MIN_COVERAGE_GAP} 个百分点），` +
        `说明现有推荐没有明显漏掉的人群。`,
    )
  }

  return { age, ageLabel: ageGroupLabel(age), top, reasons }
}

/* ---- 核心发现与业务建议：全部从数据里挑极值，不预设结论 ---- */

function buildUserContentInsights(
  cells: UserContentCell[],
  opportunity: OpportunityData,
  preferenceByAge: AgePreferenceRow[],
): { tag: string; text: string }[] {
  const out: { tag: string; text: string }[] = []
  const alive = cells.filter((c) => c.views > 0)
  if (alive.length === 0) {
    return [{ tag: '数据不足', text: '当前时间范围内没有足够的观看记录，无法生成发现。' }]
  }

  // 发现 1：谁把注意力压得最集中
  const mostConcentrated = [...preferenceByAge]
    .filter((r) => r.totalViews > 0)
    .sort((a, b) => b.ranking[0].preferShare - a.ranking[0].preferShare)[0]
  if (mostConcentrated) {
    const top1 = mostConcentrated.ranking[0]
    const top2 = mostConcentrated.ranking[1]
    const rest = mostConcentrated.ranking.slice(2)
    // 「其余几个分区是什么水平」必须算出来，不能凭印象写一句"都在 12% 以下"
    const restMax = rest.length > 0 ? Math.max(...rest.map((c) => c.preferShare)) : 0
    out.push({
      tag: '用户偏好',
      text:
        `偏好最集中的人群是${mostConcentrated.ageLabel}：他们 ${top1.preferShare.toFixed(1)}% 的观看量花在${top1.category}上` +
        (top2 ? `，第二名是${top2.category}（${top2.preferShare.toFixed(1)}%）` : '') +
        `。剩下 ${rest.length} 个分区里最高的也只有 ${restMax.toFixed(1)}%，` +
        `和第一名差 ${(top1.preferShare - restMax).toFixed(1)} 个百分点。`,
    })
  }

  // 发现 2：哪里消费得最深
  const deepest = [...alive].sort((a, b) => b.minutesPerViewer - a.minutesPerViewer)[0]
  const shallowest = [...alive].sort((a, b) => a.minutesPerViewer - b.minutesPerViewer)[0]
  out.push({
    tag: '消费深度',
    text:
      `消费最深的是${deepest.ageLabel} × ${deepest.category}：看过的人平均停留 ${deepest.minutesPerViewer.toFixed(1)} 分钟，` +
      `是全场最高。最浅的是${shallowest.ageLabel} × ${shallowest.category}，只有 ${shallowest.minutesPerViewer.toFixed(1)} 分钟，` +
      `两者相差 ${(deepest.minutesPerViewer / Math.max(shallowest.minutesPerViewer, 0.1)).toFixed(1)} 倍。`,
  })

  // 发现 3：哪里互动最强，以及它到底靠哪个行为拉起来的
  const hottest = [...alive].sort((a, b) => b.engageRate - a.engageRate)[0]
  const avgFav = alive.reduce((s, c) => s + c.favoriteRate, 0) / alive.length
  const avgLike = alive.reduce((s, c) => s + c.likeRate, 0) / alive.length
  const favGap = hottest.favoriteRate - avgFav
  const likeGap = hottest.likeRate - avgLike
  // 哪个行为的领先幅度更大，就把它写进结论，而不是默认"收藏率最高"
  const leadAction = favGap >= likeGap ? '收藏' : '点赞'
  const leadGap = Math.max(favGap, likeGap)
  out.push({
    tag: '互动',
    text:
      `互动率最高的组合是${hottest.ageLabel} × ${hottest.category}（${hottest.engageRate.toFixed(1)}%），` +
      `点赞率 ${hottest.likeRate.toFixed(1)}%、收藏率 ${hottest.favoriteRate.toFixed(1)}%。` +
      `拉高它的主要是${leadAction}：比全部 32 个组合的平均${leadAction}率（${(leadAction === '收藏' ? avgFav : avgLike).toFixed(1)}%）` +
      `高 ${leadGap.toFixed(1)} 个百分点。` +
      (leadAction === '收藏'
        ? '收藏意味着"以后还要看"，这个组合的用户是把它当资料在存。'
        : '点赞是即时反应，说明内容在这个人群里"一看就懂、当场认可"。'),
  })

  // 发现 4：机会在哪
  const potential = opportunity.quadrants.find((q) => q.key === 'potential')
  const core = opportunity.quadrants.find((q) => q.key === 'core')
  out.push({
    tag: '机会',
    text:
      `全部 32 个组合里，${core?.members.length ?? 0} 个落在「核心用户×内容组合」，` +
      `${potential?.members.length ?? 0} 个落在「潜力垂类」。` +
      (potential && potential.members.length > 0
        ? `潜力组合是：${potential.members.slice(0, 4).join('、')}${potential.members.length > 4 ? ' 等' : ''}——覆盖不算最广，但看过的人停留明显更久。`
        : '本窗口没有出现"覆盖低但深度高"的组合。'),
  })

  return out
}

function buildUserContentActions(
  cells: UserContentCell[],
  opportunity: OpportunityData,
  preferenceByAge: AgePreferenceRow[],
): { tag: string; text: string }[] {
  const out: { tag: string; text: string }[] = []
  const alive = cells.filter((c) => c.views > 0)
  if (alive.length === 0) {
    return [{ tag: '暂无建议', text: '当前时间范围内没有足够的观看记录，无法给出建议。' }]
  }

  const core = opportunity.quadrants.find((q) => q.key === 'core')!
  const potential = opportunity.quadrants.find((q) => q.key === 'potential')!

  const coreList = core.members.slice(0, 3).join('、')
  out.push({
    tag: '内容供给',
    text:
      `守住 ${core.members.length} 个核心组合（${coreList}${core.members.length > 3 ? ' 等' : ''}）。` +
      `这些组合的用户覆盖率和消费深度都在中位数以上，是平台的基本盘——` +
      `供给一旦减少，掉的不只是播放量，还有停留时长。`,
  })

  if (potential.members.length > 0) {
    out.push({
    tag: '推荐策略',
      text:
        `把 ${potential.members.length} 个潜力组合（${potential.members.slice(0, 3).join('、')}${potential.members.length > 3 ? ' 等' : ''}）` +
        `放进小流量推荐位测试。它们的消费深度已经在中位数之上，卡在覆盖率上——` +
        `这是曝光问题，不是内容问题，值得用推荐位换覆盖。`,
    })
  }

  // 找覆盖率最高、但深度垫底的那一档：典型"流量型内容"
  const traffic = opportunity.quadrants.find((q) => q.key === 'traffic')
  if (traffic && traffic.members.length > 0) {
    const trafficCells = alive
      .filter((c) => traffic.members.includes(`${c.ageLabel} · ${c.category}`))
      .sort((a, b) => b.coverageRate - a.coverageRate)
    const pick = trafficCells[0]
    if (pick) {
      out.push({
        tag: '消费深度',
        text:
          `${pick.ageLabel}的${pick.category}覆盖率有 ${pick.coverageRate.toFixed(1)}%，` +
          `但人均只停留 ${pick.minutesPerViewer.toFixed(1)} 分钟。` +
          `这类组合适合放在首屏做入口拉新，不要指望它承担停留时长——` +
          `把它当深度内容运营会浪费资源。`,
      })
    }
  }

  // 找最"偏科"的年龄段，给分人群运营建议
  const mostConcentrated = [...preferenceByAge]
    .filter((r) => r.totalViews > 0)
    .sort((a, b) => b.ranking[0].preferShare - a.ranking[0].preferShare)[0]
  if (mostConcentrated) {
    const top1 = mostConcentrated.ranking[0]
    const last = mostConcentrated.ranking[mostConcentrated.ranking.length - 1]
    out.push({
      tag: '分人群运营',
      text:
        `${mostConcentrated.ageLabel}的偏好最集中（${top1.category} 占 ${top1.preferShare.toFixed(1)}%），` +
        `对${last.category}最不感冒（${last.preferShare.toFixed(1)}%）。` +
        `给这个人群做推荐时，应该把${top1.category}放在首位；` +
        `强行推${last.category}的转化效率会明显偏低。`,
    })
  }

  return out.slice(0, 4)
}
