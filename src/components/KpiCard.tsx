/* KPI 卡片 —— 首页最上面那排大数字。
   一张卡 = 一个核心指标：名字、数值、环比涨跌、一句话解释。 */

import type { Kpi } from '../types'
import { formatCount, formatDelta, formatPercent } from '../utils/format'
import { STATUS_COLOR } from '../theme'

/** 按单位把裸数字变成显示文字。 */
function formatValue(kpi: Kpi): { text: string; suffix: string } {
  switch (kpi.unit) {
    case 'count':
      return { text: formatCount(kpi.value), suffix: '' }
    case 'duration':
      return { text: kpi.value.toFixed(1), suffix: '分钟' }
    case 'percent':
      return { text: formatPercent(kpi.value), suffix: '' }
    case 'number':
      return { text: kpi.value.toFixed(1), suffix: '个' }
  }
}

export default function KpiCard({ kpi }: { kpi: Kpi }) {
  const { text, suffix } = formatValue(kpi)
  // 有些指标是「存量」（比如累计注册用户数），环比对它没有意义，
  // 这时 deltaPct 不传，卡片就不显示涨跌徽标，只显示口径说明。
  const hasDelta = typeof kpi.deltaPct === 'number'
  const isUp = hasDelta && kpi.deltaPct! >= 0

  return (
    <div className="flex flex-col rounded-xl border border-hairline bg-card px-4 py-3.5 transition-shadow hover:shadow-[0_2px_12px_rgba(15,23,42,0.06)]">
      <div className="flex items-center gap-1.5">
        <span className="text-[12.5px] font-medium text-ink-2">{kpi.name}</span>
        {kpi.abbr && (
          <span className="rounded bg-plane px-1.5 py-px text-[10.5px] font-semibold tracking-wide text-ink-3">
            {kpi.abbr}
          </span>
        )}
      </div>

      <div className="mt-2.5 flex items-baseline gap-1.5">
        {/* 大数字刻意不使用等宽字形——等宽会让 121 这种数字在大字号下显得松散 */}
        <span className="text-[30px] font-semibold leading-none tracking-tight text-ink">
          {text}
        </span>
        {suffix && <span className="text-[13px] font-medium text-ink-2">{suffix}</span>}
      </div>

      <div className="mt-2.5 flex items-center gap-1.5">
        {hasDelta && (
          <span
            className="inline-flex items-center gap-0.5 rounded px-1.5 py-0.5 text-[11.5px] font-semibold tabular-nums"
            style={{
              color: isUp ? STATUS_COLOR.up : STATUS_COLOR.down,
              background: isUp ? 'rgba(12,163,12,0.08)' : 'rgba(208,59,59,0.08)',
            }}
          >
            {/* 箭头 + 数字 + 颜色三重表达，不靠颜色单独传递信息 */}
            <svg
              viewBox="0 0 12 12"
              className="h-2.5 w-2.5"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.8"
              strokeLinecap="round"
              strokeLinejoin="round"
              aria-hidden="true"
            >
              {isUp ? <path d="M6 9.5V2.5M6 2.5 2.8 5.7M6 2.5l3.2 3.2" /> : <path d="M6 2.5v7M6 9.5 2.8 6.3M6 9.5l3.2-3.2" />}
            </svg>
            {formatDelta(kpi.deltaPct!)}
          </span>
        )}
        <span className="text-[11.5px] text-ink-3">{kpi.deltaLabel}</span>
      </div>

      <p className="mt-3 border-t border-hairline pt-2.5 text-[11.5px] leading-relaxed text-ink-2">
        {kpi.desc}
      </p>
    </div>
  )
}
