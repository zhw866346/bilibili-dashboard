/* ==========================================================================
   Agent 运行器 —— 把一句话问题跑成一条可追溯的分析链
   --------------------------------------------------------------------------
   分成两半，因为其中一半是同步的、另一半要等好几秒：

     planAgent(question)        同步，毫秒级
       → 理解问题、定计划、选工具、把要跑的 SQL 准备好
       → 页面可以立刻把前三步画出来

     runAgentPlan(plan, …)      异步，建库 + 跑查询要 3–5 秒
       → 真跑 SQL、读离线 Pandas 结果、拼结论
       → 有进度回调，页面能显示「正在建数据库 42%」

   ★ 为什么不在前三步里加一点「思考中的…」延迟？
     因为那三步本来就是瞬间完成的。硬加等待是表演，不是能力。
     这个页面要证明的是「分析链路是真的」，不是「看起来像在思考」。

   ★ 两个依赖都以接口形式注入：
     resolver  —— 问题怎么理解（现在只有规则引擎，将来可换大模型）
     executor  —— SQL 在哪儿跑（默认真数据库；测试时可以不传）
     这样这个文件既不懂 sql.js，也不懂 Recharts，能单独被脚本调用和断言。
   ========================================================================== */

import { avgMinutesPerUser, activeRate } from '../metrics'
import { PY_RESULTS } from '../python/results.generated'
import { getWindowPair } from '../selectors'
import { formatMs } from '../../utils/format'
import type { BuildProgress } from '../sql/engine'
import { engineFailureNote, getEngineError, getSharedSqlEngine, toRows } from './engine'
import { fallbackIntent, INTENT_BY_ID } from './intents'
import { ruleBasedResolver } from './matcher'
import type {
  AgentPlan,
  AgentTrace,
  AnalysisData,
  CrossCheck,
  IntentResolver,
  MetricPair,
  QueryContext,
  SqlExecutor,
  SqlOutcome,
  SqlQuerySpec,
  StepStatus,
  TraceStep,
} from './types'

export interface PlanOptions {
  /** 时间窗口天数，默认 30 */
  days?: number
  /** 问题理解器，默认本地关键词规则 */
  resolver?: IntentResolver
}

export interface RunOptions {
  /** 建库进度回调 */
  onProgress?: (p: BuildProgress) => void
  /** 每完成一步就回调一次，页面可以逐步渲染 */
  onStep?: (steps: TraceStep[]) => void
  /**
   * 注入的 SQL 执行器。三种写法含义不同，看仔细：
   *
   *   不写这个字段   → 浏览器里的正常路径：自己起 Worker（不行就退回主线程）建库
   *   写 null        → 明确的「这台机器没有数据库可用」，直接走降级分支
   *   写一个执行器   → 用调用方给的库（命令行体检脚本走这条，用的是同一个 sql.js）
   *
   * ★ 为什么不能用 `?? ` 来偷懒：`null ?? 正常路径` 会退回正常路径，
   *   「没有数据库」这个分支就永远进不去、也永远测不到。
   *   所以下面必须用 `'executor' in options` 来区分「没写」和「写了 null」。
   */
  executor?: SqlExecutor | null
  /**
   * ★ 这次走的是哪条路。
   *
   *   默认 'rule'（这就是那条规则路径）。
   *   页面在 `file://` 下打开时会传 'static' —— 那种情况下跑的【确实是】
   *   规则路径，但用户该做的事不是「去启动后端」，而是「换个方式打开」，
   *   所以顶部横幅必须说 'static'。
   *   这一条只影响【显示】，不影响任何执行逻辑。
   */
  mode?: AgentTrace['mode']
}

/* --------------------------------------------------------------------------
   一、步骤定义
   -------------------------------------------------------------------------- */

const STEP_TITLES: { key: TraceStep['key']; title: string }[] = [
  { key: 'understand', title: '理解问题' },
  { key: 'plan', title: '制定分析计划' },
  { key: 'tools', title: '选择工具' },
  { key: 'execute', title: '执行分析' },
  { key: 'result', title: '得到分析结果' },
  { key: 'insight', title: '输出业务洞察' },
  { key: 'confidence', title: '标注分析可信度' },
]

function freshSteps(): TraceStep[] {
  return STEP_TITLES.map((s, i) => ({
    no: i + 1,
    key: s.key,
    title: s.title,
    summary: '',
    status: 'pending' as StepStatus,
  }))
}

/* --------------------------------------------------------------------------
   二、制定计划（同步）
   -------------------------------------------------------------------------- */

/**
 * 把一句问题变成一份可执行的分析计划。
 * ★ 这个过程是同步的，因为它确实不花时间——不是假装很快。
 */
