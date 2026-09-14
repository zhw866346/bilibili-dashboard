/* ==========================================================================
   工具调用循环 —— 从一句话问题跑到一份可追溯的分析链
   --------------------------------------------------------------------------
   两个阶段，不是「简单的自主循环」，是刻意做窄的一条路：

     阶段 A（最多 4 次工具调用）
       带工具定义发请求 → 模型要工具 → 【在本机真执行】→ 把结果回填 →
       再发一次。就这样，没有别的东西。

     阶段 B（作答）
       ★ 【不带任何工具】再发一次，带 jsonMode，让它按固定结构写结论。

   ★ 为什么阶段 B 要「不给工具」而不是用 tool_choice 强制：
     DeepSeek 在思考模式下 tool_choice:'required' 会直接 400，Kimi 也说不支持。
     「没给工具」这件事本身就是强制，不依赖任何供应商特性 ——
     而且它对应 UI 上一个【真实可显示的事件】：
     「模型正在写结论（本次没有给它任何工具）」，这句话本身就在解释
     为什么它这会儿没法再编数字。

   ★ 一次工具都没调就直接下结论，是这一页最容易被蒙混过去的地方：
     模型可以说一段听起来很专业的话，而里面一个真数字都没有。
     所以 noToolCalls 是一个【一等公民】，一路带到第 4 步（skipped）和
     第 5 步（顶上一条红字）。不拦这一条，这个页面就会变成一个
     看起来很权威的错误。

   ★ 决定 5：跑到一半失败【绝不自动降级到规则路径】。
     探不到后端时降级是诚实的（用户在看到任何结论之前就知道走哪条路）；
     但已经调了两次工具、第三次超时时悄悄换成模板答案，
     用户会把模板说的当成模型说的 —— 这是最坏的一种失败。
     所以这里抛 LlmAbort，由调用方停在原地、把已拿到的真结果照常展示、
     挂一条独立横幅，并给出「重试」和「改用规则再跑一遍（结果会不一样）」。
   ========================================================================== */

import { getWindowPair } from '../../selectors'
import type { BuildProgress } from '../../sql/engine'
import { engineFailureNote, getEngineError, getSharedSqlEngine } from '../engine'
import { buildAnalysisData, demoteRunningSteps } from '../runner'
import type {
  AgentPlan,
  AgentTrace,
  MatchResult,
  SqlExecutor,
  SqlOutcome,
  SqlQuerySpec,
  TraceStep,
} from '../types'
import { parseLlmAnswer } from './answer'
import { postLlm, postPy, type LlmResponse } from './client'
import { buildDialectCard } from './dialect'
import { LLM_INTENT, llmPlanFromCalls, MODE_LABEL, POST_HOC_PLAN_NOTE } from './intent'
import {
  buildContextIn,
  buildHistoryNote,
  checkComparison,
  checkComparisonLost,
  emptyConversation,
  HISTORY_DROPPED_NOTE,
  MAX_HISTORY_TURNS,
  mergeContext,
} from './history'
import { buildAnswerInstruction, buildContextNote, buildSystemPrompt, TOOL_DEFS } from './prompt'
import { recordToSpec, executeToolCall, pickChartable, type PyCaller, type ToolContext } from './tools'
import type {
  ConversationState,
  LlmAbort,
  LlmChartPlan,
  LlmRunDetail,
  ToolCallRecord,
  TurnContext,
  TurnKind,
} from './types'
import {
  auditSentence,
  auditedText,
  carriedNumbers,
  noChartNote,
  verifyDirectionClaim,
  verifyGrowthClaim,
  verifyNumbers,
  windowNumbers,
} from './verify'
import { windowMismatchNote } from './window'

/* ---------------------------------------------------------------------------
   一、可注入的两样东西
   ---------------------------------------------------------------------------
   ★ 两样都做成注入的，是为了让本机检查能在【不联网、不花钱、不起进程】
     的前提下把整条循环跑通 —— 用一个「预设响应按序吐出」的假模型。
     如果 loop 里直接 import postLlm，这条路径就永远只能靠真人花钱去验。
   --------------------------------------------------------------------------- */

/** 调大模型的方式。默认走本机后端；脚本注入假模型。 */
export type LlmCaller = (req: {
  messages: unknown[]
  tools?: unknown[]
  jsonMode?: boolean
}) => Promise<LlmResponse>

/** 探测结果里我们真正要用的那几样。页面探完之后传进来。 */
export interface LlmBackend {
  provider: string
  providerLabel: string
  model: string
  pythonOk: boolean
}

export interface LlmRunOptions {
  /** ★ 必填：这一页必须先探到后端可用，才会走这条路。 */
  backend: LlmBackend
  days?: number
  /** 注入的大模型调用方，默认 postLlm */
  callLlm?: LlmCaller
  /** 注入的 Python 调用方，默认 postPy */
  callPy?: PyCaller
  /** 注入的 SQL 执行器。语义同 runner.RunOptions.executor（'executor' in options 判定） */
  executor?: SqlExecutor | null
  onProgress?: (p: BuildProgress) => void
  onStep?: (steps: TraceStep[]) => void

  /* -------------------------------------------------------------------------
     多轮对话追加的两个选项。
     ★ 两个都是可选的，而且【不传时的行为与单轮提问逐字节一致】——
       页面上是单轮提问、还是连着追问，走的是同一个函数。
       这条不是风格问题：本机有一大批断言是照着单轮路径写死的
       （消息条数、请求次数、警告条数），多出一条消息就会红。
     ------------------------------------------------------------------------- */

  /**
   * 本次会话至今的状态（历史各轮 + 当前上下文）。
   * 不传 = 这是一个全新的、没有历史的提问。
   */
  conversation?: ConversationState
  /** 这一轮是用户提的新问题，还是点了「继续深挖」。默认 'ask'。 */
  turnKind?: TurnKind
}

/** 一次工具调用的上限。到顶之后模型只能去写结论。 */
export const MAX_TOOL_CALLS = 4

