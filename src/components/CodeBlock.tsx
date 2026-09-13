/* ==========================================================================
   代码块（通用）—— 语法高亮 + 展开/收起 + 一键复制
   --------------------------------------------------------------------------
   这一个组件同时给 SQL 分析页和 Python 分析页用。

   ★ 关于高亮的分寸
     只给三类词上色：关键字（蓝）、分析动作（青）、字符串（棕）。其余全是默认深灰。
     为什么不做成 IDE 那样五颜六色？因为这两页要给人看的是"思路"，
     不是"我的编辑器配置"。颜色一多，读者会先看到颜色再看到逻辑，反而慢。
     蓝色主色和页面其他部分一致，不引入新的色系。

   ★ 关于默认折叠
     一段 SQL 十几行，一段 Python 几十行，卡片全摊开，页面会长到没人愿意往下翻。
     所以默认只露出前几行，要点一下才展开完整版。
     折叠时底部有一层渐变，暗示"下面还有"，而不是直接截断。

   ★ 为什么 SQL 和 Python 各写一套 tokenizer，不共用一个
     两门语言的注释符号不一样（SQL 是 --，Python 是 #），字符串规则也不一样。
     共用一套正则会出现这种情况：用 SQL 的规则去切 Python，
     一段以三引号 docstring 开头的 Python 代码会被拆成一堆引号 token，
     整个高亮全乱。
     两套各写十几行，比硬凑一套要短，也更不容易错。
   ========================================================================== */

import { useMemo, useState, type CSSProperties } from 'react'

/** 默认折叠状态下显示几行 */
const DEFAULT_COLLAPSED_LINES = 5

export type CodeLanguage = 'sql' | 'python'

/* ==========================================================================
   一、SQL 的 tokenizer
   --------------------------------------------------------------------------
   ★ 这一段是从原来的 SqlCode.tsx 原样搬过来的，一个字符没改。
     SQL 分析页的渲染结果因此由构造保证不变，不需要肉眼比对。
   ========================================================================== */

/* 把 SQL 拆成一个个词。注意：这几个正则写成了普通字面量，不是模板字符串，
   免得反斜杠在模板里被吃掉（上一版踩过这个坑）。 */
const SQL_TOKEN_RE = /(--[^\n]*)|('(?:[^']|'')*')|(\b\d+(?:\.\d+)?\b)|([A-Za-z_][A-Za-z0-9_]*)|(\s+)|([^\sA-Za-z0-9_])/g

/** SQL 关键字。用于决定"这个词要高亮成蓝色" */
const SQL_KEYWORDS = new Set([
  'SELECT', 'FROM', 'WHERE', 'GROUP', 'BY', 'ORDER', 'HAVING', 'LIMIT',
  'JOIN', 'LEFT', 'RIGHT', 'INNER', 'OUTER', 'CROSS', 'ON', 'AS', 'AND',
  'OR', 'NOT', 'IN', 'BETWEEN', 'LIKE', 'IS', 'NULL', 'CASE', 'WHEN',
  'THEN', 'ELSE', 'END', 'DISTINCT', 'DESC', 'ASC', 'UNION', 'ALL',
  'CREATE', 'TABLE', 'PRIMARY', 'KEY', 'TEXT', 'INTEGER', 'REAL',
  // 窗口函数相关的关键字。少了这三个词，OVER (PARTITION BY ...) 整段会是灰的
  'WITH', 'OVER', 'PARTITION',
])

/** 聚合函数。单独一色，因为它们在这份作品里是"分析动作"本身 */
const SQL_FUNCTIONS = new Set([
  'COUNT', 'SUM', 'AVG', 'MIN', 'MAX',
  // 窗口函数。和聚合函数一样都是"分析动作"，所以共用同一种颜色
  'ROW_NUMBER', 'RANK', 'DENSE_RANK', 'LAG', 'LEAD',
])

/* ==========================================================================
   二、Python 的 tokenizer
   --------------------------------------------------------------------------
   和 SQL 那套的取舍不一样：

   · 注释是 #，一直管到行尾。
   · 字符串有四种：三引号（可跨行）、单引号、双引号，以及带前缀的 f"" / r""。
     顺序不能乱：三引号必须写在单引号前面，否则 """abc""" 会先被
     单引号规则吃掉两个引号，剩下的就对不上。
   · 变量名 / 函数名一律不上色。Python 代码里标识符占了大半，
     给它们上色等于整段都是彩的，反而看不出重点。
   · "分析动作"那一色只给 Pandas 里的动词（groupby / agg / merge / qcut …）。
     这些词才是这一页真正想让读者看见的东西 —— 和 SQL 那边把
     COUNT / SUM / ROW_NUMBER 单独标出来是同一个道理。
   ========================================================================== */

