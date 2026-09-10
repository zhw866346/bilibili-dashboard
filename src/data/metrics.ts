/* ==========================================================================
   指标计算
   --------------------------------------------------------------------------
   这个文件回答一个问题：**从 28 万条观看明细，怎么算出页面上的数字？**

   做法分两步：

   第 1 步 —— 建「按天索引」（buildDayIndex）
     把 28 万条明细扫一遍，按"天"汇总成 30 个桶。
     每个桶里记着：这天有多少人活跃、看了多少次、看了多少秒、
     以及 年龄段 × 内容分区 的交叉统计。
     为什么要先做这一步？因为如果每次切换时间范围都重扫 28 万条，页面会卡。
     先汇总好，切范围时只要把最后 N 个桶加起来就行，瞬间完成。

   第 2 步 —— 切时间窗口（sliceWindow）
     把最后 N 天的桶相加，得到"近 N 天"的全部指标。

   —— 对应到 SQL，第 1 步类似建一张按天的汇总表，
      第 2 步类似对汇总表做 WHERE date >= ... 的查询。
   ========================================================================== */

import type { AgeGroupId, CategoryName, Dataset, TrendPoint } from '../types'
import { AGE_GROUP_IDS, ageGroupOf } from '../utils/ageGroup'
import { CATEGORIES } from '../utils/categories'
import { getDataset } from './dataset'

/**
 * 「完播」的判定门槛。
 * 一次观看的实际秒数 ≥ 视频总时长 × 0.8，就算一次「高完成度观看」。
 * 用比例而不是绝对秒数，是因为各分区视频长短差很多（音乐 5 分钟、影视 45 分钟），
 * 用绝对秒数的话短视频分区会被无脑判成"完播"。
 * ⚠️ 但即便如此，短视频分区的完播率天然就比长视频高——这不是内容质量问题，
 *    是时长的数学必然，页面上必须把这句话写出来。
 */
export const COMPLETION_THRESHOLD = 0.8

/** 一个格子：某年龄段看某分区的汇总 */
export interface CategoryCell {
  /** 观看次数 */
  views: number
  /** 观看总秒数 */
  seconds: number
  likes: number
  favorites: number
  comments: number
  shares: number
  /** 高完成度观看次数（实际时长 ÷ 视频时长 ≥ COMPLETION_THRESHOLD） */
  completed: number
}

function emptyCell(): CategoryCell {
  return {
    views: 0,
    seconds: 0,
    likes: 0,
    favorites: 0,
    comments: 0,
    shares: 0,
    completed: 0,
  }
}

/**
 * 窗口内某个分区的全套汇总（内容分析页用）。
 * 和上面的 CategoryCell 比，多了两个"跨天去重/累计"后才成立的字段：
 *   viewers   —— 窗口内看过该分区的去重用户数
 *   completed —— 窗口内该分区的高完成度观看次数
 */
export interface CategoryWindowCell {
  views: number
  seconds: number
  likes: number
  favorites: number
  comments: number
  shares: number
  completed: number
  /** 独立观看用户数（窗口内跨天去重） */
  viewers: number
}

/**
 * 窗口级的「年龄段 × 分区」格子（用户×内容分析页用）。
 *
 * 它比上面的 CategoryCell 只多一个字段：viewers。
 * 为什么要单独定义？因为 viewers 和 views 的性质不一样：
 *   views   —— 按天累加就行（1 + 1 = 2）
 *   viewers —— 不能累加！同一个人看 5 天，跨天加会变成 5 个人。
 *              必须把 5 天的用户名单合并起来去重，才能得到 1 个人。
 * 所以这个字段只有在【切完时间窗口】之后才有值，按天的格子里没有它。
 */
export interface AgeCategoryWindowCell extends CategoryCell {
  /** 独立观看用户数（窗口内跨天去重） */
  viewers: number
}

