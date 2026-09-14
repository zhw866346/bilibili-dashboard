/* ==========================================================================
   真实大模型路径的类型
   --------------------------------------------------------------------------
   ★ 和规则路径的关系：
     规则路径那套（matcher / intents / runner）【一行未改】，它现在是一条
     完整的降级路径。这个目录是【并行的另一条路】，两条路最后都产出一份
     AgentTrace，UI 只认那个形状。

   ★ 这一层里最要紧的三个类型，每一个都对应一种「不报错、只是静静地错」的失败：

     1. RunMode（三态而不是布尔）
        如果写成 `isLlm: boolean`，那么「后端探测失败所以退回规则」和
        「双击 dist/index.html 所以根本没法连后端」就是同一件事，
        页面上只能说一句含糊的「未接入大模型」。
        三种情形的用户动作完全不同（去开后端 / 这是正常的降级 / 换个方式打开），
        所以必须是三个状态。加第四态不补分支 = 编译错误（项目里已用过三次的老办法）。

     2. ToolCallRecord.result
        记的是【工具真的返回了什么】，而不是「模型说工具返回了什么」。
        数字核对器（verify.ts）就是拿它当唯一权威来对账的。

     3. NumberAudit
        结论里出现的每个数字，能不能在工具结果里找到。M/N。
        这是有了大模型之后这一页最大的风险的直接对策 ——
        「模型编一个看起来很合理的数字」。
   ========================================================================== */

import type { EvidenceItem } from '../types'

/* ---------------------------------------------------------------------------
   一、本次跑的是哪条路
   --------------------------------------------------------------------------- */

/**
 * ★ 三态，不是布尔。见文件头第 1 条。
 *   'llm'    —— 后端在、key 配好了，本次真的调用了大模型
 *   'rule'   —— 后端探测失败，已降级到本机的关键词规则（有真实原因）
 *   'static' —— 页面是双击 dist/index.html 打开的，物理上连不到后端
 */
export type RunMode = 'llm' | 'rule' | 'static'

/**
 * 探测本机后端的结果。四态各自带着「为什么」，页面要显示它。
 *
 * ★ 第四态 'deployed' 是 2026-09-14 加的（作品集上线）：这一页跑在静态托管上
 *   （GitHub Pages / Netlify），地址栏里不是本机 —— 背后【一定】没有后端。
 *   它和 'static' 不能合成一句：file:// 的人是「打开方式不对」，
 *   线上的人是「这本来就是演示版，设计如此」，两者要做的事完全不同。
 *   （`RunMode` 那边【不加】这一态 —— 线上跑的确实是规则路径，见 client.ts 的注释。）
 */
export type BackendProbe =
  | {
      kind: 'ready'
      provider: string
      providerLabel: string
      model: string
      /** 本机 Python 是否可用。不可用时提示词里要告诉模型「别用 Python 工具」。 */
      pythonOk: boolean
      pythonDetail: string
    }
  | { kind: 'rule'; reason: string }
  | { kind: 'static'; reason: string }
  | { kind: 'deployed'; reason: string }

/* ---------------------------------------------------------------------------
   二、一次工具调用
   --------------------------------------------------------------------------- */

/** 模型要求调用的工具名。只有这两个 —— 后端不认识别的。 */
export type ToolName = 'sql_query' | 'python_analysis'

/**
 * 模型自己写的 SQL 被校验器拦下来时，回给它的理由。
 * ★ 这不是异常，是【正常分支】：模型看到理由会改写重试，这是设计的一部分。
 */
export interface ToolCallRecord {
  /** 第几次工具调用（从 1 开始）。模型引用 SQL 结果给 Python 用的就是它。 */
  index: number
  name: ToolName
  /** 模型给出的原始参数（JSON 字符串，原样留着，页面上要展示） */
  argsRaw: string
  /** 解析后的参数。解析失败时是 null，并且 ok=false。 */
  args: Record<string, unknown> | null
  ok: boolean
  /** 工具返回给模型的【压缩后】结果（列名 + 前 50 行 + 总行数 + 是否截断） */
  forModel: unknown
  /** 工具返回的完整结果（页面显示用，最多 500 行） */
  full: ToolResult | null
  /** ok=false 时给模型看的理由。它据此自我修正。 */
  error?: { code: string; message: string; detail?: string }
  ms: number
}

