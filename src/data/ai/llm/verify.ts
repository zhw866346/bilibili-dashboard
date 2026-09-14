/* ==========================================================================
   机器核对：模型有没有编数字 / 有没有把跌说成涨
   --------------------------------------------------------------------------
   ★ 有了大模型之后，这一页最大的风险不是「答不出来」，是
     「编一个看起来很合理的数字」。语法通顺、量级合理、还带着单位 ——
     人眼几乎不可能发现。所以必须有机器来数。

   ★ 这里【刻意不做的两件事】，都写清楚边界，免得看的人以为它管得更多：

     1. 不判断数字对不对，只判断「有没有出处」。
        它能拦住「凭空出现的 12,345」，拦不住「把 8162 写成 8261」。
        后者要靠第 4 步的结果表人手对。

     2. 不核对正负号。
        按【数值大小】核 —— 因为中文里「下跌了 5.4%」里的 5.4 是个正数写法，
        工具返回的是 -5.4。要求符号一致会造出大量假告警，
        而假告警比不检查更糟：它会让以后所有的告警都没人信（项目里栽过三次）。
        符号的问题由下面 verifyGrowthClaim 单独兜一层。
   ========================================================================== */

import { AGE_GROUPS } from '../../../utils/ageGroup'
import { CATEGORIES } from '../../../utils/categories'
import { COMPLETION_THRESHOLD } from '../../metrics'
import { TOOL_DEFS } from './prompt'
import { FOR_MODEL_ROWS, pickChartable } from './tools'
import { ROW_CAP } from './sqlGuard'
import type { LlmAnswer, ToolCallRecord, NumberAudit } from './types'


/* ---------------------------------------------------------------------------
   一、允许出现的「结构性数字」
   ---------------------------------------------------------------------------
   ★ 为什么必须有这一份：结论里不可避免地会出现一些【不是数据】的数字 ——
     「近 30 天」「8 个内容分区」「4 个年龄段」「占比 100%」。
     不把它们放进来，核对器会一律标成「找不到出处」，
     于是每次分析都挂着一串假告警。假告警比不检查更糟。
   --------------------------------------------------------------------------- */

export const STRUCTURAL_NUMBERS: number[] = [
  // 序号与小计数：中文正文里到处是「第 1 步」「2 个工具」
  0, 1, 2,
  // 百分比的基数
  100,
  // 本页的两个真实上限（都来自代码，不是手写的数）
  ROW_CAP,
  ROW_CAP + 1,
  FOR_MODEL_ROWS,
  // 完播门槛（口径里就有它，模型会引用）
  COMPLETION_THRESHOLD,
  // 分档数与分区数 —— 从真源码取，改分档规则时自动跟着变
  AGE_GROUPS.length,
  CATEGORIES.length,
  // 工具个数
  TOOL_DEFS.length,
  /* 年龄分档的边界。★ 少了它们，模型每写一次「40 岁以上」就会被记为
     「40 这个数字找不到出处」—— 而 40 是分档定义里就有的，不是数据。
     （max = 999 是「没有上界」的哨兵值，不是真的上界，所以不放进白名单。） */
  ...AGE_GROUPS.flatMap((g) => (g.max >= 200 ? [g.min] : [g.min, g.max])),
]

/* ---------------------------------------------------------------------------
   二、把「有出处的数字」收集成一个集合
   --------------------------------------------------------------------------- */

/**
 * 把数字规范化成可比较的字符串。
 * ★ 只保留数值本身，逗号去掉（"1,234" → "1234"）。
 */
function canon(n: number): string {
  return String(Number(n))
}

/**
 * 往集合里放一个数，连同它的各种取整写法。
 *
 * ★ 为什么要放取整写法：模型写「30.3%」，工具返回的是 30.2958 ——
 *   这【不是编的】，是四舍五入。只认原值会把每一次正常的取整都报成假告警。
 *   代价是「30」这种粗数字也能对上 30.2958，可以接受：
 *   这个核对器拦的是「凭空出现的 12345」，不是「少写了一位小数」。
 */
