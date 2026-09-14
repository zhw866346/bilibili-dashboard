/* ==========================================================================
   会话层 —— 多轮对话的「材料」与「卡片」
   --------------------------------------------------------------------------
   ★ 这个文件是干什么的，一句话：
     它把「前几轮发生过什么」压成一段**文字**交给模型，并把模型自报的
     「这一轮在分析什么」合并成一张**卡片**给用户看。

   ★ 三件必须知道的事：

   1. 【这里不发请求、不碰 React】—— 全是纯函数。
      所以它能被命令行脚本直接调、直接断言。
      注意别在这里 import 任何组件或 client，否则脚本跑不起来。

   2. 【历史里只有文字，没有工具消息】。
      上一轮那几十行原始数据行【不回放】给模型，原因不是省 token（那只是顺带），
      而是：Python 工具靠 `source: 3` 引用「第 3 次调用结果」，
      而编号是**每轮从 1 重来**的。把上一轮的 tool 消息拼进来的话，
      历史里就躺着两组都从 1 开始的编号，模型想引上一轮第 3 次、
      却拿到了本轮第 3 次 —— **而且全程不报错**。
      这是这个项目最怕的失败形状，所以要在结构上让它不可能发生，而不是靠提示词提醒。

   3. 【上下文不参与控制流】。
      这个文件产出的东西只做两件事：给模型读、给用户看。
      任何形如 `if (question === '为什么')` 的判断都不许出现在这里或调用方 ——
      「他们」是谁，由模型读了上面的历史自己判断，我们不替它猜。

   4. 【时间范围永远从真实的 days 生成】，不采信模型说的话。
      模型把窗口理解成 7 天、而查询实际跑在 30 天上，是真实会发生的；
      那时候卡片上必须写 30 天（真话），另推一条警告，见 CONTEXT_WINDOW_MISMATCH。
   ========================================================================== */

import type { AgentTrace, EvidenceItem } from '../types'
import type {
  ContextField,
  ContextOrigin,
  ConversationState,
  TurnContext,
  TurnDigest,
} from './types'

/* ---------------------------------------------------------------------------
   一、预算与文案常量
   ---------------------------------------------------------------------------
   ★ 字符预算钉的是【字符数】不是 token 数：字符数是本地算得准的，
     token 数只是估算 —— 拿一个估算的尺子做闸门，闸门本身就不准。
   --------------------------------------------------------------------------- */

/** 最多带几轮历史给模型。更早的轮次会被丢掉，并如实告诉用户（见下面的 NOTE）。 */
export const MAX_HISTORY_TURNS = 3

/** 历史那一段的字符预算。超了就先降级成简写、再不够就丢最旧的。 */
export const MAX_HISTORY_CHARS = 6000

/** 单条 SQL 在历史里最多留多少个字符 */
export const MAX_SQL_CHARS = 400

/** 每轮最多转述几条数据依据 */
export const MAX_EVIDENCE_ITEMS = 6

/** 结论转述时的截断长度 */
export const MAX_CONCLUSION_CHARS = 300

/**
 * 历史被裁掉时对用户说的话。
 * ★ 丢历史必须【说出来】：静默截断会让模型突然「失忆」，而用户毫不知情，
 *   只会觉得这次回答莫名其妙地变差了。
 */
export const HISTORY_DROPPED_NOTE =
  `本次只带了最近 ${MAX_HISTORY_TURNS} 轮对话，更早的轮次没有一起发给模型` +
  '（这是有意的：把每轮的工具结果都带上会让上下文无限增长）。' +
  '所以它可能不记得更早的事 —— 如果需要，请你把那件事重新说一遍。'

/**
 * 上一轮没跑成任何工具时，历史里替代它结论的那句话。
 * ★ 为什么不能照转它的结论：那样模型编的数字会借着历史「洗白」成有出处的数字 ——
 *   下一轮的结论里写着它、核对器却发现不了它有问题。
 */
export const HISTORY_UNGROUNDED_NOTE =
  '上一轮没有跑成任何工具，所以它当时说的那些不能当数据用，这里不转述。'

/** 历史段的开头。 */
export const HISTORY_HEADER = '【本次会话的历史（只读材料，不是你这一轮要分析的对象）】'

/** 历史段的结尾两行。★ 第二行是「编号作废」那条硬规则，别删。 */
export const HISTORY_TAIL =
  '★ 上面这些数字来自【前面的轮次】，本轮还没有重新核对过。\n' +
  '★ 上一轮的调用编号【已经作废】：本轮你要引用数据，必须在本轮重新调用 sql_query。\n' +
  '  不要写「引用第 3 次调用」这种跨轮的说法 —— 每一轮的编号都是从 1 重新开始的。'

