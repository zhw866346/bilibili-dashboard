/* ==========================================================================
   AI 分析助手专用的 SQL
   --------------------------------------------------------------------------
   ★ 先说清楚这里【不】放什么：
     SQL 分析页那 9 条案例的 SQL，这里一条都不重抄。
     需要哪一条就通过 buildSqlCases(ctx) 取回来（见 intents.ts）——
     抄一份就意味着以后改了口径要改两个地方，迟早会对不上。
     页面因此还能写一句很有分量的话：
     「这条 SQL 和 SQL 分析页的案例 01 是同一条，结果表可以逐行对照。」

   ★ 这里只放 SQL 页没有、而 AI 助手需要的查询。

   ★ 两条书写规矩，和 SQL 分析页保持一致：
     1. 不写 ROUND。返回原始精度，由前端格式化。
        否则 ROUND 和 toFixed 在 x.x5 的边界上会差 0.1，看起来像 bug。
     2. 日期一律用字面量拼进去（窗口切换时 SQL 文本跟着变），
        这就是「筛选真的在驱动查询」的证据。
   ========================================================================== */

import { formatCount, formatDelta, formatPercent } from '../../utils/format'
import { COMPLETION_THRESHOLD } from '../metrics'
/* ★ 年龄段的 CASE WHEN 从 SQL 分析页那边 import，不在这里重写一份。
   两个页面各写一份的话，改口径时漏掉一处就会出现「同一个年龄段在
   两个页面上算出两个数」—— 而且不报错。 */
import { ageCase } from '../sql/cases'
import type { CrossCheck, QueryContext, SqlQuerySpec } from './types'

const d = (date: string) => `'${date}'`

/** 查询没返回结果时的统一说辞。不要硬编一句结论糊弄过去。 */
export const EMPTY_ROWS = '这条查询在当前时间窗口里没有返回结果。'

function num(value: unknown): number {
  const n = Number(value)
  return Number.isFinite(n) ? n : 0
}

function findRow(rows: Record<string, string | number | null>[], field: string, want: string) {
  return rows.find((r) => String(r[field]) === want)
}

/* --------------------------------------------------------------------------
   窗口前半段 vs 后半段（按内容分区）
   -------------------------------------------------------------------------- */

/**
 * 本查询的 id。
 *
 * ★ 导出给图表和意图共用 —— 两边各写一遍字符串，改一处漏一处的结果是
 *   图表读不到结果、静静地什么都不画（ChartBoard 找不到 outcome 就返回 null，
 *   不报错、不抛异常）。本机有一条检查守着「意图引用的 id 都真的有结果」。
 */
export const CATEGORY_TREND_QUERY_ID = 'ai:category-half'

/**
 * 把窗口从【中间】对半切开，比较 8 个内容分区「前半段 vs 后半段」的日均播放量。
 *
 * ★ 这不是「本周 vs 上周」。它比的是同一个窗口自己内部的前后两半，
 *   两段都属于当前窗口。这一点必须写进页面文案，否则读者会当成环比。
 *
 * ★ 为什么比【日均】而不是总量：两段天数可能不等（近 7 天切出来是 3 天 vs 4 天），
 *   拿 3 天的总量去比 4 天的，短的那段天然吃亏，排名就不可信了。
 *
 * ★ 切分点从数据里现数（COUNT(*) OVER ()），不是写死 days/2：
 *   窗口里万一缺了某一天，写死的那个数就会和 Pandas 那边错开一天，
 *   而错开一天是【不会报错】的 —— 只会让所有数字都差一点，看起来还挺合理。
 *   analyze.py 的 build_category_trend() 用的是同一套数法（数实际存在的日期），
 *   所以两边对得上；对不上的话下面的交叉验证会当场红。
 *
 * ★ 前半段是 0 时增长率是 NULL（不是 0，也不是无穷大）——
 *   和项目里「上一周期为 0 就不显示环比」是同一条规矩：
 *   算不出来就说算不出来，不要拿一个看着像结论的数糊过去。
 *   ORDER BY 时 NULL 在 SQLite 里最小，DESC 排在最后，和 Pandas 的排法一致。
 */