function addNumber(set: Set<string>, v: unknown): void {
  const n = typeof v === 'number' ? v : Number(v)
  if (!Number.isFinite(n)) return
  set.add(canon(n))
  set.add(canon(Math.abs(n)))
  for (let k = 0; k <= 4; k++) {
    const r = Number(n.toFixed(k))
    set.add(canon(r))
    set.add(canon(Math.abs(r)))
  }
}

/**
 * 一格结果里的数字。
 *
 * ★ 字符串也要扫，这一步【不能省】：年龄段在结果里是 `'18-24'` 这样的字符串，
 *   分区名、日期也都是字符串。不扫的话，模型每写一次「18-24 岁」
 *   就会被记成「18 和 24 这两个数字找不到出处」——
 *   而它们就是工具返回的那个值本身。这是假告警，而假告警比不检查更糟：
 *   它会让以后所有的告警都没人信（项目里栽过三次）。
 */
function addCell(set: Set<string>, v: unknown): void {
  if (typeof v === 'string') {
    for (const raw of extractNumbers(v)) addNumber(set, Number(raw))
    return
  }
  addNumber(set, v)
}

/** 把一个记录里所有出现过的数字都收进来。 */
function addRecord(set: Set<string>, rec: ToolCallRecord): void {
  // 行数本身也是真实数据（模型会说「一共 8 行」）
  if (rec.full) set.add(canon(rec.full.rowCount))
  set.add(canon(rec.index))
  for (const row of rec.full?.rows ?? []) {
    for (const v of Object.values(row)) addCell(set, v)
  }
}

/**
 * 「有出处」的全部数字 —— 结构化数字 + 窗口自带的数 + 本次工具结果里出现过的每一个数。
 *
 * ★ 抽成一个函数，是因为它现在有【两个】调用方：核对（verifyNumbers）
 *   和「把本轮核对通过的数字记下来给下一轮用」（carriedNumbers）。
 *   两处各拼一份的话，哪天 whitelist 的构成改了一处、漏了另一处，
 *   就会出现「核对说这个数字有出处、而下一轮说它没出处」——
 *   两边都不报错，只是同一件事有两种说法。
 */
function buildHaystack(records: ToolCallRecord[], extraNums: number[]): Set<string> {
  const haystack = new Set<string>()
  for (const n of STRUCTURAL_NUMBERS) addNumber(haystack, n)
  for (const n of extraNums) addNumber(haystack, n)
  for (const rec of records) addRecord(haystack, rec)
  return haystack
}

/** 这个数字（按原样写法的字符串）在集合里找得到吗。大小写号都认，理由见 addNumber。 */
function hasNumber(set: Set<string>, raw: string): boolean {
  const n = Number(raw)
  if (!Number.isFinite(n)) return false
  return set.has(canon(n)) || set.has(canon(Math.abs(n)))
}

/** 结论文本里认出来的数字。 */
export function extractNumbers(text: string): string[] {
  const out: string[] = []
  // ★ 前后都不能紧跟着别的数字或小数点，避免把 "2026-09-10" 拆出半个来
  const re = /\d[\d,]*(?:\.\d+)?/g
  let m: RegExpExecArray | null
  while ((m = re.exec(text)) !== null) {
    const raw = m[0].replace(/,/g, '')
    if (raw === '' || raw === '.') continue
    out.push(raw)
  }
  return out
}

/* ---------------------------------------------------------------------------
   三、核对
   --------------------------------------------------------------------------- */

/**
 * @param text         要核对的全部文字（结论 + 分析说明 + 依据 + 建议）
 * @param records      本次所有工具调用记录（唯一权威）
 * @param extraNums    额外的允许值（比如本次窗口的天数、日期的年月日）
 * @param priorNumbers 前面几轮【核对通过】的数字。
 *   ★ 为什么需要它：用户问「和第二名相比呢」，模型必然要引用上一轮的数字。
 *     没有这一项的话，那些数字会被一路判成「找不到出处」——
 *     **假告警比不检查更糟**：它会让人开始不信任这个核对器。
 *   ★ 为什么只带「核对通过的」这一小撮，而不是把上一轮工具结果里的几千个数字
 *     全搬过来：下一轮真正会引用的，几乎总是它上一轮报出来的那几个头条数字；
 *     搬全套会让页面状态失控，而收益接近于零。
 *     代价是：上一轮查了但没报的数字，这一轮引用时仍会被判成没出处 ——
 *     那个方向的错是**偏保守**的（只说「没找到出处」，没有替谁背书）。
 */
