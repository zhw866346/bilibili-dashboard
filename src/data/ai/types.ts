/* ==========================================================================
   AI 分析助手 —— 类型定义
   --------------------------------------------------------------------------
   这一层描述的是「Agent 工作流」长什么样：

     用户问题 → 问题理解 → 分析计划 → 工具选择 → 执行 → 结果 → 洞察

   ★ 三件必须写在最前面的事（整个 Stage 7 的诚实底线）：
     1. 这里【没有大模型】。问题理解是关键词规则匹配，结论是模板填数字。
        页面上的说法必须一致，不许含糊成「AI 认为」。
     2. SQL 是【真跑】的（浏览器里的 SQLite）；Python 是【离线真跑过】的结果，
        页面读的是那次运行的输出，不是当场执行。
     3. 数据是模拟的，和 B 站真实数据无关。

   ★ 为什么把「意图」做成数据而不是写成一堆 if：
     加一类新问题 = 往 INTENTS 里加一条，不用动 runner、不用动页面。
     这也让「这一类问题还没实现」变成一个可枚举、可展示的事实。
   ========================================================================== */

import type { Column } from '../../components/DataTable'
/* ★ 只是类型，编译后不存在这条 import —— 不会把整个 CodeBlock 组件
   （以及它带着的 tokenizer）拖进数据层的依赖图里。 */
import type { CodeLanguage } from '../../components/CodeBlock'
import type { AgeGroupId, CategoryName } from '../../types'
import type { PyCaseId, PyResults } from '../python/types'
import type { SqlCaseRow } from '../sql/cases'
import type { QueryResult } from '../sql/engine'
/* ★ 必须是 `import type`：ai/types.ts 和 ai/llm/types.ts 之间是【双向】引用的，
   一边用 import type，编译后就不存在这条 import 语句，也就不会有运行时循环依赖。
   写成普通 import 会引入一个真的环（LlmAnswer 是类型、但文件里还有别的值）。 */
import type { LlmAnswer, LlmChartPlan, LlmRunDetail, RunMode } from './llm/types'

/* ---------------------------------------------------------------------------
   一、意图与匹配
   --------------------------------------------------------------------------- */

/**
 * 意图标识。
 *
 * ★ 这里列出的【不等于】已经实现的。generic 不在 INTENTS 里，它是匹配不上时的落点。
 *   实现了哪个，INTENT_BY_ID 里就会有哪个——本机有一条检查会【双向】核对这两者是否对得上
 *   （注册了却忘了把示例标成已实现，同样会红）。
 */
export type IntentId =
  | 'activityDecline'
  | 'agePreference'
  | 'categoryGrowth'
  | 'completionRank'
  | 'segmentDecline'
  | 'generic'
  /**
   * ★ 合成意图，代表「这一次走的是真实大模型路径」。
   *
   *   它【故意不注册】进 INTENTS / INTENT_BY_ID —— 注册了的话，
   *   规则引擎的匹配就可以匹到它，而它是一段没有规则、没有模板的壳子。
   *   本机有一条断言专门盯这件事：llm 不在 INTENT_BY_ID 里。
   *
   *   写在这里（而不是只放在 llm/intent.ts 里）的理由是类型安全：
   *   `AgentPlan.intent.id` 要能装下它，声明在联合类型里才算数。
   */
  | 'llm'

/**
 * 一张图的标识。页面用 registry 把它映射成真的 Recharts 组件。
 *
 * ★ 这个联合类型是「所有必须补齐的地方」的清单：
 *   每加一个成员，`charts.tsx` 的 ChartBoard 和 `chartMeta.ts` 的 CHART_META
 *   不补齐就【编译不过】。靠这一点，新图不会静静地沿用上一张图的文案。
 */
export type ChartId =
  | 'dauTrend'
  | 'ageActiveRate'
  | 'ageCategoryShare'
  | 'weightVsActual'
  | 'categoryGrowth'
  | 'completionRank'
  | 'segmentActiveRate'
  /**
   * ★ 通用正负条形图。
   *
   *   规则路径的每一张图都是「为了回答某一类问题而专门画的」；
   *   大模型路径事先不知道会查出什么，只有一张通用图可用。
   *   它画的是「本次某一条查询结果里的分类列 + 数值列」，
   *   卡片标题会写明这份数据来自哪一条查询 —— 不写就是让人误以为
   *   这张图是页面为这个问题专门准备的。
   */
  | 'llmBars'