export function categoryHalfQuery(ctx: QueryContext): SqlQuerySpec {
  const { startDate, endDate } = ctx

  const sql = `-- 把窗口从中间对半切开，逐个内容分区比较「前半段 vs 后半段」。
-- 比的是【日均】播放量：两段天数可能不等（近 7 天切出来是 3 天 vs 4 天），
-- 拿短那段的总量去比长那段的，短的那段天然吃亏。
WITH win AS (
    SELECT DISTINCT date
    FROM video_views
    WHERE date >= ${d(startDate)} AND date <= ${d(endDate)}
),
half AS (
    -- 窗口里一共有几天、这一天排第几，都从数据里现数，不写死。
    -- 前一半归 1（前半段）、后一半归 2（后半段）。
    SELECT
        date,
        CASE WHEN ROW_NUMBER() OVER (ORDER BY date) <= COUNT(*) OVER () / 2
             THEN 1 ELSE 2 END AS half,
        COUNT(*) OVER () AS total_days
    FROM win
),
per_category AS (
    -- 必须 JOIN：观看记录表里只有 video_id，分区名在 videos 表上。
    SELECT
        vi.category,
        SUM(CASE WHEN h.half = 1 THEN 1 ELSE 0 END) AS first_views,
        SUM(CASE WHEN h.half = 2 THEN 1 ELSE 0 END) AS second_views,
        MAX(h.total_days) AS total_days
    FROM video_views v
    JOIN videos vi ON vi.video_id = v.video_id
    JOIN half   h  ON h.date = v.date
    WHERE v.date >= ${d(startDate)} AND v.date <= ${d(endDate)}
    GROUP BY vi.category
)
SELECT
    category,
    first_views,
    second_views,
    first_views  * 1.0 / (total_days / 2) AS first_daily_views,
    second_views * 1.0 / (total_days - total_days / 2) AS second_daily_views,
    -- 增长率(%)：前半段日均是 0 时留 NULL，不写 0
    CASE WHEN first_views > 0
         THEN (second_views * 1.0 / (total_days - total_days / 2)
               - first_views  * 1.0 / (total_days / 2))
              / (first_views * 1.0 / (total_days / 2)) * 100
    END AS growth_pct
FROM per_category
ORDER BY growth_pct DESC;`

  return {
    id: CATEGORY_TREND_QUERY_ID,
    label: '前后半段对比',
    purpose:
      '看每个内容分区的日均播放量在窗口里是往上走还是往下走——' +
      '注意它比的是窗口自己内部的前后半段，不是和上一个周期比。',
    sql,
    columns: [
      { key: 'category', label: '内容分区', align: 'left' },
      {
        key: 'first_daily_views',
        label: '前半段日均',
        align: 'right',
        format: (v) => Number(v).toFixed(1),
      },
      {
        key: 'second_daily_views',
        label: '后半段日均',
        align: 'right',
        format: (v) => Number(v).toFixed(1),
      },
      {
        key: 'growth_pct',
        label: '增长率',
        align: 'right',
        format: (v) => (v === null ? '算不出' : formatDelta(Number(v), 2)),
      },
    ],
    note:
      '增长率 = （后半段日均 − 前半段日均）÷ 前半段日均。' +
      '「日均」不是「总量」：两段天数可能不相等，比总量对短的那段不公平。' +
      '这条 SQL 与 SQL 分析页的案例 04 不是同一条——案例 04 比的是分区之间的横向高低，' +
      '这里比的是同一个分区在自己窗口内的前后两段。',

    explain: (rows) => {
      const scored = rows.filter((r) => r.growth_pct !== null && r.growth_pct !== undefined)
      if (scored.length === 0) return EMPTY_ROWS

      const up = scored.filter((r) => num(r.growth_pct) > 0).length
      const top = scored.reduce((a, b) => (num(b.growth_pct) > num(a.growth_pct) ? b : a))
      const bottom = scored.reduce((a, b) => (num(b.growth_pct) < num(a.growth_pct) ? b : a))
      const flat = scored.length - up

      return (
        `${scored.length} 个内容分区里，后半段的日均播放量高于前半段的有 ${up} 个、` +
        `不高于的有 ${flat} 个。` +
        `${String(top.category)} 的变化是 ${formatDelta(num(top.growth_pct), 2)}（排在首位），` +
        `${String(bottom.category)} 是 ${formatDelta(num(bottom.growth_pct), 2)}（排在末位）。` +
        (up === 0
          ? '★ 这一窗口里没有一个分区在涨，所以「排首位」实际上是「跌得最少」——' +
            '原因要看两段的「星期构成」，见下面的业务洞察。'
          : '') +
        `（排名的横向高低来自 ${rows.length} 行真实结果，不是算好的常量。）`
      )
    },

    crossCheck: (rows, py, windowDays) => {
      const trend = py.windows[String(windowDays)]?.categoryTrend
      if (!trend || trend.categories.length === 0 || rows.length === 0) return null

      /*
        ★ 只比【整数】。SQL 的 first_daily_views 和 Python 的 firstDailyViews
          在最后一位上会有取舍差异（两边都做了不同程度的取整），
          拿浮点做 === 会造出一个永久红色的假告警 —— 而假告警会摧毁对账的可信度。
          播放【次数】两边都是整数，可以直接比。

        ★ 为什么两个半段各挂一条，而不是只挂一条：
          这两条合起来才钉住「切分点在哪一天」。切分点错一天的话，
          前半段与后半段的合计会同时变化，两条都会红 ——
          比只验一条更不容易漏。
          日期区间写进 label，让读者一眼看得见核对的是哪一段。
      */
      const half = (which: 1 | 2): CrossCheck => {
        const sqlValue = rows.reduce(
          (sum, r) => sum + num(which === 1 ? r.first_views : r.second_views),
          0,
        )
        const pyValue = trend.categories.reduce(
          (sum, r) => sum + (which === 1 ? r.firstViews : r.secondViews),
          0,
        )
        const from = which === 1 ? trend.firstStart : trend.secondStart
        const to = which === 1 ? trend.firstEnd : trend.secondEnd
        const halfDays = which === 1 ? trend.firstDays : trend.secondDays
        return {
          label: `${which === 1 ? '前半段' : '后半段'} ${from} ~ ${to}（${halfDays} 天）的播放次数合计`,
          sqlValue,
          pyValue,
          unit: '次',
        }
      }

      return [half(1), half(2)]
    },
  }
}