/**
 * 一次响应里最多接受几条工具调用。
 *
 * ★ 它和 MAX_TOOL_CALLS 是【两件不同的事】，别合并成一个数：
 *   · MAX_TOOL_CALLS           = 阶段 A 的【总量】预算（一批一批加起来，到这个数就收工）
 *   · MAX_TOOL_CALLS_PER_BATCH = 【单次响应】里最多几条（防模型一次失控要 20 条）
 *
 * ★ 为什么必须区分出「一批」这个概念（2026-09-12 补，起因是用户报上来的一条真故障）：
 *   模型的一次响应可以带【多条】tool_calls。而 OpenAI / DeepSeek 的硬规则是
 *   「一条带 tool_calls 的 assistant 消息，后面必须紧跟【每一条】tool_call_id 的 tool 回复」。
 *   原来那段代码是「先把整条 assistant 消息推进消息数组，再逐条执行」，
 *   而逐条执行时一碰到总量上限就 `break` —— 于是这一批里剩下的调用
 *   **永远等不到对应的 tool 回复**，下一次请求直接被后端 400 拒掉：
 *     An assistant message with 'tool_calls' must be followed by tool messages
 *     responding to each 'tool_call_id'. (insufficient tool messages following tool_calls message)
 *   ★ 而且这不是「偶尔」：模型批量要 3+2 条是很常见的，
 *     只要第 2 批装不下，就必然撞上。所以规则定成：
 *     **一批要么整批执行、要么整批拒绝，绝不允许执行一半。**
 *
 * ★ 由此得到一个【可证明】的硬上限：上一批跑完时总量最多是 MAX_TOOL_CALLS - 1 = 3 条，
 *   最后一批最多 MAX_TOOL_CALLS_PER_BATCH = 4 条，所以**任何一次提问最多跑 7 条**。
 *   （本机有一条断言钉着这个 7 —— 它不是注释里的一句说法，是验过的。）
 */
export const MAX_TOOL_CALLS_PER_BATCH = 4

/** 连续几次【完全相同】的调用就直接终止阶段 A。官方文档警告过模型会卡在循环里。 */
export const MAX_CONSECUTIVE_DUPLICATES = 2

/** 重复调用时回给模型的话。抽成常量，脚本逐字断言。 */
export const DUPLICATE_CALL_NOTE =
  '你已经调用过一模一样的这一次了，结果就在前面那条记录里，我没有替你重复执行。' +
  '请不要重复调用 —— 改用已有的结果，或者换一个写法。'

/**
 * 一批里【超出单批上限】的那几条，回给模型的话。
 * ★ 措辞里【不写】「上限 N 次」这种具体数字，理由见下面 TOOL_BUDGET_NOTE。
 */
export const TOOL_BATCH_TOO_LARGE_NOTE =
  `你在一次响应里申请的调用太多了（一次最多 ${MAX_TOOL_CALLS_PER_BATCH} 条），` +
  '这一条【没有执行】。请基于已经拿到的结果写出结论，并如实说明哪些东西你没来得及查。'

/** 工具循环因为别的原因提前结束时，同一批里剩下的那几条该听的话。 */
export const TOOL_LOOP_STOPPED_NOTE =
  '本次的工具循环已经提前结束了，这一条【没有执行】。' +
  '请基于已经拿到的结果写出结论，并如实说明哪些东西你没来得及查。'

/**
 * 到顶之后回给模型的话。
 * ★ 措辞里【不写】「上限 4 次」这种具体数字：最后一批是整批放行的，
 *   实际条数可能真的超过名义上限，写死一个数字就会跟事实打架 ——
 *   而「给模型一句对不上账的话」正是这个项目最怕的那类假话。
 */
export const TOOL_BUDGET_NOTE =
  '本次的工具调用预算已经用完了。请基于已有的结果写出结论，' +
  '并在结论里如实说明哪些东西你没来得及查。'

/* ---------------------------------------------------------------------------
   一之二、跑到一半中断时，每一步该怎么收场
   ---------------------------------------------------------------------------
   ★ 这三个常量是 2026-09-12 补的，起因是用户报上来的一个真实故障：
     浏览器开在 5174、后端只认 5173，于是【第 1 次请求】就被 403 拒掉。
     页面上第 1 步却一直显示「进行中 / 正在把问题交给大模型…」——
     因为第 1 步是在请求发出【之前】标成 running 的，而只有
     `requestCount === 1` 那个成功分支才会把它改成 done（见下面 :267 附近）。
     请求一次都没成功，那个分支就走不到，于是它永远挂着。
   ★ 收尾这件事以前只有 `crashedTrace` 干（页面自己抛异常那条路）。
     而 abort 是【正常返回】，压根走不到那里 —— 同一种症状，另一条路。
   --------------------------------------------------------------------------- */

/** 中断时，还挂着「正在跑」的那一步换成这句。★ 必须换掉 summary，不能只加 note。 */
export const ABORTED_STEP_SUMMARY = '这一步没有跑完 —— 这次分析在模型作答之前就中断了'

/** 上面那句下面那行小字。★ 「不需要做」和「没轮到」是两件事，别混。 */
export const ABORTED_STEP_NOTE =
  '这一步不是「不需要做」，是「没轮到」：模型还没回应，这次分析就中断了。' +
  '停在第几次请求、后端原话是什么，写在页面顶部的横幅里。'

/**
 * 一次工具调用都没发生时，第 2/3/4 步顶上那句。
 *
 * ★ 为什么不能沿用原来那句「模型没有调用任何工具」：
 *   那句话说的是【它的选择】—— 而中断时它压根没有机会选。
 *   「它选择不调」和「它还没来得及」对用户是两件完全不同的事，
 *   后者还要他去重试，前者不用。用错了会把人往错的方向指。
 */
export const ABORTED_BEFORE_REPLY = '模型还没有回应，这次分析就中断了，所以没有可记录的内容'

/** 中断时第 5 步（得到分析结果）换成这句。 */
export const ABORTED_NO_RESULT = '模型这一次没有给出结论 —— 分析在它作答之前就停了'

