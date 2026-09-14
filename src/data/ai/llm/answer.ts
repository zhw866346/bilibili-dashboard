/* ==========================================================================
   把模型写的那段文字解析成结构化结论
   --------------------------------------------------------------------------
   ★ 三级降级，一级都不能省 —— 每一级都是实测会遇到的情况：

     ① 直接 JSON.parse 成功            → 正常路径（给了 response_format，多数是这条）
     ② 外面裹了 ```json 围栏、或者前后有废话 → 剥出来再 parse
        （实测：即使给了 response_format，模型偶尔还是会加围栏或加一句"好的，如下："）
     ③ 都失败                          → 【不崩】。把原文如实渲染出来，并挂一条警告
        说明「本次没有按结构化格式返回」。

     ★ 第 ③ 级存在的理由：它是最容易被偷懒省掉的一级，也是唯一一级
       「省掉之后页面会白屏」的地方。宁可显示一段没结构的话，
       也不要让用户看到一片空白 —— 而且那段话本身是真的（模型确实这么说的）。

   ★ 这个文件【不做】的事：不去判断结论对不对、不去编缺失的字段。
     解析只负责「把形状理好」；判断对错是 verify.ts 和数字核对器的事。
   ========================================================================== */

import type { EvidenceItem } from '../types'
import type { LlmAnswer, TurnContext } from './types'
import { isAllowedDays } from './window'

/** 第 ③ 级降级时，第 5 步顶上要说的那句话。抽成常量，页面上照抄，脚本逐字断言。 */
export const UNSTRUCTURED_CONCLUSION =
  '模型这一次没有按约定的结构化格式返回结论，所以这一段没有内容。下面是它的原文，请自行判断。'

/** 三级降级都失败时，结论段留空，但页面必须给一句解释而不是空白。 */
export const EMPTY_ANSWER_NOTE =
  '模型这一次没有返回任何可用的内容（既不是结构化结论，也没有原文）。'

/* ---------------------------------------------------------------------------
   一、把可能裹着围栏的文本里的 JSON 抠出来
   --------------------------------------------------------------------------- */

function tryParseObject(text: string): Record<string, unknown> | null {
  const trimmed = text.trim()
  if (!trimmed) return null

  // ① 直接 parse
  const direct = safeParse(trimmed)
  if (direct) return direct

  // ② 去掉 Markdown 代码围栏
  const fenced = trimmed.match(/```(?:json)?\s*([\s\S]*?)```/i)
  if (fenced) {
    const inner = safeParse(fenced[1].trim())
    if (inner) return inner
  }

  // ③ 取第一个 { 到最后一个 } 之间那段（前后有废话的情况）
  const start = trimmed.indexOf('{')
  const end = trimmed.lastIndexOf('}')
  if (start >= 0 && end > start) {
    const inner = safeParse(trimmed.slice(start, end + 1))
    if (inner) return inner
  }
  return null
}

function safeParse(text: string): Record<string, unknown> | null {
  try {
    const v = JSON.parse(text)
    return v && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : null
  } catch {
    return null
  }
}

/* ---------------------------------------------------------------------------
   二、字段规整
   --------------------------------------------------------------------------- */

/**
 * ★ 每一个字段都用 `asText` / `asList` 包一层。
 *   模型偶尔会给出数字、null、或者嵌套对象 —— 直接塞进 React 会让页面
 *   蹦出一个 object 或者 `NaN`。这里全部转成字符串，宁可显示得难看一点，
 *   也不能让页面出现脏字符。
 */
function asText(v: unknown): string {
  if (typeof v === 'string') return v.trim()
  if (typeof v === 'number' && Number.isFinite(v)) return String(v)
  if (v === null || v === undefined) return ''
  if (Array.isArray(v)) return v.map(asText).filter(Boolean).join('；')
  if (typeof v === 'object') return Object.values(v as object).map(asText).filter(Boolean).join('；')
  return String(v)
}

function asList(v: unknown): string[] {
  if (Array.isArray(v)) return v.map(asText).filter(Boolean)
  const t = asText(v)
  return t ? [t] : []
}

/** 把 evidence 里的每一项转成页面认的 EvidenceItem。缺 label 或 value 的整条丢掉。 */
function asEvidence(v: unknown): EvidenceItem[] {
  if (!Array.isArray(v)) return []
  const out: EvidenceItem[] = []
  for (const raw of v) {
    if (!raw || typeof raw !== 'object') continue
    const o = raw as Record<string, unknown>
    const label = asText(o.label ?? o.name ?? o.metric)
    const value = asText(o.value ?? o.current)
    if (!label || !value) continue
    const item: EvidenceItem = { label, value }
    const compare = asText(o.compare ?? o.compareValue ?? o.baseline)
    const delta = asText(o.delta ?? o.change ?? o.changePct)
    const sample = asText(o.sample ?? o.sampleSize ?? o.note)
    if (compare) item.compare = compare
    if (delta) item.delta = delta
    if (sample) item.sample = sample
    out.push(item)
  }
  return out
}

