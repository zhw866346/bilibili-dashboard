/* ==========================================================================
   用户 × 内容机会矩阵（四个年龄段各一张小图）
   --------------------------------------------------------------------------
   普通散点图只有一个系列；这一张有 4 个年龄段 × 8 个分区 = 32 个组合。
   如果把它们全塞进一张图，32 个气泡会糊成一团，而且不悬停根本认不出谁是谁。

   所以按年龄段拆成 4 张【小倍数图】(small multiples)：
     · 每张图 8 个气泡（就是 8 个内容分区），形状和配色完全一致
     · 四张图【共用同一套坐标轴范围】，所以横向能直接比——
       "同样是游戏，18–24 岁和 40 岁以上站在完全不同的位置"这件事一眼可见
     · 分界线也共用（画在全部 32 个组合的中位数上），换图不会跳

   三个编码：
     横轴 x  = 人均观看时长（分）    → 看得深不深
     纵轴 y  = 用户覆盖率（%）       → 这个年龄段里有多少人看过
     气泡大小 = 综合互动率（%）       → 爱不爱互动

   ★ 纵轴为什么用【覆盖率】而不是【绝对人数】？
     四个年龄段人数差很多（18–24 有 1913 人，40+ 只有 857 人）。
     用绝对人数的话，40+ 那张图的八个气泡会全部贴在底下，
     比的是"这个年龄段人多人少"，而不是"这个分区在这个年龄段里吃得开不开"。
     换成覆盖率（该分区观看用户 ÷ 该年龄段观看用户），四张图才可比。
     绝对人数放在悬停提示里，需要时随时能看到。

   ★ 气泡大小为什么必须显式写 domain？
     Recharts 的 ZAxis 默认拿【本图内的最大值】当坐标上限。不写 domain 的话，
     同一个 15% 的互动率在 A 图是大气泡、在 B 图是小气泡，四张图就没法横着比，
     小倍数图的意义直接归零。所以 domain 取全部 32 个组合的互动率最大值。
   ========================================================================== */

import { useEffect, useMemo, useRef, useState } from 'react'
import {
  CartesianGrid,
  Cell,
  LabelList,
  ReferenceArea,
  ReferenceLine,
  ResponsiveContainer,
  Scatter,
  ScatterChart,
  Tooltip,
  XAxis,
  YAxis,
  ZAxis,
} from 'recharts'

import type { AgeGroupId } from '../types'
import type { OpportunityData, OpportunityPanel, OpportunityPoint } from '../data/selectors'
import { CHART_INK, categoryColor } from '../theme'
import { formatCount } from '../utils/format'

/* --------------------------------------------------------------------------
   几何常量 —— 和下面 <ScatterChart> 的 margin / 坐标轴尺寸必须保持一致。
   标签避让要算像素位置，所以这几个数只能写死在这里，改图表尺寸时记得同步改。
   -------------------------------------------------------------------------- */
const CHART_H = 236
const MARGIN = { top: 14, right: 14, bottom: 18, left: 2 }
const X_AXIS_H = 20
const Y_AXIS_W = 36

/** 绘图区（不含坐标轴）的四条边界，单位 px */
const PLOT_TOP = MARGIN.top // 14
const PLOT_BOTTOM = CHART_H - MARGIN.bottom - X_AXIS_H // 198
const PLOT_LEFT = MARGIN.left + Y_AXIS_W // 38
const PLOT_H = PLOT_BOTTOM - PLOT_TOP // 184

/** 标签外框的估算尺寸：两个汉字按 10px 字号算约 21px，留点余量 */
const LABEL_W = 28
const LABEL_H = 11
/** 标签与气泡之间的空隙 */
const LABEL_GAP = 5
/**
 * 两个标签之间要求的最小空隙。
 * 为什么不能只判「有没有重叠」：实测过，两个标签刚好差 0.5px 不重叠时，
 * 肉眼看上去就是两个字贴在一起。留 2px 余量，判定为拥挤就换位置。
 */
const LABEL_PAD = 2

/** 气泡大小的取值范围（面积，不是半径）。互动率 8.5%~24.8%，取这个区间半径约 7~17px */
const SIZE_RANGE: [number, number] = [160, 900]

/** 右上角「核心组合」那块浅底 */
const CORE_FILL = 'rgba(42,120,214,0.085)'

