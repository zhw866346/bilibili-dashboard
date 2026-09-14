/* ==========================================================================
   合成意图：「这一次走的是真实大模型路径」
   --------------------------------------------------------------------------
   ★ 三个非做不可的设计，每一条都是为了堵住一类「不报错、只是静静地错」：

     1. 【绝不注册进 INTENTS / INTENT_BY_ID】
        它是一段没有规则、没有模板的壳子。注册进去的话，规则引擎的匹配
        就能匹到它 —— 于是「用户问了句话，本地关键词把它匹配成了『大模型路径』」
        这种荒谬的事会真的发生，而且不报错。
        本机有一条检查钉着这件事。

     2. 【verdict / evidence / insight 只取值，不生成文字】
        规则路径上那三个函数是「模板填真实数字」。到了大模型模式，如果模板
        和模型各写一份结论，两边说法打架的时候不会报错，只会让人不再信任
        这一页（项目里已经在别的字段上栽过一次）。所以这里全部改成
        从 data.llmAnswer 里取值，取不到就给一句如实的兜底。

     3. 【计划是事后生成的】
        规则模式：先拟计划，再执行 —— 第 2 步是真正意义上的「事前计划」。
        大模型模式：模型自己决定查什么 —— 所以我们只能把它
        【实际做了什么】如实记下来。这两件事长得很像，但性质完全不同，
        页面文案必须说清是哪一种，见 POST_HOC_PLAN_NOTE。
   ========================================================================== */

import { formatMs } from '../../../utils/format'
import { UNSTRUCTURED_CONCLUSION } from './answer'
import type { RunMode, ToolCallRecord } from './types'
import type {
  AnalysisData,
  EvidenceItem,
  Intent,
  IntentSlot,
  Insight,
  PlanStep,
  SqlQuerySpec,
  ToolChoice,
} from '../types'

/* ---------------------------------------------------------------------------
   一、几段会被页面照抄、也会被脚本逐字断言的文案
   --------------------------------------------------------------------------- */

/** 分析类型。第 1 步标题下面显示它。 */
export const LLM_ANALYSIS_TYPE = '大模型自主分析'

/**
 * ★ 这段是第 2 步最重要的一句话。
 *   规则路径上看到的「分析计划」是事前拟好的；这里不是。
 *   不说清楚，同一块 UI 会让人以为模型也是先想好了再查的。
 */
export const POST_HOC_PLAN_NOTE =
  '★ 这份计划是【事后】从实际发生的工具调用记录生成的，不是事前写好的。' +
  '这一模式下，是模型自己决定要查什么 —— 我们只把它真正做了什么如实记下来。'

/** 模型一次工具都没调就直接下结论时，第 5 步顶上挂的红字。 */
export const NO_TOOL_CALL_INSIGHT =
  '模型这一次【没有调用任何工具】就给出了结论 —— 所以下面这些话没有任何真实数据支撑，' +
  '请只当作它的推测。'

/** 结论取不到时的兜底。 */
export const LLM_NO_CONCLUSION = '模型这一次没有给出核心结论。'

/** 模型没给「分析说明」时的兜底。 */
export const LLM_NO_EXPLANATION = '模型这一次没有给出分析说明。'

/** 模型没给建议时的兜底。 */
export const LLM_NO_SUGGESTION = '模型这一次没有给出业务建议。'

/** 那条洞察的标题。 */
export const LLM_INSIGHT_TITLE = '大模型的整体分析'

/** 把模型的「分析说明」放进【原因假设】那一栏时，前面必须加这句。 */
export const LLM_HYPOTHESIS_PREFIX =
  '模型的解释（这是它的判断，不是工具返回的数据）：'

/** 模型给了结论、却没给结构化数据依据时的如实说明。 */
export const LLM_NO_EVIDENCE =
  '模型这一次没有给出结构化的数据依据。★ 但本次的工具调用是【真跑成功过】的，' +
  '原始结果就在第 4 步 —— 想看真数字请看那里，不要把它下面的话当成数据。'

/** 调用了工具、但一次都没成功时的如实说明。 */
export const LLM_ALL_TOOLS_FAILED =
  '模型这一次调用了工具，但【一次都没有执行成功】，所以下面这些话没有任何真实数据支撑。'

/**
 * 跑到一半停了、模型根本没写出结论时，第 6 步要显示的那句话。
 *
 * ★ 为什么非有不可：`llmInsight` 只能看到 `AnalysisData`，看不到「这次中止了」。
 *   中止且一次工具都没调时，它会说「模型没有调用任何工具就给出了结论」——
 *   而真相是它【还没写结论就断了】。同一页顶部横幅正在说「跑到一半停了」，
 *   第 6 步却暗示它答完了，而且在说「它的结论没有数据支撑」。
 *   判断「是不是中止」只能在外面做（`trace.aborted`），所以这句话也在外面用。
 */
