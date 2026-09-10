/* ==========================================================================
   类型定义：「数据的形状」
   --------------------------------------------------------------------------
   分成两大部分：

   第一部分【原始数据表】—— 模拟的是数据库里的四张表。
     用户表 users / 视频表 videos / 创作者表 creators / 观看记录表 video_views
     这些是"事实"，一条一条的明细。

   第二部分【衍生指标】—— 页面上画图用的。
     它们全部由第一部分计算出来（计算逻辑在 src/data/metrics.ts），
     不是手写死的数字。

   为什么要分两层？
   因为"数据 → 计算 → 图表"这条链路要看得见。
   图表上的每个数字，你都能顺着代码倒推回原始明细。
   ========================================================================== */

/* ============================================================
   第一部分：原始数据表
   ============================================================ */

/** 内容分区。全站固定这 8 个，顺序也固定。 */
export type CategoryName =
  | '游戏'
  | '知识'
  | '科技'
  | '生活'
  | '娱乐'
  | '动画'
  | '影视'
  | '音乐'

/** 年龄段编号，定义在 src/utils/ageGroup.ts */
export type AgeGroupId = '18-24' | '25-31' | '32-40' | '40+'

/** 用户表 */
export interface User {
  /** 用户唯一编号，例如 U00001 */
  user_id: string
  /** 年龄（岁） */
  age: number
  gender: '男' | '女'
  /** 所在城市层级 */
  city: string
  /** 注册日期 YYYY-MM-DD */
  register_date: string
  /** 用户等级 0-6 */
  user_level: number
}

/** 创作者（UP 主）表 */
export interface Creator {
  up_id: string
  creator_type: '个人' | '机构' | 'MCN'
  /** 粉丝数 */
  followers: number
}

/** 视频表 */
export interface Video {
  video_id: string
  /** 投稿的 UP 主 */
  up_id: string
  category: CategoryName
  /** 发布时间 YYYY-MM-DD */
  publish_date: string
  /** 视频总时长（秒） */
  duration: number
}

/**
 * 观看记录表 —— 最重要的明细表，一行 = 某用户某天看了某个视频。
 * 所有指标都由这张表汇总出来。
 */
export interface VideoView {
  user_id: string
  video_id: string
  /** 观看日期 YYYY-MM-DD */
  date: string
  /** 本次实际观看秒数（≤ 视频总时长） */
  watch_seconds: number
  /** 是否点赞 */
  is_like: boolean
  /** 是否收藏 */
  is_favorite: boolean
  /** 是否评论 */
  is_comment: boolean
  /** 是否分享 */
  is_share: boolean
}

/** 整个数据集（相当于一个数据库里的四张表） */
export interface Dataset {
  users: User[]
  creators: Creator[]
  videos: Video[]
  views: VideoView[]
  /** 数据覆盖的日期列表，从最早到最新 */
  dates: string[]
}

/* ============================================================
   第二部分：衍生指标（全部由第一部分算出来）
   ============================================================ */

/** 数据来源说明。每一页顶部的提示条会读它。 */
export interface DataSource {
  isMock: boolean
  badge: string
  note: string
}

/** 指标卡（KPI Card） */
export interface Kpi {
  id: string
  /** 中文指标名 */
  name: string
  /** 英文缩写，没有就不填 */
  abbr?: string
  /** 原始数值（注意不是显示文字，显示时按 unit 格式化） */
  value: number
  /** 决定怎么格式化 */
  unit: 'count' | 'duration' | 'percent' | 'number'
  /**
   * 与上一周期相比的变化百分比。
   * 不传表示这个指标是「存量」（比如累计注册用户数），环比对它没有意义，
   * 卡片就不显示涨跌徽标。
   */
  deltaPct?: number
  /** 涨跌徽标右边那行小字，用来交代口径 */
  deltaLabel: string
  /** 一句话解释这个指标怎么算的、是什么意思 */
  desc: string
}

/** 趋势图上的一个点 */
export interface TrendPoint {
  date: string
  value: number
}

/** 一个年龄段的全套指标 */
export interface AgeBucket {
  id: AgeGroupId
  label: string
  /** 用户规模：该年龄段累计注册用户数 */
  users: number
  /** 日均活跃用户数（该年龄段） */
  dau: number
  /** 活跃率 = dau / users，单位 % */
  activeRate: number
  /** 人均单日观看时长，单位分钟 */
  avgMinutes: number
  /** 人均单日观看视频数，单位个 */
  avgVideos: number
}

/**
 * 一个内容分区的表现。
 *
 * ⚠️ 这里是全项目「指标口径」最容易混淆的地方，三个"时长/次数"分母完全不同：
 *
 *   avgMinutes       = 总时长 ÷ 播放次数   → 平均【点开一次】看多久
 *   minutesPerViewer = 总时长 ÷ 独立观看用户 → 看过这个分区的人，窗口内【一共】看了多久
 *   viewsPerViewer   = 播放量 ÷ 独立观看用户 → 看过这个分区的人，窗口内【一共】看了几条
 *
 * 页面上的每一处都要标明用的是哪一个，不能混着叫"人均"。
 */
export interface CategoryStat {
  category: CategoryName
  /** 固定配色槽位 1-8，只为「类别作为并列系列同时出现」时使用 */
  slot: number
  /** 播放量（观看次数） */
  plays: number
  /** 播放量占全站的比例 % */
  playShare: number
  /** 总观看时长，单位分钟 */
  totalMinutes: number
  /** 平均每次观看的时长，单位分钟 */
  avgMinutes: number

  /** 独立观看用户数（窗口内跨天去重，COUNT(DISTINCT user_id)） */
  viewers: number
  /** 人均观看次数 = 播放量 ÷ 独立观看用户数 */
  viewsPerViewer: number
  /** 人均观看时长（分钟）= 总时长 ÷ 独立观看用户数 */
  minutesPerViewer: number
  /** 完播率 % = 高完成度观看次数 ÷ 播放量 */
  completedRate: number

  /** 点赞率 % = 点赞次数 / 播放量 */
  likeRate: number
  favoriteRate: number
  commentRate: number
  shareRate: number
  /** 综合互动率 % =（赞+藏+评+享）÷ 播放量。注意是"行为次数"不是"人数" */
  engageRate: number
}
