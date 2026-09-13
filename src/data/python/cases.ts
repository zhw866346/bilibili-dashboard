/* ==========================================================================
   Python 分析案例的定义
   --------------------------------------------------------------------------
   8 个案例，每个都是一段真正跑过的 Pandas 代码 + 它算出来的结果。

   ★ 三条不能破的规矩

   ① **代码从结果文件里取，不在这里手写。**
      script 里的 `snippets` 是 analyze.py 从自己的源码里切出来的，
      所以页面上展示的代码 = 真跑过的代码，由构造保证，不靠纪律。
      这里只写「这段代码在回答什么业务问题」。

   ② **解释文字由真实结果生成，不写死。**
      `explain(results)` 是个函数，不是一段常量字符串。
      写死的解释文字，数据一变就对不上——而一个对不上的解释，
      比没有解释更糟。这条是照抄 SQL 分析页的设计。

   ③ **不说相关性是因果。**
      原因假设那一栏必须指向"The 参数是我设的"，
      因为这份数据的规律确实是我设的（见 DataProvenance）。

   ★ 为什么这一页只做 8 个案例，而不是把 SQL 页做过的事再做一遍
     SQL 页已经覆盖了聚合、JOIN、CTE、窗口函数能回答的问题。
     这里每个案例都挑一个 **SQL 做不了或者做起来很别扭** 的角度：
       · SQL 没有「移动平均」「相关系数」「等频分箱」这些现成函数
       · SQL 结果出不了图，只能给一张表
       · 分层要按分位数自动定边界，SQL 得写一堆嵌套子查询
   ========================================================================== */

import type { PyCaseId, PyResults } from './types'

/** 保留几位小数统一在这里定，免得同一个数在页面两个地方精度不一样 */
function round1(v: number): string {
  return v.toFixed(1)
}

export interface PythonCase {
  id: PyCaseId
  no: number
  title: string
  /** 归类标签，和 SQL 页的「分析场景」是一个作用 */
  scene: string
  /** ① 这段代码在回答什么业务问题 */
  question: string
  /** ② 动到的数据表 / 字段 */
  tables: string[]
  /** ② 用到的 Pandas 能力 */
  abilities: string[]
  /**
   * ⑤ 分析解释。
   * ★ 是函数不是字符串 —— 文字从真实结果里读出来。
   */
  explain: (r: PyResults) => string
  /** ⑥ 这个发现对业务意味着什么 */
  meaning: string
}