/** 某一天的全部汇总 */
export interface DayAggregate {
  date: string
  /**
   * 当天出现过观看行为的用户编号（去重）。
   * 保留这个集合而不是只留个人数，是因为算"人均"指标时，
   * 需要把好几天的集合合并去重——同一个人连着活跃 5 天只能算 1 个人。
   */
  activeUserIds: Set<string>
  /** 当天活跃用户数（去重），按年龄段。由 activeUserIds 推出来。 */
  dauByAge: Record<AgeGroupId, number>
  /** 当天各年龄段的观看次数 */
  viewsByAge: Record<AgeGroupId, number>
  /** 当天各年龄段的观看秒数 */
  secondsByAge: Record<AgeGroupId, number>
  /** 当天 年龄段 × 分区 的交叉明细 */
  byAgeCategory: Record<AgeGroupId, Record<CategoryName, CategoryCell>>
  /**
   * 当天看过各分区的用户编号（去重）。
   * ★ 内容分析页要的「独立观看用户数」，分母必须按分区去重。
   *   为什么要存「集合」而不是直接存人数？因为要跨天合并——
   *   同一个人连着 5 天看游戏，整个窗口里只能算 1 个人。
   *   集合留到切窗口的时候再合并去重，才能得到窗口级的准确人数。
   */
  viewersByCategory: Record<CategoryName, Set<string>>
  /**
   * 当天看过「某年龄段 × 某分区」的用户编号（去重）。
   * ★ 用户×内容分析页的每个指标，分母都是这个集合的人数。
   *   和 viewersByCategory 是同一批明细的两种切法——
   *   把这里 4 个年龄段的集合求并集，正好等于 viewersByCategory 那一个集合
   *   （因为一个用户只属于一个年龄段）。验证脚本里拿这条恒等式对过账。
   */
  viewersByAgeCategory: Record<AgeGroupId, Record<CategoryName, Set<string>>>
  /** 当天产生过至少一次互动的用户编号（去重） */
  engagedUserIds: Set<string>
}

function emptyByAge<T>(factory: (id: AgeGroupId) => T): Record<AgeGroupId, T> {
  const out = {} as Record<AgeGroupId, T>
  for (const id of AGE_GROUP_IDS) out[id] = factory(id)
  return out
}

/** 建一个「分区 → 空集合」的容器。按天建索引和切窗口都要用，所以放在模块级。 */
function emptyCategorySets(): Record<CategoryName, Set<string>> {
  return Object.fromEntries(CATEGORIES.map((c) => [c, new Set<string>()])) as Record<
    CategoryName,
    Set<string>
  >
}

/* ==========================================================================
   第 1 步：建按天索引
   ========================================================================== */

export function buildDayIndex(dataset: Dataset): DayAggregate[] {
  // 先把两张"字典表"建好，后面查年龄/分区就不用再遍历数组了
  const ageGroupByUser = new Map<string, AgeGroupId>()
  for (const u of dataset.users) ageGroupByUser.set(u.user_id, ageGroupOf(u.age))

  const categoryByVideo = new Map<string, CategoryName>()
  // 视频总时长，用来判断一次观看算不算"高完成度"
  const durationByVideo = new Map<string, number>()
  for (const v of dataset.videos) {
    categoryByVideo.set(v.video_id, v.category)
    durationByVideo.set(v.video_id, v.duration)
  }

  // 初始化每一天的空桶
  const days: DayAggregate[] = dataset.dates.map((date) => ({
    date,
    activeUserIds: new Set<string>(),
    dauByAge: emptyByAge(() => 0),
    viewsByAge: emptyByAge(() => 0),
    secondsByAge: emptyByAge(() => 0),
    byAgeCategory: emptyByAge(() =>
      Object.fromEntries(CATEGORIES.map((c) => [c, emptyCell()])) as Record<
        CategoryName,
        CategoryCell
      >,
    ),
    viewersByCategory: emptyCategorySets(),
    viewersByAgeCategory: emptyByAge(() => emptyCategorySets()),
    engagedUserIds: new Set<string>(),
  }))

  const dayIndex = new Map<string, number>()
  dataset.dates.forEach((d, i) => dayIndex.set(d, i))

  // ★ 核心：一次遍历，把所有能提前算的都算掉
  for (const view of dataset.views) {
    const di = dayIndex.get(view.date)
    if (di === undefined) continue

    const age = ageGroupByUser.get(view.user_id)
    const category = categoryByVideo.get(view.video_id)
    if (!age || !category) continue

    const day = days[di]

    // 去重计数：Set 里加过了就不会重复算（对应 COUNT(DISTINCT user_id)）
    day.activeUserIds.add(view.user_id)

    day.viewsByAge[age] += 1
    day.secondsByAge[age] += view.watch_seconds

    const cell = day.byAgeCategory[age][category]
    cell.views += 1
    cell.seconds += view.watch_seconds
    if (view.is_like) cell.likes += 1
    if (view.is_favorite) cell.favorites += 1
    if (view.is_comment) cell.comments += 1
    if (view.is_share) cell.shares += 1

    // 完播判定：这次看的秒数够不够视频总时长的 80%
    const duration = durationByVideo.get(view.video_id) ?? 0
    if (duration > 0 && view.watch_seconds >= duration * COMPLETION_THRESHOLD) {
      cell.completed += 1
    }

    // 去重用户（跨天合并留到切窗口时做）
    day.viewersByCategory[category].add(view.user_id)
    day.viewersByAgeCategory[age][category].add(view.user_id)

    if (view.is_like || view.is_favorite || view.is_comment || view.is_share) {
      day.engagedUserIds.add(view.user_id)
    }
  }

  // 再把每天的活跃人数按年龄段拆开
  // （年龄段互不重叠，所以各段人数加起来就等于当天总活跃人数）
  for (const day of days) {
    for (const userId of day.activeUserIds) {
      const age = ageGroupByUser.get(userId)
      if (age) day.dauByAge[age] += 1
    }
  }

  return days
}