/* ---------------------------------------------------------------------------
   二、步骤骨架（和 runner 的七步逐字一致）
   --------------------------------------------------------------------------- */

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
    status: 'pending' as const,
  }))
}

/* ---------------------------------------------------------------------------
   三、消息拼装
   --------------------------------------------------------------------------- */

/**
 * 把模型的响应塞回对话里。
 *
 * ★ tool_calls 必须原样带上：OpenAI 形态要求「带 tool_calls 的 assistant 消息」
 *   后面紧跟每一条对应的 tool 消息，少一条、或者顺序错，后端会 400。
 */
function assistantMessage(res: LlmResponse): Record<string, unknown> {
  const msg: Record<string, unknown> = { role: 'assistant', content: res.content || '' }
  if (res.toolCalls.length > 0) {
    msg.tool_calls = res.toolCalls.map((tc) => ({
      id: tc.id,
      type: 'function',
      function: { name: tc.name, arguments: tc.argsRaw },
    }))
  }
  return msg
}

/**
 * 被我们【拒绝执行】的那条调用，回给模型的话。
 *
 * ★ 形状和失败的记录一致（`code` + `message`），模型在 sources / 结论里
 *   会如实说「这一条没做成」，而不会以为它返回了空数据。
 *
 * ★ 这个函数存在的全部理由，一句话：**每一条 tool_call 都必须有一条 tool 回复。**
 *   少一条，下一次请求就被后端 400 拒掉（复现过程见 MAX_TOOL_CALLS_PER_BATCH 的注释）。
 *   所以它宁可「回一句拒绝」，也绝不能「不回」。
 */
function refusedToolMessage(
  callId: string,
  reason: { code: string; message: string },
): Record<string, unknown> {
  return { role: 'tool', tool_call_id: callId, content: JSON.stringify(reason) }
}

function toolMessage(callId: string, record: ToolCallRecord): Record<string, unknown> {
  return {
    role: 'tool',
    tool_call_id: callId,
    content: JSON.stringify(record.ok ? record.forModel : record.error),
  }
}

/** 第 1 步要展示的「模型第一次响应」。工具调用和它自己写的那条 SQL 就是它的「理解」。 */
function describeFirstResponse(res: LlmResponse): string {
  const parts: string[] = []
  if (res.content.trim()) parts.push(res.content.trim())
  for (const tc of res.toolCalls) {
    parts.push(`▸ 请求调用工具 ${tc.name}，参数：\n${tc.argsRaw}`)
  }
  return parts.join('\n\n')
}

/* ---------------------------------------------------------------------------
   四、主流程
   --------------------------------------------------------------------------- */

