/* ==========================================================================
   ★★★  原始模拟数据生成器  ★★★
   --------------------------------------------------------------------------
   这个文件负责"造数据"，造的是一张张明细表：

       users        用户表      —— 谁
       creators     创作者表    —— 谁在投稿
       videos       视频表      —— 投了什么
       video_views  观看记录表  —— 谁在什么时候看了什么、看了多久、有没有互动

   页面上的每一个数字（DAU、活跃率、人均时长……）都不是写在这里的，
   而是由 src/data/metrics.ts 从这些明细里【算】出来的。

   --------------------------------------------------------------------------
   ⚠️ 重要声明
   本文件生成的全部是【模拟业务数据】，用于演示分析方法。
   数据由固定种子的随机算法生成，每次刷新结果完全一致，便于核对。
   与 B 站（哔哩哔哩）的真实经营数据没有任何关系。
   --------------------------------------------------------------------------

   关于下面那些"权重""概率""时长"参数，你需要知道的是：
   它们是我为了让数据具备"可供分析的差异"而人为设定的构造参数，
   相当于给随机过程定了个基调。页面上的所有结论都是从生成后的数据里
   重新算出来的，而不是把这些参数直接抄到页面上。
   ========================================================================== */

import type {
  AgeGroupId,
  CategoryName,
  Creator,
  Dataset,
  User,
  Video,
  VideoView,
} from '../types'
import { AGE_GROUPS } from '../utils/ageGroup'
import { CATEGORIES } from '../utils/categories'
import { chance, createRandom, pickWeighted, poissonish, randFloat, randInt } from '../utils/random'
import { ageGroupOf } from '../utils/ageGroup'

/* ---------------------------------------------------------------
   一、生成参数
   --------------------------------------------------------------- */

/** 固定种子。改这个数字，整套数据会变成另一套，但仍然是可复现的。 */
const SEED = 20260910

/** 数据截止日（也是"今天"）。写死是为了让数据稳定，不随真实日期变化。 */
const END_DATE = '2026-09-10'

/**
 * 覆盖天数。
 * 为什么是 60 而不是刚好 30？因为页面上要显示「环比」——
 * 比如"近 30 天 vs 上一个 30 天"，那就必须真的存在后面那 30 天。
 * 只存 30 天的话，选"近 30 天"时就没有东西可比了。
 */
const DAYS = 60

/** 模拟用户数 */
const USER_COUNT = 6000

/** 模拟 UP 主数 */
const CREATOR_COUNT = 180

/** 模拟视频数 */
const VIDEO_COUNT = 1000

/* ---------------------------------------------------------------
   二、用户画像参数
   --------------------------------------------------------------- */

/** 各年龄段的用户规模权重（构造参数） */
const AGE_WEIGHTS: { value: AgeGroupId; weight: number }[] = [
  { value: '18-24', weight: 32 },
  { value: '25-31', weight: 30 },
  { value: '32-40', weight: 24 },
  { value: '40+', weight: 14 },
]

/** 各年龄段的"基础日活跃概率"（构造参数）：越年轻越常打开 App */
const BASE_ACTIVITY: Record<AgeGroupId, number> = {
  '18-24': 0.36,
  '25-31': 0.33,
  '32-40': 0.27,
  '40+': 0.21,
}

/** 活跃当天平均看几个视频（构造参数） */
const VIEWS_PER_ACTIVE_DAY: Record<AgeGroupId, number> = {
  '18-24': 4.8,
  '25-31': 4.4,
  '32-40': 3.8,
  '40+': 3.3,
}

/**
 * 各年龄段的内容偏好权重（构造参数）。
 * 这是让"年龄 × 内容"能分析出差异的关键。
 * 注意：这是我构造数据时设定的基调，不等于真实用户偏好。
 */
/**
 * 各年龄段对每个内容分区的偏好权重（构造参数）。每行合计正好 100，
 * 所以它本身就是一组百分比——AI 助手页会把它和实测占比并排摆出来，
 * 让读者一眼看到「这份偏好排名其实就是把这张表量了一遍」。
 *
 * ★ 导出的理由：那张对照表必须读【真·参数】，不能手抄一份。
 *   手抄的参数改了不会跟着变，页面就会开始说假话。
 */
