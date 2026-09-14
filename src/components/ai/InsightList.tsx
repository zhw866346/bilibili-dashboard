/* ==========================================================================
   业务洞察：每条都分「数据事实 / 原因假设 / 业务建议」三段
   --------------------------------------------------------------------------
   ★ 这是整个页面最要紧的一个组件，因为它防的是一种很常见的毛病：
     把「我看到的现象」和「我猜的原因」混在一句话里，
     读者读完分不清哪句有数据撑着。

     所以每一段都强制分开、各有各的标签和底色：
       数据事实 —— 只能是本次结果里出现过的数字
       原因假设 —— 必须写明这是假设，并且要指出「这个规律是造数据时设的」
       业务建议 —— 写条件句（如果…就…），不写成断言

   ★ 三段都有最小长度要求（本机有一条断言守着），因为空话最省事也最没用。
     写不出「原因假设」的，说明这个现象还看不懂，那就不该硬编一条。

   ★ 三段的底色照抄 Python 页的 InsightRow，全站一致：
     绿 = 事实，琥珀 = 假设，蓝 = 建议。颜色只是辅助，
     左边那个文字标签才是主要区分方式——不靠颜色单独传信息。
   ========================================================================== */

import type { Insight } from '../../data/ai/types'

const TONE = {
  fact: { label: '数据事实', background: 'rgba(12,163,12,0.06)', color: '#0a7d0a' },
  guess: { label: '原因假设', background: 'rgba(237,161,0,0.10)', color: '#8a5f00' },
  action: { label: '业务建议', background: 'rgba(42,120,214,0.08)', color: '#1c5cab' },
} as const

function Row({
  tone,
  children,
}: {
  tone: keyof typeof TONE
  children: string
}) {
  const t = TONE[tone]
  return (
    <div className="flex flex-col gap-1 sm:flex-row sm:gap-2.5">
      <dt
        className="h-fit w-fit shrink-0 rounded px-2 py-0.5 text-[11px] font-semibold"
        style={{ background: t.background, color: t.color }}
      >
        {t.label}
      </dt>
      <dd className="text-[12.5px] leading-relaxed text-ink-2">{children}</dd>
    </div>
  )
}

export default function InsightList({ insights }: { insights: Insight[] }) {
  if (insights.length === 0) return null

  return (
    <div className="flex flex-col gap-3">
      {insights.map((ins) => (
        <div key={ins.title} className="rounded-lg border border-hairline bg-plane/30 px-3.5 py-3">
          <p className="mb-2 text-[12.5px] font-semibold text-ink">{ins.title}</p>
          <dl className="flex flex-col gap-2">
            <Row tone="fact">{ins.fact}</Row>
            <Row tone="guess">{ins.hypothesis}</Row>
            <Row tone="action">{ins.action}</Row>
          </dl>
        </div>
      ))}

      <p className="text-[11px] leading-relaxed text-ink-3">
        「原因假设」这一栏写的是假设，不是结论。这份数据是模拟生成的，
        里面的规律来自生成数据时设定的参数——所以能确定的是「数据里确实有这个现象」，
        不能确定的是「现实业务里也这样」。
      </p>
    </div>
  )
}