export async function runLlmAnalysis(
  question: string,
  options: LlmRunOptions,
): Promise<AgentTrace> {
  const days = options.days ?? 30
  const callLlm: LlmCaller = options.callLlm ?? ((req) => postLlm(req))
  const callPy: PyCaller = options.callPy ?? ((req) => postPy(req))

  const pair = getWindowPair(days)
  const { startDate, endDate } = pair.current

  const steps = freshSteps()
  const warnings: string[] = []
  const emit = () => options.onStep?.(steps.map((s) => ({ ...s })))

  /* ---- 口径说明卡片：逐字来自真源码，也是第 1 步要展开给人看的东西 ---- */
  const dialectCard = buildDialectCard({ days, startDate, endDate })

  /* ---- 会话。★ 不传 conversation 时这里就是一个空会话，
          下面每一处都会退化成单轮提问的行为。 ---- */
  const conversation = options.conversation ?? emptyConversation()
  const turnKind: TurnKind = options.turnKind ?? 'ask'

  /* ---- 历史那一段。没有任何历史时 text 是空串，下面【连消息都不发】 ---- */
  const history = buildHistoryNote(conversation)

  /* ---- 请求发出【之前】就能如实说的上下文。
     ★ 为什么要在发请求之前就算出来、还要显示在页面上：
       万一这里继承错了（该带「18-24 岁」却没带），用户【当场】就能看见，
       而不是等模型答完才发现它答的是全站 —— 那时候已经没法追溯了。 ---- */
  const contextIn: TurnContext = buildContextIn(conversation, days)

  /* ---- 前几轮核对通过的数字。★ 只取还在历史里的那几轮：
     更早的轮次没有发给模型，它不可能引用到，把它们算进来只会掩盖真问题。 ---- */
  const priorNumbers = conversation.turns
    .slice(-MAX_HISTORY_TURNS)
    .flatMap((t) => t.carriedNumbers)
  /* ---- 本会话（含本轮）累计跑了几次工具。历史各轮的次数记在摘要里。 ---- */
  const priorToolCalls = conversation.turns.reduce((sum, t) => sum + t.toolCalls, 0)

  const messages: unknown[] = [
    { role: 'system', content: buildSystemPrompt(dialectCard, options.backend.pythonOk) },
  ]
  /* ★ 没有历史时【一条消息都不多】：系统提示词拼出来的那个数组
       必须和单轮提问时一模一样。多插一条空的历史消息，单轮那条路径就变了。 */
  if (history.text) {
    messages.push({ role: 'user', content: history.text })
  }
  messages.push({
    role: 'user',
    content: `${question}\n\n${buildContextNote(days, startDate, endDate)}`,
  })

  const records: ToolCallRecord[] = []
  const requestMs: number[] = []
  const usage: LlmRunDetail['usage'] = {
    promptTokens: 0,
    completionTokens: 0,
    totalTokens: 0,
    reasoningTokens: 0,
  }
  let firstResponse = ''
  let reasoning: string | null = null
  let requestCount = 0
  let lastContent = ''

  /* ---- 数据库：和规则路径同一套语义（没写字段 / 写 null / 写执行器） ---- */
  const exec: SqlExecutor | null =
    'executor' in options ? (options.executor ?? null) : await getSharedSqlEngine(options.onProgress)
  const engineMode: AgentTrace['engineMode'] = exec ? exec.mode : 'none'
  if (!exec) {
    const reason = getEngineError()
    warnings.push(`数据库引擎启动失败，模型写的 SQL 无法在本机执行：${reason ?? '原因未知'}`)
  }

  const ctx: ToolContext = { exec, py: callPy, previous: records }

  /* ---- 第 1 步在请求发出【之前】就标成 running：这是真实状态，不是进度表演 ---- */
  steps[0] = { ...steps[0], status: 'running', summary: '正在把问题交给大模型…' }
  steps[3] = { ...steps[3], status: 'running', summary: '正在准备数据库…' }
  emit()

  /* =======================================================================
     阶段 A：工具循环
     ======================================================================= */
  let aborted: LlmAbort | null = null
  let toolBudgetHit = false
  /*
    ★ 这个计数器必须活在【请求之外】。

      第一版把它写在「处理一次响应里的所有工具调用」那个循环内部，
      于是每来一次新响应就被清零 —— 而模型卡在重复调用上时，
      每一轮恰好只发一个重复调用，计数永远到不了 2，
      「连续两次重复就停」这条规则【一次都没有生效过】。

      表现是：模型一直在重复，我们一直在让它重复，
      每一轮都白白花一次请求的钱，直到撞上 4 次工具调用上限才停。
      不报错、不抛异常，只是账单变贵、答案变差。
      （这一条是被「模型连续重复调用」那一种情况逮住的：断言「连续两次就停」，
      实际跑了 3 次。）
  */
  let consecutiveDuplicates = 0

  try {
    while (requestCount <= MAX_TOOL_CALLS) {
      const res = await callLlm({ messages, tools: TOOL_DEFS })
      requestCount++
      requestMs.push(res.ms)
      usage.promptTokens += res.usage.promptTokens
      usage.completionTokens += res.usage.completionTokens
      usage.totalTokens += res.usage.totalTokens
      usage.reasoningTokens += res.usage.reasoningTokens

      if (requestCount === 1) {
        firstResponse = describeFirstResponse(res)
        reasoning = res.reasoning
        /* ★ 第一次响应回来了 = 我们真的知道模型「理解」成了什么。
           这一步的 summary 不是我们编的，是它自己写出来的工具调用。 */
        steps[0] = {
          ...steps[0],
          status: 'done',
          summary:
            res.toolCalls.length > 0
              ? `大模型自己决定调用 ${res.toolCalls.length} 个工具（未走本地关键词规则）`
              : '大模型【没有调用任何工具】，直接开始作答',
        }
        emit()
      }

      lastContent = res.content || lastContent

      /* ---- 它想直接作答了 → 阶段 A 结束 ---- */
      if (res.toolCalls.length === 0) break

      messages.push(assistantMessage(res))

      let stop = false
      /* 从某一条起不再执行（但【仍然逐条回话】）。null = 还在执行。
         ★ 为什么是「拒绝的理由」而不是一个布尔：整批里被拒的那几条，
           原因可能是「一次要太多」，也可能是「循环已经因为别的原因停了」——
           这两种话不能混成一句，否则又是「对不上账的解释」。 */
      let deny: { code: string; message: string } | null = null

      for (let i = 0; i < res.toolCalls.length; i++) {
        const tc = res.toolCalls[i]

        /* ---- 单批上限：这一批要得太多了 ----
           ★ 注意这里【不 break】——一旦 break，这批里后面的调用就等不到 tool 回复，
             下一次请求必然 400（详见 MAX_TOOL_CALLS_PER_BATCH 的注释）。 */
        if (i >= MAX_TOOL_CALLS_PER_BATCH) {
          deny = { code: 'TOOL_BATCH_TOO_LARGE', message: TOOL_BATCH_TOO_LARGE_NOTE }
          toolBudgetHit = true
        }

        if (deny) {
          stop = true
          messages.push(refusedToolMessage(tc.id, deny))
          continue
        }

        /* ---- 重复调用：不重复执行，把已发生过的那一次指给它 ---- */
        const dup = records.find((r) => r.name === tc.name && r.argsRaw === tc.argsRaw)
        if (dup) {
          consecutiveDuplicates++
          const dupRecord: ToolCallRecord = {
            index: records.length + 1,
            name: tc.name === 'python_analysis' ? 'python_analysis' : 'sql_query',
            argsRaw: tc.argsRaw,
            args: null,
            ok: false,
            forModel: null,
            full: null,
            error: {
              code: 'DUPLICATE_CALL',
              message: `${DUPLICATE_CALL_NOTE}（第 ${dup.index} 次调用是完全一样的，${
                dup.ok ? '它成功了' : '它失败了'
              }。）`,
            },
            ms: 0,
          }
          records.push(dupRecord)
          messages.push(toolMessage(tc.id, dupRecord))
          if (consecutiveDuplicates >= MAX_CONSECUTIVE_DUPLICATES) {
            warnings.push(
              `模型连续 ${consecutiveDuplicates} 次重复了完全相同的工具调用，已提前结束工具循环。`,
            )
            stop = true
            /* ★ 同样【不 break】：这一批里排在它后面的调用还没回话。
               不给它一个 deny 的话，它们会照着上面那条路继续真的执行下去 ——
               那就成了「说了停、其实没停」。 */
            deny = { code: 'TOOL_LOOP_STOPPED', message: TOOL_LOOP_STOPPED_NOTE }
          }
          continue
        }

        consecutiveDuplicates = 0
        const record = await executeToolCall(records.length + 1, tc.name, tc.argsRaw, ctx)
        records.push(record)
        messages.push(toolMessage(tc.id, record))
      }

      /* ---- 这一批跑完，总量到顶了 → 收工去作答 ----
         ★ 这个判断原来写在 for【里面】（每执行一条查一次），那正是「执行一半」的来源：
           它在半路 break 掉，把这一批剩下的调用留成了没有回复的孤儿。
           现在它挪到整批之外：**先让整批把话回完，再决定停不停**。 ---- */
      if (records.length >= MAX_TOOL_CALLS) {
        toolBudgetHit = true
        stop = true
      }

      if (stop) break
    }
  } catch (e) {
    aborted = describeAbort(e, requestCount + 1)
  }

  /* =======================================================================
     阶段 B：作答（★ 不带任何工具）
     ======================================================================= */
  let answer = parseLlmAnswer('')
  let answerFailed = false

  if (!aborted) {
    try {
      if (toolBudgetHit) messages.push({ role: 'user', content: TOOL_BUDGET_NOTE })
      messages.push({ role: 'user', content: buildAnswerInstruction() })

      const res = await callLlm({ messages, jsonMode: true })
      requestCount++
      requestMs.push(res.ms)
      usage.promptTokens += res.usage.promptTokens
      usage.completionTokens += res.usage.completionTokens
      usage.totalTokens += res.usage.totalTokens
      usage.reasoningTokens += res.usage.reasoningTokens
      reasoning = reasoning ?? res.reasoning
      answer = parseLlmAnswer(res.content || lastContent)
    } catch (e) {
      /* ★ 决定 5：这里【绝不】回退到规则模板。
         退回去的话，用户会把模板写的结论当成模型写的 —— 那是最坏的一种失败。 */
      aborted = describeAbort(e, requestCount + 1)
      answerFailed = true
    }
  }

  /* =======================================================================
     机器核对：数字有没有出处 / 有没有把跌说成涨
     ======================================================================= */
  const auditText = auditedText(answer)
  const windowNums = windowNumbers(days, startDate, endDate)

  /* ★ 核对范围从「本次运行」扩到「本次会话」：第四项参数就是前面几轮核对通过的
     那些数字。模型答「和第二名相比呢」时必然要引用上一轮的数字，
     不带上它们的话每一个都会被判成「没找到出处」—— 那是假告警，
     而假告警比不检查更糟，它会让这个核对器整个失去信任。
     单轮提问时 priorNumbers 是空数组，行为与不传历史时完全一致（scope 会是 'run'）。 */
  const audit = verifyNumbers(auditText, records, windowNums, priorNumbers)
  audit.noToolCalls = records.length === 0
  const growthWarning = verifyGrowthClaim(auditText, records)
  const directionWarning = verifyDirectionClaim(auditText, records)

  /* ---- 本轮核对通过、可以带进下一轮的数字。
     ★ 用的是和上面【同一份正文、同一份工具结果】——
       两边各拼一份的话，会出现「核对说有出处、下一轮说没有」这种
       两边都不报错的矛盾。 ---- */
  const carried = carriedNumbers(auditText, records, windowNums)

  /* ---- 把模型这一轮自报的上下文并进会话。---- */
  const merged = mergeContext(conversation.current, answer.context, { days })
  /* ★ 模型申报了「和 XX 相比」却没提主对象 —— 说明它把主对象覆盖掉了。
     覆盖之后卡片上看起来一切正常（就是少了一边），不查就永远发现不了。 */
  const comparisonWarning = checkComparison(merged.current)
  if (comparisonWarning) warnings.push(comparisonWarning)

  /* ★ 上面那条的【反方向】：上一轮在对比，这一轮对比对象没了。
     本机那些断言只覆盖了「有对比对象没主对象」那一半 ——
     两半合起来才拦得住「比较是增维不是覆盖」。 */
  const comparisonLostWarning = checkComparisonLost(conversation.current, merged.current)
  if (comparisonLostWarning) warnings.push(comparisonLostWarning)

  /* ★ 模型【嘴上】说的时间范围和本次真正跑的窗口对不上。
     用 auditedText(answer) 而【不另拼一份正文】：核对器和这条警告必须看同一份字，
     两边各拼一次的话，迟早出现「核对说没问题、警告说有问题」而两边都不报错。

     ★ 只在模型【没有】申报 requestedDays 时才可能挂这条 ——
       申报了的话前端会把窗口真的拨过去，那条路由页面上的横幅说明
       （它同时还要说清「这份结果还是旧窗口的」）。
       两边都说 = 同一件事说两遍，而用户会以为是两个不同的问题。 */
  if (answer.requestedDays === null) {
    const windowWarning = windowMismatchNote(auditedText(answer), days)
    if (windowWarning) warnings.push(windowWarning)
  }

  /* ★ 这句话原来是【无条件】说的，中止时它是假的 —— 而且是假的两次：
     「没有调用任何工具」是真的，但「就直接给出了结论」不是（它压根没答上来）。
     后来新加的那条「中止时屏幕上不许出现那三句假话」逮住了它。
     中止那一族的说明由页面顶部的横幅负责，这里只补一句真的。 */
  if (audit.noToolCalls) {
    warnings.push(
      aborted
        ? ABORTED_BEFORE_REPLY
        : '模型没有调用任何工具就直接给出了结论，本次结论没有真实数据支撑。',
    )
  }
  if (audit.missing.length > 0) {
    warnings.push(`结论里有 ${audit.missing.length} 个数字在工具结果里找不到出处。`)
  }
  if (growthWarning) warnings.push(growthWarning)
  if (directionWarning) warnings.push(directionWarning)

  /* =======================================================================
     拼计划、拼轨迹
     ======================================================================= */
  const parts = llmPlanFromCalls(question, records, days)
  const pick = pickChartable(records)
  /* ★ 每一次工具调用（SQL 的和 Python 的）原样包成第 4 步认的 SqlOutcome ——
     这样第 4 步的卡片（代码框 + 结果表 + 耗时 + 行数）一行不改就能渲染。
     失败的也放进去：它要以「没跑成」的样子出现在页面上，而不是消失。 */
  const outcomes: SqlOutcome[] = []
  /*
    ★ sqlQueries 只装 SQL，尽管 outcomes 装了全部 —— 这是有意的，别改成
      `outcomes.map((o) => o.spec)`。

      plan.queries 还有两个别的消费者，两个都会被 Python 记录带坏：
        1. 「本次准备了 N 条 SQL」这类摘要文案；
        2. 代码标签页的「SQL 1 / SQL 2 / SQL 3」编号 ——
           多一条 Python 进去，编号就错位了，而错位不报错。
      判据取 r.name（记录上的真实工具名），不取 spec.language ——
      language 是给代码框上色用的，不写时的默认值是 undefined（当 SQL 处理），
      拿它反推来源就是把「怎么显示」当成了「是什么」。
  */
  const sqlQueries: SqlQuerySpec[] = []

  /* ★ 记录 → 它包成的那条 spec 的 id。挑图时要靠它把
     `pickChartable` 挑中的那条【结果】指回第 4 步里对应的那一张卡片。
     不记这张表、改用 outcomes[i] 的下标，就依赖了「一条记录必产出一条 outcome」
     这个今天恰好成立的不变量 —— recordToSpec 哪天多一个 return null，图会静静地画错一条。 */
  const outcomeIdOf = new Map<ToolCallRecord, string>()

  for (const r of records) {
    const spec = recordToSpec(r)
    if (!spec) continue
    outcomeIdOf.set(r, spec.id)
    if (r.name === 'sql_query') sqlQueries.push(spec)
    outcomes.push({
      spec,
      status: r.ok ? 'done' : 'error',
      rows: (r.full?.rows ?? []) as unknown as SqlOutcome['rows'],
      rowCount: r.full?.rowCount ?? 0,
      ms: r.ms,
      error: r.error?.message,
    })
  }

  /* ---- 本次要画的那张图：挑得出就画，挑不出来就如实说明为什么 ----
     ★ 这里【现算】出图计划，再让 plan.charts 跟着它走，而不是各算各的。
       两处各判一次的话，哪天判据微调一处，就会出现
       「charts 说有一张图、但图没有数据来源」——而那不报错，只是一张空白卡片。
     ★ 挑图规则和「挑不出来时怎么说」都已经写在 verify.ts / tools.ts 里了，
       这里一行都不重写：noChartNote() 当初就是为这个位置写的，此前零调用者。 */
  const pickedId = pick ? outcomeIdOf.get(pick.record) : undefined
  const chartPlan: LlmChartPlan =
    pick && pickedId
      ? {
          kind: 'chart',
          outcomeId: pickedId,
          labelKey: pick.labelKey,
          valueKey: pick.valueKey,
        }
      : { kind: 'none', note: noChartNote(records) }

  const match: MatchResult = llmMatch(question, days)

  const executedSql = records.filter((r) => r.name === 'sql_query' && r.ok)
  const executedPy = records.filter((r) => r.name === 'python_analysis' && r.ok)
  const okCalls = records.filter((r) => r.ok)

  steps[1] = {
    ...steps[1],
    status: 'done',
    summary:
      records.length === 0
        ? '模型没有调用任何工具，所以没有可记录的计划'
        : `${parts.planSteps.length} 步（事后从 ${records.length} 次真实调用记录生成）`,
    note: POST_HOC_PLAN_NOTE,
  }
  steps[2] = {
    ...steps[2],
    status: 'done',
    summary:
      parts.tools.length === 0
        ? '本次没有任何工具被执行'
        /* ★ 工具的「执行方式」必须查 MODE_LABEL，不能直接打印 t.mode ——
           那样中文界面上会冒出「SQL 取数（live）+ 本机 Python（server）」，
           英文枚举值直接漏给用户看。而且 'server' 这个值恰恰是
           「本机真起了一个 Python 进程」，是这一页最要紧的证据之一，
           更不许糊。 */
        : parts.tools
            .map((t) => `${t.tool === 'sql' ? 'SQL 取数' : 'Python 分析'}：${MODE_LABEL[t.mode]}`)
            .join('；'),
  }
  steps[3] = {
    ...steps[3],
    /* ★ 成功判据是「有没有任何一次调用成功」，不是「有没有 SQL 成功」。
       只认 SQL 的话，模型只用 Python 跑成了一次、页面上却把第 4 步标成
       'error' —— 显示成「全都没成」，而其实成了一步。 */
    status: records.length === 0 ? 'skipped' : okCalls.length > 0 ? 'done' : 'error',
    summary:
      records.length === 0
        ? '模型没有调用任何工具，本次没有执行任何查询'
        : okCalls.length > 0
          ? describeExecution(executedSql, executedPy)
          : `${records.length} 次工具调用全部没成功`,
    note: exec
      ? undefined
      : engineFailureNote(getEngineError()) + '（模型写的 SQL 因此没有真跑）',
  }
  steps[4] = {
    ...steps[4],
    status: 'done',
    summary: `模型给出了 ${answer.evidence.length} 项结构化数据依据`,
  }
  steps[5] = {
    ...steps[5],
    status: 'done',
    summary: answerFailed
      ? '模型这一次没有给出结论，请看重试按钮'
      : '1 条整体分析，含【数据事实】【原因假设】【业务建议】三段',
  }
  steps[6] = {
    ...steps[6],
    status: 'done',
    summary: `数字核对 ${audit.matched} / ${audit.total}；${auditSentence(audit)}`,
  }
  emit()

  /* --------------------------------------------------------------------------
     ★ 中止收尾：跑完了、但没跑完，得有人把话说清楚（2026-09-12 补）
     --------------------------------------------------------------------------
     上面那些步骤赋值【一眼都不看 aborted】—— 它们全是照着「模型做过什么」写的。
     模型一次都没答上来的时候，那些话就全是假的：

       · 第 1 步还挂着 'running' +「正在把问题交给大模型…」（用户看到的就是它）
       · 第 2/3/4 步说「模型没有调用任何工具」—— 它不是没调，是还没轮到
       · 第 4 步是 'skipped'（不需要做）—— 该说「没轮到」
       · 第 5 步说「1 条整体分析，含…三段」—— 一条都没有
       · 第 6 步的徽章写着「已完成」，卡片正文却在说「没有结论」

     ★ 收尾按【证据】走，不搞一刀切：
       `records.length > 0` 的中止（第一次响应成了、第二次才挂的那种）
       说明模型【真的】调过工具、第 4 步的卡片里【真的】有结果 ——
       那时候把这些改掉反而是新的假话，所以那一步跳过。
     -------------------------------------------------------------------------- */
  if (aborted) {
    /* ① 还挂着「正在跑」的步骤一律收场。第 1 次请求就被拒时，这里动的就是第 1 步。 */
    steps.splice(
      0,
      steps.length,
      ...demoteRunningSteps(steps, ABORTED_STEP_SUMMARY, ABORTED_STEP_NOTE),
    )

    if (records.length === 0) {
      /* ② 请求一次都没成功过：第 2/3/4 步那三句「模型没有调用任何工具」全换掉。 */
      steps[1] = { ...steps[1], status: 'error', summary: ABORTED_BEFORE_REPLY, note: undefined }
      steps[2] = { ...steps[2], status: 'error', summary: ABORTED_BEFORE_REPLY, note: undefined }
      /* ③ 第 4 步同理 —— 而且状态要从「不需要做」改成「没轮到」。 */
      steps[3] = {
        ...steps[3],
        status: 'error',
        summary: ABORTED_BEFORE_REPLY,
        note: ABORTED_STEP_NOTE,
      }
    }

    /* ④ 第 5 步（得到分析结果）：只要中断就没有结论可给。
          以前只有【阶段 B 失败】那条路（answerFailed）会这么说，
          第 1 次请求就死的时候它说的是「1 条整体分析，含…三段」。 */
    steps[4] = { ...steps[4], status: 'error', summary: ABORTED_NO_RESULT }

    /* ★ 第 6 步（业务洞察）刻意不动：AgentWorkflow 已经在 trace.aborted 时
       改显示 LLM_ABORTED_NO_INSIGHT 了。但它的【徽章】跟着 steps[5].status 走，
       上面①不一定覆盖得到它（第 1 次请求就死时它是 'done'）—— 所以这里补一刀。 */
    steps[5] = { ...steps[5], status: 'error', summary: ABORTED_NO_RESULT }

    emit()
  }

  const plan: AgentPlan = {
    question,
    days,
    startDate,
    endDate,
    match,
    intent: LLM_INTENT,
    slots: parts.slots,
    planSteps: parts.planSteps,
    tools: parts.tools,
    /* ★ 有计划才声明有图 —— 和上面那处同源，不是又判了一遍。 */
    charts: chartPlan.kind === 'chart' ? ['llmBars'] : [],
    queries: sqlQueries,
    pyCaseIds: [],
    steps,
    warnings: [...warnings],
  }

  const data = buildAnalysisData(plan, outcomes, [])
  data.llmAnswer = answer
  data.llmChart = chartPlan

  const llm: LlmRunDetail = {
    mode: 'llm',
    provider: options.backend.provider,
    providerLabel: options.backend.providerLabel,
    model: options.backend.model,
    requestCount,
    toolCalls: records,
    usage,
    requestMs,
    dialectCard,
    firstResponse,
    reasoning,
    answerPhaseHadTools: false,
    audit,
    growthWarning,
    directionWarning,
    noToolCalls: records.length === 0,

    /* ---- 多轮对话。★ 单轮提问时这些字段全都取
           「这一轮就是全部」的诚实值，不是 null —— 页面渲染时不用到处判空。 ---- */
    turnKind,
    contextIn,
    contextOut: merged.current,
    contextOrigins: merged.origins,
    /* ★ 下面三样属于【主动划出 MVP 范围】的能力，这一版没有接上：
         · followUps    —— 等提示词开始要求模型给后续问题、本地派生也要接
         · analysisPath —— 等指标拆解框架接上（模型才报得出「拆解 / 下钻 / 落点」）
         · announcedPlan —— 等系统提示词要求它「动手之前先申报打算怎么查」
       现在留空数组 / null 是【诚实】的：我们确实还没问过它，所以它确实没申报。
       先摆一个假值（比如把事后计划抄过来）才是这个项目最怕的那种假话。 */
    followUps: [],
    analysisPath: [],
    announcedPlan: null,
    /* ★ used 可以【大于】cap —— 最后一批是整批放行的（见 MAX_TOOL_CALLS_PER_BATCH）。
       所以「超了」这件事必须由 why 自己说出来，不能让页面显示一个「6 / 4」
       而没有任何解释。 */
    toolBudget: {
      used: records.length,
      cap: MAX_TOOL_CALLS,
      why: records.length > MAX_TOOL_CALLS ? 'batch' : 'default',
    },
    carriedNumbers: carried,
    sessionToolCalls: priorToolCalls + records.length,
    /* ★ 丢历史必须【说出来】。静默截断的话模型会突然「失忆」，
       而用户毫不知情，只会觉得这次回答莫名其妙地变差了。 */
    historyNote: history.dropped > 0 ? HISTORY_DROPPED_NOTE : null,
    /* ★ 模型申报的「用户想换成几天」。页面据此把窗口按钮拨过去 ——
       但【只是拨按钮，不自动重跑】：重跑要重新查一遍库、还要多花一轮模型调用的钱。 */
    requestedDays: answer.requestedDays,
  }

  const trace: AgentTrace = {
    mode: 'llm',
    plan: { ...plan, steps },
    steps,
    data,
    engineMode,
    llm,
    warnings: plan.warnings,
  }
  if (aborted) trace.aborted = aborted
  return trace
}