/**
 * 工具执行结果。SQL 工具和 Python 工具共用这个形状 ——
 * 两者都是「一张表」，没必要造两种。
 */
export interface ToolResult {
  columns: string[]
  rows: Record<string, string | number | null>[]
  rowCount: number
  /** 因为行数上限被截断了（SQL 工具专用） */
  truncated?: boolean
}

/* ---------------------------------------------------------------------------
   二之二、本次要画的那张图（判别式联合，不是两个可选字段）
   ---------------------------------------------------------------------------
   ★ 为什么不做成 `outcomeId?` + `emptyNote?` 两个可选字段：
     两个可选字段能拼出【四种】组合，其中三种是坏的
     （有 id 没 note、有 note 没 id、两个都有），而坏掉的时候不会报错 ——
     页面只会静静地不画图，或者画出一张对不上任何查询的图。
     判别式联合把合法组合压到两种，`kind` 一写错就是编译错误。

   ★ 为什么挑图的规则写在 loop.ts 里而不是这里：这里只描述「结果长什么样」，
     怎么挑是工具层的事（pickChartable，连同它那条「序号列不能当柱子」的规矩）。
   --------------------------------------------------------------------------- */

/** 大模型路径本次要画的那张图。没有可画的也要如实说明为什么。 */
export type LlmChartPlan =
  | {
      kind: 'chart'
      /**
       * 画的是哪一次工具调用的结果。指向 `data.outcomes[].spec.id`。
       *
       * ★ 必须记 id，不能靠「第几个记录 ↔ 第几个 outcome」的下标巧合：
       *   今天恰好一一对应（recordToSpec 三种记录都返回 spec），
       *   哪天它多一个 `return null` 分支，图就会静静地画错一条。
       */
      outcomeId: string
      /** 哪个列当分类轴（横向柱图上的每一行） */
      labelKey: string
      /** 哪个列当数值轴（柱子的长度） */
      valueKey: string
    }
  | {
      kind: 'none'
      /** 为什么没画。文案来自 verify.ts 的 noChartNote()，不要另写一份。 */
      note: string
    }

/* ---------------------------------------------------------------------------
   二之三、会话（多轮对话）
   ---------------------------------------------------------------------------
   ★ 这一节的东西【只服务当前这一轮对话】，不是长期记忆：
       刷新页面、点「新建分析」都会清空。

   ★ 最要紧的一条设计：上下文是「给模型看的材料 + 给用户看的卡片」，
     它【永远不参与控制流】。前端不许出现
         if (question === '为什么') …
     这种分支 —— 唯一允许影响行为的是「用户按了哪个按钮」和
     「模型自己申报了什么」。模型看到历史之后自己理解「他们」是谁，
     我们不替它猜。
   --------------------------------------------------------------------------- */

/** 这一轮是用户提的新问题，还是点了「继续深挖」。 */
export type TurnKind = 'ask' | 'deepen'

/** 上下文里的字段名。卡片上逐个字段渲染，缺哪个就不显示哪个。 */
export type ContextField =
  | 'topic'
  | 'segment'
  | 'comparedWith'
  | 'metric'
  | 'timeRangeText'
  | 'previousFinding'

/**
 * 这个字段是怎么来的。卡片上要如实标出来。
 *
 * ★ 为什么必须分开记：模型【自报】的上下文、从上一轮【继承】的上下文、
 *   由本次【窗口】算出来的时间范围，可信程度完全不同 ——
 *   前三个混在一起显示，用户会以为全是模型说的。
 */
export type ContextOrigin = 'llm' | 'inherited' | 'window'