/**
 * 模型口头说的时间范围和本次真实窗口对不上时的警告。
 * ★ 这是「不许假装一致」的机器落点：卡片上写真的那个，另挂一条说清差在哪。
 */
export const CONTEXT_WINDOW_MISMATCH =
  '模型把时间范围理解成了它自己说的那个，但本次查询实际跑的是另一个窗口 —— ' +
  '请以卡片上写的窗口为准。要换成另一个区间，请重新提问一次。'

/* ---------------------------------------------------------------------------
   二、小工具
   --------------------------------------------------------------------------- */

/** 去空格；空串、纯空白、非字符串一律当「没说」处理（返回 undefined）。 */
function clean(v: unknown): string | undefined {
  if (typeof v !== 'string') return undefined
  const s = v.trim()
  return s === '' ? undefined : s
}

function cut(s: string, max: number): string {
  return s.length <= max ? s : `${s.slice(0, max)}…`
}

/** 取第一句（用于把结论压成一句话）。 */
export function firstSentence(text: string): string {
  const s = (text ?? '').trim()
  if (!s) return ''
  const m = s.split(/(?<=[。！？!?])/)[0] ?? s
  return cut(m.trim(), MAX_CONCLUSION_CHARS)
}

/** 窗口的中文说法。★ 全项目只有这一处生成它，卡片和提示词都用它。 */
export function windowText(days: number): string {
  return `近 ${days} 天`
}

/* ---------------------------------------------------------------------------
   三、上下文的初始化、继承与合并
   --------------------------------------------------------------------------- */

/** 一次全新的会话。点「新建分析」就是回到这里。 */
export function emptyConversation(): ConversationState {
  return { turns: [], current: {}, origins: {}, deepenDepth: 0 }
}

/**
 * 请求发出【之前】能如实说的那份上下文 —— 第 1 步的卡片就渲染它。
 *
 * ★ 为什么要在发请求之前就渲染：万一继承错了（比如该带 18-24 却没带），
 *   用户【当场】就能看见，而不是等模型答完才发现它答的是全站。
 */
export function buildContextIn(state: ConversationState, days: number): TurnContext {
  return { ...state.current, timeRangeText: windowText(days) }
}

export interface MergeResult {
  current: TurnContext
  origins: Partial<Record<ContextField, ContextOrigin>>
}

/**
 * 把模型这一轮【自报】的上下文并进会话里。
 *
 * ★ 三条规则，每一条都对应一种「不报错、只是静静地错」：
 *
 *   1. 模型报了的字段，以它为准，来源记 'llm'。
 *   2. 模型【换了话题】（topic 变了）却没重新申报某个字段 → 那个字段**丢掉**。
 *      不丢的后果：卡片上顶着「用户群体：18-24」，而这一轮问的其实是全站 ——
 *      一张写着假话的卡片，且没有任何东西会报错。
 *   3. 模型【什么都没报】（没给 context，或者答案是原文渲染出来的）→
 *      全部继承上一轮，来源记 'inherited'，卡片上如实标出来
 *      「这一轮的上下文是继承上一轮的，模型没有重新申报」。
 *
 * ★ 时间范围不在这三条里：它永远由前端从真实的 days 生成（来源恒为 'window'）。
 *
 * ★ 关于「继承」时的来源标记（这里订正过一次，别改回去）：
 *   第一版写的是「沿用上一轮那个字段原来的来源」，于是上一轮模型申报过的字段，
 *   这一轮模型一个字没说、我们只是把它带过来，卡片上却仍然标着「模型申报」——
 *   而卡片上明明写着「说的是【这一轮】」。
 *   用户会以为模型这一轮自己把「他们」消解成了 18-24，其实是我们在引用旧账。
 *   所以继承恒记 'inherited'，不沿用旧来源。
 *   （代价是「原本是模型说的」这条信息丢了 —— 那没关系，它属于上一轮，
 *     翻上一轮那张卡就能看到。）
 */