/* ---------------------------------------------------------------------------
   四之二、首屏骨架：大模型路径【没有】同步算得出来的计划
   ---------------------------------------------------------------------------
   ★ 规则路径能先画前三步，是因为 planAgent() 是同步的、毫秒级的 ——
     匹配规则、拟计划、列工具，全在本地算完。
     大模型路径没有这个：在模型回第一个字之前，我们【真的不知道】它要查什么。
     所以那时候能显示的只有七步骨架本身。

   ★ 这两件事必须如实分开，不能为了「首屏好看」编一份假计划出来 ——
     编一份的话，第 2 步会显示一份模型根本没做过的计划，
     而它在模型真正回答之后又会被替换掉，用户看不出自己刚才看的是假的。

   ★ 为什么把骨架放在这个文件里、而不是放在页面里拼：
     页面自己再拼一份七步，两份迟早不一样（标题、顺序、初始状态），
     而且不一样的时候【不会报错】，只会让首屏和工作流里的步骤对不上号。
     freshSteps() 是那两个地方唯一的真相来源。
   --------------------------------------------------------------------------- */

/**
 * 大模型路径的「问题理解」结果。
 *
 * ★ 三个字段是【刻意】写成这样的，不是随手填的空值：
 *   · `hits: []`   —— 这一次一个关键词规则都没跑过。这不是「没命中」，
 *                     是「压根没有规则参与」。页面上必须按后者说。
 *   · `unmatched: false` —— 它不是「没匹配到」，它是「不需要匹配」。
 *                     写成 true 的话，页面会挂一句「已按通用概览处理」，
 *                     而这次根本没有兜底这回事。
 *   · `score: 0`   —— 规则得分在这次分析里没有意义。
 *
 * ★ 所以页面【不能】拿 hits.length === 0 去判断「兜底了」——
 *   那个判据在大模型路径下恒为真，见 AgentWorkflow 里那段注释。
 */