/**
 * 当前分析上下文。每一个字段都可缺省 ——
 * ★ 缺省 = 不知道 = 卡片上不显示，**绝不用空字符串占位**。
 *   填一个 '' 进去，卡片上就会多出一行「当前分析对象：」，看起来像程序坏了。
 */
export interface TurnContext {
  /** 分析对象（「内容分区」「全站」「知识区」…） */
  topic?: string
  /** 用户群体（'18-24' 这种 id，或「全站用户」） */
  segment?: string
  /**
   * 对比对象。
   * ★ 单开一个字段，【不】复用 segment。
   *   复用的话，「和 25-31 相比呢」会把主对象 18-24 覆盖掉 ——
   *   于是「18-24 vs 25-31」变成「25-31 vs 空」，而卡片上看起来一切正常。
   */
  comparedWith?: string
  /** 指标（「播放量」「DAU」「完播率」…） */
  metric?: string
  /** 时间范围。★ 仅供展示，且【由前端从真实的 days 生成】，不采信模型说的话。 */
  timeRangeText?: string
  /** 上一轮的结论，一句话 */
  previousFinding?: string
}

/**
 * 一轮对话的摘要 —— 这就是「回放给下一轮模型看」的【全部内容】。
 *
 * ★ 为什么不是把上一轮那几十行原始数据行塞回去：
 *   1. token 会一路涨上去；
 *   2. 更要命的是 Python 工具靠 `source: 3` 引用「第 3 次调用结果」，
 *      跨轮拼接会出现两组同样从 1 开始的编号 ——
 *      模型想引上一轮第 3 次、却拿到了本轮第 3 次，**全程不报错**。
 *      所以历史里【只有文字】，没有 tool 消息，编号也就没有冲突的余地。
 */
export interface TurnDigest {
  question: string
  /** 指代消解之后这一轮到底在分析什么（模型自报） */
  resolved: TurnContext
  /** 这一轮的结论。★ 只有 grounded=true 时才会被转述给下一轮 */
  conclusion: string
  evidence: EvidenceItem[]
  /** 它这一轮真跑成功的 SQL 原文（截断过），供下一轮照着改写 */
  usedSql: string[]
  /** ★ 这一轮真实用的窗口，取 plan.days，不取模型说的话 */
  days: number
  /**
   * 这一轮真跑了几次工具（含没跑成的）。
   * ★ 单独记它，是为了让「本会话累计查了几次」有个能累加的地方 ——
   *   不记的话，页面上只能显示「本次几次」，用户会以为整个会话就查了这么几下。
   */
  toolCalls: number
  /**
   * 这一轮【核对通过】的数字（来源见 verify.ts 的 carriedNumbers）。
   * ★ 它存在的唯一理由：下一轮引用上一轮的数字时，
   *   核对器要认得出来，不能一律记成「没找到出处」——
   *   假告警比不检查更糟，它会让这个核对器整个失去信任。
   */
  carriedNumbers: string[]
  /**
   * 这一轮有没有真实数据支撑。
   * ★ 判据与 llmInsight 用的是同一个：本次有没有跑成过工具。
   *   不 grounded 的那一轮，它的结论不许被下一轮当成事实复述 ——
   *   否则模型编的数字会借着历史「洗白」成有出处的数字。
   */
  grounded: boolean
}

/** 一次会话的全部状态。放在页面里的一个 ref 上（刷新即清空）。 */
export interface ConversationState {
  turns: TurnDigest[]
  /** 当前生效的上下文 */
  current: TurnContext
  /** 每个字段的来源，卡片据此标注 */
  origins: Partial<Record<ContextField, ContextOrigin>>
  /** 「继续深挖」已经下钻了几层。★ 机器强制「只下钻一层」，不靠提示词求模型。 */
  deepenDepth: number
}

/** 后续问题是谁想出来的。卡片上要分开标注，不能让人以为全是模型给的。 */
export type FollowUpOrigin = 'model' | 'derived'

