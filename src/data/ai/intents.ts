/* ==========================================================================
   意图库 —— 「一类问题怎么答」的全套定义
   --------------------------------------------------------------------------
   一个意图 = 识别规则 + 分析计划 + 工具选择 + 要跑的东西 + 结论模板。

   ★ 【已经实现了哪几类问题，唯一的答案是文件末尾的 INTENTS 数组】——
     这里不再抄一份清单。抄一份就会滞后，而「文档和页面互相打脸」正是
     这个项目最不想出现的事。types.ts 的 IntentId 里还会声明一些
     尚未实现的意图，它们匹配不到规则，页面会如实说「还没有专门的分析流程」。
     先声明、后实现，是为了让「还没做」这件事可枚举、可展示，
     而不是含混地让人以为问什么都能答。

   ★ 结论模板是纯函数，只吃 AnalysisData。
     这条约束的意思是：结论里的每一个数，都能在页面上的结果表或对账块里找到出处。
     模板里不允许出现任何硬编码的数字或结论。
   ========================================================================== */

import { formatCount, formatDelta, formatMinutes, formatPercent, withThousands } from '../../utils/format'
import { AGE_GROUP_IDS, ageGroupLabel } from '../../utils/ageGroup'
import { buildSqlCases } from '../sql/cases'
import type { SqlCase, SqlCaseRow } from '../sql/cases'
import type { AgeGroupId } from '../../types'
import type { PyAgePreferenceRow, PyCategoryTrend, PyResults } from '../python/types'
import {
  CATEGORY_TREND_QUERY_ID,
  COMPLETION_RANK_QUERY_ID,
  SEGMENT_TREND_QUERY_ID,
  categoryHalfQuery,
  completionRankQuery,
  newVsReturningQuery,
  segmentTrendQuery,
} from './sqlQueries'
import { halfWindowMix, weekendDauRatio, weekendViewRatio } from './halfWindow'
import { buildWeightComparison, firstInversion, maxDeviationRow } from './weightCompare'
import type { WeightCompareRow } from './weightCompare'
import type {
  AnalysisData,
  CrossCheck,
  EvidenceItem,
  Insight,
  Intent,
  IntentSlot,
  MatchResult,
  PlanStep,
  QueryContext,
  SqlQuerySpec,
} from './types'

/** 取一行的数字，取不到算 0 */
function num(value: unknown): number {
  const n = Number(value)
  return Number.isFinite(n) ? n : 0
}

/**
 * Python 结果里的年龄段 id 是 string —— 那边是 Python，没有 TypeScript 的联合类型。
 * 这里把它收回成 AgeGroupId。
 *
 * ★ 为什么敢断言：results.generated.ts 里的 age 字段由 analyze.py 遍历年龄段定义
 *   生成（4 档一个不多一个不少），本机另有一条检查逐窗口断言了这一点。
 *   即便真混进来一个没见过的 id，ageGroupLabel 会【原样把它显示出来】——
 *   不会崩，也不会安安静静显示成另一个年龄段（后者才是要命的）。
 */
const asAge = (id: string): AgeGroupId => id as AgeGroupId

function rowsOf(d: AnalysisData, queryId: string): SqlCaseRow[] {
  return d.outcomes.find((o) => o.spec.id === queryId)?.rows ?? []
}

/**
 * 把 SQL 分析页的案例包装成本页的查询规格。
 *
 * ★ 这里【不重抄 SQL】。抄一份就意味着以后改了口径要改两个地方。
 *   取回来还有个额外好处：页面可以理直气壮地写
 *   「这条 SQL 与 SQL 分析页的案例 01 是同一条，结果可以逐行对照」。
 */
function fromSqlCase(
  cases: SqlCase[],
  id: string,
  crossCheck?: (rows: SqlCaseRow[], py: PyResults, days: number) => CrossCheck | null,
): SqlQuerySpec {
  const c = cases.find((x) => x.id === id)
  if (!c) {
    // 写错 id 要立刻炸出来，不能悄悄少跑一条。
    // 运行时由 runner 兜住（会转成警告 + 降级），开发期由本机检查当场发现。
    throw new Error(`AI 助手引用了不存在的 SQL 案例：${id}`)
  }
  return {
    id: `case:${c.id}`,
    label: `案例 ${String(c.no).padStart(2, '0')} · ${c.title}`,
    purpose: c.question,
    sql: c.sql,
    columns: c.columns,
    note: c.resultNote,
    explain: c.explain,
    /* 不传就是 undefined，runner 那行 `if (!o.spec.crossCheck) continue` 照旧跳过 */
    crossCheck,
  }
}

/* ==========================================================================
   意图一：用户活跃度变化诊断（Demo 1）
   ========================================================================== */

/** 活跃度诊断要用的 SQL：一条是 SQL 页的案例 01，一条是新写的 */
function activityQueries(ctx: QueryContext): SqlQuerySpec[] {
  const cases = buildSqlCases(ctx)
  return [
    fromSqlCase(cases, 'dau'),
    fromSqlCase(cases, 'age-active-rate'),
    newVsReturningQuery(ctx),
  ]
}

export const activityDecline: Intent = {
  id: 'activityDecline',
  analysisType: '用户活跃度变化诊断',
  priority: 10,

  rules: [
    {
      id: 'kw-why',
      label: '在问原因',
      any: ['为什么', '为何', '原因', '怎么会', '咋回事', '怎么回事'],
      weight: 0.5,
    },
    {
      id: 'kw-active',
      label: '问的是活跃度',
      any: ['活跃度', '活跃', 'dau', '日活', '打开频次', '来的次数'],
      weight: 1,
      /*
        ★ 必答题。「为什么」这种词太泛，不能光靠它把「今天怎么不下雨」
          匹成活跃度诊断。没用「活跃」两个字，就说明问的不是这件事。
      */
      required: true,
    },
    {
      id: 'kw-down',
      label: '在说下降',
      any: ['下降', '下跌', '下滑', '减少', '走低', '变差', '掉', '降', '流失'],
      weight: 1,
    },
  ],

  slots: (m: MatchResult): IntentSlot[] => {
    const scope = m.entities.ageGroup ? `${m.entities.ageGroup} 岁用户` : '全站用户'
    return [
      { label: '分析对象', value: scope },
      { label: '核心指标', value: '日均活跃用户数（DAU）、各年龄段活跃率、新老用户构成' },
      {
        /* ★ 这半句「以页面上选的时间窗口为准」不是客套话：
           slots 只看得见问题文本里写的天数，看不见页面上真正选的是哪个窗口。
           在输入框里打「近 7 天」而页面选着 30 天，这里会写 7 天、实际跑 30 天。 */
        label: '时间维度',
        value: `近 ${m.entities.days ?? 30} 天，与再往前同样长的上一周期对比（以页面上选的时间窗口为准）`,
      },
      { label: '要回答的', value: '这波下降是不是真的、集中在谁身上、有多少只是周末效应' },
    ]
  },

  plan: (m: MatchResult): PlanStep[] => {
    const days = m.entities.days ?? 30
    return [
      {
        no: 1,
        title: `按天算 DAU，并算日环比`,
        detail: '先确认「下降」是不是真的存在，以及从哪天开始变的——不靠印象，靠逐日数据。',
        tool: 'sql',
      },
      {
        no: 2,
        title: '用 7 日移动平均压掉周末的上下摆动',
        detail: '日环比一天涨一天跌是常态，直接看会误判。移动平均才看得出真实趋势。',
        tool: 'python',
      },
      {
        no: 3,
        title: '按年龄段拆活跃率',
        detail: '看降幅是不是集中在某几档人身上——如果是，就要单独查这几档。',
        tool: 'sql',
      },
      {
        no: 4,
        title: '把活跃人群拆成新注册和老用户',
        detail: '区分「新用户补不上来」和「老用户在流失」，这两种情况的应对完全不同。',
        tool: 'sql',
      },
      {
        no: 5,
        title: '查波动率与周末倍率，判断这波波动算不算异常',
        detail: `把近 ${days} 天的变化幅度和整段 60 天的历史水平比一比，避免把正常的周末波动当成滑坡。`,
        tool: 'python',
      },
      {
        no: 6,
        title: '把上面几步的结果汇总成结论与建议',
        detail: '把数据事实和原因假设分开写，不把没有证据的猜测说成结论。',
        tool: 'frontend',
      },
    ]
  },

  tools: [
    {
      tool: 'sql',
      why:
        '取数、聚合、按天分组、跨表关联——这些是 SQL 的主场，而且能在浏览器里当场跑出结果。' +
        '移动平均这类计算 SQL 写起来很别扭，所以留给 Python。',
      mode: 'live',
    },
    {
      tool: 'python',
      why:
        '移动平均、变化率、波动率这些是 Pandas 一行的活。' +
        '这部分代码由 analyze.py 在本机离线真跑过，页面读的是那次运行的结果，不是当场执行。',
      mode: 'offline',
    },
  ],

  charts: ['dauTrend', 'ageActiveRate'],

  queries: activityQueries,

  pyCaseIds: ['activity', 'trend'],

  /* ------------------------------------------------------------------
     结论模板：只吃 AnalysisData，不硬编码任何数字
     ------------------------------------------------------------------ */
  verdict: (d: AnalysisData): string => {
    const m = d.metrics.dau
    if (!Number.isFinite(m.current) || m.current <= 0) return activityDecline.fallback

    const parts: string[] = []

    if (m.previous > 0 && m.deltaPct !== undefined) {
      const dir = m.deltaPct >= 0 ? '上升' : '下降'
      parts.push(
        `近 ${d.days} 天的日均活跃用户是 ${formatCount(m.current)} 人，` +
          `比上一个 ${d.days} 天的 ${formatCount(m.previous)} 人${dir} ${formatPercent(Math.abs(m.deltaPct))}。`,
      )
    } else {
      parts.push(`近 ${d.days} 天的日均活跃用户是 ${formatCount(m.current)} 人，上一周期没有可比数据。`)
    }

    /* 年龄段：找出活跃率最高和最低的两档 */
    const ageRows = rowsOf(d, 'case:age-active-rate')
    if (ageRows.length > 0) {
      const sorted = [...ageRows].sort((a, b) => num(a.active_rate) - num(b.active_rate))
      const low = sorted[0]
      const high = sorted[sorted.length - 1]
      const gap = num(high.active_rate) - num(low.active_rate)
      parts.push(
        `拆到年龄段看，活跃率最低的是 ${low.age_group}（${formatPercent(num(low.active_rate), 2)}），` +
          `最高的是 ${high.age_group}（${formatPercent(num(high.active_rate), 2)}），相差 ${gap.toFixed(2)} 个百分点。`,
      )
    }

    /* 新老用户：说明活跃人群的主体是谁 */
    const segRows = rowsOf(d, 'ai:new-vs-returning')
    const veteran = segRows.find((r) => String(r.segment) === '老用户')
    const fresh = segRows.find((r) => String(r.segment) === '新用户')
    if (veteran && fresh) {
      parts.push(
        `活跃人群的主体是老用户：老用户 ${formatCount(num(veteran.active_users))} 人活跃，` +
          `窗口内新注册的只有 ${formatCount(num(fresh.active_users))} 人。`,
      )
    }

    /* ★ 诚实王牌：这波下降里有多少只是周末效应 */
    const weekend = d.py.trend.dowEffect.find((x) => x.group === 'weekend')
    if (weekend) {
      parts.push(
        `另外要注意：这套数据里周末的日均活跃是工作日的 ${weekend.ratioToWeekday.toFixed(3)} 倍。` +
          `所以逐日曲线上的很多上下起伏是周末效应，不是真的在流失——判断趋势要看移动平均，不能看日环比。`,
      )
    }

    return parts.join('')
  },

  evidence: (d: AnalysisData): EvidenceItem[] => {
    const items: EvidenceItem[] = []
    const m = d.metrics

    items.push({
      label: '日均活跃用户（DAU）',
      value: formatCount(m.dau.current),
      compare: m.dau.previous > 0 ? formatCount(m.dau.previous) : undefined,
      delta:
        m.dau.previous > 0 && m.dau.deltaPct !== undefined ? formatDelta(m.dau.deltaPct) : undefined,
      sample: `近 ${d.days} 天，数据截止 ${d.endDate}`,
    })

    items.push({
      label: '活跃率',
      value: formatPercent(m.activeRate.current),
      compare: m.activeRate.previous > 0 ? formatPercent(m.activeRate.previous) : undefined,
      sample: `活跃率 = 日均活跃人数 ÷ 平台用户总数`,
    })

    items.push({
      label: '人均每日观看时长',
      value: formatMinutes(m.avgMinutes.current),
      compare: m.avgMinutes.previous > 0 ? formatMinutes(m.avgMinutes.previous) : undefined,
      delta:
        m.avgMinutes.previous > 0 && m.avgMinutes.deltaPct !== undefined
          ? formatDelta(m.avgMinutes.deltaPct)
          : undefined,
      sample: '总观看时长 ÷ 活跃人天（不是 ÷ 播放次数）',
    })

    items.push({
      label: '窗口内新增用户',
      value: formatCount(m.newUsersInWindow) + ' 人',
      sample: '注册时间严格晚于窗口首日的人数',
    })

    const vol = d.py.activity.volatility
    items.push({
      label: '逐日 DAU 波动的历史水平',
      value: `平均每日摆动 ${formatPercent(vol.meanAbsPct)}`,
      sample:
        `整段 60 天的统计。最大单日摆动出现在 ${vol.maxAbsDate}，` +
        `为 ${formatPercent(vol.maxAbsPct)}`,
    })

    return items
  },

  insight: (d: AnalysisData): Insight[] => {
    const out: Insight[] = []

    /* --- 洞察一：周末效应 --- */
    /*
      ★ 这两个分组名必须和 scripts/analyze.py 的输出【逐字】一致：
        analyze.py 那边写的是 'weekday' / 'friday' / 'weekend'。
        这里原来写成了 'workday'，于是 workday 永远是 undefined，
        下面那个 if 永远不成立 —— 洞察一从来没显示过，页面上只有 2 条。
        不报错、不抛异常，只是静静地少一块，所以自动检查没抓到。
        本机现在钉了两条断言守这件事（分组名集合 + 洞察恰好 3 条）。
    */
    const weekend = d.py.trend.dowEffect.find((x) => x.group === 'weekend')
    const workday = d.py.trend.dowEffect.find((x) => x.group === 'weekday')
    if (weekend && workday) {
      out.push({
        title: '先说最容易被误读的一点：周末效应',
        fact:
          `周末的日均活跃是 ${formatCount(weekend.avgDau)} 人，工作日的日均活跃是 ` +
          `${formatCount(workday.avgDau)} 人，周末是工作日的 ${weekend.ratioToWeekday.toFixed(3)} 倍。`,
        hypothesis:
          '这个倍率和生成数据时设定的周末权重（DOW_MULTIPLIER，周末 1.18）是对得上的。' +
          '也就是说它是被构造出来的规律，不是这份数据里自己长出来的发现。' +
          '放在真实业务里，周末活跃高于工作日是常见的，但具体高多少必须实测，不能照搬这个数。',
        action:
          '如果要把「活跃度下降」讲给别人听，先用移动平均把周末波动压掉再下结论；' +
          '直接拿日环比的连续负值说事，很容易把正常的周末回落讲成滑坡。',
      })
    }

    /* --- 洞察二：年龄段差异 --- */
    const ageRows = rowsOf(d, 'case:age-active-rate')
    if (ageRows.length > 0) {
      const sorted = [...ageRows].sort((a, b) => num(a.active_rate) - num(b.active_rate))
      const low = sorted[0]
      const high = sorted[sorted.length - 1]
      out.push({
        title: `活跃度最低的是 ${low.age_group}`,
        fact:
          `${low.age_group} 的活跃率是 ${formatPercent(num(low.active_rate), 2)}，` +
          `比最高的 ${high.age_group}（${formatPercent(num(high.active_rate), 2)}）低 ` +
          `${(num(high.active_rate) - num(low.active_rate)).toFixed(2)} 个百分点。` +
          `这一档共 ${formatCount(num(low.total_users))} 人。`,
        hypothesis:
          '这份数据里年龄段之间的差异是先设定好权重再生成的（见 dataset.ts 的 AGE_WEIGHTS），' +
          '所以「哪个年龄段更活跃」这个结论只对这份模拟数据成立。' +
          '真实业务里同样会看到年龄差异，但具体是哪一档最活跃、差多少，必须用自己的数据重新算。',
        action:
          '如果要在真实业务上复用这条分析：先按年龄段拆活跃率，锁定最低的那一档，' +
          '再去看这一档的内容偏好（用户 × 内容页有现成的矩阵），判断是不是内容供给没接住。',
      })
    }

    /* --- 洞察三：新老用户结构 --- */
    const segRows = rowsOf(d, 'ai:new-vs-returning')
    const veteran = segRows.find((r) => String(r.segment) === '老用户')
    const fresh = segRows.find((r) => String(r.segment) === '新用户')
    if (veteran && fresh) {
      const veteranRate = num(veteran.active_rate)
      const freshRate = num(fresh.active_rate)
      out.push({
        title: '新用户比老用户更活跃，但人数少得多',
        fact:
          `新用户的活跃率是 ${formatPercent(freshRate, 2)}，老用户是 ${formatPercent(veteranRate, 2)}；` +
          `但老用户有 ${formatCount(num(veteran.total_users))} 人，新用户只有 ${formatCount(num(fresh.total_users))} 人。` +
          `所以整体活跃度主要由老用户的行为决定。`,
        hypothesis:
          '新用户活跃率高、人数少，很可能是数据构造时给新注册用户设了更高的初始活跃概率' +
          '（用户注册后一段时间内更爱打开），属于设定的规律。' +
          '真实业务里新用户活跃率通常是先高后低，是否如此需要看留存曲线，本项目没有留存分析。',
        action:
          '判断活跃度下滑的原因时，优先查老用户那一边：它的盘子大，同样的降幅对大盘的影响更大。' +
          '要区分是「老用户活跃频次下降」还是「老用户流失」，需要按用户维度看连续活跃天数，' +
          'Python 分析页的用户分层模块里有现成的活跃天数分布。',
      })
    }

    return out
  },

  fallback:
    '当前时间窗口里没有取到可用的数据，所以给不出结论。' +
    '这通常是数据库还没建好、或者查询出错导致的，请看上面「执行分析」那一步的说明。',
}

