/* ==========================================================================
   AI 助手页的图表注册表
   --------------------------------------------------------------------------
   意图里写的是图表 id（'dauTrend' / 'ageActiveRate'），这里把它变成真的图。
   意图定义看不懂 Recharts，图表组件也不认识「意图」——两边只通过 id 见面。

   ★ 两条从项目里继承来的规矩：
     1. 颜色一律从 theme.ts 取，不写死。尤其是移动平均那条线用的是
        SERIES_PRIMARY，和 Python 页是同一种蓝——这样同一个东西在两个页面上
        长得一样，眼睛可以跨页对照。
     2. 关掉入场动画（isAnimationActive={false}）。看板要的是「打开就能读」，
        不是看它慢慢长出来。

   ★ 数据不够就返回 null，绝不为了"看起来丰富"硬画一张。
     图表的数量由意图定义写死，不随着数据多少变来变去。
   ========================================================================== */

import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  LabelList,
  Line,
  LineChart,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts'

import type { AnalysisData, ChartId } from '../../data/ai/types'
import type { AgeGroupId, CategoryName } from '../../types'
import { AGE_CATEGORY_CASE_ID, DEFAULT_FOCUS_AGE, EVEN_SHARE_PCT } from '../../data/ai/intents'
import {
  CATEGORY_TREND_QUERY_ID,
  COMPLETION_RANK_QUERY_ID,
  SEGMENT_TREND_QUERY_ID,
} from '../../data/ai/sqlQueries'
import { COMPLETION_THRESHOLD } from '../../data/metrics'
import { halfWindowMix, weekendViewRatio } from '../../data/ai/halfWindow'
import { buildWeightComparison, maxDeviationRow } from '../../data/ai/weightCompare'
import type { WeightCompareRow } from '../../data/ai/weightCompare'
import ChartTooltip from '../ChartTooltip'
import DataTable from '../DataTable'
import { ChartEmpty, EMPTY_SERIES_REASON, outcomeReason } from './chartStates'
/* ★ 依赖方向：charts.tsx → LlmBarsChart.tsx（单向）。反过来的话是循环。 */
import { LlmBarsChart, type LlmBarRow } from './LlmBarsChart'
import { AGE_RAMP, CHART_INK, SERIES_PRIMARY, STATUS_COLOR, categoryColor } from '../../theme'
import { categorySlot } from '../../utils/categories'
import { AGE_GROUP_IDS, ageGroupLabel } from '../../utils/ageGroup'
import { formatCount, formatDelta, formatPercent, withThousands } from '../../utils/format'

/* --------------------------------------------------------------------------
   一、DAU 趋势：原始值 vs 7 日移动平均
   -------------------------------------------------------------------------- */

/**
 * ★ 这张图的数据来自离线跑好的 Pandas 结果，覆盖【整段 60 天】，
 *   不随上面的 7 / 14 / 30 天切换而变。这一点必须在页面上写明，
 *   否则读者会以为筛选坏了。所以 ChartBoard 会把 days 传进来做提示。
 */
export function DauTrendChart({
  data,
  days,
  emptyHint,
}: {
  data: AnalysisData
  days: number
  /** 画不出来时该说什么（文案来自 chartMeta.ts 的查表，不在这里现写） */
  emptyHint: string
}) {
  const daily = data.py.activity.daily
  if (daily.length === 0) {
    return <ChartEmpty hint={emptyHint} reason={EMPTY_SERIES_REASON} />
  }

  const rows = daily.map((p) => ({
    date: p.date,
    dau: p.dau,
    dauSmooth7: p.dauSmooth7,
  }))

  /* 当前时间窗口的起点。图上会画一条竖线标出来——
     不画的话，读者没法知道自己看的这一段对应整条曲线的哪一截。 */
  const windowStart = data.startDate

  return (
    <>
      <ResponsiveContainer width="100%" height={264}>
        <LineChart data={rows} margin={{ top: 8, right: 16, bottom: 4, left: 0 }}>
          <CartesianGrid stroke={CHART_INK.grid} vertical={false} />
          <XAxis
            dataKey="date"
            tick={{ fill: CHART_INK.tick, fontSize: 10.5 }}
            tickLine={false}
            axisLine={{ stroke: CHART_INK.axis }}
            interval={9}
            tickFormatter={(d: string) => d.slice(5)}
            tickMargin={8}
          />
          <YAxis
            domain={['dataMin - 300', 'dataMax + 300']}
            tick={{ fill: CHART_INK.tick, fontSize: 11 }}
            tickLine={false}
            axisLine={false}
            width={52}
            tickFormatter={(v: number) => formatCount(v)}
          />
          <Tooltip
            cursor={{ stroke: CHART_INK.axis, strokeWidth: 1 }}
            content={
              <ChartTooltip valueFormatter={(v) => `${withThousands(Math.round(v))} 人`} />
            }
          />
          <Line
            type="monotone"
            dataKey="dau"
            name="当日 DAU"
            stroke="#bcd4f2"
            strokeWidth={1.6}
            dot={false}
            isAnimationActive={false}
          />
          <Line
            type="monotone"
            dataKey="dauSmooth7"
            name="7 日移动平均"
            stroke={SERIES_PRIMARY}
            strokeWidth={2.4}
            dot={false}
            connectNulls={false}
            isAnimationActive={false}
          />
        </LineChart>
      </ResponsiveContainer>

      <p className="mt-1.5 px-1 text-[11px] leading-relaxed text-ink-3">
        这 60 天里，从 {windowStart} 起是你刚才选的时间窗口（近 {days} 天）。
        整段 60 天的曲线来自离线跑好的 Pandas 结果，不随窗口切换而变——
        这么做是为了让趋势的完整形状始终看得见。
      </p>

      <div className="mt-2">
        <DataTable
          columns={[
            { key: 'date', label: '日期' },
            { key: 'dau', label: '当日 DAU', align: 'right', format: (v) => formatCount(Number(v)) },
            {
              key: 'dauSmooth7',
              label: '7 日移动平均',
              align: 'right',
              format: (v) => (v === '—' ? '—' : formatCount(Number(v))),
            },
          ]}
          rows={daily.map((p) => ({
            date: p.date,
            dau: p.dau,
            dauSmooth7: p.dauSmooth7 === null ? '—' : Math.round(p.dauSmooth7),
          }))}
          maxHeight={280}
          footnote="前 6 天不足 7 个点，算不出移动平均，所以是「—」。"
        />
      </div>
    </>
  )
}

/* --------------------------------------------------------------------------
   二、各年龄段活跃率
   -------------------------------------------------------------------------- */

/** 一行：年龄段 + 活跃率。这张图的数据来自 SQL 的真实查询结果。 */
export interface AgeRateRow {
  age_group: string
  active_rate: number
  total_users: number
  active_user_days: number
}

