/* ==========================================================================
   Python 分析
   --------------------------------------------------------------------------
   前五个页面回答的是「平台发生了什么」，以及「用 SQL 怎么问出来」。
   这一页回答第三个问题：**用 Python + Pandas 能问出哪些 SQL 问不出来的东西**。

   ★ 这一页的 Python 是怎么跑的（这句话必须说准，不能含糊）
     这些代码**不是在浏览器里执行的**。它是在我本机离线真跑了一遍：

       dataset.ts  →  npm run data:export  →  data/csv/*.csv
                   →  npm run data:analyze →  src/data/python/results.generated.ts
                   →  这一页直接 import 这个结果文件

     页面上的每一个数字，都来自那次真实运行的输出，不是前端重算的、
     更不是编造的。analyze.py 和四个 CSV 的生成脚本都在仓库里，可以自己复现。
     **不假装是浏览器里实时执行** —— 那样说会显得更厉害，但它是假的。

   ★ 这一页相对 SQL 分析页的一个真实优势
     SQL 页在 file:// 下（双击 dist/index.html）会退回主线程执行，因为浏览器
     会拦掉 Web Worker。这一页没有这个问题：结果是提前算好、直接 import 的，
     打开就能看，零等待、零降级。

   ★ 这一页每个数字都和前面五个页面对得上账
     同一批口径被实现了两遍（一遍 TypeScript、一遍 Python），没有任何机制
     保证它们一致 —— 靠的是一遍遍地对。第 09 个模块就是当场把这件事验一遍。
     第一次跑对账时它真抓出了一个 bug：分年龄段的日均 DAU 忘了除天数，
     整整大了 7 倍。所以那一块不是装饰，是这一页的核心论据。
   ========================================================================== */

import { useEffect, useMemo, useState, type ReactNode } from 'react'
import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  Line,
  LineChart,
  ResponsiveContainer,
  Scatter,
  ScatterChart,
  Tooltip,
  XAxis,
  YAxis,
  ZAxis,
} from 'recharts'

import ChartCard from '../components/ChartCard'
import ChartTooltip from '../components/ChartTooltip'
import CodeBlock from '../components/CodeBlock'
import DataProvenance from '../components/DataProvenance'
import DataTable, { type Column } from '../components/DataTable'
import Heatmap from '../components/Heatmap'
import KpiCard from '../components/KpiCard'
import ModuleHeading from '../components/ModuleHeading'
import PythonCaseCard from '../components/python/PythonCaseCard'
import { ANALYZE_SOURCE, checkFreshness } from '../data/python/manifest'
import { getReconcileReport, itemOk } from '../data/python/reconcile'
import { PY_RESULTS } from '../data/python/results.generated'
import {
  ALL_SCENES,
  PYTHON_CASES,
  PYTHON_CASE_BY_ID,
  PYTHON_SCENES,
  computePythonAbilities,
} from '../data/python/cases'
import type { PyCaseId, PyResults } from '../data/python/types'
import { getWindowPair, type HeatmapData } from '../data/selectors'
import { CATEGORIES } from '../utils/categories'
import { formatCount, formatPercent, withThousands } from '../utils/format'
import { AGE_RAMP, CHART_INK, ORDINAL_RAMP, SERIES_PRIMARY, STATUS_COLOR } from '../theme'
import type { Kpi } from '../types'

/** 页面顶部的说明条要展示的管道环节。写死是因为它描述的是构建流程，不是数据 */
const PIPELINE = [
  { label: 'dataset.ts', note: '唯一数据源（固定种子）' },
  { label: 'data:export', note: '导出成 4 个 CSV' },
  { label: 'analyze.py', note: '真 Pandas 跑 8 个分析案例' },
  { label: 'results.generated.ts', note: '结果落成 TS 模块' },
  { label: '本页', note: '直接 import，零请求' },
]