export function planAgent(question: string, options: PlanOptions = {}): AgentPlan {
  const days = options.days ?? 30
  const resolver = options.resolver ?? ruleBasedResolver

  /* ① 理解问题 */
  const match = resolver.resolve(question)
  const intent = INTENT_BY_ID[match.intentId] ?? fallbackIntent

  const pair = getWindowPair(days)
  const { startDate, endDate } = pair.current

  const warnings: string[] = []

  /*
    ② 准备要跑的 SQL

    ★ 关于 depthThresholdMinutes = 0：
      这个门槛只有 SQL 分析页的案例 08（高价值组合筛选）才用得到，
      而算它要调 getUserContentAnalytics()，是约 500ms 的同步开销，
      放在首屏会造成明显的卡顿（Python 页专门为同一个问题把对账推迟到 useEffect 里）。
      本页引用的几条 SQL 都不含这个门槛，所以传 0，
      由本机检查保证「引用了门槛的案例」不会悄悄溜进来。
  */
  const ctx: QueryContext = { startDate, endDate, days, depthThresholdMinutes: 0 }
  let queries: SqlQuerySpec[] = []
  try {
    /* ★ 第二个参数 match 是给「要跟着问题里的人群走」的意图用的
       （比如 agePreference：问 40 岁以上就要查 40 岁以上那一档）。
       只吃 ctx 的老意图照旧不受影响——第二个参数在类型上是可选的。 */
    queries = intent.queries(ctx, match)
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e)
    warnings.push(`准备 SQL 时出错，本次不执行查询：${message}`)
    queries = []
  }

  /* ③ 把三步的结论写进时间轴 */
  const slots = intent.slots(match)
  const planSteps = intent.plan(match)
  const tools = intent.tools

  const steps = freshSteps()
  steps[0] = {
    ...steps[0],
    status: 'done',
    summary: match.unmatched
      ? `没有匹配到已实现的分析类型，已按通用概览处理`
      : `识别为「${intent.analysisType}」`,
  }
  steps[1] = {
    ...steps[1],
    status: 'done',
    summary: `${planSteps.length} 步：${planSteps.map((p) => p.title).join(' → ')}`,
  }
  const liveTools = tools.filter((t) => t.mode === 'live').length
  const offlineTools = tools.filter((t) => t.mode === 'offline').length
  steps[2] = {
    ...steps[2],
    status: 'done',
    summary:
      `SQL（浏览器本地真执行）× ${liveTools}，` +
      `Python / Pandas（读取离线运行结果）× ${offlineTools}`,
  }
  steps[3] = { ...steps[3], status: 'running', summary: '正在准备数据库…' }

  return {
    question,
    days,
    startDate,
    endDate,
    match,
    intent,
    slots,
    planSteps,
    tools,
    charts: intent.charts,
    queries,
    pyCaseIds: intent.pyCaseIds,
    steps,
    warnings,
  }
}

/* --------------------------------------------------------------------------
   三、执行计划（异步）
   -------------------------------------------------------------------------- */

function pct(current: number, previous: number): number | undefined {
  if (!Number.isFinite(previous) || previous <= 0) return undefined
  return ((current - previous) / previous) * 100
}

function pair(current: number, previous: number): MetricPair {
  return { current, previous, deltaPct: pct(current, previous) }
}

/**
 * 把当前窗口的真实数字收集成模板唯一允许读取的那份数据。
 *
 * ★ 导出给 llm/loop.ts 用。大模型路径【必须】和规则路径读同一份窗口指标 ——
 *   抄一份过去的话，两条路给出的「近 30 天 DAU」迟早对不上，
 *   而且对不上时不报错，只是同一页面上出现两个数。
 */
export function buildAnalysisData(
  plan: AgentPlan,
  outcomes: SqlOutcome[],
  crossChecks: CrossCheck[],
): AnalysisData {
  const { current, previous } = getWindowPair(plan.days)
  const days = plan.days

  return {
    days,
    startDate: plan.startDate,
    endDate: plan.endDate,
    metrics: {
      dau: pair(current.dau, previous.dau),
      activeUsers: pair(current.activeUsers, previous.activeUsers),
      avgMinutes: pair(
        avgMinutesPerUser(current.totalSeconds, current.dau, days),
        avgMinutesPerUser(previous.totalSeconds, previous.dau, days),
      ),
      totalViews: pair(current.totalViews, previous.totalViews),
      activeRate: pair(
        activeRate(current.dau, current.totalUsers),
        activeRate(previous.dau, previous.totalUsers),
      ),
      newUsersInWindow: current.newUsersInWindow,
    },
    outcomes,
    py: PY_RESULTS,
    crossChecks,
    /* ★ 把「这次问的是哪一档人」交给模板和图表。
       这里【不写默认值】—— 默认只在 intents.ts 的 DEFAULT_FOCUS_AGE 一处落地。 */
    focusAge: plan.match.entities.ageGroup,
  }
}

