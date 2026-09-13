/* ==========================================================================
   Python 分析结果的类型定义
   --------------------------------------------------------------------------
   这些类型描述的是 scripts/analyze.py 吐出来的东西。

   ★ 为什么字段全部用 string / number，不用联合字面量类型（比如 '18-24' | '25-31'）：
     results.generated.ts 是「自动生成的一整个大对象字面量」。如果这里声明成
     联合字面量，TypeScript 会把生成文件里的字符串当成普通的 string，
     推断出的类型比联合字面量宽，赋值时直接报错。
     而那个文件不该手改——所以类型这边放宽，让编译期检查专注于
     「结构对不对、字段名有没有写错」这件真正有价值的事。
     需要窄类型的地方（比如案例定义）在别处单独声明。

   ★ 这些类型是「手写的」而不是生成出来的：手写才有意义。
     analyze.py 一旦改了输出结构、忘了同步这里，`npx tsc --noEmit` 会当场报错。
     生成出来的类型永远和输出一致，也就永远发现不了问题。
   ========================================================================== */

/** 四张原始表的表名 */
export type PyTableName = 'users' | 'creators' | 'videos' | 'video_views'

/** 八个内容案例的标识，和 analyze.py 里的 CASE 记号一一对应 */
export type PyCaseId =
  | 'load'
  | 'quality'
  | 'clean'
  | 'activity'
  | 'tiers'
  | 'content'
  | 'cross'
  | 'trend'

/* ---------------------------------------------------------------------------
   输入指纹：用来发现「改了数据但没重跑 Python」
   --------------------------------------------------------------------------- */

export interface PyManifest {
  /** 数据生成的随机种子。必须和 DATASET_META.seed 相等 */
  seed: number
  /** 数据截止日。必须和 DATASET_META.endDate 相等 */
  endDate: string
  /** 覆盖天数 */
  days: number
  /** Python 侧算了哪几个时间窗口 */
  windowDays: number[]
  /** 每张原始表的行数。必须和 DATASET_META 里的对应值相等 */
  rowCounts: Record<PyTableName, number>
  pythonVersion: string
  pandasVersion: string
  numpyVersion: string
  /**
   * analyze.py 自己的指纹（FNV-1a，8 位十六进制）。
   * 页面用 Vite 的 `?raw` 拿到同一份源码后重算，比对是否一致 ——
   * 不一致就说明「脚本改了但没重跑」，页面会挂红横幅。
   * 算法细节见 manifest.ts 里的 fnv1a()。
   */
  analyzePyHash: string
}

/* ---------------------------------------------------------------------------
   数据体检
   --------------------------------------------------------------------------- */

export interface PyTableShape {
  table: string
  label: string
  rows: number
  columns: number
}

export interface PyMissingCell {
  table: string
  column: string
  count: number
}

export interface PySentinelHit {
  table: string
  column: string
  value: string
  count: number
}

/** 一种「重复」口径。同一批数据按不同列组合去重，得到的行数差很多，两个都要报 */
export interface PyDuplicateKey {
  key: string
  label: string
  count: number
}

export interface PyForeignKeyCheck {
  child: string
  column: string
  parent: string
  orphans: number
}

export interface PyRangeCheck {
  check: string
  detail: string
  violations: number
}

export interface PyDtype {
  table: string
  column: string
  dtype: string
}

export interface PyHeadSample {
  table: string
  label: string
  columns: string[]
  /** 每行的单元格。原本是数字就是数字，是文字就是文字，空值转成 null */
  rows: (string | number | null)[][]
}

export interface PyQuality {
  shapes: PyTableShape[]
  missing: PyMissingCell[]
  missingTotal: number
  sentinelHits: PySentinelHit[]
  duplicateFullRows: number
  duplicateKeys: PyDuplicateKey[]
  foreignKeys: PyForeignKeyCheck[]
  rangeChecks: PyRangeCheck[]
  /** 清洗前的行数 */
  rowsBefore: number
  /** 清洗后的行数。和 rowsBefore 相等才说明「只整理、没丢数据」 */
  rowsAfter: number
  derivedColumns: string[]
  distinctDates: number
  firstDate: string
  dtypes: PyDtype[]
  head: PyHeadSample[]
}

/* ---------------------------------------------------------------------------
   用户活跃度
   --------------------------------------------------------------------------- */

export interface PyDailyPoint {
  date: string
  /** 星期几。0 = 周一，6 = 周日，和 JS 的 getDay() 不一样，别混 */
  dow: number
  dowGroup: string
  dau: number
  views: number
  seconds: number
  /** 7 日移动平均。前 6 天不足 7 个点，是 null */
  dauSmooth7: number | null
  /** 日环比百分比。第一天没有前一天，是 null */
  changePct: number | null
}

export interface PyActiveDaysBucket {
  days: number
  users: number
}

export interface PyVolatility {
  stdPct: number
  meanAbsPct: number
  maxAbsPct: number
  maxAbsDate: string
}