/** 一条识别规则：命中了哪些词，值多少分。 */
export interface MatchRule {
  /** 规则 id，页面上要显示「命中了哪条规则」 */
  id: string
  /** 这条规则在找什么，写成人话 */
  label: string
  /** 同义词组，命中任意一个就算命中这条规则 */
  any: string[]
  weight: number
  /**
   * 这条规则是「必答题」：它没命中，整个意图直接出局。
   *
   * ★ 这是防「过度自信」的关键一层。规则挂在这一条上、而不是单列一个
   *   关键词数组，是为了避免同一批词写两遍——写两遍迟早会改漏一处。
   */
  required?: boolean
}

/** 实际命中的一条规则 */
export interface MatchHit {
  ruleId: string
  label: string
  /** 具体命中的是哪个词。页面上直接显示出来，让读者自己判断匹得准不准。 */
  keywords: string[]
  weight: number
}

/** 从问题里抽出来的实体 */
export interface MatchEntities {
  ageGroup?: AgeGroupId
  category?: CategoryName
  /** 问题里提到的天数（近 7 / 近 14 / 近 30） */
  days?: number
}

/** 一次问题理解的结果 */
export interface MatchResult {
  intentId: IntentId
  /** 总分。低于阈值就走 generic 降级。 */
  score: number
  hits: MatchHit[]
  entities: MatchEntities
  /**
   * 同一句话里还识别到的其它候选意图。
   * 页面上会如实提一句「这条问题里还包含 XX，本次先回答主问题」——
   * 宁可显得笨，不要显得装懂。
   */
  alternates: IntentId[]
  /** 没匹配上任何意图（已降级到 generic）。页面上要明说。 */
  unmatched: boolean
  /** 归一化之后的问题文本，方便读者对照「机器看到的是什么」 */
  normalized: string
}

/** 「问题理解」里展示的一行：分析对象 / 核心指标 / 时间维度 */
export interface IntentSlot {
  label: string
  value: string
}

/* ---------------------------------------------------------------------------
   二、分析计划与工具
   --------------------------------------------------------------------------- */

export type ToolName = 'sql' | 'python' | 'frontend'

export interface PlanStep {
  no: number
  title: string
  /** 为什么要做这一步，一句话 */
  detail: string
  tool: ToolName
}

export interface ToolChoice {
  tool: 'sql' | 'python'
  /** 为什么用这个工具（而不是另一个） */
  why: string
  /**
   * ★ 这是最要紧的一个字段。
   *   'live'    = 这次分析里真的执行了（SQL 走这条）
   *   'offline' = 读的是离线跑好的结果，不是当场执行（Python 走这条）
   *   'server'  = 本机后端里真的起了一个 Python 进程当场算
   *               （大模型路径的 Python 工具走这条，和规则路径的 'offline'
   *                是两件不同的事，绝不能混用同一个值）
   *   页面直接照着它渲染说明文字，不靠人工措辞去保证诚实。
   */
  mode: 'live' | 'offline' | 'server'
}

/* ---------------------------------------------------------------------------
   三、SQL 查询的规格与结果
   --------------------------------------------------------------------------- */

/** 要用哪几条 SQL —— 只有规格，还没跑 */
export interface SqlQuerySpec {
  id: string
  /** 短名，例如「每日 DAU」 */
  label: string
  /** 这条查询在回答什么 */
  purpose: string
  sql: string
  /**
   * 代码框用哪套高亮。不写 = 'sql'。
   *
   * ★ 类型从 CodeBlock.tsx 的 CodeLanguage 引，【不要就地再写一遍】
   *   `'sql' | 'python'` —— 那样就有两个真相来源，将来加一门语言时
   *   漏改一处不报错，只是高亮错掉。
   *
   * ★ 它只负责「怎么上色」，【不负责判断这条记录是什么】。
   *   谁是谁由 loop.ts 装配时一次分好：结果表收全部记录、queries 只收 SQL。
   *   靠 language 去反推来源的话，默认值是 'sql' 这个事实会让
   *   「没写 language 的 Python 记录」被当成 SQL。
   */
  language?: CodeLanguage
  columns: Column[]
  /** 结果表下方的补充说明 */
  note?: string
  /** 从真实结果里读出的解释。注意：传进来的 rows 可能是空的。 */
  explain?: (rows: SqlCaseRow[]) => string
  /**
   * 交叉验证：把这条查询算出来的数，和 Python（离线）算出来的同一个数并排放。
   *
   * ★ 这是这个项目最有说服力的一种论据：两个完全独立的实现（SQL 引擎的
   *   COUNT(DISTINCT) 和 Pandas 的 nunique）算同一个口径，对得上才敢用。
   *   py 和 days 由 runner 传进来，所以这里不写死任何 Python 侧的字段名。
   *
   * ★ 允许返回【一组】检查，而不是一条。一条 SQL 里可能有好几个值得分别盯住的数
   *   （比如「窗口对半切」那条：前半段合计、后半段合计，两个数各自都能验出切分点错位）。
   *   只让返回一条的话，就得为了多验一个数硬拆出第二条 SQL ——
   *   那条 SQL 除了给对账用没有别的意义，反而让「本次真跑了几条查询」变得虚高。
   */
  crossCheck?: (
    rows: SqlCaseRow[],
    py: PyResults,
    days: number,
  ) => CrossCheck | CrossCheck[] | null
}

