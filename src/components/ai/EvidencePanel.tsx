/* ==========================================================================
   核心结论 + 数据依据
   --------------------------------------------------------------------------
   ★ 为什么结论只给一句，后面却要摆这么多数字？
     因为「一句话结论」和「这个结论凭什么成立」是两件事，
     读者信任后者，不信任前者。所以结论单独一行加粗，
     下面紧接着把每个数字的当前值、对比值、变化率、样本口径全摆出来。

   ★ 变化率为空时【不显示】那一格，而不是显示 0 或者横线。
     0% 的意思是「算出来等于 0」，空的意思是「算不出来」——
     「上一周期是 0，环比无意义」属于后者。这两个意思混在一起就会误导人。
   ========================================================================== */

import type { EvidenceItem } from '../../data/ai/types'

export default function EvidencePanel({
  verdict,
  items,
}: {
  verdict: string
  items: EvidenceItem[]
}) {
  return (
    <div className="flex flex-col gap-3">
      {/* ---- 核心结论 ---- */}
      <div className="rounded-lg border border-hairline bg-plane/50 px-3.5 py-3">
        <p className="text-[11px] font-semibold text-ink-3">核心结论</p>
        <p className="mt-1 text-[13px] leading-relaxed font-medium text-ink">{verdict}</p>
      </div>

      {/* ---- 数据依据 ---- */}
      <div>
        <p className="mb-1.5 text-[11px] font-semibold text-ink-3">数据依据</p>
        <div className="overflow-hidden rounded-lg border border-hairline">
          <table className="w-full border-collapse text-[12px]">
            <thead>
              <tr className="bg-plane/70 text-[11px] text-ink-3">
                <th className="px-3 py-1.5 text-left font-medium">指标</th>
                <th className="px-3 py-1.5 text-right font-medium">当前值</th>
                <th className="px-3 py-1.5 text-right font-medium">对比值</th>
                <th className="px-3 py-1.5 text-right font-medium">变化率</th>
              </tr>
            </thead>
            <tbody>
              {items.map((it) => (
                <tr key={it.label} className="border-t border-hairline align-top">
                  <td className="px-3 py-2">
                    <span className="text-ink">{it.label}</span>
                    {it.sample && (
                      <span className="mt-0.5 block text-[11px] leading-relaxed text-ink-3">
                        口径：{it.sample}
                      </span>
                    )}
                  </td>
                  <td className="px-3 py-2 text-right font-semibold text-ink tabular">
                    {it.value}
                  </td>
                  <td className="px-3 py-2 text-right text-ink-2 tabular">
                    {it.compare ?? '—'}
                  </td>
                  <td
                    className="px-3 py-2 text-right font-medium tabular"
                    style={
                      it.delta === undefined
                        ? { color: '#94a3b8' }
                        : it.delta.startsWith('-')
                          ? { color: '#d03b3b' }
                          : { color: '#0ca30c' }
                    }
                  >
                    {it.delta ?? '—'}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <p className="mt-1.5 text-[11px] leading-relaxed text-ink-3">
          变化率为「—」表示上一周期没有可比数据（分母为 0），算不出环比——
          这和「算出来等于 0」是两回事，所以不写成 0%。
        </p>
      </div>
    </div>
  )
}
