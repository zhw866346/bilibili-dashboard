/* ==========================================================================
   推荐策略模拟（模块 7）
   --------------------------------------------------------------------------
   前面六个模块是在"看数据"，这一个是在"用数据"：
   选一个年龄段，看看如果只能给这个人群推 3 个内容分区，应该推哪 3 个。

   排序规则（写在 selectors 的 getAgeStrategy 里）：
     先按【偏好占比】排——这个人群的注意力实际花在哪；
     占比接近时再看【人均观看时长】——避免把"点开就走"的分区推上去。

   ★ 为什么理由必须由数据算出来，不能写死？
     "年轻人喜欢游戏"这种话谁都会说，而且这套模拟数据里未必成立。
     每一条理由都是拿这个年龄段的真实占比、真实停留时长、真实覆盖率
     和"其余分区的平均水平"比出来的。如果数据不支持某个结论，就照实说没有，
     界面上不会出现一句和数字对不上的话。
   ========================================================================== */

import { useMemo } from 'react'

import { getAgeStrategy } from '../data/selectors'
import { categoryColor } from '../theme'
import { AGE_GROUPS } from '../utils/ageGroup'
import type { AgeGroupId } from '../types'
import { formatCount, formatPercent } from '../utils/format'

export default function UserContentStrategy({
  days,
  age,
  onAgeChange,
}: {
  days: number
  age: AgeGroupId
  onAgeChange: (age: AgeGroupId) => void
}) {
  const strategy = useMemo(() => getAgeStrategy(days, age), [days, age])

  return (
    <div>
      {/* ---------- 年龄段选择 ---------- */}
      <div className="flex flex-wrap items-center gap-x-3 gap-y-2 px-2">
        <label
          htmlFor="strategy-age"
          className="text-[12px] font-medium text-ink-2"
        >
          给哪个年龄段做推荐
        </label>
        <select
          id="strategy-age"
          value={age}
          onChange={(e) => onAgeChange(e.target.value as AgeGroupId)}
          className="rounded-lg border border-hairline bg-card px-2.5 py-1.5 text-[12px] font-medium text-ink outline-none focus:border-brand"
        >
          {AGE_GROUPS.map((g) => (
            <option key={g.id} value={g.id}>
              {g.label}
            </option>
          ))}
        </select>
        <span className="text-[11.5px] text-ink-3">
          换一个年龄段，下面三个推荐位和理由会按它自己的数据重算
        </span>
      </div>

      {/* ---------- 三个推荐位 ---------- */}
      <div className="mt-3 grid grid-cols-1 gap-3 px-2 sm:grid-cols-3">
        {strategy.top.map((t) => (
          <div
            key={t.category}
            className="rounded-lg border border-hairline bg-plane/40 px-3.5 py-3"
          >
            <div className="flex items-center gap-2">
              <span className="flex h-5 w-5 items-center justify-center rounded-full bg-ink text-[11px] font-semibold text-white">
                {t.rank}
              </span>
              <span
                className="h-2.5 w-2.5 shrink-0 rounded-full"
                style={{ background: categoryColor(t.slot) }}
                aria-hidden="true"
              />
              <span className="text-[13px] font-semibold text-ink">{t.category}</span>
            </div>

            <dl className="mt-2.5 space-y-1 text-[11.5px]">
              <div className="flex items-center justify-between gap-3">
                <dt className="text-ink-3">偏好占比</dt>
                <dd className="tabular-nums font-medium text-ink">
                  {formatPercent(t.preferShare)}
                </dd>
              </div>
              <div className="flex items-center justify-between gap-3">
                <dt className="text-ink-3">人均观看时长</dt>
                <dd className="tabular-nums font-medium text-ink">
                  {t.minutesPerViewer.toFixed(1)} 分钟
                </dd>
              </div>
              <div className="flex items-center justify-between gap-3">
                <dt className="text-ink-3">综合互动率</dt>
                <dd className="tabular-nums font-medium text-ink">
                  {formatPercent(t.engageRate)}
                </dd>
              </div>
              <div className="flex items-center justify-between gap-3">
                <dt className="text-ink-3">该人群覆盖率</dt>
                <dd className="tabular-nums font-medium text-ink">
                  {formatPercent(t.coverageRate)}
                </dd>
              </div>
              <div className="flex items-center justify-between gap-3">
                <dt className="text-ink-3">覆盖人数</dt>
                <dd className="tabular-nums font-medium text-ink">
                  {formatCount(t.viewers)} 人
                </dd>
              </div>
            </dl>
          </div>
        ))}
      </div>

      {/* ---------- 理由 ---------- */}
      <div className="mt-3.5 border-t border-hairline px-2 pt-3">
        <p className="text-[11.5px] font-semibold text-ink-2">
          为什么推这三个 · {strategy.ageLabel}
        </p>
        <ul className="mt-1.5 space-y-1.5">
          {strategy.reasons.map((r) => (
            <li key={r} className="flex gap-2 text-[11.5px] leading-relaxed text-ink-2">
              <span className="mt-[3px] h-1 w-1 shrink-0 rounded-full bg-ink-3" aria-hidden="true" />
              <span>{r}</span>
            </li>
          ))}
        </ul>
      </div>
    </div>
  )
}
