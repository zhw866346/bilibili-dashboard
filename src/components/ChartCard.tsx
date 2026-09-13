/* 图表卡片 —— 所有图表的"外框"。
   统一负责：标题、副标题、右上角单位、图表/表格切换、底部解读。

   为什么要做「图表 / 表格」切换？
   因为有些颜色对色觉障碍人群不够友好，或者有人就是想看准确数字。
   提供表格视图，等于给了每个图一个"人人都能读"的备份。 */

import { useState, type ReactNode } from 'react'

interface ChartCardProps {
  title: string
  subtitle?: string
  /** 右上角的单位标签，例如「单位：万次」 */
  meta?: string
  /** 底部的解读文字：这张图到底说明了什么 */
  note?: string
  /** 表格视图的内容。不传就不显示切换按钮 */
  table?: ReactNode
  children: ReactNode
  className?: string
}

export default function ChartCard({
  title,
  subtitle,
  meta,
  note,
  table,
  children,
  className = '',
}: ChartCardProps) {
  const [view, setView] = useState<'chart' | 'table'>('chart')

  return (
    /* min-w-0 是必须的：图表用「自适应宽度」渲染，
       如果卡片不设 min-w-0，在小屏幕上图表会把卡片撑破，导致横向滚动条。 */
    <section className={`flex min-w-0 flex-col rounded-xl border border-hairline bg-card ${className}`}>
      <header className="flex items-start justify-between gap-3 px-5 pb-3 pt-4">
        <div className="min-w-0">
          <h3 className="text-[14px] font-semibold text-ink">{title}</h3>
          {subtitle && <p className="mt-0.5 text-[12px] text-ink-2">{subtitle}</p>}
        </div>

        <div className="flex shrink-0 items-center gap-2">
          {meta && (
            <span className="rounded-md bg-plane px-2 py-1 text-[11px] text-ink-3">{meta}</span>
          )}
          {table && (
            <div className="flex rounded-md border border-hairline p-px">
              {(['chart', 'table'] as const).map((v) => (
                <button
                  key={v}
                  type="button"
                  onClick={() => setView(v)}
                  className={`rounded px-2 py-1 text-[11px] font-medium transition-colors ${
                    view === v ? 'bg-ink text-white' : 'text-ink-3 hover:text-ink-2'
                  }`}
                >
                  {v === 'chart' ? '图表' : '表格'}
                </button>
              ))}
            </div>
          )}
        </div>
      </header>

      <div className="min-w-0 px-3 pb-3">{view === 'chart' ? children : table}</div>

      {note && (
        <p className="mt-auto border-t border-hairline px-5 py-2.5 text-[11.5px] leading-relaxed text-ink-2">
          <span className="font-semibold text-ink-3">解读 · </span>
          {note}
        </p>
      )}
    </section>
  )
}