export interface FollowUp {
  text: string
  origin: FollowUpOrigin
  /** 点了它要顺便把时间窗口切到几天。undefined = 不改窗口 */
  days?: number
}

/**
 * 分析路径上的一个节点（「Analysis Path」）。
 * ★ 这是一张【卡片流】，不是流程图编辑器 —— 就是从上到下几句话。
 */
export interface AnalysisPathNode {
  no: number
  /** decompose = 拆解（把总指标拆成因子的乘积） drill = 下钻（换一个维度看） conclude = 落点 */
  kind: 'decompose' | 'drill' | 'conclude'
  text: string
  /** 指回第 4 步里对应的那张结果卡（data.outcomes[].spec.id）。没有出处时为空数组。 */
  evidenceRefs: string[]
}

/* ---------------------------------------------------------------------------
   三、模型最终写出来的那份结构化结论
   --------------------------------------------------------------------------- */

/**
 * 结构化结论。★ 段数和顺序是用户明确要求的，不是我们设计的：
 *   ① 核心结论 ② 数据依据 ③ 分析说明 ④ 业务建议 ⑤ 数据来源
 *
 * ★ 第 ② 段直接复用规则路径的 EvidenceItem：
 *   {label, value, compare, delta, sample} 天然就是「指标·当前值·对比值·变化率」，
 *   页面上的依据表组件一行都不用改。
 *
 * ★ 这里面有一个 context 字段，它服务的是多轮对话：
 *   把「这一轮到底在分析什么」记下来 —— 卡片要显示它，
 *   而下一轮之所以知道「他们」是谁，靠的也正是它。
 *   ⚠️ 以后要把【事实 / 分析判断 / 业务假设 / 建议】四样拆成四段时，
 *      在这里加字段、同时改 prompt.ts 的作答指令和渲染的组件，
 *      **三处必须一起改**：只加字段不加渲染 = 模型说的话页面上看不到，
 *      而那是「不报错、只是静静地少了一块」。
 */
export interface LlmAnswer {
  /** ① 核心结论 */
  conclusion: string
  /** ② 数据依据 —— 复用规则路径的类型，页面组件照旧 */
  evidence: EvidenceItem[]
  /** ③ 分析说明（含【数据事实】与【原因假设】的区分） */
  explanation: string
  /** ④ 业务建议。条件句，不写成断言。 */
  suggestions: string[]
  /** ⑤ 数据来源。模型自己声明它用了哪几次工具。 */
  sources: string[]
  /**
   * 这一轮消解出来的上下文（「他们」= 18-24 岁就是在这里）。
   * ★ 不复用 explanation 去猜 —— 猜出来的上下文会静静地错，
   *   而错上下文会让后面每一轮都跟着错。
   * ★ null = 模型这一次没有申报（例如答案是原文渲染出来的那种情况）。
   */
  context: TurnContext | null
  /**
   * 用户这一轮是不是在要求换一个时间范围（「最近 7 天呢」）。
   *
   * ★ 它【不是】一个上下文（不进 TurnContext、不进会话状态），
   *   而是一次【请求】：模型只能申报，改窗口的权力仍然在页面上的按钮那里。
   *   两个工具的 JSON Schema 里根本没有窗口参数，所以模型自己改不了 ——
   *   它唯一能做的就是把「用户想要几天」说出来。
   * ★ 只认页面上真实存在的三个值（ALLOWED_DAYS，派生自 RANGES）。
   *   闭集外的值一律解析成 null —— 否则前端会去拨一个不存在的按钮。
   * ★ null = 没说（不是 0、不是 -1）：绝不用一个哨兵值冒充「没说」。
   */
  requestedDays: number | null
  /**
   * 三级降级的证据。true = 这份答案是【原文渲染】的，不是结构化解析出来的。
   *   页面上要据此挂警告并明写「本次未结构化」，不能假装它是正常结果。
   */
  unstructured: boolean
  /** unstructured=true 时，模型的原始输出（要原样显示给用户看） */
  rawText?: string
}