export function llmMatch(question: string, days: number): MatchResult {
  return {
    intentId: 'llm',
    score: 0,
    hits: [],
    entities: { days },
    alternates: [],
    unmatched: false,
    normalized: question,
  }
}

/**
 * 首屏骨架：七步都在，前两步等着，第 4 步已经在建库。
 *
 * ★ `data: null` 是刻意的 —— 这时候【一份结果都还没有】。
 *   塞一份空数据进去的话，第 5 步会把「模型没有给出结论」那句话
 *   显示出来，而模型这会儿正在写、并没有失败。
 *   页面对 data===null 的处理早就有了（规则路径在请求发出前就是这个形状）。
 */
export function llmSkeletonTrace(question: string, days: number): AgentTrace {
  const { startDate, endDate } = getWindowPair(days).current

  const steps = freshSteps()
  /* 和 runLlmAnalysis 里那两行同源：这两件事在请求发出之前就真的已经在做了，
     不是进度表演（数据库确实在后台建，问题确实已经要发出去了）。 */
  steps[0] = { ...steps[0], status: 'running', summary: '正在把问题交给大模型…' }
  steps[3] = { ...steps[3], status: 'running', summary: '正在准备数据库…' }

  const plan: AgentPlan = {
    question,
    days,
    startDate,
    endDate,
    match: llmMatch(question, days),
    intent: LLM_INTENT,
    /* 六项全空：模型会做什么，此刻没有任何人知道。 */
    slots: [],
    planSteps: [],
    tools: [],
    charts: [],
    queries: [],
    pyCaseIds: [],
    steps,
    warnings: [],
  }

  return {
    mode: 'llm',
    plan,
    steps,
    data: null,
    engineMode: 'none',
    warnings: [],
  }
}

