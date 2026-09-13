/* ==========================================================================
   各年龄段 TOP 内容（模块 2）
   --------------------------------------------------------------------------
   左边那张热力图回答"每个年龄段的口味分布长什么样"，
   这一块回答"排在最前面的是哪几个、领先多少"。

   为什么每个年龄段只列前三名 + 一句垫底？
     八个分区全列出来就和旁边的热力图完全重复了。
     前三名是"结论"，垫底那个是"对照"——有对照才看得出第一名是真的领先，
     还是八个分区本来就差不多。中间那几名不列，看热力图就够了。

   条形长度用的是【偏好占比】(行内归一化)，不是播放量。
   原因和热力图一样：18–24 岁人最多，用绝对播放量的话四张卡片里
   它每一行都会最长，比的是人数不是口味。

   每条下面还挂了【人均观看时长】和【综合互动率】：
   同样是前三名，有人是"看得久"，有人是"互动多"，这两个后缀能分开它们。
   ========================================================================== */

import type { AgePreferenceRow } from '../data/selectors'
import { categoryColor } from '../theme'
import { formatCount, formatPercent } from '../utils/format'

export default function AgeTopContent({ data }: { data: AgePreferenceRow[] }) {
  /*
    条形长度的尺子：取 4 个年龄段里"最大偏好占比"的那个做满格。
    这样四张卡片共用同一把尺子，"游戏在 18–24 岁占 29.8%"和
    "知识在 40+ 占 25.5%"的条长可以直接比。
    如果每张卡自己定满格，第一名在每张卡里都是满格，反而看不出差距。
  */
  const scaleMax = Math.max(1, ...data.map((row) => row.ranking[0]?.preferShare ?? 0))

  return (
    <div className="grid grid-cols-1 gap-4 px-1 lg:grid-cols-2 2xl:grid-cols-4">
      {data.map((row) => {
        const top3 = row.ranking.slice(0, 3)
        const last = row.ranking[row.ranking.length - 1]
        return (
          <div key={row.age} className="min-w-0 rounded-lg border border-hairline bg-plane/40 px-3.5 py-3">
            <div className="flex items-baseline justify-between gap-2">
              <h4 className="text-[12.5px] font-semibold text-ink">{row.ageLabel}</h4>
              <span className="shrink-0 text-[11px] tabular-nums text-ink-3">
                {formatCount(row.viewers)} 人
              </span>
            </div>

            <div className="mt-2.5 space-y-2.5">
              {top3.map((c, i) => (
                <div key={c.category}>
                  <div className="flex items-center gap-1.5">
                    <span className="w-[13px] shrink-0 text-[10.5px] tabular-nums text-ink-3">
                      {i + 1}
                    </span>
                    <span
                      className="h-2.5 w-2.5 shrink-0 rounded-full"
                      style={{ background: categoryColor(c.slot) }}
                      aria-hidden="true"
                    />
                    <span className="min-w-0 flex-1 truncate text-[12px] font-medium text-ink">
                      {c.category}
                    </span>
                    <span className="shrink-0 text-[12px] font-semibold tabular-nums text-ink">
                      {formatPercent(c.preferShare)}
                    </span>
                  </div>

                  {/* 条形：长度 = 偏好占比 ÷ 四段里的最大值 */}
                  <div className="mt-1 flex items-center gap-1.5">
                    <span className="w-[13px] shrink-0" />
                    <div className="h-[5px] min-w-0 flex-1 overflow-hidden rounded-full bg-hairline">
                      <div
                        className="h-full rounded-full"
                        style={{
                          width: `${Math.max(2, (c.preferShare / scaleMax) * 100)}%`,
                          background: categoryColor(c.slot),
                        }}
                      />
                    </div>
                  </div>

                  <p className="mt-1 pl-[19px] text-[10.5px] tabular-nums text-ink-3">
                    人均 {c.minutesPerViewer.toFixed(1)} 分 · 互动 {formatPercent(c.engageRate)}
                  </p>
                </div>
              ))}
            </div>

            {/* 垫底的那个：没有它，前三名的"领先"就没有参照 */}
            <p className="mt-2.5 border-t border-hairline pt-2 text-[10.5px] leading-relaxed text-ink-3">
              垫底：{last.category} {formatPercent(last.preferShare)}
              （和第一名差 {(row.ranking[0].preferShare - last.preferShare).toFixed(1)} 个百分点）
            </p>
          </div>
        )
      })}
    </div>
  )
}