/**
 * 执行一份计划，产出完整的分析轨迹。
 *
 * ★ 任何一个环节失败都不会抛出去——失败会被记成步骤状态和 warnings，
 *   页面照样有东西可显示，并且如实说明哪一步没成。白屏是最差的失败方式。
 */
export async function runAgentPlan(
  plan: AgentPlan,
  options: RunOptions = {},
): Promise<AgentTrace> {
  const steps = plan.steps.map((s) => ({ ...s }))
  const warnings = [...plan.warnings]

  const emit = () => options.onStep?.(steps.map((s) => ({ ...s })))

  /* ---- 第 4 步：执行 ---- */
  const outcomes: SqlOutcome[] = []
  let engineMode: AgentTrace['engineMode'] = 'none'

  if (plan.queries.length === 0) {
    steps[3] = {
      ...steps[3],
      status: 'skipped',
      summary: '本次没有需要执行的 SQL',
      note: plan.intent.id === 'generic' ? '没有匹配到专门的分析类型，所以不跑新查询。' : undefined,
    }
    emit()
  } else {
    const client =
      'executor' in options
        ? (options.executor ?? null)
        : await getSharedSqlEngine(options.onProgress)

    if (!client) {
      /* ★ 引擎起不来的【真实原因】写进轨迹，而不是只写一句笼统的话。
         以前这里写死了「浏览器不支持 WebAssembly、或内存不足」——那是一句猜测，
         而 engine.ts 明明把真正的报错记下来了（getEngineError），却从来没人读它。
         写进轨迹还有一个好处：页面只负责渲染，命令行脚本可以逐字断言。 */
      const reason = getEngineError()

      steps[3] = {
        ...steps[3],
        status: 'error',
        summary: '数据库没有启动起来，本次没有真的执行 SQL',
        note: engineFailureNote(reason),
      }
      warnings.push('数据库引擎启动失败，本次分析没有真实执行 SQL。')
      for (const spec of plan.queries) {
        outcomes.push({
          spec,
          status: 'error',
          rows: [],
          rowCount: 0,
          ms: 0,
          error: reason ? `数据库未启动：${reason}` : '数据库未启动',
        })
      }
    } else {
      engineMode = client.mode
      // 一条一条顺序跑。数据库只有一个，并发没有意义；
      // 顺序执行还能让结果依次出现，而不是最后一起蹦出来。
      for (const spec of plan.queries) {
        try {
          const result = await client.exec(spec.sql)
          outcomes.push({
            spec,
            status: 'done',
            rows: toRows(result),
            rowCount: result.rows.length,
            ms: result.ms,
          })
        } catch (e) {
          const message = e instanceof Error ? e.message : String(e)
          outcomes.push({ spec, status: 'error', rows: [], rowCount: 0, ms: 0, error: message })
          warnings.push(`「${spec.label}」执行失败：${message}`)
        }
      }

      const done = outcomes.filter((o) => o.status === 'done')
      const slowest = done.reduce((a, b) => (b.ms > a.ms ? b : a), done[0])
      steps[3] = {
        ...steps[3],
        status: done.length === 0 ? 'error' : 'done',
        summary:
          done.length === 0
            ? `${outcomes.length} 条 SQL 全部执行失败`
            : `真跑了 ${done.length} 条 SQL，共返回 ${done.reduce((s, o) => s + o.rowCount, 0)} 行` +
              (slowest ? `，最慢的一条 ${formatMs(slowest.ms)} ms` : ''),
        note:
          engineMode === 'main'
            ? '数据库跑在主线程上（浏览器不允许开后台线程时会这样，比如把 dist/index.html 直接双击打开），功能完整，只是查询时会短暂卡顿。'
            : undefined,
      }
      emit()
    }
  }

  /* ---- 交叉验证：SQL 和 Python 算同一个数，看对不对得上 ---- */
  const crossChecks: CrossCheck[] = []
  for (const o of outcomes) {
    if (o.status !== 'done' || !o.spec.crossCheck) continue
    const check = o.spec.crossCheck(o.rows, PY_RESULTS, plan.days)
    /* 一条 SQL 可以挂多条检查（数组），也可以只挂一条，也可以因为取不到数据返回 null */
    if (Array.isArray(check)) crossChecks.push(...check)
    else if (check) crossChecks.push(check)
  }

  /* ---- 第 5–7 步：结果、洞察、可信度 ---- */
  const data = buildAnalysisData(plan, outcomes, crossChecks)

  let verdict = plan.intent.fallback
  let evidenceCount = 0
  let insightCount = 0
  try {
    verdict = plan.intent.verdict(data)
    evidenceCount = plan.intent.evidence(data).length
    insightCount = plan.intent.insight(data).length
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e)
    warnings.push(`生成结论时出错：${message}`)
  }

  steps[4] = {
    ...steps[4],
    status: 'done',
    summary: `整理了 ${evidenceCount} 项数据依据，覆盖当前窗口与上一周期`,
  }
  steps[5] = {
    ...steps[5],
    status: 'done',
    summary: `${insightCount} 条，每条都把「数据事实」和「原因假设」分开写`,
  }
  steps[6] = {
    ...steps[6],
    status: 'done',
    summary: '已标明数据来源、执行方式与分析时间范围',
  }
  emit()

  /* 结论为空说明模板没取到数据，这本身要如实说，不能给个空字符串糊弄过去 */
  if (!verdict || !verdict.trim()) {
    verdict = plan.intent.fallback
    if (!warnings.some((w) => w.includes('结论'))) {
      warnings.push('这次没有生成出有效的结论文字，请看执行步骤里的说明。')
    }
  }

  return { mode: options.mode ?? 'rule', plan: { ...plan, steps }, steps, data, engineMode, warnings }
}