/* ---------------------------------------------------------------------------
   二之二、模型自报的「这一轮在分析什么」
   ---------------------------------------------------------------------------
   ★ 为什么键名要写成「或」的形式：模型对同一个意思会换着法儿地起名字。
     多认几个别名，比因为一个字段名没对上就整条丢掉划算得多。

   ★ 为什么【不认】模型报的时间范围：卡片上的时间范围必须来自本次查询
     真正用的那个窗口（`plan.days`）。采信模型说的话，就会出现
     「卡片写着近 7 天、而 SQL 其实跑在 30 天上」——
     这种错不报错，而且会让用户把结论读错。
   --------------------------------------------------------------------------- */

function asContext(v: unknown): TurnContext | null {
  if (!v || typeof v !== 'object' || Array.isArray(v)) return null
  const o = v as Record<string, unknown>

  const ctx: TurnContext = {}
  const topic = asText(o.topic ?? o.subject ?? o.object)
  const segment = asText(o.segment ?? o.group ?? o.ageGroup ?? o.cohort)
  const comparedWith = asText(o.comparedWith ?? o.compareWith ?? o.versus)
  const metric = asText(o.metric ?? o.indicator)

  if (topic) ctx.topic = topic
  if (segment) ctx.segment = segment
  if (comparedWith) ctx.comparedWith = comparedWith
  if (metric) ctx.metric = metric

  /* 一个字段都没解析出来 → 返回 null（= 模型没申报），
     而不是返回一个空对象。两者在合并规则里是不同的分支：
     空对象会被当成「它申报了，只是没说」，
     而 null 才是「它这次没说」。 */
  return Object.keys(ctx).length > 0 ? ctx : null
}

/* ---------------------------------------------------------------------------
   二之三、模型申报的「用户想换成几天」
   ---------------------------------------------------------------------------
   ★ 为什么必须【闭集校验】，而不是「是个正数就收」：
     窗口按钮只有 7 / 14 / 30 三个。模型报一个 9，前端就会去 setDays(9) ——
     按钮一个都不亮、而计划仍然是 9 天，页面进入一种谁也说不清的状态。
     闭集外的值一律当「没申报」，这是最保守、也最好解释的处理。

   ★ 为什么接受字符串：模型对数字字段会写成 "7"（尤其在它想强调的时候）。
     只为这一个键做数字/字符串归一，比因为引号就整条丢掉划算 ——
     和 asContext 认多个别名的理由一样。
   --------------------------------------------------------------------------- */

function asRequestedDays(v: unknown): number | null {
  const n =
    typeof v === 'number'
      ? v
      : typeof v === 'string' && /^\s*\d+\s*$/.test(v)
        ? Number(v)
        : NaN
  return isAllowedDays(n) ? n : null
}

/* ---------------------------------------------------------------------------
   三、入口
   --------------------------------------------------------------------------- */

/**
 * 解析模型的最终输出。
 * ★ 这个函数【永远不抛异常】—— 最差的情况也会返回一个带原文的 unstructured 结果。
 */
export function parseLlmAnswer(content: unknown): LlmAnswer {
  const raw = typeof content === 'string' ? content : asText(content)
  const obj = tryParseObject(raw)
  const conclusion = obj ? asText(obj.conclusion ?? obj.core ?? obj.summary) : ''

  /* ---- 第 ③ 级：没解析出结论，就把原文如实端上来 ---- */
  if (!obj || !conclusion) {
    const text = raw.trim()
    return {
      conclusion: '',
      evidence: [],
      explanation: text || EMPTY_ANSWER_NOTE,
      suggestions: [],
      sources: [],
      /* 原文渲染出来的答案【不带上下文】：它连结论都没解析出来，
         更不可能知道自己在分析什么。硬凑一个（比如把上一轮继承过来）
         会让卡片上一半是模型说的、一半是我们替它说的，而用户分不出来。 */
      context: null,
      /* 同上：原文渲染时连结论都没解析出来，不可能知道用户想换几天。
         硬猜一个（比如从正文里正则抠一个「7 天」）会让窗口自己跳走 ——
         而那正是这一版要杜绝的「不经申报就改窗口」。 */
      requestedDays: null,
      /* ★ unstructured 的含义是「它【说了话】，但那话不是约定的格式」。
         一个字都没回时不能标这一段 —— 否则页面会说「模型这一次没有按约定的
         结构化格式返回结论」，而真相是它压根没回（超时、断线、被限流）。
         两种情形的处理方式完全不同：一个要重试，一个要换问法。
         （这一条是被「请求超时」那一种情况逮住的：那一轮页面上说的是
         「没按格式返回」，读起来像模型答得不好，实际是请求压根就没成。） */
      unstructured: text.length > 0,
      rawText: raw,
    }
  }

  /* ---- 第 ①② 级：结构化成功 ---- */
  return {
    conclusion,
    evidence: asEvidence(obj.evidence),
    explanation: asText(obj.explanation ?? obj.analysis ?? obj.reasoning),
    suggestions: asList(obj.suggestions ?? obj.actions ?? obj.recommendations),
    sources: asList(obj.sources ?? obj.dataSources),
    context: asContext(obj.context),
    requestedDays: asRequestedDays(obj.requestedDays ?? obj.requested_days),
    unstructured: false,
  }
}
