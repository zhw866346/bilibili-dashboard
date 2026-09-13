/* ==========================================================================
   用户 × 内容分析
   --------------------------------------------------------------------------
   前面三页各管一段：首页看整体、用户分析看人、内容分析看内容。
   这一页把两边接起来，回答的是"谁在看什么"：

     1. 不同年龄段的用户，内容偏好有什么不同？   → 模块 1、模块 2
     2. 哪些年龄段是哪些内容的核心用户？         → 模块 3
     3. 哪些内容吸引了用户，但带不来深度消费？   → 模块 4
     4. 哪些内容规模不大，但粘性和互动很强？     → 模块 5、模块 6
     5. 应该给哪些用户推荐什么内容？             → 模块 7

   数据链路（和另外三页是同一套明细，没有另造一份数据）：
     用户表 users ──user_id──> 观看记录表 video_views ──video_id──> 视频表 videos ──> 内容分区
                                    │
                                    └──> 按【年龄段 × 分区】切成 4 × 8 = 32 个格子

   ★ 关于"分母"：这一页最容易算错的就是分母，所以每个指标的口径都写在
     页面最下方的「这一页的数字是怎么算出来的」里，也写在 selectors.ts 的注释里。
     简单说：覆盖率的分母是【该年龄段的观看人数】，不是播放量；
     偏好占比的分母是【该年龄段 8 个分区的播放量之和】。
   ========================================================================== */

import { useMemo, useState, type ReactNode } from 'react'

import AgeTopContent from '../components/AgeTopContent'
import ChartCard from '../components/ChartCard'
import ContentUserStructure from '../components/ContentUserStructure'
import DataProvenance from '../components/DataProvenance'
import DataTable from '../components/DataTable'
import Heatmap from '../components/Heatmap'
import KpiCard from '../components/KpiCard'
import UserContentOpportunity from '../components/UserContentOpportunity'
import UserContentStrategy from '../components/UserContentStrategy'
import { getUserContentAnalytics } from '../data/selectors'
import { COMPLETION_THRESHOLD } from '../data/metrics'
import { AGE_GROUPS, AGE_GROUP_IDS } from '../utils/ageGroup'
import { CATEGORIES } from '../utils/categories'
import { formatCount, formatMinutes, formatPercent } from '../utils/format'
import type { AgeGroupId } from '../types'

const RANGES = [
  { days: 7, label: '近 7 天' },
  { days: 14, label: '近 14 天' },
  { days: 30, label: '近 30 天' },
] as const

/** 年龄筛选器：全部 + 4 个年龄段 */
const AGE_FILTERS: { id: AgeGroupId | 'all'; label: string }[] = [
  { id: 'all', label: '全部年龄段' },
  ...AGE_GROUPS.map((g) => ({ id: g.id, label: g.label })),
]