/* --------------------------------------------------------------------------
   三之二、页面自己出错时的轨迹（两条路共用）
   --------------------------------------------------------------------------
   ★ 这个函数为什么存在 —— 它修的是一个【用户真的会看到】的故障：

     `AiAnalyst.run()` 原来是 `try { … } finally { … }`，没有 catch。
     `await runLlmAnalysis(...)`（或 `runAgentPlan(...)`）只要拒绝一次，
     后面那句 `setTrace(result)` 就永远不会执行，于是轨迹【一直停在】
     调用之前设下的那份骨架上 —— 而大模型路径的骨架，第 1 步写的是
     「正在把问题交给大模型…」。

     表现就是：**页面永远显示「正在把问题交给大模型」，没有报错、没有提示、
     控制台也是干净的**（busy 被 finally 复位了，按钮还能点）。
     用户唯一能做的判断是「是不是网慢，再等等」—— 而它永远不会变。

   ★ 所以这个函数干的事只有一件：把「还在跑」的那些步骤如实标成
     「没跑完，页面自己出错了」，并让 `crashed` 这个字段存在 ——
     页面上一挂 `crashed`，顶部就出现横幅，原始报错原样摆出来。

   ★ 为什么放在 runner.ts 而不是 llm/loop.ts：两条路都会栽在这儿，
     规则路径的崩溃不该反过来依赖 llm/ 目录。这里只用到 AgentTrace 的类型。

   ★ 为什么不在这里 catch（而是让调用方 catch）：能 catch 的地方在
     `run()` 那个 await 上；这里只负责【把失败如实描述成一份轨迹】，
     一个纯函数，能被脚本直接喂进去断言。
   -------------------------------------------------------------------------- */

/**
 * ★ 出事时，还停在「正在跑」的那一步，summary 要换成的话。
 *
 * ★ 这一句【非换不可】，只加个 note 是不够的 —— 这是写这块断言时当场抓到的：
 *   起初我以为「状态标成 error + 挂一句 note」就够了，结果页面上的
 *   summary 还是原来那句「正在把问题交给大模型…」。
 *   也就是说：**用户报的那个症状一个字都没少** —— 他会看到一句
 *   「正在把问题交给大模型」停在一个永远不动的转圈上。
 *   summary 才是那一行最显眼的字，note 是折叠在下面的小字。
 */
export const CRASHED_STEP_SUMMARY = '这一步没有跑完 —— 页面自己在这一步出错了'

/** 出错时，那一步的 note 要说的话。抽成常量，脚本逐字断言。 */
export const CRASHED_STEP_NOTE =
  '这一步没有跑完 —— 页面自己在这一步抛了异常，停在这儿了。原始报错在下面的警告里。'

/** 进 warnings 列表那句话的前缀。★ 前缀单独导出，脚本才数得准。 */
export const CRASHED_WARNING_PREFIX = '页面这一侧出错，本次分析没能跑完：'

