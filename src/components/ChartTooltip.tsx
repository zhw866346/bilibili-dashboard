/* 鼠标划过图表时弹出的那个小浮层。
   全站统一用它，保证每张图的浮层长得一样、字体一样、间距一样。 */

interface TooltipItem {
  name?: string
  value?: number | string
  color?: string
  dataKey?: string | number
}

interface ChartTooltipProps {
  active?: boolean
  payload?: TooltipItem[]
  label?: string | number
  /** 把原始数值转成显示文字，例如 (12380) => "1.24亿" */
  valueFormatter?: (value: number, dataKey: string) => string
  /** 自定义左上角的标题文字 */
  labelFormatter?: (label: string | number) => string
}

export default function ChartTooltip({
  active,
  payload,
  label,
  valueFormatter,
  labelFormatter,
}: ChartTooltipProps) {
  if (!active || !payload || payload.length === 0) return null

  return (
    <div className="pointer-events-none rounded-lg border border-hairline bg-card px-3 py-2 shadow-[0_4px_16px_rgba(15,23,42,0.10)]">
      <div className="mb-1.5 text-[11px] font-medium text-ink-3">
        {labelFormatter ? labelFormatter(label ?? '') : label}
      </div>
      <div className="flex flex-col gap-1">
        {payload.map((item, i) => {
          const raw = typeof item.value === 'number' ? item.value : Number(item.value ?? 0)
          const key = String(item.dataKey ?? '')
          const text = valueFormatter ? valueFormatter(raw, key) : String(item.value)

          return (
            <div key={i} className="flex items-center gap-2 text-[12px]">
              <span
                className="h-2 w-2 shrink-0 rounded-[2px]"
                style={{ background: item.color }}
              />
              <span className="text-ink-2">{item.name}</span>
              <span className="ml-4 font-semibold text-ink tabular-nums">{text}</span>
            </div>
          )
        })}
      </div>
    </div>
  )
}