export const LLM_ABORTED_NO_INSIGHT =
  '模型这一次没有写出结论 —— 分析在它作答之前就停了，所以没有业务洞察可显示。' +
  '停在哪一步、后端原话是什么，写在页面顶部的横幅里。'

/* ---------------------------------------------------------------------------
   一之二、工具的「执行方式」怎么写给人看
   ---------------------------------------------------------------------------
   ★ 这一段是被一个真缺陷逼出来的，写在这里免得以后有人图省事改回三目：

     大模型路径的 Python 工具，mode 是 'server'（本机真起了一个进程算）。
     而规则路径的页面是这样写的：`t.mode === 'live' ? A : B` ——
     于是「本机真起了一个 Python 进程」被显示成「读取离线运行结果」，
     恰好把这一页最想证明的那件事说反了。它不报错、类型也对、脚本全绿。

   ★ 所以：三态写成 Record 查表，漏一个成员就是编译错误（项目里用过三次的老办法），
     而且【这一份是唯一的真相来源】—— 第 3 步的摘要（loop.ts）和
     第 3 步的工具徽章（AgentWorkflow.tsx）都读它，不允许各自再写一遍。

   ★ 措辞要求：每个值都要能接在工具名后面读通（「SQL 取数：浏览器本地真跑」），
     也能单独当徽章用。三句【互不为子串】—— 否则「另一种说法没出现」这类
     反向断言会永远是绿的。
   --------------------------------------------------------------------------- */

export const MODE_LABEL: Record<ToolChoice['mode'], string> = {
  live: '浏览器本地真跑',
  offline: '读取离线运行结果',
  server: '本机真起了一个 Python 进程',
}

/* ---------------------------------------------------------------------------
   一之三、第 1 步那个徽章：「这一次跑的是哪条路」
   ---------------------------------------------------------------------------
   ★ 原来是【写死】的一句「规则匹配 · 非大模型」。写死的话，
     大模型路径的第 1 步会顶着一句「非大模型」显示 —— 这一页最要命的
     一句话，恰好在这一页最核心的那条路上说反了。而且它不报错、类型也对。

   ★ 三态写成 Record<RunMode, …>，加第四态不补就是编译错误。
     三句【互不为子串】：反向断言「另一种说法没出现」才有意义。

   ★ 措辞要短：它是个徽章，挤在一张步骤卡的标题行上。
   --------------------------------------------------------------------------- */

export const TRACE_MODE_LABEL: Record<RunMode, string> = {
  llm: '真实大模型 · 自己决定查什么',
  rule: '本地关键词规则 · 非大模型',
  static: '本地文件打开 · 无法连后端',
}

/* ---------------------------------------------------------------------------
   二、三个「取值器」
   --------------------------------------------------------------------------- */

/**
 * 结论：能取到就用模型的，取不到就如实说取不到。
 *
 * ★ 这里【不】在失败时回退到规则模板的结论。
 *   那会造出最坏的一种失败：用户看到一份写得挺好的结论，
 *   以为是大模型给的，其实是本地模板给的。宁可显示一行「没给出结论」。
 */
function llmVerdict(d: AnalysisData): string {
  const a = d.llmAnswer
  if (!a) return LLM_INTENT.fallback
  const text = (a.conclusion ?? '').trim()
  if (text) return text
  return a.unstructured ? UNSTRUCTURED_CONCLUSION : LLM_NO_CONCLUSION
}

/** 数据依据：直接用模型给的结构化列表（页面上是那张表）。 */
function llmEvidence(d: AnalysisData): EvidenceItem[] {
  return d.llmAnswer?.evidence ?? []
}

/**
 * 业务洞察：拼成【数据事实】【原因假设】【业务建议】三段。
 *
 * ★ 这里最容易糊弄过去的一步是 fact 那一栏。模型的「分析说明」里
 *   事实和猜测是混在一起写的，直接塞进 fact 就等于把猜测说成了事实 ——
 *   而这一页立页的规矩恰恰是这两者必须分开。
 *
 *   所以：
 *     fact       ← 模型给的【结构化依据】（每一项都被数字核对器盯过）
 *     hypothesis ← 模型的「分析说明」，但前面加一句说明这是它的判断
 *     action     ← 模型的「业务建议」
 *
 *   三段全取不到时也返回一条，把「它什么都没给」这件事显示出来 ——
 *   空列表会让这一栏整块消失，而「整块消失」是看不见的。
 */