/* ==========================================================================
   意图二：年龄段内容偏好（Demo 2）
   --------------------------------------------------------------------------
   用户问「18–24 岁用户最喜欢什么类型的视频？」，这一类问题怎么答。

   ★ 这一类问题的答案有一个别的意图没有的特点：
     它的「发现」几乎等于数据生成时写下的偏好权重（dataset.ts 的 CATEGORY_PREFERENCE）。
     实测占比和那张表逐个对得上，最大偏差不到 1 个百分点。
     所以结论模板里必须把这件事算出来、说出来 ——
     这不是减分项，这一页最有说服力的地方就在这里。
   ========================================================================== */

/**
 * 问题里没写年龄段时，默认看哪一档。
 *
 * ★ 默认值只在这一处落地。runner 那边刻意不写第二遍 ——
 *   写两遍就有了两个真相来源，改一处漏一处不会报错，只会让图和文字对不上。
 */
export const DEFAULT_FOCUS_AGE: AgeGroupId = '18-24'

/**
 * 本意图用到的两条 SQL 案例 id。
 *
 * ★ 导出给 charts.tsx 用。图表和意图必须读【同一个常量】——
 *   两边各写一遍字符串，改一处漏一处的结果是图表读不到结果、
 *   静静地什么都不画，而且不报错。
 */
export const AGE_CATEGORY_CASE_ID = 'case:age-category-prefer'
export const AGE_TOP3_CASE_ID = 'case:age-top3'

/**
 * 均分线：8 个内容分区完全平均的话，每个占 12.5%。
 *
 * ★ 导出给图表用。图上那条虚线、卡片文案里那个「12.5%」必须来自同一个常量 ——
 *   一手写就有一处会忘改，而那不报错，只是图上的线和一个说得掷地有声的百分比对不上。
 */
export const EVEN_SHARE_PCT = 12.5

/** 取本次要回答的那一档人 + 它的偏好明细。取不到返回 null，模板走 fallback。 */
function focusPreference(
  d: AnalysisData,
): { age: AgeGroupId; row: PyAgePreferenceRow } | null {
  const age = d.focusAge ?? DEFAULT_FOCUS_AGE
  const row = d.py.windows[String(d.days)]?.agePreference.find((r) => r.age === age)
  if (!row || row.cells.length === 0) return null
  return { age, row }
}

/** 某个分区在「某一档人 + 某个时间窗口」里的名次（1 起）。取不到返回 null。 */
function rankIn(py: PyResults, days: number, age: AgeGroupId, category: string): number | null {
  const row = py.windows[String(days)]?.agePreference.find((r) => r.age === age)
  if (!row) return null
  const idx = row.cells.findIndex((c) => c.category === category)
  return idx < 0 ? null : idx + 1
}

/**
 * 对账一：该档人最喜欢的分区，它的观看次数。
 *
 * ★ 只能比【整数】。SQL 的 share_pct 是 30.295831632084926，
 *   Python 侧的 share 刻意四舍五入到 4 位是 30.2958 ——
 *   两个浮点数做 === 永远是 false，页面会永久挂一个红色的「不一致」，
 *   而数据其实完全正确。假告警比不检查更糟：它会让以后所有的告警都没人信。
 *
 * ★ 「两边各自数出来的第一名是谁」写进 label，让人一眼看得见。
 *   不做成「名字对不上就不显示」—— 那就变成「不一致的时候对账块静静消失」，
 *   而脚本只断言「存在的检查都相等」，会静默通过。
 */
function ageTopCellCheck(
  rows: SqlCaseRow[],
  py: PyResults,
  days: number,
  age: AgeGroupId,
): CrossCheck | null {
  const pyRow = py.windows[String(days)]?.agePreference.find((r) => r.age === age)
  if (!pyRow || pyRow.cells.length === 0) return null
  const sqlRows = rows.filter((r) => String(r.age_group) === age)
  if (sqlRows.length === 0) return null

  /* 用整数比大小选第一名，不拿 share_pct（浮点）参与比较 */
  const sqlTop = sqlRows.reduce((a, b) => (num(b.view_count) > num(a.view_count) ? b : a))
  const pyTop = pyRow.cells[0]
  return {
    label:
      `${ageGroupLabel(age)}偏好第一名（SQL 数出的是${String(sqlTop.category)}，` +
      `Pandas 数出的是${pyTop.category}）的观看次数`,
    sqlValue: num(sqlTop.view_count),
    pyValue: pyTop.views,
    unit: '次',
  }
}

/**
 * 对账二：该档人在窗口内的观看次数合计 —— 也就是上面所有占比的分母。
 *
 * 和上一条钉的不是同一件事：上一条钉「过滤 + JOIN + GROUP BY 整条链路」，
 * 这一条钉「组内求和这个分母」。两条 SQL 各对一次账，比只对一次可信。
 */
function ageTotalCheck(
  rows: SqlCaseRow[],
  py: PyResults,
  days: number,
  age: AgeGroupId,
): CrossCheck | null {
  const pyRow = py.windows[String(days)]?.agePreference.find((r) => r.age === age)
  const sqlRow = rows.find((r) => String(r.age_group) === age)
  if (!pyRow || !sqlRow) return null
  return {
    label: `${ageGroupLabel(age)}窗口内观看次数合计（所有占比的分母）`,
    sqlValue: num(sqlRow.age_total),
    pyValue: pyRow.totalViews,
    unit: '次',
  }
}

function agePreferenceQueries(ctx: QueryContext, m?: MatchResult): SqlQuerySpec[] {
  const cases = buildSqlCases(ctx)
  const age = m?.entities.ageGroup ?? DEFAULT_FOCUS_AGE
  return [
    fromSqlCase(cases, 'age-category-prefer', (rows, py, days) =>
      ageTopCellCheck(rows, py, days, age),
    ),
    fromSqlCase(cases, 'age-top3', (rows, py, days) => ageTotalCheck(rows, py, days, age)),
  ]
}

