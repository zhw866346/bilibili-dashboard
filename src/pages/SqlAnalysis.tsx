/* ==========================================================================
   SQL 分析
   --------------------------------------------------------------------------
   前四页回答的是「平台发生了什么」。
   这一页回答的是**「这些问题是怎么用 SQL 问出来的」**。

   页面上的每一条 SQL 都真的在跑：
   项目里那四张模拟表（users / creators / videos / video_views，共 56 万行
   观看明细）会被装进一个跑在浏览器里的 SQLite 数据库（sql.js），
   然后每张卡片上的 SQL 都是在这个库上真实执行的——
   结果表格里的数字、右上角"查询耗时 xx ms"，都是当场算出来的。

   ★ 两件必须说清楚的事，免得误会：
     1. 数据库里的数据是本项目的【模拟业务数据】，不是 B 站的真实数据。
        这件事页面顶部本来就有提示条，这里再强调一次。
     2. 数据库跑在【浏览器本地】，不是在读什么线上的生产库。
        所以"真的执行了"这句话是成立的，但它执行的是一份本地数据集。

   ★ 为什么建库要花几秒，页面却不卡？
     建库和查询都放在 Web Worker（后台线程）里，主线程只管画界面。
     万一浏览器不允许开 Worker（比如把 dist/index.html 直接双击打开），
     会自动退回主线程执行——慢一点，但功能完整、结果一样。
   ========================================================================== */

import { useCallback, useEffect, useMemo, useState } from 'react'

import KpiCard from '../components/KpiCard'
import ModuleHeading from '../components/ModuleHeading'
import DataProvenance from '../components/DataProvenance'
import SqlCaseCard, { type CaseStatus } from '../components/sql/SqlCaseCard'
import SqlFlow from '../components/sql/SqlFlow'
import { startSqlEngine, type SqlEngineClient } from '../data/sql/client'
import type { BuildProgress, QueryResult } from '../data/sql/engine'
import {
  ALL_SCENES,
  QUESTION_BANK,
  SCENE_FILTERS,
  SQL_ABILITIES,
  buildSqlCases,
  computeSqlStats,
  type SceneKey,
} from '../data/sql/cases'
import { SCHEMA_SQL, TABLE_NOTES } from '../data/sql/schema'
import { getWindowPair, getUserContentAnalytics } from '../data/selectors'
import { formatCount } from '../utils/format'
import type { Kpi } from '../types'

const RANGES = [
  { days: 7, label: '近 7 天' },
  { days: 14, label: '近 14 天' },
  { days: 30, label: '近 30 天' },
] as const

interface CaseResult {
  status: CaseStatus
  result?: QueryResult
  error?: string
}

