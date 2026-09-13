/* ==========================================================================
   内容 → 谁在看（100% 堆叠条形图）
   --------------------------------------------------------------------------
   这张图和「年龄 × 内容偏好」是反方向的：

     偏好图：用户 → 喜欢什么？（一行 = 一个年龄段，看它在 8 个分区上怎么分配）
     本  图：内容 → 谁在看？（一行 = 一个分区，看它的观众由哪些年龄段构成）

   为什么用 100% 堆叠？
     因为要回答的是"构成"，不是"多少"。每个分区拉成等长的一条，
     看到的就直接是比例，不会被"游戏播放量本来就比音乐大"这种事干扰。

   为什么不用饼图？
     8 个分区 × 4 个年龄段要做 8 张饼，读者得来回比对颜色；
     堆叠条把这些对齐在同一列上，上下扫一眼就能比。

   年龄段是有序的（18–24 → 40+），所以用同色系由浅到深，
   而不是四个不相干的颜色——颜色本身就能表达"越来越年长"。
   ========================================================================== */

import { useState } from 'react'
import type { ContentStructureRow } from '../data/selectors'
import { ageColor } from '../theme'
import { AGE_GROUPS } from '../utils/ageGroup'
import { formatCount } from '../utils/format'

/** 堆叠条内部的文字：太窄的段放不下字，硬塞会变成一坨。10% 是实测能放下的下限 */
const MIN_LABEL_WIDTH = 10

export default function ContentUserStructure({ data }: { data: ContentStructureRow[] }) {
  const [hover, setHover] = useState<{ row: string; age: string; text: string } | null>(null)

  // 按「18–24 岁占比」从高到低排。
  // 用年轻用户的占比排序，是为了让"越往上越年轻化"这个顺序一眼可见，
  // 比按分区固定顺序摆着更容易看出规律。
  const rows = [...data].sort((a, b) => {
    const aYoung = a.segments.find((s) => s.age === '18-24')?.share ?? 0
    const bYoung = b.segments.find((s) => s.age === '18-24')?.share ?? 0
    return bYoung - aYoung
  })

  return (
    <div>
      <div className="flex flex-col gap-2.5 px-2">
        {rows.map((row) => {
          const total = row.totalViews
          return (
            <div key={row.category} className="flex items-center gap-3">
              <div className="w-[52px] shrink-0 text-right text-[12px] font-medium text-ink-2">
                {row.category}
              </div>

              {/* 一整条：四个年龄段首尾相接，加总 100% */}
              <div className="flex h-[26px] min-w-0 flex-1 overflow-hidden rounded-[5px]">
                {row.segments.map((seg, i) => {
                  const active = hover?.row === row.category && hover?.age === seg.ageLabel
                  return (
                    <div
                      key={seg.age}
                      className="flex items-center justify-center text-[10.5px] font-semibold tabular-nums transition-[filter]"
                      style={{
                        width: `${seg.share}%`,
                        background: ageColor(i),
                        color: i >= 2 ? '#ffffff' : '#0f172a',
                        // 悬停时把这一段压暗一点，而不是加描边——描边会改变宽度感知
                        filter: active ? 'brightness(0.86)' : undefined,
                      }}
                      onMouseEnter={() =>
                        setHover({
                          row: row.category,
                          age: seg.ageLabel,
                          text:
                            `${seg.ageLabel} ${seg.share.toFixed(1)}% · ` +
                            `${formatCount(seg.viewers)} 人 · ${formatCount(Math.round(total * (seg.share / 100)))} 次`,
                        })
                      }
                      onMouseLeave={() => setHover(null)}
                      title={`${row.category} × ${seg.ageLabel}：${seg.share.toFixed(1)}%`}
                    >
                      {seg.share >= MIN_LABEL_WIDTH ? `${seg.share.toFixed(1)}%` : ''}
                    </div>
                  )
                })}
              </div>

              <div className="w-[74px] shrink-0 text-right text-[11px] tabular-nums text-ink-3">
                {formatCount(row.viewers)} 人
              </div>
            </div>
          )
        })}
      </div>

      {/* 悬停时把完整数字显示出来。
          条形太窄的段放不下文字，但没有理由让读者读不到它的值。 */}
      <div className="mt-2.5 h-[18px] px-2 text-[11px] text-ink-2">
        {hover ? (
          <span>
            <span className="font-medium text-ink">{hover.row}</span> × {hover.text}
          </span>
        ) : (
          <span className="text-ink-3">把鼠标放到任意一段上可以看具体数字</span>
        )}
      </div>

      {/* 图例：四个年龄段必须有图例，而且是同一色系由浅到深 */}
      <div className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-1.5 border-t border-hairline px-2 pt-3">
        {AGE_GROUPS.map((g, i) => (
          <span key={g.id} className="inline-flex items-center gap-1.5 text-[11.5px] text-ink-2">
            <span
              className="h-2.5 w-2.5 shrink-0 rounded-[3px]"
              style={{ background: ageColor(i) }}
              aria-hidden="true"
            />
            {g.label}
          </span>
        ))}
        <span className="ml-auto text-[11px] text-ink-3">
          每条拉长到 100%，所以看到的是「构成」不是「多少」
        </span>
      </div>
    </div>
  )
}