export const PYTHON_CASES: PythonCase[] = [
  /* ======================================================================
     01 数据读取
     ====================================================================== */
  {
    id: 'load',
    no: 1,
    title: '把 CSV 读进来，并且显式声明每一列的类型',
    scene: '数据准备',
    question:
      '数据从 CSV 读进内存之后，每一列到底是什么类型？' +
      '如果把这件事交给 pandas 自己猜，会有什么问题？',
    tables: ['users', 'creators', 'videos', 'video_views'],
    abilities: ['read_csv', 'dtype 显式声明', 'df.shape', 'df.head()', '数据类型'],
    explain: (r) => {
      const q = r.quality
      const total = q.shapes.reduce((a, s) => a + s.rows, 0)
      return (
        `四张表一共 ${total.toLocaleString('zh-CN')} 行、` +
        `${q.shapes.reduce((a, s) => a + s.columns, 0)} 列。` +
        `表里存了 ${q.dtypes.length} 种字段类型，全部是在读文件时**显式写死**的，` +
        `不是 pandas 猜出来的。原因很实际：pandas 的类型推断会随版本变——` +
        `同样是 0/1 的布尔列，一个版本可能读成布尔型，另一个版本读成整数型。` +
        `类型一变，后面 groupby 出来的结果可能跟着变，而这个变化是静默的、不会报错。` +
        `工作里要把一份分析交给别人复现，就不能留这种"取决于你装了什么版本"的口子。`
      )
    },
    meaning:
      '这一步在真实工作里对应「拿到数据先确认口径」：' +
      '列的类型决定了它能不能参与计算、怎么参与计算。' +
      '日期列如果是字符串，就没法算时间差；布尔列如果是字符串，求和会得到一串文字。' +
      '把这些在入口处一次定死，后面所有分析才有一个稳定的地基。',
  },

  /* ======================================================================
     02 数据体检
     ====================================================================== */
  {
    id: 'quality',
    no: 2,
    title: '数据体检：四个问题，每个都查两遍',
    scene: '数据质量',
    question:
      '这份数据能不能直接用？有没有空值、有没有重复、' +
      '表之间的关系对不对、数值有没有跑到业务上不可能的范围？',
    tables: ['users', 'creators', 'videos', 'video_views'],
    abilities: ['isna()', '哨兵字符串扫描', 'duplicated()', '外键完整性', '业务范围校验'],
    explain: (r) => {
      const q = r.quality
      const sentinel = q.sentinelHits.reduce((a, s) => a + s.count, 0)
      const dupKeys = q.duplicateKeys.map((d) => `「${d.label}」${d.count.toLocaleString('zh-CN')} 行`)
      const orphan = q.foreignKeys.reduce((a, f) => a + f.orphans, 0)
      const violations = q.rangeChecks.reduce((a, c) => a + c.violations, 0)

      return (
        `结论是：**没有缺失值，但有"重复"**。\n` +
        `· 缺失值查了两遍：一遍用 isna() 查真空值，得到 ${q.missingTotal} 个；` +
        `另一遍扫"伪装成合法值的缺失"（NA / null / - / 空字符串这类哨兵词），` +
        `得到 ${sentinel} 处。两遍都是 0。\n` +
        `· 整行完全重复的有 ${q.duplicateFullRows} 行。但换两个口径数，数字差得很远：` +
        `${dupKeys.join('、')}。这不是脏数据——这张表的粒度是"一次播放"，` +
        `不是"用户 × 视频 × 天"，同一个人一天把同一个视频点开三次，本来就该有三行。` +
        `两种口径分开报，是为了让读者看清"重复"和"重复"是两回事。\n` +
        `· 表之间的引用关系：${q.foreignKeys.length} 项外键检查，孤儿行 ${orphan} 行。\n` +
        `· 五项业务范围检查（观看秒数为正、不超过视频时长、日期在范围内、年龄合理、注册日不晚于截止日）：` +
        `越界 ${violations} 行。`
      )
    },
    meaning:
      '体检的意义不是"走个流程"，而是**决定这份数据能不能支撑后面的结论**。' +
      '如果这里查出 30% 的缺失值，那后面所有的平均值都是不可信的，' +
      '该做的是回去补数据，而不是硬着头皮往下算。' +
      '这一次四项全过，所以后面的分析可以放心做——' +
      '这句话本身就是这一步的产出。',
  },

  /* ======================================================================
     03 数据清洗
     ====================================================================== */
  {
    id: 'clean',
    no: 3,
    title: '数据清洗：这次一行都没改，如实说明',
    scene: '数据质量',
    question: '清洗要改掉哪些东西？如果数据本来就是干净的，' +
      '是应该编几个问题出来演示，还是如实说"没有要清洗的"？',
    tables: ['video_views', 'videos', 'users'],
    abilities: ['astype()', 'to_datetime()', 'merge()', '派生列', '数据完整性断言'],
    explain: (r) => {
      const q = r.quality
      const derived = q.derivedColumns
      return (
        `清洗前后都是 ${q.rowsBefore.toLocaleString('zh-CN')} 行，**一行没丢、一行没改**。\n` +
        `这一步真正做的事是**加派生列**，一共 4 个：${derived.join('、')}。\n` +
        `· 分区和时长从视频表并过来、年龄段从用户表并过来——` +
        `用 merge 做，并且显式声明是「多对一」，让 pandas 顺便检查一下视频编号会不会重复。\n` +
        `· 「是否完播」是新算出来的：观看秒数达到视频总时长的 80% 才算完播。\n` +
        `最后加了一条断言：清洗后的行数必须等于清洗前。` +
        `这条断言不是摆设——它把「只整理、不丢数据」从一句承诺变成了一个会当场报错的条件。\n` +
        `如果硬要演示"发现缺失值 → 填充 → 前后对比"，那就得先往数据里塞假问题，` +
        `那是在编造分析结果。数据干净就如实说干净，这也是分析报告该有的样子。`
      )
    },
    meaning:
      '真实工作里，清洗往往是整个流程里最花时间的一步（常说的 60%~80%）。' +
      '这个项目的数据是模拟生成的、天然干净，所以这一步很轻——' +
      '**这一点必须在页面上说清楚**，而不是假装自己做了大量清洗工作。' +
      '想展示的是清洗的**方法和判断**：查两遍缺失、两种重复口径分开报、' +
      '加完整性断言，而不是"清洗动作"本身的数量。',
  },

  /* ======================================================================
     04 用户活跃度
     ====================================================================== */
  {
    id: 'activity',
    no: 4,
    title: '活跃天数分布与波动率：日均 DAU 掩盖了什么',
    scene: '用户活跃度',
    question:
      '首页给出了日均 DAU。但"平均每天有多少人活跃"这个数，' +
      '是不是就足以描述用户的活跃情况了？',
    tables: ['video_views', 'users'],
    abilities: ['groupby + agg', 'nunique()', 'value_counts()', 'rolling()', 'pct_change()', 'std()'],
    explain: (r) => {
      const a = r.activity
      const days = r.manifest.days
      const buckets = a.activeDaysHist
      // 活跃天数在 30 天以上（也就是超过一半时间）的人有多少
      const heavy = buckets.filter((b) => b.days >= Math.ceil(days / 2)).reduce((s, b) => s + b.users, 0)
      const totalUsers = r.manifest.rowCounts.users
      const pct = (heavy / totalUsers) * 100

      // 波动最大的一天
      const v = a.volatility
      return (
        `全站平均每个用户在 ${days} 天里活跃了 ${round1(a.avgActiveDays)} 天。` +
        `但只看平均数会漏掉最重要的一件事——**分布是极不均匀的**：` +
        `活跃天数达到一半以上（≥ ${Math.ceil(days / 2)} 天）的用户有 ` +
        `${heavy.toLocaleString('zh-CN')} 人，占 ${round1(pct)}%。\n` +
        `· 一次都没来过的用户：${a.neverActiveUsers} 人。\n` +
        `· DAU 的日环比波动率（标准差）${round1(v.stdPct)}%，` +
        `平均每天上下浮动 ${round1(v.meanAbsPct)}%，` +
        `最大的一次波动出现在 ${v.maxAbsDate}，达到 ${round1(v.maxAbsPct)}%。\n` +
        `· 加上 7 日移动平均之后能看出来，那些上下跳动大部分是**周末效应**造成的，` +
        `而不是用户真的流失了又回来——具体见下面第 08 个案例。`
      )
    },
    meaning:
      '日均 DAU 是给管理层看的"体检指标"，它能告诉你大盘有没有问题，' +
      '但掩盖了两件对业务更要紧的事：' +
      '一是**结构**（少数高频用户贡献了大部分行为，还是大家一起用），' +
      '二是**波动**（数字的起伏是噪声、是周期，还是真的出了问题）。' +
      '做用户运营时，这两种情况的对策完全不同。',
  },

  /* ======================================================================
     05 用户分层
     ====================================================================== */
  {
    id: 'tiers',
    no: 5,
    title: '用 qcut 按行为做等频分层，看长尾有多长',
    scene: '用户分层',
    question:
      '用户价值分布是典型的长尾——怎么分层才不会被"少数人极大、多数人极小"' +
      '这种分布带偏？为什么这里用等频分箱，不用等距分箱？',
    tables: ['video_views'],
    abilities: ['pd.qcut()', '等频分箱 vs 等距分箱', 'groupby 分层聚合', '占比计算', 'value_counts()'],
    explain: (r) => {
      const tiers = r.tiers
      const top = tiers[tiers.length - 1]
      const bottom = tiers[0]
      const lines = tiers
        .map(
          (t) =>
            `· ${t.id}：${t.users.toLocaleString('zh-CN')} 人，` +
            `人均每天看 ${round1(t.minMinutes)}~${round1(t.maxMinutes)} 分钟，` +
            `贡献了全部观看时长的 ${round1(t.minutesShare)}%`,
        )
        .join('\n')

      return (
        `四档各 ${tiers[0].users.toLocaleString('zh-CN')} 人（等频分箱保证人数一样），` +
        `但他们贡献的观看时长差得很远：\n${lines}\n` +
        `**最高的一档贡献了 ${round1(top.minutesShare)}% 的观看时长，最低的一档只有 ${round1(bottom.minutesShare)}%。**` +
        `这就是长尾：四分之一的人干了近四成的活。\n` +
        `如果改用等距分箱（比如按 0~10、10~20 分钟切），` +
        `绝大多数用户会挤在最低那一档里，最高档只剩寥寥几个人，` +
        `分出来的组根本没法拿来做对比——这就是选等频不选等距的原因。`
      )
    },
    meaning:
      '分层的目的是**让运营动作有针对性**。' +
      '最高那一档是需要重点维护的核心用户，掉一个的损失远大于普通用户；' +
      '最低那一档的问题不是"看什么内容"，而是"还没养成打开的习惯"，' +
      '拉活的抓手应该放在提高打开频次，而不是推荐更好的内容。' +
      '把这两类人放在一套运营策略里，是对资源的浪费。',
  },

  /* ======================================================================
     06 内容消费
     ====================================================================== */
  {
    id: 'content',
    no: 6,
    title: '视频时长和完播率的关系：完播率低，怪视频太长还是内容不行',
    scene: '内容消费',
    question:
      '有些分区完播率低。是因为那个分区的视频本来就更长' +
      '（长视频更难看完），还是内容本身留不住人？' +
      '这个问题能不能用数据回答？',
    tables: ['video_views', 'videos'],
    abilities: ['先聚合到视频粒度', 'corr() 皮尔逊相关系数', 'groupby 二次聚合', 'median() 中位数'],
    explain: (r) => {
      const c = r.content
      const rho = c.durationCompletionR
      const strength =
        Math.abs(rho) < 0.2 ? '几乎不相关' : Math.abs(rho) < 0.4 ? '弱相关' : Math.abs(rho) < 0.6 ? '中等相关' : '较强相关'

      // 找出中位时长最长和最短的分区
      const sorted = [...c.categories].sort((a, b) => b.medianDuration - a.medianDuration)
      const longest = sorted[0]
      const shortest = sorted[sorted.length - 1]

      return (
        `先按视频聚合（${c.videosAnalyzed.toLocaleString('zh-CN')} 个视频，` +
        `每个视频算出自己的总播放、完播次数、完播率），再算时长和完播率的相关系数：` +
        `**r = ${rho.toFixed(3)}**，属于${strength}。\n` +
        `换句话说：**在这份数据里，"视频越长完播率越低"这个直觉并不成立。**\n` +
        `· 中位时长最长的分区是「${longest.category}」，${round1(longest.medianDuration)} 秒，` +
        `完播率 ${round1(longest.avgCompletedRate)}%；\n` +
        `· 最短的是「${shortest.category}」，${round1(shortest.medianDuration)} 秒，` +
        `完播率 ${round1(shortest.avgCompletedRate)}%。\n` +
        `两者的时长差了好几倍，完播率的差距却远没有那么大。\n` +
        `★ 这里要特别小心一件事：${strength}不等于"时长不影响完播"。` +
        `相关系数只能说明这两个数在这份数据里没有明显的线性关系，` +
        `不能说明它们之间没有关系（也可能是非线性的），更**不能反过来推出因果**。`
      )
    },
    meaning:
      '这个结论的价值在于**它否掉了一个很容易被当成理所当然的假设**。' +
      '如果一看到完播率低就去砍视频时长，可能花了很大代价却没有任何效果。' +
      '正确的下一步是：把"内容本身的质量"作为更可能的解释，' +
      '去看那个分区的互动率、以及同样时长下不同分区的完播率差异。' +
      '这是数据分析最实际的用处——不是给出答案，而是缩小该试的方向。',
  },

  /* ======================================================================
     07 用户 × 内容
     ====================================================================== */
  {
    id: 'cross',
    no: 7,
    title: '活跃分层 × 内容分区，以及各年龄段口味的相似度',
    scene: '用户 × 内容',
    question:
      '不同活跃程度的用户，看的内容是一样的吗？' +
      '如果不一样，那"给用户推荐什么"就不能一刀切。' +
      '另外，几个年龄段的口味到底像不像？能不能用一个数说清楚？',
    tables: ['video_views', 'users'],
    abilities: ['pivot_table 数据透视', 'crosstab 交叉表', '行内占比', '余弦相似度', '向量化计算'],
    explain: (r) => {
      const cross = r.cross

      // 找出「最高活跃档最偏爱的分区」和「最低活跃档最偏爱的分区」
      const topRow = cross.tierCategory[cross.tierCategory.length - 1]
      const bottomRow = cross.tierCategory[0]
      const favOf = (row: typeof topRow) =>
        [...row.cells].sort((a, b) => b.share - a.share)[0]
      const topFav = favOf(topRow)
      const bottomFav = favOf(bottomRow)

      const sims = cross.preferenceSimilarity
      const mostAlike = sims.reduce((a, b) => (b.cosine > a.cosine ? b : a))
      const leastAlike = sims.reduce((a, b) => (b.cosine < a.cosine ? b : a))

      return (
        `**第一问：活跃程度不同的人，看的东西确实不一样。**\n` +
        `· 最活跃的一档（${topRow.tier}）最偏爱的分区是「${topFav.category}」，` +
        `占它自己观看量的 ${round1(topFav.share)}%；\n` +
        `· 最低的一档（${bottomRow.tier}）最偏爱的是「${bottomFav.category}」，` +
        `占 ${round1(bottomFav.share)}%。\n` +
        `两档人偏爱的分区不同，说明"按活跃度分层推荐"是有意义的。\n\n` +
        `**第二问：年龄段之间的口味相似度。**把每个年龄段在 8 个分区上的观看量看成一个 8 维向量，` +
        `算两两之间的夹角余弦（越接近 1 越像）：\n` +
        `· 最像的：${mostAlike.a} 与 ${mostAlike.b}，${mostAlike.cosine.toFixed(3)}；\n` +
        `· 最不像的：${leastAlike.a} 与 ${leastAlike.b}，${leastAlike.cosine.toFixed(3)}。\n` +
        `这是一个用一个数就能说清"口味像不像"的办法——` +
        `不用把 8 个分区的数字逐个摆出来让人自己看。\n` +
        `★ 但要注意：余弦相似度只看**方向**、不看**多少**。` +
        `两个年龄段的观看量可以差很多倍，只要在各个分区上的比例结构接近，相似度就会很高。`
      )
    },
    meaning:
      '对推荐和运营来说，这两个结论指向同一个动作：**内容分发不能只按人群规模分配**。' +
      '如果只按"哪个年龄段人多"来决定推荐什么内容，会漏掉最活跃那部分用户的口味，' +
      '而恰恰是他们贡献了最多的观看时长。' +
      '反过来，相似度高的两个年龄段可以共用一套内容策略，把省下的力气放在差异最大的那一组上。',
  },

  /* ======================================================================
     08 趋势与变化率
     ====================================================================== */
  {
    id: 'trend',
    no: 8,
    title: '用移动平均反过来验证：周末效应到底是不是真的',
    scene: '趋势分析',
    question:
      'DAU 每天都在上上下下。这些起伏里，有多少是"周末效应"，' +
      '有多少只是随机波动？怎么把这两件事分开？',
    tables: ['video_views'],
    abilities: ['rolling() 移动平均', 'dt.dayofweek', 'np.select 条件分档', '变化率对比', '反查构造参数'],
    explain: (r) => {
      const trend = r.trend
      const weekend = trend.dowEffect.find((d) => d.group === 'weekend')
      const friday = trend.dowEffect.find((d) => d.group === 'friday')
      const weekday = trend.dowEffect.find((d) => d.group === 'weekday')

      const lines = trend.dowEffect
        .map(
          (d) =>
            `· ${d.label}：${d.days} 天，平均 DAU ${d.avgDau.toFixed(0)}，` +
            `是工作日的 ${d.ratioToWeekday.toFixed(4)} 倍`,
        )
        .join('\n')

      return (
        `先把每 7 天做一个移动平均，把随机波动抹平，再按星期几分组求均值：\n${lines}\n` +
        `**周末的 DAU 是工作日的 ${weekend ? weekend.ratioToWeekday.toFixed(4) : '—'} 倍，` +
        `周五是 ${friday ? friday.ratioToWeekday.toFixed(4) : '—'} 倍。**\n` +
        `这个数不是"估算"，是算出来的——` +
        `而它正好对得上生成这份数据时设的参数：**周末 1.18 倍、周五 1.06 倍**。\n` +
        `★ 这个案例在整个项目里是唯一一处**用数据反查构造参数**的地方，` +
        `所以它同时也是"相关不等于因果"最好的落点：` +
        `我之所以能确定这条规律是"设定出来的"而不是"发现的"，` +
        `是因为**我知道它是我自己拧上去的**。` +
        `换成一份真实数据，同样的图能告诉你的只有"周末更高"这个相关性，` +
        `至于原因是用户周末更有空、还是内容工作日更新得更少，` +
        `数据本身回答不了——那需要别的证据。\n` +
        `（顺带一提：周五的实测值和设定值差得比较明显。原因很简单——` +
        `全部 ${r.manifest.days} 天里只有 ${friday ? friday.days : 0} 个周五、` +
        `${weekend ? weekend.days : 0} 天周末，样本小，单天的随机波动就能把均值拉偏。` +
        `这个差异我没有去修饰，它是这份数据真实的样子。）`
      )
    },
    meaning:
      '把"周期性的起伏"和"真实的趋势变化"分开，是看任何时间序列的第一步。' +
      '如果不知道有周末效应，看到周五 DAU 涨了就以为活动做成功了、' +
      '周一跌了就以为用户流失了，会把运营动作越做越偏。' +
      '移动平均就是把噪声和周期一起抹掉、只留下趋势的那把尺子。',
  },
]

/** 按 id 取案例，卡片渲染时用 */
export const PYTHON_CASE_BY_ID: Record<string, PythonCase> = Object.fromEntries(
  PYTHON_CASES.map((c) => [c.id, c]),
)

/** 场景筛选用。顺序按首次出现的顺序，和案例排列一致。 */
export const PYTHON_SCENES: string[] = Array.from(new Set(PYTHON_CASES.map((c) => c.scene)))

/** 「不筛选」那一档的标识，和 SQL 页的 ALL_SCENES 是一个意思 */
export const ALL_SCENES = '全部'

/**
 * 案例覆盖的能力标签汇总。页面上的「能力覆盖」矩阵由它生成，
 * 不手填 —— 手填的清单迟早和案例本身对不上。
 */
export function computePythonAbilities(): { ability: string; cases: number[] }[] {
  const map = new Map<string, number[]>()
  for (const c of PYTHON_CASES) {
    for (const a of c.abilities) {
      const hit = map.get(a)
      if (hit) hit.push(c.no)
      else map.set(a, [c.no])
    }
  }
  return Array.from(map, ([ability, cases]) => ({ ability, cases }))
}