export function verifyNumbers(
  text: string,
  records: ToolCallRecord[],
  extraNums: number[] = [],
  priorNumbers: string[] = [],
): NumberAudit {
  const haystack = buildHaystack(records, extraNums)

  /* 前面几轮的数字单独一个集合。命中的话要【分开计数】——
     「本次查到的」和「上一轮查到的」是两件事，混在一起数就没法如实说明。 */
  const prior = new Set<string>()
  for (const raw of priorNumbers) addNumber(prior, raw)

  const found = extractNumbers(text)
  const missing: string[] = []
  let matched = 0
  let matchedFromPrior = 0
  const seen = new Set<string>()

  for (const raw of found) {
    const n = Number(raw)
    if (!Number.isFinite(n)) continue
    const key = canon(n)
    /* 先看本次，再看前面几轮。顺序不能反：两处都有时算「本次查到的」，
       因为那个出处在页面上是看得见的（第 4 步的结果卡里就有）。 */
    if (hasNumber(haystack, raw)) {
      matched++
    } else if (hasNumber(prior, raw)) {
      matched++
      matchedFromPrior++
    } else if (!seen.has(key)) {
      seen.add(key)
      missing.push(raw)
    }
  }

  return {
    total: found.length,
    matched,
    missing,
    noToolCalls: records.length === 0,
    matchedFromPrior,
    scope: prior.size > 0 ? 'conversation' : 'run',
  }
}

/**
 * 要核对的「正文」到底是哪几段。
 *
 * ★ 抽成一处的理由和 buildHaystack 一样，但这边更要紧一点：
 *   核对的是它、**记进历史给下一轮看的也是它**。
 *   两处各拼一份的话，会出现「核对时没算进去的一段、下一轮却当数据转述了」——
 *   而那正好是「模型编的数字借历史洗白」这条路的入口。
 */
export function auditedText(answer: LlmAnswer): string {
  return [
    answer.conclusion,
    answer.explanation,
    ...answer.evidence.flatMap((e) => [
      e.label,
      e.value,
      e.compare ?? '',
      e.delta ?? '',
      e.sample ?? '',
    ]),
    ...answer.suggestions,
  ].join('\n')
}

/**
 * 本轮【核对通过】的那些数字 —— 下一轮引用它们时，就不该再被记成「没出处」。
 *
 * ★ 为什么不能把本次工具结果里的全部数字（也就是 buildHaystack 返回的那一整袋）
 *   搬给下一轮：那动辄成千上万个，会让会话状态无限膨胀；而下一轮真正会引用的，
 *   几乎总是它上一轮报出来的那几个头条数字。这里只留「本轮真的写出来了、
 *   而且确实有出处」的那些，条数天然被结论的长度限住。
 * ★ 代价写清楚：上一轮查了、但没写进结论的数字，下一轮引用时仍会被判成没出处。
 *   这个方向的错是【偏保守】的 —— 只说「没找到出处」，没有替谁背书。
 */
export function carriedNumbers(
  text: string,
  records: ToolCallRecord[],
  extraNums: number[] = [],
): string[] {
  const haystack = buildHaystack(records, extraNums)
  const out: string[] = []
  const seen = new Set<string>()
  for (const raw of extractNumbers(text)) {
    const n = Number(raw)
    if (!Number.isFinite(n)) continue
    const key = canon(n)
    if (seen.has(key)) continue
    if (!hasNumber(haystack, raw)) continue
    seen.add(key)
    out.push(raw)
  }
  return out
}