function llmInsight(d: AnalysisData): Insight[] {
  const a = d.llmAnswer
  if (!a) return []

  const facts = (a.evidence ?? [])
    .map((e) => {
      const parts = [`${e.label}：${e.value}`]
      if (e.compare) parts.push(`对比 ${e.compare}`)
      if (e.delta) parts.push(`变化 ${e.delta}`)
      return parts.join('，')
    })
    .join('；')

  /*
    ★ 这一栏叫【数据事实】，所以它必须先确认「真有数据」。

      第一版直接把模型给的依据原文摆在这里。模型一次工具都没调时，
      它编的「DAU：50000 人」就会顶着【数据事实】这四个字显示出来 ——
      而页面上别的地方（第 4 步、警告块）正在说「本次没有执行任何查询」。
      同一页自相矛盾，而且矛盾的那一半看起来最权威。

      修法：有没有真数据，看的是【本次有没有一条 SQL 真的跑成功过】，
      不是看模型说了什么。没有的话，它列的那些数字照旧显示（如实呈现它说了什么），
      但必须顶着「这些数字没有一个来自真实查询」这句话，而不是【数据事实】。

      判据取 d.outcomes 而不是某个布尔标记：标记会跟真实情况脱钩，结果集不会。
  */
  /*
    ★ 这里必须问两个【互相独立】的问题，而不是一个：

      ① 工具跑成了吗？   → grounded（有一条 status==='done'）
      ② 工具调过吗？     → anyCall（outcomes 里有没有东西）

      第一版只问了 ①，而且把「依据列表空」当成了「没调工具」。
      那两件事完全不是一回事：「它调了工具、也成功了，但最后那段没写成 JSON」
      的时候依据列表也是空的 —— 于是【数据事实】那一栏会说
      「模型没有调用任何工具就给出了结论」，而它刚刚调了三次。

      修好之后仍有一个洞：一次没调、调了但全失败，是两种不同的情形，
      该说的话不一样（前者是它的选择，后者是环境/参数问题）。
      所以 ② 也要问。

      四种组合各有各的说法，每一种都只说有证据的那件事 —— 见下面那张表。
  */
  const grounded = d.outcomes.some((o) => o.status === 'done')
  const anyCall = d.outcomes.length > 0

  /* 没有真实数据时的【那句话头】。两种情形的措辞必须分开。 */
  const noDataHead = anyCall ? LLM_ALL_TOOLS_FAILED : NO_TOOL_CALL_INSIGHT

  const factText = facts
    ? grounded
      ? /* 有依据、且工具真跑成了 —— 这才是真正名副其实的【数据事实】 */
        facts
      : `${noDataHead}它自己列的依据是：${facts} —— ★ 这些数字没有一个来自真实查询。`
    : grounded
      ? /* 工具真跑成了，但它没给结构化依据（比如最后那段没按 JSON 写）。
           这时候原始结果就在第 4 步，要指给用户去看。 */
        LLM_NO_EVIDENCE
      : noDataHead

  const explanation = (a.explanation ?? '').trim()

  return [
    {
      title: LLM_INSIGHT_TITLE,
      fact: factText,
      hypothesis: explanation ? `${LLM_HYPOTHESIS_PREFIX}${explanation}` : LLM_NO_EXPLANATION,
      action:
        (a.suggestions ?? []).filter(Boolean).join('；') ||
        LLM_NO_SUGGESTION,
    },
  ]
}

/* ---------------------------------------------------------------------------
   三、从【真实发生过的调用记录】反推出计划与工具
   ---------------------------------------------------------------------------
   ★ 这几个函数是整个大模型路径里唯一「生成文字」的地方，
     但它们生成的每一句都只在复述已经发生的事实（第几次调用、什么工具、
     几行、几毫秒、成没成）。不掺任何判断。
   --------------------------------------------------------------------------- */

export interface LlmPlanParts {
  analysisType: string
  slots: IntentSlot[]
  planSteps: PlanStep[]
  tools: ToolChoice[]
}

/** 页面上把工具名翻译成人话。只有两处用到，但只写一份。 */
function toolLabel(name: string): string {
  return name === 'sql_query' ? '取数（SQL）' : '本机 Python 分析'
}