export default function UserContent() {
  const [days, setDays] = useState<number>(30)
  const [ageFilter, setAgeFilter] = useState<AgeGroupId | 'all'>('all')
  // 推荐策略模拟用的年龄段，和上面的筛选器互相独立：
  // 上面那个筛的是"表格里要看谁"，这个选的是"给谁做推荐"，两者不是一回事。
  const [strategyAge, setStrategyAge] = useState<AgeGroupId>('25-31')

  // 换时间范围 → 本页全部数字重算（包括 32 个格子、热力图、矩阵、表格）
  const data = useMemo(() => getUserContentAnalytics(days), [days])

  const rangeLabel = RANGES.find((r) => r.days === days)?.label ?? ''
  const ageFilterLabel =
    ageFilter === 'all' ? '全部年龄段' : (AGE_GROUPS.find((g) => g.id === ageFilter)?.label ?? '')

  /*
    年龄筛选只作用于【机会矩阵】和【明细表】。

    为什么不做成全局筛选？试过就知道：一旦全局生效，
    模块 2「各年龄段 TOP 内容」会只剩一个年龄段（四张卡变一张），
    模块 3「内容用户结构」的堆叠条会从四段变成一段（100% 堆叠图直接失去意义），
    模块 1 的热力图会从四行变成一行。
    这三个模块的结论本来就建立在"年龄段之间的对比"上，筛掉之后就没得比了。
    所以筛选只放在真正"越筛越有用"的两个模块上。
  */
  const visibleAges = useMemo<AgeGroupId[]>(
    () => (ageFilter === 'all' ? [...AGE_GROUP_IDS] : [ageFilter]),
    [ageFilter],
  )

  const tableCells = useMemo(
    () => data.cells.filter((c) => visibleAges.includes(c.age)),
    [data.cells, visibleAges],
  )

  /* 每个组合落在哪个象限 —— 明细表最后一列要用 */
  const quadrantLabelOf = useMemo(() => {
    const labelByKey = new Map(data.opportunity.quadrants.map((q) => [q.key, q.label]))
    const out = new Map<string, string>()
    for (const p of data.opportunity.allPoints) {
      out.set(`${p.age}|${p.category}`, labelByKey.get(p.quadrant) ?? '—')
    }
    return out
  }, [data.opportunity])

  /* 深度极值：报告和解读文字要用，全部从实际数据算 */
  const byDepth = useMemo(
    () => [...data.cells].filter((c) => c.views > 0).sort((a, b) => b.minutesPerViewer - a.minutesPerViewer),
    [data.cells],
  )
  const depthTop = byDepth[0]
  const depthBottom = byDepth[byDepth.length - 1]

  /* 覆盖率跨度：机会矩阵纵轴到底有没有区分度，用这个数字说话 */
  const coverMin = Math.min(...data.cells.map((c) => c.coverageRate))
  const coverMax = Math.max(...data.cells.map((c) => c.coverageRate))

  return (
    <div className="flex flex-col gap-4">
      {/* ---------- 页面说明 ---------- */}
      <p className="text-[13px] leading-relaxed text-ink-2">
        这一页把<span className="font-medium text-ink">用户</span>和
        <span className="font-medium text-ink">内容</span>接在一起：
        按<span className="font-medium text-ink">年龄段</span>把用户分组，
        看每个年龄段的<span className="font-medium text-ink">内容偏好</span>、
        <span className="font-medium text-ink">消费深度</span>和
        <span className="font-medium text-ink">互动行为</span>，
        最后落到<span className="font-medium text-ink">机会矩阵</span>和
        <span className="font-medium text-ink">推荐策略模拟</span>上。
        全部分析复用前几页的同一套模拟观看明细，没有另外造一份数据。
        <span className="text-ink-3">
          　⚠️ 这套数据在建模上的一个不足，直接影响本页怎么读，写在下面第三张热力图下方。
        </span>
      </p>

      {/* ---------- 第一部分：四张核心指标卡 ---------- */}
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
        {data.kpis.map((kpi) => (
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

        <span className="ml-2 text-[12px] font-medium text-ink-2">年龄段</span>
        <div className="flex gap-0.5 rounded-lg border border-hairline bg-card p-0.5">
          {AGE_FILTERS.map((f) => (
            <button
              key={f.id}
              type="button"
              onClick={() => setAgeFilter(f.id)}
              aria-pressed={ageFilter === f.id}
              className={`rounded-md px-2.5 py-1 text-[12px] font-medium transition-colors ${
                ageFilter === f.id ? 'bg-ink text-white' : 'text-ink-2 hover:bg-plane hover:text-ink'
              }`}
            >
              {f.label}
            </button>
          ))}
        </div>

        <span className="text-[11.5px] text-ink-3">
          当前窗口 {data.rangeLabel} · 时间范围影响本页全部模块；年龄段只影响
          <span className="text-ink-2">机会矩阵</span>和<span className="text-ink-2">明细表</span>
          ，原因见下方说明
        </span>
      </div>

      {/* ================================================================
          模块 1：年龄 × 内容偏好
          ================================================================ */}
      <ModuleHeading index={1} title="年龄 × 内容偏好" purpose="不同年龄段的口味分布有什么不同" />

      <ChartCard
        title="年龄 × 内容偏好热力图"
        subtitle="颜色深浅 = 该年龄段内部的内容占比（行内归一化，每行加起来 100%）"
        meta={`单位：% · ${rangeLabel}`}
        note={
          `这张图的颜色不是播放量，是【行内占比】：先把一个年龄段的播放量按 8 个分区拆开、` +
          `再折成百分比，所以每一行加起来都是 100%。` +
          `为什么不用播放量上色？因为 18–24 岁的人比 40+ 多得多，用绝对量的话人多的那一整行都会更深，` +
          `那是"人多"不是"偏爱"。换成占比之后，同一行里颜色深的格子才是真的更爱看。` +
          `行与行之间不要比颜色深浅，要比"哪个格子在这行里最深"——这是两张不同的读数方式。`
        }
        table={
          <DataTable
            columns={[
              { key: 'ageLabel', label: '年龄段' },
              { key: 'category', label: '内容分区' },
              {
                key: 'preferShare',
                label: '偏好占比',
                align: 'right',
                bar: true,
                format: (v) => formatPercent(Number(v)),
              },
              { key: 'views', label: '播放量', align: 'right', format: (v) => formatCount(Number(v)) },
              {
                key: 'viewers',
                label: '独立观看用户',
                align: 'right',
                format: (v) => formatCount(Number(v)),
              },
            ]}
            rows={data.cells.map((c) => ({ ...c }))}
            initialSortKey="preferShare"
            maxHeight={340}
            footnote="偏好占比 = 该格子播放次数 ÷ 该年龄段 8 个分区播放次数之和。每一行的 8 个格子加起来正好 100%。"
          />
        }
      >
        <div className="px-2 pb-1 pt-1">
          <Heatmap data={data.preferHeatmap} />
        </div>
      </ChartCard>

      {/* ================================================================
          模块 2：各年龄段 TOP 内容
          ================================================================ */}
      <ModuleHeading index={2} title="各年龄段 TOP 内容" purpose="排在最前面的是哪几个，领先多少" />

      <section className="rounded-xl border border-hairline bg-card">
        <header className="flex items-start justify-between gap-3 border-b border-hairline px-5 py-3.5">
          <div className="min-w-0">
            <h3 className="text-[13px] font-semibold text-ink">各年龄段偏好前三名</h3>
            <p className="mt-0.5 text-[11.5px] text-ink-2">
              条形长度用同一把尺子（四个年龄段里最大的那个占比做满格），所以四张卡片可以直接横着比
            </p>
          </div>
        </header>
        <div className="py-3.5">
          <AgeTopContent data={data.preferenceByAge} />
        </div>
      </section>

      {/* ================================================================
          模块 3：内容 → 谁在看
          ================================================================ */}
      <ModuleHeading index={3} title="内容用户结构" purpose="哪些年龄段是哪些内容的核心用户" />

      <ChartCard
        title="内容 → 谁在看（100% 堆叠）"
        subtitle="每一行拉成等长，看到的是「构成」不是「多少」"
        meta="单位：占比"
        note={
          `和上面的偏好图是反方向的两张图：偏好图是"用户 → 喜欢什么"，这里是"内容 → 谁在看"。` +
          `每一行拉成 100%，所以看到的是这个分区的观众由哪些年龄段构成。` +
          `行按 18–24 岁的占比从高到低排，越靠上说明这个分区越年轻化。` +
          `⚠️ 读的时候注意：这里比的是"构成比例"，不是"哪个分区年轻人多"——` +
          `18–24 岁本来就占了总用户的最大一块，所以每一行的第一段都会偏大。` +
          `真正有信息量的是这个段在不同行之间的高低差。`
        }
        table={
          <DataTable
            columns={[
              { key: 'category', label: '内容分区' },
              ...AGE_GROUPS.map((g) => ({
                key: g.id,
                label: g.label,
                align: 'right' as const,
                format: (v: number | string) => formatPercent(Number(v)),
              })),
              {
                key: 'viewers',
                label: '独立观看用户',
                align: 'right' as const,
                format: (v: number | string) => formatCount(Number(v)),
              },
            ]}
            rows={data.structure.map((s) => {
              const row: Record<string, string | number> = {
                category: s.category,
                viewers: s.viewers,
              }
              for (const seg of s.segments) row[seg.age] = seg.share
              return row
            })}
            initialSortKey="18-24"
            maxHeight={300}
            footnote="每一列的四个年龄段加起来 = 100%；视角和上面的偏好占比表正好相反（那张表是按行归一化的）。"
          />
        }
      >
        <div className="px-2 pb-1 pt-1">
          <ContentUserStructure data={data.structure} />
        </div>
      </ChartCard>

      {/* ================================================================
          模块 4：消费深度
          ================================================================ */}
      <ModuleHeading index={4} title="用户 × 内容消费深度" purpose="哪些内容吸引了用户，却带不来深度消费" />

      <ChartCard
        title="年龄 × 消费深度热力图"
        subtitle={`颜色 = 人均观看时长（该格子的观看总时长 ÷ 该格子的独立观看用户数）`}
        meta={`单位：分钟 · ${rangeLabel}`}
        note={
          (depthTop && depthBottom
            ? `看得最深的是【${depthTop.ageLabel} × ${depthTop.category}】（人均 ${depthTop.minutesPerViewer.toFixed(
                1,
              )} 分钟），最浅的是【${depthBottom.ageLabel} × ${depthBottom.category}】（人均 ${depthBottom.minutesPerViewer.toFixed(
                1,
              )} 分钟），相差 ${(
                depthTop.minutesPerViewer / Math.max(0.01, depthBottom.minutesPerViewer)
              ).toFixed(1)} 倍。` +
              `同一个分区在不同年龄段之间的差距也值得看：横向扫一行，色块深浅差得多，` +
              `说明这类内容对某个年龄段特别"留得住人"，对别的年龄段只是划过去。`
            : '当前窗口的观看记录不足，无法比较消费深度。') +
          `口径提醒：分母是"看过这个组合的去重人数"，即"看过的人平均一共看了多久"，` +
          `不是"每次看多久"。所以这个数字会随窗口拉长而变大，跨窗口比较请看排名，不要看绝对值。`
        }
        table={
          <DataTable
            columns={[
              { key: 'ageLabel', label: '年龄段' },
              { key: 'category', label: '内容分区' },
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
                key: 'viewsPerViewer',
                label: '人均观看次数',
                align: 'right',
                format: (v) => `${Number(v).toFixed(2)} 次`,
              },
              {
                key: 'completedRate',
                label: '完播率',
                align: 'right',
                format: (v) => formatPercent(Number(v)),
              },
            ]}
            rows={data.cells.map((c) => ({ ...c }))}
            initialSortKey="minutesPerViewer"
            maxHeight={340}
            footnote={
              <>
                <span className="font-medium text-ink-2">三个口径别搞混：</span>
                人均观看时长 = 总时长 ÷ 独立观看用户（看过的人一共看多久）；
                单次观看时长 = 总时长 ÷ 播放次数（平均点开一次看多久）；
                人均观看次数 = 播放次数 ÷ 独立观看用户。
              </>
            }
          />
        }
      >
        <div className="px-2 pb-1 pt-1">
          <Heatmap data={data.depthHeatmap} />
        </div>
      </ChartCard>

      {/* ================================================================
          模块 5：互动行为
          ================================================================ */}
      <ModuleHeading index={5} title="用户 × 内容互动" purpose="哪些内容规模不大，但粘性和互动很强" />

      <ChartCard
        title="年龄 × 内容互动热力图"
        subtitle="颜色 = 综合互动率 =（点赞 + 收藏 + 评论 + 分享）÷ 播放次数"
        meta={`单位：% · ${rangeLabel}`}
        note={
          `综合互动率的分子是【互动行为的次数】，不是人数——一个人又点赞又收藏，` +
          `在这里算 2 次互动；分母是播放次数，两者口径一致，所以不会出现超过 100% 的误会。` +
          `互动率和消费深度是两件不同的事：有的内容看得久但没人互动（比如长视频知识区，看完就关），` +
          `有的内容看得不长但互动很密（比如娱乐、音乐，看完顺手点个赞）。` +
          `所以这两张热力图要分开看，不能互相替代。`
        }
        table={
          <DataTable
            columns={[
              { key: 'ageLabel', label: '年龄段' },
              { key: 'category', label: '内容分区' },
              { key: 'views', label: '播放量', align: 'right', format: (v) => formatCount(Number(v)) },
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
            rows={data.cells.map((c) => ({ ...c }))}
            initialSortKey="engageRate"
            maxHeight={340}
            footnote="四项互动率的分母都是该格子的播放次数。综合互动率 = 四项之和 ÷ 播放次数，所以它等于四项相加。"
          />
        }
      >
        <div className="px-2 pb-1 pt-1">
          <Heatmap data={data.engageHeatmap} />
        </div>

        {/* 这一页最重要的一条局限：纵轴的区分度到底有多少，用数字说清楚 */}
        <div className="mx-2 mt-3 rounded-lg border border-amber-200 bg-amber-50/60 px-3.5 py-2.5">
          <p className="text-[11.5px] font-semibold text-amber-900">
            ⚠️ 这套数据里「用户覆盖率」的区分度有限，直接影响机会矩阵的纵轴
          </p>
          <p className="mt-1 text-[11.5px] leading-relaxed text-amber-900/90">
            32 个组合的覆盖率落在 {formatPercent(coverMin)} ~ {formatPercent(coverMax)} 之间，
            跨度 {(coverMax - coverMin).toFixed(1)} 个百分点。
            放在全站口径上看，八个分区都被 {formatPercent((Math.min(...CATEGORIES.map((c) => data.structure.find((s) => s.category === c)?.viewers ?? 0)) / Math.max(1, data.sample.viewers)) * 100, 0)} ~ {formatPercent((Math.max(...CATEGORIES.map((c) => data.structure.find((s) => s.category === c)?.viewers ?? 0)) / Math.max(1, data.sample.viewers)) * 100, 0)} 的用户看过——
            <span className="font-semibold">
              这套模拟数据里没有真正"小众"的内容分区
            </span>
            。原因是造数据的方式：每个活跃用户每天都会按偏好权重从八个分区里抽 1~5 条来看，
            抽满一个时间窗口后，几乎每个人每个分区都碰过了。
          </p>
          <p className="mt-1.5 text-[11.5px] leading-relaxed text-amber-900/90">
            <span className="font-semibold">那机会矩阵还能不能用？能，但要知道它比的是什么。</span>
            纵轴在"年龄段 × 分区"这个粒度上仍有 {(coverMax - coverMin).toFixed(1)} 个百分点的跨度
            （最窄 {formatPercent(coverMin)}，最宽 {formatPercent(coverMax)}），
            所以四张小图之间仍然看得出差异；只是这个差异比真实业务里小得多，
            别把"覆盖率靠后"读成"没人看"。这是建模的不足，先如实标出来。
          </p>
        </div>
      </ChartCard>

      {/* ================================================================
          模块 6：机会矩阵
          ================================================================ */}
      <ModuleHeading index={6} title="用户 × 内容机会矩阵" purpose="把覆盖、深度、互动放在一张图上看定位" />

      <ChartCard
        title={`用户 × 内容机会矩阵${ageFilter === 'all' ? '' : ` · 只看${ageFilterLabel}`}`}
        subtitle="横轴：消费深度（人均观看时长）　纵轴：用户覆盖率　气泡大小：综合互动率"
        meta={`${visibleAges.length} 个年龄段 × ${CATEGORIES.length} 个分区`}
        note={
          `横轴用【人均观看时长】而不是单次时长：人均是"看过的人一共看了多久"，` +
          `更能反映这个人群对这类内容的总体投入。纵轴用【覆盖率】而不是绝对人数——` +
          `四个年龄段人数差很多（18–24 岁 1913 人、40+ 只有 857 人），` +
          `用人数的话 40+ 那张图的气泡会全部贴在底下，比的是"这个年龄段人多人少"而不是"这个分区吃得开不开"。` +
          `绝对人数放在悬停提示里。` +
          `四张图共用同一套坐标轴范围和同一组分界线（画在全部 32 个组合的中位数上：` +
          `停留 ${data.opportunity.xMedian.toFixed(1)} 分、覆盖 ${data.opportunity.yMedian.toFixed(1)}%），` +
          `所以可以直接横着比——"同样是游戏，18–24 岁和 40+ 站在完全不同的位置"一眼就能看到。` +
          `象限名字是分析框架，不是内容好坏的判决：流量型内容照样有价值，它的价值在拉新和活跃。`
        }
        table={
          <DataTable
            columns={[
              { key: 'quadrantLabel', label: '象限归类' },
              { key: 'ageLabel', label: '年龄段' },
              { key: 'category', label: '内容分区' },
              {
                key: 'minutesPerViewer',
                label: '人均观看时长',
                align: 'right',
                bar: true,
                format: (v) => formatMinutes(Number(v)),
              },
              {
                key: 'coverageRate',
                label: '用户覆盖率',
                align: 'right',
                bar: true,
                format: (v) => formatPercent(Number(v)),
              },
              {
                key: 'engageRate',
                label: '综合互动率',
                align: 'right',
                format: (v) => formatPercent(Number(v)),
              },
              {
                key: 'viewers',
                label: '独立观看用户',
                align: 'right',
                format: (v) => formatCount(Number(v)),
              },
            ]}
            rows={tableCells.map((c) => ({
              ...c,
              quadrantLabel: quadrantLabelOf.get(`${c.age}|${c.category}`) ?? '—',
            }))}
            initialSortKey="minutesPerViewer"
            maxHeight={340}
            footnote="分界线取全部 32 个组合的中位数，属于相对划分；换时间窗口时线的位置会动，归类也可能变。"
          />
        }
      >
        <div className="px-2 pb-1 pt-1">
          <UserContentOpportunity data={data.opportunity} visibleAges={visibleAges} />

          {/* 四象限各自的成员，配上一句话说明 */}
          <div className="mt-3 grid grid-cols-1 gap-2.5 px-1 sm:grid-cols-2 xl:grid-cols-4">
            {data.opportunity.quadrants.map((q) => (
              <div key={q.key} className="rounded-lg border border-hairline bg-plane/40 px-3 py-2.5">
                <p className="text-[12px] font-semibold text-ink">
                  {q.label}
                  <span className="ml-1.5 text-[11px] font-normal tabular-nums text-ink-3">
                    {q.members.length} 个
                  </span>
                </p>
                <p className="mt-1 text-[11px] leading-relaxed text-ink-2">{q.desc}</p>
                <p className="mt-1.5 text-[10.5px] leading-relaxed text-ink-3">
                  {q.members.length > 0 ? q.members.join('、') : '本窗口没有组合落在这一格'}
                </p>
              </div>
            ))}
          </div>
        </div>
      </ChartCard>

      {/* ================================================================
          模块 7：推荐策略模拟
          ================================================================ */}
      <ModuleHeading index={7} title="推荐策略模拟" purpose="如果只能推 3 个分区，该推哪 3 个" />

      <section className="rounded-xl border border-hairline bg-card">
        <header className="border-b border-hairline px-5 py-3.5">
          <h3 className="text-[13px] font-semibold text-ink">推荐策略模拟 · 按年龄段</h3>
          <p className="mt-0.5 text-[11.5px] text-ink-2">
            排序规则：先按偏好占比（这个人群的注意力实际花在哪），占比接近时再看人均观看时长（避免把"点开就走"的推上去）。
            三条理由全部由当前窗口的实际数值拼出来，没有写死的话术。
          </p>
        </header>
        <div className="py-3.5">
          <UserContentStrategy days={days} age={strategyAge} onAgeChange={setStrategyAge} />
        </div>
      </section>

      {/* ================================================================
          明细表：32 个组合的全部指标
          ================================================================ */}
      <section className="rounded-xl border border-hairline bg-card">
        <header className="border-b border-hairline px-5 py-3.5">
          <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
            <h3 className="text-[13px] font-semibold text-ink">
              用户 × 内容明细表
              <span className="ml-2 text-[11.5px] font-normal text-ink-3">
                当前显示 {tableCells.length} / {data.cells.length} 行
                {ageFilter === 'all' ? '' : ` · 已筛 ${ageFilterLabel}`}
              </span>
            </h3>
            <p className="text-[11.5px] text-ink-2">
              点表头可以排序（按原始数值排，不是按显示文字）
            </p>
          </div>
        </header>
        <div className="px-3 py-3">
          <DataTable
            columns={[
              { key: 'ageLabel', label: '年龄段' },
              { key: 'category', label: '内容分区' },
              {
                key: 'viewers',
                label: '独立观看用户',
                align: 'right',
                format: (v) => formatCount(Number(v)),
              },
              { key: 'views', label: '播放量', align: 'right', format: (v) => formatCount(Number(v)) },
              {
                key: 'preferShare',
                label: '偏好占比',
                align: 'right',
                format: (v) => formatPercent(Number(v)),
              },
              {
                key: 'coverageRate',
                label: '用户覆盖率',
                align: 'right',
                bar: true,
                format: (v) => formatPercent(Number(v)),
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
              {
                key: 'engageRate',
                label: '综合互动率',
                align: 'right',
                format: (v) => formatPercent(Number(v)),
              },
              { key: 'quadrantLabel', label: '象限归类' },
            ]}
            rows={tableCells.map((c) => ({
              ...c,
              quadrantLabel: quadrantLabelOf.get(`${c.age}|${c.category}`) ?? '—',
            }))}
            initialSortKey="viewers"
            maxHeight={420}
            footnote={
              <>
                12 列全部来自同一套明细。要注意三个分母各不相同：
                <span className="font-medium text-ink-2">用户覆盖率</span>的分母是【该年龄段的观看人数】；
                <span className="font-medium text-ink-2">偏好占比</span>的分母是【该年龄段 8 个分区的播放量之和】；
                <span className="font-medium text-ink-2">人均观看次数 / 人均观看时长 / 单次观看时长 / 各项互动率</span>
                的分母列在下方口径说明里。
              </>
            }
          />
        </div>
      </section>

      {/* ================================================================
          核心发现（全部由数据算出来）
          ================================================================ */}
      <section className="rounded-xl border border-hairline bg-card">
        <header className="border-b border-hairline px-5 py-3.5">
          <h3 className="text-[13px] font-semibold text-ink">核心发现</h3>
          <p className="mt-0.5 text-[11.5px] text-ink-2">
            以下每一条都是从当前窗口的实际数值里挑出来的极值和对比，没有预设结论
          </p>
        </header>
        <ul className="space-y-3 px-5 py-4">
          {data.insights.map((item) => (
            <Insight key={item.text} tag={item.tag} text={item.text} />
          ))}
        </ul>
      </section>

      {/* ================================================================
          业务建议
          ================================================================ */}
      <section className="rounded-xl border border-hairline bg-card">
        <header className="border-b border-hairline px-5 py-3.5">
          <h3 className="text-[13px] font-semibold text-ink">业务建议</h3>
          <p className="mt-0.5 text-[11.5px] text-ink-2">
            每条建议都挂在前面实际算出来的组合和象限上，不写"加强运营""提升质量"这类空话
          </p>
        </header>
        <ol className="space-y-3 px-5 py-4">
          {data.actions.map((item, i) => (
            <li key={item.text} className="flex gap-3">
              <span className="mt-px flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-plane text-[11px] font-semibold text-ink-2">
                {i + 1}
              </span>
              <p className="text-[12.5px] leading-relaxed text-ink-2">
                <span className="mr-1.5 shrink-0 rounded bg-brand-soft px-2 py-0.5 text-[11px] font-semibold text-ink">
                  {item.tag}
                </span>
                {item.text}
              </p>
            </li>
          ))}
        </ol>
      </section>

      {/* ================================================================
          底部：口径说明（每个指标的分母）
          ================================================================ */}
      <section className="rounded-xl border border-hairline bg-card px-5 py-4">
        <h3 className="text-[13px] font-semibold text-ink">这一页的数字是怎么算出来的</h3>
        <p className="mt-1 text-[11.5px] leading-relaxed text-ink-2">
          这一页最容易出错的地方就是分母。下面把每个指标的分母都写清楚，一个一个对。
        </p>
        <dl className="mt-2.5 grid grid-cols-1 gap-x-8 gap-y-2 text-[11.5px] leading-relaxed text-ink-2 sm:grid-cols-2">
          <div>
            <dt className="font-medium text-ink">数据链路</dt>
            <dd>
              用户表（取年龄段）→ 观看记录表（按 user_id 关联）→ 视频表（按 video_id 关联）→
              取内容分区。切成 4 个年龄段 × 8 个分区 = 32 个格子，每个格子独立汇总。
            </dd>
          </div>
          <div>
            <dt className="font-medium text-ink">年龄段怎么来的</dt>
            <dd>
              用户表里带年龄字段，按固定的四档分组：{AGE_GROUPS.map((g) => g.label).join(' / ')}。
              分组规则全站统一，用户分析页用的是同一套。
            </dd>
          </div>
          <div>
            <dt className="font-medium text-ink">独立观看用户数</dt>
            <dd>
              该格子里去重后的观看人数（COUNT(DISTINCT user_id)）。同一个人看了 10 次也只算 1 人，
              跨天也只算 1 人——这是"覆盖面"。
            </dd>
          </div>
          <div>
            <dt className="font-medium text-ink">播放量</dt>
            <dd>该格子里的观看记录条数。同一人重复观看会重复计数，这是"消费量"，不是人数。</dd>
          </div>
          <div>
            <dt className="font-medium text-ink">用户覆盖率</dt>
            <dd>
              该格子独立观看用户数 ÷ <span className="font-medium text-ink">该年龄段窗口内的观看用户数</span>。
              分母是"人"，不是"播放次数"，也不是全站人数。
              含义：这个年龄段里，有百分之多少的人看过这个分区。
            </dd>
          </div>
          <div>
            <dt className="font-medium text-ink">偏好占比</dt>
            <dd>
              该格子播放次数 ÷ <span className="font-medium text-ink">该年龄段 8 个分区的播放次数之和</span>。
              按行归一化，所以每个年龄段的 8 个格子加起来正好 100%，
              可以横向比"更爱看哪个"，不受各年龄段人数多少的影响。
            </dd>
          </div>
          <div>
            <dt className="font-medium text-ink">人均观看次数</dt>
            <dd>播放次数 ÷ 独立观看用户数。看过这个组合的人，平均一共点开了几条。</dd>
          </div>
          <div>
            <dt className="font-medium text-ink">人均观看时长</dt>
            <dd>该格子总观看秒数 ÷ 独立观看用户数。即"看过的人平均一共看了多久"，会随窗口拉长而变大。</dd>
          </div>
          <div>
            <dt className="font-medium text-ink">单次观看时长</dt>
            <dd>该格子总观看秒数 ÷ 播放次数。即"平均点开一次看多久"。分母和上面那个"人均"不一样。</dd>
          </div>
          <div>
            <dt className="font-medium text-ink">完播率</dt>
            <dd>
              实际观看秒数 ÷ 该视频总时长 ≥ {COMPLETION_THRESHOLD * 100}% 记为一次高完成度观看，
              再除以播放次数。门槛按每条视频自己的时长算。
            </dd>
          </div>
          <div>
            <dt className="font-medium text-ink">综合互动率</dt>
            <dd>
              （点赞 + 收藏 + 评论 + 分享）的次数 ÷ 播放次数。分子是行为次数不是人数，
              所以一个人又赞又藏会贡献 2 次；也和播放次数的口径一致，不会超过 100%。
            </dd>
          </div>
          <div>
            <dt className="font-medium text-ink">用户偏好集中度（KPI）</dt>
            <dd>
              对每个年龄段，把 8 个分区的偏好占比各自平方后加总（赫芬达尔指数），再对 4 个年龄段取平均。
              8 个分区完全平均时是 12.5%，全挤在一个分区时是 100%。越大说明口味越集中。
            </dd>
          </div>
          <div>
            <dt className="font-medium text-ink">TOP内容用户覆盖率（KPI）</dt>
            <dd>
              覆盖用户最多的那个分区的独立观看用户数 ÷ 全部观看用户数。
              旁边那行小字给出了八个分区的覆盖人数范围，差距越小说明用户越"什么都看"。
            </dd>
          </div>
          <div>
            <dt className="font-medium text-ink">机会矩阵的分界线</dt>
            <dd>
              横轴和纵轴的中位数都在<span className="font-medium text-ink">全部 32 个组合</span>上算，
              不是每张小图各算各的——否则四张图的分区含义就不一样了，没法横着比。
            </dd>
          </div>
          <div>
            <dt className="font-medium text-ink">本页样本量</dt>
            <dd>
              {data.sample.days} 天 · {formatCount(data.sample.views)} 条观看记录 ·{' '}
              {formatCount(data.sample.viewers)} 名独立观看用户 ·{' '}
              {data.sample.combosWithData}/{data.sample.combos} 个「年龄段 × 分区」组合有观看记录。
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

/** 模块标题：编号 + 标题 + 这个模块回答什么问题 */
function ModuleHeading({
  index,
  title,
  purpose,
}: {
  index: number
  title: string
  purpose: string
}) {
  return (
    <div className="mt-2 flex items-baseline gap-2.5 border-b border-hairline pb-2">
      <span className="flex h-5 w-5 shrink-0 translate-y-0.5 items-center justify-center rounded-md bg-ink text-[11px] font-semibold text-white">
        {index}
      </span>
      <h2 className="text-[14px] font-semibold text-ink">{title}</h2>
      <span className="text-[11.5px] text-ink-3">{purpose}</span>
    </div>
  )
}

function Insight({ tag, text }: { tag: string; text: ReactNode }) {
  return (
    <li className="flex gap-3">
      <span className="mt-px h-fit shrink-0 rounded bg-brand-soft px-2 py-0.5 text-[11px] font-semibold text-ink">
        {tag}
      </span>
      <p className="text-[12.5px] leading-relaxed text-ink-2">{text}</p>
    </li>
  )
}
