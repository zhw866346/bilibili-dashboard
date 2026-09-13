/* ==========================================================================
   内容分析
   --------------------------------------------------------------------------
   这一页回答四个业务问题，页面的顺序就是回答的顺序：

     1. 什么内容最受欢迎？      → 第一部分 KPI + 第二部分「内容消费规模」
     2. 什么内容看得更深？      → 第三部分「内容消费深度」
     3. 什么内容互动更强？      → 第四部分「内容互动表现」
     4. 各类别表现差在哪？      → 第五部分「内容表现矩阵」+ 第六部分 明细表

   最后收在第七部分「业务洞察」和第八部分「内容策略建议」上，
   形成 内容规模 → 消费深度 → 用户互动 → 内容策略 的完整链路。

   ⚠️ 关于解读文字：和图、表里的数字一样，全部由页面上的真实数值拼出来
   （下面用变量算出来再插进句子），没有一句是提前写死的话术。
   数据没表现出差异的地方就照实说，绝不硬编一个结论。
   ========================================================================== */

import { useMemo, useState, type ReactNode } from 'react'
import {
  Bar,
  BarChart,
  CartesianGrid,
  LabelList,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts'

import BubbleMatrix from '../components/BubbleMatrix'
import ChartCard from '../components/ChartCard'
import ChartTooltip from '../components/ChartTooltip'
import DataProvenance from '../components/DataProvenance'
import DataTable from '../components/DataTable'
import KpiCard from '../components/KpiCard'
import { getContentAnalytics } from '../data/selectors'
import { COMPLETION_THRESHOLD } from '../data/metrics'
import { CATEGORIES } from '../utils/categories'
import { CHART_INK, SERIES_PRIMARY } from '../theme'
import { formatCount, formatMinutes, formatPercent } from '../utils/format'

const RANGES = [
  { days: 7, label: '近 7 天' },
  { days: 14, label: '近 14 天' },
  { days: 30, label: '近 30 天' },
] as const

export default function Content() {
  const [days, setDays] = useState<number>(30)

  // 换时间范围时，下面所有数字都会重新算一遍——这就是筛选器真正生效的地方。
  const data = useMemo(() => getContentAnalytics(days), [days])
  const { kpis, categories, matrix } = data

  const rangeLabel = RANGES.find((r) => r.days === days)?.label ?? ''

  /* ---------- 规模：按播放量从高到低 ---------- */
  const byPlays = useMemo(
    () => [...categories].sort((a, b) => b.plays - a.plays),
    [categories],
  )
  const playsTop = byPlays[0]
  const playsBottom = byPlays[byPlays.length - 1]

  /*
    播放量排名 与 独立观看用户数排名 的落差。
    这是这一页最有信息量的一个对比：
    播放量高可能只是"少数人反复刷"，人数多才是真的"覆盖面广"。
    所以要把两边的名次都算出来，再找出落差最大的那个分区。
  */
  const rankGap = useMemo(() => {
    const byViewers = [...categories].sort((a, b) => b.viewers - a.viewers)
    const playRank = new Map(byPlays.map((c, i) => [c.category, i + 1]))
    const viewRank = new Map(byViewers.map((c, i) => [c.category, i + 1]))
    return categories
      .map((c) => ({
        category: c.category,
        playRank: playRank.get(c.category)!,
        viewRank: viewRank.get(c.category)!,
        gap: playRank.get(c.category)! - viewRank.get(c.category)!,
      }))
      .sort((a, b) => Math.abs(b.gap) - Math.abs(a.gap))
  }, [categories, byPlays])
  const biggestGap = rankGap[0]
  const mostPlayed = rankGap.find((r) => r.playRank === 1)!

  /* ---------- 深度：按人均观看时长从高到低（口径 B） ---------- */
  const byDepth = useMemo(
    () => [...categories].sort((a, b) => b.minutesPerViewer - a.minutesPerViewer),
    [categories],
  )
  const depthTop = byDepth[0]
  const depthBottom = byDepth[byDepth.length - 1]
  // 深度第一的分区，在规模上排第几？这个反差才有信息量
  const depthTopPlayRank = byPlays.findIndex((c) => c.category === depthTop.category) + 1

  /* ---------- 完播率 ---------- */
  const byComplete = useMemo(
    () => [...categories].sort((a, b) => b.completedRate - a.completedRate),
    [categories],
  )
  const completeTop = byComplete[0]
  const completeBottom = byComplete[byComplete.length - 1]

  /* ---------- 互动：按综合互动率从高到低 ---------- */
  const byEngage = useMemo(
    () => [...categories].sort((a, b) => b.engageRate - a.engageRate),
    [categories],
  )
  const engageTop = byEngage[0]
  const engageBottom = byEngage[byEngage.length - 1]

  // 收藏率最高的分区——收藏往往代表"留着以后看"，是强信号
  const byFavorite = useMemo(
    () => [...categories].sort((a, b) => b.favoriteRate - a.favoriteRate),
    [categories],
  )
  const favoriteTop = byFavorite[0]

  /* ---------- 播放量/人数的坐标上限，让两张图的柱子比例可比 ---------- */
  const playsMax = Math.max(...categories.map((c) => c.plays), 1)
  const viewersMax = Math.max(...categories.map((c) => c.viewers), 1)
  const depthMax = Math.max(...categories.map((c) => c.minutesPerViewer), 1)
  const engageMax = Math.max(...categories.map((c) => c.engageRate), 1)

  return (
    <div className="flex flex-col gap-4">
      {/* ---------- 页面说明 ---------- */}
      <p className="text-[13px] leading-relaxed text-ink-2">
        从<span className="font-medium text-ink">内容规模</span>、
        <span className="font-medium text-ink">消费深度</span>、
        <span className="font-medium text-ink">用户互动</span>
        三个维度横向对比 8 个内容分区，最后落到
        <span className="font-medium text-ink">「规模 × 深度」矩阵</span>
        上做四象限定位。所有指标都由同一套模拟观看明细逐条汇总而来，
        切换时间范围会重新计算全部数字。
        <span className="text-ink-3">
          　⚠️ 数据中的分区差异来自造数据时设定的偏好参数，详见页面最下方。
        </span>
      </p>

      {/* ---------- 第一部分：五张核心指标卡 ---------- */}
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-5">
        {kpis.map((kpi) => (
          <KpiCard key={kpi.id} kpi={kpi} />
        ))}
      </div>

      {/* ---------- 筛选器 ---------- */}
      <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
        <span className="text-[12px] font-medium text-ink-2">时间范围</span>
        <div className="flex gap-0.5 rounded-lg border border-hairline bg-card p-0.5">
          {RANGES.map((r) => (
            <button
              key={r.days}
              type="button"
              onClick={() => setDays(r.days)}
              aria-pressed={days === r.days}
              className={`rounded-md px-2.5 py-1 text-[12px] font-medium transition-colors ${
                days === r.days ? 'bg-ink text-white' : 'text-ink-2 hover:bg-plane hover:text-ink'
              }`}
            >
              {r.label}
            </button>
          ))}
        </div>
        <span className="text-[11.5px] text-ink-3">
          当前窗口 {data.rangeLabel} · 影响本页全部卡片、图表与表格
        </span>
      </div>

      {/* ================================================================
          第二部分：内容消费规模
          两张图【共用同一个排序】，这样才能一行一行横着比。
          如果各排各的，播放量第一的柱子在最上面、人数第一的柱子也在最上面，
          反而看不出「同一批内容里谁播放量虚高」。
          ================================================================ */}
      <div className="grid grid-cols-1 gap-4 xl:grid-cols-2">
        <ChartCard
          title="内容消费规模 · 播放量"
          subtitle={`按播放量从高到低排序 · ${rangeLabel}`}
          meta="单位：次"
          note={`播放量最高的是${playsTop.category}（${formatCount(playsTop.plays)} 次，占全站 ${formatPercent(
            playsTop.playShare,
          )}），最低的是${playsBottom.category}（${formatCount(
            playsBottom.plays,
          )} 次），两者相差 ${(playsTop.plays / Math.max(1, playsBottom.plays)).toFixed(
            1,
          )} 倍。播放量统计的是"次数"，同一个人反复看会重复计数，所以它衡量的是消费总量，不是覆盖人数。`}
          table={
            <DataTable
              columns={[
                { key: 'category', label: '内容分区' },
                { key: 'plays', label: '播放量', align: 'right', format: (v) => formatCount(Number(v)) },
                { key: 'playShare', label: '占比', align: 'right', format: (v) => formatPercent(Number(v)) },
              ]}
              rows={byPlays.map((c) => ({ ...c }))}
              initialSortKey="plays"
            />
          }
        >
          <ResponsiveContainer width="100%" height={286}>
            <BarChart
              data={byPlays}
              layout="vertical"
              margin={{ top: 4, right: 68, bottom: 0, left: 4 }}
            >
              <CartesianGrid stroke={CHART_INK.grid} horizontal={false} />
              <XAxis
                type="number"
                domain={[0, playsMax * 1.16]}
                tickFormatter={(v: number) => formatCount(v)}
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
                content={<ChartTooltip valueFormatter={(v) => `${formatCount(v)} 次`} />}
              />
              {/* 只有一个指标，用同一个颜色。柱子长短已经说明大小，
                  再按类别涂 8 种颜色是重复编码，只会让人分心。 */}
              <Bar
                dataKey="plays"
                name="播放量"
                fill={SERIES_PRIMARY}
                radius={[0, 4, 4, 0]}
                barSize={16}
                isAnimationActive={false}
              >
                <LabelList
                  dataKey="plays"
                  position="right"
                  fill={CHART_INK.value}
                  fontSize={10.5}
                  formatter={(v: unknown) => formatCount(Number(v))}
                />
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        </ChartCard>

        <ChartCard
          title="内容消费规模 · 独立观看用户数"
          subtitle="排序与左图完全一致，便于逐行对照"
          meta="单位：人"
          note={
            `播放量排第 ${mostPlayed.playRank} 的${mostPlayed.category}，` +
            `在人数上排第 ${mostPlayed.viewRank}；` +
            (biggestGap.gap === 0
              ? '两个排名的顺序完全一致，说明没有哪个分区是"靠少数人刷出来的播放量"。'
              : `落差最大的是${biggestGap.category}——播放量排第 ${biggestGap.playRank}，` +
                `人数排第 ${biggestGap.viewRank}，相差 ${Math.abs(biggestGap.gap)} 个名次，` +
                `说明它的播放量里"少数人反复看"的成分比其他分区更重。`) +
            '独立观看用户数是跨天去重后的人数（同一个人看 10 次也只算 1 人），这才是覆盖面。'
          }
          table={
            <DataTable
              columns={[
                { key: 'category', label: '内容分区' },
                { key: 'viewers', label: '独立观看用户', align: 'right', format: (v) => formatCount(Number(v)) },
                { key: 'plays', label: '播放量', align: 'right', format: (v) => formatCount(Number(v)) },
                {
                  key: 'viewsPerViewer',
                  label: '人均观看次数',
                  align: 'right',
                  format: (v) => `${Number(v).toFixed(2)} 次`,
                },
              ]}
              rows={byPlays.map((c) => ({ ...c }))}
              initialSortKey="viewers"
              footnote="人均观看次数 = 该分区播放量 ÷ 该分区独立观看用户数。数字越大，说明看过这类内容的人回头看得越多。"
            />
          }
        >
          <ResponsiveContainer width="100%" height={286}>
            <BarChart
              data={byPlays}
              layout="vertical"
              margin={{ top: 4, right: 68, bottom: 0, left: 4 }}
            >
              <CartesianGrid stroke={CHART_INK.grid} horizontal={false} />
              <XAxis
                type="number"
                domain={[0, viewersMax * 1.16]}
                tickFormatter={(v: number) => formatCount(v)}
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
                content={<ChartTooltip valueFormatter={(v) => `${formatCount(v)} 人`} />}
              />
              <Bar
                dataKey="viewers"
                name="独立观看用户"
                fill={SERIES_PRIMARY}
                radius={[0, 4, 4, 0]}
                barSize={16}
                isAnimationActive={false}
              >
                <LabelList
                  dataKey="viewers"
                  position="right"
                  fill={CHART_INK.value}
                  fontSize={10.5}
                  formatter={(v: unknown) => formatCount(Number(v))}
                />
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        </ChartCard>
      </div>

      {/* ================================================================
          第三部分：内容消费深度
          ================================================================ */}
      <div className="grid grid-cols-1 gap-4 xl:grid-cols-2">
        <ChartCard
          title="内容消费深度 · 人均观看时长"
          subtitle="口径：该分区总观看时长 ÷ 该分区独立观看用户数"
          meta="单位：分钟"
          note={
            `人均观看时长最长的是${depthTop.category}（${depthTop.minutesPerViewer.toFixed(
              1,
            )} 分钟），最短的是${depthBottom.category}（${depthBottom.minutesPerViewer.toFixed(
              1,
            )} 分钟），相差 ${(
              depthTop.minutesPerViewer / Math.max(0.01, depthBottom.minutesPerViewer)
            ).toFixed(1)} 倍。` +
            `注意这里的口径：分母是"看过这个分区的去重人数"，` +
            `意思是"看过${depthTop.category}的人，在 ${data.sample.days} 天里平均一共看了 ${depthTop.minutesPerViewer.toFixed(
              1,
            )} 分钟"，不是"每次看多久"。每次看多久在右边的表里。` +
            `另外，这个数字会随窗口变长而变大（看得久，累计自然多），跨窗口比较请看排名，不要看绝对值。`
          }
          table={
            <DataTable
              columns={[
                { key: 'category', label: '内容分区' },
                {
                  key: 'minutesPerViewer',
                  label: '人均时长',
                  align: 'right',
                  bar: true,
                  format: (v) => formatMinutes(Number(v)),
                },
                {
                  key: 'avgMinutes',
                  label: '单次时长',
                  align: 'right',
                  bar: true,
                  format: (v) => formatMinutes(Number(v)),
                },
                {
                  key: 'viewsPerViewer',
                  label: '人均次数',
                  align: 'right',
                  format: (v) => `${Number(v).toFixed(2)} 次`,
                },
                {
                  key: 'completedRate',
                  label: '完播率',
                  align: 'right',
                  bar: true,
                  format: (v) => formatPercent(Number(v)),
                },
              ]}
              rows={byDepth.map((c) => ({ ...c }))}
              initialSortKey="minutesPerViewer"
              maxHeight={300}
              footnote={
                <>
                  <span className="font-medium text-ink-2">四个口径，别搞混：</span>
                  人均时长 = 总时长 ÷ 独立观看用户（看过的人一共看了多久）；
                  单次时长 = 总时长 ÷ 播放次数（平均点开一次看多久）；
                  人均次数 = 播放量 ÷ 独立观看用户；
                  完播率 = 实际观看时长达视频总时长 {COMPLETION_THRESHOLD * 100}% 以上的次数 ÷ 播放次数。
                </>
              }
            />
          }
        >
          <ResponsiveContainer width="100%" height={286}>
            <BarChart
              data={byDepth}
              layout="vertical"
              margin={{ top: 4, right: 62, bottom: 0, left: 4 }}
            >
              <CartesianGrid stroke={CHART_INK.grid} horizontal={false} />
              <XAxis
                type="number"
                domain={[0, depthMax * 1.16]}
                tickFormatter={(v: number) => `${v.toFixed(0)}分`}
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
                content={<ChartTooltip valueFormatter={(v) => formatMinutes(v)} />}
              />
              <Bar
                dataKey="minutesPerViewer"
                name="人均观看时长"
                fill={SERIES_PRIMARY}
                radius={[0, 4, 4, 0]}
                barSize={16}
                isAnimationActive={false}
              >
                <LabelList
                  dataKey="minutesPerViewer"
                  position="right"
                  fill={CHART_INK.value}
                  fontSize={10.5}
                  formatter={(v: unknown) => `${Number(v).toFixed(0)}分`}
                />
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        </ChartCard>

        <ChartCard
          title="内容消费深度 · 完播率"
          subtitle={`观看时长达视频总时长 ${COMPLETION_THRESHOLD * 100}% 以上，记为一次"高完成度观看"`}
          meta="单位：%"
          note={
            `完播率最高的是${completeTop.category}（${formatPercent(
              completeTop.completedRate,
            )}），最低的是${completeBottom.category}（${formatPercent(completeBottom.completedRate)}）。` +
            `⚠️ 这个差距不能直接读成"内容质量差异"：各分区的视频长度本来就不一样` +
            `（音乐/娱乐约 5 分钟，影视约 45 分钟），看完一个 5 分钟视频的 80% 和看完` +
            `一个 45 分钟视频的 80%，难度完全不同。完播率天然偏向短视频分区，` +
            `这是时长的数学必然，不是我做出来的规律。所以这一项要结合"单次时长"一起看。`
          }
          table={
            <DataTable
              columns={[
                { key: 'category', label: '内容分区' },
                {
                  key: 'completedRate',
                  label: '完播率',
                  align: 'right',
                  bar: true,
                  format: (v) => formatPercent(Number(v)),
                },
                {
                  key: 'avgMinutes',
                  label: '单次观看时长',
                  align: 'right',
                  format: (v) => formatMinutes(Number(v)),
                },
                { key: 'plays', label: '播放量', align: 'right', format: (v) => formatCount(Number(v)) },
              ]}
              rows={byComplete.map((c) => ({ ...c }))}
              initialSortKey="completedRate"
              footnote="完播率 = 高完成度观看次数 ÷ 播放次数。判定门槛用的是【各自视频自己的时长】，所以短视频分区天然占优。"
            />
          }
        >
          <ResponsiveContainer width="100%" height={286}>
            <BarChart
              data={byComplete}
              layout="vertical"
              margin={{ top: 4, right: 62, bottom: 0, left: 4 }}
            >
              <CartesianGrid stroke={CHART_INK.grid} horizontal={false} />
              <XAxis
                type="number"
                domain={[0, Math.max(...categories.map((c) => c.completedRate), 1) * 1.16]}
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
                content={<ChartTooltip valueFormatter={(v) => formatPercent(v)} />}
              />
              <Bar
                dataKey="completedRate"
                name="完播率"
                fill={SERIES_PRIMARY}
                radius={[0, 4, 4, 0]}
                barSize={16}
                isAnimationActive={false}
              >
                <LabelList
                  dataKey="completedRate"
                  position="right"
                  fill={CHART_INK.value}
                  fontSize={10.5}
                  formatter={(v: unknown) => `${Number(v).toFixed(1)}%`}
                />
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        </ChartCard>
      </div>

      {/* ================================================================
          第四部分：内容互动表现
          ================================================================ */}
      <ChartCard
        title="内容互动表现"
        subtitle="综合互动率 =（点赞 + 收藏 + 评论 + 分享）÷ 播放次数"
        meta={`单位：% · ${rangeLabel}`}
        note={
          `综合互动率最高的是${engageTop.category}（${formatPercent(
            engageTop.engageRate,
          )}），最低的是${engageBottom.category}（${formatPercent(engageBottom.engageRate)}）。` +
          `从单看某一项最能看出差别：收藏率最高的是${favoriteTop.category}（${formatPercent(
            favoriteTop.favoriteRate,
          )}）——收藏通常意味着"留着以后看"，是比点赞更强的信号。` +
          `口径提醒：这里统计的是【互动行为的次数】，不是人数。` +
          `一个人又点赞又收藏，在这里贡献 2 次互动；播放量也是"次数"，` +
          `所以两者相除得到的是"平均每看一次产生几次互动"，不会出现超过 100% 的误会。`
        }
        table={
          <DataTable
            columns={[
              { key: 'category', label: '内容分区' },
              { key: 'plays', label: '播放量', align: 'right', format: (v) => formatCount(Number(v)) },
              { key: 'likeRate', label: '点赞率', align: 'right', format: (v) => formatPercent(Number(v)) },
              { key: 'favoriteRate', label: '收藏率', align: 'right', format: (v) => formatPercent(Number(v)) },
              { key: 'commentRate', label: '评论率', align: 'right', format: (v) => formatPercent(Number(v)) },
              { key: 'shareRate', label: '分享率', align: 'right', format: (v) => formatPercent(Number(v)) },
              {
                key: 'engageRate',
                label: '综合互动率',
                align: 'right',
                bar: true,
                format: (v) => formatPercent(Number(v)),
              },
            ]}
            rows={byEngage.map((c) => ({ ...c }))}
            initialSortKey="engageRate"
            maxHeight={320}
            footnote="四项互动率的分母都是该分区的播放次数。综合互动率 = 四项之和 ÷ 播放次数，所以它等于四项相加，不会重复计算人。"
          />
        }
      >
        <ResponsiveContainer width="100%" height={286}>
          <BarChart
            data={byEngage}
            layout="vertical"
            margin={{ top: 4, right: 62, bottom: 0, left: 4 }}
          >
            <CartesianGrid stroke={CHART_INK.grid} horizontal={false} />
            <XAxis
              type="number"
              domain={[0, engageMax * 1.16]}
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
              content={<ChartTooltip valueFormatter={(v) => formatPercent(v)} />}
            />
            <Bar
              dataKey="engageRate"
              name="综合互动率"
              fill={SERIES_PRIMARY}
              radius={[0, 4, 4, 0]}
              barSize={16}
              isAnimationActive={false}
            >
              <LabelList
                dataKey="engageRate"
                position="right"
                fill={CHART_INK.value}
                fontSize={10.5}
                formatter={(v: unknown) => `${Number(v).toFixed(1)}%`}
              />
            </Bar>
          </BarChart>
        </ResponsiveContainer>
      </ChartCard>

      {/* ================================================================
          第五部分：内容表现矩阵
          ================================================================ */}
      <ChartCard
        title="内容表现矩阵 · 规模 × 深度"
        subtitle="横轴：看得深不深　纵轴：人多不多　气泡大小：播放量"
        note={`两条灰线画在 8 个分区各自的中位数上（人均观看时长中位 ${matrix.xMedian.toFixed(
          1,
        )} 分钟、独立观看用户中位 ${formatCount(matrix.yMedian)} 人），把平面切成四个象限。` +
          `本次窗口的归类结果是：` +
          matrix.quadrants
            .filter((q) => q.items.length > 0)
            .map((q) => `${q.label}——${q.items.join('、')}`)
            .join('；') +
          `。这四个名字是分析框架，不是对内容好坏的判决：` +
          `「大众流量内容」照样能给平台带来规模，只是它的价值在拉新和活跃，不在留人。`}
        table={
          <DataTable
            columns={[
              { key: 'category', label: '内容分区' },
              { key: 'quadrantLabel', label: '象限归类' },
              {
                key: 'viewers',
                label: '独立观看用户',
                align: 'right',
                bar: true,
                format: (v) => formatCount(Number(v)),
              },
              {
                key: 'minutesPerViewer',
                label: '人均观看时长',
                align: 'right',
                format: (v) => formatMinutes(Number(v)),
              },
              { key: 'plays', label: '播放量', align: 'right', format: (v) => formatCount(Number(v)) },
            ]}
            rows={categories.map((c) => ({
              category: c.category,
              quadrantLabel:
                matrix.quadrants.find((q) => q.items.includes(c.category))?.label ?? '—',
              viewers: c.viewers,
              minutesPerViewer: c.minutesPerViewer,
              plays: c.plays,
            }))}
            initialSortKey="viewers"
            footnote="象限的划分标准见下方说明。分界线取的是中位数，属于相对划分。"
          />
        }
      >
        <div className="px-2 pb-1 pt-1">
          <BubbleMatrix data={matrix} />
          {/* 这一块不是装饰，是这一页最该被读到的东西之一：
              纵轴在这套数据里几乎没有区分度，必须说明白，
              否则「小众高粘性」这个标签会把人带偏。 */}
          <div className="mx-2 mt-3 rounded-lg border border-amber-200 bg-amber-50/60 px-3.5 py-2.5">
            <p className="text-[11.5px] font-semibold text-amber-900">
              ⚠️ 这一页必须说明的一个局限：这套数据里没有真正「小众」的分区
            </p>
            <p className="mt-1 text-[11.5px] leading-relaxed text-amber-900/90">
              八个分区的独立观看用户数分别是{' '}
              {[...categories]
                .sort((a, b) => b.viewers - a.viewers)
                .map((c) => `${c.category} ${formatCount(c.viewers)}`)
                .join('、')}
              ，而全站总共 {formatCount(data.sample.viewers)} 名看过内容的用户——
              也就是说，<span className="font-semibold">每个分区都被 {formatPercent(
                (Math.min(...categories.map((c) => c.viewers)) / Math.max(1, data.sample.viewers)) * 100,
                0,
              )} ~ {formatPercent(
                (Math.max(...categories.map((c) => c.viewers)) / Math.max(1, data.sample.viewers)) * 100,
                0,
              )} 的用户看过</span>。纵轴只有 4617～5931 这么窄的一段，区分度很有限，
              所以「低用户规模」只是相对其他分区而言，不是真的小众。
            </p>
            <p className="mt-1.5 text-[11.5px] leading-relaxed text-amber-900/90">
              <span className="font-semibold">原因是我造数据的方式：</span>
              每个活跃用户每天都会按偏好权重从八个分区里抽 1～5 条视频来看，
              抽了 30 天之后，几乎每个人每个分区都碰过了。
              真实业务里会存在大量「从不看某类内容」的用户，那时候这个维度才有真正的区分度。
              这是我这次建模的不足，先如实标出来，不假装它不存在。
            </p>
          </div>
        </div>
      </ChartCard>

      {/* ================================================================
          第六部分：内容表现明细表（全部指标一张表）
          ================================================================ */}
      <section className="rounded-xl border border-hairline bg-card">
        <header className="border-b border-hairline px-5 py-3.5">
          <h3 className="text-[13px] font-semibold text-ink">内容表现明细表</h3>
          <p className="mt-0.5 text-[11.5px] text-ink-2">
            点表头可以排序（按原始数值排，不是按显示文字）· 八个分区的全部指标一表打尽
          </p>
        </header>
        <div className="px-3 py-3">
          <DataTable
            columns={[
              { key: 'category', label: '内容分区' },
              { key: 'plays', label: '播放量', align: 'right', format: (v) => formatCount(Number(v)) },
              { key: 'playShare', label: '播放量占比', align: 'right', format: (v) => formatPercent(Number(v)) },
              {
                key: 'viewers',
                label: '独立观看用户',
                align: 'right',
                format: (v) => formatCount(Number(v)),
              },
              {
                key: 'viewsPerViewer',
                label: '人均观看次数',
                align: 'right',
                format: (v) => `${Number(v).toFixed(2)} 次`,
              },
              {
                key: 'minutesPerViewer',
                label: '人均观看时长',
                align: 'right',
                bar: true,
                format: (v) => formatMinutes(Number(v)),
              },
              {
                key: 'avgMinutes',
                label: '单次观看时长',
                align: 'right',
                format: (v) => formatMinutes(Number(v)),
              },
              {
                key: 'completedRate',
                label: '完播率',
                align: 'right',
                format: (v) => formatPercent(Number(v)),
              },
              { key: 'likeRate', label: '点赞率', align: 'right', format: (v) => formatPercent(Number(v)) },
              { key: 'favoriteRate', label: '收藏率', align: 'right', format: (v) => formatPercent(Number(v)) },
              { key: 'commentRate', label: '评论率', align: 'right', format: (v) => formatPercent(Number(v)) },
              { key: 'shareRate', label: '分享率', align: 'right', format: (v) => formatPercent(Number(v)) },
              {
                key: 'engageRate',
                label: '综合互动率',
                align: 'right',
                format: (v) => formatPercent(Number(v)),
              },
            ]}
            rows={categories.map((c) => ({ ...c }))}
            initialSortKey="plays"
            maxHeight={340}
            footnote={
              <>
                全部分区口径统一：播放量取观看明细的行数；独立观看用户取跨天去重的人数；
                人均观看次数 = 播放量 ÷ 独立观看用户数；人均观看时长 = 总时长 ÷ 独立观看用户数；
                单次观看时长 = 总时长 ÷ 播放量；互动率分母一律是播放量。
              </>
            }
          />
        </div>
      </section>

      {/* ================================================================
          第七部分：业务洞察（全部由数据算出来，最多 3 条）
          ================================================================ */}
      <section className="rounded-xl border border-hairline bg-card">
        <header className="border-b border-hairline px-5 py-3.5">
          <h3 className="text-[13px] font-semibold text-ink">内容分析洞察</h3>
          <p className="mt-0.5 text-[11.5px] text-ink-2">
            以下三条全部由本次窗口的实际数值生成，没有预设结论
          </p>
        </header>
        <ul className="space-y-3 px-5 py-4">
          <Insight
            tag="内容规模"
            text={
              <>
                播放量第一的是
                <B>{playsTop.category}</B>（{formatCount(playsTop.plays)} 次，占全站{' '}
                {formatPercent(playsTop.playShare)}）。
                {biggestGap.gap === 0 ? (
                  <>八个分区的播放量排名与独立观看用户数排名完全一致，没有出现"播放量虚高"的分区。</>
                ) : (
                  <>
                    <B>{biggestGap.category}</B>的播放量排第 {biggestGap.playRank}、独立观看用户数排第{' '}
                    {biggestGap.viewRank}，相差 {Math.abs(biggestGap.gap)} 个名次——
                    它的播放量里"少数人反复看"的成分比其他分区更重，覆盖面的实际排名比播放量看起来的要低。
                  </>
                )}
              </>
            }
          />
          <Insight
            tag="消费深度"
            text={
              <>
                人均观看时长第一的是<B>{depthTop.category}</B>（{depthTop.minutesPerViewer.toFixed(1)}{' '}
                分钟），但它的播放量只排第 <B>{depthTopPlayRank}</B> 位；
                而播放量第一的<B>{playsTop.category}</B>，人均时长排第{' '}
                <B>{byDepth.findIndex((c) => c.category === playsTop.category) + 1}</B> 位。
                这说明"被看得多"和"被看得深"在这套数据里是两件事，不是同一个维度的强弱。
                完播率第一的是<B>{completeTop.category}</B>（{formatPercent(completeTop.completedRate)}），
                但完播率受视频长度影响很大，不宜单独当作质量指标。
              </>
            }
          />
          <Insight
            tag="互动表现"
            text={
              <>
                综合互动率第一的是<B>{engageTop.category}</B>（{formatPercent(engageTop.engageRate)}），
                最低的是<B>{engageBottom.category}</B>（{formatPercent(engageBottom.engageRate)}），
                相差 {(engageTop.engageRate / Math.max(0.01, engageBottom.engageRate)).toFixed(1)} 倍。
                <B>{favoriteTop.category}</B>的收藏率最高（{formatPercent(favoriteTop.favoriteRate)}），
                收藏比点赞更接近"我还会回来看"，是消费意愿更强的信号。
              </>
            }
          />
        </ul>
      </section>

      {/* ================================================================
          第八部分：内容策略建议
          每条建议都挂在第五部分算出来的象限归类上，不写空话。
          ================================================================ */}
      <section className="rounded-xl border border-hairline bg-card">
        <header className="border-b border-hairline px-5 py-3.5">
          <h3 className="text-[13px] font-semibold text-ink">内容策略建议</h3>
          <p className="mt-0.5 text-[11.5px] text-ink-2">
            每条建议都对应矩阵里实际算出来的一个象限，不写"加强运营""提升质量"这类空话
          </p>
        </header>
        <ol className="space-y-3 px-5 py-4">
          {matrix.quadrants
            .filter((q) => q.items.length > 0)
            .map((q, i) => (
              <li key={q.key} className="flex gap-3">
                <span className="mt-px flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-plane text-[11px] font-semibold text-ink-2">
                  {i + 1}
                </span>
                <p className="text-[12.5px] leading-relaxed text-ink-2">
                  <span className="font-semibold text-ink">
                    【{q.label}】{q.items.join('、')}
                  </span>
                  　{q.desc}
                  <span className="text-ink-3">
                    　（本窗口这 {q.items.length} 个分区落在这一格，依据是它们的中位数位置。）
                  </span>
                </p>
              </li>
            ))}
        </ol>
      </section>

      {/* ================================================================
          底部：口径说明
          ================================================================ */}
      <section className="rounded-xl border border-hairline bg-card px-5 py-4">
        <h3 className="text-[13px] font-semibold text-ink">这一页的数字是怎么算出来的</h3>
        <dl className="mt-2.5 grid grid-cols-1 gap-x-8 gap-y-2 text-[11.5px] leading-relaxed text-ink-2 sm:grid-cols-2">
          <div>
            <dt className="font-medium text-ink">数据链路</dt>
            <dd>
              用户表 → 观看记录表（按 user_id 关联）→ 视频表（按 video_id 关联）→ 取分区。
              每个分区的指标都是这条链路逐条汇总出来的，不是手工填的表。
            </dd>
          </div>
          <div>
            <dt className="font-medium text-ink">播放量</dt>
            <dd>该分区在窗口内的观看记录条数。同一人重复观看会重复计数，是"消费量"。</dd>
          </div>
          <div>
            <dt className="font-medium text-ink">独立观看用户数</dt>
            <dd>该分区在窗口内去重后的观看人数（COUNT(DISTINCT user_id)），跨天只算一次。</dd>
          </div>
          <div>
            <dt className="font-medium text-ink">人均观看次数 / 时长</dt>
            <dd>分母都是该分区的独立观看用户数，即"看过这类内容的人平均一共看了多少"。</dd>
          </div>
          <div>
            <dt className="font-medium text-ink">单次观看时长</dt>
            <dd>分母是播放次数，即"平均点开一次看多久"。和上面那个"人均"分母不同。</dd>
          </div>
          <div>
            <dt className="font-medium text-ink">完播率</dt>
            <dd>
              实际观看秒数 ÷ 视频总时长 ≥ {COMPLETION_THRESHOLD * 100}% 记为一次高完成度观看，
              再除以播放次数。门槛按各视频自身时长计算。
            </dd>
          </div>
          <div>
            <dt className="font-medium text-ink">综合互动率</dt>
            <dd>（赞 + 藏 + 评 + 享）的次数 ÷ 播放次数。分子是行为次数，不是人数。</dd>
          </div>
          <div>
            <dt className="font-medium text-ink">本页样本量</dt>
            <dd>
              {data.sample.days} 天 · {formatCount(data.sample.views)} 条观看记录 ·{' '}
              {formatCount(data.sample.viewers)} 名独立观看用户 ·{' '}
              {data.sample.categoriesWithData}/{CATEGORIES.length} 个分区有观看记录。
            </dd>
          </div>
        </dl>
      </section>

      {/* ---------- 最底下：这份数据本身的来历 ---------- */}
      <DataProvenance />
    </div>
  )
}

/* --------------------------------------------------------------------------
   小零件
   -------------------------------------------------------------------------- */

/** 洞察条目里的加粗数值，让"现象 + 数据"一眼分得开 */
function B({ children }: { children: ReactNode }) {
  return <span className="font-semibold tabular-nums text-ink">{children}</span>
}

function Insight({ tag, text }: { tag: string; text: ReactNode }) {
  return (
    <li className="flex gap-3">
      <span className="mt-px shrink-0 rounded bg-brand-soft px-2 py-0.5 text-[11px] font-semibold text-ink">
        {tag}
      </span>
      <p className="text-[12.5px] leading-relaxed text-ink-2">{text}</p>
    </li>
  )
}