/* ---------------------------------------------------------------------------
   五、失败描述
   --------------------------------------------------------------------------- */

function sumRows(rs: ToolCallRecord[]): number {
  return rs.reduce((s, r) => s + (r.full?.rowCount ?? 0), 0)
}

/**
 * 第 4 步那句摘要：逐个数清楚这一步到底发生了什么。
 *
 * ★ 三件事都是真事实，不是措辞：跑了几条 SQL、几次交给 Python、各返回多少行。
 *   分开写而不是合成一句「跑了 N 次工具」，是因为这两件事的性质完全不同 ——
 *   SQL 在浏览器里跑（数据不出这台电脑），Python 在本机起了一个真进程。
 *   合成一句就等于把「本机真起了一个 Python 进程」这个证据抹掉了。
 *
 * ★ Python 单独也成一格：模型完全可能只调 Python（那就没有 SQL 可报），
 *   写成「其中 N 次是 Python」的话，那种情况下这句话读起来是断的。
 */
function describeExecution(sql: ToolCallRecord[], py: ToolCallRecord[]): string {
  const parts: string[] = []
  if (sql.length > 0) {
    parts.push(`真跑了 ${sql.length} 条模型自己写的 SQL，共返回 ${sumRows(sql)} 行`)
  }
  if (py.length > 0) {
    parts.push(
      sql.length > 0
        ? `另有 ${py.length} 次交给本机真 Python 算，返回 ${sumRows(py)} 行`
        : `这一步没有用 SQL —— ${py.length} 次全部交给本机真 Python 算，返回 ${sumRows(py)} 行`,
    )
  }
  return parts.join('；')
}

