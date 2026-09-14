/* ==========================================================================
   窗口两段的「日期与星期构成」
   --------------------------------------------------------------------------
   Demo 3（哪些内容类别增长最快）和 Demo 5（哪些用户群体存在活跃度下降）
   比的都是窗口【自己内部】的前半段 vs 后半段。
   两段天数常常不等（近 7 天切出来是 3 天 vs 4 天），而且两段里的
   「周末占几天」也可能完全不同 —— 而这正是那两个排名最大的干扰源。

   这份数据里周末的日均播放量明显高于工作日（数据生成时设的 DOW_MULTIPLIER：
   周末 1.18 / 周五 1.06 / 周一至周四 1.0）。所以「后半段比前半段低」这件事，
   可能只是后半段少含几天周末，和内容本身没关系。

   ★ 为什么单独成一个文件，而不是写在结论模板里：
     页面上有三处要说这件事 —— 结论、业务洞察、图表卡片上的说明段。
     写三份迟早会出现「结论说 2 天、图上说 1 天」这种自相矛盾，
     而且这种矛盾【不会报错】，只是让人不再信任这一页。
     和 weightCompare.ts 是同一个理由。

   ★ 这里算的每一个数都来自真实数据（Pandas 的逐日结果、以及日期本身），
     没有一个是写死的。所以窗口换成 14 / 30 天时，这些话会自动跟着变。
   ========================================================================== */

import type { PyResults } from '../python/types'

/**
 * 一份「前半段 / 后半段」的日期区间与天数。
 *
 * ★ 用结构类型而不是直接收 `PyCategoryTrend`：
 *   Python 侧的 categoryTrend 和 segmentTrend 都长这个样子，
 *   这个函数只关心日期，不关心被切的是分区还是年龄段。
 *   收窄成某一个具体类型的话，第二个消费者就得把这段逻辑再抄一遍 ——
 *   而抄出来的两份迟早会说不一样的话。
 */
export interface HalfWindowSpan {
  firstStart: string
  firstEnd: string
  firstDays: number
  secondStart: string
  secondEnd: string
  secondDays: number
}

/** 两段的日期区间、天数、以及各含几个周末日 */
export interface HalfWindowMix {
  firstStart: string
  firstEnd: string
  firstDays: number
  /** 前半段里有几天是周六或周日 */
  firstWeekendDays: number
  secondStart: string
  secondEnd: string
  secondDays: number
  secondWeekendDays: number
}

/** 这一天是不是周末（周六 / 周日）。用 UTC 解析，避免本地时区把日期挪一天。 */
function isWeekend(date: string): boolean {
  const t = Date.parse(`${date}T00:00:00Z`)
  if (!Number.isFinite(t)) return false
  const dow = new Date(t).getUTCDay()
  return dow === 0 || dow === 6
}

/**
 * 从 start 数到 end（含两端），一共几天、其中几天是周末。
 *
 * ★ 天数不直接拿 firstDays 用，而是自己数一遍日期：
 *   两个数对不上就说明中间缺了日子，那时候「周末占几天」的说法就不成立了。
 *   缺日在这份数据里不会发生（60 天连续），但写死假设的代价是
 *   一旦不成立就静静地说了句假话，不值得省这几行。
 */
function countDays(start: string, end: string): { days: number; weekendDays: number } {
  const from = Date.parse(`${start}T00:00:00Z`)
  const to = Date.parse(`${end}T00:00:00Z`)
  if (!Number.isFinite(from) || !Number.isFinite(to) || to < from) {
    return { days: 0, weekendDays: 0 }
  }
  let days = 0
  let weekendDays = 0
  for (let t = from; t <= to; t += 86_400_000) {
    days += 1
    if (isWeekend(new Date(t).toISOString().slice(0, 10))) weekendDays += 1
  }
  return { days, weekendDays }
}

/** 把 Python 侧那个「前半段 vs 后半段」的结果，拆成页面要说清楚的构成信息。 */
export function halfWindowMix(span: HalfWindowSpan): HalfWindowMix {
  const first = countDays(span.firstStart, span.firstEnd)
  const second = countDays(span.secondStart, span.secondEnd)
  return {
    firstStart: span.firstStart,
    firstEnd: span.firstEnd,
    /* 天数以实际数出来的为准；数不出来（日期为空）才退回 Python 给的字段 */
    firstDays: first.days || span.firstDays,
    firstWeekendDays: first.weekendDays,
    secondStart: span.secondStart,
    secondEnd: span.secondEnd,
    secondDays: second.days || span.secondDays,
    secondWeekendDays: second.weekendDays,
  }
}

/**
 * 周末的「日均播放量」是工作日（周一至周四）的几倍。
 *
 * ★ 用播放量而不是 DAU 来算：Demo 3 比的指标就是播放量，
 *   拿 DAU 的倍率去解释播放量的变化是偷换口径。
 *   整段 60 天一起算，样本大，比只掐当前窗口稳。
 *
 * ★ 分母只算「周一至周四」，不含周五 —— 和 dataset.ts 里 DOW_MULTIPLIER
 *   的三个档（weekend / friday / weekday）保持一致。把周五混进工作日基准里，
 *   算出来的倍率会偏低，而低多少取决于窗口里有几个周五，说不清。
 *
 * 取不到数据时返回 null。调用方必须走「不比倍数」的分支，
 * 而不是拿 0 或 1 冒充 —— 1 的意思是「周末和工作日一样」，那是个结论。
 */
export function weekendViewRatio(py: PyResults): number | null {
  return weekendRatio(py, (p) => p.views)
}

/**
 * 周末的「日均活跃人数」是工作日（周一至周四）的几倍。
 *
 * ★ 为什么不能直接用上面那个 weekendViewRatio：
 *   两个函数的算式一模一样，但喂进去的指标不同 —— 上面那个算的是【播放量】，
 *   这个算的是【活跃人数】。Demo 5 比的指标是活跃率，
 *   拿播放量的倍率去解释活跃率的涨跌就是偷换口径：
 *   观看次数和活跃人数不是一回事（一个人周末多看几个视频，
 *   能让播放量的倍率涨上去，但活跃人数纹丝不动）。
 *   ★ 所以这两个函数谁也不能替代谁 —— 用错的那个不会报错，
 *   只是会让页面用一个不相干的数去"解释"另一个数，而看起来还挺合理。
 */
export function weekendDauRatio(py: PyResults): number | null {
  return weekendRatio(py, (p) => p.dau)
}

/**
 * 「周末日均 ÷ 工作日日均」的通用算式。
 *
 * ★ 分母只算周一至周四，不含周五 —— 和 dataset.ts 里 DOW_MULTIPLIER 的三个档
 *   （weekend / friday / weekday）保持一致。把周五混进工作日基准里，
 *   算出来的倍率会偏低，而低多少取决于窗口里有几个周五，说不清。
 */
function weekendRatio(
  py: PyResults,
  pick: (p: PyResults['activity']['daily'][number]) => number,
): number | null {
  let weekendSum = 0
  let weekendDays = 0
  let weekdaySum = 0
  let weekdayDays = 0

  for (const p of py.activity.daily) {
    if (p.dowGroup === 'weekend') {
      weekendSum += pick(p)
      weekendDays += 1
    } else if (p.dowGroup === 'weekday') {
      weekdaySum += pick(p)
      weekdayDays += 1
    }
  }

  if (weekendDays === 0 || weekdayDays === 0) return null
  const weekendDaily = weekendSum / weekendDays
  const weekdayDaily = weekdaySum / weekdayDays
  if (weekdayDaily <= 0) return null
  return weekendDaily / weekdayDaily
}