export const agePreference: Intent = {
  id: 'agePreference',
  analysisType: '年龄段内容偏好分析',
  /* 比 activityDecline（10）小：万一真出现同分（比如「18-24 岁为什么活跃度下降还爱看游戏」），
     让更深的诊断类意图赢。 */
  priority: 8,

  rules: [
    {
      id: 'kw-like',
      label: '在问喜好',
      /*
        ★ 为什么这条是【必答题】：
          只靠「内容 / 类型 / 视频」这些词，会把
          「哪个内容类别的观看完成率最高」（demo-3）、
          「最近哪些内容类别增长最快」（demo-4）一起吸过来——它们都含「内容」。
          加上必答的「喜欢 / 偏好」，这两条自然出局。
        ★ 为什么【不】放「用户」「群体」「人群」「活跃」「观看」：
          「哪些用户群体存在活跃度下降」（demo-5）同时含「用户」和「群体」，
          放进来就会把它从活跃度诊断手里抢走。
      */
      any: [
        '最喜欢',
        '喜欢',
        '最爱',
        '爱看',
        '爱刷',
        '偏好',
        '偏爱',
        '口味',
        '感兴趣',
        '受欢迎',
        '常看',
        '看什么',
        '追什么',
      ],
      weight: 1,
      required: true,
    },
    {
      id: 'kw-content',
      label: '问的是内容 / 分区',
      any: ['类型', '分区', '内容', '视频', '题材', '品类', '番剧'],
      weight: 1,
    },
    {
      id: 'kw-scope',
      label: '点明了人群范围',
      /*
        ★ 年龄段的 id 从 AGE_GROUP_IDS 取（半角连字符），【不能】从 AGE_GROUPS 取 label：
          label 里是「–」（en dash U+2013），而规则是在【归一化之后】的文本上跑的，
          这条关键词会永远匹不到——而且不报错，只是静静地少匹配一处。
          本机有一条断言专门钉这个：所有关键词都必须满足 normalize(k) === k。
      */
      any: [
        ...AGE_GROUP_IDS,
        '40岁以上',
        '年龄段',
        '大学生',
        '学生党',
        '青年人',
        '中年',
        '中老年',
        '年轻',
      ],
      weight: 0.5,
    },
  ],

  slots: (m: MatchResult): IntentSlot[] => {
    const age = m.entities.ageGroup
    return [
      {
        label: '分析对象',
        value: age
          ? `${ageGroupLabel(age)}用户`
          : `${ageGroupLabel(DEFAULT_FOCUS_AGE)}用户（问题里没写年龄段，按默认这一档看）`,
      },
      {
        label: '核心指标',
        value: '各内容分区的观看次数、年龄段内占比（组内归一化）、排名',
      },
      {
        /* ★ 后半句不是客套：slots 看不见页面上真正选的时间窗口，只看得见问题文本里的天数 */
        label: '时间维度',
        value: `近 ${m.entities.days ?? 30} 天（以页面上选的时间窗口为准）`,
      },
      {
        label: '要回答的',
        value: '这一档人把观看量花在哪些分区上、谁排第一、这个排名有多少是数据生成时设定的',
      },
    ]
  },

  plan: (m: MatchResult): PlanStep[] => {
    const label = ageGroupLabel(m.entities.ageGroup ?? DEFAULT_FOCUS_AGE)
    return [
      {
        no: 1,
        title: '按「年龄段 × 内容分区」数出观看次数',
        detail: '先把「谁看了什么」数成 4 × 8 = 32 个格子。这一步只负责数出来，不下结论。',
        tool: 'sql',
      },
      {
        no: 2,
        title: '用窗口函数在每一档人内部算占比',
        detail:
          '占比 = 这个格子的次数 ÷ 同一档人的次数合计。分母用 SUM() OVER (PARTITION BY age_group) 现算，' +
          '不是外面传进来的常数 —— 绝对播放量会被人数带偏：18–24 有人最多、40 岁以上最少，' +
          '就算两拨人口味完全一样，人多的那一档在每个分区上都会显得更爱看。',
        tool: 'sql',
      },
      {
        no: 3,
        title: '把每一档的前三名单独抽出来',
        detail:
          '看第一名领先多少，同时拿到第二个能和 Python 逐字对账的整数（该档观看次数合计）——' +
          '两条 SQL 各对一次账，比只对一次可信。',
        tool: 'sql',
      },
      {
        no: 4,
        title: `只看${label}这一档，并和其它档对照`,
        detail:
          '组内占比的分母是各档自己的总量，所以【别人群的百分比】可以直接比；' +
          '绝对量与人数不能这么比。',
        tool: 'frontend',
      },
      {
        no: 5,
        title: '用 Pandas 把同一批数字独立算一遍',
        detail:
          '离线跑好的 agePreference 与上面两条 SQL 逐格对照。' +
          '两套完全独立的实现算同一个数，对得上才敢用。',
        tool: 'python',
      },
      {
        no: 6,
        title: '汇总成结论，并如实说明这个排名和构造权重几乎一样',
        detail:
          '数据事实和原因假设分开写。这一档的排名有多少是数据生成时设定的，必须讲清楚 ——' +
          '把设定当成发现，是这类分析里最容易犯也最不该犯的错。',
        tool: 'frontend',
      },
    ]
  },

  tools: [
    {
      tool: 'sql',
      why:
        '分组、组内占比、组内排名正好是窗口函数的主场' +
        '（SUM() OVER / ROW_NUMBER() OVER），而且能在浏览器里当场跑出结果，耗时是实测的。',
      mode: 'live',
    },
    {
      tool: 'python',
      why:
        '同一批数字在 Pandas 里用另一套完全独立的实现又算了一遍。' +
        '这部分由 analyze.py 在本机离线跑过，页面读的是那次运行的结果，不是当场执行。',
      mode: 'offline',
    },
  ],

  charts: ['ageCategoryShare', 'weightVsActual'],

  queries: agePreferenceQueries,

  pyCaseIds: ['cross'],

  verdict: (d: AnalysisData): string => {
    const f = focusPreference(d)
    if (!f) return agePreference.fallback
    const { age, row } = f
    const label = ageGroupLabel(age)
    const [top, second] = row.cells
    const last = row.cells[row.cells.length - 1]

    const parts: string[] = []
    parts.push(
      `近 ${d.days} 天，${label}用户里有 ${formatCount(row.activeUsers)} 人活跃过，` +
        `一共看了 ${withThousands(row.totalViews)} 次视频。` +
        `把这一档人自己的 8 个分区拉成 100%，占比最高的是${top.category}：${formatPercent(top.share, 2)}。`,
    )
    if (second) {
      parts.push(
        `第二名是${second.category}（${formatPercent(second.share, 2)}），` +
          `第一名是它的 ${(top.share / Math.max(0.01, second.share)).toFixed(2)} 倍。`,
      )
    }
    if (last) {
      parts.push(
        `最低的是${last.category}（${formatPercent(last.share, 2)}），` +
          `第一名是它的 ${(top.share / Math.max(0.01, last.share)).toFixed(1)} 倍。`,
      )
    }
    parts.push(
      `口径上有一点要说明：这里比的是「组内占比」，不是绝对播放量 —— ` +
        `${label}是人数较多的一档，用绝对播放量比，比出来的是「哪一档人多」。` +
        `另外：这份排名和数据生成时写下的偏好权重几乎一一对应，` +
        `它更像是把设定值量了一遍。下面「输出业务洞察」第 2 条做了逐项对照。`,
    )
    return parts.join('')
  },

  evidence: (d: AnalysisData): EvidenceItem[] => {
    const f = focusPreference(d)
    if (!f) return []
    const { age, row } = f
    const label = ageGroupLabel(age)
    const [top, second] = row.cells
    const last = row.cells[row.cells.length - 1]
    const compare: WeightCompareRow[] = buildWeightComparison(age, row)
    const worst = maxDeviationRow(compare)

    const items: EvidenceItem[] = [
      {
        label: '分析对象',
        value: `${label}（${formatCount(row.activeUsers)} 人活跃）`,
        sample: `近 ${d.days} 天，数据截止 ${d.endDate}。活跃 = 窗口内至少产生过一次观看`,
      },
      {
        label: '偏好第一名',
        value: `${top.category} ${formatPercent(top.share, 2)}`,
        compare: second ? `第二名${second.category} ${formatPercent(second.share, 2)}` : undefined,
        sample: '占该年龄段全部观看次数的比例（组内归一化，8 个分区合计 100%）',
      },
      {
        label: '第一名 vs 末位',
        value: `${(top.share / Math.max(0.01, last.share)).toFixed(1)} 倍`,
        compare: `末位${last.category} ${formatPercent(last.share, 2)}`,
        sample: `次数口径：${withThousands(top.views)} 次 vs ${withThousands(last.views)} 次`,
      },
      {
        label: '该年龄段观看次数合计',
        value: `${withThousands(row.totalViews)} 次`,
        compare: `${formatCount(row.activeUsers)} 人产生`,
        sample: '来自离线跑好的 Pandas 结果；同一口径在浏览器里用 SQL 又算了一遍，见上面的交叉验证',
      },
    ]

    if (worst) {
      items.push({
        label: '实测占比与设定权重的最大偏差',
        value: `${worst.diff.toFixed(2)} 个百分点`,
        compare: `${worst.category}：设定 ${worst.weight} vs 实测 ${formatPercent(worst.share, 2)}`,
        sample: '设定值 = src/data/dataset.ts 的 CATEGORY_PREFERENCE，即生成这份数据时用的参数',
      })
    }

    const others = d.py.windows[String(d.days)]?.agePreference ?? []
    const other = others.find((r) => r.age !== age)
    if (other && other.cells.length > 0) {
      items.push({
        label: `同一窗口里的${ageGroupLabel(asAge(other.age))}`,
        value: `第一名是${other.cells[0].category} ${formatPercent(other.cells[0].share, 2)}`,
        compare: `${formatCount(other.activeUsers)} 人活跃`,
        sample: '和上一行不是同一个分区 —— 「偏好」这件事要按人群分开算，不能全站一个结论',
      })
    }

    return items
  },

  insight: (d: AnalysisData): Insight[] => {
    const out: Insight[] = []
    const f = focusPreference(d)
    if (!f) return out
    const { age, row } = f
    const label = ageGroupLabel(age)
    const [top, second, third, fourth] = row.cells
    const last = row.cells[row.cells.length - 1]

    /* ---- 洞察一：排名的形状（第一名碾压，紧挨着的两名其实分不出先后）---- */
    if (top && second && third && fourth) {
      /*
        ★ 「换一个时间窗口这两名会翻过来」这句话必须【运行时算】。
          写死成「7 天是动画在前、30 天是生活在前」的话，用户改成问 40 岁以上时
          这句话就可能是假的 —— 而它不会报错，只是静静地说了句假话。
      */
      const rank7 = rankIn(d.py, 7, age, third.category)
      const rank30 = rankIn(d.py, 30, age, third.category)
      const flips = rank7 !== null && rank30 !== null && rank7 !== rank30

      out.push({
        title: `第一名是${top.category}，但第三、第四名其实分不出先后`,
        fact:
          `${label}把 ${formatPercent(top.share, 2)} 的观看花在了${top.category}上，` +
          `比第二名${second.category}（${formatPercent(second.share, 2)}）高 ` +
          `${(top.share - second.share).toFixed(2)} 个百分点；` +
          `第三名${third.category}（${formatPercent(third.share, 2)}）和` +
          `第四名${fourth.category}（${formatPercent(fourth.share, 2)}）只差 ` +
          `${Math.abs(third.share - fourth.share).toFixed(2)} 个百分点，折合 ` +
          `${withThousands(Math.abs(third.views - fourth.views))} 次观看` +
          `（这一档一共 ${formatCount(row.activeUsers)} 人、${withThousands(row.totalViews)} 次观看）；` +
          `${last.category}以 ${formatPercent(last.share, 2)} 垫底，` +
          `第一名是它的 ${(top.share / Math.max(0.01, last.share)).toFixed(1)} 倍。`,
        hypothesis:
          `这一档的样本是 ${formatCount(row.activeUsers)} 人 / ${withThousands(row.totalViews)} 次观看，` +
          `排在后面的几档之间那点差距大概率只是抽样噪声。` +
          (flips
            ? `验证方法很简单：把时间窗口换一换 —— ${third.category}在 7 天窗口是第 ${rank7} 名、` +
              `在 30 天窗口是第 ${rank30} 名，名次真的会翻。`
            : `换个时间窗口再看，这几名的先后同样会变。`) +
          `所以「${top.category}排第一」这种量级的差距可以信，` +
          `「${third.category}比${fourth.category}更受欢迎」这种量级的差距不能信。`,
        action:
          `要拿这份结果去排内容资源，只用梯队这种粗粒度：${top.category}一档；` +
          `${second.category}、${third.category}、${fourth.category}一档；其余一档。` +
          `不要把相邻两名的先后当成投放依据。另外，占比高只说明「看得多」，` +
          `不等于「看得久」——要分开这两件事，得同时看人均观看时长和完播率，` +
          `同样的口径在「用户 × 内容」页和 Python 分析页里有现成的。`,
      })
    }

    /* ---- 洞察二：★ 这一页最该说的一条 —— 排名 ≈ 构造权重复读 ---- */
    {
      const compare = buildWeightComparison(age, row)
      const worst = maxDeviationRow(compare)
      const inv = firstInversion(compare)

      if (worst) {
        out.push({
          title: '这份「偏好排名」更像是把构造参数复读了一遍',
          fact:
            `把${label}的 8 个实测占比与生成数据时写下的偏好权重` +
            `（src/data/dataset.ts 里的 CATEGORY_PREFERENCE）逐项对照：` +
            `偏差最大的一项是${worst.category} —— 实测 ${formatPercent(worst.share, 2)}，` +
            `设定 ${worst.weight}，相差 ${Math.abs(worst.diff).toFixed(2)} 个百分点；` +
            `其余 7 个分区都不超过这一项。` +
            (inv
              ? `实测的大小顺序和权重表基本一致，只在${inv.higher.category}与${inv.lower.category}这一处反了序。`
              : `而且 8 个分区的实测大小顺序，和权重表给出的顺序完全一致。`),
          hypothesis:
            `原因很直接：这份数据就是按那张权重表构造出来的 —— 每个用户看哪个分区，` +
            `是按权重抽出来的概率（权重 30 的分区，每次观看有约 30% 的概率被选中）。` +
            `所以「${label}最爱${top.category}」不是从数据里发现的规律，而是把设定值量了一遍。` +
            `它可以用来演示分析方法，但不能当成对现实世界的发现，` +
            `也不代表任何真实平台的用户偏好。`,
          action:
            `这一条本身就是这个分析最值得记住的东西：当一个「发现」和生成数据的参数` +
            `长得一模一样时，先怀疑它是不是被自己写进去的。换成自己业务的数据之后，` +
            `流程不变（按人群分组 → 组内归一化 → 排名 → 找差异），但排名必须重新算，` +
            `而且要拿另一个独立口径交叉验证 —— 覆盖率、人均观看时长、完播率都行，` +
            `不要只看一个占比。`,
        })
      }
    }

    /* ---- 洞察三：换一档人，第一名就换了 ---- */
    const others = d.py.windows[String(d.days)]?.agePreference ?? []
    const other = others.find((r) => r.age !== age)
    if (other && other.cells.length > 0) {
      const oTop = other.cells[0]
      const oLabel = ageGroupLabel(asAge(other.age))
      out.push({
        title: `换成${oLabel}，排名第一的就换了人`,
        fact:
          `${oLabel}排第一的是${oTop.category}（${formatPercent(oTop.share, 2)}），` +
          `${label}排第一的是${top.category}（${formatPercent(top.share, 2)}）；` +
          `两档人的观看次数差 ${(row.totalViews / Math.max(1, other.totalViews)).toFixed(1)} 倍` +
          `（${formatCount(row.activeUsers)} 人 vs ${formatCount(other.activeUsers)} 人活跃）。` +
          `组内占比的分母是各档自己的总量，所以这两个百分比可以直接比；绝对播放量不能这么比。`,
        hypothesis:
          `年龄差带来的口味差同样是被构造出来的：同一张 CATEGORY_PREFERENCE 里，` +
          `各年龄段的权重几乎是反着给的 —— 一头的游戏权重最高、知识很低，另一端反过来。` +
          `所以「年纪越大越爱看${oTop.category}」这个方向是设定好的，` +
          `方向和幅度都不能照搬到别的数据上。`,
        action:
          `要在自己的数据上做同样的事：先按年龄段分组，再看每一档的第一梯队，` +
          `不要拿绝对播放量跨年龄段比 —— 人多的那一档在每个分区上都会显得更爱看。` +
          `想把「偏好」和「消费深度」分开，可以对照 Python 分析页里的覆盖率` +
          `与人均观看时长两个口径。`,
      })
    }

    return out
  },

  fallback:
    '当前时间窗口里没有取到这一档人的内容偏好数据，所以给不出结论。' +
    '这通常是数据库还没建好、或者查询出错导致的，请看上面「执行分析」那一步的说明。',
}

/* ==========================================================================
   意图三：内容分区的增长对比（Demo 3）
   --------------------------------------------------------------------------
   用户问「最近哪些内容类别增长最快？」，这一类问题怎么答。

   ★ 这一类问题的答案有一个别的意图没有的特点：
     它比的是【窗口自己内部】的前半段 vs 后半段，不是环比。
     而两段里的「周末占几天」常常不一样 —— 这份数据里周末的日均播放量
     明显更高（生成时设的 DOW_MULTIPLIER），所以「后半段比前半段低」
     有可能整个都是星期构成造成的。

     近 7 天窗口就是这个极端例子：前半段含 2 天周末、后半段一天都没有，
     结果 8 个分区【全部为负增长】。那个「增长最快」实际是「跌得最少」。
     结论模板必须把这件事算出来、说出来，而不是把负数排名讲成增长。
   ========================================================================== */

/** 本次要看的那个「前半段 vs 后半段」结果。取不到返回 null，模板走 fallback。 */
function focusTrend(d: AnalysisData): PyCategoryTrend | null {
  const t = d.py.windows[String(d.days)]?.categoryTrend
  if (!t || t.categories.length === 0) return null
  return t
}

/**
 * 按增长率从高到低排好，算不出增长率的（前半段一次都没被看过）剔掉。
 * ★ 不在模板里就地排序，是为了让结论、数据依据、洞察三处用的是同一个顺序 ——
 *   各排各的，迟早出现「结论说第一是游戏、洞察说第一是动画」。
 */
function growthRanking(trend: PyCategoryTrend): PyCategoryTrend['categories'] {
  return [...trend.categories]
    .filter((r) => r.growthPct !== null)
    .sort((a, b) => (b.growthPct ?? 0) - (a.growthPct ?? 0))
}

/**
 * 另外两个窗口里「两段的周末天数」分别是多少。
 *
 * ★ 用真实数字，而不是「窗口越长越稳」这种空话：
 *   空话对着 7 天窗口说的时候，读者没法判断到底差多少；
 *   把另两个窗口的数字摆出来，差多少一眼看得见。
 * ★ 数字全部现算 —— 换数据集、改种子之后这句话会跟着变，不会变成一句假话。
 */