/* --------------------------------------------------------------------------
   各内容分区的观看完成率
   -------------------------------------------------------------------------- */

/**
 * 本查询的 id。导出给图表和意图共用，理由同 CATEGORY_TREND_QUERY_ID。
 */
export const COMPLETION_RANK_QUERY_ID = 'ai:completion-rank'

/**
 * 按内容分区算「观看完成率」，从高到低排。
 *
 * ★ 「看完」的判定只有一处定义：src/data/metrics.ts 的 COMPLETION_THRESHOLD（0.8），
 *   判定式是 `duration > 0 && watch_seconds >= duration * 阈值`。
 *   SQL 里【不重写 0.8】，而是把这个常量插值进来 ——
 *   于是页面上那条 SQL 的原文里看得见这个数，读者能顺着它找到口径在哪。
 *   抄一份数字的话，以后改阈值就会出现「页面显示 0.8、代码里是 0.9」这种
 *   两边都不报错的静默分叉。
 *
 * ★ 观看记录表里只有 video_id，时长和分区都在 videos 表上，必须 JOIN。
 *   顺带一个好处：外键悬空的记录两边都会掉，和 Pandas 那边的 JOIN 行为一致。
 */
export function completionRankQuery(ctx: QueryContext): SqlQuerySpec {
  const { startDate, endDate } = ctx

  const sql = `-- 逐个内容分区算「观看完成率」，从高到低排。
-- 完成率 = 高完成度观看次数 ÷ 该分区的播放次数。
-- 「高完成度」= 实际观看时长 ≥ 视频时长 × ${COMPLETION_THRESHOLD}，且视频时长大于 0。
-- 这个阈值不是这里定的，来自 src/data/metrics.ts 的 COMPLETION_THRESHOLD ——
-- 前面几页的「高完成度观看」用的都是同一个数，全站只有那一处定义。
WITH per_category AS (
    SELECT
        vi.category,
        SUM(
            CASE WHEN vi.duration > 0 AND vv.watch_seconds >= vi.duration * ${COMPLETION_THRESHOLD}
                 THEN 1 ELSE 0 END
        ) AS completed,
        COUNT(*) AS views
    FROM video_views vv
    -- 时长和分区名都在 videos 表上，观看记录里只有 video_id，必须 JOIN
    JOIN videos vi ON vi.video_id = vv.video_id
    WHERE vv.date >= ${d(startDate)} AND vv.date <= ${d(endDate)}
    GROUP BY vi.category
)
SELECT
    category,
    completed,
    views,
    completed * 100.0 / views AS rate_pct
FROM per_category
ORDER BY rate_pct DESC;`

  return {
    id: COMPLETION_RANK_QUERY_ID,
    label: '各分区完播率',
    purpose:
      '看八个内容分区里，哪个被「看完」的比例最高。' +
      '注意它比的是比例不是总量——播放量大的分区天然吃亏。',

    sql,
    columns: [
      { key: 'category', label: '内容分区', align: 'left' },
      {
        key: 'rate_pct',
        label: '完成率',
        align: 'right',
        format: (v) => `${Number(v).toFixed(2)}%`,
        bar: true,
      },
      {
        key: 'completed',
        label: '高完成度观看',
        align: 'right',
        format: (v) => Number(v).toLocaleString('zh-CN'),
      },
      {
        key: 'views',
        label: '播放次数',
        align: 'right',
        format: (v) => Number(v).toLocaleString('zh-CN'),
      },
    ],
    note:
      `完成率的分子是「实际观看时长 ≥ 视频时长 × ${COMPLETION_THRESHOLD}」的观看次数，` +
      '分母是这个分区的全部播放次数。阈值 0.8 来自 metrics.ts，和前面几页口径一致。' +
      '这条 SQL 与 SQL 分析页的案例 07（消费深度）不是同一条：案例 07 看的是「一次看多久」，' +
      '这里看的是「看完的比例」——一个长视频可以被看得很久但仍然没看完。',

    explain: (rows) => {
      if (rows.length === 0) return EMPTY_ROWS

      const sorted = [...rows].sort((a, b) => num(b.rate_pct) - num(a.rate_pct))
      const top = sorted[0]
      const second = sorted[1]
      const last = sorted[sorted.length - 1]

      const gap =
        second !== undefined ? num(top.rate_pct) - num(second.rate_pct) : null

      return (
        `${rows.length} 个内容分区里，完成率最高的是${String(top.category)}：` +
        `${formatPercent(num(top.rate_pct), 2)}——` +
        `每 100 次播放里有 ${num(top.rate_pct).toFixed(1)} 次是看完了的。` +
        (second !== undefined
          ? `第二名是${String(second.category)}（${formatPercent(num(second.rate_pct), 2)}），` +
            `只差 ${gap!.toFixed(2)} 个百分点。`
          : '') +
        `最低的是${String(last.category)}（${formatPercent(num(last.rate_pct), 2)}）。` +
        (gap !== null && gap < 0.1
          ? '★ 前两名之间这点差距小到可以忽略——换个时间窗口先后就会翻过来，' +
            '所以别把相邻的名次当成结论用。'
          : '') +
        `（这个排名来自 ${rows.length} 行真实结果，不是算好的常量。）`
      )
    },

    /*
      ★ 交叉验证：只比【整数】，不比完成率。

        SQL 的 rate_pct 是 15.15973829…，Python 侧刻意四舍五入到 4 位是 15.1597 ——
        两个浮点数做 === 永远是 false，页面会永久挂一个红色的「不一致」，
        而数据其实完全正确。假告警比不检查更糟：它会让以后所有的告警都没人信。

      ★ 为什么挂两条而不是一条：
        「高完成度观看次数合计」钉住的是【阈值 0.8 + duration > 0 这两个判定条件】——
        阈值写错、或者漏了 duration > 0 的守卫，这个数立刻就不一样了。
        「播放次数合计」钉住的是【JOIN、窗口上下界、8 个分区一个不漏不重】。
        两条合起来才把这条查询从头到尾罩住，只挂一条的话另一半是没人管的。
    */
    crossCheck: (rows, py, days) => {
      const w = py.windows[String(days)]
      if (!w || rows.length === 0) return null
      const cats = Object.keys(w.byCategory)
      if (cats.length === 0) return null

      const sumSql = (pick: (r: Record<string, string | number | null>) => number) =>
        rows.reduce((s, r) => s + pick(r), 0)
      const sumPy = (pick: (c: (typeof w.byCategory)[string]) => number) =>
        cats.reduce((s, c) => s + pick(w.byCategory[c]), 0)

      return [
        {
          label: `高完成度观看次数合计（${cats.length} 个内容分区）`,
          sqlValue: sumSql((r) => num(r.completed)),
          pyValue: sumPy((c) => c.completed),
          unit: '次',
        },
        {
          label: `播放次数合计（${cats.length} 个内容分区）`,
          sqlValue: sumSql((r) => num(r.views)),
          pyValue: sumPy((c) => c.views),
          unit: '次',
        },
      ]
    },
  }
}