export default function UserContentOpportunity({
  data,
  visibleAges,
}: {
  data: OpportunityData
  /** 年龄筛选器选中的年龄段。传全部 4 个 = 没筛选 */
  visibleAges: AgeGroupId[]
}) {
  const panels = data.panels.filter((p) => visibleAges.includes(p.age))

  /*
    气泡大小的坐标上限，取【全部 32 个组合】里的最大值，而不是每张小图各取各的。
    四个面板共用这一个上限，同一档互动率才会画成同样大的气泡。
  */
  const maxEngage = Math.max(...data.allPoints.map((p) => p.size), 1)

  if (panels.length === 0 || data.allPoints.every((p) => p.x === 0 && p.y === 0)) {
    return (
      <div className="flex h-[220px] items-center justify-center text-[12.5px] text-ink-3">
        当前筛选条件下没有观看记录，无法绘制机会矩阵。
      </div>
    )
  }

  return (
    <div>
      <div className="grid grid-cols-1 gap-3 px-1 sm:grid-cols-2">
        {panels.map((panel) => (
          <Panel key={panel.age} panel={panel} data={data} maxEngage={maxEngage} />
        ))}
      </div>

      {/* 图例：8 个分区的颜色在四张图里完全一致，认一次就够 */}
      <div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-1.5 border-t border-hairline px-2 pt-3">
        {data.panels[0]?.points.map((p) => (
          <span key={p.category} className="inline-flex items-center gap-1.5 text-[11.5px] text-ink-2">
            <span
              className="h-2.5 w-2.5 shrink-0 rounded-full"
              style={{ background: categoryColor(p.slot) }}
              aria-hidden="true"
            />
            {p.category}
          </span>
        ))}
        <span className="ml-auto text-[11px] text-ink-3">
          四张图共用同一套坐标轴和分界线，所以可以直接横着比
        </span>
      </div>

      <p className="mt-2 px-2 text-[11px] leading-relaxed text-ink-3">
        <span className="font-medium text-ink-2">怎么读：</span>
        越靠右 = 这个年龄段的人在这个分区上停留越久；越靠上 = 这个年龄段里看过它的人越多；气泡越大 = 互动越强。
        右上角浅蓝底是「覆盖广 + 看得深」的核心组合。
        分界线画在<span className="font-medium text-ink-2">全部 32 个组合</span>的中位数上
        （覆盖 {data.yMedian.toFixed(1)}%、停留 {data.xMedian.toFixed(1)} 分），
        所以四张图的分区含义是一致的，换一张图线不会跳。
      </p>
    </div>
  )
}

/* -------------------------------------------------------------------------- */

function Panel({
  panel,
  data,
  maxEngage,
}: {
  panel: OpportunityPanel
  data: OpportunityData
  /** 四张图共用的互动率上限（取全部 32 个组合的最大值） */
  maxEngage: number
}) {
  const hostRef = useRef<HTMLDivElement>(null)
  const [width, setWidth] = useState(0)

  /*
    量一下这张小图的真实宽度。
    为什么要量：标签避让必须知道"两个标签的横坐标差几个像素"，
    而宽度是自适应的（大屏两列、小屏一列），算不出来，只能量。
  */
  useEffect(() => {
    const el = hostRef.current
    if (!el) return
    const ro = new ResizeObserver((entries) => {
      const w = entries[0]?.contentRect.width ?? 0
      setWidth((prev) => (Math.abs(prev - w) > 0.5 ? w : prev))
    })
    ro.observe(el)
    return () => ro.disconnect()
  }, [])

  // 每个气泡的实际半径（像素）。标签要贴着气泡放，所以先算出来
  const radiusByCategory = useMemo(() => {
    const out: Record<string, number> = {}
    for (const p of panel.points) out[p.category] = radiusOf(p.size, maxEngage)
    return out
  }, [panel, maxEngage])

  // 每个标签的落点（像素）。宽度还没量到时先不动，第一帧渲染出来会自动补上
  const labelPos = useMemo(
    () => layoutLabels(panel.points, width, radiusByCategory, data.xMax, data.yMax),
    [panel, width, radiusByCategory, data.xMax, data.yMax],
  )

  return (
    <div className="min-w-0" ref={hostRef}>
      <div className="px-2 pb-1 text-[12px] font-semibold text-ink">{panel.ageLabel}</div>
      <ResponsiveContainer width="100%" height={CHART_H}>
        <ScatterChart margin={MARGIN}>
          <CartesianGrid stroke={CHART_INK.grid} />

          <ReferenceArea
            x1={data.xMedian}
            x2={data.xMax}
            y1={data.yMedian}
            y2={data.yMax}
            fill={CORE_FILL}
            stroke="none"
            ifOverflow="hidden"
          />

          <XAxis
            type="number"
            dataKey="x"
            domain={[0, data.xMax]}
            tickFormatter={(v: number) => `${v.toFixed(0)}`}
            tick={{ fill: CHART_INK.tick, fontSize: 10 }}
            tickLine={false}
            axisLine={{ stroke: CHART_INK.axis }}
            tickMargin={5}
            height={X_AXIS_H}
          />
          <YAxis
            type="number"
            dataKey="y"
            domain={[0, data.yMax]}
            tickFormatter={(v: number) => `${v.toFixed(0)}%`}
            tick={{ fill: CHART_INK.tick, fontSize: 10 }}
            tickLine={false}
            axisLine={false}
            width={Y_AXIS_W}
          />
          {/* domain 必须显式写在【全部 32 个组合】的最大值上。
              不写的话 Recharts 默认按本图内的最大值定标，
              同一个互动率在四张图里会画成不同大小的气泡。 */}
          <ZAxis type="number" dataKey="size" domain={[0, maxEngage]} range={SIZE_RANGE} />

          {/* 分界线：细实线，不做虚线 */}
          <ReferenceLine x={data.xMedian} stroke="#b6c2d1" strokeWidth={1} ifOverflow="hidden" />
          <ReferenceLine y={data.yMedian} stroke="#b6c2d1" strokeWidth={1} ifOverflow="hidden" />

          <Tooltip cursor={{ stroke: CHART_INK.axis, strokeWidth: 1 }} content={<PointTooltip />} />

          <Scatter data={panel.points} isAnimationActive={false}>
            {panel.points.map((p) => (
              <Cell key={p.category} fill={categoryColor(p.slot)} fillOpacity={0.75} />
            ))}
            {/* 8 个分区靠颜色区分已经到极限了，再加上文字标签，
                白色描边垫底保证压到气泡或网格线时也读得清 */}
            <LabelList
              dataKey="category"
              content={(props: LabelProps) => (
                <PointLabel {...props} posByCategory={labelPos} />
              )}
            />
          </Scatter>
        </ScatterChart>
      </ResponsiveContainer>
    </div>
  )
}