export function mergeContext(
  prev: TurnContext,
  reported: TurnContext | null,
  facts: { days: number },
): MergeResult {
  const origins: Partial<Record<ContextField, ContextOrigin>> = {}
  const current: TurnContext = {}

  const reportedTopic = clean(reported?.topic)
  const prevTopic = clean(prev.topic)
  /* 「换了话题」= 两边都说了话题，而且说的不是同一个。
     只有一边说了不算换（第一次了解到话题，通常还是接着上一轮在问）。 */
  const topicChanged =
    reportedTopic !== undefined && prevTopic !== undefined && reportedTopic !== prevTopic

  const carried: ContextField[] = ['topic', 'segment', 'comparedWith', 'metric']
  for (const f of carried) {
    const fromModel = clean(reported?.[f])
    if (fromModel !== undefined) {
      current[f] = fromModel
      origins[f] = 'llm'
      continue
    }
    if (topicChanged) continue
    const inherited = clean(prev[f])
    if (inherited !== undefined) {
      current[f] = inherited
      origins[f] = 'inherited'
    }
  }

  current.timeRangeText = windowText(facts.days)
  origins.timeRangeText = 'window'

  const pf = clean(prev.previousFinding)
  if (pf !== undefined) {
    current.previousFinding = pf
    origins.previousFinding = 'inherited'
  }

  return { current, origins }
}

/**
 * 一轮跑完，把它记进会话 —— 这是「这一轮消解出来的东西」进入会话状态的**唯一入口**。
 *
 * ★ 它干两件事，两件都不能少：
 *
 *   1. **把这一轮消解出来的上下文并进 current**。
 *      ★ 这一步是【必需的】，而且第一版真就漏了它 —— 是后来补的检查逮住的：
 *        漏了的话，`state.current` 永远停在初始的空对象上，
 *        下一轮的 `contextIn` 里空空如也，「他们」在第二问就丢了。
 *        而它不会报错：模型那一侧【还是】能从历史文字里读出「他们」是谁，
 *        所以答案看着是对的，只有卡片上少了一行 —— 典型的
 *        「不报错、只是静静地少了一块」。
 *      ★ 用 mergeContext 而不是在这里另写一遍合并规则：两处各写一份的话，
 *        出现「卡片上是一个、继承下去的是另一个」，而且两边都不报错。
 *
 *   2. **把「上一轮结论」更新成本轮结论的第一句** —— 下一轮继承的就是这一句。
 *      结论为空（这次没答上来）时**清掉**它，而不是留一句上一轮的话：
 *      留着的话，下一轮的卡片会指着一句早就过期的结论说「这是上一轮的结论」。
 */
export function appendTurn(state: ConversationState, digest: TurnDigest): ConversationState {
  const merged = mergeContext(state.current, digest.resolved, { days: digest.days })
  const current: TurnContext = { ...merged.current }
  const origins: Partial<Record<ContextField, ContextOrigin>> = { ...merged.origins }

  const pf = firstSentence(digest.conclusion)
  if (pf) {
    current.previousFinding = pf
    origins.previousFinding = 'inherited'
  } else {
    delete current.previousFinding
    delete origins.previousFinding
  }

  return { turns: [...state.turns, digest], current, origins, deepenDepth: state.deepenDepth }
}

/* ---------------------------------------------------------------------------
   四、把历史拼成一段给模型看的文字
   --------------------------------------------------------------------------- */

export interface HistoryNote {
  /** 拼好的历史段。没有任何历史可带时是空串。 */
  text: string
  /** 被丢掉了多少轮 */
  dropped: number
  /** 实际带了几轮 */
  usedTurns: number
}

function evidenceLine(evidence: EvidenceItem[]): string | null {
  const items = evidence.slice(0, MAX_EVIDENCE_ITEMS)
  if (items.length === 0) return null
  const parts = items.map((e) => {
    const bits = [`${e.label}：${e.value}`]
    if (e.compare) bits.push(`（对比 ${e.compare}）`)
    if (e.delta) bits.push(`（变化 ${e.delta}）`)
    return bits.join('')
  })
  return `  它列出的数据依据：${parts.join('；')}`
}

/**
 * 把一轮自报的上下文压成一行**给模型看**的摘要。
 *
 * ★ 为什么必须有这一行（这是一处真实的缺口）：
 *   在这之前，历史里只有「用户问了什么 + 它答了什么」，
 *   **没有「它当时在分析谁」**。于是第二轮问「和 25-31 相比呢」时，
 *   模型只能从上一轮结论的中文里反推主对象是哪一档 —— 推错了也没人知道。
 *   更常见的是「他们」「这个分区」这类指代，模型只能猜。
 *
 * ★ 为什么在这里也带上「对比对象」：它是「增维」的凭据。
 *   上一轮是「18-24 vs 25-31」，这一轮用户接着说「那再加上全站呢」——
 *   模型得先知道上一轮已经在比了，才不会把两边的其中一边丢掉。
 *
 * ★ 不渲染 timeRangeText / previousFinding：
 *   前者的真相在 d.days 里（下面单起一行，用 windowText 生成）；
 *   后者是上一轮结论里的句子，紧接着的「它当时的结论」已经把它说了。
 */