/* ==========================================================================
   第 2 步：切时间窗口
   ========================================================================== */

/** 一个时间窗口内的全部汇总指标 */
export interface WindowSummary {
  /** 窗口天数 */
  days: number
  startDate: string
  endDate: string

  /**
   * 用户总量 = 截至【数据截止日】的累计注册用户数。
   * 这是个"存量"指标：不管你把时间范围切成 7 天还是 30 天，
   * 平台今天的用户总量都是同一个数，变的是窗口内的活跃情况。
   * 它同时也是"活跃率"的分母。
   */
  totalUsers: number
  totalUsersByAge: Record<AgeGroupId, number>
  /** 窗口期内新注册的用户数。这个会随窗口变化。 */
  newUsersInWindow: number

  /** 日均活跃用户数 = 窗口内每日活跃人数之和 ÷ 天数 */
  dau: number
  dauByAge: Record<AgeGroupId, number>
  /**
   * 窗口内去重活跃用户数（整个窗口只算一次，跨天不重复）。
   * 这是「人均」类指标的分母。
   */
  activeUsers: number
  activeUsersByAge: Record<AgeGroupId, number>

  /** 窗口内总观看次数 */
  totalViews: number
  viewsByAge: Record<AgeGroupId, number>
  /** 窗口内总观看秒数 */
  totalSeconds: number
  secondsByAge: Record<AgeGroupId, number>

  /** 窗口内产生过互动的去重用户数 */
  engagedUsers: number

  totalLikes: number
  totalFavorites: number
  totalComments: number
  totalShares: number

  /**
   * 年龄段 × 分区 交叉明细（4 × 8 = 32 个格子）。
   * 用户分析页的偏好热力图、用户×内容分析页，用的都是它。
   */
  byAgeCategory: Record<AgeGroupId, Record<CategoryName, AgeCategoryWindowCell>>
  /** 分区维度的汇总 —— 「内容分析页」用的就是它 */
  byCategory: Record<CategoryName, CategoryWindowCell>
}

/**
 * 取最后 days 天的汇总。
 * offsetDays 用来取"上一周期"——例如要算近 7 天的环比，
 * 就取 offsetDays = 7 的那一段作为对比对象。
 */