/* ---------------------------------------------------------------------------
   四、数字核对
   --------------------------------------------------------------------------- */

/**
 * 结论里的数字，有多少能在工具返回的结果里逐字找到。
 * ★ 这是「模型不许编数字」这条底线的机器落点。
 */
export interface NumberAudit {
  /** 结论全文里一共认出多少个数字 */
  total: number
  /** 其中能在工具结果里找到出处的个数 */
  matched: number
  /** 找不到出处的（要原样列出来给用户看，不能只报一个数） */
  missing: string[]
  /** 模型一次工具都没调就直接下结论 */
  noToolCalls: boolean
  /**
   * 其中有多少个数字的出处【不在本次运行里】，而在前几轮的工具结果里。
   * ★ 用户问「和第二名相比呢」，模型必然要引用上一轮的数字。
   *   没有这个字段的话，那些数字会被一路判成「找不到出处」——
   *   **假告警比不检查更糟**：它会让人开始不信任这个核对器。
   */
  matchedFromPrior: number
  /**
   * 这次核对的范围。
   *   'run'          = 只看本次运行的工具结果（单轮提问）
   *   'conversation' = 本次 + 之前各轮（多轮追问）
   * ★ 写出来是为了让页面上那句话能跟着变 —— 不写的话，
   *   「只有本次」和「含前几轮」这两种情形会共用一句「只核对本次」的假话。
   */
  scope: 'run' | 'conversation'
}

/* ---------------------------------------------------------------------------
   五、一次 LLM 分析的运行详情（给第 7 步「可信度」用）
   --------------------------------------------------------------------------- */

export interface LlmUsage {
  promptTokens: number
  completionTokens: number
  totalTokens: number
  reasoningTokens: number
}

export interface LlmRunDetail {
  mode: 'llm'
  provider: string
  providerLabel: string
  model: string
  /** 一共发了几次 HTTP 请求（工具循环 N 次 + 最终作答 1 次） */
  requestCount: number
  /** 工具调用的完整记录 */
  toolCalls: ToolCallRecord[]
  /** 累计 token 用量 */
  usage: LlmUsage
  /** 各次请求的耗时（毫秒），页面上要显示真实的耗时 */
  requestMs: number[]
  /** 我们【实际注入给模型】的口径说明全文。第 1 步要原样展示（可展开）。 */
  dialectCard: string
  /** 模型第一次响应的原文（工具调用 + 它自己写的 SQL），第 1 步展示 */
  firstResponse: string
  /** 供应商返回的推理原文（思考模式下才有） */
  reasoning: string | null
  /** ★ 阶段 B 发出去的时候【没有给任何工具】—— 这是强制结构化输出的手段本身 */
  answerPhaseHadTools: false
  /**
   * 数字核对结果。第 7 步显示「M / N」，页面顶部的横幅也用它。
   * ★ 它必须挂在 run detail 上、和结论同生共死，不能由页面另外算一份 ——
   *   两处各算一次，迟早在某次改动后不一致，而不一致时不会报错。
   */
  audit: NumberAudit
  /** 「模型说增长、但工具返回的变化率全为负」的警告。null = 没有这个问题。 */
  growthWarning: string | null
  /**
   * 「模型说涨 / 说跌，和趋势工具返回的 direction 那一列相反」的警告。
   *
   * ★ 单开一个字段，不并进 growthWarning：两者的证据完全不同 ——
   *   一个是变化率【数值】，一个是趋势的【方向】。
   *   并在一起的话，横幅只能笼统说一句「模型的话和工具对不上」，
   *   而「哪里对不上」正是要给人看的东西。
   */
  directionWarning: string | null
  /** 一次工具都没调就直接下结论（第 4 步 skipped、第 5 步挂红字） */
  noToolCalls: boolean

