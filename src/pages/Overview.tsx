/* ==========================================================================
   首页概览
   --------------------------------------------------------------------------
   这一页回答一个问题：这个社区「盘子多大、人活不活跃、内容表现如何」。

   ⚠️ 关于每张图下方的「解读」：
   这一页最早的解读里有若干具体数字（比如"接近 1 亿人""知识分区人均 68.5 分钟"），
   那些数字是当时为了撑起文案编出来的，数据变了之后就对不上了。
   现在全部改成由页面上的真实数值拼出来——数字是几就写几，
   数据没表现出差异的地方就照实说，不硬下结论。
   ========================================================================== */

import { useMemo, useState } from 'react'
import {
  Area,
  AreaChart,
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  LabelList,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts'

import ChartCard from '../components/ChartCard'
import ChartTooltip from '../components/ChartTooltip'
import DataProvenance from '../components/DataProvenance'
import DataTable from '../components/DataTable'
import KpiCard from '../components/KpiCard'
import { getOverviewAnalytics } from '../data/selectors'
import { AGE_RAMP, CHART_INK, SERIES_PRIMARY } from '../theme'
import { formatCount, formatPercent } from '../utils/format'

const RANGES = [
  { days: 7, label: '近 7 天' },
  { days: 14, label: '近 14 天' },
  { days: 30, label: '近 30 天' },
] as const

export default function Overview() {
  const [days, setDays] = useState<number>(30)
  const data = useMemo(() => getOverviewAnalytics(days), [days])
  const { kpis, trend, ageRows, categories } = data

  const rangeLabel = RANGES.find((r) => r.days === days)?.label ?? ''

  /* ---------- 趋势图：纵轴不从 0 起，否则波动会被压平 ---------- */
  const yDomain = useMemo(() => {
    const vals = trend.map((p) => p.value)
    if (vals.length === 0) return [0, 10] as [number, number]
    const min = Math.floor((Math.min(...vals) - 40) / 50) * 50
    const max = Math.ceil((Math.max(...vals) + 40) / 50) * 50
    return [Math.max(0, min), max] as [number, number]
  }, [trend])

  /* ---------- 周末效应：这个结论要由数据自己说，不能凭印象写 ---------- */
  const weekendEffect = useMemo(() => {
    const weekend: number[] = []
    const weekday: number[] = []
    for (const p of trend) {
      const dow = new Date(`${p.date}T00:00:00Z`).getUTCDay()
      if (dow === 0 || dow === 6) weekend.push(p.value)
      else weekday.push(p.value)
    }
    if (weekend.length === 0 || weekday.length === 0) return null
    const avg = (a: number[]) => a.reduce((s, n) => s + n, 0) / a.length
    const w = avg(weekend)
    const d = avg(weekday)
    return { weekend: w, weekday: d, lift: ((w - d) / d) * 100 }
  }, [trend])

  /* ---------- 年龄结构 ---------- */
  const ageMax = Math.max(...ageRows.map((r) => r.users))
  const byUsers = useMemo(() => [...ageRows].sort((a, b) => b.users - a.users), [ageRows])
  const ageTop2Share = ((byUsers[0].users + byUsers[1].users) / data.sample.users) * 100

  /* ---------- 内容分区：两张图共用同一个排序，方便逐行对照 ---------- */
  const catByPlays = useMemo(
    () => [...categories].sort((a, b) => b.plays - a.plays),
    [categories],
  )
  const playsTop = catByPlays[0]
  const playsTopRatio = catByPlays[1] ? playsTop.plays / catByPlays[1].plays : 1

  const catByMinutes = useMemo(
    () => [...categories].sort((a, b) => b.avgMinutes - a.avgMinutes),
    [categories],
  )
  const minutesTop = catByMinutes[0]
  // 人均时长第一的分区，在播放量排行里排第几？这个对比才有信息量
  const minutesTopPlayRank = catByPlays.findIndex((c) => c.category === minutesTop.category) + 1

  return (
    <div className="flex flex-col gap-4">
      {/* ---------- 第一行：五个核心指标 ---------- */}
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-5">
        {kpis.map((kpi) => (
          <KpiCard key={kpi.id} kpi={kpi} />
        ))}
      </div>

      {/* ---------- 筛选器：一行，管住下面所有图 ---------- */}
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
        <span className="text-[11.5px] text-ink-3">影响本页全部卡片与图表</span>
      </div>

      {/* ---------- 第二行：DAU 趋势 + 年龄结构 ---------- */}
      <div className="grid grid-cols-1 gap-4 xl:grid-cols-3">
        <ChartCard
          className="xl:col-span-2"
          title="DAU 趋势"
          subtitle={`每日活跃用户数 · ${rangeLabel}`}
          meta="单位：人"
          note={
            weekendEffect
              ? `窗口内周末日均活跃 ${formatCount(weekendEffect.weekend)} 人，工作日 ${formatCount(
                  weekendEffect.weekday,
                )} 人，周末高出 ${weekendEffect.lift.toFixed(
                  1,
                )}%。这里只陈述数据里的差异，不推断原因——周末的抬升同样是造数据时设定的。`
              : '当前窗口太短，还不足以对比周末与工作日。'
          }
          table={
            <DataTable
              columns={[
                { key: 'date', label: '日期' },
                { key: 'value', label: 'DAU', align: 'right', format: (v) => formatCount(Number(v)) },
              ]}
              rows={trend.map((p) => ({ date: p.date, value: p.value }))}
              maxHeight={320}
            />
          }
        >
          <ResponsiveContainer width="100%" height={264}>
            <AreaChart data={trend} margin={{ top: 8, right: 12, bottom: 0, left: 0 }}>
              <CartesianGrid stroke={CHART_INK.grid} vertical={false} />
              <XAxis
                dataKey="date"
                tick={{ fill: CHART_INK.tick, fontSize: 11 }}
                tickLine={false}
                axisLine={{ stroke: CHART_INK.axis }}
                interval={Math.max(0, Math.floor(trend.length / 6) - 1)}
                tickMargin={8}
              />
              <YAxis
                domain={yDomain}
                tickFormatter={(v: number) => formatCount(v)}
                tick={{ fill: CHART_INK.tick, fontSize: 11 }}
                tickLine={false}
                axisLine={false}
                width={52}
              />
              <Tooltip
                cursor={{ stroke: CHART_INK.axis, strokeWidth: 1 }}
                content={
                  <ChartTooltip
                    valueFormatter={(v) => `${formatCount(v)} 人`}
                    labelFormatter={(l) => `${l} 日`}
                  />
                }
              />
              <Area
                type="monotone"
                dataKey="value"
                name="DAU"
                stroke={SERIES_PRIMARY}
                strokeWidth={2}
                fill={SERIES_PRIMARY}
                fillOpacity={0.08}
                dot={false}
                activeDot={{ r: 4, strokeWidth: 2, stroke: '#ffffff' }}
                /* 关掉入场动画：数据看板要的是"打开就能读"，不是"看它慢慢长出来" */
                isAnimationActive={false}
              />
            </AreaChart>
          </ResponsiveContainer>
        </ChartCard>

        <ChartCard
          title="用户年龄分布"
          subtitle="各年龄段累计注册用户数"
          meta="单位：人"
          note={`用户最多的是${byUsers[0].label}（${formatCount(
            byUsers[0].users,
          )} 人），最少的是${byUsers[byUsers.length - 1].label}（${formatCount(
            byUsers[byUsers.length - 1].users,
          )} 人）。人数最多的两个年龄段合计占全站 ${ageTop2Share.toFixed(1)}%。`}
          table={
            <DataTable
              columns={[
                { key: 'label', label: '年龄段' },
                { key: 'users', label: '用户数', align: 'right', format: (v) => formatCount(Number(v)) },
                { key: 'dau', label: '日均活跃', align: 'right', format: (v) => Number(v).toFixed(1) },
                {
                  key: 'activeRate',
                  label: '活跃率',
                  align: 'right',
                  format: (v) => formatPercent(Number(v)),
                },
              ]}
              rows={ageRows.map((r) => ({ ...r }))}
              initialSortKey="users"
            />
          }
        >
          <ResponsiveContainer width="100%" height={264}>
            <BarChart data={ageRows} margin={{ top: 22, right: 8, bottom: 0, left: 0 }}>
              <CartesianGrid stroke={CHART_INK.grid} vertical={false} />
              <XAxis
                dataKey="label"
                tick={{ fill: CHART_INK.tick, fontSize: 10.5 }}
                tickLine={false}
                axisLine={{ stroke: CHART_INK.axis }}
                tickMargin={8}
                interval={0}
              />
              <YAxis
                domain={[0, Math.ceil((ageMax * 1.18) / 100) * 100]}
                tickFormatter={(v: number) => formatCount(v)}
                tick={{ fill: CHART_INK.tick, fontSize: 11 }}
                tickLine={false}
                axisLine={false}
                width={46}
              />
              <Tooltip
                cursor={{ fill: 'rgba(15,23,42,0.04)' }}
                content={<ChartTooltip valueFormatter={(v) => `${formatCount(v)} 人`} />}
              />
              {/* 年龄段本身有先后顺序，所以用「浅 → 深」的递进色阶，
                  而不是几个互不相干的颜色 */}
              <Bar dataKey="users" name="用户规模" radius={[4, 4, 0, 0]} barSize={38} isAnimationActive={false}>
                {ageRows.map((r, i) => (
                  <Cell key={r.id} fill={AGE_RAMP[i]} />
                ))}
                <LabelList
                  dataKey="users"
                  position="top"
                  fill={CHART_INK.value}
                  fontSize={10.5}
                  formatter={(v: unknown) => formatCount(Number(v))}
                />
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        </ChartCard>
      </div>

      {/* ---------- 第三行：内容分区表现（两张图共用同一个排序） ----------
          同一个顺序是为了让眼睛能"一行一行横着比"：
          左边最长的那根，在右边是什么位置，一眼就看出来了。 */}
      <div className="grid grid-cols-1 gap-4 xl:grid-cols-2">
        <ChartCard
          title="内容分区表现 · 播放量"
          subtitle="按播放量从高到低排序"
          meta={`单位：次 · ${rangeLabel}`}
          note={`播放量最高的是${playsTop.category}（${formatCount(
            playsTop.plays,
          )} 次），是第二名${catByPlays[1]?.category ?? '—'}的 ${playsTopRatio.toFixed(
            2,
          )} 倍。但播放量只说明"看得多"，不说明"看得深"——请对照右图同一行的位置。`}
          table={
            <DataTable
              columns={[
                { key: 'category', label: '内容分区' },
                { key: 'plays', label: '播放量', align: 'right', format: (v) => formatCount(Number(v)) },
                { key: 'totalMinutes', label: '总时长(分)', align: 'right', format: (v) => formatCount(Number(v)) },
                { key: 'likeRate', label: '点赞率', align: 'right', format: (v) => formatPercent(Number(v)) },
                { key: 'favoriteRate', label: '收藏率', align: 'right', format: (v) => formatPercent(Number(v)) },
                { key: 'commentRate', label: '评论率', align: 'right', format: (v) => formatPercent(Number(v)) },
                { key: 'shareRate', label: '分享率', align: 'right', format: (v) => formatPercent(Number(v)) },
              ]}
              rows={catByPlays.map((c) => ({ ...c }))}
              initialSortKey="plays"
            />
          }
        >
          <ResponsiveContainer width="100%" height={280}>
            <BarChart
              data={catByPlays}
              layout="vertical"
              margin={{ top: 4, right: 66, bottom: 0, left: 4 }}
            >
              <CartesianGrid stroke={CHART_INK.grid} horizontal={false} />
              <XAxis
                type="number"
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
              {/* 单系列用同一个颜色。柱子长短已经说明了大小，
                  再按类别涂成 8 种颜色属于重复编码，只会让人分心。 */}
              <Bar dataKey="plays" name="播放量" fill={SERIES_PRIMARY} radius={[0, 4, 4, 0]} barSize={15} isAnimationActive={false}>
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
          title="内容分区表现 · 单次观看时长"
          subtitle="排序与左图一致，便于逐行对照"
          meta="单位：分钟"
          note={`单次观看时长最长的是${minutesTop.category}（平均 ${minutesTop.avgMinutes.toFixed(
            1,
          )} 分钟），它在播放量排行里只排第 ${minutesTopPlayRank} 位。播放量高的分区未必留得住人，两者是不同维度的价值。`}
          table={
            <DataTable
              columns={[
                { key: 'category', label: '内容分区' },
                { key: 'avgMinutes', label: '单次时长(分)', align: 'right', format: (v) => Number(v).toFixed(1) },
                { key: 'plays', label: '播放量', align: 'right', format: (v) => formatCount(Number(v)) },
              ]}
              rows={catByPlays.map((c) => ({ ...c }))}
              initialSortKey="avgMinutes"
            />
          }
        >
          <ResponsiveContainer width="100%" height={280}>
            <BarChart
              data={catByPlays}
              layout="vertical"
              margin={{ top: 4, right: 52, bottom: 0, left: 4 }}
            >
              <CartesianGrid stroke={CHART_INK.grid} horizontal={false} />
              <XAxis
                type="number"
                tickFormatter={(v: number) => `${v}分`}
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
                content={<ChartTooltip valueFormatter={(v) => `${Number(v).toFixed(1)} 分钟`} />}
              />
              <Bar dataKey="avgMinutes" name="单次观看时长" fill={SERIES_PRIMARY} radius={[0, 4, 4, 0]} barSize={15} isAnimationActive={false}>
                <LabelList
                  dataKey="avgMinutes"
                  position="right"
                  fill={CHART_INK.value}
                  fontSize={10.5}
                  formatter={(v: unknown) => `${Number(v).toFixed(1)}`}
                />
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        </ChartCard>
      </div>

      {/* ---------- 最底下：这份数据本身的来历 ---------- */}
      <DataProvenance />
    </div>
  )
}