export function sliceWindow(
  index: DayAggregate[],
  dataset: Dataset,
  days: number,
  offsetDays = 0,
): WindowSummary {
  const end = index.length - offsetDays
  const start = Math.max(0, end - days)
  const slice = index.slice(start, end)
  const actualDays = slice.length || 1

  const windowStart = slice[0]?.date ?? '0000-01-01'
  // 全站的数据截止日，取数据集最后一天（而不是窗口最后一天），
  // 这样"用户总量"在 7/14/30 天之间切换时保持同一个口径。
  const dataEndDate = dataset.dates[dataset.dates.length - 1] ?? windowStart

  const totalUsersByAge = emptyByAge(() => 0)
  let totalUsers = 0
  let newUsersInWindow = 0
  for (const u of dataset.users) {
    if (u.register_date <= dataEndDate) {
      totalUsersByAge[ageGroupOf(u.age)] += 1
      totalUsers += 1
      // 注册时间落在窗口内的算"窗口内新增"
      if (u.register_date > windowStart) newUsersInWindow += 1
    }
  }

  const dauByAge = emptyByAge(() => 0)
  const viewsByAge = emptyByAge(() => 0)
  const secondsByAge = emptyByAge(() => 0)
  // 年龄段 × 分区 的累加器。数值部分按天相加，人数部分靠下面的集合去重。
  const byAgeCategory = emptyByAge(() =>
    Object.fromEntries(CATEGORIES.map((c) => [c, { ...emptyCell(), viewers: 0 }])) as Record<
      CategoryName,
      AgeCategoryWindowCell
    >,
  )
  // 「年龄段 × 分区」的去重用户，跨天合并（用户×内容分析页的分母）
  const ageCategoryViewers = emptyByAge(emptyCategorySets)

  // 分区维度的累加器（内容分析页用）
  const byCategory = Object.fromEntries(
    CATEGORIES.map((c) => [
      c,
      { views: 0, seconds: 0, likes: 0, favorites: 0, comments: 0, shares: 0, completed: 0, viewers: 0 },
    ]),
  ) as Record<CategoryName, CategoryWindowCell>
  // 分区维度的去重用户，跨天合并
  const categoryViewers = Object.fromEntries(
    CATEGORIES.map((c) => [c, new Set<string>()]),
  ) as Record<CategoryName, Set<string>>

  let totalViews = 0
  let totalSeconds = 0
  let totalLikes = 0
  let totalFavorites = 0
  let totalComments = 0
  let totalShares = 0
  const engaged = new Set<string>()
  // 窗口内的活跃用户，跨天合并去重
  const activeUsersByAgeIds = emptyByAge(() => new Set<string>())

  for (const day of slice) {
    // 把当天的活跃用户在年龄段维度上合并去重
    for (const userId of day.activeUserIds) {
      const age = getAgeGroupByUser().get(userId)
      if (age) activeUsersByAgeIds[age].add(userId)
    }

    for (const id of AGE_GROUP_IDS) {
      dauByAge[id] += day.dauByAge[id]
      viewsByAge[id] += day.viewsByAge[id]
      secondsByAge[id] += day.secondsByAge[id]

      const target = byAgeCategory[id]
      for (const c of CATEGORIES) {
        const src = day.byAgeCategory[id][c]
        const dst = target[c]
        dst.views += src.views
        dst.seconds += src.seconds
        dst.likes += src.likes
        dst.favorites += src.favorites
        dst.comments += src.comments
        dst.shares += src.shares
        dst.completed += src.completed

        // 顺手把同一个格子累加到「分区维度」
        // （按年龄段拆是为了热力图，按分区块是为了内容分析页，其实是同一批明细的两种切法）
        const cat = byCategory[c]
        cat.views += src.views
        cat.seconds += src.seconds
        cat.likes += src.likes
        cat.favorites += src.favorites
        cat.comments += src.comments
        cat.shares += src.shares
        cat.completed += src.completed
      }
    }

    // 用户去重：同一个人这一天只看过一次也算 1 个
    for (const c of CATEGORIES) {
      for (const uid of day.viewersByCategory[c]) categoryViewers[c].add(uid)
      for (const id of AGE_GROUP_IDS) {
        for (const uid of day.viewersByAgeCategory[id][c]) ageCategoryViewers[id][c].add(uid)
      }
    }

    for (const uid of day.engagedUserIds) engaged.add(uid)
  }

  // 集合合并完了，把人数落到结果上
  for (const c of CATEGORIES) byCategory[c].viewers = categoryViewers[c].size
  for (const id of AGE_GROUP_IDS) {
    for (const c of CATEGORIES) byAgeCategory[id][c].viewers = ageCategoryViewers[id][c].size
  }

  for (const id of AGE_GROUP_IDS) {
    totalViews += viewsByAge[id]
    totalSeconds += secondsByAge[id]
    for (const c of CATEGORIES) {
      const cell = byAgeCategory[id][c]
      totalLikes += cell.likes
      totalFavorites += cell.favorites
      totalComments += cell.comments
      totalShares += cell.shares
    }
  }

  // 日均活跃 = 窗口内每日活跃人数之和 ÷ 天数
  for (const id of AGE_GROUP_IDS) dauByAge[id] = dauByAge[id] / actualDays
  let dau = 0
  for (const id of AGE_GROUP_IDS) dau += dauByAge[id]

  // 窗口内去重活跃用户数
  const activeUsersByAge = emptyByAge(() => 0)
  for (const id of AGE_GROUP_IDS) activeUsersByAge[id] = activeUsersByAgeIds[id].size
  let activeUsers = 0
  for (const id of AGE_GROUP_IDS) activeUsers += activeUsersByAge[id]

  return {
    days: actualDays,
    startDate: slice[0]?.date ?? '',
    endDate: slice[slice.length - 1]?.date ?? '',
    totalUsers,
    totalUsersByAge,
    newUsersInWindow,
    dau,
    dauByAge,
    activeUsers,
    activeUsersByAge,
    totalViews,
    viewsByAge,
    totalSeconds,
    secondsByAge,
    engagedUsers: engaged.size,
    totalLikes,
    totalFavorites,
    totalComments,
    totalShares,
    byAgeCategory,
    byCategory,
  }
}