function otherWindowNote(d: AnalysisData): string {
  const bits: string[] = []
  for (const w of [7, 14, 30]) {
    if (w === d.days) continue
    const t = d.py.windows[String(w)]?.categoryTrend
    if (!t) continue
    const m = halfWindowMix(t)
    bits.push(`近 ${w} 天是 ${m.firstWeekendDays} 天 vs ${m.secondWeekendDays} 天`)
  }
  if (bits.length === 0) return ''
  return `另外两个窗口里，两段的周末天数分别是：${bits.join('、')}。`
}

export const categoryGrowth: Intent = {
  id: 'categoryGrowth',
  analysisType: '内容分区增长对比',
  /* 比 agePreference（8）大：它比「喜欢什么」更具体——问的是变化，不是静态偏好。 */
  priority: 9,

  rules: [
    {
      id: 'kw-content',
      label: '问的是内容 / 分区',
      /*
        ★ 必答题，理由和 agePreference 那条一样：
          「最近什么在涨」这种问法太泛，不锁定「内容」，就会把
          「哪些用户群体存在活跃度下降」（demo-5）吸过来——它也含「下降」。
          加了必答的内容词，demo-5 自然出局（它说的是用户群体，不是内容）。

        ★ 为什么【不】放「数据」「指标」「平台」「业务」这类词：
          它们不指向内容分区，放进来等于让这条必答题形同虚设。
      */
      any: ['内容', '分区', '类别', '品类', '题材', '视频', '频道', '板块', '番剧'],
      weight: 1,
      required: true,
    },
    {
      id: 'kw-growth',
      label: '在问涨跌 / 变化',
      any: [
        '增长',
        '涨幅',
        '上升',
        '上涨',
        '变多',
        '更多',
        '增长最快',
        '涨',
        '下跌',
        '下滑',
        '下降',
        '减少',
        '变少',
        '变化',
        '趋势',
        '衰退',
        '萎缩',
        '起来',
        '掉了',
        '热门',
      ],
      weight: 1,
    },
    {
      id: 'kw-time',
      label: '在说最近',
      any: ['最近', '近期', '近来', '这阵子', '这段时间', '这一阵'],
      weight: 0.5,
    },
  ],

  slots: (m: MatchResult): IntentSlot[] => [
    { label: '分析对象', value: '全站 8 个内容分区（不区分人群）' },
    {
      label: '核心指标',
      value: '各分区的日均播放量、窗口前半段 vs 后半段的变化率（%）',
    },
    {
      /* ★ 后半句不是客套：slots 看不见页面上真正选的时间窗口，
         只看得见问题文本里写的天数。在输入框里打「近 7 天」而页面选着 30 天，
         这里会写 7 天、实际跑 30 天。 */
      label: '时间维度',
      value: `近 ${m.entities.days ?? 30} 天（以页面上选的时间窗口为准），把这个窗口从中间对半切开`,
    },
    {
      label: '要回答的',
      value:
        '哪些分区在涨、哪些在跌，以及这个排名有多少是两段的「星期构成」造成的——不是环比',
    },
  ],

  plan: (m: MatchResult): PlanStep[] => {
    const days = m.entities.days ?? 30
    return [
      {
        no: 1,
        title: '把窗口从中间对半切开，按分区数出两段各自的播放次数',
        detail:
          '切分点从窗口里实际存在的日期数出来，不写死 days ÷ 2——' +
          '写死的话，窗口里万缺了一天就会和离线那套错开一天，而错开一天不会报错。',
        tool: 'sql',
      },
      {
        no: 2,
        title: '换成人均口径：两段各算日均播放量',
        detail:
          '两段天数常常不等（近 7 天切出来是 3 天 vs 4 天），拿 3 天的总量去比 4 天的，' +
          '短的那段天然吃亏，排名就不可信了。所以一律比日均。',
        tool: 'sql',
      },
      {
        no: 3,
        title: '算每个分区的增长率并排好名次',
        detail: '前半段日均是 0 时增长率留空，不当成 0——算不出来就说算不出来。',
        tool: 'sql',
      },
      {
        no: 4,
        title: '查两段的「星期构成」：各含几天周末',
        detail:
          `这份数据里周末的日均播放量明显高于工作日（生成时设的 DOW_MULTIPLIER），` +
          `所以两段的周末天数差多少，直接决定了这个排名可不可信。` +
          `近 ${days} 天窗口尤其要看——它只有三四天一段，一两天周末就能定胜负。`,
        tool: 'python',
      },
      {
        no: 5,
        title: '用 Pandas 把同一批数字独立算一遍',
        detail:
          '离线跑好的 categoryTrend 与上面这条 SQL 逐段对照：' +
          '两套完全独立的实现算同一个切分点，对得上才敢用。',
        tool: 'python',
      },
      {
        no: 6,
        title: '汇总成结论，并如实说明这个排名有多少是构造出来的',
        detail:
          '数据事实和原因假设分开写。如果这一窗口里没有一个分区在涨，' +
          '必须把「跌得最少」说成「跌得最少」，不能讲成「增长最快」。',
        tool: 'frontend',
      },
    ]
  },

  tools: [
    {
      tool: 'sql',
      why:
        '对半切分、按分区分组、算日均、排名，SQL 一次查询就能全出来，' +
        '而且能在浏览器里当场跑出结果，耗时是实测的。',
      mode: 'live',
    },
    {
      tool: 'python',
      why:
        '同一批数字在 Pandas 里用另一套完全独立的实现又算了一遍（数日期的写法都不一样）。' +
        '这部分由 analyze.py 在本机离线跑过，页面读的是那次运行的结果，不是当场执行。',
      mode: 'offline',
    },
  ],

  charts: ['categoryGrowth'],

  queries: (ctx: QueryContext): SqlQuerySpec[] => [categoryHalfQuery(ctx)],

  pyCaseIds: ['trend'],

  verdict: (d: AnalysisData): string => {
    const trend = focusTrend(d)
    if (!trend) return categoryGrowth.fallback
    const ranked = growthRanking(trend)
    if (ranked.length === 0) return categoryGrowth.fallback

    const top = ranked[0]
    const last = ranked[ranked.length - 1]
    const up = ranked.filter((r) => (r.growthPct ?? 0) > 0).length
    const mix = halfWindowMix(trend)
    const ratio = weekendViewRatio(d.py)

    const parts: string[] = []
    parts.push(
      `近 ${d.days} 天从中间对半切开：前半段 ${mix.firstStart} ~ ${mix.firstEnd}（${mix.firstDays} 天），` +
        `后半段 ${mix.secondStart} ~ ${mix.secondEnd}（${mix.secondDays} 天）。` +
        `按【日均】播放量比较这 ${ranked.length} 个内容分区，排在最前的是${top.category}` +
        `（${formatDelta(top.growthPct ?? 0, 2)}），排在最后的是${last.category}` +
        `（${formatDelta(last.growthPct ?? 0, 2)}）。`,
    )

    const missing = trend.categories.length - ranked.length
    if (missing > 0) {
      parts.push(`另有 ${missing} 个分区前半段一次都没被看过，算不出增长率，没有参与排名。`)
    }

    if (up === 0) {
      /*
        ★ 这一页最容易被讲错的地方。8 个分区全跌的时候，
          「增长最快」这个说法会让读者以为有一个分区在涨。
          所以这里不改口、不软化，直接把事实和原因一起摆出来。
      */
      parts.push(
        `★ 但有一点必须说清楚：这 ${ranked.length} 个分区里，没有一个的日均播放量高于前半段 —— ` +
          `所以上面那个「排在最前」实际是【跌得最少】的那个，这个词才准确，` +
          `这个窗口里根本没有分区在涨。原因不在内容，在窗口自己的构成：` +
          `前半段 ${mix.firstDays} 天里有 ${mix.firstWeekendDays} 天是周末，` +
          `后半段 ${mix.secondDays} 天里有 ${mix.secondWeekendDays} 天是周末` +
          (ratio !== null
            ? `，而这份数据里周末的日均播放量是工作日（周一至周四）的 ${ratio.toFixed(3)} 倍`
            : '') +
          `。所以这个排名量的是两段「星期构成」差了多少，不是在测内容本身的兴衰。`,
      )
    } else if (up === ranked.length) {
      parts.push(`这 ${ranked.length} 个分区在后半段的日均播放量全部高于前半段。`)
    } else {
      parts.push(
        `其中 ${up} 个分区后半段高于前半段、${ranked.length - up} 个不高于前半段。`,
      )
    }

    parts.push(
      `口径上要说清楚：这里比的是【窗口自己内部】的前后两半（就是上面写的那两个日期区间），` +
        `不是「本周 vs 上周」那种环比，两者数值不一样。而且窗口越短这个排名越不稳：` +
        otherWindowNote(d) +
        `窗口短的时候每段只有三四天，一天的异常就能把名次整个掀翻。`,
    )

    return parts.join('')
  },

  evidence: (d: AnalysisData): EvidenceItem[] => {
    const trend = focusTrend(d)
    if (!trend) return []
    const ranked = growthRanking(trend)
    if (ranked.length === 0) return []

    const top = ranked[0]
    const last = ranked[ranked.length - 1]
    const up = ranked.filter((r) => (r.growthPct ?? 0) > 0).length
    const mix = halfWindowMix(trend)
    const ratio = weekendViewRatio(d.py)

    const items: EvidenceItem[] = [
      {
        label: '窗口是怎么切的',
        value: `前半段 ${mix.firstDays} 天 vs 后半段 ${mix.secondDays} 天`,
        compare: `${mix.firstStart} ~ ${mix.firstEnd} ／ ${mix.secondStart} ~ ${mix.secondEnd}`,
        sample:
          '切分点从窗口里实际存在的日期数出来。这不是环比：两段都属于当前这个窗口，' +
          '换一个时间窗口，切分点和排名都会跟着变。',
      },
      {
        label: `日均播放量变化最靠前的：${top.category}`,
        value: formatDelta(top.growthPct ?? 0, 2),
        compare: `${top.firstDailyViews.toFixed(1)} → ${top.secondDailyViews.toFixed(1)} 次/天`,
        sample: '增长率 =（后半段日均 − 前半段日均）÷ 前半段日均',
      },
      {
        label: `排在最后的：${last.category}`,
        value: formatDelta(last.growthPct ?? 0, 2),
        compare: `${last.firstDailyViews.toFixed(1)} → ${last.secondDailyViews.toFixed(1)} 次/天`,
        sample: `和上面那行相差 ${((top.growthPct ?? 0) - (last.growthPct ?? 0)).toFixed(2)} 个百分点`,
      },
      {
        label: `${ranked.length} 个分区里上涨的`,
        value: `${up} 个`,
        compare: up === 0 ? '这一窗口里没有一个分区在涨' : `${ranked.length - up} 个不高于前半段`,
        sample: '判定用的是严格大于 0；等于 0 的算「没涨没跌」，不四舍五入成上涨',
      },
      {
        label: '两段各含几天周末',
        value: `前 ${mix.firstWeekendDays} 天 / 后 ${mix.secondWeekendDays} 天`,
        compare: `两段一共 ${mix.firstDays} 天 / ${mix.secondDays} 天`,
        sample:
          '周末 = 周六 + 周日，按日期逐个数的。两段的周末天数差多少，' +
          '直接决定了这个排名可不可信。',
      },
      {
        label: '周末 vs 工作日 的日均播放量',
        value: ratio !== null ? `${ratio.toFixed(3)} 倍` : '取不到',
        sample:
          '整段 60 天一起算，来自离线跑好的 Pandas 逐日结果（按星期分组）。' +
          '基准是周一至周四，不含周五 —— 和 dataset.ts 里 DOW_MULTIPLIER 的分档一致。',
      },
    ]

    return items
  },

  insight: (d: AnalysisData): Insight[] => {
    const out: Insight[] = []
    const trend = focusTrend(d)
    if (!trend) return out
    const ranked = growthRanking(trend)
    if (ranked.length === 0) return out

    const top = ranked[0]
    const last = ranked[ranked.length - 1]
    const up = ranked.filter((r) => (r.growthPct ?? 0) > 0).length
    const mix = halfWindowMix(trend)
    const ratio = weekendViewRatio(d.py)

    /* ---- 洞察一：排名本身 ---- */
    out.push({
      title:
        up === 0
          ? `${top.category}「跌得最少」，${last.category}跌得最多`
          : `${top.category}排在首位，${last.category}垫底`,
      fact:
        `把窗口对半切（前 ${mix.firstDays} 天 vs 后 ${mix.secondDays} 天）之后，` +
        `${top.category}的日均播放量从前半段的 ${top.firstDailyViews.toFixed(1)} 次/天变成后半段的 ` +
        `${top.secondDailyViews.toFixed(1)} 次/天（${formatDelta(top.growthPct ?? 0, 2)}）；` +
        `${last.category}从 ${last.firstDailyViews.toFixed(1)} 变成 ${last.secondDailyViews.toFixed(1)} ` +
        `（${formatDelta(last.growthPct ?? 0, 2)}）。` +
        `${ranked.length} 个分区里 ${up} 个上涨，首末之间相差 ` +
        `${((top.growthPct ?? 0) - (last.growthPct ?? 0)).toFixed(2)} 个百分点。`,
      hypothesis:
        `这个排名只说明「两段的日均播放量谁比谁高」，不说明为什么。` +
        `至少有三个可能：两段的星期构成不同（下一条专门说这个）、内容本身在变、以及抽样波动。` +
        `这份数据里前面两个原因都是生成时设定好的（周末权重 + 各分区的基础播放量权重），` +
        `所以它演示的是分析口径，不是对现实世界里内容兴衰的判断。`,
      action:
        `要在自己的数据上做同样的判断，先确认两段可比：把窗口拉长，让两段的星期构成接近，` +
        `再看排名还稳不稳。如果换个窗口名次就翻，那说明这个「增长最快」是窗口挑出来的，` +
        `不是内容真的在变。`,
    })

    /* ---- 洞察二：★ 这一条是这一类问题的关键 —— 排名里有多少是周末 ---- */
    {
      /* 全跌 + 前段周末更多 = 方向完全一致。这时候「是不是周末造成的」就不是猜测，是算式。 */
      const sameDirection = up === 0 && mix.firstWeekendDays > mix.secondWeekendDays
      out.push({
        title: '这个排名有多少是「周末」造成的',
        fact:
          `前半段 ${mix.firstDays} 天里有 ${mix.firstWeekendDays} 天是周末、` +
          `${mix.firstDays - mix.firstWeekendDays} 天不是；后半段 ${mix.secondDays} 天里是 ` +
          `${mix.secondWeekendDays} 天 / ${mix.secondDays - mix.secondWeekendDays} 天。` +
          (ratio !== null
            ? `整段 60 天里，周末的日均播放量是工作日（周一至周四）的 ${ratio.toFixed(3)} 倍。`
            : '') +
          (sameDirection
            ? `两段的周末天数刚好是 ${mix.firstWeekendDays} 天 vs ${mix.secondWeekendDays} 天，` +
              `方向和「后半段全面低于前半段」完全一致。`
            : `两段的周末天数差 ${Math.abs(mix.firstWeekendDays - mix.secondWeekendDays)} 天，` +
              `这个差值会给「后半段 vs 前半段」的对比带来一个系统性的偏移。`),
        hypothesis:
          `数据生成时设了 DOW_MULTIPLIER：周末 1.18、周五 1.06、周一至周四 1.0` +
          `（见 src/data/dataset.ts）。也就是说「后半段低于前半段」这件事，` +
          `有一部分是这几个参数决定的，不是内容在衰退。` +
          `反过来，如果两段的周末天数一样多，这个偏差就会相互抵消掉。`,
        action:
          `用这个口径之前先看两段的星期构成：可比就按日均直接比；不可比就把窗口拉长，` +
          `或者改用「同样长的两个周期」做环比 —— 那种比法两段的星期构成天然接近，不受这个干扰。` +
          otherWindowNote(d),
      })
    }

    /* ---- 洞察三：口径本身 ---- */
    out.push({
      title: '这个口径不是环比，别当成增长趋势用',
      fact:
        `这里比的是【同一个窗口自己】的前后两半：近 ${d.days} 天窗口里的 ` +
        `${mix.firstStart} ~ ${mix.firstEnd} 对 ${mix.secondStart} ~ ${mix.secondEnd}，` +
        `切出来是 ${mix.firstDays} 天 vs ${mix.secondDays} 天。` +
        otherWindowNote(d),
      hypothesis:
        `「窗口内部对半切」和「和上一个同样长的周期比」是两回事：` +
        `前者不跨周期，但它测的是「这个窗口里前面热闹还是后面热闹」，` +
        `窗口一换，切分点就变了，排名也跟着变。` +
        `它的稳定性只取决于每段有多长 —— 一段只有三四天时，` +
        `一天的异常（一个爆款、一次活动）就能把名次整个掀翻。`,
      action:
        `报「增长」的时候，先用同样长的两个周期做环比；要看窗口内部的走向再用这个口径，` +
        `并且把两段的日期和天数一起写出来 —— 不写日期，读者没法判断这两段可不可比。`,
    })

    return out
  },

  fallback:
    '当前时间窗口里没有取到可用的分区对比数据，所以给不出结论。' +
    '这通常是数据库还没建好、或者查询出错导致的，请看上面「执行分析」那一步的说明。',
}

