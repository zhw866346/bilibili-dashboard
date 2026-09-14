/* ==========================================================================
   实测占比 vs 设定权重
   --------------------------------------------------------------------------
   这一条是这个作品集项目里最该讲清楚的一件事：

     页面上那张「18–24 岁用户的内容偏好排名」，其实和生成数据时写下的
     CATEGORY_PREFERENCE 权重表几乎一模一样 —— 它不是从数据里发现的规律，
     而是把设定值量了一遍。

   ★ 为什么单独成一个模块，而不是写在意图里：
     同一个计算有三个消费者 ——
       ① 页面上的「设定权重 vs 实测占比」对照表（charts.tsx）
       ② 结论模板里那个「最大偏差 N 个百分点」的数字（intents.ts）
       ③ 本机检查里的断言（要对 3 个时间窗口 × 4 档人全量验一遍）
     写三份的话，迟早会出现「页面上说 0.30、脚本算出来 0.78」这种自相矛盾，
     而那正是这个项目最怕的事。

   ★ 权重从 dataset.ts 【import】，不手抄。手抄的参数改了不会跟着变，
     页面就会开始说假话。
   ========================================================================== */

import { CATEGORY_PREFERENCE } from '../dataset'
import type { AgeGroupId } from '../../types'
import type { PyAgePreferenceRow } from '../python/types'

/** 对照表的一行：一个内容分区的「设定 vs 实测」 */
export interface WeightCompareRow {
  category: string
  /** 生成数据时写下的偏好权重。这张表每行合计 100，所以它本身就是百分比。 */
  weight: number
  /** 真跑出来的占比（来自离线 Pandas 结果） */
  share: number
  /** 实测 − 设定，单位是「百分点」。正数表示实测比设定高。 */
  diff: number
}

/**
 * 把一档人的 8 个分区配成对照表。
 *
 * ★ 输出顺序跟着传进来的 cells（已按占比降序），也就是和上面的排名图同一个次序。
 *   这样「权重」那一列自上而下也该是递减的（权重 30 / 18 / 14 / 14 / 9 / 8 / 5 / 2），
 *   而「两列一起单调递减」这件事读者扫一眼就看得见——
 *   比把两列各自排序再让人对照强得多。
 *
 * ★ 权重表里没有的分区给 0，而不是跳过 —— 跳过会让表少一行，
 *   而「少一行」不报错，只是静静地少说一块。
 */
export function buildWeightComparison(
  age: AgeGroupId,
  row: PyAgePreferenceRow,
): WeightCompareRow[] {
  const table = CATEGORY_PREFERENCE[age] as Record<string, number> | undefined
  if (!table) return []

  return row.cells.map((cell) => {
    const weight = Number(table[cell.category] ?? 0)
    return {
      category: cell.category,
      weight,
      share: cell.share,
      diff: cell.share - weight,
    }
  })
}

/**
 * 偏差最大的那一行。
 *
 * ★ 刻意返回整行而不是一个数字：页面上要说明白「最大偏差出现在哪个分区、
 *   设定是多少、实测是多少」——只给一个 0.78 读者没法判断这算大还是算小。
 */
export function maxDeviationRow(rows: WeightCompareRow[]): WeightCompareRow | null {
  if (rows.length === 0) return null
  return rows.reduce((a, b) => (Math.abs(b.diff) > Math.abs(a.diff) ? b : a))
}

/**
 * 实测的排序和权重的排序是不是同一个次序。
 *
 * ★ 返回「第一对反序的相邻名次」，而不是一个布尔。
 *   布尔说「不一致」，读者不知道差在哪；返回具体是哪两个分区，
 *   页面上就能直接写出「实测里生活排在动画前面，而权重表里两个都是 14」。
 *
 * ★ 权重相同的两档【不算反序】：它们本来就是并列的，
 *   谁在前只由随机抽样决定，不该被说成「排序不一致」。
 */
export function firstInversion(
  rows: WeightCompareRow[],
): { higher: WeightCompareRow; lower: WeightCompareRow } | null {
  const byShare = [...rows].sort((a, b) => b.share - a.share)
  for (let i = 0; i < byShare.length - 1; i++) {
    const a = byShare[i]
    const b = byShare[i + 1]
    if (a.weight === b.weight) continue
    if (a.weight < b.weight) return { higher: a, lower: b }
  }
  return null
}