/* 用普通字面量，不用模板字符串 —— 反斜杠在模板里会被吃掉。 */
const PY_TOKEN_RE = /(#[^\n]*)|("""[\s\S]*?"""|'''[\s\S]*?''')|([rbfuRBFU]{0,2}"(?:[^"\\\n]|\\.)*")|([rbfuRBFU]{0,2}'(?:[^'\\\n]|\\.)*')|(\b\d+(?:\.\d+)?\b)|([A-Za-z_][A-Za-z0-9_]*)|(\s+)|([^\sA-Za-z0-9_])/g

/** Python 关键字。只收真正影响阅读节奏的那些，不追求收全。 */
const PY_KEYWORDS = new Set([
  'def', 'return', 'for', 'while', 'in', 'if', 'elif', 'else', 'and', 'or',
  'not', 'is', 'None', 'True', 'False', 'import', 'from', 'as', 'with',
  'try', 'except', 'finally', 'raise', 'class', 'lambda', 'break',
  'continue', 'pass', 'yield', 'assert', 'del', 'global', 'nonlocal',
  'async', 'await',
])

/**
 * Pandas / NumPy 里的"分析动作"。
 *
 * ★ 这份名单是**手动挑的**，不是把所有 Pandas 方法都收进来。
 *   挑的标准是：这个词一出现，读者就知道"这里在做一步分析"。
 *   像 round / int / len 这种，虽然也是函数，但它们是纯粹的机械操作，
 *   标出来只是噪音。
 */
const PY_ACTIONS = new Set([
  'groupby', 'agg', 'merge', 'join', 'concat', 'pivot_table', 'crosstab',
  'qcut', 'cut', 'rolling', 'corr', 'nunique', 'drop_duplicates',
  'pct_change', 'shift', 'value_counts', 'isna', 'notna', 'duplicated',
  'astype', 'to_datetime', 'reindex', 'rename', 'reset_index',
  'sort_values', 'head', 'tail', 'describe', 'info', 'fillna', 'apply',
  'map', 'sum', 'mean', 'median', 'max', 'min', 'std', 'count', 'size',
  'unique', 'isin', 'where', 'select_dtypes', 'read_csv', 'set_index',
])

/* ==========================================================================
   三、通用的 token 结构与配色
   ========================================================================== */

type TokenKind = 'comment' | 'string' | 'keyword' | 'action' | 'plain'

interface Token {
  text: string
  kind: TokenKind
}

/** 每种词的样式。颜色克制：只有蓝、青、棕三色，加一个灰注释。 */
const KIND_CLASS: Record<TokenKind, string> = {
  comment: 'italic',
  string: '',
  keyword: 'font-semibold',
  action: 'font-semibold',
  plain: '',
}

const KIND_STYLE: Record<TokenKind, CSSProperties | undefined> = {
  comment: { color: '#94a3b8' },
  string: { color: '#9a3412' },
  keyword: { color: '#1c5cab' },
  action: { color: '#0e7490' },
  plain: undefined,
}

function tokenizeSql(sql: string): Token[] {
  const out: Token[] = []
  // 每次 tokenize 都要把 lastIndex 归零，否则第二次调用会从中间开始
  SQL_TOKEN_RE.lastIndex = 0

  let match: RegExpExecArray | null
  let last = 0
  while ((match = SQL_TOKEN_RE.exec(sql)) !== null) {
    // 正则没覆盖到的字符（正常情况下不会有）原样保留，不出错
    if (match.index > last) {
      out.push({ text: sql.slice(last, match.index), kind: 'plain' })
    }
    last = match.index + match[0].length

    const [full, comment, str, num, word] = match
    if (comment !== undefined) out.push({ text: full, kind: 'comment' })
    else if (str !== undefined) out.push({ text: full, kind: 'string' })
    else if (num !== undefined) out.push({ text: full, kind: 'plain' })
    else if (word !== undefined) {
      const upper = word.toUpperCase()
      if (SQL_FUNCTIONS.has(upper)) out.push({ text: full, kind: 'action' })
      else if (SQL_KEYWORDS.has(upper)) out.push({ text: full, kind: 'keyword' })
      else out.push({ text: full, kind: 'plain' })
    } else out.push({ text: full, kind: 'plain' })
  }
  if (last < sql.length) out.push({ text: sql.slice(last), kind: 'plain' })

  return out
}

function tokenizePython(code: string): Token[] {
  const out: Token[] = []
  PY_TOKEN_RE.lastIndex = 0

  let match: RegExpExecArray | null
  let last = 0
  while ((match = PY_TOKEN_RE.exec(code)) !== null) {
    if (match.index > last) {
      out.push({ text: code.slice(last, match.index), kind: 'plain' })
    }
    last = match.index + match[0].length

    const [full, comment, triple, dquote, squote, num, word] = match
    if (comment !== undefined) out.push({ text: full, kind: 'comment' })
    else if (triple !== undefined) out.push({ text: full, kind: 'string' })
    else if (dquote !== undefined) out.push({ text: full, kind: 'string' })
    else if (squote !== undefined) out.push({ text: full, kind: 'string' })
    else if (num !== undefined) out.push({ text: full, kind: 'plain' })
    else if (word !== undefined) {
      if (PY_KEYWORDS.has(word)) out.push({ text: full, kind: 'keyword' })
      else if (PY_ACTIONS.has(word)) out.push({ text: full, kind: 'action' })
      else out.push({ text: full, kind: 'plain' })
    } else out.push({ text: full, kind: 'plain' })
  }
  if (last < code.length) out.push({ text: code.slice(last), kind: 'plain' })

  return out
}

/** 按语言选一套 tokenizer */
function tokenize(code: string, language: CodeLanguage): Token[] {
  return language === 'sql' ? tokenizeSql(code) : tokenizePython(code)
}

/* ==========================================================================
   四、组件本体
   ========================================================================== */

interface CodeBlockProps {
  code: string
  language: CodeLanguage
  /** 默认展开还是折叠。卡片里默认折叠，节省纵向空间。 */
  defaultExpanded?: boolean
  /** 折叠时露出几行。Python 片段偏长，可以调大一点。 */
  collapsedLines?: number
  /** 工具栏左侧的标签。不传就按语言取（SQL / Python）。 */
  label?: string
}

export default function CodeBlock({
  code,
  language,
  defaultExpanded = false,
  collapsedLines = DEFAULT_COLLAPSED_LINES,
  label,
}: CodeBlockProps) {
  const [expanded, setExpanded] = useState(defaultExpanded)
  /* 三种状态而不是简单的 true/false：
     复制失败时必须让用户看见"失败了"，而不是按钮悄无声息地变回去、
     让人以为复制成功了。 */
  const [copyState, setCopyState] = useState<'idle' | 'ok' | 'fail'>('idle')

  const noun = label ?? (language === 'sql' ? 'SQL' : 'Python')

  const lineCount = useMemo(() => code.split('\n').length, [code])

  // 折叠时只取前几行，再做高亮。这样高亮和折叠互不干扰。
  const shownText = useMemo(() => {
    if (expanded) return code
    const lines = code.split('\n')
    return lines.length <= collapsedLines ? code : lines.slice(0, collapsedLines).join('\n')
  }, [code, expanded, collapsedLines])

  const tokens = useMemo(() => tokenize(shownText, language), [shownText, language])

  const truncated = !expanded && lineCount > collapsedLines

  /* 复制。优先用浏览器标准的剪贴板接口；
     万一所在环境不允许（比如某些浏览器策略），退回老的选中复制方式，
     保证"复制"这个按钮在任何情况下都能用。 */
  async function copy() {
    const ok = await writeClipboard(code)
    setCopyState(ok ? 'ok' : 'fail')
    window.setTimeout(() => setCopyState('idle'), 1600)
  }

  return (
    <div className="relative min-w-0 overflow-hidden rounded-lg border border-hairline bg-plane/60">
      {/* 工具栏 */}
      <div className="flex items-center justify-between gap-2 border-b border-hairline px-3 py-1.5">
        <span className="text-[11px] font-medium text-ink-3">
          {noun}
          <span className="ml-2 tabular-nums">{lineCount} 行</span>
        </span>
        <button
          type="button"
          onClick={copy}
          className={
            'rounded-md border border-hairline bg-card px-2 py-0.5 text-[11px] font-medium transition-colors ' +
            (copyState === 'fail'
              ? 'text-[#d03b3b]'
              : 'text-ink-2 hover:border-ink-3 hover:text-ink')
          }
        >
          {copyState === 'ok' ? '已复制' : copyState === 'fail' ? '复制失败' : '复制'}
        </button>
      </div>

      {/* 代码本体 */}
      <div className="relative">
        <pre className="overflow-x-auto px-3 py-2.5 text-[11.5px] leading-[1.75]">
          <code className="font-mono">
            {tokens.map((t, i) => (
              <span key={i} className={KIND_CLASS[t.kind]} style={KIND_STYLE[t.kind]}>
                {t.text}
              </span>
            ))}
          </code>
        </pre>

        {/* 折叠时底部压一层渐变，暗示"下面还有"，而不是让人以为代码就这么几行 */}
        {truncated && (
          <div
            className="pointer-events-none absolute inset-x-0 bottom-0 h-8"
            style={{ background: 'linear-gradient(to bottom, rgba(246,247,249,0), #f6f7f9)' }}
            aria-hidden="true"
          />
        )}
      </div>

      {/* 展开 / 收起 */}
      {lineCount > collapsedLines && (
        <div className="border-t border-hairline px-3 py-1.5 text-center">
          <button
            type="button"
            onClick={() => setExpanded((v) => !v)}
            className="text-[11.5px] font-medium text-ink-2 transition-colors hover:text-ink"
          >
            {expanded ? `收起 ${noun}` : `查看完整 ${noun}（共 ${lineCount} 行）`}
          </button>
        </div>
      )}
    </div>
  )
}

/** 写剪贴板。返回是否成功。 */
async function writeClipboard(text: string): Promise<boolean> {
  try {
    if (navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(text)
      return true
    }
  } catch {
    // 落到下面的兜底
  }

  try {
    const area = document.createElement('textarea')
    area.value = text
    area.setAttribute('readonly', '')
    area.style.position = 'fixed'
    area.style.top = '-1000px'
    document.body.appendChild(area)
    area.select()
    const ok = document.execCommand('copy')
    document.body.removeChild(area)
    return ok
  } catch {
    return false
  }
}