/* --------------------------------------------------------------------------
   新老用户拆解
   -------------------------------------------------------------------------- */

/**
 * 把窗口内的活跃用户拆成「窗口内新注册」和「之前就注册」两拨。
 *
 * ★ 新用户的判定用的是 `register_date > 窗口首日`（严格大于），
 *   和 metrics.ts:322、analyze.py:806 一模一样。
 *   差一个等号就会让这个数对不上，交叉验证会当场失败——
 *   这正是我们想要的效果：口径不一致必须能被发现，而不是悄悄差几十个人。
 */
export function newVsReturningQuery(ctx: QueryContext): SqlQuerySpec {
  const { startDate, endDate, days } = ctx

  const sql = `-- 把窗口内的用户拆成「窗口内新注册」和「之前就注册」两拨。
-- 新用户的判定：register_date > 窗口首日（严格大于），与前面几页口径一致。
WITH seg AS (
    SELECT
        CASE WHEN u.register_date > ${d(startDate)} THEN '新用户' ELSE '老用户' END AS segment,
        u.user_id
    FROM users u
    WHERE u.register_date <= ${d(endDate)}
),
act AS (
    SELECT DISTINCT user_id
    FROM video_views
    WHERE date >= ${d(startDate)} AND date <= ${d(endDate)}
)
SELECT
    s.segment,
    COUNT(*) AS total_users,
    COUNT(a.user_id) AS active_users,
    COUNT(a.user_id) * 100.0 / COUNT(*) AS active_rate,
    COUNT(a.user_id) * 1.0 / ${days} AS avg_dau
FROM seg s
LEFT JOIN act a ON a.user_id = s.user_id
GROUP BY s.segment
ORDER BY CASE s.segment WHEN '新用户' THEN 1 ELSE 2 END;`

  return {
    id: 'ai:new-vs-returning',
    label: '新老用户拆解',
    purpose: '看活跃人群里新老各占多少、哪一拨的活跃率更低——活跃度下滑常常只发生在其中一拨身上。',
    sql,
    columns: [
      { key: 'segment', label: '用户类型', align: 'left' },
      {
        key: 'total_users',
        label: '用户数',
        align: 'right',
        format: (v) => Number(v).toLocaleString('zh-CN'),
      },
      {
        key: 'active_users',
        label: '窗口内活跃人数',
        align: 'right',
        format: (v) => Number(v).toLocaleString('zh-CN'),
        bar: true,
      },
      {
        key: 'active_rate',
        label: '活跃率',
        align: 'right',
        format: (v) => formatPercent(Number(v)),
      },
      {
        key: 'avg_dau',
        label: '日均活跃（人）',
        align: 'right',
        format: (v) => Number(v).toFixed(1),
      },
    ],
    note:
      '「活跃率」= 窗口内至少活跃过一次的人数 ÷ 该类型的用户总数。' +
      '「日均活跃」= 窗口内活跃过的人数 ÷ 天数，注意它和逐日去重的 DAU 不是一回事，' +
      '所以这一列加起来不等于全站 DAU。',

    explain: (rows) => {
      const fresh = findRow(rows, 'segment', '新用户')
      const veteran = findRow(rows, 'segment', '老用户')
      if (!fresh || !veteran) return EMPTY_ROWS

      const freshRate = num(fresh.active_rate)
      const veteranRate = num(veteran.active_rate)
      const gap = Math.abs(freshRate - veteranRate)
      const fresher = freshRate >= veteranRate ? '新用户' : '老用户'

      return (
        `窗口内的新注册用户里，有 ${formatPercent(freshRate)} 至少活跃过一天；` +
        `老用户是 ${formatPercent(veteranRate)}。` +
        `高出 ${formatPercent(gap)} 的是${fresher}。` +
        `老用户基数 ${num(veteran.total_users).toLocaleString('zh-CN')} 人，` +
        `是活跃人群的主体——所以整体活跃度对老用户的行为更敏感。`
      )
    },

    /*
      ★ 交叉验证：上面这条 SQL 数出来的「新用户」人数，
        应该【恰好等于】Python 侧算出来的窗口内新增用户数。
        两边是两套完全独立的实现——这边是 SQL 的 COUNT + LEFT JOIN，
        那边是 Pandas 的过滤加计数。对得上，才说明口径真的是一致的。
    */
    crossCheck: (rows, py, days) => {
      const fresh = findRow(rows, 'segment', '新用户')
      const pyWindow = py.windows[String(days)]
      if (!fresh || !pyWindow) return null
      return {
        label: '窗口内新增用户数',
        sqlValue: num(fresh.total_users),
        pyValue: num(pyWindow.newUsersInWindow),
        unit: '人',
      }
    },
  }
}

