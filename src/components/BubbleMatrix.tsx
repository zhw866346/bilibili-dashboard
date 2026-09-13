/* ==========================================================================
   内容表现矩阵（气泡图）
   --------------------------------------------------------------------------
   一张图回答：八个内容分区，各自站在「人多不多」和「看得深不深」的什么位置？

     横轴 x = 人均观看时长（分钟）  → 看得深不深
     纵轴 y = 独立观看用户数        → 人多不多
     气泡大小 = 播放量              → 被消费的总量

   两条参考线画在【8 个分区各自的中位数】上，把平面切成四个象限。
   为什么用中位数不用平均值？见 selectors.ts 里 buildMatrix 上面的注释——
   简单说：平均值会被极端值带跑，可能某个象限一个点都没有，框架就塌了。

   ⚠️ 别用双轴图。这张图两个轴是【不同的量纲】，但它们是【两个独立的坐标轴】，
      不是"同一个横轴配两个纵轴刻度"——后者才是双轴图的错误用法。
      气泡图天生就是多维度编码，这里没有把两个不同单位的量塞进同一个轴。
   ========================================================================== */

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

import type { MatrixData } from '../data/selectors'
import { CHART_INK, categoryColor } from '../theme'
import { formatCount } from '../utils/format'

/** 象限的浅色底。只有"核心内容"那一格上色，用来说"这块是好位置"，其余留白。 */
const CORE_FILL = 'rgba(42,120,214,0.085)'

/**
 * 气泡大小的取值范围（面积，不是半径）。
 * 放在模块级是为了让「算标签位置」和「ZAxis 的 range」用同一个值——
 * 两处如果各写各的，标签就会飘到气泡外面去。
 *
 * 这个区间调过三次，记录一下为什么停在这里：
 *   [170, 1050]  → 半径 10~18px，大小差肉眼分不出；
 *   [420, 5000]  → 半径 12~40px，区分度够了，但最大直径 80px，
 *                  而八个气泡的圆心全挤在纵向 65px 的带子里，糊成一团；
 *   [300, 2600]  → 半径 10~29px，面积比 2.8 倍，
 *                  既看得出大小差别，也不至于互相盖住。
 */
const SIZE_RANGE: [number, number] = [300, 2600]

/**
 * 气泡标签的微调。
 *
 * 为什么不自动避让？Recharts 的 LabelList 不检测碰撞，而 8 个气泡里
 * 「动画」的默认标签位置正好压在「科技」的气泡上，深色文字落在青绿底色上根本看不清。
 * 就这 8 个固定分区，人工微调一次，比为了避让去引入一个碰撞检测库划算得多。
 * 数值是看着实际渲染结果调的，单位是像素。
 */
const LABEL_NUDGE: Record<string, { dx: number; dy: number }> = {
  动画: { dx: -34, dy: 4 }, // 默认位置会压在「科技」上，往左下让开
  影视: { dx: 30, dy: 0 },
  生活: { dx: -6, dy: 0 },
  音乐: { dx: 0, dy: 14 }, // 气泡最小，标签抬高一点免得贴着轴
}

/**
 * 算一个气泡的实际半径（像素）。
 * 公式来自 Recharts 的 ZAxis：先把播放量线性映射到 SIZE_RANGE 得到一个"面积"，
 * 圆面积 = πr²，所以 r = √(面积 ÷ π)。定义域是 [0, 最大播放量]。
 */
function radiusOf(plays: number, maxPlays: number): number {
  if (maxPlays <= 0) return 12
  const [minSize, maxSize] = SIZE_RANGE
  const size = minSize + (plays / maxPlays) * (maxSize - minSize)
  return Math.sqrt(size / Math.PI)
}