/**
 * 一条交叉验证：两个独立工具算同一个数，看对不对得上。
 *
 * ★ 只能比【整数】。SQL 的占比是 30.295831632084926，Python 侧刻意
 *   四舍五入到 4 位是 30.2958 —— 两个浮点数做 === 永远是 false，
 *   页面会永久挂一个红色的「不一致」，而数据其实完全正确。
 *   假告警比不检查更糟：它会让以后所有的告警都没人信。
 */
export interface CrossCheck {
  /** 这一条在核对什么 */
  label: string
  /** SQL 算出来的值 */
  sqlValue: number
  /** Python（离线）算出来的值 */
  pyValue: number
  /**
   * 单位：'人' / '次' / '条' …
   *
   * ★ 刻意设成【必填】。不写的话，页面会把「8,162 次观看」显示成「8,162 人」——
   *   而这个错【没有任何检查能报出来】（那条检查只比较两个数值）。
   *   设成必填之后，漏写单位是编译错误，不是运行时错误。
   */
  unit: string
}

/** 跑完之后的一条查询 */
export interface SqlOutcome {
  spec: SqlQuerySpec
  status: 'pending' | 'running' | 'done' | 'error'
  rows: SqlCaseRow[]
  rowCount: number
  ms: number
  error?: string
}

/* ---------------------------------------------------------------------------
   四、分析数据：结论模板的唯一入参
   --------------------------------------------------------------------------- */

/**
 * 一对「当前值 / 上一周期值」。
 * deltaPct 刻意是可选的——上一周期为 0 时算不出环比，
 * 模板必须走「不显示环比」的分支，而不是打印一个 undefined。
 */
export interface MetricPair {
  current: number
  previous: number
  deltaPct?: number
}

/**
 * 分析结果的全部真实数字。
 *
 * ★ 模板只允许从这里取值。这条约束的意思是：
 *   结论里的每一个数，都能在页面上的结果表或对账块里找到出处。
 */
export interface AnalysisData {
  days: number
  startDate: string
  endDate: string
  metrics: {
    dau: MetricPair
    activeUsers: MetricPair
    avgMinutes: MetricPair
    totalViews: MetricPair
    activeRate: MetricPair
    /** 窗口内新增用户数。来自前端口径，用来和 SQL 交叉验证。 */
    newUsersInWindow: number
  }
  outcomes: SqlOutcome[]
  /** 离线跑好的 Pandas 结果，原样给模板用 */
  py: PyResults
  crossChecks: CrossCheck[]
  /**
   * 本次问题里识别到的人群。图表和结论模板据此决定看哪一档。
   * ★ 问题里没写年龄段时是 undefined —— 这里【不填默认值】。
   *   默认只在 intents.ts 的 DEFAULT_FOCUS_AGE 一处落地，
   *   在这里再写一次默认就等于有了两个真相来源。
   */
  focusAge?: AgeGroupId
  /**
   * ★ 这一次是不是真的调用了大模型，以及它写了什么。
   *
   *   有它 = 结论文字来自模型（verdict / evidence / insight 三个模板函数
   *          在这一模式下【只取值、不生成文字】）。
   *   没有它 = 走的是那条规则路径。
   *
   *   ★ 为什么不让模板和模型同时写结论：那是两个真相来源，
   *     模板说东、模型说西的时候不会报错，只会让人不再信任这一页。
   */
  llmAnswer?: LlmAnswer
  /**
   * ★ 大模型路径这一次要画的那张图。
   *
   *   ★ 它【和 plan.charts 是两件事】，别合并：
   *     plan.charts 是「这个意图声明了哪几张图」（`ChartId[]`，喂给 ChartBoard 的 id）；
   *     llmChart 是「这一次的数据具体落在哪条查询、哪两列上」（模型每次查的东西都不一样，
   *     事前没法填）。前者决定画哪张卡片，后者决定卡片里的数据从哪儿取。
   *
   *   只有大模型路径会填它 —— 规则路径的图数据直接来自 plan.queries，
   *   没有「挑一条结果」这一步。
   */
  llmChart?: LlmChartPlan
}