export interface PyActivity {
  daily: PyDailyPoint[]
  activeDaysHist: PyActiveDaysBucket[]
  neverActiveUsers: number
  avgActiveDays: number
  volatility: PyVolatility
}

/* ---------------------------------------------------------------------------
   用户分层（qcut 等频分箱）
   --------------------------------------------------------------------------- */

export interface PyTierCategoryShare {
  category: string
  share: number
}

export interface PyTier {
  id: string
  users: number
  /** 这一档的人均每日观看分钟数的下界 */
  minMinutes: number
  maxMinutes: number
  avgActiveDays: number
  totalMinutes: number
  /** 这一档贡献了全部观看时长的百分之多少 */
  minutesShare: number
  viewsShare: number
  topCategories: PyTierCategoryShare[]
}

/* ---------------------------------------------------------------------------
   内容消费
   --------------------------------------------------------------------------- */

export interface PyCategoryContent {
  category: string
  videos: number
  medianDuration: number
  plays: number
  avgCompletedRate: number
  avgWatchSeconds: number
}

export interface PyContent {
  /** 视频时长与完播率的皮尔逊相关系数 */
  durationCompletionR: number
  /** 参与计算的视频数 */
  videosAnalyzed: number
  categories: PyCategoryContent[]
}

/* ---------------------------------------------------------------------------
   用户 × 内容
   --------------------------------------------------------------------------- */

export interface PyTierCategoryCell {
  category: string
  views: number
  share: number
}

export interface PyTierCategoryRow {
  tier: string
  totalViews: number
  cells: PyTierCategoryCell[]
}

export interface PyPreferenceSimilarity {
  a: string
  b: string
  /** 两个年龄段在 8 个分区上的观看量向量的余弦相似度。越接近 1 越像 */
  cosine: number
}

export interface PyCross {
  tierCategory: PyTierCategoryRow[]
  preferenceSimilarity: PyPreferenceSimilarity[]
}

/* ---------------------------------------------------------------------------
   趋势
   --------------------------------------------------------------------------- */

export interface PyDowEffect {
  group: string
  label: string
  avgDau: number
  /** 相对工作日的倍数。数据生成时设的是 周五 1.06 / 周末 1.18 */
  ratioToWeekday: number
  days: number
}

export interface PyTrend {
  dowEffect: PyDowEffect[]
  weekdayBaselineDau: number
}

/* ---------------------------------------------------------------------------
   时间窗口汇总
   --------------------------------------------------------------------------
   ★ 这些字段名是照抄 src/data/metrics.ts 的 WindowSummary 的，不是另起一套。
     名字一样，对账时就能逐字段直接比，不用维护一张「它的 A 对应我的 B」的
     翻译表——那种表迟早会翻译错，而翻译错了看起来就像数据不一致。
   --------------------------------------------------------------------------- */

export interface PyCategoryWindowCell {
  views: number
  seconds: number
  likes: number
  favorites: number
  comments: number
  shares: number
  completed: number
  /** 窗口内跨天去重的独立观看用户数 */
  viewers: number
}

/**
 * 「年龄段 × 内容分区」的一格。
 *
 * ★ 派生口径和前端 src/data/selectors.ts 的 UserContentCell 是同一套，
 *   字段名也刻意取了同样的（share / coverage / avgMinutes …）。
 *   对账时逐字段直接比，不用维护翻译表。
 */
export interface PyAgePreferenceCell {
  category: string
  views: number
  /** 窗口内跨天去重的独立观看用户数（不是按天加出来的） */
  viewers: number
  seconds: number
  /** 偏好占比(%) = 该格播放次数 ÷ 该年龄段 8 个分区的播放次数之和 × 100 */
  share: number
  /** 用户覆盖率(%) = 该格独立观看用户数 ÷ 该年龄段窗口内活跃用户数 × 100 */
  coverage: number
  /** 单次观看时长(分) = 该格总秒数 ÷ 该格播放次数 ÷ 60 */
  avgMinutes: number
  /** 完播率(%) = 高完成度观看次数 ÷ 播放次数 × 100 */
  completedRate: number
  /** 综合互动率(%) = （赞+藏+评+享）的次数 ÷ 播放次数 × 100 */
  engageRate: number
}

/** 某一档人的内容偏好（对应前端 selectors.ts 的 AgePreferenceRow） */
export interface PyAgePreferenceRow {
  /** 年龄段 id，和 src/utils/ageGroup.ts 的 AGE_GROUP_IDS 逐字一致 */
  age: string
  /**
   * 该年龄段在窗口内活跃过的去重人数 —— coverage 的分母。
   * ★ 这里刻意不输出显示用的中文标签（「18–24岁」那种）：
   *   前端 src/utils/ageGroup.ts 才是年龄段的唯一权威定义，
   *   页面用 ageGroupLabel() 自己映射。这边再写一份就是第二个真相来源。
   */
  activeUsers: number
  totalViews: number
  /** 8 个分区，已按 share 降序排好 */
  cells: PyAgePreferenceCell[]
}

