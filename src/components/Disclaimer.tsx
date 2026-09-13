/* 数据来源提示条。
   ★ 这个组件存在的意义：确保浏览这个作品集的任何人都不会误以为
     页面上的数字来自 B 站内部。每一页的顶部都会显示它。 */

import { dataSource } from '../data/dataset'

export default function Disclaimer() {
  return (
    <div className="flex items-start gap-2.5 rounded-lg border border-amber-200 bg-amber-50/70 px-3.5 py-2.5">
      <svg
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.8"
        strokeLinecap="round"
        strokeLinejoin="round"
        className="mt-px h-4 w-4 shrink-0 text-amber-600"
        aria-hidden="true"
      >
        <circle cx="12" cy="12" r="9" />
        <path d="M12 11v5.5" />
        <path d="M12 7.8h.01" />
      </svg>
      <p className="text-[12.5px] leading-relaxed text-amber-900">
        <span className="rounded bg-amber-200/80 px-1.5 py-px text-[11px] font-semibold text-amber-900">
          {dataSource.badge}
        </span>
        <span className="ml-2">{dataSource.note}</span>
      </p>
    </div>
  )
}
