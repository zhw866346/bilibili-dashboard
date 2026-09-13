/* ==========================================================================
   SQL 分析案例 —— 这一页的全部内容都在这个文件里
   --------------------------------------------------------------------------
   每一张卡片回答同样几个问题：

     1. 业务问题是什么      question
     2. 用到哪几张表的哪些列  fields
     3. 用了哪些 SQL 能力     abilities
     4. SQL 长什么样          sql
     5. 查询结果              （由页面执行 sql 得到，不在这里）
     6. 结果说明什么          explain（★ 根据真实查询结果生成的，不是写死的）
     7. 对业务意味着什么      meaning

   ★ 关于 explain 为什么是函数而不是一段固定文字：
     写死的解释文字，数据一变就对不上了（"播放量最高的是游戏"——
     换个时间窗口可能就不是游戏了）。所以这里全部改成
     「拿到查询结果以后，再从结果里读出结论」的函数。
     这样页面上写的每一句话，都能在它上面的结果表里找到出处。

   ★ 关于时间范围：
     所有 SQL 的 WHERE 里都带着当前窗口的起止日期，由 buildSqlCases(ctx) 注入。
     切换「近 7 天 / 近 14 天 / 近 30 天」时，SQL 文本和查询结果会一起变——
     这本身就是「筛选真的在驱动查询」的证明。

   ★ 关于用了哪些语法：
     基础部分：SELECT / WHERE / CASE WHEN / COUNT / COUNT DISTINCT / SUM / AVG /
     GROUP BY / HAVING / ORDER BY / LIMIT / JOIN。
     进阶部分：CTE（WITH ... AS）、窗口函数（ROW_NUMBER / LAG / SUM() OVER）。

   ★ 窗口函数只出现在它真的更合适的地方，不是拿来充数的：
       案例 01  LAG 算 DAU 环比        —— 自连接 date - 1 也能做，但难读得多
       案例 06  SUM() OVER 算年龄段占比 —— 原来用两个子查询 JOIN 手工模拟
                                          （30 行 → 15 行）
       案例 09  ROW_NUMBER 做组内 Top N —— 「每个年龄段内部排前 3」
                                          用 GROUP BY 根本表达不出来
     能用 GROUP BY 讲清楚的地方，一律还是用 GROUP BY，没有硬上窗口函数。
   ========================================================================== */

import type { Column } from '../../components/DataTable'
import { formatCount, formatDelta, formatMinutes, formatPercent } from '../../utils/format'

/* --------------------------------------------------------------------------
   一、场景分类
   -------------------------------------------------------------------------- */

/** 「全部」不是真的场景，是筛选器上的一个选项，所以单独列出来 */
export const ALL_SCENES = '全部' as const

export type SceneKey =
  | '用户活跃'
  | '用户分层'
  | '内容分析'
  | '用户×内容'
  | '互动分析'
  | '业务诊断'

/** 筛选器上的按钮顺序 */
export const SCENE_FILTERS: (SceneKey | typeof ALL_SCENES)[] = [
  ALL_SCENES,
  '用户活跃',
  '用户分层',
  '内容分析',
  '用户×内容',
  '互动分析',
  '业务诊断',
]

/* --------------------------------------------------------------------------
   二、SQL 能力清单
   --------------------------------------------------------------------------
   这 14 项就是页面上「SQL 能力覆盖」那张矩阵的全部行。
   每个案例的 abilities 里写的字符串，必须和这里的 ability 一字不差，
   页面靠它反查出「这项能力被哪几个案例用到了」。

   前 12 项是基础语法，最后 2 项（CTE / WINDOW FUNCTION）是进阶能力。
   矩阵里的行顺序 = 这里的顺序，所以进阶能力排在最后，一眼能看出是两层。
   -------------------------------------------------------------------------- */

export interface AbilityDef {
  /** 能力名（在矩阵第一列显示） */
  ability: string
  /** 这个能力在什么场景下用（矩阵第二列显示） */
  usage: string
}

export const SQL_ABILITIES: AbilityDef[] = [
  { ability: 'SELECT', usage: '所有分析：决定要取哪些列' },
  { ability: 'WHERE', usage: '按时间范围筛选观看记录' },
  { ability: 'CASE WHEN', usage: '把连续的年龄打成年龄段标签' },
  { ability: 'COUNT', usage: '统计播放量、互动次数' },
  { ability: 'COUNT DISTINCT', usage: '算 DAU、独立观看用户数' },
  { ability: 'SUM', usage: '累加观看时长、互动次数' },
  { ability: 'AVG', usage: '算单次观看时长' },
  { ability: 'GROUP BY', usage: '按用户、内容分组汇总' },
  { ability: 'HAVING', usage: '对分组结果再筛条件' },
  { ability: 'ORDER BY', usage: '排序排名' },
  { ability: 'LIMIT', usage: '取 TOP 内容' },
  { ability: 'JOIN', usage: '把用户和内容关联起来' },
  { ability: 'CTE', usage: 'WITH … AS：把多步查询拆成能读的中间结果' },
  {
    ability: 'WINDOW FUNCTION',
    usage: '窗口函数：组内排名（ROW_NUMBER）、环比（LAG）、组内占比（SUM … OVER）',
  },
]

/* --------------------------------------------------------------------------
   三、SQL 问题库
   --------------------------------------------------------------------------
   页面上「我用 SQL 解决过的问题」那两块。点一个问题，
   页面会滚动到对应的 SQL 卡片。所以每一条都必须指向一个真实存在的案例。
   -------------------------------------------------------------------------- */

export interface QuestionItem {
  /** 展示的问题文字 */
  q: string
  /** 点它跳到哪个案例 */
  caseId: string
}

export const QUESTION_BANK: { group: string; items: QuestionItem[] }[] = [
  {
    group: '用户问题',
    items: [
      { q: '平台每天有多少活跃用户？变化趋势如何？', caseId: 'dau' },
      { q: 'DAU 和前一天比涨了还是跌了？', caseId: 'dau' },
      { q: '哪个年龄段的用户规模最大？', caseId: 'age-users' },
      { q: '哪个年龄段的用户最活跃？', caseId: 'age-active-rate' },
    ],
  },
  {
    group: '内容问题',
    items: [
      { q: '哪些内容的播放量最高？', caseId: 'category-plays' },
      { q: '哪些内容用户看得最久？', caseId: 'category-depth' },
      { q: '哪些内容的互动率最高？', caseId: 'category-engage' },
    ],
  },
  {
    group: '用户 × 内容问题',
    items: [
      { q: '18–24 岁用户偏好什么内容？', caseId: 'age-category-prefer' },
      { q: '各年龄段分别最喜欢什么内容？前三名是谁？', caseId: 'age-top3' },
      { q: '哪些「人群 × 内容」组合既看得深又愿意互动？', caseId: 'high-value' },
    ],
  },
]

/* --------------------------------------------------------------------------
   四、案例本体的类型
   -------------------------------------------------------------------------- */

/** 查询结果的一行。列名就是 SQL 里的 AS 别名。 */
export type SqlCaseRow = Record<string, string | number | null>