export default function BubbleMatrix({ data }: { data: MatrixData }) {
  const { points, xMedian, yMedian, quadrants } = data

  // 象限编号 → 中文名。tooltip 由 Recharts 内部渲染，拿不到外面的变量，
  // 所以在这里拼好再传进去。
  const quadrantLabels: Record<string, string> = {}
  for (const q of quadrants) quadrantLabels[q.key] = q.label

  // 空数据兜底：一个分区都没有观看记录时，不要画一张空图
  if (points.length === 0) {
    return (
      <div className="flex h-[320px] items-center justify-center text-[12.5px] text-ink-3">
        当前时间范围内没有观看记录，无法绘制矩阵。
      </div>
    )
  }

  const xMaxRaw = Math.max(...points.map((p) => p.x))
  const yMaxRaw = Math.max(...points.map((p) => p.y))
  // 全为 0 时给个兜底上限，避免坐标轴退化成一条线
  const xMax = xMaxRaw > 0 ? xMaxRaw * 1.22 : 1
  // 纵轴留白比横轴小：八个分区的观众数都挤在顶部一小段，留太多白会把气泡压扁
  const yMax = yMaxRaw > 0 ? yMaxRaw * 1.1 : 1

  // 气泡大小是按「最大播放量」定标的，标签要靠半径算位置，所以在这里先把每个区的半径算好
  const maxPlays = Math.max(...points.map((p) => p.plays))
  const radiusByCategory: Record<string, number> = {}
  for (const p of points) radiusByCategory[p.category] = radiusOf(p.plays, maxPlays)

  return (
    <div>
      <ResponsiveContainer width="100%" height={392}>
        <ScatterChart margin={{ top: 16, right: 28, bottom: 26, left: 4 }}>
          <CartesianGrid stroke={CHART_INK.grid} />

          {/* 「核心内容」象限（右上）铺一层极淡的底色，指出"好位置"在哪。
              必须配文字：八个分区的观众数都挤在顶部，这块底色实际只有 30 多像素高，
              不写字的话读者只会看到一条莫名其妙的灰带，不知道它代表一个象限。 */}
          <ReferenceArea
            x1={xMedian}
            x2={xMax}
            y1={yMedian}
            y2={yMax}
            fill={CORE_FILL}
            stroke="none"
            ifOverflow="hidden"
            label={{
              value: '核心内容',
              position: 'insideTopRight',
              fill: '#3f6fae',
              fontSize: 10.5,
            }}
          />

          <XAxis
            type="number"
            dataKey="x"
            name="人均观看时长"
            domain={[0, xMax]}
            tickFormatter={(v: number) => `${v.toFixed(0)}分`}
            tick={{ fill: CHART_INK.tick, fontSize: 11 }}
            tickLine={false}
            axisLine={{ stroke: CHART_INK.axis }}
            tickMargin={8}
            label={{
              value: '人均观看时长（分钟）→ 看得越深越靠右',
              position: 'insideBottom',
              offset: -16,
              fill: CHART_INK.label,
              fontSize: 11,
            }}
          />
          <YAxis
            type="number"
            dataKey="y"
            name="独立观看用户"
            domain={[0, yMax]}
            tickFormatter={(v: number) => formatCount(v)}
            tick={{ fill: CHART_INK.tick, fontSize: 11 }}
            tickLine={false}
            axisLine={false}
            width={50}
          />
          {/* range 是「气泡面积的取值范围」，不是半径。
              写成 [170, 1050] 时八个气泡的半径只有 10~18px，大小几乎看不出差别；
              放开到 [420, 5000] 之后半径约 12~40px，播放量的差异才真的读得出来。 */}
          <ZAxis type="number" dataKey="plays" range={[420, 5000]} />

          {/* 两条分界线：实线、细，不做虚线（虚线在这套设计语言里显得像"网格"） */}
          <ReferenceLine x={xMedian} stroke="#b6c2d1" strokeWidth={1} ifOverflow="hidden" />
          <ReferenceLine y={yMedian} stroke="#b6c2d1" strokeWidth={1} ifOverflow="hidden" />

          {/* 线的位置直接标在图上，不让人猜 */}
          <ReferenceLine
            x={xMedian}
            stroke="none"
            label={{
              value: `中位 ${xMedian.toFixed(0)} 分`,
              position: 'top',
              fill: CHART_INK.label,
              fontSize: 10.5,
            }}
          />
          <ReferenceLine
            y={yMedian}
            stroke="none"
            label={{
              value: `中位 ${formatCount(yMedian)} 人`,
              position: 'right',
              fill: CHART_INK.label,
              fontSize: 10.5,
            }}
          />

          <Tooltip
            cursor={{ stroke: CHART_INK.axis, strokeWidth: 1 }}
            content={<MatrixTooltip labelMap={quadrantLabels} />}
          />

          <Scatter data={points} isAnimationActive={false}>
            {points.map((p) => (
              <Cell key={p.category} fill={categoryColor(p.slot)} fillOpacity={0.72} />
            ))}
            {/* 直接把分区名标在气泡上：8 个类别只靠颜色区分太吃力，
                而且色觉障碍的读者完全读不出来，必须文字兜底。
                这里没用 position="top"——它不会避让，标签会撞在一起，
                所以改成自己算：标签贴在各自气泡的正上方，个别再人工微调。 */}
            <LabelList
              dataKey="category"
              content={(props: BubbleLabelProps) => (
                <BubbleLabel {...props} radiusByCategory={radiusByCategory} />
              )}
            />
          </Scatter>
        </ScatterChart>
      </ResponsiveContainer>

      {/* 图例 —— 两个以上的系列必须有图例，不能只靠颜色 */}
      <div className="mt-1 flex flex-wrap items-center gap-x-4 gap-y-1.5 px-2">
        {points.map((p) => (
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
          气泡越大 = 播放量越高 · 灰线 = 八个分区各自的中位数
        </span>
      </div>

      <p className="mt-2 px-2 text-[11px] leading-relaxed text-ink-3">
        <span className="font-medium text-ink-2">怎么读：</span>
        越靠右说明看过这个分区的人平均停留越久，越靠上说明看的人越多。
        右上角的浅蓝底是「两样都占」的位置。
        注意这是<span className="font-medium text-ink-2">相对</span>位置——线画在中位数上，
        哪怕八个分区其实差别不大，也会被切成四块，所以线上标了具体数值，别只看方位。
      </p>
    </div>
  )
}

/* --------------------------------------------------------------------------
   悬停提示：一次把三个维度都列出来，顺便告诉读者这个点落在哪个象限。
   注意 text 一律用文字色，不用气泡的颜色——颜色只负责"认出是哪个分区"，
   文字本身要始终清晰可读。
   -------------------------------------------------------------------------- */
interface TooltipPayloadItem {
  payload: MatrixData['points'][number]
}

function MatrixTooltip({
  active,
  payload,
  labelMap,
}: {
  active?: boolean
  payload?: TooltipPayloadItem[]
  /** 象限编号 → 中文名，由页面传进来，避免在这里再写一遍文案 */
  labelMap?: Record<string, string>
}) {
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
        {p.category}
        {labelMap?.[p.quadrant] && (
          <span className="rounded bg-plane px-1.5 py-px text-[10.5px] font-medium text-ink-3">
            {labelMap[p.quadrant]}
          </span>
        )}
      </p>
      <dl className="mt-1.5 space-y-0.5 text-[11.5px]">
        <Row label="独立观看用户" value={`${formatCount(p.y)} 人`} />
        <Row label="人均观看时长" value={`${p.x.toFixed(1)} 分钟`} />
        <Row label="播放量" value={`${formatCount(p.plays)} 次`} />
      </dl>
    </div>
  )
}

/* --------------------------------------------------------------------------
   气泡上方的分区名。
   Recharts 会把每个点的圆心坐标 (x, y) 和它的 dataKey 值 (value) 传进来，
   我们据此把文字摆在「圆心正上方一个半径 + 7px」的位置，再叠加人工微调。
   -------------------------------------------------------------------------- */
interface BubbleLabelProps {
  // Recharts 这几个 prop 的类型是它内部那套很宽的联合类型（数字 / 字符串 / 布尔 / null）。
  // 我们进来就 Number() / String() 归一化，所以这里直接收 unknown 最省事，也最诚实。
  x?: unknown
  y?: unknown
  value?: unknown
}

function BubbleLabel({
  x,
  y,
  value,
  radiusByCategory,
}: BubbleLabelProps & {
  radiusByCategory: Record<string, number>
}) {
  const px = Number(x)
  const py = Number(y)
  const name = value == null ? '' : String(value)
  if (!Number.isFinite(px) || !Number.isFinite(py) || !name) return null

  const nudge = LABEL_NUDGE[name] ?? { dx: 0, dy: 0 }
  // 找不到就按中等气泡处理，宁可稍微标远一点，也不要压在气泡上
  const radius = radiusByCategory[name] ?? 28

  return (
    <text
      x={px + nudge.dx}
      y={py - radius - 7 + nudge.dy}
      textAnchor="middle"
      fill={CHART_INK.value}
      fontSize={11}
      fontWeight={500}
      /* 白色描边垫在文字底下：万一还是压到了气泡或网格线，也保证读得清 */
      stroke="#ffffff"
      strokeWidth={3}
      paintOrder="stroke"
    >
      {name}
    </text>
  )
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center justify-between gap-6">
      <dt className="text-ink-3">{label}</dt>
      <dd className="tabular-nums font-medium text-ink">{value}</dd>
    </div>
  )
}
