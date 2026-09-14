/* ==========================================================================
   大模型路径的那唯一一张通用图
   --------------------------------------------------------------------------
   规则路径的每一张图都是「为了回答某一类问题专门画的」—— 事前就知道
   要画哪个分区、哪个年龄段、哪一列。这一张不是：模型这一次查了什么，
   就画什么。所以它只认两件事：一个分类列（纵轴上每一行）、一个数值列（柱子长度）。

   ★ 为什么单独一个文件，而不是塞进 charts.tsx：
     charts.tsx 是注册表（id → 组件），已经有 1300 多行。这张图的性质和
     那六张都不一样（它不知道自己在画什么），单独放更好读。
     ⚠️ 依赖方向是单向的：charts.tsx → LlmBarsChart.tsx。
     【反过来 import 会造出循环】，而这个循环在开发模式下不一定看得出来。

   ★ 为什么不建成 charts/ 子目录（原计划里写的是 charts/LlmBarsChart.tsx）：
     charts.tsx 是文件、charts/ 是目录，同名会让 './charts' 这个说明符二义 ——
     今天 tsc 和 Vite 的解析顺序恰好一致所以能跑，但这属于「今天恰好对」那一类。

   ★ 三条刻意的设计，改之前先读完：

     1. 【不把数值标在柱子末端】。别处的柱子末端都标着数，这里不标，
        是刻意的：那些图的单位是已知的（% / 次 / 分钟），而这张图的数值列
        是模型自己写出来的，叫什么名字都有可能（viewers / change_pct / avg_min…）。
        硬套一个格式就是在替它猜单位。精确的数字在下面的表里原样给出，
        而且表头就是【那一列真实的名字】。

     2. 【一条代码路径管住两种情况】：数值列是「变化率类」时，按正负上色、
        画一条 0 线、数字带正负号；不是变化率类时（比如人数、播放量），
        全部同色、从 0 起。判据来自 tools.ts 的 isChangeColumn ——
        和【挑图】用的是同一条判断，不在这里另写一份。

     3. 【不重排行】。行的顺序就是那条查询返回的顺序（模型自己写的 ORDER BY
        或者 Python 的输出顺序）。页面替它重排的话，图和上面的结论说的顺序
        可能就不一样了，而那种不一致不会报错。
   ========================================================================== */

import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts'

import { isChangeColumn } from '../../data/ai/llm/tools'
import ChartTooltip from '../ChartTooltip'
import DataTable from '../DataTable'
import { ChartEmpty, EMPTY_SERIES_REASON } from './chartStates'
import { CHART_INK, SERIES_PRIMARY, STATUS_COLOR } from '../../theme'
import { formatDelta, withThousands } from '../../utils/format'

/**
 * 最多画多少根柱子。
 *
 * ★ 这个上限是【如实写出来的】，不是偷偷截断：超了会在图上面说一句
 *   「只画了前 N 行，共 M 行」。不写上限也不行 —— 模型的一次查询最多能回
 *   500 行，500 根柱子读不出任何东西，还会把卡片撑到几屏高。
 */
export const MAX_LLM_BARS = 20

/** 一行：分类列的值 + 数值列的值。都来自模型那条查询的真实结果。 */
export interface LlmBarRow {
  label: string
  value: number
}