/* -------------------------------------------------------------------------- */

interface LabelProps {
  value?: unknown
}

/**
 * 气泡旁边的分区名。落点由 layoutLabels 统一算好，这里只负责画。
 *
 * ⚠️ 为什么不用 Recharts 自己传进来的 x / y？
 *   实测过：那两个值是气泡的【左上角】，不是圆心——
 *   横纵坐标都已经减掉了一个半径。直接拿来当圆心用，
 *   每个标签都会再被推走一个半径，顶上的标签会被顶出画布、互相压住。
 *   所以这里干脆自己算（layoutLabels 里那套像素映射），只依赖坐标轴范围，
 *   不依赖图表库的内部约定。
 *
 * 白色描边垫在文字底下：万一还是压到了气泡或网格线，也保证读得清。
 */
function PointLabel({
  value,
  posByCategory,
}: LabelProps & { posByCategory: Record<string, { x: number; y: number }> }) {
  const name = value == null ? '' : String(value)
  if (!name) return null

  // 宽度还没量到的第一帧：这一帧先不画，量到之后会立刻重渲染补上
  const fixed = posByCategory[name]
  if (!fixed) return null

  return <LabelText x={fixed.x} y={fixed.y} name={name} />
}

function LabelText({ x, y, name }: { x: number; y: number; name: string }) {
  return (
    <text
      x={x}
      y={y}
      textAnchor="middle"
      fill={CHART_INK.value}
      fontSize={10}
      fontWeight={500}
      stroke="#ffffff"
      strokeWidth={2.6}
      paintOrder="stroke"
    >
      {name}
    </text>
  )
}

/** 算一个气泡的实际半径（像素）。定义域是 [0, 该图最大互动率] */
function radiusOf(engage: number, maxEngage: number): number {
  if (maxEngage <= 0) return 10
  const [minSize, maxSize] = SIZE_RANGE
  const size = minSize + (engage / maxEngage) * (maxSize - minSize)
  return Math.sqrt(size / Math.PI)
}

/**
 * 给 8 个标签排位置，尽量不互相压住。
 *
 * 为什么要专门排：
 *   画面上大部分气泡的覆盖率都在 90% 以上，也就是全挤在图的顶部一条带子里。
 *   如果每个标签都老老实实贴在气泡正上方，这一条带子里会叠上七八个标签，糊成一片。
 *
 * 规则（从上往下依次安置，先安置的优先挑位置）：
 *   1. 首选气泡正上方；
 *   2. 上方顶出画布、或者压到别的标签，就试气泡正下方；
 *   3. 还不行就沿着纵向一次次让开，上、下交替找空位；
 *   4. 实在找不到就贴回正上方（有白色描边兜底，至少不会看不清字）。
 *
 * 顶部那一带的气泡基本都会落到第 2 条（标签放到气泡下面）——
 * 这不是凑合：99% 覆盖率的气泡本来就贴着图顶，它头顶根本没空间，
 * 而它下面是大片空白，标签放下去反而更好读。
 */