/* ==========================================================================
   缓存
   --------------------------------------------------------------------------
   索引只需要建一次。之后不管怎么切时间范围，都是在这个索引上加加减减。
   ========================================================================== */

let cachedIndex: DayAggregate[] | null = null
let cachedAgeGroupByUser: Map<string, AgeGroupId> | null = null

export function getDayIndex(): DayAggregate[] {
  if (!cachedIndex) cachedIndex = buildDayIndex(getDataset())
  return cachedIndex
}

/**
 * 取最后 days 天「每天」的活跃人数，用于画趋势图。
 * 每天的活跃人数 = 该天各年龄段活跃人数之和（年龄段互不重叠，直接相加即可）。
 */
export function dailyActiveUsers(index: DayAggregate[], days: number): TrendPoint[] {
  return index.slice(-days).map((day) => {
    let total = 0
    for (const id of AGE_GROUP_IDS) total += day.dauByAge[id]
    return { date: day.date, value: total }
  })
}

/** 用户编号 → 年龄段 的查表。只建一次。 */
function getAgeGroupByUser(): Map<string, AgeGroupId> {
  if (!cachedAgeGroupByUser) {
    cachedAgeGroupByUser = new Map()
    for (const u of getDataset().users) {
      cachedAgeGroupByUser.set(u.user_id, ageGroupOf(u.age))
    }
  }
  return cachedAgeGroupByUser
}

/* ==========================================================================
   派生指标的小工具
   ========================================================================== */

/*
   下面是「人均」指标。分母的口径最容易搞错，这里写死：

   分母 = 用户·天数 = Σ(每天的活跃人数) = 日均活跃用户数 × 天数

   ⚠️ 千万不能用「窗口内去重活跃用户数 × 天数」当分母。
   举个具体例子你就明白差别了：
     近 7 天里一共有 5560 个人活跃过，但平均每天只有 2172 人活跃。
     也就是说，很多人这 7 天里只来了两三天。
     如果分母用 5560 × 7 = 38920，就等于把"他压根没打开 App 的那几天"
     也算进了分母，人均时长会被严重稀释（算出来 15.9 分钟）。
     正确的分母是 2172 × 7 = 15204——只统计"真的来过的那些天"，
     算出来 40.7 分钟，这才是"活跃用户平均每天看多久"。
   好在年龄段互不重叠，所以各年龄段的人天加起来正好等于全站人天。
*/

/** 人均单日观看时长（分钟）= 总观看秒数 ÷（日均活跃用户数 × 天数）÷ 60 */
export function avgMinutesPerUser(
  totalSeconds: number,
  dau: number,
  days: number,
): number {
  const userDays = dau * days
  if (userDays <= 0) return 0
  return totalSeconds / userDays / 60
}

/** 人均单日观看视频数 = 总观看次数 ÷（日均活跃用户数 × 天数） */
export function avgViewsPerUser(totalViews: number, dau: number, days: number): number {
  const userDays = dau * days
  if (userDays <= 0) return 0
  return totalViews / userDays
}

/** 活跃率（%）= 日均活跃用户数 ÷ 用户总量 × 100 */
export function activeRate(dau: number, totalUsers: number): number {
  if (totalUsers <= 0) return 0
  return (dau / totalUsers) * 100
}

/** 比率（%）= 分子 ÷ 分母 × 100 */
export function ratePct(numerator: number, denominator: number): number {
  if (denominator <= 0) return 0
  return (numerator / denominator) * 100
}