/* ==========================================================================
   意图四：内容分区完播率排名（Demo 3）
   ========================================================================== */

/** 最年轻的那一档。图表和结论模板都要用它算「观众构成」，只此一处。 */
const YOUNGEST_AGE: AgeGroupId = AGE_GROUP_IDS[0]

/** 本意图唯一的查询。 */
function completionQueries(ctx: QueryContext): SqlQuerySpec[] {
  return [completionRankQuery(ctx)]
}

/**
 * 从 SQL 结果里取完成率排名（降序）。
 *
 * ★ 排序在【这里】做一次，图表和结论模板都读它 ——
 *   两边各排一次，迟早出现「图上第一名和结论里说的第一名不是同一个」，
 *   而且不报错、不抛异常，只是自相矛盾。
 */
function completionRanking(d: AnalysisData): SqlCaseRow[] {
  return [...rowsOf(d, COMPLETION_RANK_QUERY_ID)].sort(
    (a, b) => num(b.rate_pct) - num(a.rate_pct),
  )
}

/**
 * 另一个时间窗口里完成率第一名是谁 —— 从离线 Pandas 结果里现算。
 *
 * ★ 为什么要这个：这张榜的名次会随窗口翻（近 7 天第一是影视、近 14/30 天是音乐）。
 *   结论里如果不提这件事，用户换成 7 天再看就会发现「你说的第一名不对」。
 *   写死一个名字更糟：那个名字只在某一个窗口里成立。
 * ★ 为什么读的是 Pandas 而不是 SQL：本次只跑了当前窗口那一条 SQL，
 *   另外两个窗口这次没有真跑 —— 页面上的说法必须和这一点对得上。
 */
function completionTopIn(py: PyResults, days: number): string | null {
  const by = py.windows[String(days)]?.byCategory
  if (!by) return null
  const entries = Object.entries(by)
  if (entries.length === 0) return null
  return entries.reduce((best, cur) => (cur[1].completed / cur[1].views > best[1].completed / best[1].views ? cur : best))[0]
}

/**
 * 某个时间窗口里完成率【最低】的分区。
 *
 * ★ 为什么单独要一个：结论和洞察三里都有一句「几个窗口都排在末位的是 X」。
 *   原先那句话是从【当前窗口】的末位直接取名、再断言另外几个窗口也一样 ——
 *   而代码从来没有算过另外几个窗口的末位。当前数据下它恰好成立
 *   （三个窗口的末位都是动画），但这是一句【无条件写死的事实断言】：
 *   改种子、改数据集之后它会继续说，而不报错、不抛异常。
 */
function completionLastIn(py: PyResults, days: number): string | null {
  const by = py.windows[String(days)]?.byCategory
  if (!by) return null
  const entries = Object.entries(by)
  if (entries.length === 0) return null
  return entries.reduce((worst, cur) =>
    cur[1].completed / cur[1].views < worst[1].completed / worst[1].views ? cur : worst,
  )[0]
}

/** 几个时间窗口里，完成率榜的「第一名 / 末位」分别是谁、稳不稳 */
interface CompletionWindowRanks {
  /** 全部时间窗口，升序 */
  windows: number[]
  /** 每个窗口的第一名 */
  tops: { w: number; name: string }[]
  /** 除当前窗口之外的第一名 —— 页面文案里要列的那几个 */
  otherTops: { w: number; name: string }[]
  /** 除当前窗口之外的末位 */
  otherLasts: { w: number; name: string }[]
  /** 第一名在几个窗口之间会不会翻 */
  topFlips: boolean
  /** 几个窗口的末位如果恰好是同一个，返回它；否则 null（含数据不足） */
  stableLast: string | null
}

/**
 * 把上面那些「跨窗口的名次」一次算齐 —— 结论和洞察三共用一份。
 *
 * ★ 窗口列表从离线结果里真实存在的键取，不写死 7/14/30。
 *   （这一步原先在结论和洞察里各写了一遍 `[7, 14, 30]`，两处都是硬编码。）
 * ★ 为什么抽成一个函数：结论和洞察三都要说「另外几个窗口的第一名是谁、
 *   末位稳不稳」。各写一份的话迟早出现「结论说末位稳、洞察说末位也换了」
 *   这种自相矛盾 —— 而且不报错、不抛异常，只是让人不再信任这一页。
 *   和 weightCompare.ts / halfWindow.ts 是同一个理由。
 */
function completionWindowRanks(py: PyResults, days: number): CompletionWindowRanks {
  const windows = Object.keys(py.windows)
    .map(Number)
    .sort((a, b) => a - b)
  const tops: { w: number; name: string }[] = []
  const lasts: { w: number; name: string }[] = []
  for (const w of windows) {
    const t = completionTopIn(py, w)
    const l = completionLastIn(py, w)
    if (t !== null) tops.push({ w, name: t })
    if (l !== null) lasts.push({ w, name: l })
  }
  const lastNames = [...new Set(lasts.map((l) => l.name))]
  return {
    windows,
    tops,
    otherTops: tops.filter((t) => t.w !== days),
    otherLasts: lasts.filter((l) => l.w !== days),
    topFlips: new Set(tops.map((t) => t.name)).size > 1,
    stableLast: lasts.length >= 2 && lastNames.length === 1 ? lastNames[0] : null,
  }
}

/**
 * 「末位稳不稳」那半句 —— 结论和洞察三各自接在不一样的句子后面，
 * 所以只把【说法】抽出来，两处保证用同一份判断。
 *
 * ★ 稳定的意思是「几个窗口里垫底的都是同一个分区」，返回那句话；
 *   不稳定时如实说末位也换了、并列出另外几个窗口的末位 ——
 *   不能因为「本来以为它稳」就继续写「只有它稳」。
 */
function completionLastNote(ranks: CompletionWindowRanks): string {
  if (ranks.stableLast !== null) {
    return `${ranks.windows.length} 个窗口都排在末位的只有${ranks.stableLast}`
  }
  const bits = ranks.otherLasts.map((l) => `近 ${l.w} 天的${l.name}`).join('、')
  return (
    `连末位也会换：另外 ${ranks.otherLasts.length} 个窗口排在末位的分别是${bits}` +
    `，所以这个榜不该拿「垫底的是谁」当一条固定规律`
  )
}

/**
 * 某一档人在某个分区的播放量，占该分区全部播放量的比例（%）。
 * 取不到返回 null。用来讲「这个分区的观众主要是谁」。
 */
function ageViewShareIn(
  py: PyResults,
  days: number,
  age: AgeGroupId,
  category: string,
): number | null {
  const rows = py.windows[String(days)]?.agePreference
  if (!rows || rows.length === 0) return null
  let target = 0
  let total = 0
  for (const row of rows) {
    const cell = row.cells.find((c) => c.category === category)
    if (!cell) return null
    total += cell.views
    if (row.age === age) target += cell.views
  }
  return total > 0 ? (target / total) * 100 : null
}