export default function SqlAnalysis() {
  const [days, setDays] = useState<number>(30)
  const [scene, setScene] = useState<SceneKey | typeof ALL_SCENES>(ALL_SCENES)

  /* ---------- 一、当前时间窗口 ---------- */
  /*
    窗口的起止日期直接取自前四阶段用的同一套计算（getWindowPair）。
    所以 SQL 里 WHERE 的日期，和首页、用户分析页上的"近 N 天"是同一个区间，
    不是另外算的。
  */
  const windowPair = useMemo(() => getWindowPair(days), [days])
  const { startDate, endDate } = windowPair.current

  /*
    案例 08 的门槛：全部 32 个「年龄段 × 分区」组合人均观看时长的中位数。
    刻意从用户 × 内容分析页的同一个函数里取，而不是在 SQL 里写一个固定数字——
    这样门槛和数据永远是一致的，也不会出现"SQL 卡片的门槛和用户×内容页
    的分界线对不上"这种事。
  */
  const depthThresholdMinutes = useMemo(
    () => getUserContentAnalytics(days).opportunity.xMedian,
    [days],
  )

  /* ---------- 二、九条案例的定义 ---------- */
  /* 窗口或门槛一变，SQL 文本就跟着变——这就是"筛选真的在驱动查询"。 */
  const sqlCases = useMemo(
    () => buildSqlCases({ startDate, endDate, days, depthThresholdMinutes }),
    [startDate, endDate, days, depthThresholdMinutes],
  )

  const stats = useMemo(() => computeSqlStats(sqlCases, SCHEMA_SQL.length), [sqlCases])

  /* ---------- 三、启动数据库引擎 ---------- */
  const [client, setClient] = useState<SqlEngineClient | null>(null)
  const [progress, setProgress] = useState<BuildProgress | null>(null)
  const [engineError, setEngineError] = useState<string | null>(null)

  useEffect(() => {
    let alive = true
    startSqlEngine({
      onProgress: (p) => {
        if (alive) setProgress(p)
      },
    })
      .then((c) => {
        if (alive) setClient(c)
      })
      .catch((e) => {
        if (alive) setEngineError(e instanceof Error ? e.message : String(e))
      })
    return () => {
      alive = false
    }
  }, [])

  /* ---------- 四、逐条执行查询 ---------- */
  const [results, setResults] = useState<Record<string, CaseResult>>({})

  useEffect(() => {
    if (!client) return
    let alive = true

    // 换时间范围时先把所有卡片置为"查询中"，让读者看得见"它真的在重跑"
    setResults(
      Object.fromEntries(sqlCases.map((c) => [c.id, { status: 'running' as CaseStatus }])),
    )

    ;(async () => {
      // 一条一条顺序跑，不并发：数据库只有一个，并发没有意义，
      // 顺序执行还能让结果从第一张卡开始依次出现，而不是最后一起蹦出来。
      for (const c of sqlCases) {
        if (!alive) return
        try {
          const result = await client.exec(c.sql)
          if (!alive) return
          setResults((prev) => ({ ...prev, [c.id]: { status: 'done', result } }))
        } catch (e) {
          if (!alive) return
          const message = e instanceof Error ? e.message : String(e)
          setResults((prev) => ({ ...prev, [c.id]: { status: 'error', error: message } }))
        }
      }
    })()

    return () => {
      alive = false
    }
  }, [client, sqlCases])

  /* ---------- 五、跳转到某个案例 ---------- */
  const jumpTo = useCallback(
    (caseId: string) => {
      // 目标卡片可能被场景筛选挡住了，先把筛选复位再滚过去
      setScene(ALL_SCENES)
      window.setTimeout(() => {
        document
          .getElementById(`sql-case-${caseId}`)
          ?.scrollIntoView({ behavior: 'smooth', block: 'start' })
      }, 60)
    },
    [],
  )

  /* ---------- 六、能力概览卡片（数字全部由上面的内容算出来） ---------- */
  const sceneCount = useMemo(
    () => new Set(sqlCases.map((c) => c.scene)).size,
    [sqlCases],
  )

  const kpis: Kpi[] = useMemo(
    () => [
      {
        id: 'cases',
        name: 'SQL 查询案例',
        value: stats.caseCount,
        unit: 'count',
        deltaLabel: `覆盖 ${sceneCount} 类分析场景`,
        desc:
          '页面里完整给出 SQL、并能真实执行的案例数量。' +
          '每个案例都按「业务问题 → 使用字段 → SQL → 查询结果 → 分析解释 → 业务意义」组织，不是孤立的代码片段。',
      },
      {
        id: 'tables',
        name: '核心数据表',
        value: stats.tableCount,
        unit: 'count',
        deltaLabel: 'users / creators / videos / video_views',
        desc:
          '这些查询一共动用的数据表。四张表都在浏览器里建成了真的表，' +
          '可以点开下面的「数据表结构」看建表语句。',
      },
      {
        id: 'metrics',
        name: '分析指标',
        value: stats.metricCount,
        unit: 'count',
        deltaLabel: `按 ${stats.caseCount} 条 SQL 的结果列去重后统计`,
        desc:
          `${stats.caseCount} 条 SQL 一共算出了多少个不同的数值指标（DAU、活跃率、人均观看时长、` +
          '综合互动率……）。这个数字是从结果表的列定义里数出来的，不是估的。',
      },
      {
        id: 'abilities',
        name: 'SQL 能力',
        value: stats.abilityCount,
        unit: 'count',
        deltaLabel: 'SELECT / JOIN / GROUP BY / CTE / WINDOW FUNCTION …',
        desc:
          '实际用到的 SQL 语法能力项数。下面「SQL 能力覆盖」那张矩阵会逐项列出' +
          '每项能力用在哪、被哪几个案例用到。',
      },
      {
        id: 'questions',
        name: '业务问题',
        value: stats.questionCount,
        unit: 'count',
        deltaLabel: '分「用户 / 内容 / 用户 × 内容」三组',
        desc:
          '问题库里能被这些 SQL 直接回答的业务问题数量。' +
          '点任意一个问题，页面会跳到对应的 SQL 卡片。',
      },
    ],
    [stats, sceneCount],
  )

  /* ---------- 七、各种计数 ---------- */
  const sceneCounts = useMemo(() => {
    const map = new Map<string, number>()
    for (const c of sqlCases) map.set(c.scene, (map.get(c.scene) ?? 0) + 1)
    return map
  }, [sqlCases])

  const visibleCases = useMemo(
    () => (scene === ALL_SCENES ? sqlCases : sqlCases.filter((c) => c.scene === scene)),
    [sqlCases, scene],
  )

  const doneCount = useMemo(
    () => Object.values(results).filter((r) => r.status === 'done' || r.status === 'error').length,
    [results],
  )

  const totalMs = useMemo(
    () =>
      Object.values(results).reduce((n, r) => n + (r.result?.ms ?? 0), 0),
    [results],
  )

  const building = !client && !engineError

  return (
    <div className="flex flex-col gap-4">
      {/* ---------- 页面说明 ---------- */}
      <p className="text-[13px] leading-relaxed text-ink-2">
        这一页把前面的分析倒过来讲一遍：
        <span className="font-medium text-ink">先给业务问题，再给 SQL，最后给结果</span>。
        页面上每一段 SQL 都<span className="font-medium text-ink">真的在跑</span>——
        项目里的四张模拟表被装进一个跑在浏览器本地的 SQLite 数据库
        {client &&
          `（库里一共 ${formatCount(client.stats.videoViews)} 条观看记录，覆盖 ${client.stats.days} 天）`}
        ，查询时只取当前这个 {windowPair.current.days} 天窗口里的{' '}
        {formatCount(windowPair.current.totalViews)} 条来算，结果和耗时都是实时算出来的。
        <span className="text-ink-3">
          　数据库里的数据是本项目的模拟业务数据，不是 B 站的真实数据；数据库也跑在浏览器本地。
        </span>
      </p>

      {/* ---------- 引擎状态条：证明"真的跑了" ---------- */}
      <section className="rounded-xl border border-hairline bg-card px-5 py-3.5">
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5">
          <span className="text-[12px] font-semibold text-ink">SQL 引擎</span>

          {building && (
            <>
              <span className="text-[11.5px] text-ink-2">
                {progress?.label ?? '正在启动'}…
              </span>
              <span className="text-[11px] tabular-nums text-ink-3">
                {progress && progress.total > 0
                  ? `${formatCount(progress.done)} / ${formatCount(progress.total)} 行`
                  : ''}
              </span>
            </>
          )}

          {client && (
            <>
              <span className="rounded bg-[rgba(12,163,12,0.08)] px-2 py-0.5 text-[11.5px] font-semibold text-[#0ca30c]">
                已就绪
              </span>
              <span className="text-[11.5px] text-ink-2">
                引擎运行在
                <span className="font-medium text-ink">
                  {client.mode === 'worker' ? '后台线程（Web Worker）' : '主线程（兜底模式）'}
                </span>
                ，建库耗时 {Math.round(client.stats.buildMs)} ms
              </span>
              <span className="text-[11.5px] text-ink-3">
                {client.stats.days} 天 · {formatCount(client.stats.videoViews)} 条观看记录 ·{' '}
                {client.stats.users.toLocaleString('zh-CN')} 名用户 · {client.stats.videos} 个视频 ·{' '}
                {client.stats.schema.length} 张表
              </span>
              <span className="ml-auto text-[11.5px] text-ink-3">
                本次已执行 {doneCount} / {sqlCases.length} 条
                {doneCount > 0 && ` · 合计 ${Math.round(totalMs)} ms`}
              </span>
            </>
          )}

          {engineError && (
            <span className="text-[11.5px] text-[#d03b3b]">引擎启动失败：{engineError}</span>
          )}
        </div>

        {/* 建库进度条 */}
        {building && progress && progress.total > 0 && (
          <div className="mt-2.5 h-1 overflow-hidden rounded-full bg-plane">
            <div
              className="h-full rounded-full bg-brand transition-[width] duration-200"
              style={{ width: `${Math.min(100, (progress.done / progress.total) * 100)}%` }}
            />
          </div>
        )}

        <p className="mt-2 text-[11px] leading-relaxed text-ink-3">
          建库（把 56 万行明细写进 SQLite）大约要 3~4 秒，全部发生在后台线程里，
          所以这几秒页面照样能滚动、能点筛选。切换时间范围时只重跑查询，不重建库。
        </p>
      </section>

      {/* ================================================================
          ① SQL 能力概览
          ================================================================ */}
      <ModuleHeading index={1} title="SQL 能力概览" purpose="这一页一共做了什么，数字都是数出来的" />

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-5">
        {kpis.map((kpi) => (
          <KpiCard key={kpi.id} kpi={kpi} />
        ))}
      </div>

      {/* ---------- 数据表结构（可折叠） ---------- */}
      <section className="rounded-xl border border-hairline bg-card">
        <details>
          <summary className="flex cursor-pointer list-none items-center gap-2.5 px-5 py-3.5">
            <span className="text-[13px] font-semibold text-ink">数据表结构</span>
            <span className="text-[11.5px] text-ink-3">
              {stats.tableCount} 张表 · 点开看建表语句（这些表真的建在了浏览器里的 SQLite 中）
            </span>
            <span className="ml-auto text-[11.5px] text-ink-3">展开 / 收起</span>
          </summary>

          <div className="border-t border-hairline px-5 py-4">
            <ul className="mb-3 grid grid-cols-1 gap-x-8 gap-y-1 text-[11.5px] leading-relaxed text-ink-2 sm:grid-cols-2">
              {TABLE_NOTES.map((t) => (
                <li key={t.name}>
                  <code className="font-mono text-[11px] font-semibold text-ink">{t.name}</code>
                  <span className="ml-2">{t.note}</span>
                </li>
              ))}
            </ul>

            <div className="flex flex-col gap-2">
              {SCHEMA_SQL.map((sql) => (
                <pre
                  key={sql}
                  className="overflow-x-auto rounded-lg border border-hairline bg-plane/60 px-3 py-2.5 font-mono text-[11.5px] leading-[1.7] text-ink-2"
                >
                  <code>{sql}</code>
                </pre>
              ))}
            </div>

            <p className="mt-3 text-[11px] leading-relaxed text-ink-3">
              这几条建表语句和 <code className="font-mono">src/types/index.ts</code> 里的四个
              TypeScript 接口是一一对应的——同一份结构，两种写法。
              布尔型的点赞 / 收藏 / 评论 / 分享在数据库里存成 0 和 1，所以可以用 SUM() 直接求和。
            </p>
          </div>
        </details>
      </section>

      {/* ================================================================
          ② 场景筛选
          ================================================================ */}
      <ModuleHeading index={2} title="SQL 场景筛选" purpose="按分析场景筛选下面的案例" />

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

        <span className="ml-2 text-[12px] font-medium text-ink-2">分析场景</span>
        <div className="flex flex-wrap gap-0.5 rounded-lg border border-hairline bg-card p-0.5">
          {SCENE_FILTERS.map((s) => {
            const count = s === ALL_SCENES ? sqlCases.length : (sceneCounts.get(s) ?? 0)
            if (count === 0) return null
            return (
              <button
                key={s}
                type="button"
                onClick={() => setScene(s)}
                aria-pressed={scene === s}
                className={`rounded-md px-2.5 py-1 text-[12px] font-medium transition-colors ${
                  scene === s ? 'bg-ink text-white' : 'text-ink-2 hover:bg-plane hover:text-ink'
                }`}
              >
                {s}
                <span className="ml-1 tabular-nums opacity-70">{count}</span>
              </button>
            )
          })}
        </div>

        <span className="text-[11.5px] text-ink-3">
          当前窗口 {startDate} ~ {endDate}。
          换时间范围，下面每一条 SQL 的 WHERE 日期和查询结果都会跟着变。
        </span>
      </div>

      {/* ---------- 问题库 ---------- */}
      <section className="rounded-xl border border-hairline bg-card">
        <header className="border-b border-hairline px-5 py-3.5">
          <h3 className="text-[13px] font-semibold text-ink">我用 SQL 解决过的问题</h3>
          <p className="mt-0.5 text-[11.5px] text-ink-2">
            按分析对象分成三组。点任意一个问题，页面会跳到回答它的那张 SQL 卡片。
          </p>
        </header>

        <div className="grid grid-cols-1 gap-x-6 gap-y-4 px-5 py-4 lg:grid-cols-3">
          {QUESTION_BANK.map((group) => (
            <div key={group.group}>
              <p className="mb-1.5 text-[11.5px] font-semibold text-ink-3">{group.group}</p>
              <ul className="space-y-1">
                {group.items.map((item) => {
                  const target = sqlCases.find((c) => c.id === item.caseId)
                  return (
                    <li key={item.q}>
                      <button
                        type="button"
                        onClick={() => jumpTo(item.caseId)}
                        className="group flex w-full items-start gap-2 rounded-md px-2 py-1.5 text-left transition-colors hover:bg-brand-soft/60"
                      >
                        <span className="mt-[3px] shrink-0 text-[11px] tabular-nums text-ink-3">
                          {target ? `#${String(target.no).padStart(2, '0')}` : '—'}
                        </span>
                        <span className="text-[12px] leading-relaxed text-ink-2 group-hover:text-ink">
                          {item.q}
                        </span>
                      </button>
                    </li>
                  )
                })}
              </ul>
            </div>
          ))}
        </div>
      </section>

      {/* ================================================================
          ③ SQL 案例
          ================================================================ */}
      <ModuleHeading
        index={3}
        title="SQL 分析案例"
        purpose="每条案例：业务问题 → 字段与能力 → SQL → 结果 → 解释 → 业务意义"
      />

      <div className="flex flex-col gap-4">
        {visibleCases.map((c) => {
          const r = results[c.id]
          return (
            <SqlCaseCard
              key={c.id}
              sqlCase={c}
              status={r?.status ?? 'pending'}
              result={r?.result}
              error={r?.error}
            />
          )
        })}
      </div>

      {/* ================================================================
          ④ SQL 能力覆盖
          ================================================================ */}
      <ModuleHeading index={4} title="SQL 能力覆盖" purpose="用到的每一项语法，用在了哪、被哪几个案例用到" />

      <section className="rounded-xl border border-hairline bg-card">
        <div className="overflow-x-auto px-5 py-4">
          <table className="w-full border-collapse text-[12px]">
            <thead>
              <tr>
                {['SQL 能力', '使用场景', '用到的案例'].map((h) => (
                  <th
                    key={h}
                    scope="col"
                    className="border-b border-hairline px-3 py-2 text-left text-[11.5px] font-semibold text-ink-2"
                  >
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {SQL_ABILITIES.map((def) => {
                const users = stats.abilityUsage.get(def.ability) ?? []
                return (
                  <tr key={def.ability} className="odd:bg-card even:bg-plane/50">
                    <td className="w-[140px] whitespace-nowrap border-b border-hairline/70 px-3 py-1.5">
                      <code className="font-mono text-[11.5px] font-semibold text-ink">
                        {def.ability}
                      </code>
                    </td>
                    <td className="border-b border-hairline/70 px-3 py-1.5 text-ink-2">
                      {def.usage}
                    </td>
                    <td className="border-b border-hairline/70 px-3 py-1.5">
                      {users.length === 0 ? (
                        <span className="text-[11px] text-ink-3">这一页暂未用到</span>
                      ) : (
                        <span className="flex flex-wrap gap-1">
                          {users.map((c) => (
                            <button
                              key={c.id}
                              type="button"
                              onClick={() => jumpTo(c.id)}
                              title={c.title}
                              className="rounded bg-plane px-1.5 py-0.5 text-[10.5px] font-medium tabular-nums text-ink-2 transition-colors hover:bg-brand-soft hover:text-ink"
                            >
                              {String(c.no).padStart(2, '0')}
                            </button>
                          ))}
                        </span>
                      )}
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>

          <p className="mt-3 text-[11px] leading-relaxed text-ink-3">
            上表分两层：前 12 项是基础语法，最后两项（
            <code className="font-mono">CTE</code>、
            <code className="font-mono">WINDOW FUNCTION</code>）是进阶能力。
            窗口函数只出现在它确实更合适的三条查询里——组内 Top N（案例 09）、
            日环比（案例 01）、组内占比（案例 06）。
            <span className="text-ink-2">
              「每个年龄段内部排前 3」这种问题，用 GROUP BY 表达不出来
            </span>
            ，这时候用窗口函数是必要的，不是为了把语法列表凑长。
            反过来，能用 GROUP BY 讲清楚的地方，这一页一律还是用 GROUP BY；
            也没有硬塞存储过程这类在这个场景里用不上的东西。
          </p>
        </div>
      </section>

      {/* ================================================================
          ⑤ 从业务问题到 SQL
          ================================================================ */}
      <ModuleHeading
        index={5}
        title="从业务问题到 SQL"
        purpose="一个业务问题是怎么一步步变成一条查询的"
      />

      <section className="rounded-xl border border-hairline bg-card">
        <SqlFlow />
      </section>

      {/* ================================================================
          ⑥ SQL 分析思路（踩过的坑）
          ================================================================ */}
      <ModuleHeading index={6} title="SQL 分析思路" purpose="写这些查询时真正踩过的坑" />

      <section className="rounded-xl border border-hairline bg-card">
        <ol className="space-y-3.5 px-5 py-4">
          {PITFALLS.map((p, i) => (
            <li key={p.title} className="flex gap-3">
              <span className="mt-px flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-plane text-[11px] font-semibold tabular-nums text-ink-2">
                {i + 1}
              </span>
              <div className="min-w-0">
                <p className="text-[12.5px] font-semibold text-ink">{p.title}</p>
                <p className="mt-1 text-[12.5px] leading-relaxed text-ink-2">{p.body}</p>
                {p.code && (
                  <pre className="mt-1.5 overflow-x-auto rounded-lg border border-hairline bg-plane/60 px-3 py-2 font-mono text-[11px] leading-[1.7] text-ink-2">
                    <code>{p.code}</code>
                  </pre>
                )}
              </div>
            </li>
          ))}
        </ol>
      </section>

      {/* ================================================================
          ⑦ SQL 能力总结
          ================================================================ */}
      <ModuleHeading index={7} title="SQL 能力总结" purpose="如实描述，不吹" />

      <section className="rounded-xl border border-hairline bg-card px-5 py-4">
        <p className="text-[12.5px] leading-relaxed text-ink-2">
          当前能够使用 SQL 独立完成用户、内容及用户 × 内容维度的数据提取与聚合分析，
          掌握 CASE WHEN、COUNT DISTINCT、GROUP BY、HAVING、JOIN、ORDER BY
          等常用分析方法，并能够将业务问题拆解为可执行的数据查询。
        </p>
        <p className="mt-2.5 text-[11.5px] leading-relaxed text-ink-3">
          以上每一句都能在页面上找到对应的案例：
          CASE WHEN 见案例 02 / 03 / 06 / 08，COUNT DISTINCT 见 01 / 02 / 03 / 05 / 08，
          JOIN 见 03 / 04 / 05 / 06 / 07 / 08，HAVING 见 08。
          CTE 见 01 / 06 / 09；窗口函数见 01（LAG 算日环比）、
          06（SUM() OVER 算组内占比）、09（ROW_NUMBER 取组内前几名）。
          <span className="mt-1.5 block">
            窗口函数只用在这三处它确实比 GROUP BY 更合适的地方——
            需要「在保留明细行的同时，拿到同行之间的比较值」时才用它。
            能用 GROUP BY 讲清楚的地方，一律还是用 GROUP BY。
          </span>
        </p>
      </section>

      <DataProvenance />
    </div>
  )
}

/* --------------------------------------------------------------------------
   分析思路：五个真实的坑
   -------------------------------------------------------------------------- */

const PITFALLS: { title: string; body: string; code?: string }[] = [
  {
    title: '想把「9 月 1 日到 9 月 30 日」写成两个等于号，会查出 0 行',
    body:
      '第一版我是这么写的：WHERE date = \'2026-09-01\' AND date = \'2026-09-30\'。' +
      '结果一条都查不出来。原因很朴素：一条观看记录只有一个日期，' +
      '它不可能既等于 1 号又等于 30 号，这个条件永远不成立。' +
      '要表达「在这段时间之内」应该用 BETWEEN 或 >= … AND <=；' +
      '要表达「这两天中的任意一天」才用 IN。三个写法解决三个不同的问题，混用就会得到空结果。',
    code: `-- ✗ 永远查不出东西：一条记录的日期不可能同时等于两天
WHERE date = '2026-09-01' AND date = '2026-09-30'

-- ✓ 想要「这段时间之内」
WHERE date >= '2026-09-01' AND date <= '2026-09-30'

-- ✓ 想要「这两天里的任意一天」
WHERE date IN ('2026-09-01', '2026-09-30')`,
  },
  {
    title: 'GROUP BY 不是必须凑上去的语法，它决定的是「一行代表哪一组」',
    body:
      '一开始我以为只要查询里出现 COUNT 就得跟着写 GROUP BY，是种固定搭配。' +
      '后来才想明白：GROUP BY 的意思是「把数据按要求分成一堆一堆，然后每一堆单独算一个结果」。' +
      '所以写之前要先问自己一句：我要的这一行结果，代表的到底是哪一堆数据？' +
      '按年龄段分组，一行就是一个年龄段；按年龄段和分区一起分组，一行就是一个组合。' +
      '想清楚这一句，SELECT 里能放什么、不能放什么也就自然清楚了。',
  },
  {
    title: 'DAU 不能用 COUNT(user_id)，会数出好几倍的人',
    body:
      '一个人一天看了 10 个视频，在观看记录表里就有 10 行。' +
      'COUNT(user_id) 数的是「行数」，会把他算成 10 个人。' +
      '要数「有多少人」必须用 COUNT(DISTINCT user_id)，也就是先去掉重复的人再数。' +
      '这条规则在这一页反复出现：DAU（案例 01）、独立观看用户（案例 05）、' +
      '活跃率的分母（案例 03）用的都是它。' +
      '判断该用哪个的办法很简单——把这个指标的名字念一遍，' +
      '说的是「次数」就用 COUNT，说的是「人数」就用 COUNT(DISTINCT)。',
  },
  {
    title: '聚合出来的结果不能用 WHERE 筛，得用 HAVING',
    body:
      '我想筛出「人均观看时长超过门槛的组合」，第一反应是写在 WHERE 里，结果报错。' +
      '原因是执行顺序：WHERE 在分组之前就已经跑完了，那时候 SUM()、COUNT() 根本还没算出来，' +
      '自然筛不了。HAVING 是专门在分组之后执行的条件，聚合结果只能用它筛。' +
      '一句话记住：WHERE 筛的是「一行一行的原始记录」，HAVING 筛的是「一组一组的统计结果」。' +
      '案例 08 用的就是 HAVING。',
  },
  {
    title: '窗口函数算出来的列，不能在同一层里用 WHERE 筛',
    body:
      '想做「每个年龄段的前三名」，最顺手的写法是算完名次紧接着筛掉：' +
      'WHERE rn <= 3。这样写 SQLite 会直接报错，' +
      '错误信息是 misuse of aliased window function rn。' +
      '原因和上一条一模一样，还是执行顺序：WHERE 在分组和开窗之前就执行完了，' +
      '轮到它的时候，名次这一列根本还不存在。' +
      '解法是把「算名次」和「筛名次」拆成两层——先算出名次放进一个 CTE，' +
      '再在外层用 WHERE 筛它。' +
      '这两条坑其实是同一句话：凡是这一步才算出来的东西，都没法在同一步里被筛。' +
      '聚合结果要留给 HAVING，窗口函数的结果要留给外层查询。',
    code: `-- ✗ 报错：misuse of aliased window function rn
SELECT g, v,
       ROW_NUMBER() OVER (PARTITION BY g ORDER BY v DESC) AS rn
FROM t
WHERE rn <= 3        -- 执行到 WHERE 时，rn 还没算出来

-- ✓ 先算名次，再在外层筛
WITH ranked AS (
    SELECT g, v,
           ROW_NUMBER() OVER (PARTITION BY g ORDER BY v DESC) AS rn
    FROM t
)
SELECT * FROM ranked WHERE rn <= 3`,
  },
]

/* --------------------------------------------------------------------------
   小零件
   -------------------------------------------------------------------------- */

/** 模块标题：编号 + 标题 + 这个模块回答什么问题（全站保持同一套样式） */
/* ModuleHeading 已搬到 src/components/ModuleHeading.tsx，
   Python 分析页要用同一套样式。渲染结果一个像素都没变。 */