/**
 * 把一个 catch 到的值翻成一句能贴到页面上的话。
 *
 * ★ `String(e)` 和 `e.message` 都【不够】：
 *   · `throw '字符串'`（真的有人这么写）时 `e.message` 是 undefined，
 *     页面上会出现「原始报错：undefined」—— 又是一处脏字符；
 *   · 对象被 throw 时 `String(e)` 得到的是 `[object Object]`，等于什么都没说。
 *   所以取 message、没有就取 String()、连 String() 都拿不到才兜底。
 *   ★ 名字（`e.name`）不能丢：`TypeError: x is not a function` 比
 *     `x is not a function` 有用得多，而 message 里通常没有名字。
 */
export function describeThrown(e: unknown): string {
  /* ★ `throw null` 和 `throw undefined` 都是合法写法，而 String(null) 是
     'null' —— 页面上会出现「原始报错：null」，读者会以为那个 null 是报错内容。
     这不是理论风险：Promise 链里 `throw await something()` 拿到空值就会这样。
     说清「抛出来的就是个空值」比把 'null' 当报错内容印出去有用。 */
  if (e === null || e === undefined) {
    return `（抛出来的是一个空值：${String(e)}。原始异常请到浏览器控制台看）`
  }

  if (e instanceof Error) {
    return e.name && e.message ? `${e.name}: ${e.message}` : e.message || e.name || String(e)
  }
  try {
    const s = String(e)
    return s === '[object Object]' ? JSON.stringify(e) : s
  } catch {
    /* String() 都可能抛（比如 Symbol 之外带 toString 抛异常的对象）。
       到这一步宁可说一句诚实的废话，也不能让报错处理自己再抛一次。 */
    return '（原始报错没法转成文字，请到浏览器控制台看这条异常）'
  }
}

/**
 * 给「还挂着『正在跑』的步骤」收场。
 *
 * ★ 为什么必须单独有个函数（这是它存在的唯一理由，别把它内联回去）：
 *   `'running'` 这个状态有两种人会给它收场 ——
 *   **页面自己抛异常**（`crashedTrace`）和**跑到一半中断**（`loop.ts` 的 aborted 收尾）。
 *   两边的判断完全相同（只动 running、done/error/skipped 一律不碰），只有措辞不同。
 *   各写一份的话，哪天在一处补了「顺手清掉 note」这种细节，另一处不会有 ——
 *   而那种分叉不报错，只是同一个页面上两种失败的说法开始不一样。
 *
 * @param steps   已经跑到一半的那份步骤
 * @param summary 换上去的那一行大字（★ 必须换，只加 note 不管用，见下）
 * @param note    换上去的那行小字
 *
 * ★ 为什么 summary 必须换掉：屏幕上最显眼的那一行是 summary，
 *   note 是下面的小字。只加 note 的话，用户看到的仍然是
 *   「正在把问题交给大模型…」/「正在准备数据库…」—— 一句永远不动的「正在…」。
 */
export function demoteRunningSteps(steps: TraceStep[], summary: string, note: string): TraceStep[] {
  return steps.map((s) =>
    /* 只动还在「正在跑」的那几步。已经 done / error / skipped 的步骤是
       【真的发生了的事】，不能被这次失败改写。 */
    s.status === 'running' ? { ...s, status: 'error' as const, summary, note } : s,
  )
}

/**
 * 把一份「跑到一半就炸了」的轨迹描述出来。
 *
 * @param base  出事之前【页面上正显示着】的那份轨迹。保留它是刻意的：
 *              已经跑完的步骤、已经显示的进度都留着，只把还在跑的标成没跑完。
 *              整个丢掉重来会让用户以为「刚才那些都不算数」。
 * @param reason 原始报错的文字，原样带走。
 *
 * ★ `data` 刻意【不动】：它是什么就是什么。
 *   塞一份空数据进去会让第 5–7 步显示「没有得到结论」这类为正常失败写的话，
 *   而真实的成因在上面那条横幅里，两处说法会打架。
 */
export function crashedTrace(base: AgentTrace, reason: string): AgentTrace {
  const steps = demoteRunningSteps(base.steps, CRASHED_STEP_SUMMARY, CRASHED_STEP_NOTE)

  const warning = `${CRASHED_WARNING_PREFIX}${reason}`
  const warnings = [...base.warnings, warning]

  return {
    ...base,
    plan: { ...base.plan, steps, warnings },
    steps,
    crashed: { reason },
    warnings,
  }
}

/* --------------------------------------------------------------------------
   四、一步到位（给脚本和测试用）
   -------------------------------------------------------------------------- */

export async function runAgent(
  question: string,
  planOptions: PlanOptions = {},
  runOptions: RunOptions = {},
): Promise<AgentTrace> {
  return runAgentPlan(planAgent(question, planOptions), runOptions)
}