export const CATEGORY_PREFERENCE: Record<AgeGroupId, Record<CategoryName, number>> = {
  '18-24': { 游戏: 30, 知识: 8, 科技: 9, 生活: 14, 娱乐: 18, 动画: 14, 影视: 5, 音乐: 2 },
  '25-31': { 游戏: 22, 知识: 14, 科技: 15, 生活: 18, 娱乐: 14, 动画: 8, 影视: 5, 音乐: 4 },
  '32-40': { 游戏: 14, 知识: 20, 科技: 18, 生活: 20, 娱乐: 10, 动画: 4, 影视: 8, 音乐: 6 },
  '40+': { 游戏: 8, 知识: 26, 科技: 16, 生活: 20, 娱乐: 8, 动画: 3, 影视: 12, 音乐: 7 },
}

/** 各年龄段"看得有多深"系数（构造参数）：年长者更容易看完 */
const COMPLETION_FACTOR: Record<AgeGroupId, number> = {
  '18-24': 0.92,
  '25-31': 1.0,
  '32-40': 1.06,
  '40+': 1.12,
}

/** 各年龄段的互动倾向系数（构造参数）：越年轻越爱点赞 */
const ENGAGE_FACTOR: Record<AgeGroupId, number> = {
  '18-24': 1.15,
  '25-31': 1.05,
  '32-40': 0.95,
  '40+': 0.85,
}

/** 城市分布（构造参数） */
const CITY_WEIGHTS = [
  { value: '一线城市', weight: 22 },
  { value: '新一线城市', weight: 27 },
  { value: '二线城市', weight: 26 },
  { value: '三线及以下', weight: 25 },
]

/* ---------------------------------------------------------------
   三、内容参数
   --------------------------------------------------------------- */

/** 各分区的典型视频时长（秒），这是"基准值"，实际会上下浮动 */
const CATEGORY_DURATION: Record<CategoryName, number> = {
  游戏: 1500,
  知识: 1800,
  科技: 1200,
  生活: 600,
  娱乐: 300,
  动画: 1440,
  影视: 2700,
  音乐: 300,
}

/** 各分区的互动基准概率（构造参数）：一次观看有多大概率产生互动 */
const INTERACTION_BASE: Record<
  CategoryName,
  { like: number; favorite: number; comment: number; share: number }
> = {
  游戏: { like: 0.058, favorite: 0.021, comment: 0.014, share: 0.009 },
  知识: { like: 0.092, favorite: 0.086, comment: 0.018, share: 0.016 },
  科技: { like: 0.076, favorite: 0.069, comment: 0.015, share: 0.013 },
  生活: { like: 0.064, favorite: 0.024, comment: 0.019, share: 0.011 },
  娱乐: { like: 0.049, favorite: 0.013, comment: 0.022, share: 0.015 },
  动画: { like: 0.088, favorite: 0.057, comment: 0.026, share: 0.014 },
  影视: { like: 0.061, favorite: 0.042, comment: 0.017, share: 0.010 },
  音乐: { like: 0.073, favorite: 0.038, comment: 0.028, share: 0.021 },
}

/* ---------------------------------------------------------------
   四、小工具
   --------------------------------------------------------------- */

/** 把数字补零成固定长度，例如 pad(7, 4) => "0007" */
function pad(n: number, len: number): string {
  return String(n).padStart(len, '0')
}

/** 以数据截止日为基准，往前推 offset 天，返回 YYYY-MM-DD */
function dateFromEnd(offset: number): string {
  const d = new Date(`${END_DATE}T00:00:00Z`)
  d.setUTCDate(d.getUTCDate() - offset)
  return d.toISOString().slice(0, 10)
}

/**
 * 星期几的活跃度倍数（构造参数）：周末更高。
 * 提成常量是为了让「参数对照表」能自动读到它，而不是手抄。
 */
const DOW_MULTIPLIER = {
  weekend: 1.18, // 周日 / 周六
  friday: 1.06, // 周五
  weekday: 1.0, // 周一 ~ 周四
}