/**
 * 把一次失败翻译成「停在第几次请求 + 为什么」。
 *
 * ★ 保留后端给的 code：401（key 不对）/ 429（额度或限流）/ 超时 / 连不上，
 *   用户要做的事完全不同（换 key / 等一会儿 / 看看窗口关了没）。
 *   笼统说一句「请求失败」等于把已经拿到手的具体原因扔掉。
 *
 * ★ LlmAbort 是 interface（不是 class），所以这里不能写 instanceof ——
 *   靠「有没有 atRequest 这个字段」认它已经算过的那种情况。但那种情况
 *   实际上不会走到这里（我们只在 catch 里构造一次），留着只是为了
 *   万一将来有人把它 throw 出来时不会变成一句「未知错误」。
 */
function describeAbort(e: unknown, atRequest: number): LlmAbort {
  const o = e as { atRequest?: number; code?: string; message?: string; detail?: string }
  if (typeof o?.atRequest === 'number' && typeof o?.code === 'string') {
    return { atRequest: o.atRequest, code: o.code, message: o.message ?? '', detail: o.detail ?? '' }
  }
  return {
    atRequest,
    code: o?.code ?? 'LLM_UNKNOWN',
    message: e instanceof Error ? e.message : String(e),
    detail: o?.detail ?? '',
  }
}

/** 给本机检查用的：伪造一个「后端探测成功」，脚本就不用真起后端。 */
export function fakeBackend(overrides: Partial<LlmBackend> = {}): LlmBackend {
  return {
    provider: 'deepseek',
    providerLabel: 'DeepSeek',
    model: 'deepseek-chat',
    pythonOk: true,
    ...overrides,
  }
}