/** 把 'YYYY-MM-DD' 挪 n 天。走 UTC，避免本地时区把日期挪错一天（和 halfWindow.ts 同一条规矩）。 */
function shiftDate(date: string, n: number): string | null {
  const t = Date.parse(`${date}T00:00:00Z`)
  if (!Number.isFinite(t)) return null
  return new Date(t + n * 86_400_000).toISOString().slice(0, 10)
}

/**
 * 本次窗口自带的那些数。
 *
 * ★ 「窗口自带」的边界要说清楚（动之前先读完）：
 *   下面这几个数，模型【不查任何东西】就知道 —— 它们是窗口的定义本身，
 *   不是被测量出来的数据，所以说了不算编：
 *     · 窗口天数（「近 7 天」）
 *     · 窗口首尾两天（卡片和上下文里就写着 2026-09-04 ~ 2026-09-10）
 *     · ★ 对半切之后两段各有几天（7 天切出来是 3 + 4）
 *     · ★ 切分点本身：前半段的最后一天、后半段的第一天
 *
 * ★ 为什么后两条非加不可（这是实测出来的，不是推理）：
 *   问题②③问的都是「窗口前后两段之比」，而两段的【起止日】和【各自几天】
 *   是回答里非说不可的两件事 —— 口径本身就要求写明「两段天数常常不等，
 *   只能比日均」，不写清楚这个数，结论就是不可信的。
 *   不加进白名单的话，模型一写「前半段到 09-06 为止，只有 3 天」，
 *   核对器就会记成「3 和 06 这两个数字找不到出处」，页面上挂出一条
 *   「结论里有数字没找到出处」的告警 —— 而那是窗口自带的日期，它只是在做算术。
 *   → 这是【假告警】。而假告警比不检查更糟：它会让以后所有的告警都没人信
 *     （这个项目里已经栽过三次）。
 *   → 实测：7 / 14 / 30 三个窗口上都会出现这条假告警。
 *
 * ★ 为什么【只】加这四天，不把窗口里每一天都放进来：
 *   窗口内部的日期（比如 09-08）如果出现在结论里，它就该来自某次工具返回的结果 ——
 *   而结果表里的字符串是会被扫描的（见 addCell），所以真查过的日期照样认得出来。
 *   只把「不查也知道」的那几个放进来，白名单才不会被撑大。
 *   （同一条纪律：dialect.ts 那张卡片只放口径、不放数据。）
 */
export function windowNumbers(days: number, startDate: string, endDate: string): number[] {
  const out = [days]
  /* 对半切之后两段各有几天。⌊n/2⌋ 和 n−⌊n/2⌋ —— 7 天切出来是 3 + 4，
     和 analyze.py 的 build_category_trend() 用的是同一条切法。
     ★ 两个数都放进去：模型说「前 3 后 4」或「前 4 后 3」都成立（它自己选的切法），
       硬钉一个方向会造出新的假告警。 */
  const firstDays = Math.floor(days / 2)
  out.push(firstDays, days - firstDays)

  /* 切分点所在的两天。days < 2 时压根没有「对半切」这回事，
     算出来会是窗口外的一天（start−1）—— 那就不该进白名单。 */
  const splitEnd = firstDays >= 1 ? shiftDate(startDate, firstDays - 1) : null
  const splitStart = firstDays >= 1 ? shiftDate(startDate, firstDays) : null

  for (const d of [startDate, splitEnd, splitStart, endDate]) {
    const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(d ?? '')
    if (m) out.push(Number(m[1]), Number(m[2]), Number(m[3]))
  }
  return out
}

/* ---------------------------------------------------------------------------
   四、把「跌」说成「涨」的拦截
   --------------------------------------------------------------------------- */

/** 变化率类的列名。★ 刻意不包含 rate ——「完播率」不是变化率，混进来会假告警。 */
const CHANGE_COL_RE = /(change|growth|delta)/i

/** 明确表意「在涨」的词。 */
const GROWTH_WORD_RE = /增长|上涨|上升|增幅|增速/

/** 挂出来的警告文案。抽成常量，页面照抄，脚本逐字断言。 */
export const GROWTH_CLAIM_WARNING =
  '模型在这段话里用了「增长 / 上涨」这类说法，但本次工具返回的变化率【全部为负数】。' +
  '请以第 4 步的结果表为准 —— 那种情况下排在最前的是「跌得最少」，不是「增长最快」。'