/* ---------------------------------------------------------------------------
   五、结论与洞察
   --------------------------------------------------------------------------- */

/** 「数据依据」里的一行 */
export interface EvidenceItem {
  label: string
  value: string
  /** 对比值 */
  compare?: string
  /** 变化率，已经格式化过（带正负号） */
  delta?: string
  /** 样本量说明 */
  sample?: string
}

/**
 * 一条业务洞察。
 * ★ fact 和 hypothesis 必须分开：没有数据证明的原因，不许写成事实。
 */
export interface Insight {
  title: string
  /** 【数据事实】——只能引用本次结果里出现过的数字 */
  fact: string
  /** 【原因假设】——必须说清这是假设，且指向「参数是我设的」 */
  hypothesis: string
  /** 【业务建议】——条件句，不写成断言 */
  action: string
}

/* ---------------------------------------------------------------------------
   六、意图本体的定义
   --------------------------------------------------------------------------- */

/** 造 SQL 需要知道的窗口信息，和 SqlCaseContext 是同一套东西 */
export interface QueryContext {
  startDate: string
  endDate: string
  days: number
  depthThresholdMinutes: number
}

export interface Intent {
  id: IntentId
  /** 「用户活跃度变化诊断」——第 1 步要显示的分析类型 */
  analysisType: string
  /** 并列时破并列用，越具体的意图越大 */
  priority: number
  rules: MatchRule[]

  slots: (m: MatchResult) => IntentSlot[]
  plan: (m: MatchResult) => PlanStep[]
  tools: ToolChoice[]
  /** 没有可解释的点就留空数组——不为展示而强行加图表 */
  charts: ChartId[]
  /**
   * 造本次要跑的 SQL。
   *
   * ★ 第二个参数是【可选】的，为的是不打破已有的写法：
   *   只吃 ctx 的意图（activityDecline）照旧写 `queries(ctx)` 就能编译、能跑。
   *   需要跟着问题里的人群走的意图（agePreference）才用第二个参数。
   */
  queries: (ctx: QueryContext, m?: MatchResult) => SqlQuerySpec[]
  /** 引用 PY_RESULTS.snippets 里已有的 Python 案例源码 */
  pyCaseIds: PyCaseId[]

  /* 下面三个是纯函数模板，只吃 AnalysisData */
  verdict: (d: AnalysisData) => string
  evidence: (d: AnalysisData) => EvidenceItem[]
  insight: (d: AnalysisData) => Insight[]

  /** 数据不够、查询失败、匹配不上时说什么。不能空着。 */
  fallback: string
}

/* ---------------------------------------------------------------------------
   七、执行轨迹
   --------------------------------------------------------------------------- */

export type StepKey =
  | 'understand'
  | 'plan'
  | 'tools'
  | 'execute'
  | 'result'
  | 'insight'
  | 'confidence'

export type StepStatus = 'pending' | 'running' | 'done' | 'error' | 'skipped'

export interface TraceStep {
  no: number
  key: StepKey
  title: string
  /** 这一步的一句话结论，显示在时间轴上 */
  summary: string
  status: StepStatus
  /** 出错或降级时的如实说明，不留空 */
  note?: string
}

/** 一次分析的完整计划（问题理解 + 计划 + 工具，同步产出的部分） */
export interface AgentPlan {
  question: string
  days: number
  startDate: string
  endDate: string
  match: MatchResult
  intent: Intent
  slots: IntentSlot[]
  planSteps: PlanStep[]
  tools: ToolChoice[]
  charts: ChartId[]
  queries: SqlQuerySpec[]
  /** 这次分析会用到的 Python 案例源码（读 PY_RESULTS.snippets，页面做成代码 Tab） */
  pyCaseIds: PyCaseId[]
  steps: TraceStep[]
  /** 制定计划时就已经出现的问题（比如引用了一条不存在的 SQL）。要如实带到页面上。 */
  warnings: string[]
}