export function AgeActiveRateChart({
  rows,
  emptyHint,
}: {
  rows: AgeRateRow[]
  emptyHint: string
}) {
  if (rows.length === 0) {
    return <ChartEmpty hint={emptyHint} reason={EMPTY_SERIES_REASON} />
  }

  const max = Math.max(...rows.map((r) => r.active_rate))

  return (
    <>
      <ResponsiveContainer width="100%" height={244}>
        <BarChart data={rows} margin={{ top: 22, right: 8, bottom: 0, left: 0 }}>
          <CartesianGrid stroke={CHART_INK.grid} vertical={false} />
          <XAxis
            dataKey="age_group"
            tick={{ fill: CHART_INK.tick, fontSize: 10.5 }}
            tickLine={false}
            axisLine={{ stroke: CHART_INK.axis }}
            tickMargin={8}
            interval={0}
          />
          <YAxis
            domain={[0, Math.ceil((max * 1.22) / 5) * 5]}
            tickFormatter={(v: number) => `${v}%`}
            tick={{ fill: CHART_INK.tick, fontSize: 11 }}
            tickLine={false}
            axisLine={false}
            width={44}
          />
          <Tooltip
            cursor={{ fill: 'rgba(15,23,42,0.04)' }}
            content={<ChartTooltip valueFormatter={(v) => formatPercent(v, 2)} />}
          />
          {/* 年龄段本身有先后顺序，所以用「浅 → 深」的递进色阶，
              和用户分析页、首页用的是同一组颜色 */}
          <Bar
            dataKey="active_rate"
            name="活跃率"
            radius={[4, 4, 0, 0]}
            barSize={44}
            isAnimationActive={false}
          >
            {rows.map((r, i) => (
              <Cell key={r.age_group} fill={AGE_RAMP[i % AGE_RAMP.length]} />
            ))}
            <LabelList
              dataKey="active_rate"
              position="top"
              fill={CHART_INK.value}
              fontSize={10.5}
              formatter={(v: unknown) => formatPercent(Number(v), 1)}
            />
          </Bar>
        </BarChart>
      </ResponsiveContainer>

      <div className="mt-2">
        <DataTable
          columns={[
            { key: 'age_group', label: '年龄段' },
            {
              key: 'total_users',
              label: '用户数',
              align: 'right',
              format: (v) => formatCount(Number(v)),
            },
            {
              key: 'active_user_days',
              label: '活跃人天',
              align: 'right',
              format: (v) => formatCount(Number(v)),
            },
            {
              key: 'active_rate',
              label: '活跃率',
              align: 'right',
              bar: true,
              format: (v) => formatPercent(Number(v), 2),
            },
          ]}
          rows={rows.map((r) => ({ ...r }))}
          maxHeight={220}
          footnote="活跃率 = 窗口内的活跃人天 ÷（该年龄段用户数 × 天数）。这张表来自 SQL 的真实查询结果，不是算好的常量。"
        />
      </div>
    </>
  )
}

/* --------------------------------------------------------------------------
   三、内容偏好排名（Demo 2）
   -------------------------------------------------------------------------- */

/** 一行：分区 + 观看次数 + 年龄段内占比。来自案例 06 的真查询结果。 */
export interface AgeShareRow {
  category: string
  view_count: number
  share_pct: number
  age_total: number
}

/**
 * 横向排名条形图：8 个分区按占比从高到低。
 *
 * ★ 柱子按【分区自己的固定色】上色（categoryColor），不是单色。
 *   这和「用户 × 内容」页的气泡图、TOP3 卡片是同一套配色 ——
 *   同一个分区在哪个页面都是同一个颜色，眼睛不用重新认一遍。
 *   （theme.ts 里说的「只有一个指标就用单色」，指的是【类别本身没有身份】的场合，
 *     比如「播放量最高的 8 个视频」。这里 8 根柱子就是 8 个有名有姓的分区，
 *     颜色是它们的身份。）
 *
 * ★ 图上必须有一条均分虚线。没有它，读者看到「游戏 30%」只会觉得"好高"，
 *   有了它才知道「比平均线高出一倍多」到底意味着什么。
 */
export function AgeCategoryShareChart({
  rows,
  ageLabel,
  days,
  emptyHint,
}: {
  rows: AgeShareRow[]
  ageLabel: string
  days: number
  emptyHint: string
}) {
  if (rows.length === 0) {
    return <ChartEmpty hint={emptyHint} reason={EMPTY_SERIES_REASON} />
  }

  const max = Math.max(...rows.map((r) => r.share_pct))
  const totalViews = rows[0].age_total

  return (
    <>
      <p className="mb-2 text-[11.5px] leading-relaxed text-ink-2">
        {ageLabel}用户近 {days} 天一共看了{' '}
        <strong className="font-semibold text-ink">{withThousands(totalViews)}</strong> 次，
        按分区拆开就是下面 8 条。分母是这一档人【自己】的总次数，所以八条加起来正好 100%。
      </p>

      <ResponsiveContainer width="100%" height={264}>
        <BarChart
          data={rows}
          layout="vertical"
          margin={{ top: 18, right: 58, bottom: 0, left: 0 }}
        >
          <CartesianGrid stroke={CHART_INK.grid} horizontal={false} />
          <XAxis
            type="number"
            domain={[0, Math.ceil((max * 1.18) / 5) * 5]}
            tickFormatter={(v: number) => `${v}%`}
            tick={{ fill: CHART_INK.tick, fontSize: 11 }}
            tickLine={false}
            axisLine={{ stroke: CHART_INK.axis }}
          />
          <YAxis
            type="category"
            dataKey="category"
            tick={{ fill: CHART_INK.tick, fontSize: 11.5 }}
            tickLine={false}
            axisLine={false}
            width={46}
          />
          <Tooltip
            cursor={{ fill: 'rgba(15,23,42,0.04)' }}
            content={<ChartTooltip valueFormatter={(v) => formatPercent(v, 2)} />}
          />
          {/* 均分线：8 个分区完全平均的话每个就是 12.5% */}
          <ReferenceLine
            x={EVEN_SHARE_PCT}
            stroke={CHART_INK.axis}
            strokeDasharray="4 3"
            label={{
              value: `均分线 ${EVEN_SHARE_PCT}%`,
              position: 'top',
              fill: CHART_INK.label,
              fontSize: 10.5,
            }}
          />
          <Bar
            dataKey="share_pct"
            name="年龄段内占比"
            radius={[0, 4, 4, 0]}
            barSize={16}
            isAnimationActive={false}
          >
            {rows.map((r) => (
              /* 分区名 → 固定槽位 → 固定颜色。认不得的分区会落到槽位 1，
                 拿到一个确定的颜色，不会画出没有颜色的柱子。 */
              <Cell
                key={r.category}
                fill={categoryColor(categorySlot(r.category as CategoryName))}
              />
            ))}
            <LabelList
              dataKey="share_pct"
              position="right"
              fill={CHART_INK.value}
              fontSize={10.5}
              formatter={(v: unknown) => formatPercent(Number(v), 2)}
            />
          </Bar>
        </BarChart>
      </ResponsiveContainer>

      {/* 分区名已经标在纵轴上了，不再另画图例 —— 图例只在「图上没有文字标签」时才必要 */}
      <div className="mt-2">
        <DataTable
          columns={[
            { key: 'category', label: '内容分区' },
            {
              key: 'view_count',
              label: '观看次数',
              align: 'right',
              format: (v) => withThousands(Number(v)),
            },
            {
              key: 'share_pct',
              label: '年龄段内占比',
              align: 'right',
              bar: true,
              format: (v) => formatPercent(Number(v), 2),
            },
          ]}
          rows={rows.map((r) => ({ ...r }))}
          maxHeight={240}
          footnote={
            '占比 = 该分区的观看次数 ÷ 这一档人的观看次数合计。' +
            '这张表来自 SQL 的真实查询结果，同一批数字在离线跑过的 Pandas 结果里也算过一遍。'
          }
        />
      </div>
    </>
  )
}