export interface SqlCase {
  /** 锚点 id，问题库跳转用 */
  id: string
  /** 卡片编号，从 1 开始 */
  no: number
  title: string
  scene: SceneKey
  /** 业务问题 */
  question: string
  /** 用到哪几张表的哪些列 */
  fields: string[]
  /** 用了哪些 SQL 能力（必须和 SQL_ABILITIES 里的名字一致） */
  abilities: string[]
  /** SQL 原文 */
  sql: string
  /** 结果表怎么显示 */
  columns: Column[]
  /** 结果表的补充说明 */
  resultNote?: string
  /**
   * 「分析解释」——从真实查询结果里读出结论。
   * 传进来的 rows 是本次查询实际返回的行，可能为空（要处理）。
   */
  explain: (rows: SqlCaseRow[]) => string
  /** 「业务意义」——这个结论对业务意味着什么 */
  meaning: string
}

/** buildSqlCases 需要的当前窗口信息 */
export interface SqlCaseContext {
  /** 窗口起始日，例如 2026-08-12 */
  startDate: string
  /** 窗口结束日，例如 2026-09-10 */
  endDate: string
  /** 窗口天数，7 / 14 / 30 */
  days: number
  /**
   * 「消费深度」的门槛（分钟）。
   * 取全部 32 个「年龄段 × 分区」组合人均观看时长的中位数，
   * 由调用方从 getUserContentAnalytics(days).opportunity.xMedian 拿到后传进来。
   * ★ 刻意不写死：数据变了，门槛跟着变。
   */
  depthThresholdMinutes: number
}

/* --------------------------------------------------------------------------
   五、小工具
   -------------------------------------------------------------------------- */

/**
 * 生成 SQL 里的年龄段 CASE WHEN 表达式。
 *
 * ★ 为什么 SQL 里的年龄段标签必须和 JS 里的 AGE_GROUPS 完全一致？
 *   因为同一个数字要在两个地方出现：页面上的柱状图是 JS 算的，
 *   SQL 卡片是数据库算的。两边都写 '18-24' 才可能对得上，
 *   差一个字符（比如 '18~24'）就变成两个不同的分组了。
 *   这里集中写一次，四个案例共用。
 *
 * ★ 导出给 AI 助手页的 SQL 复用：那边也要按年龄段分组，
 *   自己再写一份 CASE WHEN 的话，改动一处漏一处就会让同一个年龄段
 *   在两个页面上算出两个数 —— 而这是【不会报错】的。
 */
export function ageCase(column: string): string {
  return [
    `CASE`,
    `            WHEN ${column} BETWEEN 18 AND 24 THEN '18-24'`,
    `            WHEN ${column} BETWEEN 25 AND 31 THEN '25-31'`,
    `            WHEN ${column} BETWEEN 32 AND 40 THEN '32-40'`,
    `            ELSE '40+'`,
    `        END`,
  ].join('\n')
}

/** 把日期包成 SQL 字面量 */
const d = (date: string) => `'${date}'`

/** 求一行里某个字段的数字 */
function num(row: SqlCaseRow | undefined, key: string): number {
  if (!row) return 0
  const v = Number(row[key])
  return Number.isFinite(v) ? v : 0
}

/** 按某个字段找最大值那一行。用于「哪个最高」这类结论。 */
function maxBy(rows: SqlCaseRow[], key: string): SqlCaseRow | undefined {
  let best: SqlCaseRow | undefined
  for (const r of rows) {
    if (!best || num(r, key) > num(best, key)) best = r
  }
  return best
}

/** 对某个字段求和 */
function sumBy(rows: SqlCaseRow[], key: string): number {
  let total = 0
  for (const r of rows) total += num(r, key)
  return total
}

/** 没有数据时的统一说辞。不要硬编一句结论糊弄过去。 */
const EMPTY = '当前时间窗口内这条查询没有返回结果。'

/* --------------------------------------------------------------------------
   六、九个案例
   -------------------------------------------------------------------------- */