export function LlmBarsChart({
  rows,
  labelKey,
  valueKey,
  sourceLabel,
  emptyHint,
}: {
  rows: LlmBarRow[]
  /** 分类列的真实列名（画在表头上，不翻译） */
  labelKey: string
  /** 数值列的真实列名 */
  valueKey: string
  /** 这条结果出自模型的哪一次调用（用的是第 4 步那张卡片的名字） */
  sourceLabel: string
  emptyHint: string
}) {
  if (rows.length === 0) {
    return <ChartEmpty hint={emptyHint} reason={EMPTY_SERIES_REASON} />
  }

  const change = isChangeColumn(valueKey)
  const shown = rows.slice(0, MAX_LLM_BARS)
  const hidden = rows.length - shown.length

  const values = shown.map((r) => r.value)
  const max = Math.max(...values, 0)
  const min = change ? Math.min(...values, 0) : 0
  /* 两端都留一点余量，否则最长的柱子会顶到画布边上 */
  const pad = Math.max((max - min) * 0.08, Number.EPSILON)

  const fmt = (v: number) => (change ? formatDelta(v, 2) : withThousands(v))

  return (
    <>
      <p className="mb-2 text-[11.5px] leading-relaxed text-ink-2">
        数据来自
        <strong className="font-semibold text-ink">{sourceLabel}</strong>
        ：分类列是 <code className="font-mono text-[11px]">{labelKey}</code>，
        数值列是 <code className="font-mono text-[11px]">{valueKey}</code>。
        {rows.length > shown.length ? (
          <>
            {' '}
            一共 {rows.length} 行，图上只画了前 {shown.length} 行 ——
            剩下的在下面第 4 步的结果表里，那个表是完整的。
          </>
        ) : null}
      </p>

      <ResponsiveContainer width="100%" height={Math.min(560, Math.max(184, shown.length * 26 + 48))}>
        <BarChart
          data={shown}
          layout="vertical"
          margin={{ top: 16, right: 28, bottom: 0, left: 0 }}
        >
          <CartesianGrid stroke={CHART_INK.grid} horizontal={false} />
          <XAxis
            type="number"
            domain={[min - pad, max + pad]}
            tickFormatter={(v: number) => (change ? v.toFixed(0) : withThousands(v))}
            tick={{ fill: CHART_INK.tick, fontSize: 11 }}
            tickLine={false}
            axisLine={{ stroke: CHART_INK.axis }}
          />
          <YAxis
            type="category"
            dataKey="label"
            tick={{ fill: CHART_INK.tick, fontSize: 11.5 }}
            tickLine={false}
            axisLine={false}
            width={104}
          />
          <Tooltip
            cursor={{ fill: 'rgba(15,23,42,0.04)' }}
            content={
              <ChartTooltip
                valueFormatter={(v) => fmt(v)}
                labelFormatter={(l) => `${labelKey}：${l}`}
              />
            }
          />
          {/* 0 线只在「有正有负」的时候才画 —— 全是正数时它贴着轴，
              画出来只会让人以为有一条额外的参考线。 */}
          {change ? (
            <ReferenceLine
              x={0}
              stroke={CHART_INK.axis}
              strokeWidth={1.2}
              label={{ value: '0 线', position: 'top', fill: CHART_INK.label, fontSize: 10.5 }}
            />
          ) : null}
          <Bar dataKey="value" name={valueKey} barSize={16} isAnimationActive={false}>
            {shown.map((r, i) => (
              <Cell
                key={`${r.label}-${i}`}
                fill={change ? (r.value >= 0 ? STATUS_COLOR.up : STATUS_COLOR.down) : SERIES_PRIMARY}
              />
            ))}
          </Bar>
        </BarChart>
      </ResponsiveContainer>

      <p className="mt-2 rounded-lg bg-plane px-3 py-2 text-[11.5px] leading-relaxed text-ink-2">
        <span className="font-semibold text-ink">这张图不能拿来当结论：</span>
        它画的是模型这一次【恰好查到的】结果，不是页面为这个问题专门准备的。
        {change
          ? '柱子从 0 线出发，往右是正的、往左是负的 —— 颜色只表示方向，不表示好坏。'
          : '柱子都是从 0 起算的原始数值，没有做任何归一化，量级不同的时候比的是「谁大」而不是「谁涨得快」。'}
        {' '}
        行序就是那条查询返回的顺序，页面没有替你重排。
      </p>

      <div className="mt-2">
        <DataTable
          columns={[
            { key: 'label', label: labelKey },
            { key: 'value', label: valueKey, align: 'right', format: (v) => fmt(Number(v)) },
          ]}
          rows={shown.map((r) => ({ label: r.label, value: r.value }))}
          maxHeight={248}
          footnote={
            `表头用的是结果的【原始列名】，不是我们翻译过的：${labelKey} / ${valueKey}。` +
            `这两列是本地规则从结果里挑出来的（优先挑变化率那一列，序号列不挑），` +
            `不是模型指定的。原始结果在第 4 步，两处数字应当逐格一致。` +
            (hidden > 0 ? `★ 这里和图上一样只列了前 ${shown.length} 行，另有 ${hidden} 行在第 4 步。` : '')
          }
        />
      </div>
    </>
  )
}