export function llmPlanFromCalls(
  question: string,
  records: ToolCallRecord[],
  days: number,
): LlmPlanParts {
  const sqlCalls = records.filter((r) => r.name === 'sql_query')
  const pyCalls = records.filter((r) => r.name === 'python_analysis')

  /* ---- 理解问题：三行，全部是事实 ---- */
  const slots: IntentSlot[] = [
    { label: '原始问题', value: question },
    { label: '时间窗口', value: `近 ${days} 天` },
    {
      label: '本次实际调用',
      value:
        records.length === 0
          ? '一次工具都没有调用'
          : `${sqlCalls.length} 次取数 + ${pyCalls.length} 次本机 Python`,
    },
  ]

  /* ---- 计划：一步一次调用，逐条对应 ---- */
  const planSteps: PlanStep[] = [
    {
      no: 1,
      title: '理解问题并自行决定查什么',
      detail:
        records.length > 0
          ? '这一步没有对错可查 —— 但它紧接着决定的查询是可查的，结果就在第 4 步。'
          : '★ 它这一步之后【没有调用任何工具】就直接作答了，所以没有可查的东西。',
      tool: 'sql',
    },
  ]
  records.forEach((r, i) => {
    planSteps.push({
      no: i + 2,
      title: `第 ${r.index} 次调用：${toolLabel(r.name)}`,
      detail: r.ok
        ? `真跑成功，返回 ${r.full?.rowCount ?? 0} 行，耗时 ${formatMs(r.ms)} ms。`
        : `没跑成：${r.error?.message ?? '未知原因'}`,
      tool: r.name === 'sql_query' ? 'sql' : 'python',
    })
  })

  /* ---- 工具：只说这次真用过的 ---- */
  const tools: ToolChoice[] = []
  if (sqlCalls.length > 0) {
    tools.push({
      tool: 'sql',
      why: '模型自己写出查询，在浏览器本地的真 SQLite（WebAssembly）上执行 —— 数据不出这台电脑。',
      mode: 'live',
    })
  }
  if (pyCalls.length > 0) {
    tools.push({
      tool: 'python',
      why: 'SQL 只负责把数据取出来；变化率、排名这类跨行计算交给本机真起的一个 Python 进程算。',
      mode: 'server',
    })
  }

  return { analysisType: LLM_ANALYSIS_TYPE, slots, planSteps, tools }
}

/* ---------------------------------------------------------------------------
   四、合成意图本体
   --------------------------------------------------------------------------- */

/**
 * ★★ 这个对象【绝对不能】出现在 intents.ts 的 INTENTS 数组里。 ★★
 *
 * `queries` 返回空数组是刻意的：大模型路径的 SQL 是模型当场写的，
 * 事前没有人能替它准备好。runner/loop 会把每一次真实调用包成 SqlQuerySpec
 * 塞进 plan.queries，所以第 4 步的卡片照旧一行不改就能渲染。
 */
export const LLM_INTENT: Intent = {
  id: 'llm',
  analysisType: LLM_ANALYSIS_TYPE,

  /* 永不被匹配到（没注册），这个数字只是占位。写 999 是为了万一有人
     哪天误把它注册进去，破并列时它也会排在所有规则意图后面。 */
  priority: 999,

  rules: [],

  /* 下面两个在 LLM 模式下由 loop.ts 用 llmPlanFromCalls 的结果覆盖。
     留成如实的一句话，而不是装作有计划 —— 万一哪天有别的入口调到这里，
     它说的话仍然是真的。 */
  slots: (): IntentSlot[] => [
    { label: '计划来源', value: '由实际发生的工具调用记录事后生成（见 llmPlanFromCalls）' },
  ],
  plan: (): PlanStep[] => [
    {
      no: 1,
      title: '由模型自行决定',
      detail: POST_HOC_PLAN_NOTE,
      tool: 'sql',
    },
  ],

  tools: [],

  /* ★ 只有一张通用图。而且 loop.ts 只在真挑得出可画的数据时才把它填进来 ——
     charts 为空数组时页面不画图，这是一开始就定下的规矩：
     不为展示而强行加图表。 */
  charts: ['llmBars'],

  queries: (): SqlQuerySpec[] => [],

  pyCaseIds: [],

  verdict: llmVerdict,
  evidence: llmEvidence,
  insight: llmInsight,

  fallback:
    '这一次没有拿到大模型的结论，也没有可用的本地兜底 —— 请看页面顶部的横幅说明哪一步没成。',
}

/**
 * 给本机检查用的：这个意图【必须】不在注册表里。
 * 断言写在脚本里，这里只把「它该在哪儿、不该在哪儿」集中成一句可读的话。
 */
export const LLM_INTENT_MUST_NOT_BE_REGISTERED = true