/** 跑完之后的全量结果 */
export interface AgentTrace {
  /**
   * ★ 这一次到底走的是哪条路。
   *
   *   'llm'    = 真的调用了大模型
   *   'rule'   = 降级到本机的关键词规则（后端不可用，或用户主动选）
   *   'static' = 页面是 file:// 打开的，物理上连不到后端
   *
   *   ★ 必须是三态，不能是布尔。写成 `isLlm: boolean` 的话，
   *     「后端没启动」和「双击打开的网页」就是同一件事，
   *     页面上只能说一句含糊的「未接入大模型」——
   *     而这两种情形该做的事完全不同（去开后端 / 换个方式打开）。
   *
   *   ★ 有它，页面顶部的诚实性横幅才能和实际路径【机器对齐】：
   *     本机有一条检查会合成三种 trace 各渲染一遍，断言横幅里说的模式
   *     和这里的值一致，而且没有出现另一种模式的字样。
   */
  mode: RunMode
  plan: AgentPlan
  steps: TraceStep[]
  data: AnalysisData | null
  /** 引擎实际跑在哪儿，页面上如实标出 */
  engineMode: 'worker' | 'main' | 'none'
  /** ★ 有它 = 这一次真的调用了大模型。第 7 步的「可信度」靠它给出模型、用量、核对结果。 */
  llm?: LlmRunDetail
  /** ★ 跑了一半失败时停在哪（决定 5：绝不自动降级）。有它时页面挂独立的横幅。 */
  aborted?: {
    atRequest: number
    code: string
    message: string
    detail: string
  }
  /**
   * ★ 页面【自己这一侧】抛了异常 —— 既不是模型的问题，也不是后端/网络的问题。
   *
   * ★ 为什么非有它不可（这是它存在的唯一理由，别删）：
   *   `AiAnalyst.run()` 里原来是 `try { … } finally { … }`，【没有 catch】。
   *   于是 `runLlmAnalysis()` 一拒绝，`setTrace(result)` 就永远不会执行 ——
   *   轨迹停在 `llmSkeletonTrace` 上，而那个骨架的第 1 步写着
   *   「正在把问题交给大模型…」。
   *   也就是说：**页面会永远停在「正在把问题交给大模型」这句话上，一句解释都没有。**
   *   不报错、不白屏、控制台干净，busy 还被 finally 复位了 ——
   *   看起来就像「还在跑，再等等」。
   *
   * ★ 和 `aborted` 的分工：【aborted 是模型/后端/网络那一侧】的事（超时、断线、限流、
   *   后端被关掉），处理办法是「等一会儿再试」；
   *   这里是【这一页的代码】出了错，处理办法是「把原始报错交回去修」。
   *   两件事的成因、该说的话、该做的事全都不同，所以是两个字段，不是同一个字段的两个码。
   */
  crashed?: {
    /** 真实异常的文字，原样带过来。不加工、不截断 —— 它是修这个问题的唯一线索。 */
    reason: string
  }
  /** 出错、降级等要如实告诉用户的话 */
  warnings: string[]
}

/* ---------------------------------------------------------------------------
   八、将来换真大模型的接口边界
   --------------------------------------------------------------------------- */

/**
 * 把「问题 → 意图」这一步抽象出来。
 *
 * ★ 这是整个 Stage 7 唯一需要为大模型预留的接口。
 *   现在只有一个实现：ruleBasedResolver（关键词规则）。
 *   将来要接真模型，就在 matcher.ts 里再加一个 llmResolver，
 *   让它返回同样形状的 MatchResult——runner 和页面一行都不用改。
 */
export interface IntentResolver {
  /** 这个解析器叫什么，页面上会显示出来 */
  name: string
  resolve(question: string): MatchResult
}

/**
 * 执行一条 SQL。runner 只依赖这个接口，不直接依赖 sql.js。
 *
 * ★ 让 runner 通过接口拿数据库，而不是自己去 new 一个，有两个直接好处：
   1. 命令行脚本可以塞一个「直接用 sql.js 建的引擎」进来，
      于是「这条 SQL 真能跑通吗」「交叉验证对不对得上」可以在终端里先验掉，
      不用等到打开浏览器；
   2. 将来要换成远程数据库、或者换成别的执行方式，只改注入的那一头。
 */
export interface SqlExecutor {
  /** 数据库实际跑在哪儿。页面上如实标出。 */
  mode: 'worker' | 'main'
  /** 返回形状与 SqlEngineClient.exec 完全一致，所以两者可以直接互换 */
  exec(sql: string): Promise<QueryResult>
}