/** 这一天是不是周末/周五，返回活跃度倍数：周末更高 */
function dayMultiplier(dateStr: string): number {
  const dow = new Date(`${dateStr}T00:00:00Z`).getUTCDay()
  if (dow === 0 || dow === 6) return DOW_MULTIPLIER.weekend
  if (dow === 5) return DOW_MULTIPLIER.friday
  return DOW_MULTIPLIER.weekday
}

/* ---------------------------------------------------------------
   五、生成器主函数
   --------------------------------------------------------------- */

export function buildDataset() {
  const rng = createRandom(SEED)

  const dates: string[] = []
  for (let i = DAYS - 1; i >= 0; i--) dates.push(dateFromEnd(i))
  const multipliers = dates.map(dayMultiplier)

  /* ---------- 1. 用户表 ---------- */
  const users: User[] = []
  for (let i = 0; i < USER_COUNT; i++) {
    const group = pickWeighted(rng, AGE_WEIGHTS)
    const def = AGE_GROUPS.find((g) => g.id === group)!
    // 最高只到 55 岁，避免构造出不合理的年龄
    const age = randInt(rng, def.min, Math.min(def.max, 55))

    // 注册时间：三年内，越近注册的人越多（幂次让分布偏近期）
    const daysAgo = Math.floor(1095 * Math.pow(rng(), 2))

    users.push({
      user_id: `U${pad(i + 1, 5)}`,
      age,
      gender: rng() < 0.53 ? '男' : '女',
      city: pickWeighted(rng, CITY_WEIGHTS),
      register_date: dateFromEnd(daysAgo),
      user_level: pickWeighted(rng, [
        { value: 0, weight: 8 },
        { value: 1, weight: 12 },
        { value: 2, weight: 18 },
        { value: 3, weight: 22 },
        { value: 4, weight: 18 },
        { value: 5, weight: 14 },
        { value: 6, weight: 8 },
      ]),
    })
  }

  /* ---------- 2. 创作者表 ---------- */
  const creators: Creator[] = []
  for (let i = 0; i < CREATOR_COUNT; i++) {
    creators.push({
      up_id: `C${pad(i + 1, 4)}`,
      creator_type: pickWeighted(rng, [
        { value: '个人' as const, weight: 72 },
        { value: '机构' as const, weight: 20 },
        { value: 'MCN' as const, weight: 8 },
      ]),
      // 粉丝数差异极大：幂次分布让大多数是小 UP，少数是头部
      followers: Math.round(Math.pow(rng(), 3) * 2_000_000) + 500,
    })
  }

  /* ---------- 3. 视频表 ---------- */
  const videos: Video[] = []
  const videoIdsByCategory = new Map<CategoryName, string[]>()
  for (const c of CATEGORIES) videoIdsByCategory.set(c, [])

  for (let i = 0; i < VIDEO_COUNT; i++) {
    const category = CATEGORIES[Math.floor(rng() * CATEGORIES.length)]
    const duration = Math.round(CATEGORY_DURATION[category] * randFloat(rng, 0.6, 1.5))
    const videoId = `V${pad(i + 1, 5)}`

    videos.push({
      video_id: videoId,
      up_id: creators[Math.floor(rng() * creators.length)].up_id,
      category,
      publish_date: dateFromEnd(randInt(rng, 0, 120)),
      duration,
    })
    videoIdsByCategory.get(category)!.push(videoId)
  }

  const videoById = new Map(videos.map((v) => [v.video_id, v]))

  /* ---------- 4. 观看记录表（明细） ---------- */
  const views: VideoView[] = []

  for (const user of users) {
    const group = ageGroupOf(user.age)
    const pref = CATEGORY_PREFERENCE[group]
    const prefItems = CATEGORIES.map((c) => ({ value: c, weight: pref[c] }))

    // 每个用户自己的活跃程度和互动倾向都不一样（个体差异）
    const activity = BASE_ACTIVITY[group] * randFloat(rng, 0.55, 1.7)
    const engage = ENGAGE_FACTOR[group] * randFloat(rng, 0.7, 1.35)
    const completionBase = COMPLETION_FACTOR[group]

    for (let d = 0; d < DAYS; d++) {
      // 这一天他会不会上线？
      const p = Math.min(0.95, activity * multipliers[d])
      if (!chance(rng, p)) continue

      // 上线了，看几个视频？
      const n = poissonish(rng, VIEWS_PER_ACTIVE_DAY[group])

      for (let k = 0; k < n; k++) {
        const category = pickWeighted(rng, prefItems)
        const pool = videoIdsByCategory.get(category)!
        const videoId = pool[Math.floor(rng() * pool.length)]
        const video = videoById.get(videoId)!
        if (!video) continue

        /*
          看了多久？
          真实观看行为是"很多人看两眼就走"，所以这里用幂次让完成度偏小，
          再乘以年龄系数（年长者更可能看完）。
        */
        const rawRatio = 0.12 + 0.88 * Math.pow(rng(), 1.7)
        const ratio = Math.min(0.98, rawRatio * completionBase)
        const watchSeconds = Math.max(5, Math.round(video.duration * ratio))

        const base = INTERACTION_BASE[category]

        views.push({
          user_id: user.user_id,
          video_id: videoId,
          date: dates[d],
          watch_seconds: watchSeconds,
          is_like: chance(rng, Math.min(0.5, base.like * engage)),
          is_favorite: chance(rng, Math.min(0.5, base.favorite * engage)),
          is_comment: chance(rng, Math.min(0.5, base.comment * engage)),
          is_share: chance(rng, Math.min(0.5, base.share * engage)),
        })
      }
    }
  }

  return { users, creators, videos, views, dates } satisfies Dataset
}