/** 变化率类列里收集到的所有数值（去重前的原始列表）。 */
export function collectChangeValues(records: ToolCallRecord[]): number[] {
  const out: number[] = []
  for (const rec of records) {
    if (!rec.ok || !rec.full) continue
    for (const col of rec.full.columns) {
      if (!CHANGE_COL_RE.test(col)) continue
      for (const row of rec.full.rows) {
        const v = row[col]
        if (typeof v === 'number' && Number.isFinite(v)) out.push(v)
      }
    }
  }
  return out
}

/**
 * 模型说了「增长」，而工具返回的变化率全是负的 → 返回警告；否则 null。
 *
 * ★ 为什么【不】顺手查「最快」这个词：
 *   「增长最快」和「跌得最少」在中文里都可能带着「最快」，
 *   靠关键词分不出来。硬查会造出假告警，而假告警比不检查更糟。
 *   只查明确表意的增长词，边界写在这里，免得看的人以为它管得更多。
 */
export function verifyGrowthClaim(text: string, records: ToolCallRecord[]): string | null {
  const values = collectChangeValues(records)
  if (values.length < 2) return null
  if (!values.every((v) => v < 0)) return null
  return GROWTH_WORD_RE.test(text) ? GROWTH_CLAIM_WARNING : null
}

/* ---------------------------------------------------------------------------
   四之二、把「趋势在跌」说成「在涨」的拦截（认 direction 那一列）
   ---------------------------------------------------------------------------
   ★ 上面那条为什么漏掉了 trend 任务：
     trend 的返回只有【1 行】，而上面那条要求「变化率至少 2 个值」（values.length >= 2）——
     一条结果就一个数，永远凑不够，于是直接放弃。
     而 pandas 明明把结论算好了：direction 那一列写着「下降」/「上升」/「持平」。

     于是模型拿趋势结果说「呈上升趋势」而 direction 是「下降」时，
     页面上一条警告都没有。数据是机器算出来的，结论是反的，没人拦。
     （实测过：趋势类的问题确实会走到这一条，所以它不是理论风险。）

   ★ 为什么用 direction 做判据【不会】造假告警（而上面那条有可能）：
     它是 pandas 算出来的【机器可读字段】，就是「下降」这两个字本身，
     不需要从散文里猜。矛盾是确定无疑的。
     ★ 但边界要说清楚：判据的另一半仍然在结论那一侧，仍然是关键词 ——
       所以它和上面那条有同一个毛病：一句话里提到「下降」但讲的是别的东西时，
       会误报。因此警告文案里写的是「请以第 4 步的结果表为准」，
       它的定位是【提醒去核对】，不是断定模型一定错了。
   --------------------------------------------------------------------------- */

/** 趋势方向那一列。pandas 的 trend 任务返回的就是这个列名。 */
const DIRECTION_COL_RE = /^direction$/i

/** 明确表意「在跌」的词。 */
const DOWN_WORD_RE = /下降|下跌|下滑|减少|跌幅|衰退|走低/

/** 工具说「下降」而结论在说涨。抽成常量，页面照抄、脚本逐字断言。 */
export const DIRECTION_FALLING_WARNING =
  '模型在这段话里用了「增长 / 上涨 / 上升」这类说法，' +
  '但本次趋势工具返回的 direction 那一列明确写着【下降】。请以第 4 步的结果表为准。'

/** 工具说「上升」而结论在说跌。 */
export const DIRECTION_RISING_WARNING =
  '模型在这段话里用了「下降 / 下跌 / 下滑」这类说法，' +
  '但本次趋势工具返回的 direction 那一列明确写着【上升】。请以第 4 步的结果表为准。'

/** 工具返回里所有出现过的方向值。 */
export function collectDirections(records: ToolCallRecord[]): string[] {
  const out: string[] = []
  for (const rec of records) {
    if (!rec.ok || !rec.full) continue
    for (const col of rec.full.columns) {
      if (!DIRECTION_COL_RE.test(col)) continue
      for (const row of rec.full.rows) {
        const v = row[col]
        if (typeof v === 'string') out.push(v)
      }
    }
  }
  return out
}