/** 某个内容分区的「窗口前半段 vs 后半段」 */
export interface PyCategoryTrendRow {
  category: string
  firstViews: number
  secondViews: number
  /** 前半段日均播放量 = firstViews ÷ firstDays（两段天数可能不等，所以只能比日均） */
  firstDailyViews: number
  secondDailyViews: number
  /**
   * 增长率(%) = (后半日均 − 前半日均) ÷ 前半日均 × 100。
   * ★ 前半段日均是 0 时为 null —— 算不出来就说算不出来，
   *   不要拿 0 冒充「没涨没跌」。
   */
  growthPct: number | null
}

export interface PyCategoryTrend {
  /** 前半段的起止与天数。天数会写进页面，因为 7 天窗口切出来是 3 天 vs 4 天 */
  firstStart: string
  firstEnd: string
  firstDays: number
  secondStart: string
  secondEnd: string
  secondDays: number
  /** 8 个分区，已按 growthPct 降序排好，算不出来的排最后 */
  categories: PyCategoryTrendRow[]
}

/** 某个年龄段的「窗口前半段 vs 后半段」日均活跃率 */
export interface PySegmentTrendRow {
  age: string
  /** 分母：该年龄段截止日之前注册的总人数。和窗口无关，三个窗口共用同一个分母 */
  totalUsers: number
  /** 前半段的「活跃人天」—— 某人某天来过算 1，同一天看 5 个视频也只算 1 */
  firstActiveUserDays: number
  /** 后半段的「活跃人天」，同上 */
  secondActiveUserDays: number
  /** 前半段日均活跃人数 = firstActiveUserDays ÷ firstDays */
  firstDau: number
  secondDau: number
  /** 前半段日均活跃率(%) = 活跃人天 ÷（该档总人数 × 该半段天数）× 100 */
  firstDailyActiveRate: number
  secondDailyActiveRate: number
  /**
   * 后半段 − 前半段的日均活跃率，单位是【百分点】，可正可负。
   *
   * ★ 是百分点，不是百分比：从 44.8% 掉到 39.8% 是「降了 5.01 个百分点」，
   *   不是「降了 5.01%」。文案里写错一个词就是在夸大或缩小事实。
   */
  changePp: number
}

export interface PySegmentTrend {
  /** 前半段的起止与天数。7 天窗口切出来是 3 天 vs 4 天，所以天数必须写进页面 */
  firstStart: string
  firstEnd: string
  firstDays: number
  secondStart: string
  secondEnd: string
  secondDays: number
  /**
   * 全部年龄段的活跃人天合计（两段各一个）。
   * ★ 这就是 AI 助手页交叉验证钉的那两个整数：切分点错一天，两个数会同时变、
   *   两条检查会同时红，比只验一条更不容易漏。
   */
  firstActiveUserDays: number
  secondActiveUserDays: number
  /** 4 个年龄段，按 AGE_GROUPS 的固定顺序排（不在这里排序，排序在 intents.ts 做一次） */
  segments: PySegmentTrendRow[]
}

export interface PyWindow {
  days: number
  startDate: string
  endDate: string
  totalUsers: number
  totalUsersByAge: Record<string, number>
  newUsersInWindow: number
  dau: number
  dauByAge: Record<string, number>
  activeUsers: number
  activeUsersByAge: Record<string, number>
  totalViews: number
  viewsByAge: Record<string, number>
  totalSeconds: number
  secondsByAge: Record<string, number>
  /** 窗口内产生过互动的去重用户数 */
  engagedUsers: number
  totalLikes: number
  totalFavorites: number
  totalComments: number
  totalShares: number
  byCategory: Record<string, PyCategoryWindowCell>
  /**
   * 年龄段 × 内容分区 的偏好明细（4 行 × 8 格）。
   * ★ 代码写在 analyze.py 的 CASE:cross 块里。
   *   它存在的理由是给 AI 助手页的「SQL ↔ Python 交叉验证」当第二个独立信源，
   *   不是为了在页面上再摆一张同样的表。
   */
  agePreference: PyAgePreferenceRow[]
  /** 各分区「窗口前半段 vs 后半段」的对比。代码写在 analyze.py 的 CASE:trend 块里 */
  categoryTrend: PyCategoryTrend
  /**
   * 各年龄段「窗口前半段 vs 后半段」的日均活跃率对比。
   * 同样写在 analyze.py 的 CASE:trend 块里，同样只为交叉验证而生。
   */
  segmentTrend: PySegmentTrend
}

/* ---------------------------------------------------------------------------
   顶层
   --------------------------------------------------------------------------- */

export interface PyResults {
  manifest: PyManifest
  quality: PyQuality
  activity: PyActivity
  tiers: PyTier[]
  content: PyContent
  cross: PyCross
  trend: PyTrend
  /** 键是窗口天数（'7' / '14' / '30'），和前端 RANGES 一一对应 */
  windows: Record<string, PyWindow>
  /** 每个案例真正跑过的代码片段，由 analyze.py 从自己的源码里切出来 */
  snippets: Record<PyCaseId, string>
}