function contextLine(t: TurnContext): string | null {
  const parts: string[] = []
  const topic = clean(t.topic)
  const segment = clean(t.segment)
  const comparedWith = clean(t.comparedWith)
  const metric = clean(t.metric)
  if (topic) parts.push(`分析对象=${topic}`)
  if (segment) parts.push(`用户群体=${segment}`)
  if (comparedWith) parts.push(`对比对象=${comparedWith}`)
  if (metric) parts.push(`指标=${metric}`)
  return parts.length > 0 ? parts.join('、') : null
}

function turnBlock(d: TurnDigest, no: number, level: 'full' | 'short'): string {
  const head = `第 ${no} 轮 · 用户问：${d.question.trim()}`

  /* ★ 没跑成工具的那一轮，【不转述它的结论】。
     转述的话，模型编的数字会借着历史变成「上一轮的数据」，下一轮再引用它时
     连核对器都发现不了 —— 因为它确实「在历史里出现过」。 */
  if (!d.grounded) return `${head}\n  ★ ${HISTORY_UNGROUNDED_NOTE}`

  if (level === 'short') {
    const one = firstSentence(d.conclusion)
    return one ? `${head} → 它当时的结论：${one}` : head
  }

  const lines = [head]
  const ctx = contextLine(d.resolved)
  if (ctx) lines.push(`  它当时分析的是：${ctx}`)
  /* ★ 这一行是无条件的：d.days 一定是个真实的数（取 plan.days，不取模型说的话）。
     在这之前历史里【根本没有窗口】—— 模型连「上一轮看的是几天」都不知道，
     而「最近 7 天呢」这类追问恰恰全靠这个数。 */
  lines.push(`  它那一轮跑的时间窗口：${windowText(d.days)}`)
  const one = firstSentence(d.conclusion)
  if (one) lines.push(`  它当时的结论：${one}`)
  const ev = evidenceLine(d.evidence)
  if (ev) lines.push(ev)
  for (const sql of d.usedSql) {
    lines.push(`  它当时真跑过的查询（可照此改写，但要在本轮重新调用）：${cut(sql.trim(), MAX_SQL_CHARS)}`)
  }
  return lines.join('\n')
}

function renderBlocks(turns: TurnDigest[], startNo: number, level: 'full' | 'short'): string {
  if (turns.length === 0) return ''
  const blocks = turns.map((d, i) => turnBlock(d, startNo + i, level))
  return [HISTORY_HEADER, ...blocks, HISTORY_TAIL].join('\n')
}

/**
 * 拼出这一段历史。三层裁剪，从轻到重：
 *   ① 只留最近 MAX_HISTORY_TURNS 轮；
 *   ② 还超字符预算 → 把每一轮降级成「问题 → 结论第一句」；
 *   ③ 还超 → 从最旧的开始整轮丢掉（哪怕丢到一轮不剩）。
 *
 * ★ 丢了多少轮要如实返回给调用方，它会挂到 `trace.llm.historyNote` 上显示出来。
 *   偷偷丢 = 模型莫名失忆而用户不知道，那是这个页面最不该有的体验。
 */
export function buildHistoryNote(state: ConversationState): HistoryNote {
  const all = state.turns
  if (all.length === 0) return { text: '', dropped: 0, usedTurns: 0 }

  let kept = all.slice(-MAX_HISTORY_TURNS)
  let dropped = all.length - kept.length
  let level: 'full' | 'short' = 'full'
  let text = renderBlocks(kept, all.length - kept.length + 1, level)

  if (text.length > MAX_HISTORY_CHARS) {
    level = 'short'
    text = renderBlocks(kept, all.length - kept.length + 1, level)
  }

  while (text.length > MAX_HISTORY_CHARS && kept.length > 1) {
    kept = kept.slice(1)
    dropped += 1
    text = renderBlocks(kept, all.length - kept.length + 1, level)
  }

  /* 只剩一轮还是超预算 → 整段丢掉。宁可这一轮没有历史，
     也不要让一段被砍得七零八落的文字混进提示词（那比没有更误导）。 */
  if (text.length > MAX_HISTORY_CHARS) {
    return { text: '', dropped: all.length, usedTurns: 0 }
  }

  return { text, dropped, usedTurns: kept.length }
}

/* ---------------------------------------------------------------------------
   五、上下文里对不上号的两种情况（主动查出来，别等它静静地错）
   --------------------------------------------------------------------------- */

export const COMPARISON_LOST =
  '这一轮是对比分析，但上下文里只剩一档了 —— 主对象丢了。' +
  '下面卡片上的「用户群体」只显示了一边，请以第 4 步的结果表为准。'

