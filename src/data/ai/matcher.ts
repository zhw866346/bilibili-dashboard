/* ==========================================================================
   问题理解 —— 关键词规则引擎
   --------------------------------------------------------------------------
   ★ 先把最重要的说清楚：这里【没有大模型】。
     进来的是一句中文，出去的是「这属于哪一类问题」。
     干这件事的是一套可以逐条读、逐条改的关键词规则，不是神经网络。
     页面上的说法必须和这里一致，不许含糊成「AI 认为」。

   为什么不做成「看起来更聪明」的样子？
     因为规则匹配的毛病（匹不上、匹错）是【可以被读者自己检查】的：
     页面会把命中了哪几个词原样列出来。黑箱反而没法验证。

   ★ 四步走，每一步都能单独读：
     ① 归一化   —— 把各种写法拉平（全角、破折号、大小写）
     ② 抽实体   —— 从句子里认出年龄段、内容分区、时间窗口
     ③ 打分     —— 逐条规则比对，命中就加分
     ④ 决断     —— 取最高分；不够分就走兜底，并如实说没匹配上
   ========================================================================== */

import { AGE_GROUPS } from '../../utils/ageGroup'
import { CATEGORIES } from '../../utils/categories'
import { RANGES } from './demos'
import { INTENTS } from './intents'
import type {
  Intent,
  IntentResolver,
  MatchEntities,
  MatchHit,
  MatchResult,
  MatchRule,
} from './types'

/**
 * 够多少分才算「这是问的那件事」。
 *
 * ★ 这个阈值是防「过度自信」的第二层防线。
 *   定成 1.5 的意思是：光命中「活跃」一个词（1.0 分）不算数，
 *   必须再有「为什么」或者「下降」之类，才认为真的是在问活跃度。
 *   宁可不答，也不要答得头头是道但答错了问题。
 */
export const MATCH_THRESHOLD = 1.5

/* --------------------------------------------------------------------------
   ① 归一化
   -------------------------------------------------------------------------- */

/**
 * 把各种写法拉到同一个平面上。
 *
 * ★ 破折号这一步最要紧：「18–24」「18—24」「18~24」「18到24」「18岁到24岁」
 *   在中文输入里全都很常见，不归一化就一条都匹配不上，
 *   而且【不会报错】——只是静静地什么都匹不到。这类 bug 最难发现。
 */
export function normalize(input: string): string {
  let s = input

  // 全角数字 → 半角
  s = s.replace(/[０-９]/g, (c) => String.fromCharCode(c.charCodeAt(0) - 0xfee0))
  // 全角英文字母 → 半角
  s = s.replace(/[Ａ-Ｚａ-ｚ]/g, (c) =>
    String.fromCharCode(c.charCodeAt(0) - 0xfee0),
  )
  // 全角空格 → 半角
  s = s.replace(/　/g, ' ')

  /*
    各种破折号、以及「到」「至」统一成半角连字符（只动夹在两个数字之间的那种）。

    ★ 两处限制不是随手加的，都是为了不误伤日期：
      · 数字限定 1–2 位  —— 否则「2026-08-12」里的 2026-08 会被当成一个区间；
      · 右侧要求词尾边界 —— 否则「2026-08-12 到 2026-09-10」会被拼成
                             「2026-08-12-2026-09-10」，整个日期烂掉。
      这两种误伤都不会报错，只是默默地让后面的匹配全部落空。

    ★ 结尾的「岁」故意不吃掉：「18岁到24岁」要留下尾巴那个「岁」。
  */
  s = s.replace(/\b(\d{1,2})\s*岁?\s*[–—~～\-－至到]\s*(\d{1,2})\b/g, '$1-$2')

  // 折叠空白 + 转小写（英文关键词统一小写书写）
  return s.replace(/\s+/g, ' ').trim().toLowerCase()
}

/* --------------------------------------------------------------------------
   ② 抽实体
   -------------------------------------------------------------------------- */

/**
 * 年龄段别名。数字区间之外，再认几个最常见的口语说法。
 *
 * ★ 顺序有讲究，而且【不能】靠人记住 —— 靠下面这条断言：
 *   `'中老年'.includes('中年')` 为真，所以「中老年」必须排在「中年」前面。
 *   反过来写的话，「中老年用户最喜欢什么视频」会被认成 32–40 岁，
 *   **不报错**，只是标题上安安静静写着一个错的年龄段。
 *   本机有一条断言专门钉这个先后关系（不是钉某句话匹配对，
 *   而是钉「长的别名排在短的别名前面」这个通则，以后加别名也管得住）。
 *
 * ★ 导出是为了让本机检查能对这张表本身跑通则检查。数据导出去没有副作用，
 *   总比让脚本手抄一份别名表强 —— 手抄的那份改了不会跟着变，
 *   会悄悄变成一张永远通过的检查（项目里已经吃过一次这个亏）。
 */
export const AGE_ALIASES: Record<string, string> = {
  大学生: '18-24',
  学生党: '18-24',
  青年人: '18-24',
  中老年: '40+',
  中年: '32-40',
}