  /* -------------------------------------------------------------------------
     多轮对话追加的字段。★ 全部是必填，
     但单轮提问时它们都取「这一轮就是全部」的诚实值，不是 null ——
     页面渲染时不用到处判空。
     ------------------------------------------------------------------------- */

  /** 这一轮是提问还是继续深挖 */
  turnKind: TurnKind
  /** 请求发出【之前】就能如实说的上下文（继承自上轮 + 本轮真实窗口） */
  contextIn: TurnContext
  /** 模型作答【之后】自报的上下文（已按合并规则算完） */
  contextOut: TurnContext
  /** 每个上下文字段的来源 */
  contextOrigins: Partial<Record<ContextField, ContextOrigin>>
  /** 后续问题（模型给的 + 本地按真实结果派生的） */
  followUps: FollowUp[]
  /** 分析路径卡片流 */
  analysisPath: AnalysisPathNode[]
  /**
   * 本次工具预算的实际情况。
   * ★ 为什么要把「为什么是这个上限」也记下来：
   *   上限会变（简单问题 4、申报了多步计划 6），页面上只写一个数字的话，
   *   用户看不出这张图/这条结论是在什么预算下跑出来的。
   */
  toolBudget: {
    used: number
    cap: number
    /**
     * ★ `'batch'` 的含义是「最后一批整批放行，所以 used 超过了名义上限」。
     *   一次响应里的多条工具调用必须同生共死（要么整批执行、要么整批拒绝，
     *   见 `loop.ts` 的 `MAX_TOOL_CALLS_PER_BATCH`），所以 used 可以真的 > cap。
     *   页面必须把这件事说出来 —— 显示一个「6 / 4」而不解释，是最典型的对不上账。
     */
    why: 'default' | 'announced-plan' | 'deep-dive' | 'batch'
  }
  /**
   * 模型在第一次响应里【事前申报】的分析计划。
   * ★ 和 llmPlanFromCalls 产出的那份是两回事：那一份是【事后】把它实际做过的事记下来。
   *   这一份是它动手【之前】说的。两者对照着看，才知道它有没有跑偏。
   */
  announcedPlan: { steps: string[]; source: 'model' } | null
  /**
   * 本轮核对通过、可以带进下一轮的那些数字。
   * ★ 挂在 run detail 上而不是让页面自己再算一遍：它必须和 `audit`
   *   读的是【同一份正文、同一份工具结果】，否则会出现
   *   「核对说有出处、而下一轮说没有」这种两边都不报错的矛盾。
   */
  carriedNumbers: string[]
  /** 本会话累计工具调用次数（含之前各轮）。单轮提问时等于 toolCalls.length。 */
  sessionToolCalls: number
  /**
   * 历史被裁掉时对用户说的话。null = 没有裁过。
   * ★ 丢历史必须【说出来】—— 静默截断会让模型突然「失忆」而用户毫不知情。
   */
  historyNote: string | null
  /**
   * 模型申报的「用户想换成几天」。null = 它没申报。
   * ★ 页面据此把时间窗口的按钮【拨过去】—— 注意只是拨按钮，
   *   **不自动重跑**：重跑要重新查一遍数据库，还会多花一轮模型调用的钱。
   *   拨完之后屏幕上会自动出现那条早就写好的「窗口切了但结果还是旧的」提示。
   */
  requestedDays: number | null
}

/* ---------------------------------------------------------------------------
   六、后端错误
   --------------------------------------------------------------------------- */

/** 后端返回的错误。code 给程序判断，message 是可直接显示的中文。 */
export class BackendError extends Error {
  code: string
  detail: string
  constructor(code: string, message: string, detail = '') {
    super(message)
    this.name = 'BackendError'
    this.code = code
    this.detail = detail
  }
}

/** 跑一半失败时，第 5/6 步要显示的那种「停下来」的状态（决定 5：绝不自动降级）。 */
export interface LlmAbort {
  /** 停在第几次请求 */
  atRequest: number
  code: string
  message: string
  detail: string
}