/**
 * 模型申报了「和 XX 相比」，但主对象不见了 —— 说明它把主对象覆盖掉了。
 * ★ 覆盖之后卡片上看起来一切正常（就是少了一边），不查就永远发现不了。
 */
export function checkComparison(t: TurnContext): string | null {
  if (clean(t.comparedWith) !== undefined && clean(t.segment) === undefined) return COMPARISON_LOST
  return null
}

export const COMPARISON_DROPPED =
  '上一轮是在做对比（有「对比对象」），这一轮的主对象还是同一档、对比对象却没了 —— ' +
  '多半是它把两边合成了一边。下面卡片上的「对比对象」因此少了一行。'

/**
 * 上面那条的【反方向】：上一轮在对比，这一轮对比对象丢了。
 *
 * ★ 两半合起来才拦得住「比较是增维不是覆盖」这件事：
 *     `checkComparison` 拦的是「有对比对象、主对象没了」（主对象被挪进了对比那一格）；
 *     这一条拦的是「主对象还在、对比对象没了」（对比那一边被丢掉了）。
 *   两种失败在卡片上长得很像（都只是少一行），都不会报错。
 *
 * ★ 判据【取松】，和窗口那条警告同一个理由：假告警比不检查更糟。
 *   只有当**这一轮的主对象和上一轮相同**（说明还在同一组对象上）时才提醒。
 *   用户主动说「那 25-31 呢」（换主对象）是合法的【降维】——
 *   那时候 segment 会变成 25-31、和上一轮不同，这一条就放行。
 *   把合法的降维也判成「丢了」，用户就会开始无视这个提示。
 */
export function checkComparisonLost(prev: TurnContext, curr: TurnContext): string | null {
  if (clean(prev.comparedWith) === undefined) return null
  if (clean(curr.comparedWith) !== undefined) return null
  const prevSeg = clean(prev.segment)
  const currSeg = clean(curr.segment)
  if (prevSeg === undefined || currSeg === undefined) return null
  if (prevSeg !== currSeg) return null
  return COMPARISON_DROPPED
}

/* ---------------------------------------------------------------------------
   六、把一次跑完的结果收成「这一轮的摘要」
   ---------------------------------------------------------------------------
   ★ 为什么不把这件事交给 loop.ts 去做：
     loop 的返回值是 AgentTrace，而本机有几十处断言是照着这个形状写的。
     往返回值里加东西，就得动那些断言 —— 而做这一步时最硬的一条验收标准
     恰恰是「原有的检查一个字不改、仍然全绿」。
     所以改成：loop 只管如实把这一轮的产物挂在 trace 上，
     由这个纯函数把 trace 收成摘要，页面调用它。两边都不用改签名。
   --------------------------------------------------------------------------- */

/**
 * 从一次跑完的 trace 收出「这一轮」的摘要。**不是**大模型路径时返回 null。
 *
 * ★ 返回 null 而不是硬凑一份：规则路径（降级时走的那条）里根本没有
 *   `trace.llm`，硬凑出来的摘要会让后面每一轮都继承一份假的上下文 ——
 *   而卡片上看起来一切正常。
 */
export function digestFromTrace(trace: AgentTrace): TurnDigest | null {
  const llm = trace.llm
  if (!llm) return null

  /* ★ trace.data 在类型上可能是 null（规则路径的骨架阶段就是这样）。
     大模型路径跑完之后它一定有，但这里【不假设】——
     用可选链取，拿不到就是「没有结论」，而那是诚实的。 */
  const answer = trace.data?.llmAnswer ?? null
  const usedSql: string[] = []
  for (const r of llm.toolCalls) {
    if (r.name !== 'sql_query' || !r.ok) continue
    const sql = r.args?.sql
    if (typeof sql === 'string' && sql.trim()) usedSql.push(sql.trim())
  }

  return {
    question: trace.plan.question,
    resolved: llm.contextOut,
    /* ---- 没答上来时留空串，不留半句话。
       留半句话的后果是下一轮的历史里会出现一段「它当时的结论：」，后面空着 ——
       而 agent 会照着这半句往下接。 ---- */
    conclusion: answer?.conclusion ?? '',
    evidence: answer?.evidence ?? [],
    usedSql,
    days: trace.plan.days,
    toolCalls: llm.toolCalls.length,
    carriedNumbers: llm.carriedNumbers,
    /* ★ 「有没有真实数据支撑」的判据和页面上的 llmInsight 用同一个：
         本次有没有跑成过工具。不是「有没有结论」——
         模型完全可以在一次工具都没跑成的情况下写出一段很像样的结论。 */
    grounded: llm.toolCalls.some((r) => r.ok),
  }
}
