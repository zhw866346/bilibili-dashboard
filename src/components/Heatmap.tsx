/* ==========================================================================
   热力图：年龄 × 内容（一张图，三种指标共用）
   --------------------------------------------------------------------------
   这张图回答三类问题，取决于 data 里放的是哪个指标：
     · 用户分析页   → 每个年龄段喜欢看什么？（颜色 = 行内占比）
     · 用户×内容 页 → 每个年龄段看得有多深？（颜色 = 人均观看时长）
     · 用户×内容 页 → 每个年龄段爱不爱互动？（颜色 = 综合互动率）

   怎么读：
     · 一行 = 一个年龄段，一列 = 一个内容分区
     · 格子里的数字、格子颜色的含义，都由 legendLabel 说明，不写死在这里

   为什么"偏好图"的颜色用行内占比、而不是观看量？
     18–24 岁用户多，40 岁以上用户少。直接拿观看量上色，
     人多的那一整行都会更深——那是"人多"，不是"偏爱"。
     换成行内占比（每行加起来 100%），同一行里颜色深的格子才是真的"更爱看"。

   实现上只用 CSS 网格 + 一段配色函数，没有引入任何图表库。
   三种指标共用这一个组件，只是传进来的数据不同——不复制三份代码。
   ========================================================================== */

import { useRef, useState } from 'react'
import type { HeatmapData } from '../data/selectors'
import { ORDINAL_RAMP } from '../theme'

interface HeatmapProps {
  data: HeatmapData
}

/** 把「行内占比」映射到色阶的第几档（0 最浅，5 最深） */
function levelOf(share: number, max: number): number {
  if (max <= 0) return 0
  const ratio = share / max
  const idx = Math.floor(ratio * ORDINAL_RAMP.length)
  return Math.min(ORDINAL_RAMP.length - 1, Math.max(0, idx))
}

/** 深色格子上用白字，浅色格子上用深色字——保证数字始终看得清 */
function inkOn(level: number): string {
  return level >= 3 ? '#ffffff' : '#0f172a'
}

/** 悬停时的描边颜色，也要跟着底色深浅走 */
function ringOn(level: number): string {
  return level >= 3 ? 'rgba(255,255,255,0.9)' : 'rgba(15,23,42,0.45)'
}

interface HoverState {
  rowId: string
  category: string
  /** 提示框相对容器的位置 */
  x: number
  y: number
  /** 靠下的行把提示框放到格子上方，靠上的行放到下方，避免挡住表头 */
  placeBelow: boolean
  age: string
  /** 明细行，由数据层决定显示哪几项 */
  detail: { label: string; value: string }[]
}

export default function Heatmap({ data }: HeatmapProps) {
  const hostRef = useRef<HTMLDivElement>(null)
  const [hover, setHover] = useState<HoverState | null>(null)

  const columns = `88px repeat(${data.categories.length}, minmax(0, 1fr))`

  return (
    <div className="relative" ref={hostRef}>
      {/* 小屏时横向滚动，而不是把格子压扁到看不清数字 */}
      <div className="overflow-x-auto pb-1">
        <div className="min-w-[620px]">
          {/* 表头：8 个内容分区 */}
          <div className="grid gap-[3px]" style={{ gridTemplateColumns: columns }}>
            <div />
            {data.categories.map((c) => (
              <div key={c} className="pb-1.5 text-center text-[11.5px] font-medium text-ink-2">
                {c}
              </div>
            ))}
          </div>

          {data.rows.map((row, rowIndex) => (
            <div
              key={row.id}
              className="grid gap-[3px] pt-[3px]"
              style={{ gridTemplateColumns: columns }}
            >
              <div className="flex items-center pr-2 text-[11.5px] font-medium text-ink-2">
                {row.label}
              </div>

              {row.cells.map((cell) => {
                const level = levelOf(cell.share, data.shareMax)
                const isActive = hover?.rowId === row.id && hover?.category === cell.category
                return (
                  <div
                    key={cell.category}
                    className="flex h-[46px] cursor-default items-center justify-center rounded-[4px] text-[12px] font-semibold tabular-nums"
                    style={{
                      background: ORDINAL_RAMP[level],
                      color: inkOn(level),
                      boxShadow: isActive ? `inset 0 0 0 2px ${ringOn(level)}` : 'none',
                    }}
                    onMouseEnter={(e) => {
                      const box = e.currentTarget.getBoundingClientRect()
                      const host = hostRef.current?.getBoundingClientRect()
                      if (!host) return
                      setHover({
                        rowId: row.id,
                        category: cell.category,
                        x: box.left - host.left + box.width / 2,
                        y: rowIndex === 0 ? box.bottom - host.top : box.top - host.top,
                        placeBelow: rowIndex === 0,
                        age: row.label,
                        detail: cell.detail,
                      })
                    }}
                    onMouseLeave={() => setHover(null)}
                  >
                    {cell.text}
                  </div>
                )
              })}
            </div>
          ))}
        </div>
      </div>

      {/* 悬停提示：显示这个格子的完整信息。
          定位在容器坐标系里，所以不会被横向滚动条裁掉。 */}
      {hover && (
        <div
          className={`pointer-events-none absolute z-20 w-[178px] -translate-x-1/2 rounded-lg border border-hairline bg-card px-3 py-2 shadow-[0_4px_16px_rgba(15,23,42,0.12)] ${
            hover.placeBelow ? 'translate-y-2' : '-translate-y-[calc(100%+8px)]'
          }`}
          style={{ left: hover.x, top: hover.y }}
        >
          <div className="text-[11.5px] font-semibold text-ink">
            {hover.age} × {hover.category}
          </div>
          <dl className="mt-1.5 space-y-0.5 text-[11px] text-ink-2">
            {hover.detail.map((d) => (
              <div key={d.label} className="flex justify-between gap-3">
                <dt>{d.label}</dt>
                <dd className="tabular-nums text-ink">{d.value}</dd>
              </div>
            ))}
          </dl>
        </div>
      )}

      {/* 色阶图例：告诉读者颜色代表什么、范围是多少 */}
      <div className="mt-3 flex flex-wrap items-center gap-x-3 gap-y-1.5 border-t border-hairline pt-3">
        <span className="text-[11px] text-ink-3">{data.legendLabel}</span>
        <div className="flex items-center gap-1">
          <span className="text-[11px] tabular-nums text-ink-3">低</span>
          <div className="flex overflow-hidden rounded-[3px]">
            {ORDINAL_RAMP.map((c) => (
              <span key={c} className="h-[10px] w-[26px]" style={{ background: c }} />
            ))}
          </div>
          <span className="text-[11px] tabular-nums text-ink-3">高（{data.legendMaxText}）</span>
        </div>
      </div>
    </div>
  )
}