export function buildSqlCases(ctx: SqlCaseContext): SqlCase[] {
  const { startDate, endDate, days, depthThresholdMinutes } = ctx

  /* 时间范围条件，每一条 SQL 都要用 */
  const inWindow = (col: string) => `${col} >= ${d(startDate)} AND ${col} <= ${d(endDate)}`

  /* 年龄段 CASE 表达式，重复出现的几处都用它，保证写法完全一致 */
  const ageCaseU = ageCase('u.age')
  const ageCaseBare = ageCase('age')

  return [
    /* =====================================================================
       SQL 01 —— 每日 DAU 趋势
       ===================================================================== */
    {
      id: 'dau',
      no: 1,
      title: '平台每日活跃用户数（DAU）与日环比',
      scene: '用户活跃',
      question: '平台每天的活跃用户规模是多少？和前一天比，是涨了还是跌了？',
      fields: ['video_views.user_id', 'video_views.date'],
      abilities: [
        'SELECT',
        'WHERE',
        'COUNT DISTINCT',
        'GROUP BY',
        'ORDER BY',
        'CTE',
        'WINDOW FUNCTION',
      ],
      sql: `-- 每天有多少人来过平台？和前一天的比，是涨了还是跌了？
--
-- ★ 要点一：COUNT(DISTINCT user_id) 而不是 COUNT(user_id)
--   一个人一天看了 10 个视频就有 10 行，COUNT 会把他数成 10 个人。
--
-- ★ 要点二：算环比用 LAG，不要自己 JOIN 自己
--   「前一天的值」用自连接也能做：
--       FROM daily d LEFT JOIN daily p ON p.date = date(d.date, '-1 day')
--   但要自己处理日期空档，还要 JOIN 一张和自己一模一样的表，读起来很绕。
--   LAG(dau) OVER (ORDER BY date) 的意思是：把结果按日期排好队，
--   然后往前看一行。一行就写清楚，而且中间缺了几天也不会错位。
--
-- ★ 为什么要包一层 CTE？
--   窗口函数是在 GROUP BY 之后才计算的，它没法引用一个正在聚合的别名。
--   所以先把「每天的 DAU」算好放进 daily，再在它上面开窗。
--   这样一条查询就分成「先算每天」和「再看变化」两步，各自都读得懂。
WITH daily AS (
    SELECT
        date,                          -- 日期
        COUNT(DISTINCT user_id) AS dau -- 当天活跃的用户数（去重）
    FROM video_views
    WHERE ${inWindow('date')}          -- 只看当前时间窗口内的记录
    GROUP BY date                      -- 按天分组：每一组 = 一天
)
SELECT
    date,
    dau,
    LAG(dau) OVER (ORDER BY date) AS prev_dau,         -- 前一天的 DAU（第一天没有前一天，返回 NULL）
    dau - LAG(dau) OVER (ORDER BY date) AS dau_change, -- 比前一天多了 / 少了多少人
    (dau - LAG(dau) OVER (ORDER BY date)) * 100.0
        / LAG(dau) OVER (ORDER BY date) AS change_pct  -- 环比幅度(%)：变化量 ÷ 前一天，同样是第一天为 NULL
FROM daily
ORDER BY date;                     -- 按日期从小到大排，这样才连得成趋势线`,
      columns: [
        { key: 'date', label: '日期' },
        { key: 'dau', label: '活跃用户数', align: 'right', bar: true, format: (v) => formatCount(Number(v)) },
        {
          key: 'prev_dau',
          label: '前一天',
          align: 'right',
          // 第一行没有前一天，SQL 返回 NULL，表格里已经显示成「—」，这里要原样放行
          format: (v) => (typeof v === 'number' ? formatCount(v) : String(v)),
        },
        {
          key: 'dau_change',
          label: '日环比变化',
          align: 'right',
          format: (v) => (typeof v === 'number' ? `${v > 0 ? '+' : ''}${formatCount(v)}` : String(v)),
        },
        {
          key: 'change_pct',
          label: '环比幅度',
          align: 'right',
          format: (v) => (typeof v === 'number' ? formatDelta(v, 2) : String(v)),
        },
      ],
      resultNote:
        `共 ${days} 天。前两列（日期、活跃用户数）按日期连起来，形状就和首页那张 DAU 趋势图一致——两处用的是同一批数据。` +
        '后两列是窗口函数 LAG 算出来的：第一天没有「前一天」，所以显示「—」。',
      explain: (rows) => {
        if (rows.length === 0) return EMPTY
        const top = maxBy(rows, 'dau')!
        const low = rows.reduce((a, b) => (num(a, 'dau') <= num(b, 'dau') ? a : b))
        const avg = sumBy(rows, 'dau') / rows.length

        /* 环比只看「有前一天」的那几行。
           判断依据是 prev_dau 的类型：第一行是 NULL（表格里已转成「—」字符串），
           其余行是从 SQLite 出来的数字。 */
        const comparable = rows.filter((r) => typeof r.prev_dau === 'number')
        const rise = comparable.filter((r) => num(r, 'dau_change') > 0).length
        const fall = comparable.filter((r) => num(r, 'dau_change') < 0).length
        const best = comparable.length > 0 ? maxBy(comparable, 'dau_change') : undefined
        const worst =
          comparable.length > 0
            ? comparable.reduce((a, b) => (num(a, 'dau_change') <= num(b, 'dau_change') ? a : b))
            : undefined

        return (
          `窗口内一共 ${rows.length} 天。活跃人数最高的是 ${top.date}，` +
          `${formatCount(num(top, 'dau'))} 人；最低的是 ${low.date}，${formatCount(num(low, 'dau'))} 人。` +
          `按天取平均是 ${formatCount(Math.round(avg))} 人——这就是首页 KPI 上那个「日均活跃用户」。` +
          (comparable.length === 0
            ? ''
            : `再看日环比：可比的 ${comparable.length} 天里，${rise} 天比前一天涨、${fall} 天比前一天跌。` +
              `涨得最猛的是 ${best!.date}，一天多出 ${formatCount(num(best!, 'dau_change'))} 人` +
              `（${formatDelta(num(best!, 'change_pct'), 2)}）；` +
              `跌得最狠的是 ${worst!.date}，一天少了 ${formatCount(Math.abs(num(worst!, 'dau_change')))} 人` +
              `（${formatDelta(num(worst!, 'change_pct'), 2)}）。` +
              `绝对值之外还要看幅度——同样多出 500 人，在 1 万人的基数和在 5 万人的基数上是两件事，` +
              `所以实际做判断时要配合 DAU 总量一起读。`)
        )
      },
      meaning:
        'DAU 是衡量平台健康度最基础的指标：它回答"有多少人今天真的打开了 App"。' +
        '单看一天的绝对值意义有限，重要的是趋势——如果一条线连着往下走，' +
        '就要去拆是拉新没跟上，还是老用户流失了，接下来会看分年龄段的活跃情况。',
    },

    /* =====================================================================
       SQL 02 —— 各年龄段用户规模
       ===================================================================== */
    {
      id: 'age-users',
      no: 2,
      title: '各年龄段的用户规模',
      scene: '用户分层',
      question: '平台的用户主要由哪些年龄段构成？哪一段人最多？',
      fields: ['users.age', 'users.user_id', 'users.register_date'],
      abilities: ['SELECT', 'WHERE', 'CASE WHEN', 'COUNT DISTINCT', 'GROUP BY', 'ORDER BY'],
      sql: `-- 把具体年龄打成四个标签，再看每段有多少人
--
-- 这条 SQL 里有两件事，很容易混在一起，分开看就清楚了：
--   CASE WHEN 负责【贴标签】——把 23 岁、19 岁都贴上 '18-24'
--   GROUP BY  负责【按这个标签分组】——把贴了同一个标签的人放到一堆
-- 没有 CASE WHEN，年龄就是 18~60 的一堆散点，没法比较；
-- 没有 GROUP BY，标签贴了也还是逐行显示，统计不出来。
SELECT
    ${ageCaseBare} AS age_group,         -- 第一步：先给每个人贴上年龄段标签
    COUNT(DISTINCT user_id) AS user_count -- 第二步：数一遍每组有多少人
FROM users
WHERE register_date <= ${d(endDate)}       -- 只看截止日之前注册的（存量口径）
GROUP BY
    ${ageCaseBare}                       -- 按"贴好的标签"分组
ORDER BY age_group;`,
      columns: [
        { key: 'age_group', label: '年龄段' },
        { key: 'user_count', label: '用户数', align: 'right', bar: true, format: (v) => formatCount(Number(v)) },
      ],
      resultNote:
        '这里的用户总量是「存量」：不管时间窗口切 7 天还是 30 天，同一批注册用户的归属都不会变，' +
        '所以四个数字在不同窗口下是同一个结果。它同时也是活跃率的分母。',
      explain: (rows) => {
        if (rows.length === 0) return EMPTY
        const total = sumBy(rows, 'user_count')
        const top = maxBy(rows, 'user_count')!
        const low = rows.reduce((a, b) => (num(a, 'user_count') <= num(b, 'user_count') ? a : b))
        return (
          `四个年龄段加起来一共 ${formatCount(total)} 名用户。` +
          `规模最大的是 ${top.age_group}，${formatCount(num(top, 'user_count'))} 人，` +
          `占全部的 ${formatPercent((num(top, 'user_count') / total) * 100)}；` +
          `最小的是 ${low.age_group}，${formatCount(num(low, 'user_count'))} 人。` +
          `最大的一段是最小那段的 ${(num(top, 'user_count') / Math.max(1, num(low, 'user_count'))).toFixed(1)} 倍。`
        )
      },
      meaning:
        '用户结构决定了内容供给的优先级。人数最多的年龄段是平台的基本盘，' +
        '他们的内容偏好应该优先被满足；但光看规模不够——人数多的年龄段未必活跃，' +
        '所以下一步要把它和"活跃率"放在一起看。',
    },

    /* =====================================================================
       SQL 03 —— 各年龄段活跃率
       ===================================================================== */
    {
      id: 'age-active-rate',
      no: 3,
      title: '各年龄段活跃率',
      scene: '用户分层',
      question: '哪个年龄段的人最常打开 App？人数多的那一段是不是也最活跃？',
      fields: ['users.age', 'users.user_id', 'users.register_date', 'video_views.user_id', 'video_views.date'],
      abilities: ['SELECT', 'WHERE', 'JOIN', 'CASE WHEN', 'COUNT DISTINCT', 'GROUP BY', 'ORDER BY'],
      sql: `-- 活跃率 = 这个年龄段每天活跃的人 ÷ 这个年龄段的总人数
--
-- ★ 这条 SQL 最容易出错的地方是【分母】。
--   分子和分母必须是同一批人：分子是 18-24 岁里活跃过的，
--   分母就必须是 18-24 岁的总人数。一旦用了全站人数当分母，
--   算出来的就不是"这个年龄段有多活跃"，而是"这个年龄段占全站多少"，完全是另一件事。
--
-- ★ 为什么用 LEFT JOIN 而不是 JOIN：
--   JOIN 会把"一次都没看过视频的人"直接丢掉，分母就变小了，活跃率会被算高。
--   用 LEFT JOIN 才能让所有注册用户都留在表里，没看过的人贡献 0。
--
-- ★ 活跃人天：COUNT(DISTINCT date || '#' || user_id)
--   把"日期"和"用户"拼成一个字符串再去重，得到的是"这个人这天来过"。
--   同一个人来 5 天算 5 个人天，一次没来算 0。
--   把它 ÷ 天数，就是日均活跃人数——和首页 DAU 是同一个东西。
SELECT
    ${ageCaseU} AS age_group,
    COUNT(DISTINCT u.user_id) AS total_users,                       -- 分母：该年龄段总人数
    COUNT(DISTINCT vv.date || '#' || vv.user_id) AS active_user_days, -- 分子：该年龄段活跃人天
    COUNT(DISTINCT vv.date || '#' || vv.user_id) * 1.0
        / (COUNT(DISTINCT u.user_id) * ${days}) * 100 AS active_rate  -- 活跃率(%) = 人天 ÷（人数 × 天数）
FROM users u
LEFT JOIN video_views vv
       ON vv.user_id = u.user_id
      AND ${inWindow('vv.date')}      -- 时间条件写在 ON 里，不能写在 WHERE 里
WHERE u.register_date <= ${d(endDate)} -- 只看截止日之前注册的用户
GROUP BY
    ${ageCaseU}
ORDER BY age_group;`,
      columns: [
        { key: 'age_group', label: '年龄段' },
        { key: 'total_users', label: '用户总数', align: 'right', format: (v) => formatCount(Number(v)) },
        { key: 'active_user_days', label: '活跃人天', align: 'right', format: (v) => formatCount(Number(v)) },
        { key: 'active_rate', label: '活跃率', align: 'right', bar: true, format: (v) => formatPercent(Number(v)) },
      ],
      resultNote:
        `活跃率 = 活跃人天 ÷（该年龄段用户数 × ${days} 天）。` +
        '把它反推回"日均活跃人数 ÷ 总人数"，和用户分析页各年龄段的活跃率是同一个数。',
      explain: (rows) => {
        if (rows.length === 0) return EMPTY
        const top = maxBy(rows, 'active_rate')!
        const low = rows.reduce((a, b) => (num(a, 'active_rate') <= num(b, 'active_rate') ? a : b))
        const topBySize = maxBy(rows, 'total_users')
        const same = topBySize !== undefined && top.age_group === topBySize.age_group
        return (
          `活跃率最高的是 ${top.age_group}，${formatPercent(num(top, 'active_rate'), 2)}；` +
          `最低的是 ${low.age_group}，${formatPercent(num(low, 'active_rate'), 2)}，` +
          `相差 ${(num(top, 'active_rate') - num(low, 'active_rate')).toFixed(2)} 个百分点。` +
          (same
            ? `人数最多的那一段（${top.age_group}）恰好也是活跃率最高的，` +
              `说明这一段既是基本盘、使用习惯也最稳。`
            : `注意：人数最多的 ${topBySize?.age_group ?? '—'} 并不是活跃率最高的，` +
              `活跃率最高的是 ${top.age_group}。规模大和用得勤，在这套数据里是两件事。`)
        )
      },
      meaning:
        '把规模和活跃率放在一起看，用户分层才有意义：' +
        '规模大又活跃的是核心人群，要稳稳接住；规模小但活跃率高的是高潜力人群，值得加大投入；' +
        '规模大但活跃率低的最危险——看着人多，实际留不住，需要单独查原因。',
    },

    /* =====================================================================
       SQL 04 —— 内容播放量排名
       ===================================================================== */
    {
      id: 'category-plays',
      no: 4,
      title: '各内容分区的播放量排名',
      scene: '内容分析',
      question: '平台上的流量都流向了哪些内容分区？哪个分区贡献的播放量最多？',
      fields: ['video_views.video_id', 'video_views.date', 'videos.video_id', 'videos.category'],
      abilities: ['SELECT', 'WHERE', 'JOIN', 'COUNT', 'GROUP BY', 'ORDER BY', 'LIMIT'],
      sql: `-- 哪个内容分区被看得最多？
--
-- 这里必须 JOIN：观看记录表里只有 video_id，没有 category。
-- 想知道"这条记录看的是哪个分区"，必须拿 video_id 去 videos 表里查。
-- 这就是 JOIN 存在的意义——把散在两张表里的信息拼到一起。
SELECT
    v.category,
    COUNT(*) AS view_count        -- 观看记录有多少条，播放量就是多少
FROM video_views vv
JOIN videos v
  ON v.video_id = vv.video_id     -- 用 video_id 把两张表接起来
WHERE ${inWindow('vv.date')}
GROUP BY v.category               -- 按内容分区分组
ORDER BY view_count DESC          -- 播放量从高到低
LIMIT 10;                         -- 只取前 10 名`,
      columns: [
        { key: 'category', label: '内容分区' },
        { key: 'view_count', label: '播放量', align: 'right', bar: true, format: (v) => formatCount(Number(v)) },
      ],
      resultNote: 'COUNT(*) 数的是"观看记录条数"，同一个人反复看同一个视频会重复计数——这是消费量，不是人数。',
      explain: (rows) => {
        if (rows.length === 0) return EMPTY
        const total = sumBy(rows, 'view_count')
        const top = maxBy(rows, 'view_count')!
        const low = rows.reduce((a, b) => (num(a, 'view_count') <= num(b, 'view_count') ? a : b))
        return (
          `共有 ${rows.length} 个分区产生了播放量，合计 ${formatCount(total)} 次。` +
          `排第一的是 ${top.category}，${formatCount(num(top, 'view_count'))} 次，占全部的 ` +
          `${formatPercent((num(top, 'view_count') / total) * 100)}；` +
          `最低的是 ${low.category}，${formatCount(num(low, 'view_count'))} 次（` +
          `${formatPercent((num(low, 'view_count') / total) * 100)}）。` +
          `第一名是最低那名的 ${(num(top, 'view_count') / Math.max(1, num(low, 'view_count'))).toFixed(2)} 倍。`
        )
      },
      meaning:
        '播放量排名回答的是"流量去了哪"，它是内容运营最基础的输入：' +
        '排在头部的分区一旦供给出问题，全站播放量会立刻受影响。' +
        '但播放量只说明"点了多少次"，不说明"看得认不认真"——' +
        '所以下一条要换个口径，看用户到底在哪个分区待得久。',
    },

    /* =====================================================================
       SQL 05 —— 内容消费深度（两个分母）
       ===================================================================== */
    {
      id: 'category-depth',
      no: 5,
      title: '各内容分区的消费深度',
      scene: '内容分析',
      question: '用户在每个分区上到底看了多久？哪个分区最"留得住人"？',
      fields: [
        'video_views.video_id',
        'video_views.date',
        'video_views.user_id',
        'video_views.watch_seconds',
        'videos.category',
      ],
      abilities: ['SELECT', 'WHERE', 'JOIN', 'SUM', 'AVG', 'COUNT DISTINCT', 'GROUP BY', 'ORDER BY'],
      sql: `-- "看得久"有两个完全不同的问法，这条 SQL 一次把它们都算出来
--
-- ★ 第一个：看过这个分区的人，平均一共看了多久？  （分母 = 独立观看用户）
--       SUM(watch_seconds) / COUNT(DISTINCT user_id)
--
-- ★ 第二个：平均点开一次看多久？                  （分母 = 播放次数）
--       AVG(watch_seconds)
--
-- 两个分母不一样，结论可以完全相反：
--   一个人连着看了 10 条短视频，人均时长会很高，但单次时长很低。
--   所以这两个数字必须分开放，混在一起就会得出错误结论。
SELECT
    v.category,
    SUM(vv.watch_seconds) / 60.0 AS total_watch_minutes,          -- 总观看时长（分钟）
    COUNT(DISTINCT vv.user_id)  AS unique_users,                  -- 独立观看用户数
    SUM(vv.watch_seconds) * 1.0
        / COUNT(DISTINCT vv.user_id) / 60 AS avg_watch_minutes,   -- 人均观看时长（分母=人数）
    AVG(vv.watch_seconds) / 60.0 AS avg_minutes_per_play          -- 单次观看时长（分母=次数）
FROM video_views vv
JOIN videos v
  ON v.video_id = vv.video_id
WHERE ${inWindow('vv.date')}
GROUP BY v.category
ORDER BY avg_watch_minutes DESC;`,
      columns: [
        { key: 'category', label: '内容分区' },
        { key: 'total_watch_minutes', label: '总观看时长', align: 'right', format: (v) => formatMinutes(Number(v), 0) },
        { key: 'unique_users', label: '独立观看用户', align: 'right', format: (v) => formatCount(Number(v)) },
        { key: 'avg_watch_minutes', label: '人均观看时长', align: 'right', bar: true, format: (v) => formatMinutes(Number(v)) },
        { key: 'avg_minutes_per_play', label: '单次观看时长', align: 'right', format: (v) => formatMinutes(Number(v)) },
      ],
      resultNote:
        '人均观看时长 = 总时长 ÷ 独立观看用户（看过的人一共看了多久，会随窗口拉长而变大）；' +
        '单次观看时长 = 总时长 ÷ 播放次数（平均点开一次看多久）。两个分母都在 SQL 里写明了。',
      explain: (rows) => {
        if (rows.length === 0) return EMPTY
        const deep = maxBy(rows, 'avg_watch_minutes')!
        const shallow = rows.reduce((a, b) =>
          num(a, 'avg_watch_minutes') <= num(b, 'avg_watch_minutes') ? a : b,
        )
        const longestPlay = maxBy(rows, 'avg_minutes_per_play')!
        return (
          `人均观看时长最长的是 ${deep.category}，看过的人平均一共看了 ` +
          `${formatMinutes(num(deep, 'avg_watch_minutes'))}；最短的是 ${shallow.category}，` +
          `${formatMinutes(num(shallow, 'avg_watch_minutes'))}，相差 ` +
          `${(num(deep, 'avg_watch_minutes') / Math.max(0.01, num(shallow, 'avg_watch_minutes'))).toFixed(1)} 倍。` +
          `换一个口径看就不一样了：单次观看时长最长的是 ${longestPlay.category}` +
          `（每次 ${formatMinutes(num(longestPlay, 'avg_minutes_per_play'))}）。` +
          `两个排名不一致，恰好说明"看得多"和"每次看得久"是两件事。`
        )
      },
      meaning:
        '播放量高不等于内容留得住人。人均观看时长反映的是"用户愿意在这个分区投入多少时间"，' +
        '它是比播放量更接近内容质量的信号。' +
        '如果某分区播放量排名靠前、但人均时长排名靠后，说明用户是刷过去的、不是看进去的，' +
        '这类内容适合做入口拉活跃，不适合承担深度消费。',
    },

    /* =====================================================================
       SQL 06 —— 用户 × 内容偏好
       ===================================================================== */
    {
      id: 'age-category-prefer',
      no: 6,
      title: '各年龄段的内容偏好占比',
      scene: '用户×内容',
      question: '18–24 岁的用户到底爱看什么？和 40 岁以上的人比，口味差在哪？',
      fields: [
        'users.age',
        'users.user_id',
        'video_views.user_id',
        'video_views.date',
        'video_views.video_id',
        'videos.category',
      ],
      abilities: [
        'SELECT',
        'WHERE',
        'JOIN',
        'CASE WHEN',
        'COUNT',
        'SUM',
        'GROUP BY',
        'ORDER BY',
        'CTE',
        'WINDOW FUNCTION',
      ],
      sql: `-- 各年龄段把多少观看量花在了每个分区上
--
-- ★ 这条 SQL 里有一个很容易踩的坑：不能用绝对播放量判断"偏好"。
--   18-24 岁有 1913 人、40 岁以上只有 860 人。就算两拨人口味完全一样，
--   18-24 岁在每个分区上的播放量都会是 40 岁以上的两倍多——那是"人多"，不是"偏爱"。
--   所以必须换算成【年龄段内部的占比】：把一个人群自己的 8 个分区拉成 100%，
--   再看它把最多的那一份花在了哪。
--
-- ★ 分母从哪来？用 SUM() OVER (PARTITION BY age_group)
--   占比 = 这个组合的观看次数 ÷ 该年龄段的总观看次数。
--   每个位置上的分母，是「和它同年龄段的所有行」加起来的结果，
--   而不是这一行自己的值——这恰好就是窗口函数要解决的问题。
--
--   SUM(view_count) OVER (PARTITION BY age_group) 读作：
--     按年龄段把行分成几组（PARTITION BY），在每组内部求和（SUM），
--     但求完不合并行（OVER）——把结果原样贴回每一行上。
--
--   ★ 这条查询原来不是这么写的。第一版拆成两个分组查询再 JOIN：
--     子查询 g 算「年龄段 × 分区」的次数，子查询 t 算年龄段的总次数，
--     两者相除得到占比。结果完全正确，但同一张表扫了两遍，30 行才说得清。
--     换成窗口函数之后 15 行就够，而且「分母来自同一组」这层意思
--     在代码里是直接写出来的，读者不用自己去两个子查询之间对。
WITH age_category AS (
    -- 第一步：先老老实实按「年龄段 × 分区」分组，数出每组的观看次数
    SELECT
        ${ageCaseU} AS age_group,
        v.category,
        COUNT(*) AS view_count
    FROM users u
    JOIN video_views vv ON vv.user_id = u.user_id
    JOIN videos v       ON v.video_id = vv.video_id
    WHERE ${inWindow('vv.date')}
    GROUP BY ${ageCaseU}, v.category
)
SELECT
    age_group,
    category,
    view_count,
    SUM(view_count) OVER (PARTITION BY age_group) AS age_total,      -- 该年龄段的总观看次数（分母）
    view_count * 100.0
        / SUM(view_count) OVER (PARTITION BY age_group) AS share_pct -- 占比(%) = 组内次数 ÷ 年龄段总数
FROM age_category
ORDER BY age_group, share_pct DESC;`,
      columns: [
        { key: 'age_group', label: '年龄段' },
        { key: 'category', label: '内容分区' },
        { key: 'view_count', label: '观看次数', align: 'right', format: (v) => formatCount(Number(v)) },
        { key: 'age_total', label: '年龄段小计', align: 'right', format: (v) => formatCount(Number(v)) },
        { key: 'share_pct', label: '年龄段内占比', align: 'right', bar: true, format: (v) => formatPercent(Number(v)) },
      ],
      resultNote:
        '每个年龄段的 8 行加起来正好 100%。所以这张表只能"行内比较"，' +
        '不要拿 18-24 岁的 12% 和 40 岁以上的 12% 直接比绝对量——它们的分母不同。' +
        '「年龄段小计」这一列就是窗口函数 SUM() OVER (PARTITION BY age_group) 算出来的分母，' +
        '它不是一个外部传进来的常数，而是从同一批数据里现算的。',
      explain: (rows) => {
        if (rows.length === 0) return EMPTY
        const top = maxBy(rows, 'share_pct')!
        // 每个年龄段自己排第一的分区
        const byAge = new Map<string, SqlCaseRow[]>()
        for (const r of rows) {
          const key = String(r.age_group)
          if (!byAge.has(key)) byAge.set(key, [])
          byAge.get(key)!.push(r)
        }
        const leaders = [...byAge.entries()].map(([age, list]) => {
          const best = maxBy(list, 'share_pct')!
          return `${age} 是 ${best.category}（${formatPercent(num(best, 'share_pct'))}）`
        })
        return (
          `全部 ${rows.length} 个「年龄段 × 分区」组合里，占比最高的一格是 ` +
          `${top.age_group} × ${top.category}：这个年龄段每 100 次观看里有 ` +
          `${num(top, 'share_pct').toFixed(1)} 次花在了这个分区上。` +
          `各年龄段自己排第一的分区是：${leaders.join('；')}。` +
          (new Set([...byAge.values()].map((l) => String(maxBy(l, 'share_pct')!.category))).size === 1
            ? '四个年龄段的第一名是同一个分区，说明这个分区是全民通吃的内容。'
            : '各年龄段的第一名并不完全一致，说明内容偏好确实存在人群差异。')
        )
      },
      meaning:
        '把「人」和「内容」交叉起来，才能回答"推荐该推什么"。' +
        '行内占比这个口径的价值在于：它把"人多"这个干扰因素除掉了，' +
        '剩下的纯粹是口味。给某个年龄段做推荐时，应该优先推它占比最高的分区，' +
        '而不是推全站播放量最高的分区——后者可能只是因为这个人群本身人少。',
    },

    /* =====================================================================
       SQL 07 —— 内容互动率
       ===================================================================== */
    {
      id: 'category-engage',
      no: 7,
      title: '各内容分区的互动率',
      scene: '互动分析',
      question: '看了之后有多少人愿意动手点赞、收藏、评论、分享？哪个分区最容易让人有反应？',
      fields: [
        'video_views.video_id',
        'video_views.date',
        'video_views.is_like',
        'video_views.is_favorite',
        'video_views.is_comment',
        'video_views.is_share',
        'videos.category',
      ],
      abilities: ['SELECT', 'WHERE', 'JOIN', 'COUNT', 'SUM', 'GROUP BY', 'ORDER BY'],
      sql: `-- 互动率 = 互动行为次数 ÷ 播放次数
--
-- ★ 分母必须统一：四种互动率的分母全部是【播放次数 COUNT(*)】。
--   如果点赞率用播放次数、收藏率用独立用户数，两个数字就没法放在一起比了，
--   而且很容易算出超过 100% 的怪数（一个人可以点 1 次赞，但他看了 3 次）。
--
-- ★ 分子是【行为次数】不是【人数】：
--   一个人看了 3 次、点了 1 次赞，他贡献 1 次点赞，但贡献了 3 次播放机会。
--   这就是互动率天然偏低的原因，读的时候要记住这一点。
SELECT
    v.category,
    COUNT(*) AS plays,                 -- 分母：播放次数
    SUM(vv.is_like)     AS likes,      -- 分子之一：点赞次数
    SUM(vv.is_favorite) AS favorites,  -- 收藏
    SUM(vv.is_comment)  AS comments,   -- 评论
    SUM(vv.is_share)    AS shares,     -- 分享
    SUM(vv.is_like)     * 100.0 / COUNT(*) AS like_rate,      -- 点赞率(%)
    SUM(vv.is_favorite) * 100.0 / COUNT(*) AS favorite_rate,  -- 收藏率(%)
    SUM(vv.is_comment)  * 100.0 / COUNT(*) AS comment_rate,   -- 评论率(%)
    SUM(vv.is_share)    * 100.0 / COUNT(*) AS share_rate,     -- 分享率(%)
    (SUM(vv.is_like) + SUM(vv.is_favorite)
     + SUM(vv.is_comment) + SUM(vv.is_share))
        * 100.0 / COUNT(*) AS engage_rate                     -- 综合互动率(%)
FROM video_views vv
JOIN videos v
  ON v.video_id = vv.video_id
WHERE ${inWindow('vv.date')}
GROUP BY v.category
ORDER BY engage_rate DESC;`,
      columns: [
        { key: 'category', label: '内容分区' },
        { key: 'plays', label: '播放量', align: 'right', format: (v) => formatCount(Number(v)) },
        { key: 'like_rate', label: '点赞率', align: 'right', format: (v) => formatPercent(Number(v), 2) },
        { key: 'favorite_rate', label: '收藏率', align: 'right', format: (v) => formatPercent(Number(v), 2) },
        { key: 'comment_rate', label: '评论率', align: 'right', format: (v) => formatPercent(Number(v), 2) },
        { key: 'share_rate', label: '分享率', align: 'right', format: (v) => formatPercent(Number(v), 2) },
        { key: 'engage_rate', label: '综合互动率', align: 'right', bar: true, format: (v) => formatPercent(Number(v), 2) },
      ],
      resultNote:
        '综合互动率 = （点赞 + 收藏 + 评论 + 分享）÷ 播放次数，所以它正好等于上面四项相加。' +
        '四项的分母都是播放次数，口径统一，不会超过 100%。',
      explain: (rows) => {
        if (rows.length === 0) return EMPTY
        const top = maxBy(rows, 'engage_rate')!
        const low = rows.reduce((a, b) => (num(a, 'engage_rate') <= num(b, 'engage_rate') ? a : b))
        // 找出拉高冠军的主要是哪个行为：看它四项里领先别人最多的那一项
        const avgOf = (key: string) => sumBy(rows, key) / rows.length
        const gaps = [
          { name: '点赞', gap: num(top, 'like_rate') - avgOf('like_rate') },
          { name: '收藏', gap: num(top, 'favorite_rate') - avgOf('favorite_rate') },
          { name: '评论', gap: num(top, 'comment_rate') - avgOf('comment_rate') },
          { name: '分享', gap: num(top, 'share_rate') - avgOf('share_rate') },
        ].sort((a, b) => b.gap - a.gap)
        return (
          `综合互动率最高的是 ${top.category}，${formatPercent(num(top, 'engage_rate'), 2)}；` +
          `最低的是 ${low.category}，${formatPercent(num(low, 'engage_rate'), 2)}，` +
          `相差 ${(num(top, 'engage_rate') - num(low, 'engage_rate')).toFixed(2)} 个百分点。` +
          `${top.category} 的互动主要靠${gaps[0].name}拉起来：` +
          `它的${gaps[0].name}率比八个分区的平均值高 ${gaps[0].gap.toFixed(2)} 个百分点。` +
          `完整看，它的点赞率 ${formatPercent(num(top, 'like_rate'), 2)}、` +
          `收藏率 ${formatPercent(num(top, 'favorite_rate'), 2)}、` +
          `评论率 ${formatPercent(num(top, 'comment_rate'), 2)}。`
        )
      },
      meaning:
        '互动率和播放量衡量的是完全不同的东西：播放量是"来没来"，互动率是"看完之后愿不愿意为它多做一个动作"。' +
        '互动率高的内容，用户和它之间建立了更深的连接，这种内容在推荐系统里的权重通常也更高。' +
        '注意区分互动行为的性质：点赞是即时反应（内容当场打动人），' +
        '收藏是延迟价值（用户觉得以后还要看），评论是表达欲，分享是社交货币——' +
        '不同的互动行为，对应完全不同的内容运营策略。',
    },

    /* =====================================================================
       SQL 08 —— 高价值「人群 × 内容」组合
       ===================================================================== */
    {
      id: 'high-value',
      no: 8,
      title: '高价值「年龄段 × 内容」组合筛选',
      scene: '业务诊断',
      question: '哪些「人群 × 内容」组合看得又深、互动又高？如果把资源集中投下去，该先投哪些？',
      fields: [
        'users.age',
        'users.user_id',
        'video_views.user_id',
        'video_views.date',
        'video_views.watch_seconds',
        'video_views.is_like',
        'video_views.is_favorite',
        'video_views.is_comment',
        'video_views.is_share',
        'videos.category',
      ],
      abilities: [
        'SELECT',
        'WHERE',
        'JOIN',
        'CASE WHEN',
        'COUNT DISTINCT',
        'SUM',
        'AVG',
        'GROUP BY',
        'HAVING',
        'ORDER BY',
      ],
      sql: `-- 把 32 个「年龄段 × 分区」组合，筛出消费深度在中位数以上的那些
--
-- ★ 什么是 HAVING？和 WHERE 有什么区别？
--   WHERE 是【分组之前】筛单条记录，比如"只看这段时间的观看"；
--   HAVING 是【分组之后】筛整组结果，比如"只看人均时长够长的组合"。
--   聚合函数（SUM / COUNT）算出来的结果，只能用 HAVING 筛，不能用 WHERE。
--
-- ★ 门槛取的是【全部 32 个组合人均观看时长的中位数】（本窗口 = ${depthThresholdMinutes.toFixed(2)} 分钟），
--   不是拍脑袋定的 5 分钟或 10 分钟。中位数的含义是"有一半组合在它之上"，
--   所以这样筛出来的正好是深度靠前的那一半，数据变了它会跟着变。
SELECT
    ${ageCaseU} AS age_group,
    v.category,
    COUNT(DISTINCT vv.user_id) AS viewers,               -- 触达了多少人
    SUM(vv.watch_seconds) * 1.0
        / COUNT(DISTINCT vv.user_id) / 60 AS avg_watch_minutes,  -- 人均看了多久
    (SUM(vv.is_like) + SUM(vv.is_favorite)
     + SUM(vv.is_comment) + SUM(vv.is_share))
        * 100.0 / COUNT(*) AS engage_rate                 -- 综合互动率(%)
FROM users u
JOIN video_views vv ON vv.user_id = u.user_id
JOIN videos v       ON v.video_id = vv.video_id
WHERE ${inWindow('vv.date')}
GROUP BY ${ageCaseU}, v.category
HAVING SUM(vv.watch_seconds) * 1.0 / COUNT(DISTINCT vv.user_id) / 60
       >= ${depthThresholdMinutes.toFixed(6)}            -- 门槛 = 中位数，分组之后才筛
ORDER BY avg_watch_minutes DESC;`,
      columns: [
        { key: 'age_group', label: '年龄段' },
        { key: 'category', label: '内容分区' },
        { key: 'viewers', label: '独立观看用户', align: 'right', format: (v) => formatCount(Number(v)) },
        { key: 'avg_watch_minutes', label: '人均观看时长', align: 'right', bar: true, format: (v) => formatMinutes(Number(v)) },
        { key: 'engage_rate', label: '综合互动率', align: 'right', format: (v) => formatPercent(Number(v), 2) },
      ],
      resultNote:
        '门槛是中位数（相对划分），所以结果里有一半左右的组合被留下——' +
        '它说明的是"相对其他组合算深的"，不代表绝对值上真的很高。换时间窗口时门槛会跟着变。',
      explain: (rows) => {
        if (rows.length === 0) return EMPTY
        const top = maxBy(rows, 'avg_watch_minutes')!
        const hottest = maxBy(rows, 'engage_rate')!
        const withInteraction = rows.filter((r) => num(r, 'engage_rate') > 0).length
        return (
          `有 ${rows.length} 个组合的人均观看时长超过了中位数门槛（${depthThresholdMinutes.toFixed(2)} 分钟）。` +
          `其中看得最深的是 ${top.age_group} × ${top.category}，人均 ${formatMinutes(num(top, 'avg_watch_minutes'))}，` +
          `触达 ${formatCount(num(top, 'viewers'))} 人；` +
          `互动最活跃的是 ${hottest.age_group} × ${hottest.category}，综合互动率 ` +
          `${formatPercent(num(hottest, 'engage_rate'), 2)}。` +
          `这批组合里 ${withInteraction} 个产生了互动行为。`
        )
      },
      meaning:
        '这条 SQL 是前面七条的收口：它同时用了人群维度（年龄段）、内容维度（分区）、' +
        '深度指标和互动指标，把"投谁、投什么"变成一个可以排序的清单。' +
        '用中位数而不是拍脑袋的阈值，是为了让这份清单随数据自动调整——' +
        '如果哪天整体消费深度都上来了，门槛应该跟着上移，而不是永远用同一个数。' +
        '实际业务里，这份清单可以直接对接排期和推荐位分配。',
    },

    /* =====================================================================
       SQL 09 —— 各年龄段最受欢迎的内容 TOP 3
       ===================================================================== */
    {
      id: 'age-top3',
      no: 9,
      title: '各年龄段最受欢迎的内容 TOP 3',
      scene: '用户×内容',
      question: '不同年龄段的用户分别最喜欢什么内容？每个年龄段的前三名是谁，第一名领先多少？',
      fields: [
        'users.age',
        'users.user_id',
        'video_views.user_id',
        'video_views.date',
        'video_views.video_id',
        'videos.category',
      ],
      abilities: [
        'SELECT',
        'WHERE',
        'JOIN',
        'CASE WHEN',
        'COUNT',
        'SUM',
        'GROUP BY',
        'ORDER BY',
        'CTE',
        'WINDOW FUNCTION',
      ],
      sql: `-- 每个年龄段自己排前三的内容分区
--
-- ★ 为什么这里非用窗口函数不可？
--   「每个年龄段内部排前 3」是典型的【组内 Top N】。
--   光靠 GROUP BY 做不到：它能把 8 个分区压成 8 行，
--   但表达不出「按年龄段分组、每组只留下前 3 行」这个要求。
--   不用窗口函数的话，只能给每个年龄段各写一条查询，再把四段结果拼起来。
--
-- ★ 为什么拆成两个步骤，不能写成一个？
--   因为窗口函数是在 WHERE 之后才计算的。
--   不能写 WHERE ROW_NUMBER() OVER (...) <= 3 —— 执行到 WHERE 的时候，
--   名次根本还没算出来。
--   所以必须先把名次算好、放进一个中间结果，再在外层用 WHERE 筛。
--   这和案例 08「聚合结果要用 HAVING 不能用 WHERE」是同一个道理：
--   都是「这一步才算出来的东西，没法在同一步里被筛」。
--
-- ★ 顺带把占比的分母也算出来
--   SUM(view_count) OVER (PARTITION BY age_group) 给出该年龄段的总观看次数。
--   注意分母是【同一年龄段】的总量，不是全站总量——
--   18-24 岁人最多，用全站总量当分母，比出来的是"哪个年龄段人多"，不是"口味"。
WITH age_category AS (
    -- 第一步：先按「年龄段 × 分区」分组，数出这个组合看了多少次
    SELECT
        ${ageCaseU} AS age_group,
        v.category,
        COUNT(*) AS view_count
    FROM users u
    JOIN video_views vv ON vv.user_id = u.user_id
    JOIN videos v       ON v.video_id = vv.video_id
    WHERE ${inWindow('vv.date')}
    GROUP BY ${ageCaseU}, v.category
),
ranked AS (
    -- 第二步：在每个年龄段内部给 8 个分区排名，同时把年龄段总分母算出来
    SELECT
        age_group,
        category,
        view_count,
        SUM(view_count) OVER (PARTITION BY age_group) AS age_total,
        ROW_NUMBER() OVER (
            PARTITION BY age_group       -- 在每个年龄段内部
            ORDER BY view_count DESC     -- 按观看次数从高到低
        ) AS rank_in_age                 -- 名次：1、2、3 …
    FROM age_category
)
-- 第三步：只留下每个年龄段的前三名
SELECT
    age_group,
    rank_in_age,
    category,
    view_count,
    age_total,
    view_count * 100.0 / age_total AS share_pct
FROM ranked
WHERE rank_in_age <= 3
ORDER BY age_group, rank_in_age;`,
      columns: [
        { key: 'age_group', label: '年龄段' },
        { key: 'rank_in_age', label: '年龄段内排名', align: 'right' },
        { key: 'category', label: '内容分区' },
        {
          key: 'view_count',
          label: '播放量',
          align: 'right',
          bar: true,
          format: (v) => formatCount(Number(v)),
        },
        { key: 'age_total', label: '年龄段小计', align: 'right', format: (v) => formatCount(Number(v)) },
        { key: 'share_pct', label: '年龄段内占比', align: 'right', format: (v) => formatPercent(Number(v)) },
      ],
      resultNote:
        '4 个年龄段 × 前 3 名 = 12 行。「年龄段内占比」= 该分区播放量 ÷ 该年龄段小计，' +
        '分母由 SUM() OVER (PARTITION BY age_group) 现算。所以同一段的三行加起来，' +
        '是前三名合计的份额，不是 100%（全量 8 个分区的占比在案例 06）。' +
        '这里的排序口径与「用户 × 内容」页的 TOP3 卡片一致：都在年龄段内部按播放量排，' +
        '因为同一段的分母相同，等价于按偏好占比排，两处数字对得上。',
      explain: (rows) => {
        if (rows.length === 0) return EMPTY

        // 把 12 行按年龄段分成 4 组，每组按名次排好
        const byAge = new Map<string, SqlCaseRow[]>()
        for (const r of rows) {
          const key = String(r.age_group)
          if (!byAge.has(key)) byAge.set(key, [])
          byAge.get(key)!.push(r)
        }
        const groups = [...byAge.entries()].map(([age, list]) => ({
          age,
          list: [...list].sort((a, b) => num(a, 'rank_in_age') - num(b, 'rank_in_age')),
        }))

        // 每个年龄段的第一名，以及它比第二名领先多少
        const lines = groups.map(({ age, list }) => {
          const first = list[0]
          const second: SqlCaseRow | undefined = list[1]
          const lead =
            second === undefined
              ? ''
              : `，比第二名（${second.category}）多 ${formatCount(
                  num(first, 'view_count') - num(second, 'view_count'),
                )} 次`
          return (
            `${age} 是 ${first.category}（${formatCount(num(first, 'view_count'))} 次，` +
            `占该年龄段 ${formatPercent(num(first, 'share_pct'))}${lead}）`
          )
        })

        // 四个年龄段的第一名是不是同一个分区？这决定了结论该怎么说
        const champions = groups.map((g) => String(g.list[0].category))
        const distinct = [...new Set(champions)]

        return (
          `一共 ${rows.length} 行，就是 ${groups.length} 个年龄段各自的前三名。` +
          `各年龄段排第一的分区：${lines.join('；')}。` +
          (distinct.length === 1
            ? `四个年龄段的第一名都是${distinct[0]}，说明这个分区是全民通吃的内容，` +
              `任何人群的推荐都可以把它放进默认池；人群差异体现在前三名里的另外两个位置上。`
            : `四个年龄段的第一名并不相同（分别是 ${distinct.join('、')}），` +
              `说明内容偏好确实存在人群差异，推荐策略不能只用一个统一的内容池。`)
        )
      },
      meaning:
        '这张表是最能直接落到推荐位上的一张：每一行都对应一个「给谁推什么」的动作，' +
        '而且带了明确的名次。' +
        '它和案例 06 的区别在于视角：案例 06 给的是全量 32 个组合的占比，回答"这个人群的口味分布长什么样"；' +
        '这一条只留前三名，回答"真要动手的话，先动哪几个"。' +
        '实际用的时候要连着读两件事：一是第一名对第二名的领先幅度——' +
        '领先得多说明这个人群偏好集中，可以放心把推荐位给它；领先得少说明口味分散，单一分区吃不下这个人群。' +
        '二是前三名合计的份额——如果加起来还不到一半，说明兴趣很发散，' +
        '宁可多给几个分区小流量试探，也不要死磕一个。',
    },
  ]
}

