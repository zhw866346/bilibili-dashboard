/* ==========================================================================
   Agent 工作流里的一步
   --------------------------------------------------------------------------
   一个步骤卡 = 编号 + 标题 + 状态 + 一句话结论 + 展开后的细节。

   ★ 为什么状态要分成五种而不是「完成 / 没完成」
     因为「跳过」和「失败」对读者的意义完全不同：
       跳过 = 这一步本来就不需要做（比如兜底意图不跑新查询）
       失败 = 该做但没做成（比如数据库起不来）
     把两者都写成「未完成」，读者会以为出了问题；写成「已完成」，
     又等于骗人。所以宁可多两个状态。
   ========================================================================== */

import { useState, type ReactNode } from 'react'

import type { StepStatus } from '../../data/ai/types'

/* 状态色照抄 Python 页 InsightRow 的写法：内联 rgba。
   为什么不全用 Tailwind 类？因为这五种状态里有三种（待执行 / 进行中 / 不需要做）
   在 @theme 里没有对应色，只有 up / down 有。五种状态混着两种写法，
   以后想统一调色就会漏掉一半 —— 所以索性整组都用内联色值。 */
const STATUS_STYLE: Record<StepStatus, { label: string; bg: string; color: string }> = {
  pending: { label: '待执行', bg: 'rgba(148,163,184,0.12)', color: '#64748b' },
  running: { label: '进行中', bg: 'rgba(251,114,153,0.12)', color: '#d94f77' },
  done: { label: '已完成', bg: 'rgba(12,163,12,0.09)', color: '#0a7d0a' },
  error: { label: '未完成', bg: 'rgba(208,59,59,0.10)', color: '#b02a2a' },
  skipped: { label: '不需要做', bg: 'rgba(148,163,184,0.14)', color: '#64748b' },
}

interface StepCardProps {
  no: number
  title: string
  status: StepStatus
  summary: string
  /** 出错或降级时的如实说明 */
  note?: string
  /** 标题右侧的小角标，例如「规则匹配 · 非大模型」 */
  badge?: ReactNode
  /** 展开后的细节。不传就没有展开按钮 */
  children?: ReactNode
}

export default function StepCard({
  no,
  title,
  status,
  summary,
  note,
  badge,
  children,
}: StepCardProps) {
  const [open, setOpen] = useState(true)
  const s = STATUS_STYLE[status]

  return (
    <section className="min-w-0 rounded-xl border border-hairline bg-card">
      <header className="flex items-start gap-3 px-4 py-3">
        <span className="mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-md bg-ink text-[11px] font-semibold text-white tabular">
          {no}
        </span>

        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
            <h3 className="text-[13.5px] font-semibold text-ink">{title}</h3>
            <span
              className="rounded px-1.5 py-0.5 text-[10.5px] font-semibold"
              style={{ background: s.bg, color: s.color }}
            >
              {s.label}
            </span>
            {badge}
          </div>
          {summary && (
            <p className="mt-1 text-[12px] leading-relaxed text-ink-2">{summary}</p>
          )}
          {note && (
            <p className="mt-1.5 rounded-md border border-hairline bg-plane/60 px-2.5 py-1.5 text-[11.5px] leading-relaxed text-ink-2">
              {note}
            </p>
          )}
        </div>

        {children && (
          <button
            type="button"
            onClick={() => setOpen((v) => !v)}
            className="mt-0.5 shrink-0 rounded-md border border-hairline px-2 py-1 text-[11px] font-medium text-ink-3 transition-colors hover:text-ink-2"
          >
            {open ? '收起' : '展开'}
          </button>
        )}
      </header>

      {children && open && <div className="flex flex-col gap-3 px-4 pb-4">{children}</div>}
    </section>
  )
}
