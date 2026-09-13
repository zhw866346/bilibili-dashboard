/* ==========================================================================
   用户分析
   --------------------------------------------------------------------------
   这一页回答三个业务问题：
     1. 哪个年龄段的用户最多、最活跃？
     2. 各年龄段的活跃程度差多少？
     3. 每个年龄段喜欢看什么内容？

   页面的排列顺序就是回答问题的顺序：
     5 张 KPI 卡   → 先给全站的整体盘子
     图1 用户规模   → 回答"人从哪些年龄段来"
     图2 活跃率     → 回答"谁更活跃"
     表  观看行为   → 回答"谁看得更多、更深"
     图3 偏好热力图 → 回答"各年龄段喜欢什么"

   ⚠️ 关于每张图下面那段「解读」：
   所有解读文字都是由页面上的真实数值拼出来的（下面用 template 变量算出来），
   没有一句是提前写死的话术。
   数据没表现出差异的地方，就照实说"差异不明显"，绝不硬编一个结论。
   ========================================================================== */

import { useMemo, useState } from 'react'
import {
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
import Heatmap from '../components/Heatmap'
import KpiCard from '../components/KpiCard'
import { getUserAnalytics } from '../data/selectors'
import { AGE_RAMP, CHART_INK } from '../theme'
import { formatCount, formatMinutes, formatPercent } from '../utils/format'

const RANGES = [
  { days: 7, label: '近 7 天' },
  { days: 14, label: '近 14 天' },
  { days: 30, label: '近 30 天' },
] as const

export default function Users() {
  const [days, setDays] = useState<number>(30)

  // 换时间范围时，下面所有数字都会重新算一遍——这就是筛选器真正生效的地方。
  const data = useMemo(() => getUserAnalytics(days), [days])
  const { kpis, ageRows, heatmap } = data

  /* ---------- 把解读文字需要用到的数值先算出来 ---------- */

  // 用户规模最大 / 最小的年龄段
  const byUsers = useMemo(() => [...ageRows].sort((a, b) => b.users - a.users), [ageRows])
  const biggest = byUsers[0]
  const smallest = byUsers[byUsers.length - 1]

  // 活跃率最高 / 最低的年龄段
  const byRate = useMemo(() => [...ageRows].sort((a, b) => b.activeRate - a.activeRate), [ageRows])
  const mostActive = byRate[0]
  const leastActive = byRate[byRate.length - 1]

  // 人均时长、人均条数、单条时长的波动范围
  const minutesRange = useMemo(() => {
    const vals = ageRows.map((r) => r.avgMinutes)
    return { min: Math.min(...vals), max: Math.max(...vals) }
  }, [ageRows])

  const videosRange = useMemo(() => {
    const vals = ageRows.map((r) => r.avgVideos)
    return { min: Math.min(...vals), max: Math.max(...vals) }
  }, [ageRows])

  const perVideoSorted = useMemo(
    () => [...ageRows].sort((a, b) => b.minutesPerVideo - a.minutesPerVideo),
    [ageRows],
  )
  const deepest = perVideoSorted[0]
  const shallowest = perVideoSorted[perVideoSorted.length - 1]

  const rangeLabel = RANGES.find((r) => r.days === days)?.label ?? ''
  const ageMax = Math.max(...ageRows.map((r) => r.users))
  const rateMax = Math.max(...ageRows.map((r) => r.activeRate))

  return (
    <div className="flex flex-col gap-4">
      {/* ---------- 页面说明 ---------- */}
      <p className="text-[13px] leading-relaxed text-ink-2">
        从<span className="font-medium text-ink">用户规模</span>、
        <span className="font-medium text-ink">活跃度</span>、
        <span className="font-medium text-ink">内容偏好</span>
        三个维度分析用户行为。下方所有指标都由同一套模拟观看明细逐条汇总而来，
        切换时间范围会重新计算全部数字。
        <span className="text-ink-3">
          　⚠️ 这些数字算得准，但数据本身是模拟的——页面上出现的每一条「规律」，
          背后都是我在造数据时设好的参数。具体对应关系写在页面最下方。
        </span>
      </p>

      {/* ---------- 五张核心指标卡 ---------- */}
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

      {/* ---------- 图1 + 图2：年龄段规模 与 活跃率 ---------- */}
      <div className="grid grid-cols-1 gap-4 xl:grid-cols-2">
        {/* 图1｜谁在这个平台上 */}
        <ChartCard
          title="各年龄段用户规模"
          subtitle={`累计注册用户数 · ${rangeLabel}`}
          meta="单位：人"
          note={`用户规模最大的是${biggest.label}（${formatCount(biggest.users)} 人，占 ${formatPercent(
            (biggest.users / data.sample.users) * 100,
          )}），最小的是${smallest.label}（${formatCount(smallest.users)} 人），两者相差 ${(
            biggest.users / smallest.users
          ).toFixed(1)} 倍。这只是"人数"，不代表谁更活跃——请看右图。`}
          table={
            <DataTable
              columns={[
                { key: 'label', label: '年龄段' },
                { key: 'users', label: '用户数', align: 'right', format: (v) => formatCount(Number(v)) },
                {
                  key: 'ratio',
                  label: '占比',
                  align: 'right',
                  format: (v) => formatPercent(Number(v)),
                },
              ]}
              rows={ageRows.map((r) => ({
                label: r.label,
                users: r.users,
                ratio: (r.users / data.sample.users) * 100,
              }))}
              initialSortKey="users"
            />
          }
        >
          <ResponsiveContainer width="100%" height={252}>
            <BarChart data={ageRows} margin={{ top: 22, right: 8, bottom: 0, left: 0 }}>
              <CartesianGrid stroke={CHART_INK.grid} vertical={false} />
              <XAxis
                dataKey="label"
                tick={{ fill: CHART_INK.tick, fontSize: 11 }}
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
                width={48}
              />
              <Tooltip
                cursor={{ fill: 'rgba(15,23,42,0.04)' }}
                content={<ChartTooltip valueFormatter={(v) => `${formatCount(v)} 人`} />}
              />
              <Bar dataKey="users" name="用户数" radius={[4, 4, 0, 0]} barSize={40} isAnimationActive={false}>
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

        {/* 图2｜谁更活跃 */}
        <ChartCard
          title="各年龄段活跃率"
          subtitle="日均活跃用户 ÷ 该年龄段用户总量"
          meta="单位：%"
          note={`活跃率最高的是${mostActive.label}（${formatPercent(
            mostActive.activeRate,
          )}），最低的是${leastActive.label}（${formatPercent(
            leastActive.activeRate,
          )}），相差 ${(mostActive.activeRate - leastActive.activeRate).toFixed(1)} 个百分点。同一时间范围内，活跃率越高说明这个年龄段的人越习惯每天打开 App。`}
          table={
            <DataTable
              columns={[
                { key: 'label', label: '年龄段' },
                { key: 'dau', label: '日均活跃', align: 'right', format: (v) => Number(v).toFixed(1) },
                { key: 'users', label: '用户数', align: 'right', format: (v) => formatCount(Number(v)) },
                {
                  key: 'rate',
                  label: '活跃率',
                  align: 'right',
                  format: (v) => formatPercent(Number(v)),
                },
              ]}
              rows={ageRows.map((r) => ({
                label: r.label,
                dau: r.dau,
                users: r.users,
                rate: r.activeRate,
              }))}
              initialSortKey="rate"
            />
          }
        >
          <ResponsiveContainer width="100%" height={252}>
            <BarChart data={ageRows} margin={{ top: 22, right: 8, bottom: 0, left: 0 }}>
              <CartesianGrid stroke={CHART_INK.grid} vertical={false} />
              <XAxis
                dataKey="label"
                tick={{ fill: CHART_INK.tick, fontSize: 11 }}
                tickLine={false}
                axisLine={{ stroke: CHART_INK.axis }}
                tickMargin={8}
                interval={0}
              />
              <YAxis
                domain={[0, Math.ceil((rateMax * 1.22) / 5) * 5]}
                tickFormatter={(v: number) => `${v}%`}
                tick={{ fill: CHART_INK.tick, fontSize: 11 }}
                tickLine={false}
                axisLine={false}
                width={44}
              />
              <Tooltip
                cursor={{ fill: 'rgba(15,23,42,0.04)' }}
                content={<ChartTooltip valueFormatter={(v) => formatPercent(v)} />}
              />
              <Bar dataKey="activeRate" name="活跃率" radius={[4, 4, 0, 0]} barSize={40} isAnimationActive={false}>
                {ageRows.map((r, i) => (
                  <Cell key={r.id} fill={AGE_RAMP[i]} />
                ))}
                <LabelList
                  dataKey="activeRate"
                  position="top"
                  fill={CHART_INK.value}
                  fontSize={10.5}
                  formatter={(v: unknown) => `${Number(v).toFixed(1)}%`}
                />
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        </ChartCard>
      </div>

      {/* ---------- 图3：观看行为明细（表格 + 单元格内嵌条形） ---------- */}
      <ChartCard
        title="各年龄段观看行为"
        subtitle="点表头可以排序 · 条形长度表示该列的相对大小"
        note={`这里有一个值得注意的地方：四个年龄段的日均观看时长都在 ${minutesRange.min.toFixed(
          0,
        )}–${minutesRange.max.toFixed(0)} 分钟之间，差异不大；但人均观看视频数从 ${videosRange.min.toFixed(
          2,
        )} 个到 ${videosRange.max.toFixed(2)} 个，最高是最低的 ${(
          videosRange.max / videosRange.min
        ).toFixed(1)} 倍。折算到每一条视频，${deepest.label}平均看 ${deepest.minutesPerVideo.toFixed(
          1,
        )} 分钟，${shallowest.label}只有 ${shallowest.minutesPerVideo.toFixed(
          1,
        )} 分钟。也就是说"刷得多"和"看得深"是两件事，本页只陈述这个差异本身，不推断原因。`}
      >
        <div className="px-2 pb-1">
          <DataTable
            columns={[
              { key: 'label', label: '年龄段' },
              { key: 'users', label: '用户数量', align: 'right', format: (v) => formatCount(Number(v)) },
              { key: 'dau', label: 'DAU', align: 'right', format: (v) => Number(v).toFixed(1) },
              {
                key: 'activeRate',
                label: '活跃率',
                align: 'right',
                bar: true,
                format: (v) => formatPercent(Number(v)),
              },
              {
                key: 'avgMinutes',
                label: '人均观看时长',
                align: 'right',
                bar: true,
                format: (v) => formatMinutes(Number(v)),
              },
              {
                key: 'avgVideos',
                label: '人均观看视频数',
                align: 'right',
                bar: true,
                format: (v) => `${Number(v).toFixed(2)} 个`,
              },
              {
                key: 'minutesPerVideo',
                label: '单条平均时长',
                align: 'right',
                format: (v) => formatMinutes(Number(v)),
              },
            ]}
            rows={ageRows.map((r) => ({ ...r }))}
            initialSortKey="activeRate"
            maxHeight={280}
            footnote="口径：人均观看时长 = 窗口内总观看时长 ÷（该年龄段日均活跃用户数 × 天数）；人均观看视频数同理。单条平均时长 = 人均观看时长 ÷ 人均观看视频数。"
          />
        </div>
      </ChartCard>

      {/* ---------- 图4：年龄 × 内容偏好热力图 ---------- */}
      <ChartCard
        title="年龄 × 内容偏好"
        subtitle="格子里是观看量，颜色深浅代表该年龄段在这个分区上的观看量占比"
        meta={`单位：次 · ${rangeLabel}`}
        note={heatmapNote(heatmap.peak, heatmap.rows, days)}
      >
        <div className="px-2 pb-1 pt-1">
          <Heatmap data={heatmap} />
        </div>
      </ChartCard>

      {/* ---------- 底部：这一页的数字是怎么来的 ---------- */}
      <section className="rounded-xl border border-hairline bg-card px-5 py-4">
        <h3 className="text-[13px] font-semibold text-ink">这一页的数字是怎么算出来的</h3>
        <dl className="mt-2.5 grid grid-cols-1 gap-x-8 gap-y-2 text-[11.5px] leading-relaxed text-ink-2 sm:grid-cols-2">
          <div>
            <dt className="font-medium text-ink">用户总量</dt>
            <dd>截至 {data.rangeLabel.split(' ~ ')[1]} 已注册的用户数，是"存量"，不随窗口长短变化。</dd>
          </div>
          <div>
            <dt className="font-medium text-ink">DAU（日均活跃用户）</dt>
            <dd>每天"看过至少 1 个视频"的用户去重后计数，再对天数取平均。</dd>
          </div>
          <div>
            <dt className="font-medium text-ink">活跃率</dt>
            <dd>DAU ÷ 用户总量。分子分母取自同一批用户、同一个截止日。</dd>
          </div>
          <div>
            <dt className="font-medium text-ink">人均观看时长 / 视频数</dt>
            <dd>窗口总量 ÷（DAU × 天数），即"每个活跃用户每天"的平均值。</dd>
          </div>
          <div>
            <dt className="font-medium text-ink">年龄 × 内容</dt>
            <dd>由「用户 → 观看记录 → 视频 → 分区」逐条关联汇总得出，不是手工填的矩阵。</dd>
          </div>
          <div>
            <dt className="font-medium text-ink">本页样本量</dt>
            <dd>
              {data.sample.days} 天 · {formatCount(data.sample.users)} 名注册用户 ·{' '}
              {formatCount(data.sample.activeUsers)} 名活跃用户 ·{' '}
              {formatCount(data.sample.views)} 条观看记录。
            </dd>
          </div>
        </dl>
      </section>

      {/* ---------- 最底下：这份数据本身的来历 ----------
          上面的「怎么算的」讲的是口径，这一段讲的是"这数据我该信到什么程度"。
          两件事不一样，所以分开写、都放上，别让人把模拟数据当成真实结论。 */}
      <DataProvenance />
    </div>
  )
}

/* --------------------------------------------------------------------------
   热力图下面的解读文字。
   同样地，所有数字都是从这个窗口的真实数据里取出来的，
   数据是什么样就说什么样，不预先写好结论。
   -------------------------------------------------------------------------- */
function heatmapNote(
  peak: { age: string; category: string; share: number } | null,
  rows: { id: string; label: string; cells: { category: string; share: number }[] }[],
  days: number,
): string {
  if (!peak) return '当前窗口内没有可用于分析的观看记录。'

  // 每个年龄段最偏好的分区（行内占比第一）
  const tops = rows.map((r) => {
    const best = [...r.cells].sort((a, b) => b.share - a.share)[0]
    return `${r.label}是${best.category}（${best.share.toFixed(1)}%）`
  })

  return (
    `近 ${days} 天里，全部 32 个格子里颜色最深的是${peak.age} × ${peak.category}，` +
    `占该年龄段观看量的 ${peak.share.toFixed(1)}%。各年龄段的第一偏好分别是：${tops.join('，')}。` +
    `注意读法：同一行内横向比较才有意义（比的是"偏好"），跨行比绝对值比的是"人数多少"，` +
    `因为 18–24 岁的人数本来就比 40 岁以上多得多。`
  )
}