/* --------------------------------------------------------------------------
   七、给页面用的派生统计
   --------------------------------------------------------------------------
   ★ 页面上那几个「9 个案例」「14 项能力」的数字，全部从这里算出来，
     不写死。这样以后加一条案例，卡片上的数字会自动跟着变。
   -------------------------------------------------------------------------- */

export interface SqlStats {
  /** SQL 案例数量 */
  caseCount: number
  /** 数据表数量 */
  tableCount: number
  /** 数值型指标列数（按列名去重） */
  metricCount: number
  /** 用到的 SQL 能力数量 */
  abilityCount: number
  /** 业务问题数量（问题库里的条目数） */
  questionCount: number
  /** 每个能力被哪几个案例用到，键是能力名 */
  abilityUsage: Map<string, SqlCase[]>
}

export function computeSqlStats(cases: SqlCase[], tableCount: number): SqlStats {
  // 指标列：把每条案例结果表里右对齐（数值）的列名收集起来去重
  const metricLabels = new Set<string>()
  for (const c of cases) {
    for (const col of c.columns) {
      if (col.align === 'right') metricLabels.add(col.label)
    }
  }

  // 每项能力被哪些案例用到
  const abilityUsage = new Map<string, SqlCase[]>()
  for (const def of SQL_ABILITIES) abilityUsage.set(def.ability, [])
  for (const c of cases) {
    for (const a of c.abilities) {
      abilityUsage.get(a)?.push(c)
    }
  }

  const usedAbilities = [...abilityUsage.values()].filter((list) => list.length > 0).length

  return {
    caseCount: cases.length,
    tableCount,
    metricCount: metricLabels.size,
    abilityCount: usedAbilities,
    questionCount: QUESTION_BANK.reduce((n, g) => n + g.items.length, 0),
    abilityUsage,
  }
}