/* --------------------------------------------------------------------------
   四、设定权重 vs 实测占比（Demo 2）
   -------------------------------------------------------------------------- */

/** 一行两段的百分比条。宽的给直觉，右边的数字给准确值。 */
function DiffBar({ value, max, color }: { value: number; max: number; color: string }) {
  const pct = max > 0 ? Math.max(2, (value / max) * 100) : 0
  return (
    <span
      className="inline-block h-[7px] shrink-0 rounded-full"
      style={{ width: `${pct * 0.62}px`, background: color }}
      aria-hidden="true"
    />
  )
}

/**
 * 「设定权重 vs 实测占比」对照表。
 *
 * ★ 这张表是这一页最有力的东西，所以它【不能只是一堆数字】。
 *   每一行并排放两条一样长的条：一条是生成数据时写下的权重，
 *   一条是真跑出来的占比。读者扫一眼看到「两条几乎一样长」，
 *   就已经明白了结论；数字和偏差那一列是用来确认的，不是用来发现的。
 *
 * ★ 顺序跟着传进来的 rows（已按实测占比降序）。这样「权重」那一列自上而下
 *   也基本是递减的 —— 两列一起单调，正是「这张排名就是那张权重表量出来的」这句话的证据。
 */
export function WeightVsActualTable({
  rows,
  ageLabel,
  days,
  emptyHint,
}: {
  rows: WeightCompareRow[]
  ageLabel: string
  days: number
  emptyHint: string
}) {
  if (rows.length === 0) {
    return <ChartEmpty hint={emptyHint} reason={EMPTY_SERIES_REASON} />
  }

  const max = Math.max(...rows.map((r) => Math.max(r.weight, r.share)))
  const worst = maxDeviationRow(rows)

  return (
    <div>
      <p className="mb-2 text-[11.5px] leading-relaxed text-ink-2">
        「设定权重」是 src/data/dataset.ts 里生成这份数据时写下的参数，
        「实测占比」是近 {days} 天真跑出来的结果。每行两条同色系的条并排，
        长度一样长就意味着：这一档人的口味，和当初写进生成器的参数是同一件事。
      </p>

      <div className="overflow-hidden rounded-lg border border-hairline">
        <table className="w-full border-collapse text-[12.5px]">
          <thead className="bg-plane">
            <tr>
              <th className="border-b border-hairline px-3 py-2 text-left text-[11.5px] font-semibold text-ink-2">
                内容分区
              </th>
              <th className="border-b border-hairline px-3 py-2 text-right text-[11.5px] font-semibold text-ink-2">
                设定权重（生成时写下的）
              </th>
              <th className="border-b border-hairline px-3 py-2 text-right text-[11.5px] font-semibold text-ink-2">
                实测占比（{ageLabel}）
              </th>
              <th className="border-b border-hairline px-3 py-2 text-right text-[11.5px] font-semibold text-ink-2">
                偏差
              </th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => {
              const color = categoryColor(categorySlot(r.category as CategoryName))
              return (
                <tr key={r.category} className="odd:bg-card even:bg-plane/50">
                  <td className="whitespace-nowrap border-b border-hairline/70 px-3 py-1.5">
                    <span className="inline-flex items-center gap-2">
                      <span
                        className="h-2.5 w-2.5 shrink-0 rounded-full"
                        style={{ background: color }}
                        aria-hidden="true"
                      />
                      <span className="text-ink">{r.category}</span>
                    </span>
                  </td>
                  <td className="whitespace-nowrap border-b border-hairline/70 px-3 py-1.5 text-right tabular-nums">
                    <span className="inline-flex items-center justify-end gap-2">
                      <DiffBar value={r.weight} max={max} color="#c7d7ea" />
                      <span className="w-[42px] text-right text-ink-2">{r.weight}</span>
                    </span>
                  </td>
                  <td className="whitespace-nowrap border-b border-hairline/70 px-3 py-1.5 text-right tabular-nums">
                    <span className="inline-flex items-center justify-end gap-2">
                      <DiffBar value={r.share} max={max} color={color} />
                      <span className="w-[58px] text-right text-ink">
                        {formatPercent(r.share, 2)}
                      </span>
                    </span>
                  </td>
                  <td
                    className="whitespace-nowrap border-b border-hairline/70 px-3 py-1.5 text-right tabular-nums text-ink-2"
                    /* 偏差的正负号要留着：只写 0.30 看不出是高了还是低了 */
                  >
                    {r.diff >= 0 ? '+' : '−'}
                    {Math.abs(r.diff).toFixed(2)}
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>

      {worst && (
        <p className="mt-2 text-[11px] leading-relaxed text-ink-3">
          8 个分区里偏差最大的一项是{' '}
          <span className="font-semibold text-ink-2">
            {worst.category}（设定 {worst.weight}，实测 {formatPercent(worst.share, 2)}，
            相差 {Math.abs(worst.diff).toFixed(2)} 个百分点）
          </span>
          ，其余 7 项都在它以内。
          「偏差」的单位是百分点（实测 − 设定），不是百分比 ——
          设定 30、实测 30.30 时写的是 +0.30，不是「高了 0.30%」。
          这张表只说明一件事：这份「偏好排名」是数据生成时就设定好的，
          不是从数据里发现的。
        </p>
      )}
    </div>
  )
}

/* --------------------------------------------------------------------------
   五、内容分区的增长对比（Demo 3）
   -------------------------------------------------------------------------- */

/** 一行：分区 + 两段日均 + 增长率。来自那条真跑的 SQL。 */
export interface CategoryGrowthRow {
  category: string
  first_views: number
  second_views: number
  first_daily_views: number
  second_daily_views: number
  /** 前半段一次都没被看过时是 null（SQL 里也是 NULL） */
  growth_pct: number | null
}

/**
 * 直接标在柱子末端的百分比。
 *
 * ★ 为什么不用 LabelList 的 position：
 *   position 是「整张图一个值」，而正负两个方向要往相反的两边放标签 ——
 *   正数放右边、负数放左边。所以只能自己算位置。
 *
 * ★ 为什么用 min/max 取两端而不是直接 x + width：
 *   Recharts 传进来的 x / width 是「柱子的包围盒」还是「带方向的有符号宽度」，
 *   在不同版本、不同 layout 下并不一致。取两端之后两种约定都对得上，
 *   而取错了【不会报错】，只会让标签静静地飘在错误的位置上。
 *
 * 拿不到有限的几何信息就返回 null，什么都不画 —— 绝不让 NaN 传到 SVG 属性上。
 */
function GrowthLabel(props: {
  /* Recharts 自己的类型里这几个字段是 string | number，一律 Number() 收一遍 */
  x?: number | string
  y?: number | string
  width?: number | string
  height?: number | string
  /*
    value 声明成 unknown 是刻意的：Recharts 的值类型是它自己的 RenderableText
    （string / number / null / false 都可能），跟着它一步步放宽反而更难读。
    Number() 本来什么都能收，所以这里放宽，取值时再逐个检查。
  */
  value?: unknown
}) {
  const x = Number(props.x)
  const y = Number(props.y)
  const width = Number(props.width)
  const height = Number(props.height)
  if (![x, y, width, height].every((n) => Number.isFinite(n))) {
    return null
  }

  const v = Number(props.value)
  /* 值为 0 或空的分区没有柱子，也就不该有标签 */
  if (!Number.isFinite(v) || v === 0) return null

  const left = Math.min(x, x + width)
  const right = Math.max(x, x + width)
  const positive = v > 0

  return (
    <text
      x={positive ? right + 5 : left - 5}
      y={y + height / 2}
      dy={4}
      textAnchor={positive ? 'start' : 'end'}
      fill={CHART_INK.value}
      fontSize={10.5}
    >
      {formatDelta(v, 2)}
    </text>
  )
}

/**
 * 正负分色的横向条形图：柱子从 0 线出发，涨往右、跌往左。
 *
 * ★ 为什么按【涨跌】上色，而不是按分区上色（「用户 × 内容」页那套 8 色）：
 *   这张图要传达的第一件事是方向，不是身份 —— 分区名已经写在纵轴上了，
 *   再用颜色重复一遍分区、把方向交给柱子朝向，读起来要多绕一步。
 *   颜色取自 theme 的 STATUS_COLOR，和 KPI 卡片上的涨跌徽标是同一组色。
 *
 * ★ 两张「辅助阅读」的东西都画了：
 *   一条 0 线（没有它，读者不知道柱子是从哪儿开始算的），
 *   一段「两段的周末构成」（近 7 天窗口下 8 个分区全是负的，原因就在这里）。
 */
export function CategoryGrowthChart({
  rows,
  data,
  days,
  emptyHint,
}: {
  rows: CategoryGrowthRow[]
  data: AnalysisData
  days: number
  emptyHint: string
}) {
  const trend = data.py.windows[String(days)]?.categoryTrend
  if (!trend || rows.length === 0) {
    return <ChartEmpty hint={emptyHint} reason={EMPTY_SERIES_REASON} />
  }

  const mix = halfWindowMix(trend)
  const ratio = weekendViewRatio(data.py)

  /* 用和结果表、结论模板同一个顺序：增长率从高到低，算不出来的排最后 */
  const sorted = [...rows].sort((a, b) => {
    if (a.growth_pct === null && b.growth_pct === null) return 0
    if (a.growth_pct === null) return 1
    if (b.growth_pct === null) return -1
    return b.growth_pct - a.growth_pct
  })

  const values = sorted
    .map((r) => r.growth_pct)
    .filter((v): v is number => v !== null && v !== 0)
  if (values.length === 0) {
    return <ChartEmpty hint={emptyHint} reason={EMPTY_SERIES_REASON} />
  }

  /* 0 一定要在定义域里 —— 0 线是这张图的基准，被裁掉就没法读了 */
  const max = Math.max(0, ...values)
  const min = Math.min(0, ...values)
  const pad = Math.max(1, (max - min) * 0.16)

  const chartRows = sorted.map((r) => ({ category: r.category, growth_pct: r.growth_pct }))

  return (
    <>
      <p className="mb-2 text-[11.5px] leading-relaxed text-ink-2">
        近 {days} 天从中间对半切开：前半段{' '}
        <strong className="font-semibold text-ink">
          {mix.firstStart} ~ {mix.firstEnd}
        </strong>
        （{mix.firstDays} 天），后半段{' '}
        <strong className="font-semibold text-ink">
          {mix.secondStart} ~ {mix.secondEnd}
        </strong>
        （{mix.secondDays} 天）。每根柱子一个内容分区，比的是它在这两段里的
        <strong className="font-semibold text-ink">日均播放量</strong>。
      </p>

      <ResponsiveContainer width="100%" height={288}>
        <BarChart
          data={chartRows}
          layout="vertical"
          margin={{ top: 18, right: 70, bottom: 0, left: 0 }}
        >
          <CartesianGrid stroke={CHART_INK.grid} horizontal={false} />
          <XAxis
            type="number"
            domain={[min - pad, max + pad]}
            tickFormatter={(v: number) => `${v.toFixed(0)}%`}
            tick={{ fill: CHART_INK.tick, fontSize: 11 }}
            tickLine={false}
            axisLine={{ stroke: CHART_INK.axis }}
          />
          <YAxis
            type="category"
            dataKey="category"
            tick={{ fill: CHART_INK.tick, fontSize: 11.5 }}
            tickLine={false}
            axisLine={false}
            width={46}
          />
          <Tooltip
            cursor={{ fill: 'rgba(15,23,42,0.04)' }}
            content={<ChartTooltip valueFormatter={(v) => formatDelta(v, 2)} />}
          />
          {/* 0 线 = 前后两段一模一样。柱子从它出发往两边伸 */}
          <ReferenceLine
            x={0}
            stroke={CHART_INK.axis}
            strokeWidth={1.2}
            label={{
              value: '0 线',
              position: 'top',
              fill: CHART_INK.label,
              fontSize: 10.5,
            }}
          />
          <Bar
            dataKey="growth_pct"
            name="日均播放量变化"
            barSize={16}
            isAnimationActive={false}
          >
            {chartRows.map((r) => (
              <Cell
                key={r.category}
                fill={(r.growth_pct ?? 0) >= 0 ? STATUS_COLOR.up : STATUS_COLOR.down}
              />
            ))}
            <LabelList dataKey="growth_pct" content={GrowthLabel} />
          </Bar>
        </BarChart>
      </ResponsiveContainer>

      {/* 这张图最容易被误读的地方，就在图下面直接说清楚 */}
      <p className="mt-2 rounded-lg bg-plane px-3 py-2 text-[11.5px] leading-relaxed text-ink-2">
        <span className="font-semibold text-ink">上面的排名有多少是「周末」造成的：</span>
        前半段 {mix.firstDays} 天里有{' '}
        <span className="font-semibold text-ink-2">{mix.firstWeekendDays} 天</span> 是周末，
        后半段 {mix.secondDays} 天里有{' '}
        <span className="font-semibold text-ink-2">{mix.secondWeekendDays} 天</span> 是周末。
        {ratio !== null ? (
          <>
            {' '}
            而这份数据里，周末的日均播放量是工作日（周一至周四）的{' '}
            <span className="font-semibold text-ink-2">{ratio.toFixed(3)} 倍</span>。
          </>
        ) : null}
        {ratio !== null && mix.firstWeekendDays !== mix.secondWeekendDays ? (
          <>
            {' '}
            两段的周末天数不一样多，这个差值会直接体现在上面的柱子上 ——
            它测的不全是内容本身的变化。
          </>
        ) : null}
      </p>

      <div className="mt-2">
        <DataTable
          columns={[
            { key: 'category', label: '内容分区' },
            {
              key: 'first_daily_views',
              label: '前半段日均',
              align: 'right',
              format: (v) => Number(v).toFixed(1),
            },
            {
              key: 'second_daily_views',
              label: '后半段日均',
              align: 'right',
              format: (v) => Number(v).toFixed(1),
            },
            {
              key: 'growth_pct',
              label: '增长率',
              align: 'right',
              format: (v) => (v === '—' ? '—' : formatDelta(Number(v), 2)),
            },
          ]}
          rows={sorted.map((r) => ({
            category: r.category,
            first_daily_views: r.first_daily_views,
            second_daily_views: r.second_daily_views,
            growth_pct: r.growth_pct === null ? '—' : r.growth_pct,
          }))}
          maxHeight={248}
          footnote="单位是「次/天」。这张表来自 SQL 的真实查询结果，同一批数字在离线跑过的 Pandas 结果里也算过一遍（见下面的交叉验证）。"
        />
      </div>
    </>
  )
}

/* --------------------------------------------------------------------------
   六、内容分区完播率排名（Demo 3）
   -------------------------------------------------------------------------- */

/** 一行：分区 + 完成的次数 + 播放次数 + 完成率。数据来自 SQL 的真实查询结果。 */
export interface CompletionRankRow {
  category: string
  completed: number
  views: number
  rate_pct: number
}

/**
 * 各分区的完成率排名。
 *
 * ★ 为什么用【分区色】而不是「高低色」：
 *   这一页的前两张排名图（内容偏好、增长对比）已经确立了「颜色 = 分区身份」，
 *   同一个分区在哪个页面上都是同一个颜色。这里再换一套配色，
 *   读者就得重新学一遍颜色的意思。
 *
 * ★ 图上的虚线是「全站完成率」，不是 12.5% 那种均分线。
 *   这一张比的是比例，8 个分区如果完全一样，每个分区都会等于全站完成率 ——
 *   所以全站完成率就是这张图的「没有差异」基准线。没有它，
 *   读者看到「15.16%」不知道算高还是算低。
 */
export function CompletionRankChart({
  rows,
  days,
  emptyHint,
}: {
  rows: CompletionRankRow[]
  days: number
  emptyHint: string
}) {
  if (rows.length === 0) {
    return <ChartEmpty hint={emptyHint} reason={EMPTY_SERIES_REASON} />
  }

  /* 排序在这里做一次。和结论模板、结果表用同一个顺序（都按 rate_pct 降序）——
     三处各排一次的话，迟早出现「图上第一名和结论里说的第一名不是同一个」，
     而且不报错、不抛异常，只是自相矛盾。 */
  const sorted = [...rows].sort((a, b) => b.rate_pct - a.rate_pct)

  const totalCompleted = sorted.reduce((s, r) => s + r.completed, 0)
  const totalViews = sorted.reduce((s, r) => s + r.views, 0)
  const overall = totalViews > 0 ? (totalCompleted / totalViews) * 100 : 0

  const max = Math.max(...sorted.map((r) => r.rate_pct))

  return (
    <>
      <p className="mb-2 text-[11.5px] leading-relaxed text-ink-2">
        近 {days} 天，8 个内容分区一共被播放{' '}
        <strong className="font-semibold text-ink">{withThousands(totalViews)}</strong> 次，
        其中{' '}
        <strong className="font-semibold text-ink">{withThousands(totalCompleted)}</strong>{' '}
        次是「看完」的。判定「看完」的口径是：实际观看时长 ≥ 视频时长 ×{' '}
        <strong className="font-semibold text-ink">{COMPLETION_THRESHOLD}</strong>
        ，且视频时长大于 0。这个阈值来自 <code className="text-[11px]">metrics.ts</code>，
        和前面几页的「高完成度观看」是同一个数。
      </p>

      <ResponsiveContainer width="100%" height={264}>
        <BarChart
          data={sorted}
          layout="vertical"
          margin={{ top: 18, right: 62, bottom: 0, left: 0 }}
        >
          <CartesianGrid stroke={CHART_INK.grid} horizontal={false} />
          <XAxis
            type="number"
            /* 从 0 起 —— 这张图的柱长就是比例本身，截掉起点会让差距看起来失真 */
            domain={[0, Math.ceil((max * 1.18) / 2) * 2]}
            tickFormatter={(v: number) => `${v}%`}
            tick={{ fill: CHART_INK.tick, fontSize: 11 }}
            tickLine={false}
            axisLine={{ stroke: CHART_INK.axis }}
          />
          <YAxis
            type="category"
            dataKey="category"
            tick={{ fill: CHART_INK.tick, fontSize: 11.5 }}
            tickLine={false}
            axisLine={false}
            width={46}
          />
          <Tooltip
            cursor={{ fill: 'rgba(15,23,42,0.04)' }}
            content={<ChartTooltip valueFormatter={(v) => formatPercent(v, 2)} />}
          />
          {/* 全站完成率 = 8 个分区毫无差别时的那个值，也就是这张图的「平均水位」 */}
          <ReferenceLine
            x={overall}
            stroke={CHART_INK.axis}
            strokeDasharray="4 3"
            label={{
              value: `全站 ${overall.toFixed(2)}%`,
              position: 'top',
              fill: CHART_INK.label,
              fontSize: 10.5,
            }}
          />
          <Bar dataKey="rate_pct" name="观看完成率" radius={[0, 4, 4, 0]} barSize={16} isAnimationActive={false}>
            {sorted.map((r) => (
              /* 分区名 → 固定槽位 → 固定颜色。认不得的分区会落到槽位 1，
                 拿到一个确定的颜色，不会画出没有颜色的柱子。 */
              <Cell
                key={r.category}
                fill={categoryColor(categorySlot(r.category as CategoryName))}
              />
            ))}
            <LabelList
              dataKey="rate_pct"
              position="right"
              fill={CHART_INK.value}
              fontSize={10.5}
              formatter={(v: unknown) => formatPercent(Number(v), 2)}
            />
          </Bar>
        </BarChart>
      </ResponsiveContainer>

      {/* 这张图最容易被误读的地方，就在图下面直接说清楚 */}
      <p className="mt-2 rounded-lg bg-plane px-3 py-2 text-[11.5px] leading-relaxed text-ink-2">
        <span className="font-semibold text-ink">这张榜的名次会随时间窗口翻：</span>
        前几名之间只差零点几个百分点，换个窗口先后就会变。所以别把相邻两名当成有意义的排序 ——
        唯一在三个窗口里都稳的是垫底那个分区。另外，分区之间的差距有相当一部分只是
        <span className="font-semibold text-ink-2">「看的人不一样」</span>
        （各分区的观众年龄构成不同），不全是内容本身好不好。下面「业务洞察」第 1 条做了逐项对照。
      </p>

      <div className="mt-2">
        <DataTable
          columns={[
            { key: 'category', label: '内容分区' },
            {
              key: 'rate_pct',
              label: '完成率',
              align: 'right',
              bar: true,
              format: (v) => formatPercent(Number(v), 2),
            },
            {
              key: 'completed',
              label: '高完成度观看',
              align: 'right',
              format: (v) => formatCount(Number(v)),
            },
            {
              key: 'views',
              label: '播放次数',
              align: 'right',
              format: (v) => formatCount(Number(v)),
            },
          ]}
          rows={sorted.map((r) => ({ ...r }))}
          maxHeight={248}
          footnote={
            '完成率 = 该分区的高完成度观看次数 ÷ 该分区的播放次数。' +
            '这张表来自 SQL 的真实查询结果，同一批数字在离线跑过的 Pandas 结果里也算过一遍' +
            '（见下面的交叉验证）。'
          }
        />
      </div>
    </>
  )
}

/* --------------------------------------------------------------------------
   六、各年龄段的前后半段活跃率（Demo 5）
   -------------------------------------------------------------------------- */

export interface SegmentRateRow {
  age_group: AgeGroupId
  total_users: number
  first_daily_active_rate: number
  second_daily_active_rate: number
  change_pp: number
}

/**
 * SQL 返回的年龄只是个字符串。这里把它收回成 AgeGroupId。
 *
 * ★ 为什么敢断言：那条 SQL 的年龄段标签用的是 CASE WHEN 表达式
 *   （和 SQL 分析页案例 03 共用同一份），四个取值是写死的
 *   '18-24' / '25-31' / '32-40' / '40+'，不可能冒出第五个。
 * ★ 为什么真冒出第五个也不会出事：ageGroupLabel 找不到定义时会【原样显示】，
 *   不会崩，也不会安安静静显示成另一个年龄段（后者才是要命的）。
 */
const asAgeGroup = (value: unknown): AgeGroupId => String(value) as AgeGroupId

/**
 * 4 个年龄段 × 前后两段的【日均活跃率】。
 *
 * ★ 为什么不画成「一根柱子 + 变化率」：这一问要回答的是「谁在下降」，
 *   而「下降」只有把两个时点摆在一起才看得见。只画一个变化率的话，
 *   起点高低完全看不见 —— 而这份数据里「跌得多的」恰恰是起点高的那几档，
 *   看不见起点就会把「放大效应」误读成「这群人出了问题」。
 *
 * ★ 为什么必须有那段「星期构成」的说明：
 *   两段天数不等（近 7 天切出来是 3 天 vs 4 天），而且周末的活跃度明显更高。
 *   不说这件事，读者会把柱子高低全当成人群自己的变化。
 */
export function SegmentActiveRateChart({
  rows,
  data,
  days,
  emptyHint,
}: {
  rows: SegmentRateRow[]
  data: AnalysisData
  days: number
  emptyHint: string
}) {
  /* 两段的日期与星期构成。读的是离线 Pandas 结果 —— 和结论模板同一份实现，
     所以不会出现「结论说 2 天、图上说 1 天」这种自相矛盾。 */
  const seg = data.py.windows[String(days)]?.segmentTrend

  if (rows.length === 0) {
    return <ChartEmpty hint={emptyHint} reason={EMPTY_SERIES_REASON} />
  }

  /* 横轴按 AGE_GROUP_IDS 的固定顺序排，不按字母排、也不按 SQL 的返回顺序 ——
     四个页面上的年龄段顺序必须一致，否则眼睛换个页面就得重新认一遍。 */
  const sorted = [...rows].sort(
    (a, b) => AGE_GROUP_IDS.indexOf(a.age_group) - AGE_GROUP_IDS.indexOf(b.age_group),
  )

  const chartRows = sorted.map((r) => ({
    age: ageGroupLabel(r.age_group),
    first: r.first_daily_active_rate,
    second: r.second_daily_active_rate,
  }))

  const max = Math.max(
    ...sorted.map((r) => Math.max(r.first_daily_active_rate, r.second_daily_active_rate)),
  )
  const mix = seg ? halfWindowMix(seg) : null

  return (
    <>
      <p className="mb-2 text-[11.5px] leading-relaxed text-ink-2">
        近 {days} 天从中间对半切开
        {mix ? (
          <>
            ：前半段{' '}
            <strong className="font-semibold text-ink">
              {mix.firstStart} ~ {mix.firstEnd}
            </strong>
            （{mix.firstDays} 天），后半段{' '}
            <strong className="font-semibold text-ink">
              {mix.secondStart} ~ {mix.secondEnd}
            </strong>
            （{mix.secondDays} 天）
          </>
        ) : null}
        。每个年龄段两根柱子：<span className="text-ink-2">浅色是前半段</span>、
        <span className="font-semibold text-ink">深色是后半段</span>，
        比的是它在这两段里的<strong className="font-semibold text-ink">日均活跃率</strong>。
      </p>

      <ResponsiveContainer width="100%" height={272}>
        <BarChart data={chartRows} margin={{ top: 20, right: 12, bottom: 0, left: 0 }}>
          <CartesianGrid stroke={CHART_INK.grid} vertical={false} />
          <XAxis
            dataKey="age"
            tick={{ fill: CHART_INK.tick, fontSize: 11.5 }}
            tickLine={false}
            axisLine={{ stroke: CHART_INK.axis }}
          />
          <YAxis
            /* 从 0 起：柱长就是活跃率本身，截掉起点会让差距看起来失真 */
            domain={[0, Math.ceil((max * 1.22) / 5) * 5]}
            tickFormatter={(v: number) => `${v}%`}
            tick={{ fill: CHART_INK.tick, fontSize: 11 }}
            tickLine={false}
            axisLine={{ stroke: CHART_INK.axis }}
            width={44}
          />
          <Tooltip
            cursor={{ fill: 'rgba(15,23,42,0.04)' }}
            content={<ChartTooltip valueFormatter={(v) => formatPercent(v, 2)} />}
          />
          {/* 同一族色的浅 → 深，表示时间的先后。用有序色阶而不是两个随便的
              不同色相：这里两个系列是【同一种东西的两个时点】，
              不是两个互不相干的类别。 */}
          <Bar
            dataKey="first"
            name="前半段"
            fill={categoryColor(1)}
            radius={[4, 4, 0, 0]}
            barSize={30}
            isAnimationActive={false}
          >
            <LabelList
              dataKey="first"
              position="top"
              fill={CHART_INK.value}
              fontSize={10.5}
              formatter={(v: unknown) => formatPercent(Number(v), 1)}
            />
          </Bar>
          <Bar
            dataKey="second"
            name="后半段"
            fill={categoryColor(3)}
            radius={[4, 4, 0, 0]}
            barSize={30}
            isAnimationActive={false}
          >
            <LabelList
              dataKey="second"
              position="top"
              fill={CHART_INK.value}
              fontSize={10.5}
              formatter={(v: unknown) => formatPercent(Number(v), 1)}
            />
          </Bar>
        </BarChart>
      </ResponsiveContainer>

      {/* 这张图最容易被误读的地方，就在图下面直接说清楚 */}
      <p className="mt-2 rounded-lg bg-plane px-3 py-2 text-[11.5px] leading-relaxed text-ink-2">
        <span className="font-semibold text-ink">柱子高低里有多少是「星期几」造成的：</span>
        {mix
          ? `前半段 ${mix.firstDays} 天里有 ${mix.firstWeekendDays} 天是周末，` +
            `后半段 ${mix.secondDays} 天里有 ${mix.secondWeekendDays} 天。`
          : '两段的日期构成这次没取到。'}
        这份数据在生成时给周末设了更高的活跃倍数，所以两段的周末天数不一样多时，
        柱子就会整体往一边倒 —— 那
        <strong className="font-semibold text-ink">不是</strong>人群自己在变。
        另外要盯住的是<span className="font-semibold text-ink">起点高低</span>：
        活跃率本来就高的档位，同样的相对变化在图上会显得更大，
        所以「跌得最多」很可能只是「基数最大」，不等于这群人出了问题。
      </p>

      <div className="mt-2">
        <DataTable
          columns={[
            { key: 'age_group', label: '年龄段', format: (v) => ageGroupLabel(asAgeGroup(v)) },
            {
              key: 'total_users',
              label: '总人数',
              align: 'right',
              format: (v) => formatCount(Number(v)),
            },
            {
              key: 'first_daily_active_rate',
              label: '前半段日均活跃率',
              align: 'right',
              format: (v) => formatPercent(Number(v), 2),
            },
            {
              key: 'second_daily_active_rate',
              label: '后半段日均活跃率',
              align: 'right',
              format: (v) => formatPercent(Number(v), 2),
            },
            {
              key: 'change_pp',
              label: '变化',
              align: 'right',
              format: (v) => `${formatDelta(Number(v), 2)} 个百分点`,
            },
          ]}
          rows={sorted.map((r) => ({ ...r }))}
          maxHeight={248}
          footnote={
            '活跃率 = 该年龄段这半段里的活跃人天 ÷（该年龄段总人数 × 该半段天数）——' +
            '日均口径。分母是该年龄段自己的总人数，不随窗口变，所以三个时间窗口可以横向比。' +
            '这张表来自 SQL 的真实查询结果，同一批数字在离线跑过的 Pandas 结果里也算过一遍' +
            '（见下面的交叉验证）。「变化」的单位是百分点，不是百分比。'
          }
        />
      </div>
    </>
  )
}

/* --------------------------------------------------------------------------
   七、注册表
   -------------------------------------------------------------------------- */

/** 图表 id → 渲染函数。意图里只写 id，不写组件。 */
export function ChartBoard({
  id,
  data,
  days,
  emptyHint,
}: {
  id: ChartId
  data: AnalysisData
  days: number
  /**
   * 这张图拿不到数据时该说什么。文案来自 chartMeta.ts 的 CHART_META（查表，不在这里现写）。
   *
   * ★ 设成必填：漏传是编译错误。以前这几处在拿不到数据时直接 return null，
   *   读者看到的是【一张只有标题、正文空白的卡片】，而且一句解释都没有 ——
   *   不报错、不抛异常、类型也对，正是这一页最不该有的失败形状。
   */
  emptyHint: string
}) {
  if (id === 'dauTrend') {
    return <DauTrendChart data={data} days={days} emptyHint={emptyHint} />
  }

  if (id === 'ageActiveRate') {
    const outcome = data.outcomes.find((o) => o.spec.id === 'case:age-active-rate')
    if (!outcome || outcome.status !== 'done') {
      return <ChartEmpty hint={emptyHint} reason={outcomeReason(outcome)} />
    }
    const rows: AgeRateRow[] = outcome.rows.map((r) => ({
      age_group: String(r.age_group ?? '—'),
      active_rate: Number(r.active_rate ?? 0),
      total_users: Number(r.total_users ?? 0),
      active_user_days: Number(r.active_user_days ?? 0),
    }))
    return <AgeActiveRateChart rows={rows} emptyHint={emptyHint} />
  }

  if (id === 'ageCategoryShare') {
    /* ★ 这里读的案例 id 是【从 intents.ts import 的常量】，不是手抄的字符串。
       写两遍的话，改一处漏一处，图就静静地什么都不画。 */
    const outcome = data.outcomes.find((o) => o.spec.id === AGE_CATEGORY_CASE_ID)
    if (!outcome || outcome.status !== 'done') {
      return <ChartEmpty hint={emptyHint} reason={outcomeReason(outcome)} />
    }

    const age = data.focusAge ?? DEFAULT_FOCUS_AGE
    const rows: AgeShareRow[] = outcome.rows
      /* 这条 SQL 一次返回 4 个年龄段 × 8 个分区 = 32 行。图上只画问的那一档。 */
      .filter((r) => String(r.age_group) === age)
      .map((r) => ({
        category: String(r.category ?? '—'),
        view_count: Number(r.view_count ?? 0),
        share_pct: Number(r.share_pct ?? 0),
        age_total: Number(r.age_total ?? 0),
      }))

    return (
      <AgeCategoryShareChart
        rows={rows}
        ageLabel={ageGroupLabel(age)}
        days={days}
        emptyHint={emptyHint}
      />
    )
  }

  if (id === 'weightVsActual') {
    const age = data.focusAge ?? DEFAULT_FOCUS_AGE
    const pyRow = data.py.windows[String(days)]?.agePreference.find((r) => r.age === age)
    if (!pyRow) {
      /* 这一张读的是【离线 Pandas】结果，不是 SQL 结果 ——
         所以数据库起不来时它照样画得出来，缺的是「这一档人」那一行。
         两种原因的说明文字必须分开，合成一句就是在含糊。 */
      return <ChartEmpty hint={emptyHint} reason={outcomeReason(undefined)} />
    }
    /* 页面上这张表和结论模板里那个「最大偏差」数字用的是【同一个函数】，
       不会出现「页面说 0.30、脚本算出来 0.78」这种自相矛盾。 */
    return (
      <WeightVsActualTable
        rows={buildWeightComparison(age, pyRow)}
        ageLabel={ageGroupLabel(age)}
        days={days}
        emptyHint={emptyHint}
      />
    )
  }

  if (id === 'categoryGrowth') {
    /* ★ 这里读的查询 id 是【从 sqlQueries.ts import 的常量】，不是手抄的字符串 ——
       写两遍的话，改一处漏一处，图就静静地什么都不画。 */
    const outcome = data.outcomes.find((o) => o.spec.id === CATEGORY_TREND_QUERY_ID)
    if (!outcome || outcome.status !== 'done') {
      return <ChartEmpty hint={emptyHint} reason={outcomeReason(outcome)} />
    }

    const rows: CategoryGrowthRow[] = outcome.rows.map((r) => ({
      category: String(r.category ?? '—'),
      first_views: Number(r.first_views ?? 0),
      second_views: Number(r.second_views ?? 0),
      first_daily_views: Number(r.first_daily_views ?? 0),
      second_daily_views: Number(r.second_daily_views ?? 0),
      /* SQL 里前半段为 0 时这一列是 NULL，原样当成「算不出来」传下去 */
      growth_pct:
        r.growth_pct === null || r.growth_pct === undefined ? null : Number(r.growth_pct),
    }))

    return <CategoryGrowthChart rows={rows} data={data} days={days} emptyHint={emptyHint} />
  }

  if (id === 'completionRank') {
    /* ★ 这里读的查询 id 是【从 sqlQueries.ts import 的常量】，不是手抄的字符串 ——
       写两遍的话，改一处漏一处，图就静静地什么都不画。 */
    const outcome = data.outcomes.find((o) => o.spec.id === COMPLETION_RANK_QUERY_ID)
    if (!outcome || outcome.status !== 'done') {
      return <ChartEmpty hint={emptyHint} reason={outcomeReason(outcome)} />
    }

    const rows: CompletionRankRow[] = outcome.rows.map((r) => ({
      category: String(r.category ?? '—'),
      completed: Number(r.completed ?? 0),
      views: Number(r.views ?? 0),
      rate_pct: Number(r.rate_pct ?? 0),
    }))

    return <CompletionRankChart rows={rows} days={days} emptyHint={emptyHint} />
  }

  if (id === 'segmentActiveRate') {
    /* 查询 id 同样来自 sqlQueries.ts 的常量，理由同上一条。 */
    const outcome = data.outcomes.find((o) => o.spec.id === SEGMENT_TREND_QUERY_ID)
    if (!outcome || outcome.status !== 'done') {
      return <ChartEmpty hint={emptyHint} reason={outcomeReason(outcome)} />
    }

    const rows: SegmentRateRow[] = outcome.rows.map((r) => ({
      age_group: asAgeGroup(r.age_group ?? '—'),
      total_users: Number(r.total_users ?? 0),
      first_daily_active_rate: Number(r.first_daily_active_rate ?? 0),
      second_daily_active_rate: Number(r.second_daily_active_rate ?? 0),
      change_pp: Number(r.change_pp ?? 0),
    }))

    return (
      <SegmentActiveRateChart rows={rows} data={data} days={days} emptyHint={emptyHint} />
    )
  }

  if (id === 'llmBars') {
    /* ------------------------------------------------------------------
       大模型路径唯一的那张通用图
       ------------------------------------------------------------------
       ★ 它和上面六张最大的不同：上面六张的「数据从哪条查询来」是写死的常量，
         这一张的答案【在 data.llmChart 里】—— 因为模型每次查的东西都不一样。
         那个对象是【判定式联合】而不是两个可选字段：它只可能是
         「有图可画（带 outcomeId + 两个列名）」或「没图可画（带一句原因）」，
         拼不出第三种坏组合。

       ★ 找不到 llmChart（规则路径、或者还在跑）时，走的是同一句「没图可画」——
         因为对这张图来说，这两种情况的含义是一样的：没有挑出可画的数据。
       */
    const chart = data.llmChart
    if (!chart || chart.kind !== 'chart') {
      return (
        <ChartEmpty
          hint={emptyHint}
          reason={chart?.note ?? '这一次分析还没有挑出可画的图。'}
        />
      )
    }

    const outcome = data.outcomes.find((o) => o.spec.id === chart.outcomeId)
    if (!outcome || outcome.status !== 'done') {
      return <ChartEmpty hint={emptyHint} reason={outcomeReason(outcome)} />
    }

    const rows: LlmBarRow[] = outcome.rows
      .map((r) => ({
        label: String(r[chart.labelKey] ?? '—'),
        value: Number(r[chart.valueKey]),
      }))
      /* ★ 整行丢掉，不是填 0：Number(null) 是 0、Number(undefined) 是 NaN。
         填 0 会画出一根【假的 0 柱】（看起来像「这一档是 0」），
         留着 NaN 则会让 'NaN' 直接出现在图和表上。两种都比少一行糟。 */
      .filter((r) => Number.isFinite(r.value))

    return (
      <LlmBarsChart
        rows={rows}
        labelKey={chart.labelKey}
        valueKey={chart.valueKey}
        /* ★ 卡片上必须写明这份数据出自模型的哪一次调用 ——
           不写的话，读者会以为这张图是页面为他的问题专门准备的。 */
        sourceLabel={outcome.spec.label}
        emptyHint={emptyHint}
      />
    )
  }

  /* 意图里写了一个没注册过的 id。这属于开发期错误，
     本机检查会拦住；真到了这儿就什么都不画，而不是崩掉整页。 */
  return null
}
