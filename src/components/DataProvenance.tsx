/* ==========================================================================
   「这份数据是怎么来的」说明块
   --------------------------------------------------------------------------
   放在分析页的最下面，回答一个读者迟早会问的问题：
   **这些数字，我该信到什么程度？**

   拆成两件事说：
     1. 数字本身 —— 是算出来的，可信、可核对、可复现；
     2. 数据本身 —— 是模拟的，里面的"规律"来自作者设定的构造参数。

   这两件事经常被混为一谈。一份模拟数据如果算得严丝合缝，
   看上去和真实分析毫无区别，读者就会把"我构造的假设"误读成"真实世界的发现"。
   这个块存在的唯一目的，就是把这个误会挡在前面。
   ========================================================================== */

import { CONSTRUCTION_PARAMS, HONESTY_STATEMENT } from '../data/dataset'

export default function DataProvenance() {
  return (
    <section className="rounded-xl border border-hairline bg-card">
      <header className="flex flex-wrap items-center gap-x-2.5 gap-y-1 border-b border-hairline px-5 py-3.5">
        <h3 className="text-[13px] font-semibold text-ink">这份数据是怎么来的</h3>
        <span className="rounded bg-amber-100 px-1.5 py-px text-[10.5px] font-semibold text-amber-800">
          请务必读完
        </span>
      </header>

      <div className="px-5 py-4">
        {/* 三句话讲清楚：什么是真的、什么是设定的、所以说明了什么 */}
        <ul className="space-y-2.5 text-[12.5px] leading-relaxed">
          <li className="flex gap-2.5">
            <span className="mt-[7px] h-1.5 w-1.5 shrink-0 rounded-full bg-[#0ca30c]" aria-hidden="true" />
            <span className="text-ink-2">
              <span className="font-semibold text-ink">数字是算出来的。</span>
              {HONESTY_STATEMENT.whatIsReal}
            </span>
          </li>
          <li className="flex gap-2.5">
            <span className="mt-[7px] h-1.5 w-1.5 shrink-0 rounded-full bg-[#eda100]" aria-hidden="true" />
            <span className="text-ink-2">
              <span className="font-semibold text-ink">但数据是模拟的。</span>
              {HONESTY_STATEMENT.whatIsConstructed}
            </span>
          </li>
          <li className="flex gap-2.5">
            <span className="mt-[7px] h-1.5 w-1.5 shrink-0 rounded-full bg-[#2a78d6]" aria-hidden="true" />
            <span className="text-ink-2">
              <span className="font-semibold text-ink">所以它证明了什么。</span>
              {HONESTY_STATEMENT.therefore}
            </span>
          </li>
        </ul>

        {/* 参数对照表：左边是页面上的差异，右边是作者拧的那个旋钮 */}
        <div className="mt-4 rounded-lg border border-hairline">
          <div className="border-b border-hairline bg-plane px-3.5 py-2">
            <p className="text-[11.5px] font-semibold text-ink-2">
              对照表：页面上的每条「规律」，对应的都是我设的一个参数
            </p>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full min-w-[520px] border-collapse text-[11.5px]">
              <thead>
                <tr className="border-b border-hairline/70">
                  <th scope="col" className="px-3.5 py-2 text-left font-semibold text-ink-2">
                    页面上的差异
                  </th>
                  <th scope="col" className="px-3.5 py-2 text-left font-semibold text-ink-2">
                    代码里的参数
                  </th>
                  <th scope="col" className="px-3.5 py-2 text-left font-semibold text-ink-2">
                    我设的值
                  </th>
                </tr>
              </thead>
              <tbody>
                {CONSTRUCTION_PARAMS.map((p) => (
                  <tr key={p.param} className="border-b border-hairline/60 last:border-b-0">
                    <td className="px-3.5 py-2 align-top text-ink">{p.effect}</td>
                    <td className="px-3.5 py-2 align-top">
                      <span className="font-mono text-[11px] text-ink-2">{p.param}</span>
                      <span className="mt-0.5 block text-[11px] text-ink-3">{p.meaning}</span>
                    </td>
                    <td className="px-3.5 py-2 align-top tabular-nums text-ink-2">{p.values}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>

        <p className="mt-3 text-[11.5px] leading-relaxed text-ink-3">
          换句话说：如果你看到「年轻人更活跃」这样的说法，正确的理解是
          <span className="font-medium text-ink-2">
            「我构造数据时把年轻人的活跃概率设得更高，数据如实反映了这个设定」
          </span>
          ，而不是「B 站用户就是这样」。真实业务中这些数字需要真实数据来验证——
          本项目要展示的，是从明细到指标的这条计算链路本身。
        </p>
      </div>
    </section>
  )
}