/* ---------------------------------------------------------------
   六、数据集单例
   ---------------------------------------------------------------
   整套数据只在第一次被用到时生成一次，之后所有页面共用同一份，
   保证"KPI、柱状图、热力图用的是同一套数据"。
   --------------------------------------------------------------- */

let cached: Dataset | null = null

export function getDataset(): Dataset {
  if (!cached) cached = buildDataset()
  return cached
}

/** 供页面显示的、关于这套模拟数据的说明 */
export const DATASET_META = {
  seed: SEED,
  endDate: END_DATE,
  days: DAYS,
  userCount: USER_COUNT,
  videoCount: VIDEO_COUNT,
  creatorCount: CREATOR_COUNT,
  label: `${USER_COUNT.toLocaleString('zh-CN')} 名模拟用户 · ${VIDEO_COUNT.toLocaleString('zh-CN')} 个视频 · 近 ${DAYS} 天观看日志`,
}

/** 数据来源声明。每一页顶部的提示条读的就是它。 */
export const dataSource = {
  isMock: true,
  badge: '模拟业务数据',
  note:
    '全部数值由固定种子的模拟数据集计算得出，与 B 站真实经营数据无关。' +
    '数据中的年龄差异、内容偏好等规律，均来自我在生成数据时设定的构造参数，' +
    '用于演示分析链路，不代表任何真实结论。',
}

/* ---------------------------------------------------------------
   七、构造参数对照表
   ---------------------------------------------------------------
   ★★★ 这个表是这个项目里最该被看到的东西 ★★★

   下面每一条都是：页面上的某个"规律" ←→ 我在生成数据时设的那个旋钮。

   为什么要把这个列出来？
   因为如果不列，读者会以为"18–24 岁更活跃""影视人均看得最久"是从数据里
   分析出来的发现。实际上它们都是我先把旋钮拧到某个位置、再由数据体现出来的。
   把旋钮和结果并排放出来，读者才能正确判断这些图表到底证明了什么：
   它证明的是「分析方法能跑通」，不是「B 站用户是这样的」。

   前六条影响的是【用户分析页】的年龄差异；
   后三条影响的是【内容分析页】的分区差异——哪一类内容看得久、哪一类互动高，
   基本由这三条决定。

   注意：下面的数值不是手抄的，是直接从上面的参数常量里取出来的，
   改了参数这里会自动跟着变，不会对不上。
   --------------------------------------------------------------- */