const DAYS_ALIASES: { days: number; re: RegExp }[] = [
  { days: 7, re: /近一周|最近一周|这周|本周|过去一周|七天/ },
  { days: 14, re: /近两周|最近两周|两周|半个月|十四天/ },
  { days: 30, re: /近一个月|最近一个月|一个月|上月|三十天|近月/ },
]

export function extractEntities(text: string): MatchEntities {
  const out: MatchEntities = {}

  /* --- 年龄段 --- */
  for (const g of AGE_GROUPS) {
    if (text.includes(g.id.toLowerCase())) {
      out.ageGroup = g.id
      break
    }
  }
  if (!out.ageGroup) {
    if (/40\s*岁?以上|四十岁?以上/.test(text)) out.ageGroup = '40+'
    else {
      for (const [alias, id] of Object.entries(AGE_ALIASES)) {
        if (text.includes(alias)) {
          out.ageGroup = id as MatchEntities['ageGroup']
          break
        }
      }
    }
  }

  /* --- 内容分区 --- */
  /* 优先认全名；认不到再看有没有「游戏区」这种带后缀的写法 */
  for (const c of CATEGORIES) {
    if (text.includes(c)) {
      out.category = c
      break
    }
  }
  if (!out.category) {
    for (const c of CATEGORIES) {
      if (text.includes(`${c}区`)) {
        out.category = c
        break
      }
    }
  }

  /* --- 时间窗口 --- */
  /* 先看句子里有没有写死的天数；没写再看口语说法 */
  const dayMatch = text.match(/(\d+)\s*天/)
  if (dayMatch) {
    const n = Number(dayMatch[1])
    if (RANGES.some((r) => r.days === n)) out.days = n
  }
  if (out.days === undefined) {
    for (const { days, re } of DAYS_ALIASES) {
      if (re.test(text)) {
        out.days = days
        break
      }
    }
  }

  return out
}

/* --------------------------------------------------------------------------
   ③ 打分
   -------------------------------------------------------------------------- */

/** 对单个意图打分。required 规则没命中就直接返回 null（整个意图出局）。 */
function scoreIntent(
  intent: Intent,
  text: string,
): { intent: Intent; hits: MatchHit[]; score: number } | null {
  const hits: MatchHit[] = []
  let score = 0
  let requiredFailed = false

  for (const rule of intent.rules as MatchRule[]) {
    const keywords = rule.any.filter((k) => text.includes(k))
    if (keywords.length === 0) {
      if (rule.required) requiredFailed = true
      continue
    }
    hits.push({ ruleId: rule.id, label: rule.label, keywords, weight: rule.weight })
    score += rule.weight
  }

  if (requiredFailed || score <= 0) return null
  return { intent, hits, score }
}

/* --------------------------------------------------------------------------
   ④ 决断
   -------------------------------------------------------------------------- */

/**
 * 把一句中文问题理解成「哪一类分析 + 哪些实体」。
 *
 * ★ 三种情况都要有明确、且对用户说得出口的结果：
     命中          → 返回那个意向，并把命中的关键词一并带出来供人检查
     分数不够      → 走 generic，unmatched = true，页面明说没匹配上
     都没命中      → 同上（这是最常见的兜底路径）
 */
export function matchIntent(question: string): MatchResult {
  const normalized = normalize(question)
  const entities = extractEntities(normalized)

  const scored = INTENTS.map((i) => scoreIntent(i, normalized)).filter(
    (x): x is { intent: Intent; hits: MatchHit[]; score: number } => x !== null,
  )

  // 分数高的在前；同分时，更具体的意图（priority 大）在前
  scored.sort((a, b) => b.score - a.score || b.intent.priority - a.intent.priority)

  const top = scored[0]

  if (!top || top.score < MATCH_THRESHOLD) {
    return {
      intentId: 'generic',
      score: top?.score ?? 0,
      /*
        ★ 这里【保留】命中的关键词，而不是清空。
          半匹上的时候，把「看到了『活跃』这个词但分数不够」如实摆出来，
          比假装什么都没看见更有用——读者能自己判断是规则太严还是问得太偏。
      */
      hits: top?.hits ?? [],
      entities,
      alternates: [],
      unmatched: true,
      normalized,
    }
  }

  return {
    intentId: top.intent.id,
    score: top.score,
    hits: top.hits,
    entities,
    // 同一句话里还够分的其它候选。页面会如实提一句「本次先回答主问题」。
    alternates: scored
      .slice(1)
      .filter((x) => x.score >= MATCH_THRESHOLD)
      .map((x) => x.intent.id),
    unmatched: false,
    normalized,
  }
}

/* --------------------------------------------------------------------------
   接口实现：将来换真大模型，只需要在这里再加一个实现
   -------------------------------------------------------------------------- */

/**
 * 现在唯一的解析器：关键词规则。
 *
 * ★ 这是整个 Stage 7 为大模型预留的【唯一】接口边界。
 *   要接真模型，就在这里加一个 llmResolver，让它返回同样形状的 MatchResult，
 *   runner 和页面一行都不用改。
 *   hits 字段在模型版本里正好可以放模型的「理由」，页面的显示逻辑完全不用动。
 */
export const ruleBasedResolver: IntentResolver = {
  name: '本地关键词规则（未接入大模型）',
  resolve: (question: string) => matchIntent(question),
}