export const completionRank: Intent = {
  id: 'completionRank',
  analysisType: '内容分区完播率排名',
  /* 与 agePreference 同档（8）。它问的是「哪个分区看得完」，
     和「哪一档人爱看什么」是同一层的横向比较，没有谁更具体。 */
  priority: 8,

  rules: [
    {
      id: 'kw-completion',
      label: '问的是完播 / 完成率',
      /*
        ★ 这条必须是【必答题】。只靠「内容 / 类别 / 视频」这些词，
          「最近哪些内容类别增长最快」（demo-4）会被一起吸过来 —— 它也含「内容类别」。
          加上必答的完播词，demo-4 自然出局（它问的是增长，不是看完没有）。

        ★ 为什么【不】放「播放」「观看」「消费」「深度」：
          它们不指向「看完了没有」，放进来这条必答题就形同虚设。
      */
      any: ['完成率', '完播率', '完播', '完成度', '看完', '看完的比例'],
      weight: 1,
      required: true,
    },
    {
      id: 'kw-content',
      label: '问的是内容 / 分区',
      any: ['内容', '类别', '分区', '品类', '题材', '类型', '视频'],
      weight: 1,
    },
    {
      id: 'kw-rank',
      label: '在问排名 / 高低',
      /* ★ 不放「前几」「第几」这类更空的词，它们对判断意图没有增量。 */
      any: ['最高', '最低', '哪个', '哪些', '排名', '最差', '最好'],
      weight: 0.5,
    },
  ],

  slots: (m: MatchResult): IntentSlot[] => [
    { label: '分析对象', value: '全站 8 个内容分区（不区分人群）' },
    {
      label: '核心指标',
      value: '各分区的高完成度观看次数 ÷ 播放次数（完成率 %），按完成率排名',
    },
    {
      /* ★ 后半句不是客套：slots 看不见页面上真正选的时间窗口，只看得见问题文本里的天数 */
      label: '时间维度',
      value: `近 ${m.entities.days ?? 30} 天（以页面上选的时间窗口为准）`,
    },
    {
      label: '要回答的',
      value:
        '哪个分区被看完的比例最高、名次稳不稳，以及这个榜单有多少是「观众构成」带出来的——不是内容质量',
    },
  ],

  plan: (m: MatchResult): PlanStep[] => [
    {
      no: 1,
      title: '按内容分区数出「看完了」的次数和播放次数',
      detail:
        '「高完成度」的判定 = 实际观看时长 ≥ 视频时长 × 0.8，且视频时长大于 0。' +
        '这个 0.8 不在这条 SQL 里定义，直接从 metrics.ts 的常量插值进来 —— ' +
        '口径只有一处定义，页面上那条 SQL 的原文里看得见它。',
      tool: 'sql',
    },
    {
      no: 2,
      title: '相除得到完成率，从高到低排',
      detail: '比的是比例不是总量：播放量大的分区在总量上天然占优，那读的是「哪个分区人多」。',
      tool: 'sql',
    },
    {
      no: 3,
      title: '换两个口径各算一遍，看名次稳不稳',
      detail:
        '另外两个时间窗口的名次从离线结果里现算，和当前窗口对照 —— ' +
        '这张榜的前几名之间只差百分之几，换个窗口就会翻，只有末位是稳的。',
      tool: 'python',
    },
    {
      no: 4,
      title: '查这个榜单的观众构成',
      detail:
        '算每个分区的播放量里「最年轻那一档人」占多少。' +
        '这一步是这条分析最要紧的一步：完成率的差距有可能不是内容好坏，而是看的人不一样。',
      tool: 'frontend',
    },
    {
      no: 5,
      title: '用 Pandas 把同一批数字独立算一遍',
      detail:
        '离线跑好的 byCategory 与上面那条 SQL 逐项对照（高完成度次数、播放次数两个合计）。' +
        '两套完全独立的实现算同一个数，对得上才敢用。',
      tool: 'python',
    },
    {
      no: 6,
      title: '汇总成结论，并如实说明榜单有多少是观众构成',
      detail:
        '数据事实和原因假设分开写。把「观众年龄构成」讲成「内容质量」，' +
        '是这类分析里最容易犯、也最不该犯的错。',
      tool: 'frontend',
    },
  ],

  tools: [
    {
      tool: 'sql',
      why:
        '按分区做条件聚合（SUM(CASE WHEN …)）正好是 SQL 的主场，' +
        '而且能在浏览器里当场跑出结果，耗时是实测的。',
      mode: 'live',
    },
    {
      tool: 'python',
      why:
        '同一批数字在 Pandas 里用另一套完全独立的实现又算了一遍，' +
        '另外两个窗口的排名也在这里现算。这部分由 analyze.py 在本机离线跑过，' +
        '页面读的是那次运行的结果，不是当场执行。',
      mode: 'offline',
    },
  ],

  charts: ['completionRank'],

  queries: completionQueries,

  pyCaseIds: ['clean', 'cross'],

  verdict: (d: AnalysisData): string => {
    const rows = completionRanking(d)
    if (rows.length === 0) return completionRank.fallback

    const top = rows[0]
    const second = rows[1]
    const last = rows[rows.length - 1]
    const topRate = num(top.rate_pct)

    const parts: string[] = []
    parts.push(
      `近 ${d.days} 天，${rows.length} 个内容分区里完成率最高的是${String(top.category)}：` +
        `${formatPercent(topRate, 2)}——每 100 次播放里有 ${topRate.toFixed(1)} 次是看完了的。`,
    )
    if (second) {
      parts.push(
        `第二名是${String(second.category)}（${formatPercent(num(second.rate_pct), 2)}），` +
          `只差 ${(topRate - num(second.rate_pct)).toFixed(2)} 个百分点。`,
      )
    }
    parts.push(
      `最低的是${String(last.category)}（${formatPercent(num(last.rate_pct), 2)}）。`,
    )

    /*
      这张榜名次会随窗口翻 —— 必须说出来，否则读者换个窗口就以为结论错了。
      ★ 下面每一句都是现算的。「这份排名不稳」这句话本身也是：
        它成立与否是数据决定的，无条件写死的话，哪天几个窗口的第一名撞到同一档，
        页面就会理直气壮地说一句假话。
      ★ 末位那半句尤其要现算：原先它是从当前窗口的末位直接取名、
        再断言另外几个窗口也一样，而代码从来没算过另外几个窗口的末位。
    */
    const ranks = completionWindowRanks(d.py, d.days)
    if (ranks.otherTops.length > 0) {
      parts.push(
        (ranks.topFlips ? '这份排名不稳：' : '这份排名在几个窗口之间是一致的：') +
          `另外 ${ranks.otherTops.length} 个窗口的第一名分别是` +
          ranks.otherTops.map((o) => `近 ${o.w} 天的${o.name}`).join('、') +
          `。${completionLastNote(ranks)}——` +
          `（那 ${ranks.otherTops.length} 个窗口这次没有真跑 SQL，名字是从离线 Pandas 结果里现算的。）`,
      )
    }

    /* 口径提醒：完成率讲的是「看完没有」，不是「看得久不久」 */
    parts.push(
      `口径上有一点要说明：这里比的是「看完了的比例」，不是「看得久不久」——` +
        `一个很长的视频可以被看很久但仍然没看完。` +
        `另外，这个榜单有一大半是「谁在看」带出来的，不是内容质量，下面第 1 条洞察做了逐项对照。`,
    )
    return parts.join('')
  },

  evidence: (d: AnalysisData): EvidenceItem[] => {
    const rows = completionRanking(d)
    if (rows.length === 0) return []

    const top = rows[0]
    const second = rows[1]
    const last = rows[rows.length - 1]
    const items: EvidenceItem[] = [
      {
        label: '完成率第一名',
        value: `${String(top.category)} ${formatPercent(num(top.rate_pct), 2)}`,
        sample: `近 ${d.days} 天，数据截止 ${d.endDate}`,
      },
    ]

    if (second) {
      items.push({
        label: '与第二名的差距',
        value: `${(num(top.rate_pct) - num(second.rate_pct)).toFixed(2)} 个百分点`,
        compare: `第二名${String(second.category)} ${formatPercent(num(second.rate_pct), 2)}`,
        sample: second === last ? undefined : '差距小于 0.1 个百分点时，换个窗口先后就会翻',
      })
    }

    items.push({
      label: '完成率最低',
      value: `${String(last.category)} ${formatPercent(num(last.rate_pct), 2)}`,
      compare: `是第一名${String(top.category)}的 ${(num(last.rate_pct) / Math.max(0.01, num(top.rate_pct))).toFixed(2)} 倍`,
      sample: '榜单里最不容易被窗口切换动摇的名次',
    })

    /* 观众构成：最年轻那一档在每个分区播放量里的占比 */
    const youngTop = ageViewShareIn(d.py, d.days, YOUNGEST_AGE, String(top.category))
    const youngLast = ageViewShareIn(d.py, d.days, YOUNGEST_AGE, String(last.category))
    if (youngTop !== null && youngLast !== null) {
      items.push({
        label: `${ageGroupLabel(YOUNGEST_AGE)}的播放量占比`,
        value: `${String(last.category)} ${formatPercent(youngLast, 2)}`,
        compare: `${String(top.category)} ${formatPercent(youngTop, 2)}`,
        sample:
          '同一档人在「看的人更年轻」的分区里占比明显更高 —— ' +
          '这是完成率差距的一部分来源，不全是内容本身',
      })
    }

    /* 时长：用来反驳「短视频当然更容易看完」 */
    const durOf = (category: string) =>
      d.py.content.categories.find((c) => c.category === category)?.medianDuration
    const durTop = durOf(String(top.category))
    const durLast = durOf(String(last.category))
    if (durTop !== undefined && durLast !== undefined) {
      items.push({
        label: '视频时长中位数',
        value: `${String(top.category)} ${formatMinutes(durTop / 60)}`,
        compare: `${String(last.category)} ${formatMinutes(durLast / 60)}`,
        sample:
          `整份数据里「时长 vs 完播率」的相关系数只有 ${d.py.content.durationCompletionR.toFixed(4)}` +
          '（1000 个视频），时长几乎解释不了完播率',
      })
    }

    return items
  },

  insight: (d: AnalysisData): Insight[] => {
    const rows = completionRanking(d)
    if (rows.length === 0) return []

    const top = rows[0]
    const second = rows[1]
    const last = rows[rows.length - 1]

    /* 这一条要的数字全部现算，一个都不写死 */
    const youngTop = ageViewShareIn(d.py, d.days, YOUNGEST_AGE, String(top.category))
    const youngLast = ageViewShareIn(d.py, d.days, YOUNGEST_AGE, String(last.category))

    /* 同一个分区内部，最年轻那一档和最年长那一档各自的完播率差多少 */
    const ageRows = d.py.windows[String(d.days)]?.agePreference ?? []
    const rateIn = (age: string, category: string) =>
      ageRows.find((r) => r.age === age)?.cells.find((c) => c.category === category)
        ?.completedRate ?? null
    const youngRate = rateIn(YOUNGEST_AGE, String(last.category))
    const oldRate = rateIn(AGE_GROUP_IDS[AGE_GROUP_IDS.length - 1], String(last.category))
    const rateGap =
      youngRate !== null && oldRate !== null && youngRate > 0 ? oldRate / youngRate : null

    const durOf = (category: string) =>
      d.py.content.categories.find((c) => c.category === category)?.medianDuration ?? null
    const durTop = durOf(String(top.category))
    const durLast = durOf(String(last.category))

    const ranks = completionWindowRanks(d.py, d.days)
    const others = ranks.otherTops
      .filter((x): x is { w: number; name: string } => x.name !== null)

    const out: Insight[] = [
      {
        title: '这个榜单有一大半是「观众是谁」，不是「内容好不好」',
        fact:
          (youngTop !== null && youngLast !== null
            ? `${ageGroupLabel(YOUNGEST_AGE)}贡献了${String(last.category)} ` +
              `${formatPercent(youngLast, 2)} 的播放量，在${String(top.category)}上只有 ` +
              `${formatPercent(youngTop, 2)}——排名垫底的分区，观众明显更年轻。`
            : '') +
          (youngRate !== null && oldRate !== null
            ? `而在${String(last.category)}这一个分区【内部】，${ageGroupLabel(YOUNGEST_AGE)}的完成率是 ` +
              `${formatPercent(youngRate, 2)}、最年长那一档是 ${formatPercent(oldRate, 2)}——` +
              `同一批内容，换一批观众看，差 ${rateGap !== null ? rateGap.toFixed(1) : '—'} 倍。`
            : '') +
          ' 也就是说，分区之间的差距有很大一部分只是「看的人不一样」。',
        hypothesis:
          '这份数据生成时，「看不看完」是按【年龄段】设的倍率（dataset.ts 的 COMPLETION_FACTOR：' +
          '最年轻那一档 0.92、最年长那一档 1.12），并按【年龄段】设了内容偏好权重（CATEGORY_PREFERENCE）。' +
          '两个参数一叠加，一个分区的完成率就主要是它观众的年龄结构决定的 —— ' +
          '换句话说，这个我「测出来」的规律，是我当初写进生成器的参数体现出来的。',
        action:
          '如果要用完成率考核内容，先按每个分区观众的年龄构成做标准化，' +
          '再比内容之间的高低；不标准化的话，这个指标奖励的是「观众偏年长」的分区，不是「内容做得好」的分区。',
      },
      {
        title: '视频长短和完播率几乎不相关',
        fact:
          `整份数据里「视频时长 vs 完播率」的相关系数只有 ` +
          `${d.py.content.durationCompletionR.toFixed(4)}（${d.py.content.videosAnalyzed} 个视频）。` +
          (durTop !== null && durLast !== null
            ? ` 分区层面也一样：中位时长 ${formatMinutes(durTop / 60)} 的${String(top.category)}排在前列，` +
              `中位时长 ${formatMinutes(durLast / 60)} 的${String(last.category)}排在末位——` +
              `长视频没有吃亏。`
            : ''),
        hypothesis:
          '生成数据时「这次看完了没有」是按年龄段的比例抽的，和视频时长是两件独立的事，' +
          '没有写进「长视频更难看完」这条规则。所以这份数据里不该看到时长效应。',
        action:
          '不要把「时长」当作完播率的解释变量来用。真要看时长的影响，' +
          '得先按内容类型分组，再看组内的相关性——混在一起算出来的相关系数会把两件事抵消掉。',
      },
      {
        /*
          ★ 标题也不能写死。它断言的是「垫底那个名次是稳的」——
            而稳不稳是数据决定的：原先这个判断根本没算过，
            只是从当前窗口的末位取了个名字，就默认它在别的窗口也垫底。
            现在按 ranks.stableLast 走：不稳就如实换个说法，
            而不是继续把一条没验证过的规律摆在标题上。
        */
        title:
          ranks.stableLast !== null
            ? '这个榜单只有垫底那个名次是稳的'
            : '这个榜单连垫底那个名次都不稳',
        fact:
          `近 ${d.days} 天第一名是${String(top.category)}` +
          (others.length > 0
            ? (ranks.topFlips
                ? `，但另外 ${others.length} 个窗口的第一名分别是`
                : `；另外 ${others.length} 个窗口的第一名分别是`) +
              others.map((o) => `近 ${o.w} 天的${o.name}`).join('、') +
              `；${completionLastNote(ranks)}。`
            : '。') +
          (second
            ? ` 而且本次前两名只差 ${(num(top.rate_pct) - num(second.rate_pct)).toFixed(2)} 个百分点，` +
              `这个差距小到换个窗口就会翻过来。`
            : ''),
        hypothesis:
          '相邻名次之间的差距落在抽样噪声的量级里：每个分区在窗口内只有几千次播放，' +
          '完成率是个比例，样本量不够时名次本来就会跳。',
        action:
          /* ★ 建议里点名「末位那个」也得先确认它真的稳，否则等于推荐了一个不稳的东西 */
          (ranks.stableLast !== null
            ? `只对跨窗口稳定的名次下结论（这一次是末位的${ranks.stableLast}）`
            : '这个榜里没有哪个名次扛得住换窗口，所以任何名次都别单独拿去驱动动作') +
          `；要比较相邻两名，先看几个窗口是不是一致，` +
          '别拿一次查询的名次差当成「内容质量差距」。',
      },
    ]

    return out
  },

  fallback:
    '当前时间窗口里没有取到可用的分区完成率数据，所以给不出结论。' +
    '这通常是数据库还没建好、或者查询出错导致的，请看上面「执行分析」那一步的说明。',
}

/* ==========================================================================
   意图五：哪些用户群体存在活跃度下降（Demo 5）
   ========================================================================== */

/** 本意图唯一的查询。 */
function segmentQueries(ctx: QueryContext): SqlQuerySpec[] {
  return [segmentTrendQuery(ctx)]
}

/** 本次真跑的 SQL 结果（4 行，一行一个年龄段）。 */
function segmentRowsOf(d: AnalysisData): SqlCaseRow[] {
  return rowsOf(d, SEGMENT_TREND_QUERY_ID)
}

/**
 * 按 change_pp 从低到高排（跌得最多的在最前）。
 *
 * ★ 排序只在【这里】做一次，结论、数据依据、洞察三处都读它 ——
 *   各排各的，迟早出现「结论说降幅最大的是 25–31、洞察说是 18–24」，
 *   而且不报错、不抛异常，只是自相矛盾。
 */
function segmentRanking(d: AnalysisData): SqlCaseRow[] {
  return [...segmentRowsOf(d)].sort((a, b) => num(a.change_pp) - num(b.change_pp))
}

/** 窗口两段的日期与星期构成。读的是离线 Pandas 结果，和图表卡共用同一份实现。 */
function segmentMix(d: AnalysisData) {
  const seg = d.py.windows[String(d.days)]?.segmentTrend
  if (!seg || seg.segments.length === 0) return null
  return halfWindowMix(seg)
}

/**
 * 另一个时间窗口里降幅最大的是哪一档 —— 从离线 Pandas 结果里现算。
 *
 * ★ 为什么需要它：这一问最要紧的答案就是「这个名次稳不稳」。
 *   本次只跑了当前窗口那一条 SQL，另外两个窗口这次没有真跑 ——
 *   所以另外两个窗口的数字只能从离线结果里取，页面上的说法必须和这一点对得上。
 * ★ 为什么不写死一个名字：写死的话，用户换个窗口再看，页面就在说假话。
 */
function segmentWorstIn(py: PyResults, days: number): { age: string; changePp: number } | null {
  const seg = py.windows[String(days)]?.segmentTrend
  if (!seg || seg.segments.length === 0) return null
  const worst = seg.segments.reduce((a, b) => (b.changePp < a.changePp ? b : a))
  return { age: worst.age, changePp: worst.changePp }
}

/**
 * 另外两个窗口里「降幅最大的是哪一档」。
 *
 * ★ 这一段是这一问最值钱的一块内容：它把「这个排名不可靠」从一句主观判断
 *   变成三个现算出来的名字。窗口取自离线结果里真实存在的键（不写死 7/14/30），
 *   所以换数据集、改种子之后这句话会跟着变，不会变成一句假话。
 */