function layoutLabels(
  points: OpportunityPoint[],
  width: number,
  radiusByCategory: Record<string, number>,
  xMax: number,
  yMax: number,
): Record<string, { x: number; y: number }> {
  const out: Record<string, { x: number; y: number }> = {}
  // 还没量到宽度：这一帧先不画标签，等量到了会重新渲染
  if (width <= 0) return out

  const plotW = Math.max(40, width - PLOT_LEFT - MARGIN.right)

  const items = points.map((p) => ({
    category: p.category,
    cx: PLOT_LEFT + (xMax > 0 ? p.x / xMax : 0) * plotW,
    cy: PLOT_BOTTOM - (yMax > 0 ? p.y / yMax : 0) * PLOT_H,
    r: radiusByCategory[p.category] ?? 10,
  }))

  // 越靠上的气泡头顶空间越少，先给它们挑位置
  const order = [...items].sort((a, b) => a.cy - b.cy)

  const placed: { l: number; r: number; t: number; b: number }[] = []
  /** pad 为额外外扩的像素：判定用外扩后的框，各标签之间才留得出空隙 */
  const boxOf = (cx: number, baseline: number, pad = 0) => ({
    l: cx - LABEL_W / 2 - pad,
    r: cx + LABEL_W / 2 + pad,
    t: baseline - (LABEL_H - 2) - pad,
    b: baseline + 2 + pad,
  })

  for (const it of order) {
    // 候选位置：先往上找，再往下找；每换一个都往外让一档
    const candidates: number[] = []
    for (let k = 0; k < 5; k++) {
      candidates.push(it.cy - it.r - LABEL_GAP - k * (LABEL_H + 2))
      candidates.push(it.cy + it.r + LABEL_GAP + LABEL_H + k * (LABEL_H + 2))
    }

    let baseline: number | null = null
    for (const cand of candidates) {
      const box = boxOf(it.cx, cand, LABEL_PAD)
      // 顶出画布 / 压到横轴刻度：跳过
      if (box.t < PLOT_TOP + 1 || box.b > PLOT_BOTTOM - 3) continue
      // 和已经安置好的标签靠得太近：跳过
      if (placed.some((q) => box.l < q.r && box.r > q.l && box.t < q.b && box.b > q.t)) continue
      baseline = cand
      break
    }

    // 实在没地方放，就贴回气泡上方——与其丢掉这个标签，不如让它压着别的标签
    if (baseline === null) baseline = it.cy - it.r - LABEL_GAP

    placed.push(boxOf(it.cx, baseline, LABEL_PAD))
    out[it.category] = { x: it.cx, y: baseline }
  }

  return out
}

/* -------------------------------------------------------------------------- */

interface TooltipItem {
  payload: OpportunityPoint
}

function PointTooltip({ active, payload }: { active?: boolean; payload?: TooltipItem[] }) {
  if (!active || !payload || payload.length === 0) return null
  const p = payload[0].payload

  return (
    <div className="rounded-lg border border-hairline bg-card px-3 py-2 shadow-[0_4px_16px_rgba(15,23,42,0.12)]">
      <p className="flex items-center gap-1.5 text-[12px] font-semibold text-ink">
        <span
          className="h-2.5 w-2.5 rounded-full"
          style={{ background: categoryColor(p.slot) }}
          aria-hidden="true"
        />
        {p.ageLabel} × {p.category}
      </p>
      <dl className="mt-1.5 space-y-0.5 text-[11.5px]">
        <Row label="人均观看时长" value={`${p.minutesPerViewer.toFixed(1)} 分钟`} />
        <Row label="用户覆盖率" value={`${p.coverageRate.toFixed(1)}%`} />
        <Row label="独立观看用户" value={`${formatCount(p.viewers)} 人`} />
        <Row label="综合互动率" value={`${p.engageRate.toFixed(1)}%`} />
      </dl>
    </div>
  )
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center justify-between gap-5">
      <dt className="text-ink-3">{label}</dt>
      <dd className="tabular-nums font-medium text-ink">{value}</dd>
    </div>
  )
}
