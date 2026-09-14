/* ==========================================================================
   示例问题与本页的时间窗口
   --------------------------------------------------------------------------
   ★ 这里刻意把「期望被识别成哪个意图」也写出来（expects 字段）。
     它有两个用处：
       1. 页面上可以如实标注哪几条是【完整演示】、哪几条还【规划中】；
       2. 本机有一条检查拿它当断言——「问题问出去了，有没有被理解成该理解的那一类」。
         识别规则悄悄写坏、把问题匹到错误的类别上，就会当场暴露。

   ★ 为什么 RANGES 在这里又写了一份（项目里这是第 6 份）：
     抽成公共常量要改 5 个已有页面，返工风险大于收益。
     这是有意的取舍，不是没注意。
   ========================================================================== */

import type { IntentId } from './types'

export const RANGES = [
  { days: 7, label: '近 7 天' },
  { days: 14, label: '近 14 天' },
  { days: 30, label: '近 30 天' },
] as const

export interface DemoQuestion {
  id: string
  /** 问题原文，点一下会填进输入框 */
  question: string
  /** 这一类问题应该被识别成哪个意图 */
  expects: IntentId
  /** 这一类分析要回答什么 */
  purpose: string
  /**
   * 现在做了没有。
   * ★ 没做的也要显示出来，而且点下去要【如实说没做】——
   *   藏起来只显示能答的，等于让人以为问什么都能答。
   */
  implemented: boolean
}

export const DEMO_QUESTIONS: DemoQuestion[] = [
  {
    id: 'demo-1',
    question: '为什么最近用户活跃度下降？',
    expects: 'activityDecline',
    purpose: '拆开看 DAU 的构成：是整体在退，还是被周末效应、年龄段差异掩盖了。',
    implemented: true,
  },
  {
    id: 'demo-2',
    question: '18–24岁用户最喜欢什么类型的视频？',
    expects: 'agePreference',
    purpose: '按年龄段分组，看八个内容分区的观看占比，排出偏好顺序。',
    implemented: true,
  },
  {
    id: 'demo-3',
    question: '哪个内容类别的观看完成率最高？',
    expects: 'completionRank',
    purpose:
      '按分区算「看完的比例」并排名，同时查各分区的观众构成——' +
      '这个榜单有一大半是「谁在看」带出来的，不全是内容本身。',
    implemented: true,
  },
  {
    id: 'demo-4',
    question: '最近哪些内容类别增长最快？',
    expects: 'categoryGrowth',
    purpose:
      '把窗口对半切，比较各分区前后半段的【日均】播放量，算增长率并排名；' +
      '同时查两段的周末构成——近 7 天窗口下那个排名其实是在测周末。',
    implemented: true,
  },
  {
    id: 'demo-5',
    question: '哪些用户群体存在活跃度下降？',
    expects: 'segmentDecline',
    purpose:
      '按年龄段拆解活跃率的前后半段变化，逐档排名；' +
      '但真正要回答的是「这个名次可不可靠」——这份数据里四档是被同一个周末节奏一起推着走的，' +
      '没有哪一群在单独衰退。',
    implemented: true,
  },
]

/** 已经实现的意图（页面和本机检查都从这里取，不各写一份） */
export const IMPLEMENTED_INTENT_IDS: IntentId[] = DEMO_QUESTIONS.filter(
  (q) => q.implemented,
).map((q) => q.expects)

/** 兜底要用的那条问题——匹配不上任何意图时，页面会建议先试这一条 */
export const FIRST_DEMO = DEMO_QUESTIONS[0].question