function otherSegmentNote(d: AnalysisData): string {
  const worsts: { days: number; age: string; changePp: number }[] = []
  const windows = Object.keys(d.py.windows)
    .map(Number)
    .sort((a, b) => a - b)
  for (const w of windows) {
    if (w === d.days) continue
    const worst = segmentWorstIn(d.py, w)
    if (worst) worsts.push({ days: w, ...worst })
  }
  if (worsts.length === 0) return ''

  /*
    ★ 另外两个窗口如果和当前窗口是同一档，就别把同一个名字列两遍 ——
      「分别是 25-31、25-31」技术上没说错，但读起来像出了 bug，
      而且会让人以为页面在硬凑「名次会翻」这个结论。
  */
  const current = segmentWorstIn(d.py, d.days)
  if (current && worsts.every((w) => w.age === current.age)) {
    return (
      `另外两个窗口里，降幅最大的也都是${ageGroupLabel(asAge(current.age))}` +
      `（${worsts.map((w) => `近 ${w.days} 天 ${formatDelta(w.changePp, 2)} 个百分点`).join('、')}），` +
      `和这一窗口是同一档。`
    )
  }

  return (
    `另外两个窗口里，降幅最大的一档分别是：` +
    `${worsts
      .map((w) => `近 ${w.days} 天是${ageGroupLabel(asAge(w.age))}（${formatDelta(w.changePp, 2)} 个百分点）`)
      .join('、')}。`
  )
}

/**
 * 三个时间窗口里，「降幅最大的是哪一档」是不是不一致。
 *
 * ★ 为什么需要它：结论模板里有一句「换个时间窗口名次就翻」，它给上面那个
 *   排名打折，是这一页最要紧的一句话。而这句话**成立与否是数据决定的** ——
 *   如果是无条件写死的，哪天某次改种子让三个窗口的第一名撞到同一档，
 *   页面就会理直气壮地说一句假话：不报错、不抛异常，只是错的。
 *   所以它必须现算。（当前数据下确实会翻：25-31 / 25-31 / 18-24。）
 * ★ 窗口列表从离线结果里真实存在的键取，不写死 7/14/30。
 */
function segmentWorstVaries(py: PyResults): boolean {
  const ages = Object.keys(py.windows)
    .map((w) => segmentWorstIn(py, Number(w)))
    .filter((x): x is { age: string; changePp: number } => x !== null)
    .map((x) => x.age)
  return ages.length > 1 && new Set(ages).size > 1
}

export const segmentDecline: Intent = {
  id: 'segmentDecline',
  analysisType: '分人群活跃度变化诊断',
  /*
    ★ 11，比 activityDecline（10）大。
      这两类问题问的都是「活跃度下降」，差别只在【要不要分人群】——
      所以分人群的这个更具体，同分时该它赢。
      但真正让它赢的不是这个数：见下面 kw-segment 那条必答题。
  */
  priority: 11,

  rules: [
    {
      id: 'kw-segment',
      label: '问的是【某一群】用户',
      /*
        ★ 这条必须是【必答题】，而且它担着这一步最要紧的一件活：
          把「为什么最近用户活跃度下降？」（demo-1）挡在外面。
          那一条也含「活跃度」和「下降」，光靠这两个词，两条意图会打成平手，
          甚至因为 activityDecline 的 priority 也是两位数而互相抢。
          加了「必须提到某群人」这个条件，demo-1（全程没提人群）自然出局，
          而它该去的地方正是 activityDecline —— 那边本来就更早、更完整。

        ★ 为什么【不】放「用户」「人」「大家」这类词：
          它们对「要不要分人群」这个判断没有增量，
          「用户活跃度下降」里也有「用户」——放进来的话这条必答题就形同虚设。

        ★ 为什么【不】放光秃秃的「年龄段」：
          「18–24 岁用户最喜欢什么视频」（demo-2）问的是静态偏好，
          不是变化。放进来会把 demo-2 吸走。
          要问分年龄的变化，说法里通常带着「哪些年龄段」「哪个年龄段」，那就够了。
      */
      any: [
        '用户群体',
        '用户群',
        '群体',
        '人群',
        '细分人群',
        '用户分层',
        '哪类人',
        '哪些人',
        '哪些用户',
        '哪种人',
        '哪个年龄段',
        '哪些年龄段',
      ],
      weight: 1,
      required: true,
    },
    {
      id: 'kw-active',
      label: '问的是活跃度',
      any: ['活跃度', '活跃', 'dau', '日活', '打开频次', '来的次数'],
      weight: 1,
    },
    {
      id: 'kw-down',
      label: '在说下降',
      any: ['下降', '下跌', '下滑', '减少', '走低', '变差', '流失', '降低', '掉了'],
      weight: 1,
    },
    {
      id: 'kw-which',
      label: '在问是哪一群',
      any: ['哪些', '哪个', '哪几', '什么群体', '谁'],
      weight: 0.5,
    },
  ],

  slots: (m: MatchResult): IntentSlot[] => [
    { label: '分析对象', value: '全站 4 个年龄段，逐个看活跃率的变化' },
    {
      label: '核心指标',
      value: '各年龄段的日均活跃率（活跃人天 ÷（该档人数 × 天数）），窗口前半段 vs 后半段',
    },
    {
      /* ★ 后半句不是客套：slots 看不见页面上真正选的时间窗口，只看得见问题文本里的天数 */
      label: '时间维度',
      value: `近 ${m.entities.days ?? 30} 天（以页面上选的时间窗口为准），把这个窗口从中间对半切开`,
    },
    {
      label: '要回答的',
      value:
        '哪一档的活跃率跌得最多、这个名次稳不稳，以及它到底是「这群人在退」' +
        '还是被全站共有的节奏一起拖下去的',
    },
  ],

  plan: (m: MatchResult): PlanStep[] => {
    const days = m.entities.days ?? 30
    return [
      {
        no: 1,
        title: '把窗口从中间对半切开，按年龄段数出两段各自的活跃人天',
        detail:
          '活跃人天 = 「某人某天来过」去重后的计数，不是观看次数。' +
          '切分点从窗口里实际存在的日期数出来，不写死 days ÷ 2 —— ' +
          '写死的话，窗口里万缺了一天就会和离线那套错开一天，而错开一天不会报错。',
        tool: 'sql',
      },
      {
        no: 2,
        title: '换成人均口径：两段各算日均活跃率',
        detail:
          '分母是该年龄段自己的总人数，不是全站人数 —— 分子分母必须是同一批人。' +
          '而且必须【摊平成日均】：两段天数常常不等（近 7 天切出来是 3 天 vs 4 天），' +
          '拿「这半段里活跃过的人数」去比，天多的那半天然占便宜。',
        tool: 'sql',
      },
      {
        no: 3,
        title: '算每一档的变化并排名',
        detail:
          '变化 = 后半段日均活跃率 − 前半段，单位是【百分点】不是百分比。' +
          '四档跨度为 0 附近时，说明排名本身没有意义 —— 这一点必须写进结论，不能只报第一名。',
        tool: 'sql',
      },
      {
        no: 4,
        title: '查另外两个时间窗口里排第一的是谁',
        detail:
          '这是这一步最要紧的一步：如果换个窗口名次就翻，那么「降幅最大的那一档」' +
          '就不是一个稳定的发现，而是窗口挑出来的。数字从离线结果里现算，不写死一个名字。',
        tool: 'python',
      },
      {
        no: 5,
        title: '查两段的「星期构成」，以及周末的活跃倍率',
        detail:
          `这份数据里周末的活跃度明显更高（生成时设的 DOW_MULTIPLIER，见 src/data/dataset.ts），` +
          `所以两段的周末天数差多少，直接决定了这个排名可不可信。` +
          `近 ${days} 天窗口尤其要看——它只有三四天一段，一两天周末就能定胜负。`,
        tool: 'python',
      },
      {
        no: 6,
        title: '用 Pandas 把同一批数字独立算一遍',
        detail:
          '离线跑好的 segmentTrend 与上面那条 SQL 逐段对照（两段的活跃人天合计）。' +
          '两套完全独立的实现算同一个切分点，对得上才敢用。',
        tool: 'python',
      },
      {
        no: 7,
        title: '汇总成结论，并如实说明这个名次有多可靠',
        detail:
          '数据事实和原因假设分开写。如果这一窗口里四档是一起跌的，' +
          '那就必须说「没有哪一群在单独衰退」，不能挑一个跌得最多的说成「这群人出了问题」。',
        tool: 'frontend',
      },
    ]
  },

  tools: [
    {
      tool: 'sql',
      why:
        '对半切分、按年龄段分组、数活跃人天、算日均，SQL 一次查询就能全出来，' +
        '而且能在浏览器里当场跑出结果，耗时是实测的。' +
        '年龄段标签用的是 SQL 分析页案例 03 同一份 CASE WHEN 表达式，不是另写一份。',
      mode: 'live',
    },
    {
      tool: 'python',
      why:
        '同一批数字在 Pandas 里用另一套完全独立的实现又算了一遍（数日期、补档位的写法都不一样），' +
        '另外两个窗口的名次也从这里现算。这部分由 analyze.py 在本机离线跑过，' +
        '页面读的是那次运行的结果，不是当场执行。',
      mode: 'offline',
    },
  ],

  charts: ['segmentActiveRate'],

  queries: (ctx: QueryContext): SqlQuerySpec[] => segmentQueries(ctx),

  pyCaseIds: ['trend'],

  verdict: (d: AnalysisData): string => {
    const ranked = segmentRanking(d)
    if (ranked.length === 0) return segmentDecline.fallback

    const worst = ranked[0]
    const best = ranked[ranked.length - 1]
    const down = ranked.filter((r) => num(r.change_pp) < 0).length
    const spread = num(best.change_pp) - num(worst.change_pp)
    const mix = segmentMix(d)
    const ratio = weekendDauRatio(d.py)

    const parts: string[] = []

    parts.push(
      `近 ${d.days} 天从中间对半切开` +
        (mix
          ? `：前半段 ${mix.firstStart} ~ ${mix.firstEnd}（${mix.firstDays} 天），` +
            `后半段 ${mix.secondStart} ~ ${mix.secondEnd}（${mix.secondDays} 天）。`
          : '。') +
        `按【日均】活跃率比较这 ${ranked.length} 个年龄段，` +
        `降幅最大的是${ageGroupLabel(asAge(String(worst.age_group)))}` +
        `（${formatDelta(num(worst.change_pp), 2)} 个百分点，` +
        `${formatPercent(num(worst.first_daily_active_rate), 2)} → ` +
        `${formatPercent(num(worst.second_daily_active_rate), 2)}），` +
        `降幅最小的是${ageGroupLabel(asAge(String(best.age_group)))}` +
        `（${formatDelta(num(best.change_pp), 2)} 个百分点）。` +
        `${ranked.length} 档里下降的有 ${down} 档，首末之间一共差 ${spread.toFixed(2)} 个百分点。`,
    )

    /*
      ★ 这一段的每一句都在给「上面那个名次」打折，而且是拿算出来的数打折，
        不是拿一句「样本量小」糊过去。这是本意图存在的全部意义：
        读者问的是「哪群人在退」，诚实的答案是「按这个口径看不出来谁在单独退」。
        如果只报一个第一名就收工，这个页面就变成了一个看起来很权威的错误。
    */
    const otherNote = otherSegmentNote(d)
    /*
      ★ 第一句必须跟着数据走。无条件写「名次就翻」的话，
        哪次改种子让三个窗口的第一名撞到同一档，这句话就成了假话 ——
        而它是整段里最强的一句打折，假的代价比少说一句大得多。
    */
    const flips = segmentWorstVaries(d.py)
    parts.push(
      `★ 但这个「降幅最大」有多可靠，必须说清楚三件事。` +
        `一，${flips ? '换个时间窗口名次就翻：' : '这个名次扛得住换窗口：'}${otherNote}` +
        `二，四档之间的差距只有 ${spread.toFixed(2)} 个百分点，` +
        `而活跃率在这么短的窗口里本来就有一天几个百分点的抽样波动 —— ` +
        `名次落在噪声的量级里。` +
        `三，更要紧的是机制：这份数据在生成时，每个用户的活跃度是一个【固定值】` +
        `（年龄段的基础活跃度 × 他自己的个体差异系数），` +
        `每天唯一在变的东西是「星期几」这个【全体共用】的倍数。` +
        `也就是说，「某个年龄段自己在衰退」在这份数据里根本没有生成机制。`,
    )

    if (down === ranked.length) {
      parts.push(
        `所以这一窗口里四档一起跌，方向完全一致 —— 那更像是同一个东西在推它们，` +
          `而不是某一群人在离开。这个「同一个东西」就是两段的星期构成：` +
          `前半段 ${mix?.firstDays ?? 0} 天里有 ${mix?.firstWeekendDays ?? 0} 天是周末，` +
          `后半段 ${mix?.secondDays ?? 0} 天里有 ${mix?.secondWeekendDays ?? 0} 天是周末，` +
          (ratio !== null
            ? `而整段 60 天里，周末的日均活跃人数是工作日（周一至周四）的 ${ratio.toFixed(3)} 倍`
            : `而这份数据里周末的活跃度本就明显更高`) +
          `。所以这一跌主要是【窗口切出来的】，不是人群在退。`,
      )
    } else if (down === 0) {
      parts.push(
        `这一窗口里四档没有一个在跌，所以上面那个「降幅最大」实际上是【涨得最少】的那个 —— ` +
          `这个词才准确。`,
      )
    } else {
      parts.push(
        `这一窗口里四档有涨有跌、彼此方向都不一致，而差距又只有 ${spread.toFixed(2)} 个百分点 —— ` +
          `这正是「没有哪一群在走出独立行情」的样子。` +
          (mix
            ? `两段的星期构成（前 ${mix.firstWeekendDays} 天 / 后 ${mix.secondWeekendDays} 天周末）` +
              `也会给四档同时加上同一个偏移。`
            : ''),
      )
    }

    parts.push(
      `口径上要说清楚：这里比的是【窗口自己内部】的前后两半（就是上面写的那两个日期区间），` +
        `不是「本周 vs 上周」那种环比。而且单位是百分点不是百分比 —— ` +
        `活跃率从 44.8% 掉到 39.8% 是「降了 5.01 个百分点」，说成「降了 5.01%」会把它说小将近一倍。`,
    )

    return parts.join('')
  },

  evidence: (d: AnalysisData): EvidenceItem[] => {
    const ranked = segmentRanking(d)
    if (ranked.length === 0) return []

    const worst = ranked[0]
    const best = ranked[ranked.length - 1]
    const down = ranked.filter((r) => num(r.change_pp) < 0).length
    const spread = num(best.change_pp) - num(worst.change_pp)
    const mix = segmentMix(d)
    const ratio = weekendDauRatio(d.py)

    const label = (r: SqlCaseRow) => ageGroupLabel(asAge(String(r.age_group)))

    const items: EvidenceItem[] = [
      {
        label: '窗口是怎么切的',
        value: mix ? `前半段 ${mix.firstDays} 天 vs 后半段 ${mix.secondDays} 天` : '未取到',
        compare: mix ? `${mix.firstStart} ~ ${mix.firstEnd} ／ ${mix.secondStart} ~ ${mix.secondEnd}` : '',
        sample:
          '切分点从窗口里实际存在的日期数出来。这不是环比：两段都属于当前这个窗口，' +
          '换一个时间窗口，切分点就会变' +
          /*
            ★ 后半句同样不能写死。当前数据下三个窗口的第一名确实不同，
              但那是数据决定的；写死的话，改种子之后这里会跟着结论一起说假话。
          */
          (segmentWorstVaries(d.py)
            ? '，名次也跟着变（另外两个窗口的降幅第一名不是同一档）。'
            : '；不过这一次三个窗口的降幅第一名是同一档，名次没有跟着变。'),
      },
      {
        label: `降幅最大的：${label(worst)}`,
        value: `${formatDelta(num(worst.change_pp), 2)} 个百分点`,
        compare:
          `${formatPercent(num(worst.first_daily_active_rate), 2)} → ` +
          `${formatPercent(num(worst.second_daily_active_rate), 2)}`,
        sample: '变化 = 后半段日均活跃率 − 前半段日均活跃率（单位是百分点，不是百分比）',
      },
      {
        label: `降幅最小的：${label(best)}`,
        value: `${formatDelta(num(best.change_pp), 2)} 个百分点`,
        compare:
          `${formatPercent(num(best.first_daily_active_rate), 2)} → ` +
          `${formatPercent(num(best.second_daily_active_rate), 2)}`,
        sample: `和上面那行相差 ${spread.toFixed(2)} 个百分点`,
      },
      {
        label: `${ranked.length} 档里下降的`,
        value: `${down} 档`,
        compare:
          down === 0
            ? '这一窗口里没有一档在跌'
            : down === ranked.length
              ? '四档全在跌，方向一致'
              : `${ranked.length - down} 档不跌`,
        sample: '判定用的是严格小于 0；等于 0 的算「没涨没跌」，不四舍五入成下降',
      },
      {
        label: '四档之间的跨度',
        value: `${spread.toFixed(2)} 个百分点`,
        compare: `最大减最小`,
        sample:
          '这个跨度就是「排名」的全部信息量。跨度只有零点几个百分点时，' +
          '它落在抽样噪声的量级里 —— 这时候报第一名是在给一个随机结果戴帽子。',
      },
      {
        label: '两段各含几天周末',
        value: mix ? `前 ${mix.firstWeekendDays} 天 / 后 ${mix.secondWeekendDays} 天` : '未取到',
        compare: mix ? `两段一共 ${mix.firstDays} 天 / ${mix.secondDays} 天` : '',
        sample: '周末 = 周六 + 周日，按日期逐个数的。这是四档共同的干扰源，不是某一档特有的。',
      },
      {
        label: '周末 vs 工作日 的日均活跃人数',
        value: ratio !== null ? `${ratio.toFixed(3)} 倍` : '取不到',
        sample:
          '★ 注意这个倍率是拿【活跃人数】算的，不是拿播放量算的 —— ' +
          '这一页比的指标是活跃率，用播放量的倍率去解释它属于偷换口径。' +
          '整段 60 天一起算，基准是周一至周四（不含周五），和 dataset.ts 里 DOW_MULTIPLIER 的分档一致。',
      },
    ]

    return items
  },

  insight: (d: AnalysisData): Insight[] => {
    const out: Insight[] = []
    const ranked = segmentRanking(d)
    if (ranked.length === 0) return out

    const worst = ranked[0]
    const best = ranked[ranked.length - 1]
    const down = ranked.filter((r) => num(r.change_pp) < 0).length
    const spread = num(best.change_pp) - num(worst.change_pp)
    const mix = segmentMix(d)
    const ratio = weekendDauRatio(d.py)
    const label = (r: SqlCaseRow) => ageGroupLabel(asAge(String(r.age_group)))

    /* ---- 洞察一：★ 这一条是这一类问题的核心答案 ---- */
    out.push({
      title:
        down === ranked.length
          ? `四档一起跌：这份数据里没有哪一群在单独衰退`
          : down === 0
            ? `四档没有一个在跌，所谓「降幅最大」其实是涨得最少`
            : `四档涨跌方向不一致，差距又只有 ${spread.toFixed(2)} 个百分点`,
      fact:
        `把窗口对半切（前 ${mix?.firstDays ?? 0} 天 vs 后 ${mix?.secondDays ?? 0} 天）之后，` +
        `${ranked.length} 档里 ${down} 档的日均活跃率低于前半段，` +
        `降幅最大的是${label(worst)}（${formatDelta(num(worst.change_pp), 2)} 个百分点）、` +
        `最小的是${label(best)}（${formatDelta(num(best.change_pp), 2)} 个百分点），` +
        `首末相差 ${spread.toFixed(2)} 个百分点。${otherSegmentNote(d)}`,
      hypothesis:
        `「某群体在衰退」这件事，在这份数据里没有生成机制：` +
        `每个用户的活跃度在生成时就定死了（年龄段的基础活跃度 × 个体差异系数），` +
        `60 天里每天唯一在变的是「星期几」这个全体共用的倍数。` +
        `所以四档被同一只手推着走，它们要么一起跌、要么都在零点几个百分点以内小幅涨跌。` +
        `真正会随时间变的只有窗口的构成，不是人群本身。`,
      action:
        `真实业务里做人群活跃度诊断，第一步不是看谁排第一，而是先做两件事：` +
        `把窗口拉长到让两段可比（或者直接改用同样长的两个周期做环比），` +
        `以及算一下这个排名在几个不同窗口里稳不稳。` +
        `稳不住的名次不能拿去驱动运营动作 —— 那等于把资源投给一个随机数。`,
    })

    /* ---- 洞察二：名次是被什么推着走的 ---- */
    out.push({
      title: '这个名次有多少是「星期几」造成的',
      fact:
        `前半段 ${mix?.firstDays ?? 0} 天里有 ${mix?.firstWeekendDays ?? 0} 天是周末、` +
        `后半段 ${mix?.secondDays ?? 0} 天里有 ${mix?.secondWeekendDays ?? 0} 天是周末。` +
        (ratio !== null
          ? `整段 60 天里，周末的日均活跃人数是工作日（周一至周四）的 ${ratio.toFixed(3)} 倍。`
          : '') +
        (down === ranked.length && mix && mix.firstWeekendDays > mix.secondWeekendDays
          ? `两段的周末天数刚好是 ${mix.firstWeekendDays} 天 vs ${mix.secondWeekendDays} 天，` +
            `方向和「四档一起跌」完全一致。`
          : `两段的周末天数差 ${Math.abs((mix?.firstWeekendDays ?? 0) - (mix?.secondWeekendDays ?? 0))} 天。`),
      hypothesis:
        `数据生成时设了 DOW_MULTIPLIER：周末 1.18、周五 1.06、周一至周四 1.0` +
        `（见 src/data/dataset.ts）。它是【乘在每个人的活跃概率上】的，` +
        `所以四档受到的相对影响一样大 —— 这就是为什么它们会同涨同跌。` +
        `★ 一个可以直接验证的点：起点越高的档位，同样的相对变化折成百分点就越大，` +
        `所以「跌得最多的那一档」很可能只是「基数最大的那一档」，不等于这群人出了问题。`,
      action:
        `看人群变化时，把相对变化和绝对变化一起算：绝对变化（百分点）会放大高基数的档位，` +
        `相对变化（%）会放大低基数的档位，两个都看才不会被基数带偏。` +
        `如果两段的星期构成不可比，就换同样长的两个周期做环比 —— 那种比法两段天然接近。`,
    })

    /* ---- 洞察三：口径本身 ---- */
    out.push({
      title: '这个口径不是环比，单位也不是百分比',
      fact:
        `这里比的是【同一个窗口自己】的前后两半：近 ${d.days} 天里的 ` +
        `前 ${mix?.firstDays ?? 0} 天对后 ${mix?.secondDays ?? 0} 天，不跨周期。` +
        `变化一律用【百分点】表示：从 44.8% 到 39.8% 是 5.01 个百分点，不是 5.01%。`,
      hypothesis:
        `「窗口内部对半切」和「和上一个同样长的周期比」是两回事：` +
        `前者不跨周期，但它测的是「这个窗口里前面热闹还是后面热闹」，` +
        `窗口一换，切分点和名次都变。而百分点和百分比混用是最常见的口径事故：` +
        `5.01 个百分点说成 5.01%，等于把降幅说小了将近一倍。`,
      action:
        `报数时把四样东西一起写出来：两段的日期、两段各几天、分母是谁、单位是百分点还是百分比。` +
        `缺了任何一样，读者都没法判断这个数能不能用。`,
    })

    return out
  },

  fallback:
    '当前时间窗口里没有取到可用的分人群活跃率数据，所以给不出结论。' +
    '这通常是数据库还没建好、或者查询出错导致的，请看上面「执行分析」那一步的说明。',
}

