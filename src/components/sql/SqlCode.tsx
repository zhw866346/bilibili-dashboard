/* ==========================================================================
   SQL 代码块 —— 通用代码块组件的一层薄包装
   --------------------------------------------------------------------------
   高亮、折叠、复制的实现全部搬到了 src/components/CodeBlock.tsx，
   因为 Python 分析页要用同一套东西。

   这里只保留 SQL 的默认参数，好让 SQL 分析页的调用点一行都不用改。
   ★ 渲染结果和搬家之前完全一致：SQL 的 tokenizer、关键字、配色表
     都是原样搬过去的，一个字符没改。
   ========================================================================== */

import CodeBlock from '../CodeBlock'

interface SqlCodeProps {
  sql: string
  /** 默认展开还是折叠。卡片里默认折叠，节省纵向空间。 */
  defaultExpanded?: boolean
}

export default function SqlCode({ sql, defaultExpanded = false }: SqlCodeProps) {
  return <CodeBlock code={sql} language="sql" defaultExpanded={defaultExpanded} />
}