export interface ConstructionParam {
  /** 页面上的哪个差异 */
  effect: string
  /** 代码里那个参数的名字 */
  param: string
  /** 参数的实际取值 */
  values: string
  /** 这个参数控制什么 */
  meaning: string
}

const AGE_ORDER = AGE_GROUPS.map((g) => g.id)

export const CONSTRUCTION_PARAMS: ConstructionParam[] = [
  {
    effect: '各年龄段的人数比例',
    param: 'AGE_WEIGHTS',
    values: AGE_WEIGHTS.map((w) => `${w.value}=${w.weight}`).join('，'),
    meaning: '生成用户时，各年龄段被抽到的相对权重',
  },
  {
    effect: '各年龄段的活跃程度差异',
    param: 'BASE_ACTIVITY',
    values: AGE_ORDER.map((id) => `${id}=${BASE_ACTIVITY[id]}`).join('，'),
    meaning: '每天打开 App 的基础概率',
  },
  {
    effect: '各年龄段每天看几条',
    param: 'VIEWS_PER_ACTIVE_DAY',
    values: AGE_ORDER.map((id) => `${id}=${VIEWS_PER_ACTIVE_DAY[id]}`).join('，'),
    meaning: '活跃当天平均观看条数',
  },
  {
    effect: '各年龄段看得深不深',
    param: 'COMPLETION_FACTOR',
    values: AGE_ORDER.map((id) => `${id}=${COMPLETION_FACTOR[id]}`).join('，'),
    meaning: '观看完成度系数（越大越可能看完）',
  },
  {
    effect: '各年龄段爱看什么内容',
    param: 'CATEGORY_PREFERENCE',
    values: '4 个年龄段 × 8 个分区，共 32 个权重值',
    meaning: '每个年龄段对每个内容分区的偏好权重',
  },
  {
    effect: '各年龄段的互动倾向',
    param: 'ENGAGE_FACTOR',
    values: AGE_ORDER.map((id) => `${id}=${ENGAGE_FACTOR[id]}`).join('，'),
    meaning: '点赞 / 收藏 / 评论 / 分享的概率倍数',
  },

  /* ---- 以下三条主要影响「内容分析」页 ---- */
  {
    effect: '各分区典型视频有多长',
    param: 'CATEGORY_DURATION',
    values: CATEGORIES.map((c) => `${c}=${CATEGORY_DURATION[c]}秒`).join('，'),
    meaning:
      '生成视频时的时长基准（实际会上下浮动 0.6~1.5 倍）。' +
      '这一条直接决定了内容分析页横轴的排序，以及完播率的高低——' +
      '视频越长，"看完 80%"越难。',
  },
  {
    effect: '各分区的内容吸引不吸引人互动',
    param: 'INTERACTION_BASE',
    values: '8 个分区 × 4 种互动行为（赞/藏/评/享），共 32 个概率值',
    meaning:
      '一次观看有多大概率产生点赞 / 收藏 / 评论 / 分享。' +
      '内容分析页的四个互动率排名基本由它决定。',
  },
  {
    effect: '周末比工作日活跃多少',
    param: 'DOW_MULTIPLIER',
    values: `周末=${DOW_MULTIPLIER.weekend}，周五=${DOW_MULTIPLIER.friday}，周一至周四=${DOW_MULTIPLIER.weekday}`,
    meaning: '首页 DAU 趋势图上那个明显的"周末抬升"，就是这一个值造出来的',
  },
]

/** 一句话说清楚：这个项目证明了什么、没证明什么 */
export const HONESTY_STATEMENT = {
  whatIsReal: '页面上的每一个数字，都是从 56 万条观看明细里逐条汇总算出来的，可以核对、可以复现。',
  whatIsConstructed:
    '但数据本身是模拟的。数据里呈现的每一条"规律"（谁更活跃、谁爱看什么），背后都对应一个我设定的构造参数。',
  therefore:
    '所以这些图表证明的是「分析方法能跑通」——口径怎么定、去重怎么做、交叉分析怎么关联；它不能证明"B 站用户是这样的"。',
}