/* ==========================================================================
   兜底意图：匹配不上、或者上面某个环节失败时走这里
   ========================================================================== */

/**
 * generic 不是「偷偷降级」，而是【明说没匹配上】。
 * 说清楚之后，仍然给一份全站概览——总比什么都不给有用，
 * 但顶部必须讲明白：这不是针对你这个问题的分析。
 */
export const genericIntent: Intent = {
  id: 'generic',
  analysisType: '通用概览（未匹配到专门的分析类型）',
  priority: 0,
  rules: [],

  slots: (): IntentSlot[] => [
    { label: '分析对象', value: '全站用户' },
    { label: '核心指标', value: '日均活跃用户数（DAU）、活跃率、人均观看时长' },
    { label: '时间维度', value: '近 30 天，与再往前 30 天对比' },
    {
      label: '要回答的',
      value: '没有匹配到专门的分析类型，这里只给一份全站概览',
    },
  ],

  plan: (): PlanStep[] => [
    {
      no: 1,
      title: '算全站核心指标，并和上一周期对比',
      detail: '没有识别出具体的问题类型，所以先给一份大盘概览。',
      tool: 'frontend',
    },
    {
      no: 2,
      title: '给出 DAU 的逐日趋势与 7 日移动平均',
      detail: '大盘数据里信息量最大的一条曲线，先看它。',
      tool: 'python',
    },
  ],

  tools: [
    {
      tool: 'sql',
      why:
        '本次没有匹配到需要专门取数的分析类型，所以不跑新的 SQL。' +
        '想看 SQL 的真实执行结果，可以直接问「为什么最近用户活跃度下降」。',
      mode: 'live',
    },
    {
      tool: 'python',
      why: '读离线跑好的全站活跃度结果（含移动平均与波动率）。',
      mode: 'offline',
    },
  ],

  charts: ['dauTrend'],

  /* 兜底意图不跑新查询——它只做概览 */
  queries: (): SqlQuerySpec[] => [],

  pyCaseIds: ['activity'],

  verdict: (d: AnalysisData): string => {
    const m = d.metrics.dau
    if (!Number.isFinite(m.current) || m.current <= 0) {
      return '当前没有取到可用的数据，给不出概览。'
    }
    const base = `近 ${d.days} 天全站日均活跃用户 ${formatCount(m.current)} 人`
    if (m.previous > 0 && m.deltaPct !== undefined) {
      return (
        `${base}，比上一个 ${d.days} 天的 ${formatCount(m.previous)} 人` +
        `${m.deltaPct >= 0 ? '上升' : '下降'} ${formatPercent(Math.abs(m.deltaPct))}。` +
        `这是全站概览，不是针对你那个问题的分析——可以点上面的示例问题看看已经实现了哪几类分析。`
      )
    }
    return `${base}。这是全站概览，不是针对你那个问题的分析。`
  },

  evidence: (d: AnalysisData): EvidenceItem[] => [
    {
      label: '日均活跃用户（DAU）',
      value: formatCount(d.metrics.dau.current),
      compare: d.metrics.dau.previous > 0 ? formatCount(d.metrics.dau.previous) : undefined,
      delta:
        d.metrics.dau.previous > 0 && d.metrics.dau.deltaPct !== undefined
          ? formatDelta(d.metrics.dau.deltaPct)
          : undefined,
      sample: `近 ${d.days} 天，数据截止 ${d.endDate}`,
    },
    {
      label: '活跃率',
      value: formatPercent(d.metrics.activeRate.current),
      sample: '活跃率 = 日均活跃人数 ÷ 平台用户总数',
    },
  ],

  insight: (): Insight[] => [
    {
      title: '这条问题没有被匹配到任何已实现的分析类型',
      fact:
        '系统把问题里的关键词和已有的分析类型逐一比对，没有一条达到最低分。' +
        '所以这里给的是一份全站概览，而不是对你那个问题的回答。',
      hypothesis:
        '常见原因有两个：一是问题里没有出现能被识别的关键词；' +
        '二是这个问题属于还没实现的分析类型（比如内容偏好、完播率、增长率）。',
      action:
        '可以点上面的示例问题试试已经实现了的那一类；如果问题确实属于还没实现的类型，' +
        '那它排在后续要做的清单里，现在不会硬凑一个答案。',
    },
  ],

  fallback: '当前没有取到可用的数据，给不出概览。',
}

/* ==========================================================================
   注册表
   ========================================================================== */

/**
 * ★ 这个数组就是「已经实现了哪几类问题」的唯一答案。
 *   页面、示例问题的标注、本机检查的断言，全部从这里取。
 */
export const INTENTS: Intent[] = [
  activityDecline,
  agePreference,
  categoryGrowth,
  completionRank,
  segmentDecline,
]

export const INTENT_BY_ID: Record<string, Intent> = Object.fromEntries(
  INTENTS.map((i) => [i.id, i]),
)

/** 匹配不上时的落点 */
export { genericIntent as fallbackIntent }
