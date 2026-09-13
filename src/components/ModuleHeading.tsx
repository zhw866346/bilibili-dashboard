/* ==========================================================================
   模块标题 —— 每个分析模块开头那一条「编号 + 标题 + 一句话说明」
   --------------------------------------------------------------------------
   SQL 分析页和 Python 分析页共用。

   ★ 为什么抽出来
     原来它是 SqlAnalysis.tsx 里的一个局部函数。Python 页也要用同样的样式，
     如果在两个页面各写一份，以后想调字号就得记得改两处——
     而"忘了改第二处"正是这个项目一直在防的那类问题。
     搬出来之后，两页的模块标题由构造保证长得一样。
   ========================================================================== */

export default function ModuleHeading({
  index,
  title,
  purpose,
}: {
  index: number
  title: string
  purpose: string
}) {
  return (
    <div className="mt-2 flex items-baseline gap-2.5 border-b border-hairline pb-2">
      <span className="flex h-5 w-5 shrink-0 translate-y-0.5 items-center justify-center rounded-md bg-ink text-[11px] font-semibold text-white">
        {index}
      </span>
      <h2 className="text-[14px] font-semibold text-ink">{title}</h2>
      <span className="text-[11.5px] text-ink-3">{purpose}</span>
    </div>
  )
}