export default function PythonAnalysis() {
  const py = PY_RESULTS

  /* ---------- 一、陈旧检查（很便宜，直接算） ---------- */
  const freshness = useMemo(() => checkFreshness(), [])

  /* ---------- 二、模块 1 的四个 KPI（几轮遍历，也很便宜） ---------- */
  const stats = useMemo(() => computePythonStats(py), [py])

  /* ---------- 三、对账（贵，推迟到首屏画完之后再算） ----------
     ★ 为什么不用 useMemo 直接算
       对账要读整个数据集（56 万行）再切三个时间窗口，实测 500ms 以上；
       加上数据集本身首次生成要 470ms，页面一打开就会**同步卡住约 1 秒**。
       没有任何加载提示，看起来就像"点不动了 / 打不开"。
       放进 useEffect 之后：页面立刻画出来，对账块下面先显示"正在逐项核对"，
       算完了自己填进去。用户看到的是"正在干活"，而不是"死了"。

     ★ 代价（如实记下）
       首屏 HTML 里没有对账表，所以「渲染一遍看有没有脏字符」那类检查看不到那张表。
       对账表本身由另一条检查覆盖（它不走渲染，直接调 getReconcileReport）。 */
  const [report, setReport] = useState<ReturnType<typeof getReconcileReport> | null>(null)
  useEffect(() => {
    setReport(getReconcileReport())
  }, [])

  /* ---------- 四、对账块跟随时间窗口（7 / 14 / 30） ---------- */
  const [days, setDays] = useState<number>(30)
  const windowPair = useMemo(() => getWindowPair(days), [days])

  /* ---------- 五、案例的场景筛选 ---------- */
  const [scene, setScene] = useState<string>(ALL_SCENES)
  const sceneCounts = useMemo(() => {
    const map = new Map<string, number>()
    for (const c of PYTHON_CASES) map.set(c.scene, (map.get(c.scene) ?? 0) + 1)
    return map
  }, [])
  const visibleCaseIds = useMemo(
    () =>
      new Set(
        (scene === ALL_SCENES ? PYTHON_CASES : PYTHON_CASES.filter((c) => c.scene === scene)).map(
          (c) => c.id,
        ),
      ),
    [scene],
  )

  const kpis: Kpi[] = useMemo(
    () => [
      {
        id: 'tables',
        name: '数据表',
        value: stats.tableCount,
        unit: 'count',
        deltaLabel: 'users / creators / videos / video_views',
        desc:
          'Python 读取的 CSV 文件数，和 SQL 分析页里建的那四张表是同一批数据。' +
          '四张表都在仓库的 data/sample/ 下留了前 1000 行，可以直接打开看。',
      },
      {
        id: 'rows',
        name: '数据记录',
        value: stats.rowCount,
        unit: 'count',
        deltaLabel: `${stats.userCount.toLocaleString('zh-CN')} 名用户 · ${formatCount(stats.viewCount)} 条观看记录`,
        desc:
          '四张表加起来的总行数，由 analyze.py 读完 CSV 后逐个 shape 数出来。' +
          '这个数字和对账块里的「观看记录表行数」对得上，对不上页面会报警。',
      },
      {
        id: 'metrics',
        name: '分析指标',
        value: stats.metricCount,
        unit: 'count',
        deltaLabel: '按结果文件里的数值字段名去重后统计',
        desc:
          'Python 结果里出现过的不同指标名个数（不含 manifest 那一段元信息）。' +
          '这个数字是遍历结果文件数出来的，不是估的 —— 定义写清楚了，' +
          '你按同样的定义去数，会得到同一个数。',
      },
      {
        id: 'cases',
        name: 'Python 案例',
        value: stats.caseCount,
        unit: 'count',
        deltaLabel: `覆盖 ${stats.sceneCount} 类分析场景 · ${stats.snippetLines} 行真实代码`,
        desc:
          '完整给出代码、并且真的跑出了结果的案例数量。' +
          '每个案例都按「业务问题 → 动到的数据 → 代码 → 结果 → 分析解释 → 业务意义」组织。' +
          '代码是从 analyze.py 自己的源码里切出来的，不是另抄一遍。',
      },
    ],
    [stats],
  )

  /* ---------- 六、案例渲染 ---------- */
  const caseById = PYTHON_CASE_BY_ID
  const cards: Record<PyCaseId, ReactNode> = {
    load: <LoadResult py={py} />,
    quality: <QualityResult py={py} />,
    clean: <CleanResult py={py} />,
    activity: <ActivityResult py={py} />,
    tiers: <TierResult py={py} />,
    content: <ContentResult py={py} />,
    cross: <CrossResult py={py} />,
    trend: <TrendResult py={py} />,
  }

  return (
    <div className="flex flex-col gap-4">
      {/* ---------- 页面说明 ---------- */}
      <p className="text-[13px] leading-relaxed text-ink-2">
        这一页用 <span className="font-medium text-ink">Python + Pandas</span> 补上 SQL
        不方便做的部分：数据体检、分位数分层、移动平均、相关系数、向量相似度。
        页面上每一段 Python 都<span className="font-medium text-ink">真的跑过</span>
        ——不过要说准确：它是在
        <span className="font-medium text-ink">我本机离线跑的</span>
        ，结果写成了一个文件，这一页直接读那个文件。
        <span className="text-ink-3">
          　不是在浏览器里实时执行 Python，那样说会显得更厉害，但它是假的。
          脚本和 CSV 都在仓库里，可以自己复现。
        </span>
      </p>

      {/* ---------- 陈旧警告横幅（检查不通过才出现） ---------- */}
      {!freshness.ok && <StaleBanner issues={freshness.issues} computedHash={freshness.computedHash} />}

      {/* ---------- 管道说明条 ---------- */}
      <section className="rounded-xl border border-hairline bg-card px-5 py-3.5">
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5">
          <span className="text-[12px] font-semibold text-ink">数据管道</span>
          {PIPELINE.map((step, i) => (
            <span key={step.label} className="flex items-center gap-2">
              {i > 0 && (
                <span className="text-[11px] text-ink-3" aria-hidden="true">
                  →
                </span>
              )}
              <span className="rounded bg-plane px-2 py-0.5 text-[11px] font-medium text-ink-2">
                {step.label}
              </span>
              <span className="text-[11px] text-ink-3">{step.note}</span>
            </span>
          ))}
        </div>

        <div className="mt-2.5 flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px] text-ink-3">
          <span className="rounded bg-[rgba(12,163,12,0.08)] px-2 py-0.5 text-[11px] font-semibold text-[#0ca30c]">
            {freshness.ok ? '结果文件与当前数据一致' : '结果文件可能已过期'}
          </span>
          <span className="tabular-nums">
            Python {py.manifest.pythonVersion} · pandas {py.manifest.pandasVersion} · numpy{' '}
            {py.manifest.numpyVersion}
          </span>
          <span className="tabular-nums">
            脚本指纹 <code className="font-mono">{py.manifest.analyzePyHash}</code>
            {freshness.ok ? '（与当前 analyze.py 一致）' : '（与当前 analyze.py 不一致）'}
          </span>
          <span className="ml-auto tabular-nums">{ANALYZE_SOURCE.split('\n').length} 行分析脚本</span>
        </div>
      </section>

      {/* ================================================================
          ① Python 分析概览
          ================================================================ */}
      <ModuleHeading
        index={1}
        title="Python 分析概览"
        purpose="这一页一共做了什么，四个数字全部是数出来的"
      />

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
        {kpis.map((kpi) => (
          <KpiCard key={kpi.id} kpi={kpi} />
        ))}
      </div>

      {/* 时间窗口的说明。不写这一段，读者会以为筛选坏了 */}
      <section className="rounded-xl border border-hairline bg-plane/40 px-5 py-3.5">
        <p className="text-[12px] font-semibold text-ink">关于时间窗口：这一页分两种用法</p>
        <ul className="mt-1.5 grid grid-cols-1 gap-x-8 gap-y-1 text-[11.5px] leading-relaxed text-ink-2 sm:grid-cols-2">
          <li>
            <span className="font-medium text-ink">固定用全部 {py.manifest.days} 天：</span>
            数据读取、数据体检、数据清洗、分层、相关系数、移动平均、周末效应。
            这些要的是「这个用户、这个分区平时的样子」，切窗口反而看不出结构。
          </li>
          <li>
            <span className="font-medium text-ink">跟随右上角 7 / 14 / 30 天的：</span>
            只有第 9 个模块的<b>对账块</b>。因为它对的是前面几个页面的
            「近 N 天」口径，必须跟着一起变。
          </li>
        </ul>
        <p className="mt-1.5 text-[11px] leading-relaxed text-ink-3">
          还有一条硬理由：7 天窗口上做 <code className="font-mono">rolling(7)</code> 只剩 1
          个有效点，移动平均根本算不出来。所以趋势和分层这类分析只能在全量上做。
        </p>
      </section>

      {/* ================================================================
          ② 数据读取与概览
          ================================================================ */}
      {visibleCaseIds.has('load') && (
        <>
          <ModuleHeading
            index={2}
            title="数据读取与概览"
            purpose="数据类型是显式声明的，不是 pandas 猜的"
          />
          <PythonCaseCard pythonCase={caseById.load}>{cards.load}</PythonCaseCard>
        </>
      )}

      {/* ================================================================
          ③ 数据清洗
          ================================================================ */}
      {visibleCaseIds.has('quality') && (
        <>
          <ModuleHeading
            index={3}
            title="数据清洗"
            purpose="如实展示：这份数据没有缺失值，清洗一行都没改"
          />
          <PythonCaseCard pythonCase={caseById.quality}>{cards.quality}</PythonCaseCard>
          <PythonCaseCard pythonCase={caseById.clean}>{cards.clean}</PythonCaseCard>
        </>
      )}

      {/* ================================================================
          ④ 用户活跃度分析
          ================================================================ */}
      {visibleCaseIds.has('activity') && (
        <>
          <ModuleHeading
            index={4}
            title="用户活跃度分析"
            purpose="日均 DAU 掩盖了分布和波动这两件事"
          />
          <PythonCaseCard pythonCase={caseById.activity}>{cards.activity}</PythonCaseCard>
        </>
      )}

      {/* ================================================================
          ⑤ 用户分层分析
          ================================================================ */}
      {visibleCaseIds.has('tiers') && (
        <>
          <ModuleHeading
            index={5}
            title="用户分层分析"
            purpose="qcut 等频分箱，看长尾到底有多长"
          />
          <PythonCaseCard pythonCase={caseById.tiers}>{cards.tiers}</PythonCaseCard>
        </>
      )}

      {/* ================================================================
          ⑥ 内容消费分析
          ================================================================ */}
      {visibleCaseIds.has('content') && (
        <>
          <ModuleHeading
            index={6}
            title="内容消费分析"
            purpose="视频时长和完播率到底有没有关系"
          />
          <PythonCaseCard pythonCase={caseById.content}>{cards.content}</PythonCaseCard>
        </>
      )}

      {/* ================================================================
          ⑦ 用户 × 内容交叉
          ================================================================ */}
      {visibleCaseIds.has('cross') && (
        <>
          <ModuleHeading
            index={7}
            title="用户 × 内容交叉"
            purpose="活跃分层看什么，以及各年龄段口味有多像"
          />
          <PythonCaseCard pythonCase={caseById.cross}>{cards.cross}</PythonCaseCard>
        </>
      )}

      {/* ================================================================
          ⑧ 趋势与变化率
          ================================================================ */}
      {visibleCaseIds.has('trend') && (
        <>
          <ModuleHeading
            index={8}
            title="趋势与变化率"
            purpose="用数据反查构造参数 —— 全项目唯一一处"
          />
          <PythonCaseCard pythonCase={caseById.trend}>{cards.trend}</PythonCaseCard>
        </>
      )}

      {/* ================================================================
          ⑨ SQL vs Python 对账
          ================================================================ */}
      <ModuleHeading
        index={9}
        title="SQL 与 Python 的对账"
        purpose="同一批口径实现了两遍，这里当场验一遍它们是不是同一个数"
      />

      {/* 时间窗口：只影响这一块 */}
      <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
        <span className="text-[12px] font-medium text-ink-2">对账窗口</span>
        <div className="flex gap-0.5 rounded-lg border border-hairline bg-card p-0.5">
          {py.manifest.windowDays.map((d) => (
            <button
              key={d}
              type="button"
              onClick={() => setDays(d)}
              aria-pressed={days === d}
              className={`rounded-md px-2.5 py-1 text-[12px] font-medium transition-colors ${
                days === d ? 'bg-ink text-white' : 'text-ink-2 hover:bg-plane hover:text-ink'
              }`}
            >
              近 {d} 天
            </button>
          ))}
        </div>
        <span className="text-[11.5px] text-ink-3">
          当前窗口 {windowPair.current.startDate} ~ {windowPair.current.endDate}
          （这个窗口只作用于本模块，不影响上面的分析）
        </span>
      </div>

      {/* 对账结果（陈旧时藏起来 —— 宁可不显示，也不显示错的） */}
      {freshness.ok ? (
        report ? (
          <ReconcilePanel report={report} days={days} />
        ) : (
          <section className="rounded-xl border border-hairline bg-card px-5 py-4">
            <p className="text-[12.5px] text-ink-2">
              正在逐项核对
              <span className="ml-1 text-ink-3">
                （要读完整份数据再切三个时间窗口，大概一秒）
              </span>
            </p>
          </section>
        )
      ) : (
        <section className="rounded-xl border border-down/30 bg-down/5 px-5 py-4">
          <p className="text-[12.5px] font-medium text-[#d03b3b]">
            因为上面的结果文件可能已经过期，这一段对账被暂时隐藏了。
          </p>
          <p className="mt-1 text-[11.5px] leading-relaxed text-ink-2">
            对账的前提是「两边读的是同一份数据」。现在这个前提不成立，
            继续把对比结果摆出来只会误导人。重新跑一次{' '}
            <code className="font-mono">npm run data:refresh</code> 就会恢复。
          </p>
        </section>
      )}

      {/* 分工边界：Python 做了哪些 SQL 做不了的事 */}
      <DivisionTable />

      {/* ================================================================
          ⑩ Python Code Viewer
          ================================================================ */}
      <ModuleHeading
        index={10}
        title="Python 代码全文"
        purpose="跑出上面所有数字的那一份脚本，原文照登"
      />

      <section className="rounded-xl border border-hairline bg-card px-5 py-4">
        <p className="text-[12.5px] leading-relaxed text-ink-2">
          下面这份就是跑出这一页全部结果的 <code className="font-mono">scripts/analyze.py</code>。
          它通过构建工具的 <code className="font-mono">?raw</code> 直接读进来，
          <span className="font-medium text-ink">没有在页面里另抄一份</span>
          —— 抄的那份迟早会和真跑的那份对不上。
        </p>
        <p className="mt-1.5 text-[11.5px] leading-relaxed text-ink-3">
          一共{' '}
          <span className="tabular-nums font-medium text-ink-2">
            {ANALYZE_SOURCE.split('\n').length}
          </span>{' '}
          行，默认折叠。上面每个案例里的代码片段，都是这份脚本里
          <code className="font-mono"> # ===== CASE:xxx BEGIN/END ===== </code>
          之间那一段，由脚本自己切出来的。
        </p>
        <div className="mt-3">
          <CodeBlock code={ANALYZE_SOURCE} language="python" collapsedLines={20} />
        </div>

        {/* 能力覆盖矩阵：从案例定义反推，不手填 */}
        <div className="mt-4">
          <p className="text-[11px] font-semibold text-ink-3">Pandas 能力覆盖</p>
          <div className="mt-1.5 overflow-x-auto rounded-lg border border-hairline">
            <table className="w-full border-collapse text-[11.5px]">
              <thead className="bg-plane">
                <tr>
                  <th scope="col" className="border-b border-hairline px-3 py-2 text-left font-semibold text-ink-2">
                    能力
                  </th>
                  <th scope="col" className="border-b border-hairline px-3 py-2 text-left font-semibold text-ink-2">
                    用在哪些案例
                  </th>
                </tr>
              </thead>
              <tbody>
                {computePythonAbilities().map((row) => (
                  <tr key={row.ability} className="border-b border-hairline/60 last:border-b-0">
                    <td className="px-3 py-1.5 font-mono text-[11px] text-ink-2">{row.ability}</td>
                    <td className="px-3 py-1.5 tabular-nums text-ink-2">
                      {row.cases.map((n) => String(n).padStart(2, '0')).join(' / ')}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p className="mt-1.5 text-[11px] leading-relaxed text-ink-3">
            这张表是从案例定义里正好遍历出来的，不是手填的清单 ——
            手填的迟早会和案例本身对不上。
          </p>
        </div>
      </section>

      {/* ================================================================
          ⑪ 业务洞察
          ================================================================ */}
      <ModuleHeading index={11} title="业务洞察" purpose="每条都分成发现 / 原因假设 / 业务建议" />

      <section className="flex flex-col gap-3.5">
        {buildInsights(py).map((ins, i) => (
          <article key={ins.title} className="rounded-xl border border-hairline bg-card px-5 py-4">
            <header className="flex items-baseline gap-2.5">
              <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded-md bg-ink text-[11px] font-semibold text-white">
                {i + 1}
              </span>
              <h3 className="text-[13px] font-semibold text-ink">{ins.title}</h3>
            </header>
            <dl className="mt-2.5 flex flex-col gap-2">
              <InsightRow label="发现" tone="fact">
                {ins.finding}
              </InsightRow>
              <InsightRow label="原因假设" tone="guess">
                {ins.hypothesis}
              </InsightRow>
              <InsightRow label="业务建议" tone="action">
                {ins.action}
              </InsightRow>
            </dl>
          </article>
        ))}

        <p className="text-[11.5px] leading-relaxed text-ink-3">
          「原因假设」这一栏有意写成<span className="font-medium text-ink">假设</span>而不是结论。这个项目的数据是模拟生成的，
          里面的规律来自我设的构造参数（见最下面的对照表）——
          所以我能确定的是"数据里确实有这个现象"，不能确定的是"现实业务里也这样"。
          把这两件事分开写，是分析报告该有的样子。
        </p>
      </section>

      {/* 案例筛选（放在最后：先让读者看到内容，再决定要不要筛） */}
      <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
        <span className="text-[12px] font-medium text-ink-2">按场景筛选上面的案例</span>
        <div className="flex flex-wrap gap-0.5 rounded-lg border border-hairline bg-card p-0.5">
          {[ALL_SCENES, ...PYTHON_SCENES].map((s) => {
            const count = s === ALL_SCENES ? PYTHON_CASES.length : (sceneCounts.get(s) ?? 0)
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
                <span className="ml-1.5 tabular-nums opacity-60">{count}</span>
              </button>
            )
          })}
        </div>
      </div>

      <DataProvenance />
    </div>
  )
}

/* ==========================================================================
   模块 1 的统计数字
   ========================================================================== */

/**
 * 数一数结果文件里到底有多少个不同的指标。
 *
 * ★ 定义必须写清楚，否则这个数字就是凑出来的：
 *   遍历结果文件里**除 manifest 之外**的所有对象，
 *   把所有出现在「值的位置」的字段名收集起来去重。
 *   比如 `totalViews` 在三个窗口里各出现一次，只算一个指标。
 *
 * 为什么排除 manifest：那一段记的是 seed、版本号、行数这些**元信息**，
 * 不是分析产出的指标。把它们算进来会让这个数字虚高——
 * 而虚高的 KPI 正是这一页最不该有的东西。
 */
function collectMetricNames(value: unknown, into: Set<string>): void {
  if (Array.isArray(value)) {
    for (const item of value) collectMetricNames(item, into)
    return
  }
  if (value && typeof value === 'object') {
    for (const [key, item] of Object.entries(value)) {
      if (typeof item === 'number') into.add(key)
      else collectMetricNames(item, into)
    }
  }
}

function computePythonStats(py: PyResults) {
  const { manifest, quality, snippets } = py

  const metricNames = new Set<string>()
  collectMetricNames(
    {
      quality: py.quality,
      activity: py.activity,
      tiers: py.tiers,
      content: py.content,
      cross: py.cross,
      trend: py.trend,
      windows: py.windows,
    },
    metricNames,
  )

  const rowCount = quality.shapes.reduce((a, s) => a + s.rows, 0)
  const snippetLines = Object.values(snippets).reduce((a, s) => a + s.split('\n').length, 0)

  return {
    tableCount: quality.shapes.length,
    rowCount,
    userCount: manifest.rowCounts.users,
    viewCount: manifest.rowCounts.video_views,
    metricCount: metricNames.size,
    caseCount: PYTHON_CASES.length,
    sceneCount: PYTHON_SCENES.length,
    snippetLines,
  }
}

/* ==========================================================================
   模块 2：数据读取与概览
   ========================================================================== */

function LoadResult({ py }: { py: PyResults }) {
  const q = py.quality

  const shapeColumns: Column[] = [
    { key: 'label', label: '数据表', align: 'left' },
    { key: 'table', label: '文件名', align: 'left' },
    { key: 'rows', label: '行数', align: 'right', bar: true },
    { key: 'columns', label: '列数', align: 'right' },
  ]

  /* 字段类型按表分组：同一张表的字段排在一起，比一张大平表好读 */
  const dtypesByTable = useMemo(() => {
    const map = new Map<string, { column: string; dtype: string }[]>()
    for (const d of q.dtypes) {
      const list = map.get(d.table)
      if (list) list.push({ column: d.column, dtype: d.dtype })
      else map.set(d.table, [{ column: d.column, dtype: d.dtype }])
    }
    return Array.from(map, ([table, columns]) => ({ table, columns }))
  }, [q.dtypes])

  return (
    <>
      <ChartCard
        title="四张表读进来之后有多大"
        subtitle="行数和列数都是读完之后当场数出来的"
        meta="df.shape"
        table={
          <DataTable
            columns={shapeColumns}
            rows={q.shapes as unknown as Record<string, string | number>[]}
            maxHeight={240}
          />
        }
      >
        <div className="px-2 pb-1">
          <ResponsiveContainer width="100%" height={200}>
            <BarChart
              data={q.shapes}
              layout="vertical"
              margin={{ top: 4, right: 76, bottom: 0, left: 4 }}
            >
              <CartesianGrid stroke={CHART_INK.grid} horizontal={false} />
              <XAxis
                type="number"
                domain={[0, Math.max(...q.shapes.map((s) => s.rows)) * 1.18]}
                tickFormatter={(v: number) => formatCount(v)}
                tick={{ fill: CHART_INK.tick, fontSize: 11 }}
                tickLine={false}
                axisLine={{ stroke: CHART_INK.axis }}
              />
              <YAxis
                type="category"
                dataKey="label"
                width={82}
                tick={{ fill: CHART_INK.tick, fontSize: 11 }}
                tickLine={false}
                axisLine={false}
              />
              <Tooltip
                cursor={{ fill: 'rgba(42,120,214,0.06)' }}
                content={
                  <ChartTooltip valueFormatter={(v, key) => (key === 'rows' ? withThousands(v) : String(v))} />
                }
              />
              <Bar dataKey="rows" name="行数" fill={SERIES_PRIMARY} radius={[0, 3, 3, 0]} barSize={18} />
            </BarChart>
          </ResponsiveContainer>
        </div>
      </ChartCard>

      {/* 字段类型 */}
      <section className="rounded-lg border border-hairline bg-plane/40 px-3.5 py-3">
        <p className="text-[11px] font-semibold text-ink-3">
          每张表的字段类型（读文件时显式声明的，不是 pandas 推断的）
        </p>
        <div className="mt-2 grid grid-cols-1 gap-x-6 gap-y-2.5 sm:grid-cols-2">
          {dtypesByTable.map((g) => (
            <div key={g.table}>
              <p className="font-mono text-[11px] font-semibold text-ink">{g.table}</p>
              <div className="mt-1 flex flex-wrap gap-1">
                {g.columns.map((c) => (
                  <span
                    key={c.column}
                    className="rounded border border-hairline bg-card px-1.5 py-0.5 font-mono text-[10.5px] text-ink-2"
                  >
                    {c.column}
                    <span className="ml-1 text-ink-3">{c.dtype}</span>
                  </span>
                ))}
              </div>
            </div>
          ))}
        </div>
      </section>

      {/* head(5) */}
      <section>
        <p className="text-[11px] font-semibold text-ink-3">
          每张表的前 5 行（head）
          <span className="ml-2 font-normal">
            看数据长什么样最快的一步。完整的前 1000 行在仓库的 data/sample/ 里。
          </span>
        </p>
        <div className="mt-2 grid grid-cols-1 gap-3 xl:grid-cols-2">
          {q.head.map((h) => (
            <div key={h.table} className="overflow-hidden rounded-lg border border-hairline">
              <div className="border-b border-hairline bg-plane px-3 py-1.5">
                <span className="font-mono text-[11px] font-semibold text-ink">{h.table}</span>
                <span className="ml-2 text-[10.5px] text-ink-3">{h.label} · 前 5 行</span>
              </div>
              <div className="overflow-x-auto">
                <table className="w-full border-collapse text-[11px]">
                  <thead>
                    <tr>
                      {h.columns.map((c) => (
                        <th
                          key={c}
                          scope="col"
                          className="whitespace-nowrap border-b border-hairline/70 px-2.5 py-1.5 text-left font-mono font-semibold text-ink-2"
                        >
                          {c}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {h.rows.map((row, i) => (
                      <tr key={i} className="odd:bg-card even:bg-plane/50">
                        {row.map((cell, j) => (
                          <td
                            key={j}
                            className="whitespace-nowrap border-b border-hairline/50 px-2.5 py-1 tabular-nums text-ink-2"
                          >
                            {cell === null ? '—' : cell}
                          </td>
                        ))}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          ))}
        </div>
      </section>
    </>
  )
}

/* ==========================================================================
   模块 3：数据体检 + 清洗
   ========================================================================== */

function QualityResult({ py }: { py: PyResults }) {
  const q = py.quality
  const sentinelTotal = q.sentinelHits.reduce((a, s) => a + s.count, 0)
  const orphanTotal = q.foreignKeys.reduce((a, f) => a + f.orphans, 0)
  const violationTotal = q.rangeChecks.reduce((a, c) => a + c.violations, 0)

  const checks = [
    {
      label: '缺失值（isna 口径）',
      value: `${q.missingTotal} 个`,
      ok: q.missingTotal === 0,
      note: 'CSV 里连续两个逗号之间的真空白',
    },
    {
      label: '缺失值（哨兵字符串口径）',
      value: `${sentinelTotal} 处`,
      ok: sentinelTotal === 0,
      note: '写着 "NA" / "null" / "-" 这类值——看着有值，其实是空的',
    },
    {
      label: '整行完全重复',
      value: `${q.duplicateFullRows} 行`,
      ok: q.duplicateFullRows === 0,
      note: '每一列都一模一样的行，这是真正的重复数据',
    },
    {
      label: '外键孤儿行',
      value: `${orphanTotal} 行`,
      ok: orphanTotal === 0,
      note: `${q.foreignKeys.length} 项引用关系：观看记录指向的用户 / 视频、视频指向的创作者，都要能找到`,
    },
    {
      label: '业务范围越界',
      value: `${violationTotal} 行`,
      ok: violationTotal === 0,
      note: `${q.rangeChecks.length} 项检查：观看秒数为正、不超过视频时长、日期在范围内、年龄合理、注册日不晚于截止日`,
    },
  ]

  return (
    <>
      <div className="grid grid-cols-1 gap-2.5 sm:grid-cols-2 xl:grid-cols-3">
        {checks.map((c) => (
          <div
            key={c.label}
            className="rounded-lg border border-hairline bg-plane/40 px-3.5 py-2.5"
          >
            <div className="flex items-baseline justify-between gap-2">
              <span className="text-[11.5px] font-medium text-ink">{c.label}</span>
              <span
                className="rounded px-1.5 py-0.5 text-[11px] font-semibold tabular-nums"
                style={{
                  color: c.ok ? STATUS_COLOR.up : STATUS_COLOR.down,
                  background: c.ok ? 'rgba(12,163,12,0.08)' : 'rgba(208,59,59,0.08)',
                }}
              >
                {c.value}
              </span>
            </div>
            <p className="mt-1 text-[10.5px] leading-relaxed text-ink-3">{c.note}</p>
          </div>
        ))}
      </div>

      {/* 两种重复口径 */}
      <section className="rounded-lg border border-hairline bg-plane/40 px-3.5 py-3">
        <p className="text-[11px] font-semibold text-ink-3">
          同一个词，两种口径 —— 这就是「重复」这个词最容易出错的地方
        </p>
        <div className="mt-2 flex flex-col gap-1.5">
          {q.duplicateKeys.map((d) => (
            <div key={d.key} className="flex flex-wrap items-baseline gap-x-2.5 gap-y-0.5">
              <code className="font-mono text-[11px] text-ink">{d.key}</code>
              <span className="text-[11.5px] text-ink-2">{d.label}</span>
              <span className="tabular-nums text-[12.5px] font-semibold text-ink">
                {withThousands(d.count)} 行
              </span>
            </div>
          ))}
        </div>
        <p className="mt-2 text-[11px] leading-relaxed text-ink-3">
          两个数字差了 260 多倍，但<span className="font-medium text-ink">都不是脏数据</span>。
          这张表的粒度是「一次播放」，不是「用户 × 视频 × 天」——
          同一个人一天把同一个视频点开三次，本来就该有三行。
          把两种口径分开报，是为了让人看清「重复」和「重复」是两回事；
          只报一个数字，读者一定会误判。
        </p>
      </section>

      {/* 越界检查明细 */}
      <section className="rounded-lg border border-hairline">
        <div className="border-b border-hairline bg-plane px-3.5 py-1.5">
          <span className="text-[11px] font-semibold text-ink-2">范围检查逐项明细</span>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full border-collapse text-[11.5px]">
            <thead>
              <tr>
                {['检查项', '口径', '越界行数'].map((h) => (
                  <th
                    key={h}
                    scope="col"
                    className="whitespace-nowrap border-b border-hairline/70 px-3 py-1.5 text-left font-semibold text-ink-2"
                  >
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {q.rangeChecks.map((c) => (
                <tr key={c.check} className="odd:bg-card even:bg-plane/50">
                  <td className="px-3 py-1.5 text-ink">{c.check}</td>
                  <td className="px-3 py-1.5 text-ink-3">{c.detail}</td>
                  <td className="px-3 py-1.5 tabular-nums text-ink-2">{c.violations}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
    </>
  )
}

function CleanResult({ py }: { py: PyResults }) {
  const q = py.quality
  const same = q.rowsBefore === q.rowsAfter

  return (
    <section className="rounded-lg border border-hairline bg-plane/40 px-3.5 py-3">
      <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
        <span className="text-[11px] font-semibold text-ink-3">清洗前后的行数</span>
        <span className="tabular-nums text-[12.5px] text-ink-2">
          清洗前 {withThousands(q.rowsBefore)} 行
        </span>
        <span className="text-[12px] text-ink-3" aria-hidden="true">
          →
        </span>
        <span className="tabular-nums text-[12.5px] font-semibold text-ink">
          清洗后 {withThousands(q.rowsAfter)} 行
        </span>
        <span
          className="rounded px-1.5 py-0.5 text-[11px] font-semibold"
          style={{
            color: same ? STATUS_COLOR.up : STATUS_COLOR.down,
            background: same ? 'rgba(12,163,12,0.08)' : 'rgba(208,59,59,0.08)',
          }}
        >
          {same ? '一行没丢、一行没改' : '行数变了'}
        </span>
      </div>

      <p className="mt-2 text-[11px] font-semibold text-ink-3">
        这一步真正做的事：加派生列
      </p>
      <div className="mt-1.5 flex flex-wrap gap-1.5">
        {q.derivedColumns.map((c) => (
          <code
            key={c}
            className="rounded border border-hairline bg-card px-2 py-0.5 font-mono text-[11px] text-ink"
          >
            {c}
          </code>
        ))}
      </div>
      <p className="mt-2 text-[11px] leading-relaxed text-ink-3">
        这四个字段原来不存在，是分析需要才造出来的：
        分区和视频时长从视频表并过来、年龄段从用户表并过来、
        「是否完播」由「观看秒数 ≥ 视频总时长 × 80%」当场算出来。
        造完之后脚本里加了一条断言：
        <span className="font-medium text-ink-2">清洗后的行数必须等于清洗前</span>
        —— 不相等就当场报错，绝不让一份悄悄少了行的数据往下走。
      </p>
    </section>
  )
}

/* ==========================================================================
   模块 4：用户活跃度
   ========================================================================== */

function ActivityResult({ py }: { py: PyResults }) {
  const a = py.activity
  const v = a.volatility
  const days = py.manifest.days

  return (
    <>
      <ChartCard
        title={`每个用户在 ${days} 天里活跃了多少天`}
        subtitle="横轴是活跃天数，纵轴是人数。日均 DAU 看不出这个分布，但它才是做用户运营时真正要看的"
        meta={`单位：人 · 全量 ${days} 天`}
        table={
          <DataTable
            columns={[
              { key: 'days', label: '活跃天数', align: 'left' },
              { key: 'users', label: '人数', align: 'right', bar: true },
            ]}
            rows={a.activeDaysHist as unknown as Record<string, string | number>[]}
            initialSortKey="days"
            initialSortDesc={false}
            maxHeight={280}
          />
        }
        note={
          `平均每个用户活跃 ${a.avgActiveDays.toFixed(1)} 天；` +
          `一次都没来过的用户 ${a.neverActiveUsers} 人。` +
          `分布明显偏向两端——要么经常来，要么几乎不来，中间那一段反而最薄。`
        }
      >
        <div className="px-2 pb-1">
          <ResponsiveContainer width="100%" height={236}>
            <BarChart data={a.activeDaysHist} margin={{ top: 6, right: 8, bottom: 4, left: 0 }}>
              <CartesianGrid stroke={CHART_INK.grid} vertical={false} />
              <XAxis
                dataKey="days"
                tick={{ fill: CHART_INK.tick, fontSize: 10 }}
                tickLine={false}
                axisLine={{ stroke: CHART_INK.axis }}
                interval={4}
                label={{
                  value: '活跃天数',
                  position: 'insideBottomRight',
                  offset: -2,
                  fill: CHART_INK.label,
                  fontSize: 10.5,
                }}
              />
              <YAxis
                tick={{ fill: CHART_INK.tick, fontSize: 11 }}
                tickLine={false}
                axisLine={false}
                width={48}
                tickFormatter={(v2: number) => formatCount(v2)}
              />
              <Tooltip
                cursor={{ fill: 'rgba(42,120,214,0.06)' }}
                content={
                  <ChartTooltip
                    labelFormatter={(l) => `活跃 ${l} 天`}
                    valueFormatter={(v2) => `${withThousands(v2)} 人`}
                  />
                }
              />
              <Bar dataKey="users" name="人数" fill={SERIES_PRIMARY} radius={[2, 2, 0, 0]} />
            </BarChart>
          </ResponsiveContainer>
        </div>
      </ChartCard>

      {/* 波动率 */}
      <div className="grid grid-cols-1 gap-2.5 sm:grid-cols-3">
        <MiniStat
          label="日环比波动率（标准差）"
          value={`${v.stdPct.toFixed(2)}%`}
          note="把每天相对前一天的涨跌看成一串数，求它们的标准差"
        />
        <MiniStat
          label="平均每天上下浮动"
          value={`${v.meanAbsPct.toFixed(2)}%`}
          note="取绝对值再平均，反映「典型的一天」抖多少"
        />
        <MiniStat
          label={`波动最大的一天（${v.maxAbsDate}）`}
          value={`${v.maxAbsPct.toFixed(2)}%`}
          note="这一天和前一天差得最多。放在第 08 个案例里一起看，就知道它是周末效应还是异常"
        />
      </div>

      <p className="text-[11px] leading-relaxed text-ink-3">
        这三个数都是 Python 独有的：SQL 里算标准差要自己写
        <code className="font-mono"> SQRT(AVG(x*x) - AVG(x)*AVG(x))</code>，
        而且没有现成的移动平均。这也是这一页存在的理由之一。
      </p>
    </>
  )
}

function MiniStat({ label, value, note }: { label: string; value: string; note: string }) {
  return (
    <div className="rounded-lg border border-hairline bg-plane/40 px-3.5 py-2.5">
      <p className="text-[11.5px] font-medium text-ink-2">{label}</p>
      <p className="mt-1 text-[20px] font-semibold leading-none tabular-nums text-ink">{value}</p>
      <p className="mt-1.5 text-[10.5px] leading-relaxed text-ink-3">{note}</p>
    </div>
  )
}

/* ==========================================================================
   模块 5：用户分层
   ========================================================================== */

function TierResult({ py }: { py: PyResults }) {
  const tiers = py.tiers

  /* 时长占比的条形图。颜色用有序色阶——档位本身有先后，深色 = 更活跃 */
  const shareData = tiers.map((t, i) => ({
    tier: t.id,
    minutesShare: t.minutesShare,
    viewsShare: t.viewsShare,
    fill: AGE_RAMP[i] ?? AGE_RAMP[AGE_RAMP.length - 1],
  }))

  return (
    <>
      <ChartCard
        title="四档用户各贡献了多少观看时长"
        subtitle="等频分箱保证四档人数完全一样，所以柱子长短的差异就是「贡献差异」，不含人数因素"
        meta="单位：% · 全量 60 天"
        table={
          <DataTable
            columns={[
              { key: 'id', label: '分档', align: 'left' },
              { key: 'users', label: '人数', align: 'right' },
              { key: 'minMinutes', label: '人均日观看下限(分)', align: 'right' },
              { key: 'maxMinutes', label: '人均日观看上限(分)', align: 'right' },
              { key: 'avgActiveDays', label: '平均活跃天数', align: 'right' },
              { key: 'minutesShare', label: '时长占比(%)', align: 'right', bar: true },
              { key: 'viewsShare', label: '播放占比(%)', align: 'right' },
            ]}
            rows={tiers.map((t) => ({
              id: t.id,
              users: t.users,
              minMinutes: Number(t.minMinutes.toFixed(2)),
              maxMinutes: Number(t.maxMinutes.toFixed(2)),
              avgActiveDays: Number(t.avgActiveDays.toFixed(1)),
              minutesShare: Number(t.minutesShare.toFixed(2)),
              viewsShare: Number(t.viewsShare.toFixed(2)),
            }))}
            initialSortKey="minutesShare"
            maxHeight={240}
          />
        }
        note={
          `最高的一档贡献了 ${tiers[tiers.length - 1].minutesShare.toFixed(1)}% 的观看时长，` +
          `最低的一档只有 ${tiers[0].minutesShare.toFixed(1)}%。` +
          `四档人数一样多，所以这个差距完全是行为差异，不是人数差异。`
        }
      >
        <div className="px-2 pb-1">
          <ResponsiveContainer width="100%" height={216}>
            <BarChart data={shareData} margin={{ top: 8, right: 16, bottom: 4, left: 0 }}>
              <CartesianGrid stroke={CHART_INK.grid} vertical={false} />
              <XAxis
                dataKey="tier"
                tick={{ fill: CHART_INK.tick, fontSize: 11 }}
                tickLine={false}
                axisLine={{ stroke: CHART_INK.axis }}
              />
              <YAxis
                tick={{ fill: CHART_INK.tick, fontSize: 11 }}
                tickLine={false}
                axisLine={false}
                width={44}
                tickFormatter={(v: number) => `${v}%`}
              />
              <Tooltip
                cursor={{ fill: 'rgba(42,120,214,0.06)' }}
                content={<ChartTooltip valueFormatter={(v) => `${v.toFixed(2)}%`} />}
              />
              <Bar dataKey="minutesShare" name="时长占比" radius={[3, 3, 0, 0]} barSize={54}>
                {shareData.map((d) => (
                  <Cell key={d.tier} fill={d.fill} />
                ))}
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        </div>
      </ChartCard>

      {/* 每档爱看什么 */}
      <section className="rounded-lg border border-hairline bg-plane/40 px-3.5 py-3">
        <p className="text-[11px] font-semibold text-ink-3">
          每一档的人最爱看的三个分区（占本档观看量的比例）
        </p>
        <div className="mt-2 grid grid-cols-1 gap-2.5 sm:grid-cols-2 xl:grid-cols-4">
          {tiers.map((t) => (
            <div key={t.id} className="rounded-lg border border-hairline bg-card px-3 py-2">
              <p className="text-[11.5px] font-semibold text-ink">{t.id}</p>
              <p className="text-[10.5px] text-ink-3">
                {t.users.toLocaleString('zh-CN')} 人 · 平均活跃 {t.avgActiveDays.toFixed(1)} 天
              </p>
              <ul className="mt-1.5 flex flex-col gap-0.5">
                {t.topCategories.map((c) => (
                  <li key={c.category} className="flex justify-between gap-2 text-[11px] text-ink-2">
                    <span>{c.category}</span>
                    <span className="tabular-nums">{formatPercent(c.share)}</span>
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </div>
      </section>
    </>
  )
}

/* ==========================================================================
   模块 6：内容消费
   ========================================================================== */

function ContentResult({ py }: { py: PyResults }) {
  const c = py.content

  const points = c.categories.map((cat) => ({
    category: cat.category,
    duration: Number(cat.medianDuration.toFixed(1)),
    completedRate: Number(cat.avgCompletedRate.toFixed(2)),
    videos: cat.videos,
  }))

  const rho = c.durationCompletionR

  return (
    <>
      <ChartCard
        title="视频越长，完播率越低吗"
        subtitle="每个点是一个内容分区，横轴是这个分区的中位时长，纵轴是它的平均完播率，点的大小是该分区的视频数"
        meta="全量 60 天"
        table={
          <DataTable
            columns={[
              { key: 'category', label: '分区', align: 'left' },
              { key: 'videos', label: '视频数', align: 'right' },
              { key: 'medianDuration', label: '中位时长(秒)', align: 'right', bar: true },
              { key: 'plays', label: '播放次数', align: 'right' },
              { key: 'avgCompletedRate', label: '平均完播率(%)', align: 'right' },
              { key: 'avgWatchSeconds', label: '人均观看(秒)', align: 'right' },
            ]}
            rows={c.categories.map((cat) => ({
              category: cat.category,
              videos: cat.videos,
              medianDuration: Number(cat.medianDuration.toFixed(1)),
              plays: cat.plays,
              avgCompletedRate: Number(cat.avgCompletedRate.toFixed(2)),
              avgWatchSeconds: Number(cat.avgWatchSeconds.toFixed(1)),
            }))}
            initialSortKey="medianDuration"
            maxHeight={280}
          />
        }
        note={
          `相关系数 r = ${rho.toFixed(3)}。` +
          (Math.abs(rho) < 0.2
            ? '这个值非常接近 0，说明「视频越长完播率越低」在这份数据里并不成立。'
            : '两者存在一定的线性关系，但强度有限。') +
          ' 注意：相关系数只描述线性关系，它既不能证明因果，也不能排除非线性的关系。'
        }
      >
        <div className="px-2 pb-1">
          <ResponsiveContainer width="100%" height={280}>
            <ScatterChart margin={{ top: 12, right: 24, bottom: 16, left: 0 }}>
              <CartesianGrid stroke={CHART_INK.grid} />
              <XAxis
                type="number"
                dataKey="duration"
                name="中位时长"
                unit=" 秒"
                tick={{ fill: CHART_INK.tick, fontSize: 11 }}
                tickLine={false}
                axisLine={{ stroke: CHART_INK.axis }}
              />
              <YAxis
                type="number"
                dataKey="completedRate"
                name="平均完播率"
                unit="%"
                tick={{ fill: CHART_INK.tick, fontSize: 11 }}
                tickLine={false}
                axisLine={false}
                width={52}
              />
              <ZAxis type="number" dataKey="videos" range={[90, 420]} />
              <Tooltip
                cursor={{ strokeDasharray: '3 3' }}
                content={
                  <ChartTooltip
                    labelFormatter={(l) => `中位时长 ${l} 秒`}
                    valueFormatter={(v, key) =>
                      key === 'completedRate' ? `${v.toFixed(2)}%` : withThousands(v)
                    }
                  />
                }
              />
              <Scatter name="内容分区" data={points} fill={SERIES_PRIMARY} fillOpacity={0.72}>
                {points.map((p, i) => (
                  <Cell key={p.category} fill={ORDINAL_RAMP[Math.min(i, ORDINAL_RAMP.length - 1)]} />
                ))}
              </Scatter>
            </ScatterChart>
          </ResponsiveContainer>
        </div>
      </ChartCard>

      <p className="text-[11px] leading-relaxed text-ink-3">
        这张图回答的是「完播率低该怪视频太长，还是怪内容不行」。
        如果时长和完播率高度负相关，那么砍时长就能提升完播率；
        实测 r = {rho.toFixed(3)}，两者几乎没有线性关系——
        说明问题更可能出在内容本身，而不是时长。
        <span className="font-medium text-ink-2">
          这也是数据分析最实际的用处：不是给出答案，而是缩小该试的方向。
        </span>
      </p>
    </>
  )
}

/* ==========================================================================
   模块 7：用户 × 内容
   ========================================================================== */

function CrossResult({ py }: { py: PyResults }) {
  const cross = py.cross

  /* 把 Python 的交叉结果装成热力图组件要的形状。
     ★ 这里用 CATEGORIES 作为遍历源、再去 Python 结果里找对应值，
       而不是直接拿 Python 的字符串当 CategoryName —— 这样类型是安全的，
       顺便保证了「八个分区一个都不能少」。 */
  const heatmap: HeatmapData = useMemo(() => {
    let shareMax = 0
    const rows = cross.tierCategory.map((row) => {
      const cells = CATEGORIES.map((cat) => {
        const hit = row.cells.find((c) => c.category === cat)
        const share = hit?.share ?? 0
        if (share > shareMax) shareMax = share
        return {
          category: cat,
          share,
          text: share > 0 ? formatPercent(share) : '—',
          detail: [
            { label: '观看量', value: withThousands(hit?.views ?? 0) },
            { label: '本档内占比', value: formatPercent(share) },
          ],
          views: hit?.views ?? 0,
        }
      })
      return { id: row.tier, label: row.tier, totalViews: row.totalViews, cells }
    })

    return {
      rows,
      categories: CATEGORIES,
      shareMax: shareMax || 1,
      legendLabel: '颜色 = 该档用户在这个分区上的观看量占比',
      legendMaxText: formatPercent(shareMax),
      peak: null,
    }
  }, [cross])

  /* 相似度矩阵：把 6 个成对结果铺成 4×4 的表 */
  const simRows = useMemo(() => {
    const ages = Array.from(
      new Set(cross.preferenceSimilarity.flatMap((s) => [s.a, s.b])),
    )
    const lookup = new Map<string, number>()
    for (const s of cross.preferenceSimilarity) {
      lookup.set(`${s.a}|${s.b}`, s.cosine)
      lookup.set(`${s.b}|${s.a}`, s.cosine)
    }
    return { ages, lookup }
  }, [cross.preferenceSimilarity])

  return (
    <>
      <ChartCard
        title="活跃分层 × 内容分区"
        subtitle="一行是一档用户，一列是一个分区。颜色深浅代表这一档用户在这个分区上的观看量占比（每行加起来 100%）"
        meta="全量 60 天"
        note={
          '为什么用「行内占比」上色而不是观看量？' +
          '四档人数完全一样，但各分区总盘子大小不同——' +
          '直接拿观看量上色，热门分区那一整列都会更深，那是「分区热」不是「这档人爱看」。' +
          '换成行内占比，同一行里颜色深的格子才是真的更偏爱。'
        }
      >
        <div className="px-2 pb-1 pt-2">
          <Heatmap data={heatmap} />
        </div>
      </ChartCard>

      {/* 余弦相似度矩阵 */}
      <section className="rounded-lg border border-hairline">
        <div className="border-b border-hairline bg-plane px-3.5 py-1.5">
          <span className="text-[11px] font-semibold text-ink-2">
            各年龄段口味相似度（余弦相似度，越接近 1 越像）
          </span>
        </div>
        <div className="overflow-x-auto p-3.5">
          <table className="border-collapse text-[11.5px]">
            <thead>
              <tr>
                <th scope="col" className="px-2 py-1.5" />
                {simRows.ages.map((a) => (
                  <th
                    key={a}
                    scope="col"
                    className="whitespace-nowrap px-3 py-1.5 text-left font-semibold text-ink-2"
                  >
                    {a}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {simRows.ages.map((a) => (
                <tr key={a}>
                  <th scope="row" className="whitespace-nowrap px-2 py-1.5 text-left font-semibold text-ink-2">
                    {a}
                  </th>
                  {simRows.ages.map((b) => {
                    if (a === b) {
                      return (
                        <td
                          key={b}
                          className="px-3 py-1.5 text-center text-ink-3"
                          title="自己和自己比"
                        >
                          —
                        </td>
                      )
                    }
                    const v = simRows.lookup.get(`${a}|${b}`)
                    const level = v === undefined ? 0 : Math.floor(((v - 0.5) / 0.5) * ORDINAL_RAMP.length)
                    const idx = Math.min(ORDINAL_RAMP.length - 1, Math.max(0, level))
                    return (
                      <td key={b} className="p-[3px]">
                        <div
                          className="rounded-[4px] px-3 py-1.5 text-center font-semibold tabular-nums"
                          style={{
                            background: v === undefined ? 'transparent' : ORDINAL_RAMP[idx],
                            color: idx >= 3 ? '#ffffff' : '#0f172a',
                          }}
                        >
                          {v === undefined ? '—' : v.toFixed(3)}
                        </div>
                      </td>
                    )
                  })}
                </tr>
              ))}
            </tbody>
          </table>
          <p className="mt-2 text-[11px] leading-relaxed text-ink-3">
            做法：把每个年龄段在 8 个分区上的观看量看成一个 8 维向量，算两两之间的夹角余弦。
            这比把 32 个数字摆出来让人自己看要清楚得多。
            <span className="font-medium text-ink-2">
              但要注意它只看「方向」不看「多少」
            </span>
            ——两个年龄段的观看量可以差很多倍，只要各分区的比例结构接近，相似度就很高。
            SQL 里要算这个得手写一长串乘加求和，Pandas 一行就够。
          </p>
        </div>
      </section>
    </>
  )
}

/* ==========================================================================
   模块 8：趋势与变化率
   ========================================================================== */

function TrendResult({ py }: { py: PyResults }) {
  const trend = py.trend
  const daily = py.activity.daily

  /* 把 dowEffect 的实测倍数和构造参数里的设定值并排摆出来 */
  const bars = trend.dowEffect.map((d) => ({
    label: d.label,
    ratio: Number(d.ratioToWeekday.toFixed(4)),
    days: d.days,
  }))

  return (
    <>
      <ChartCard
        title={`${py.manifest.days} 天的 DAU：原始值 vs 7 日移动平均`}
        subtitle="浅色是每天的真实值，深色是 7 日移动平均。移动平均把随机的上下跳动抹平之后，剩下的才是趋势"
        meta="单位：人"
        note={
          '看浅色那条：每天都在上下跳，最高最低差了将近一倍。' +
          '但看深色那条：它几乎是平的——说明那些跳动大部分是"星期几"造成的，' +
          '不是用户真的在流失又回来。这就是移动平均的作用：' +
          '把噪声和周期一起抹掉，只留下趋势。'
        }
      >
        <div className="px-2 pb-1">
          <ResponsiveContainer width="100%" height={260}>
            <LineChart data={daily} margin={{ top: 8, right: 16, bottom: 4, left: 0 }}>
              <CartesianGrid stroke={CHART_INK.grid} vertical={false} />
              <XAxis
                dataKey="date"
                tick={{ fill: CHART_INK.tick, fontSize: 10.5 }}
                tickLine={false}
                axisLine={{ stroke: CHART_INK.axis }}
                interval={9}
                tickFormatter={(d: string) => d.slice(5)}
              />
              <YAxis
                domain={['dataMin - 300', 'dataMax + 300']}
                tick={{ fill: CHART_INK.tick, fontSize: 11 }}
                tickLine={false}
                axisLine={false}
                width={52}
                tickFormatter={(v: number) => formatCount(v)}
              />
              <Tooltip content={<ChartTooltip valueFormatter={(v) => `${withThousands(Math.round(v))} 人`} />} />
              <Line
                type="monotone"
                dataKey="dau"
                name="当日 DAU"
                stroke="#bcd4f2"
                strokeWidth={1.6}
                dot={false}
              />
              <Line
                type="monotone"
                dataKey="dauSmooth7"
                name="7 日移动平均"
                stroke={SERIES_PRIMARY}
                strokeWidth={2.4}
                dot={false}
                connectNulls={false}
              />
            </LineChart>
          </ResponsiveContainer>
        </div>
      </ChartCard>

      {/* 周末效应 vs 构造参数 */}
      <ChartCard
        title="把 DAU 按星期几分组：周末到底高多少"
        subtitle="用移动平均去掉随机波动之后，再按星期几求均值，得到的就是纯的「星期效应」"
        meta="倍数：相对工作日"
        table={
          <DataTable
            columns={[
              { key: 'label', label: '日期类型', align: 'left' },
              { key: 'days', label: '天数', align: 'right' },
              { key: 'avgDau', label: '平均 DAU', align: 'right' },
              { key: 'ratioToWeekday', label: '相对工作日', align: 'right', bar: true },
            ]}
            rows={trend.dowEffect.map((d) => ({
              label: d.label,
              days: d.days,
              avgDau: Math.round(d.avgDau),
              ratioToWeekday: Number(d.ratioToWeekday.toFixed(4)),
            }))}
            maxHeight={200}
          />
        }
        note="周末实测 1.1839 倍，而生成数据时设的参数是 1.18——这一步就是「用数据反查构造参数」。"
      >
        <div className="px-2 pb-1">
          <ResponsiveContainer width="100%" height={180}>
            <BarChart data={bars} margin={{ top: 10, right: 24, bottom: 4, left: 0 }}>
              <CartesianGrid stroke={CHART_INK.grid} vertical={false} />
              <XAxis
                dataKey="label"
                tick={{ fill: CHART_INK.tick, fontSize: 11 }}
                tickLine={false}
                axisLine={{ stroke: CHART_INK.axis }}
              />
              <YAxis
                domain={[0.9, 1.25]}
                tick={{ fill: CHART_INK.tick, fontSize: 11 }}
                tickLine={false}
                axisLine={false}
                width={50}
                tickFormatter={(v: number) => `${v.toFixed(2)}×`}
              />
              <Tooltip
                cursor={{ fill: 'rgba(42,120,214,0.06)' }}
                content={<ChartTooltip valueFormatter={(v) => `${v.toFixed(4)} 倍`} />}
              />
              <Bar
                dataKey="ratio"
                name="相对工作日"
                radius={[3, 3, 0, 0]}
                barSize={72}
                label={{ position: 'top', fontSize: 11, fill: CHART_INK.value }}
              />
            </BarChart>
          </ResponsiveContainer>
        </div>
      </ChartCard>

      <ConstructorCompare py={py} />
    </>
  )
}

/**
 * 实测值 vs 构造参数。
 *
 * ★ 这一小块是整个项目里唯一一处「用数据反查我设的参数」的地方，
 *   也是"相关不等于因果"最好的落点：我能确定这条规律是设定出来的，
 *   是因为**我知道它是我自己拧上去的**。
 *
 * 设定值故意写在这里而不是从 dataset.ts 里 import：
 *   如果 import 进来，那就是拿参数去比参数，什么也证明不了。
 *   写在这里，读者可以自己去 dataset.ts 里核对。
 */
function ConstructorCompare({ py }: { py: PyResults }) {
  const trend = py.trend
  const find = (g: string) => trend.dowEffect.find((d) => d.group === g)
  const weekend = find('weekend')
  const friday = find('friday')

  const rows = [
    {
      label: '周末',
      set: 1.18,
      actual: weekend?.ratioToWeekday ?? 0,
      days: weekend?.days ?? 0,
    },
    {
      label: '周五',
      set: 1.06,
      actual: friday?.ratioToWeekday ?? 0,
      days: friday?.days ?? 0,
    },
  ]

  return (
    <section className="rounded-lg border border-hairline bg-plane/40 px-3.5 py-3">
      <p className="text-[11px] font-semibold text-ink-3">
        实测值 vs 构造参数（参数写在 dataset.ts 的 DOW_MULTIPLIER 里）
      </p>
      <div className="mt-2 overflow-x-auto">
        <table className="border-collapse text-[11.5px]">
          <thead>
            <tr>
              {['日期类型', '样本天数', '我设的值', '实测值', '偏差'].map((h) => (
                <th
                  key={h}
                  scope="col"
                  className="whitespace-nowrap border-b border-hairline/70 px-3 py-1.5 text-left font-semibold text-ink-2"
                >
                  {h}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => {
              const diff = r.actual - r.set
              return (
                <tr key={r.label}>
                  <td className="border-b border-hairline/50 px-3 py-1.5 text-ink">{r.label}</td>
                  <td className="border-b border-hairline/50 px-3 py-1.5 tabular-nums text-ink-2">
                    {r.days} 天
                  </td>
                  <td className="border-b border-hairline/50 px-3 py-1.5 tabular-nums text-ink-2">
                    {r.set.toFixed(2)}×
                  </td>
                  <td className="border-b border-hairline/50 px-3 py-1.5 font-semibold tabular-nums text-ink">
                    {r.actual.toFixed(4)}×
                  </td>
                  <td className="border-b border-hairline/50 px-3 py-1.5 tabular-nums text-ink-2">
                    {diff >= 0 ? '+' : ''}
                    {diff.toFixed(4)}
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>
      <p className="mt-2 text-[11px] leading-relaxed text-ink-3">
        周末这条对得很准（1.1839 对 1.18），周五这条差了{' '}
        <span className="tabular-nums">0.0125</span>。原因不神秘：全部{' '}
        {py.manifest.days} 天里只有 {friday?.days ?? 0} 个周五，样本小，
        单天的随机波动就能把均值拉偏。
        <span className="font-medium text-ink-2">
          这个偏差我没有去修饰，也没有回头调参数让它对上
        </span>
        ——它是这份数据真实的样子。
      </p>
    </section>
  )
}

/* ==========================================================================
   模块 9：对账面板
   ========================================================================== */

function ReconcilePanel({
  report,
  days,
}: {
  report: ReturnType<typeof getReconcileReport>
  /** 当前选中的时间窗口。只影响这一块显示的粒度 */
  days: number
}) {
  /* ★ 只显示「与当前窗口有关」的那一组窗口对账。
     三组窗口对账（7 / 14 / 30）本来就都算出来了，但一口气摆出来，
     读者会分不清哪些数字属于哪个窗口 —— 而上面那排 7/14/30 按钮
     如果只改一行说明文字、表格纹丝不动，那按钮就是骗人的。 */
  const shown = report.groups.filter((g) => !g.title.startsWith('近 ') || g.title === `近 ${days} 天窗口`)
  const total = shown.reduce((a, g) => a + g.total, 0)
  const mismatches = shown.reduce((a, g) => a + (g.total - g.okCount), 0)
  const allOk = mismatches === 0

  return (
    <section className="rounded-xl border border-hairline bg-card">
      <header className="flex flex-wrap items-center gap-x-3 gap-y-1.5 border-b border-hairline px-5 py-3.5">
        <h3 className="text-[13px] font-semibold text-ink">逐项对账</h3>
        <span
          className="rounded px-2 py-0.5 text-[11.5px] font-semibold"
          style={{
            color: allOk ? STATUS_COLOR.up : STATUS_COLOR.down,
            background: allOk ? 'rgba(12,163,12,0.08)' : 'rgba(208,59,59,0.08)',
          }}
        >
          {allOk ? `共 ${total} 项，全部一致` : `共 ${total} 项，${mismatches} 项不一致`}
        </span>
        <span className="ml-auto text-[11px] text-ink-3">
          Python 算的 vs 前端 metrics.ts 算的
        </span>
      </header>

      <div className="px-5 py-4">
        <p className="text-[12px] leading-relaxed text-ink-2">
          这个项目里，同一批口径被实现了两遍：一遍在{' '}
          <code className="font-mono">src/data/metrics.ts</code>（给前五个页面用），
          一遍在 <code className="font-mono">scripts/analyze.py</code>（给这一页用）。
          两边没有任何机制保证一致——靠的是照同一份口径写两遍，而写两遍就会写错第二遍。
        </p>
        <p className="mt-1.5 text-[12.5px] leading-relaxed text-ink-2">
          所以这里当场把每一个数字都比一遍。
          <span className="font-medium text-ink">
            第一次跑这个检查时，它真抓出了一个 bug：
          </span>
          分年龄段的日均 DAU 忘了除以天数，整整大了 7 倍。
          那个数看着完全合理，肉眼绝对发现不了——是对账逼出来的。
        </p>

        {/* 分组明细 */}
        <div className="mt-3 flex flex-col gap-2">
          {shown.map((g) => {
            const ok = g.okCount === g.total
            return (
              <details key={g.title} className="rounded-lg border border-hairline">
                <summary className="flex cursor-pointer flex-wrap items-center gap-x-2.5 gap-y-1 list-none px-3.5 py-2.5">
                  <span
                    className="h-2 w-2 shrink-0 rounded-full"
                    style={{ background: ok ? STATUS_COLOR.up : STATUS_COLOR.down }}
                    aria-hidden="true"
                  />
                  <span className="text-[12px] font-semibold text-ink">{g.title}</span>
                  <span className="text-[11px] text-ink-3">{g.hint}</span>
                  <span className="ml-auto tabular-nums text-[11.5px] font-medium" style={{ color: ok ? STATUS_COLOR.up : STATUS_COLOR.down }}>
                    {ok ? `${g.total} 项一致` : `${g.total - g.okCount} 项不一致`}
                  </span>
                </summary>
                <div className="border-t border-hairline px-3.5 py-2.5">
                  <div className="max-h-[300px] overflow-auto">
                    <table className="w-full border-collapse text-[11.5px]">
                      <thead className="sticky top-0 bg-plane">
                        <tr>
                          {['项目', 'Python', '前端'].map((h) => (
                            <th
                              key={h}
                              scope="col"
                              className="whitespace-nowrap border-b border-hairline px-3 py-1.5 text-left font-semibold text-ink-2"
                            >
                              {h}
                            </th>
                          ))}
                        </tr>
                      </thead>
                      <tbody>
                        {g.items.map((it) => {
                          const good = itemOk(it)
                          return (
                            <tr key={it.label} className="odd:bg-card even:bg-plane/40">
                              <td className="whitespace-nowrap border-b border-hairline/50 px-3 py-1 text-ink">
                                {good ? '' : '✗ '}
                                {it.label}
                              </td>
                              <td
                                className="whitespace-nowrap border-b border-hairline/50 px-3 py-1 tabular-nums"
                                style={{ color: good ? undefined : STATUS_COLOR.down }}
                              >
                                {formatNum(it.py)}
                              </td>
                              <td className="whitespace-nowrap border-b border-hairline/50 px-3 py-1 tabular-nums text-ink-2">
                                {formatNum(it.ts)}
                              </td>
                            </tr>
                          )
                        })}
                      </tbody>
                    </table>
                  </div>
                </div>
              </details>
            )
          })}
        </div>

        {/* 没对账的 */}
        <div className="mt-4 rounded-lg border border-hairline bg-plane/40 px-3.5 py-3">
          <p className="text-[11px] font-semibold text-ink-3">
            下面这些项目<b>没有</b>对账，原因如实列出
          </p>
          <ul className="mt-2 flex flex-col gap-1.5">
            {report.notCompared.map((n) => (
              <li key={n.item} className="text-[11.5px] leading-relaxed">
                <span className="font-medium text-ink">{n.item}</span>
                <span className="text-ink-2"> — {n.reason}</span>
              </li>
            ))}
          </ul>
          <p className="mt-2 text-[11px] leading-relaxed text-ink-3">
            主动说清「哪些没对账」，比笼统宣称「全部一致」可信得多。
            上面那两个数（{total} 项 / {mismatches} 项不一致）只覆盖它真正比过的东西。
          </p>
          <p className="mt-1.5 text-[11px] leading-relaxed text-ink-3">
            ★ 关于时间窗口：三个窗口（7 / 14 / 30 天）的核对
            <span className="font-medium text-ink-2">全部都已经算过</span>
            ，上面那排按钮只是切换显示哪一个。
            三个窗口全加起来是 {report.total} 项、{report.mismatches} 项不一致；
            当前选中的是 {total} 项。之所以要三个都查，是因为
            <span className="font-medium text-ink-2">
              口径写错时，错误常常只在某个窗口长度下才暴露
            </span>
            ——比如少乘一个天数，7 天窗口和三周窗口的表现就不一样。
          </p>
        </div>
      </div>
    </section>
  )
}

/** 对账表里的数字：整数不加小数点，浮点保留 4 位（和 Python 侧的精度一致） */
function formatNum(v: number): string {
  return Number.isInteger(v) ? withThousands(v) : v.toFixed(4)
}

/* ==========================================================================
   分工边界表：Python 做了哪些 SQL 做不了的事
   ========================================================================== */

const DIVISION: { task: string; sql: string; python: string }[] = [
  {
    task: '移动平均、日环比',
    sql: '没有现成函数，要用自连接或窗口函数写好几层',
    python: 'rolling(7).mean() / pct_change()，一行',
  },
  {
    task: '相关系数',
    sql: '要手写协方差除以两个标准差，而且只能得到线性相关',
    python: 'corr()，一行；还能换 spearman / kendall',
  },
  {
    task: '等频分箱（按分位数自动定边界）',
    sql: '要用 NTILE 窗口函数，或者先算分位数再写一堆 CASE WHEN',
    python: 'qcut(q=4)，一行，边界自动算',
  },
  {
    task: '向量相似度（余弦）',
    sql: '要把 8 个分区的乘加项全部展开写成一行表达式',
    python: '矩阵乘一下，或者 scipy 一行',
  },
  {
    task: '数据体检',
    sql: '能做，但要为每种检查写一条独立查询',
    python: 'isna / duplicated / describe 串起来一次跑完',
  },
  {
    task: '画图',
    sql: '结果只能是表，要看图得把数据导出去',
    python: '可以接着画（本项目是用前端图表库画的，见上面各模块）',
  },
]

function DivisionTable() {
  return (
    <section className="rounded-xl border border-hairline bg-card">
      <header className="flex flex-wrap items-center gap-x-2.5 border-b border-hairline px-5 py-3">
        <h3 className="text-[13px] font-semibold text-ink">这一页和 SQL 分析页的分工</h3>
        <span className="text-[11.5px] text-ink-3">
          只挑 SQL 做不了、或者做起来很别扭的事做，不重复 SQL 已经做过的分析
        </span>
      </header>
      <div className="overflow-x-auto">
        <table className="w-full min-w-[640px] border-collapse text-[11.5px]">
          <thead className="bg-plane">
            <tr>
              {['分析任务', '用 SQL 怎么做', '用 Pandas 怎么做'].map((h) => (
                <th
                  key={h}
                  scope="col"
                  className="border-b border-hairline px-3.5 py-2 text-left font-semibold text-ink-2"
                >
                  {h}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {DIVISION.map((d) => (
              <tr key={d.task} className="border-b border-hairline/60 last:border-b-0">
                <td className="px-3.5 py-2 align-top font-medium text-ink">{d.task}</td>
                <td className="px-3.5 py-2 align-top text-ink-3">{d.sql}</td>
                <td className="px-3.5 py-2 align-top text-ink-2">{d.python}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="border-t border-hairline px-5 py-2.5 text-[11px] leading-relaxed text-ink-3">
        ★ 有一件事<b>故意没有做</b>：「年龄段 × 内容分区」的偏好交叉分析。
        那个交叉在本项目里已经实现过两次（用户分析页一次、SQL 案例 06 和 09 各一次），
        再用 Pandas 做第三遍是纯粹的重复劳动。
        所以这里换成了「活跃分层 × 分区」和「年龄段口味的余弦相似度」两个新角度。
      </p>
    </section>
  )
}

/* ==========================================================================
   业务洞察
   ========================================================================== */

interface Insight {
  title: string
  finding: string
  hypothesis: string
  action: string
}

/**
 * 洞察文字全部由真实结果拼出来。
 * ★ 「原因假设」那一栏必须指向构造参数，不能写成"因为用户在周末有空"这种
 *   听起来合理、实际没有证据的话 —— 那是把相关性说成了因果。
 */
function buildInsights(py: PyResults): Insight[] {
  const tiers = py.tiers
  const top = tiers[tiers.length - 1]
  const bottom = tiers[0]
  const weekend = py.trend.dowEffect.find((d) => d.group === 'weekend')
  const content = py.content
  const cross = py.cross
  const sims = cross.preferenceSimilarity
  const leastAlike = sims.reduce((a, b) => (b.cosine < a.cosine ? b : a))

  return [
    {
      title: '观看时长高度集中在少数用户手里',
      finding:
        `按人均每日观看分钟数四等分之后，最高的一档（${top.users.toLocaleString('zh-CN')} 人）` +
        `贡献了全部观看时长的 ${top.minutesShare.toFixed(1)}%，` +
        `最低的一档只贡献 ${bottom.minutesShare.toFixed(1)}%。` +
        `四档人数完全一样，所以这是纯粹的行为差异。`,
      hypothesis:
        `这份数据里的"活跃程度"是生成时按 BASE_ACTIVITY 这个参数给每个年龄段设了` +
        `「每天打开 App 的基础概率」造出来的，用户之间本来就被设定成有强弱之分。` +
        `真实业务里的集中度通常比这更高（长尾更陡），但这份数据证明不了那一点。`,
      action:
        '如果这个结构成立，运营资源应该按贡献而不是按人数分配：' +
        '最高那一档要用「防流失」的思路维护（他们掉一个的损失远大于普通用户），' +
        '最低那一档的问题不是"推荐什么内容"，而是"还没养成打开习惯"，' +
        '抓手应该放在提升打开频次上，而不是优化内容推荐。',
    },
    {
      title: '完播率低，不是视频太长造成的',
      finding:
        `视频时长和完播率的相关系数是 r = ${content.durationCompletionR.toFixed(3)}，` +
        `几乎不相关。中位时长最长和最短的两个分区，时长差了好几倍，` +
        `完播率却没有拉开相应差距。`,
      hypothesis:
        `生成数据时，每个分区的内容完成度由 COMPLETION_FACTOR 单独设定，` +
        `和时长（CATEGORY_DURATION）是两个独立的参数。` +
        `所以「时长不影响完播」是构造出来的结果，不能当作现实结论。`,
      action:
        '这个方向的价值在于它否掉了一个很容易被当成理所当然的假设：' +
        '如果一看到完播率低就去砍视频时长，可能付出很大代价却毫无效果。' +
        '下一步应该去查内容本身——同一时长档位里不同分区的完播率差异，' +
        '以及完播率低的分区互动率是不是也低。',
    },
    {
      title: '周末效应是真的，而且是周期性的，不是增长',
      finding:
        `把 DAU 做 7 日移动平均抹掉随机波动之后按星期几分组：` +
        `周末是工作日的 ${weekend ? weekend.ratioToWeekday.toFixed(4) : '—'} 倍。` +
        `而平滑后的整体曲线几乎是平的。`,
      hypothesis:
        `这个倍率对得上生成数据时设的 DOW_MULTIPLIER（周末 1.18）——` +
        `我能确定它是"设定出来的"，因为我知道它是我自己拧上去的。` +
        `现实中同样的图只能说明相关性，原因需要别的证据。`,
      action:
        '看任何日粒度指标都要先把星期效应剥掉再判断趋势：' +
        '周五涨了不等于活动成功，周一跌了也不等于用户流失。' +
        '另外，周末抬升明显意味着容量和运营排期应该按星期错峰，' +
        '而不是按日均值平均分配。',
    },
    {
      title: '不同活跃程度的用户看的内容不一样，推荐不能一刀切',
      finding:
        `最高活跃档最偏爱的分区和最低档不一样（见第 07 个案例的热力图），` +
        `说明"按活跃度分层做推荐"是有意义的。` +
        `同时各年龄段的口味相似度差异明显：最不像的是 ${leastAlike.a} 和 ${leastAlike.b}，` +
        `余弦相似度只有 ${leastAlike.cosine.toFixed(3)}。`,
      hypothesis:
        `每个年龄段的每个分区偏好，在生成数据时都是 CATEGORY_PREFERENCE 里` +
        `单独设的 32 个权重之一。所以"某两群人偏好不同"是设出来的，不是发现的。`,
      action:
        '如果结构成立，内容分发不应该只按人群规模分配：' +
        '只按"哪个年龄段人多"来决定推荐什么，会漏掉最活跃那部分用户的口味，' +
        '而恰恰是他们贡献了最多的观看时长。' +
        `另外，相似度高的年龄段可以共用一套内容策略，把省下的力气集中在差异最大的那一组（${leastAlike.a} / ${leastAlike.b}）上。`,
    },
  ]
}

/* ==========================================================================
   陈旧警告横幅
   ========================================================================== */

function StaleBanner({
  issues,
  computedHash,
}: {
  issues: { field: string; py: string | number; actual: string | number; hint: string }[]
  computedHash: string
}) {
  return (
    <section className="rounded-xl border border-down/40 bg-down/5 px-5 py-4">
      <header className="flex flex-wrap items-center gap-x-2.5 gap-y-1">
        <h2 className="text-[13px] font-semibold text-[#d03b3b]">
          ⚠️ 这份 Python 结果文件已经过期
        </h2>
        <span className="rounded bg-down/10 px-1.5 py-0.5 text-[10.5px] font-semibold text-[#d03b3b]">
          下面的数字不可信
        </span>
      </header>

      <p className="mt-2 text-[12px] leading-relaxed text-ink-2">
        结果文件是离线跑出来、写死在硬盘上的。数据或脚本变了、却没有重跑，
        页面就会理直气壮地显示一套和数据对不上的旧数字——不报错、没有脏字符、
        图表画得好好的，只是全错。所以这里主动查了一次，查出下面几处对不上：
      </p>

      <div className="mt-2.5 overflow-x-auto rounded-lg border border-hairline bg-card">
        <table className="w-full min-w-[560px] border-collapse text-[11.5px]">
          <thead className="bg-plane">
            <tr>
              {['对不上的地方', '结果文件里记的', '当前项目的真值', '说明'].map((h) => (
                <th
                  key={h}
                  scope="col"
                  className="border-b border-hairline px-3 py-2 text-left font-semibold text-ink-2"
                >
                  {h}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {issues.map((it) => (
              <tr key={it.field} className="border-b border-hairline/60 last:border-b-0">
                <td className="px-3 py-1.5 font-mono text-[11px] text-ink">{it.field}</td>
                <td className="px-3 py-1.5 tabular-nums text-ink-2">{String(it.py)}</td>
                <td className="px-3 py-1.5 font-medium tabular-nums text-ink">{String(it.actual)}</td>
                <td className="px-3 py-1.5 text-ink-3">{it.hint}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <p className="mt-2.5 text-[12px] leading-relaxed text-ink-2">
        重新跑一次就好：
        <code className="ml-1 rounded bg-plane px-1.5 py-0.5 font-mono text-[11.5px]">
          npm run data:refresh
        </code>
        <span className="ml-2 text-ink-3">
          （当前 analyze.py 的指纹是 <code className="font-mono">{computedHash}</code>）
        </span>
      </p>

      <p className="mt-1.5 text-[11px] leading-relaxed text-ink-3">
        在重跑之前，这一页最下面的对账块会被隐藏——对账的前提是"两边读的是同一份数据"，
        这个前提不成立时，把对比结果摆出来只会误导人。
      </p>
    </section>
  )
}

/* ==========================================================================
   业务洞察的一行（发现 / 原因假设 / 业务建议）
   ========================================================================== */

function InsightRow({
  label,
  tone,
  children,
}: {
  label: string
  tone: 'fact' | 'guess' | 'action'
  children: ReactNode
}) {
  /* 三种底色区分"事实/假设/建议"。颜色不同，但左边的文字标签才是主要区分方式
     —— 不靠颜色单独传递信息。 */
  const style =
    tone === 'fact'
      ? { background: 'rgba(12,163,12,0.06)', color: '#0a7d0a' }
      : tone === 'guess'
        ? { background: 'rgba(237,161,0,0.10)', color: '#8a5f00' }
        : { background: 'rgba(42,120,214,0.08)', color: '#1c5cab' }

  return (
    <div className="flex flex-col gap-1 sm:flex-row sm:gap-2.5">
      <dt
        className="h-fit w-fit shrink-0 rounded px-2 py-0.5 text-[11px] font-semibold"
        style={style}
      >
        {label}
      </dt>
      <dd className="text-[12.5px] leading-relaxed text-ink-2">{children}</dd>
    </div>
  )
}