/* --------------------------------------------------------------------------
   各年龄段的「前半段 vs 后半段」日均活跃率
   -------------------------------------------------------------------------- */

/**
 * 本查询的 id。导出给图表和意图共用，理由同 CATEGORY_TREND_QUERY_ID ——
 * 两边各写一遍字符串，改一处漏一处的结果是图表静静地什么都不画。
 */
export const SEGMENT_TREND_QUERY_ID = 'ai:segment-half'

/**
 * 把窗口从【中间】对半切开，比较 4 个年龄段的「前半段 vs 后半段」日均活跃率。
 *
 * 回答的是示例问题「哪些用户群体存在活跃度下降？」。
 *
 * ★ 分母是「该年龄段的总人数」，不是全站人数 ——
 *   分子分母必须是同一批人。拿全站人数当分母，算出来的是「这个年龄段
 *   占全站多少」，完全是另一件事。这条规矩和 SQL 分析页案例 03 是同一个。
 *   分母用的是【截止日之前注册的全部用户】，和窗口无关：
 *   换个时间窗口分母不变，变的只有分子，三个窗口的活跃率才可以横向比。
 *
 * ★ 为什么用 LEFT JOIN age_total 打底（而不是直接 GROUP BY 活跃记录）：
 *   直接按活跃记录分组的话，「这半段里一个人都没活跃过」的年龄段会
 *   整行消失，前端拿到的是 undefined。这里让 4 个档位一定都在，
 *   没人活跃的档位分子是 0、活跃率是 0%，而不是缺键。
 *   和 analyze.py 里「按年龄段一律强制补 0」是同一条规矩。
 *
 * ★ 活跃人天 = COUNT(DISTINCT date || '#' || user_id)：
 *   把「日期」和「用户」拼成一个字符串再去重，得到的是「这个人这天来过」。
 *   同一个人一天看 5 个视频只算 1 次，来 5 天算 5 次。
 *   ★ 不能直接用 COUNT(*)：那数的是观看次数，会把「看得多」和「来得勤」
 *     混成一个数，算出来的不是活跃率。
 *
 * ★ 比的是【日均】活跃率，不是「这半段里活跃过的人数」——
 *   后半段 4 天、前半段 3 天时，天多的那半天然更容易把人扫到，
 *   「活跃过至少一次」这个口径下短的那段永远吃亏。
 *   所以先摊平成日均（÷ 天数）再比。这一步在第 4 步的 categoryTrend
 *   已经踩过一次，是同一种失败形状。
 *
 * ★ change_pp 的单位是【百分点】，不是百分比：
 *   (44.8% → 39.8%) 是「降了 5.01 个百分点」。写成「降了 5.01%」就是夸大了 8 倍多。
 *
 * ★ 切分点从数据里现数（COUNT(*) OVER ()），不写死 days/2，
 *   和 analyze.py 的 build_segment_trend() 用同一套数法（数实际存在的日期）。
 *   写死的话窗口里万一缺一天，两边就会错开一天 —— 而错开一天【不报错】，
 *   只会让所有数字都差一点，看起来还挺合理。
 */