/**
 * 工具返回的方向和结论里说的方向相反 → 返回警告；否则 null。
 *
 * ★ 判据是「所有方向都一致时才判」—— 两次趋势调用一个说跌一个说涨的时候，
 *   结论里出现任何一个方向都是合理的，硬判会造出假告警。
 *   这和上面那条用 `values.every(...)` 是同一个纪律。
 *
 * ★ 「持平」刻意不参与判断：真实中文里「基本持平，没有明显上升」是完全正常的一句话，
 *   拿它去撞关键词必然误报。拿不准的边界就写在这里，不要装作管得住。
 */
export function verifyDirectionClaim(text: string, records: ToolCallRecord[]): string | null {
  const dirs = collectDirections(records)
  if (dirs.length === 0) return null
  if (dirs.every((d) => d === '下降') && GROWTH_WORD_RE.test(text)) return DIRECTION_FALLING_WARNING
  if (dirs.every((d) => d === '上升') && DOWN_WORD_RE.test(text)) return DIRECTION_RISING_WARNING
  return null
}

/* ---------------------------------------------------------------------------
   五、把核对结果拼成一句人话（页面直接显示，本机检查逐字断言）
   --------------------------------------------------------------------------- */

/**
 * ★ 返回字符串而不是 JSX，是为了让「页面上说的」和「脚本断言的」是同一份。
 *   这个项目里已经吃过一次亏：同一句话在结论和洞察里各写一份，两边说法打架
 *   而且不报错。
 */
export function auditSentence(audit: NumberAudit): string {
  if (audit.total === 0) {
    return '结论里没有出现任何数字 —— 这一次它没有给出可核对的量化依据。'
  }
  /* ★ 核对范围要如实说出来。多轮追问时（scope='conversation'）
     只写「本次工具返回的结果」是句假话 —— 前几轮核对通过的数字也能对上，
     而且必须说出来是几个，否则用户会以为那个数就是这一轮查出来的。 */
  const head =
    audit.scope === 'conversation'
      ? `结论里一共出现 ${audit.total} 个数字，其中 ${audit.matched} 个能在工具返回的结果里找到出处` +
        `（本次执行 ${audit.matched - audit.matchedFromPrior} 个，前面几轮核对通过的 ${audit.matchedFromPrior} 个）。`
      : `结论里一共出现 ${audit.total} 个数字，其中 ${audit.matched} 个能在本次工具返回的结果里找到出处。`
  if (audit.missing.length === 0) {
    return `${head}没有发现来路不明的数字。`
  }
  return `${head}★ 下面这 ${audit.missing.length} 个没找到出处：${audit.missing
    .slice(0, 12)
    .join('、')}${audit.missing.length > 12 ? ' …' : ''}`
}

/** 第 4 步顶上那条红字（模型一次工具都没调就下结论）。抽成常量供脚本断言。 */
export const NO_TOOL_CALL_WARNING =
  '模型【没有调用任何工具】就直接给出了结论，所以本次结论没有任何真实数据支撑。下面这些话请只当作它的推测。'

/** 图表挑不出来时的说明。 */
export function noChartNote(records: ToolCallRecord[]): string {
  if (records.length === 0) return '本次没有任何工具结果，所以没有可画的图。'
  return differentShapeNote(records)
}

function differentShapeNote(records: ToolCallRecord[]): string {
  const ok = records.filter((r) => r.ok && r.full)
  if (ok.length === 0) return '本次所有工具调用都没成功，所以没有可画的图。'
  return (
    '本次有真结果，但没有一张结果表长得像「一个分类列 + 一个数值列」，' +
    `所以没有画图（一共 ${ok.length} 张结果表，列名分别是：${ok
      .map((r) => r.full!.columns.join('/'))
      .join('；')}）。这是如实说明，不是故障。`
  )
}

/** 给本机检查用的：图表挑选的入口，避免脚本里另写一份规则。 */
export { pickChartable }
