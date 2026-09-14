/* ==========================================================================
   注入给大模型的「库表与口径说明」卡片
   --------------------------------------------------------------------------
   这是整条大模型路径最值钱的一段文字。理由：

     模型看不见数据库、看不见页面、看不见 src/。它只有这张卡片。
     卡片里少写一条口径，模型就会【按常识猜】——
     猜出来的 SQL 语法完全正确、跑得通、结果看着也合理，
     只是口径和页面上的口径不是一回事。这类错【不报错】，
     要靠人肉对比才发现，比 SQL 报错危险得多。

   ★ 所以这张卡片【逐字由真源码生成】，一个字都不手抄：
       建表语句   ←  src/data/sql/schema.ts 的 SCHEMA_SQL
       年龄分档   ←  src/utils/ageGroup.ts  的 AGE_GROUPS
       完播门槛   ←  src/data/metrics.ts    的 COMPLETION_THRESHOLD
       八个分区   ←  src/utils/categories.ts 的 CATEGORIES
     手抄的代价在项目里已经付过好几次了（第 3 步的「中老年」、
     第 6 步的 weekday/workday），每一次都是「不报错，只是静静地错」。

   ★ 这里【只放口径，不放数据】。任何具体数字都不许出现在卡片里 ——
     一旦出现，模型就有机会把那个数字抄进结论，而它并不来自本次执行。
   ========================================================================== */

import { COMPLETION_THRESHOLD } from '../../metrics'
import { SCHEMA_SQL, TABLE_NOTES } from '../../sql/schema'
import { AGE_GROUPS } from '../../../utils/ageGroup'
import { CATEGORIES } from '../../../utils/categories'

/** 造卡片要知道的窗口信息。和规则路径的 QueryContext 是同一套东西。 */
export interface DialectContext {
  days: number
  startDate: string
  endDate: string
}

/**
 * 年龄分档的 SQL 写法。
 * ★ 从 AGE_GROUPS 现算，不写死 —— 改分档规则时这里自动跟着变。
 *   最后一档 max 是 999（表示「以上」），要写成 `age >= 41` 而不是 `BETWEEN 41 AND 999`
 *   （写 BETWEEN 也不错，但 `>=` 一眼能看出是开区间，更不容易被后来的人改坏）。
 */
function ageCaseSql(): string {
  const lines = AGE_GROUPS.map((g, i) => {
    const cond =
      g.max >= 999 ? `age >= ${g.min}` : `age BETWEEN ${g.min} AND ${g.max}`
    const head = i === 0 ? 'CASE ' : '     '
    const tail = i === AGE_GROUPS.length - 1 ? ' END' : ''
    return `${head}WHEN ${cond} THEN '${g.id}'${tail}`
  })
  return lines.join('\n')
}

/** 人话版的年龄分档，给模型看的（和 SQL 那份必须一致，所以也现算）。 */
function ageLegend(): string {
  return AGE_GROUPS.map((g) => {
    const range = g.max >= 999 ? `≥${g.min}` : `${g.min}~${g.max}`
    return `${g.id}（${range} 岁，显示成「${g.label}」）`
  }).join('、')
}

/**
 * 造这张卡片。纯函数：同样的 ctx 永远得到同样的字符串。
 * ★ 纯函数这一点很重要 —— 本机有一条检查要拿它跟真源码逐字对比，有随机性就验不了。
 */
export function buildDialectCard(ctx: DialectContext): string {
  const { days, startDate, endDate } = ctx

  return `【可用数据库】本机浏览器里的 SQLite，共 4 张表。建表语句原文如下：

${SCHEMA_SQL.map((s) => s.replace(/^/gm, '    ')).join('\n\n')}

各表一句话说明：
${TABLE_NOTES.map((t) => `  · ${t.name} —— ${t.note}`).join('\n')}

【本次时间窗口】近 ${days} 天 = ${startDate} ~ ${endDate}（首尾都算在内）。
  表里的 date 列是 'YYYY-MM-DD' 文本，可以直接用 >= / <= 比较，不要用日期函数包它。

【★ 这几列不存在，必须自己算】
  video_views 表【没有】age_group、category、duration、completed、age 这几列。
  想要它们，只能 JOIN 别的表、或者自己写 CASE WHEN。直接 SELECT 会报 no such column。

  ① 年龄段（users.age 是整数，要自己分档）：
${ageCaseSql()}
     取值只有这 4 个，一字不差：${AGE_GROUPS.map((g) => `'${g.id}'`).join(' / ')}
     含义：${ageLegend()}

  ② 内容分区在 videos.category，取值只有这 8 个中文名，一字不差：
     ${CATEGORIES.join(' / ')}
     要按分区统计播放量，必须 JOIN videos（video_views 里没有 category）。

  ③ 视频总时长在 videos.duration（秒）。「看完一次」的判定是：
     videos.duration > 0 AND video_views.watch_seconds >= videos.duration * ${COMPLETION_THRESHOLD}
     —— 用比例而不是绝对秒数，因为各分区视频长短差很多（音乐约 5 分钟、影视约 45 分钟）。

【常用口径，必须按这个来算】
  · DAU（日均活跃用户数）= 每天的去重活跃人数【逐天相加】之后 ÷ 天数。
    ★ 不等于「整个窗口去重后的活跃用户数」！后者会小很多。
      一个人连着活跃 5 天，DAU 口径里算 5 人·天，窗口去重口径里只算 1 个人。
    · 窗口内去重活跃用户数 = COUNT(DISTINCT user_id)，和上面那个是两回事。
    · 活跃率 = DAU ÷ 用户总量 × 100。用户总量是【累计注册数】，不随窗口变。
    · 人均单日观看时长 = 总观看秒数 ÷（DAU × 天数）÷ 60。
      ★ 分母是「人·天」，不是「去重人数 × 天数」——后者会把用户没来的那些天也算进去，
        人均时长被严重稀释。
    · 播放次数可以直接按天相加；独立观看用户数【必须先去重】再数，不能相加。

【三条业务陷阱，下结论前必须先排除】
  1. 如果所有分组的变化率都是负的，不许写「增长最快」——
     那实际是「跌得最少」。必须如实写成下跌，并把名次说成「跌得最少」。
  2. 把时间窗口对半切开比较前后两段时，两段的【星期构成不同】是最主要的混淆因素。
     没排除它之前，不许把差异归因到人群或内容本身。
     例如近 7 天窗口：前半段含 3 天周末、后半段一天都没有。
     两段天数还可能不等（7 天会切成 3 天 vs 4 天），所以只能比【日均】，不能比总量。
  3. 这份数据是【固定随机种子生成的模拟数据】，与 B 站真实经营数据无关。
     它里面的「规律」是生成时设定好的参数体现出来的。不许写成「B 站真实数据显示」。

【SQL 硬性要求】
  ① 只允许【一条】SELECT 或 WITH 开头的查询语句。禁止分号（末尾也不要），
     禁止 INSERT / UPDATE / DELETE / DROP / ALTER / CREATE / ATTACH / PRAGMA
     等任何写操作。写了会被本机的安全校验器直接拒绝，并告诉你拒绝理由。
  ② 结果最多返回 500 行（超了会被截断）。所以请在 SQL 里自己 LIMIT，
     或者用 GROUP BY 把结果聚合到几十行以内 —— 几百行的明细发回来也没用。
  ③ 列名用英文，并在 SELECT 里用 AS 起一个看得懂的名字。
  ④ 不要写 ROUND()，本机的页面会自己格式化；返回原始精度即可。`
}