export function segmentTrendQuery(ctx: QueryContext): SqlQuerySpec {
  const { startDate, endDate } = ctx

  const sql = `-- 把窗口从中间对半切开，逐个年龄段比较「前半段 vs 后半段」的日均活跃率。
-- 活跃率 = 该年龄段这半段里的【活跃人天】÷（该年龄段总人数 × 该半段天数）。
WITH win AS (
    SELECT DISTINCT date
    FROM video_views
    WHERE date >= ${d(startDate)} AND date <= ${d(endDate)}
),
half AS (
    -- 窗口里一共有几天、这一天排第几，都从数据里现数，不写死。
    -- 整数除法 7 / 2 = 3，和 Pandas 那边 len(dates) // 2 是同一个结果。
    SELECT
        date,
        CASE WHEN ROW_NUMBER() OVER (ORDER BY date) <= COUNT(*) OVER () / 2
             THEN 1 ELSE 2 END AS half,
        COUNT(*) OVER () AS total_days
    FROM win
),
tot AS (
    SELECT COUNT(*) AS total_days FROM win
),
-- 分母：每个年龄段截止日之前注册的总人数。和窗口无关。
age_total AS (
    SELECT
        ${ageCase('age')} AS age_group,
        COUNT(*) AS total_users
    FROM users
    WHERE register_date <= ${d(endDate)}
    GROUP BY ${ageCase('age')}
),
-- 分子：每个年龄段、每一半的活跃人天（同一人同一天只算 1 次）
active AS (
    SELECT
        ${ageCase('u.age')} AS age_group,
        h.half,
        COUNT(DISTINCT v.date || '#' || v.user_id) AS active_user_days
    FROM video_views v
    JOIN users u ON u.user_id = v.user_id
    JOIN half  h ON h.date = v.date
    WHERE v.date >= ${d(startDate)} AND v.date <= ${d(endDate)}
    GROUP BY ${ageCase('u.age')}, h.half
),
-- 把两半摊平成一行一个年龄段。LEFT JOIN 保证 4 个档位一个都不少。
joined AS (
    SELECT
        t.age_group,
        t.total_users,
        (SELECT total_days FROM tot) AS total_days,
        COALESCE(MAX(CASE WHEN a.half = 1 THEN a.active_user_days END), 0) AS first_active_user_days,
        COALESCE(MAX(CASE WHEN a.half = 2 THEN a.active_user_days END), 0) AS second_active_user_days
    FROM age_total t
    LEFT JOIN active a ON a.age_group = t.age_group
    GROUP BY t.age_group, t.total_users
),
rates AS (
    -- 分母为 0 时给 0（和 Pandas 侧 daily_rate() 的兜底一致），
    -- 不让 NULL 一路漏到页面上变成脏字符。
    SELECT
        age_group,
        total_users,
        total_days,
        first_active_user_days,
        second_active_user_days,
        COALESCE(first_active_user_days  * 1.0
                 / NULLIF(total_users * (total_days / 2), 0) * 100, 0) AS first_daily_active_rate,
        COALESCE(second_active_user_days * 1.0
                 / NULLIF(total_users * (total_days - total_days / 2), 0) * 100, 0) AS second_daily_active_rate
    FROM joined
)
SELECT
    age_group,
    total_users,
    total_days,
    first_active_user_days,
    second_active_user_days,
    first_daily_active_rate,
    second_daily_active_rate,
    -- 单位是百分点，不是百分比
    second_daily_active_rate - first_daily_active_rate AS change_pp
FROM rates
ORDER BY age_group;`

  return {
    id: SEGMENT_TREND_QUERY_ID,
    label: '各年龄段前后半段活跃率',
    purpose:
      '看哪些用户群体的日均活跃率在窗口里往下走——' +
      '注意它比的是窗口自己内部的前后半段，不是和上一个周期比。',
    sql,
    columns: [
      { key: 'age_group', label: '年龄段', align: 'left' },
      {
        key: 'total_users',
        label: '总人数',
        align: 'right',
        format: (v) => formatCount(Number(v)),
      },
      {
        key: 'first_daily_active_rate',
        label: '前半段日均活跃率',
        align: 'right',
        format: (v) => formatPercent(Number(v)),
      },
      {
        key: 'second_daily_active_rate',
        label: '后半段日均活跃率',
        align: 'right',
        format: (v) => formatPercent(Number(v)),
      },
      {
        key: 'change_pp',
        label: '变化',
        align: 'right',
        format: (v) => `${formatDelta(Number(v), 2)} 个百分点`,
      },
    ],
    note:
      '活跃率 = 该年龄段这半段里的活跃人天 ÷（该年龄段总人数 × 该半段天数）。' +
      '「活跃人天」是同一人同一天只算一次，不是观看次数。' +
      '比的是日均——两段天数常常不等（近 7 天切出来是 3 天 vs 4 天），' +
      '拿「这半段里活跃过的人数」去比，天多的那半天然占便宜。' +
      '「变化」的单位是百分点，不是百分比。',

    explain: (rows) => {
      if (rows.length === 0) return EMPTY_ROWS

      const scored = rows.filter((r) => r.change_pp !== null && r.change_pp !== undefined)
      if (scored.length === 0) return EMPTY_ROWS

      const down = scored.filter((r) => num(r.change_pp) < 0).length
      const worst = scored.reduce((a, b) => (num(b.change_pp) < num(a.change_pp) ? b : a))
      const best = scored.reduce((a, b) => (num(b.change_pp) > num(a.change_pp) ? b : a))
      const spread = num(best.change_pp) - num(worst.change_pp)

      return (
        `${scored.length} 个年龄段里，后半段的日均活跃率低于前半段的有 ${down} 个。` +
        `降幅最大的是 ${String(worst.age_group)}（${formatDelta(num(worst.change_pp), 2)} 个百分点），` +
        `最小的是 ${String(best.age_group)}（${formatDelta(num(best.change_pp), 2)} 个百分点），` +
        `四档之间一共差 ${spread.toFixed(2)} 个百分点。` +
        (down === scored.length
          ? '★ 这一窗口里四档全都在跌——原因要先看两段的「星期构成」，见下面的业务洞察。'
          : down === 0
            ? '★ 这一窗口里四档没有一个在跌。'
            : '') +
        `（这些数来自 ${rows.length} 行真实结果，不是算好的常量。）`
      )
    },

    crossCheck: (rows, py, windowDays) => {
      const seg = py.windows[String(windowDays)]?.segmentTrend
      if (!seg || seg.segments.length === 0 || rows.length === 0) return null

      /*
        ★ 只比【整数】。first_daily_active_rate 两边都做过取整，
          拿浮点做 === 会造出一个永久红色的假告警（第 3 步的教训）。
          活跃【人天】两边都是整数，可以直接比。

        ★ 为什么两个半段各挂一条：这两条合起来才钉住「切分点在哪一天」。
          切分点错一天，两段的活跃人天会同时变化、两条都会红 ——
          比只验一条更不容易漏。日期区间写进 label，读者一眼看得见核对的是哪一段。

        ★ 为什么钉的是【人天合计】而不是活跃率：
          活跃率是个除出来的小数，两边取整位数不同；人天是数出来的整数，
          对不上就是真的对不上，不存在「差在最后一位」的灰区。
      */
      const half = (which: 1 | 2): CrossCheck => {
        const sqlValue = rows.reduce(
          (sum, r) => sum + num(which === 1 ? r.first_active_user_days : r.second_active_user_days),
          0,
        )
        const pyValue = seg.segments.reduce(
          (sum, r) => sum + (which === 1 ? r.firstActiveUserDays : r.secondActiveUserDays),
          0,
        )
        const from = which === 1 ? seg.firstStart : seg.secondStart
        const to = which === 1 ? seg.firstEnd : seg.secondEnd
        const halfDays = which === 1 ? seg.firstDays : seg.secondDays
        return {
          label: `${which === 1 ? '前半段' : '后半段'} ${from} ~ ${to}（${halfDays} 天）四个年龄段的活跃人天合计`,
          sqlValue,
          pyValue,
          unit: '人·天',
        }
      }

      return [half(1), half(2)]
    },
  }
}
