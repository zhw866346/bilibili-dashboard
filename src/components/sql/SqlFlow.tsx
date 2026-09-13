/* ==========================================================================
   从业务问题到 SQL —— 十步流程图
   --------------------------------------------------------------------------
   这一块要说明的不是"我会写 SQL"，而是"我知道一个业务问题是怎么一步步
   变成一条查询的"。对做数据分析来说，后面那件事更重要——SQL 语法是工具，
   难的是想清楚：要分析谁、看什么指标、按什么维度切、数据在哪张表里。

   十步分成三段，颜色上用一个小圆点区分，不加别的装饰：
     想清楚  —— 1~4 步，动 SQL 之前就得想明白的
     写出来  —— 5~8 步，落到 SQL 语句上的
     用起来  —— 9~10 步，跑完还要验证和对业务下结论
   ========================================================================== */

interface Step {
  title: string
  /** 这一步具体在做什么。用本项目的真实例子，不写空话。 */
  detail: string
  /** 属于哪一段 */
  stage: '想清楚' | '写出来' | '用起来'
}

const STEPS: Step[] = [
  {
    title: '业务问题',
    detail: '先把问题写成一句能被回答的话：「哪个年龄段最活跃？」',
    stage: '想清楚',
  },
  {
    title: '确定分析对象',
    detail: '要分析的是人、是内容，还是人和内容的组合。',
    stage: '想清楚',
  },
  {
    title: '确定指标',
    detail: '活跃率、播放量、人均观看时长——指标换了，算法就换了。',
    stage: '想清楚',
  },
  {
    title: '确定维度',
    detail: '按年龄段切？按内容分区切？维度决定 GROUP BY 写什么。',
    stage: '想清楚',
  },
  {
    title: '选择数据表',
    detail: '需要哪几张表。年龄在 users，分区在 videos，行为在 video_views。',
    stage: '写出来',
  },
  {
    title: '关联与筛选',
    detail: 'JOIN 把表接起来，WHERE 圈定时间范围。',
    stage: '写出来',
  },
  {
    title: '分组',
    detail: 'GROUP BY 把数据按维度切成一组一组，一组就是一行结果。',
    stage: '写出来',
  },
  {
    title: '聚合计算',
    detail: 'COUNT / SUM / AVG 把每一组算成一个数，那就是指标。',
    stage: '写出来',
  },
  {
    title: '结果验证',
    detail: '和页面上的其他指标对一遍，确认分母口径没写错。',
    stage: '用起来',
  },
  {
    title: '业务结论',
    detail: '这个数字说明什么、下一步该做什么——到这一步 SQL 才算用完。',
    stage: '用起来',
  },
]

const STAGE_COLOR: Record<Step['stage'], string> = {
  想清楚: '#1c5cab',
  写出来: '#0e7490',
  用起来: '#475569',
}

export default function SqlFlow() {
  return (
    <div className="px-5 py-4">
      {/* 三段图例 */}
      <div className="mb-3 flex flex-wrap items-center gap-x-4 gap-y-1">
        {(['想清楚', '写出来', '用起来'] as const).map((stage) => (
          <span key={stage} className="flex items-center gap-1.5 text-[11px] text-ink-2">
            <span
              className="inline-block h-2 w-2 rounded-full"
              style={{ background: STAGE_COLOR[stage] }}
              aria-hidden="true"
            />
            {stage}
            <span className="text-ink-3">
              {stage === '想清楚' ? '第 1–4 步' : stage === '写出来' ? '第 5–8 步' : '第 9–10 步'}
            </span>
          </span>
        ))}
      </div>

      <ol className="grid grid-cols-1 gap-2 sm:grid-cols-2 lg:grid-cols-5">
        {STEPS.map((step, i) => {
          const isRowEnd = i === 4 || i === 9
          return (
            <li
              key={step.title}
              className="relative rounded-lg border border-hairline bg-plane/40 px-3 py-2.5"
            >
              <div className="flex items-center gap-1.5">
                <span
                  className="flex h-4 w-4 shrink-0 items-center justify-center rounded-full text-[10px] font-semibold tabular-nums text-white"
                  style={{ background: STAGE_COLOR[step.stage] }}
                >
                  {i + 1}
                </span>
                <span className="text-[12px] font-semibold text-ink">{step.title}</span>
              </div>
              <p className="mt-1 text-[11px] leading-relaxed text-ink-2">{step.detail}</p>

              {/* 桌面端是 5 列，行内用箭头连起来；行尾的几个不画，免得挂在半空。
                  窄屏换行后箭头的指向会失效，所以只在 lg 以上显示。 */}
              {!isRowEnd && (
                <span
                  className="absolute -right-[11px] top-1/2 hidden -translate-y-1/2 text-[12px] text-ink-3 lg:block"
                  aria-hidden="true"
                >
                  →
                </span>
              )}
            </li>
          )
        })}
      </ol>

      <p className="mt-3 text-[11.5px] leading-relaxed text-ink-2">
        这十步里，真正花时间的是前四步——把问题想清楚。第五步往后是把它翻译成语句，
        写熟了就快了。所以这一页每一张卡片都从「业务问题」开始，而不是从 SQL 开始。
      </p>
    </div>
  )
}
