/* ==========================================================================
   SQL 安全校验器
   --------------------------------------------------------------------------
   ★ 为什么这个文件非有不可（不是「加了更稳妥」，是「没有它就是坏的」）：

     本项目的 SQL 引擎走的是 src/data/sql/engine.ts 里的 `db.exec(sql)`，
     而 sql.js 的 exec()【会执行 SQL 文本里的每一条语句】，只把【第一个】结果集
     返回给调用方。所以：

         SELECT 1; DROP TABLE video_views;

     会真的把表删掉，返回的却是 `SELECT 1` 的结果 —— 页面显示一切正常、
     不抛异常、控制台一声不响。而且数据库是会话级单例，后续所有分析
     全部静默变错。这是这个项目里最危险的一条路径。

   ★ 为什么是「状态机扫描器」而不是「先把注释删掉再 grep」：
     后者会让 grep 看到的字符串和 SQLite 看到的字符串变成两份 ——
     两份一旦分叉，就是「校验器说没问题、SQLite 照样删表」。
     扫描器是【一边扫一边吐 token】，token 流和 SQLite 的解析器看到的是同一批东西。

   ★ 为什么禁用词必须查【任意位置】，而不是只看开头：
     SQLite 允许在 CTE 里写数据修改语句：

         WITH x AS (DELETE FROM video_views RETURNING *) SELECT * FROM x;

     首 token 是 WITH，只看开头会整个放行。而这恰好长得最像正常的 CTE ——
     本项目自己的 SQL 就大量用 WITH。
   ========================================================================== */

/** 校验通过的产物 */
export interface SqlAllowed {
  ok: true
  /** 规范化之后可以直接执行的 SQL（已经剥掉尾部那一个分号） */
  sql: string
}

/** 被拒绝。message 是【给大模型看的】中文说明 —— 它据此改写重试。 */
export interface SqlDenied {
  ok: false
  code:
    | 'EMPTY'
    | 'TOO_LONG'
    | 'UNBALANCED'
    | 'NOT_SELECT'
    | 'MULTI_STATEMENT'
    | 'FORBIDDEN_KEYWORD'
  message: string
  /** 命中的具体东西，方便模型定位（哪个词、哪个位置） */
  detail?: string
}

export type SqlGuardResult = SqlAllowed | SqlDenied

/** SQL 文本长度上限。本项目最长的案例 SQL 也只有一千多字符。 */
const MAX_SQL_LENGTH = 4000

/**
 * 禁止出现的词。
 *
 * ★ 这是「宁可错杀」的选择，代价如实写在这里：
 *   任何叫 update / delete / analyze 之类的**列名或表名**都会连带被拒。
 *   本项目 4 张表没有这种列名，所以实际代价是 0。
 *   反过来，放过一次是不可逆的（表真被删了）。
 *   模型收到拒绝理由会自己改写 —— 错杀的成本是「多一轮对话」，
 *   放过的成本是「数据全没了」。这两个成本不对等。
 */
const FORBIDDEN = [
  // 写入
  // ★ INTO 本身不是写操作，但【任何合法的只读查询都用不到它】——
  //   它只出现在 INSERT INTO / REPLACE INTO 里。禁掉它是为了堵住
  //   「INSERT 被某种写法拆开、而 INTO 还在」的情形，成本是 0。
  'INSERT', 'INTO', 'UPDATE', 'DELETE', 'REPLACE', 'UPSERT', 'RETURNING',
  // 结构
  'CREATE', 'DROP', 'ALTER', 'TRUNCATE',
  // 挂载 / 外部文件（这一条最容易被忽略：ATTACH 能把任意路径当库打开）
  'ATTACH', 'DETACH', 'LOAD_EXTENSION',
  // 事务与维护（会污染会话级单例的状态）
  'BEGIN', 'COMMIT', 'ROLLBACK', 'SAVEPOINT', 'RELEASE',
  'PRAGMA', 'VACUUM', 'REINDEX', 'ANALYZE',
  // 权限
  'GRANT', 'REVOKE',
]

const FORBIDDEN_SET = new Set(FORBIDDEN)

/** 扫描结果 */
interface ScanResult {
  /** 扫描出来的 token（已经去掉字符串和注释里的内容） */
  tokens: string[]
  /**
   * 「有效代码」的字符数组：字符串、注释、空白全部换成空格，位置保持不变。
   * 分号计数和「最后一个有效字符」都在这上面数 —— 于是
   * `WHERE name = 'a;b'` 里的分号天然不算数。
   */
  effective: string[]
  /** 扫到结尾还在引号/注释里 */
  unterminated: 'quote' | 'comment' | null
}

/**
 * 状态机扫描。
 *
 * 跳过的四种引号 + 两种注释，是 SQLite 实际支持的全部形态：
 *   '...'  字符串，'' 表示一个真的单引号
 *   "..."  标识符，"" 同理
 *   `...`  MySQL 风格的标识符，`` 同理
 *   [...]  MS 风格的标识符（SQLite 为兼容保留了它），没有转义写法，遇到 ] 就结束
 *   --     行注释，到行尾
 *   / * * /  块注释，★ SQLite 里【不嵌套】，所以遇到第一个星号斜杠就结束
 *
 * ★ 最后一条最容易写错：如果按「可嵌套」实现，那么形如
 *     SELECT 1 [开注释] [再开一层] [关一层] DROP TABLE x [关一层]
 *   的 SQL 里，扫描器会认为 DROP 还在注释里，而 SQLite 认为注释到【第一个】
 *   关闭记号就结束了、DROP TABLE x 是真代码。
 *   于是校验器放行、SQLite 删表。所以必须和 SQLite 一样【不嵌套】。
 *   （写这段注释本身也踩了同一个坑：在块注释里写出关闭记号会提前结束注释。）
 */
function scan(sql: string): ScanResult {
  const tokens: string[] = []
  const effective = sql.split('')
  let unterminated: 'quote' | 'comment' | null = null

  let i = 0
  let word = ''

  const flushWord = () => {
    if (word) {
      tokens.push(word)
      word = ''
    }
  }

  while (i < sql.length) {
    const c = sql[i]
    const next = sql[i + 1]

    /* ---- 行注释 ---- */
    if (c === '-' && next === '-') {
      // ★ 必须先把手上的单词切断：注释在 SQLite 里是一个【分隔符】，
      //   不是「透明的东西」。漏了这一句，`DELETE/**/FROM t` 会被拼成
      //   一个词 DELETEFROM，不在禁用表里 → 放行 → 表真的被清空。
      //   这个洞是被攻击样本表逮住的，不是看代码看出来的。
      flushWord()
      while (i < sql.length && sql[i] !== '\n') {
        effective[i] = ' '
        i++
      }
      continue
    }

    /* ---- 块注释（不嵌套） ---- */
    if (c === '/' && next === '*') {
      // ★ 同上：注释是分隔符，先切断单词。
      flushWord()
      effective[i] = ' '
      effective[i + 1] = ' '
      i += 2
      let closed = false
      while (i < sql.length) {
        if (sql[i] === '*' && sql[i + 1] === '/') {
          effective[i] = ' '
          effective[i + 1] = ' '
          i += 2
          closed = true
          break
        }
        effective[i] = ' '
        i++
      }
      if (!closed) unterminated = 'comment'
      continue
    }

    /* ---- 单引号字符串（'' 转义） ---- */
    if (c === "'") {
      flushWord()
      effective[i] = ' '
      i++
      let closed = false
      while (i < sql.length) {
        if (sql[i] === "'" && sql[i + 1] === "'") {
          effective[i] = ' '
          effective[i + 1] = ' '
          i += 2
          continue
        }
        if (sql[i] === "'") {
          effective[i] = ' '
          i++
          closed = true
          break
        }
        effective[i] = ' '
        i++
      }
      if (!closed) unterminated = 'quote'
      continue
    }

    /* ---- 双引号（"" 转义） ---- */
    if (c === '"') {
      flushWord()
      effective[i] = ' '
      i++
      let closed = false
      while (i < sql.length) {
        if (sql[i] === '"' && sql[i + 1] === '"') {
          effective[i] = ' '
          effective[i + 1] = ' '
          i += 2
          continue
        }
        if (sql[i] === '"') {
          effective[i] = ' '
          i++
          closed = true
          break
        }
        effective[i] = ' '
        i++
      }
      if (!closed) unterminated = 'quote'
      continue
    }

    /* ---- 反引号（`` 转义） ---- */
    if (c === '`') {
      flushWord()
      effective[i] = ' '
      i++
      let closed = false
      while (i < sql.length) {
        if (sql[i] === '`' && sql[i + 1] === '`') {
          effective[i] = ' '
          effective[i + 1] = ' '
          i += 2
          continue
        }
        if (sql[i] === '`') {
          effective[i] = ' '
          i++
          closed = true
          break
        }
        effective[i] = ' '
        i++
      }
      if (!closed) unterminated = 'quote'
      continue
    }

    /* ---- 方括号标识符（无转义，遇到 ] 结束） ---- */
    if (c === '[') {
      flushWord()
      effective[i] = ' '
      i++
      let closed = false
      while (i < sql.length) {
        if (sql[i] === ']') {
          effective[i] = ' '
          i++
          closed = true
          break
        }
        effective[i] = ' '
        i++
      }
      if (!closed) unterminated = 'quote'
      continue
    }

    /* ---- 普通字符：攒 token ---- */
    if (/[A-Za-z0-9_$]/.test(c)) {
      word += c
      i++
      continue
    }

    flushWord()
    i++
  }

  flushWord()
  return { tokens, effective, unterminated }
}

/**
 * 校验一条 SQL。纯函数 —— 所以本机检查能直接拿一张攻击样本表逐条打它。
 */
export function guardSql(raw: unknown): SqlGuardResult {
  if (typeof raw !== 'string') {
    return { ok: false, code: 'EMPTY', message: '没有拿到 SQL 文本。' }
  }

  const sql = raw.trim()
  if (!sql) {
    return { ok: false, code: 'EMPTY', message: 'SQL 是空的。' }
  }
  if (sql.length > MAX_SQL_LENGTH) {
    return {
      ok: false,
      code: 'TOO_LONG',
      message: `SQL 太长了（${sql.length} 字符，上限 ${MAX_SQL_LENGTH}）。请写得短一些，把结果聚合到几十行以内。`,
    }
  }

  const { tokens, effective, unterminated } = scan(sql)

  if (unterminated) {
    return {
      ok: false,
      code: 'UNBALANCED',
      message:
        unterminated === 'quote'
          ? 'SQL 里的引号没有闭合（有一个引号打开之后一直没关上）。请检查单引号 / 双引号是否成对。'
          : 'SQL 里的块注释没有闭合（/* 之后一直没有 */）。',
    }
  }

  /* ---- 分号：最多一个，而且必须是最后一个有效字符 ---- */
  const semicolons: number[] = []
  for (let i = 0; i < effective.length; i++) {
    if (effective[i] === ';') semicolons.push(i)
  }
  let lastSig = -1
  for (let i = 0; i < effective.length; i++) {
    if (effective[i] !== ' ' && effective[i] !== '\n' && effective[i] !== '\t' && effective[i] !== '\r') {
      lastSig = i
    }
  }

  let body = sql
  if (semicolons.length > 0) {
    const isTrailingOnly = semicolons.length === 1 && semicolons[0] === lastSig
    if (!isTrailingOnly) {
      return {
        ok: false,
        code: 'MULTI_STATEMENT',
        message: `只允许一条 SQL 语句。现在检测到 ${semicolons.length} 个分号${
          semicolons.length === 1 ? '，而且它不在末尾' : ''
        }。请合并成一条，或者分几次调用。`,
      }
    }
    // 剥掉末尾那一个分号
    body = (sql.slice(0, semicolons[0]) + sql.slice(semicolons[0] + 1)).trim()
  }

  /* ---- 禁用词：任意位置 ---- */
  for (const t of tokens) {
    const up = t.toUpperCase()
    if (FORBIDDEN_SET.has(up)) {
      return {
        ok: false,
        code: 'FORBIDDEN_KEYWORD',
        message:
          `SQL 里出现了禁止使用的词「${up}」。本次分析只允许只读查询，` +
          `INSERT / UPDATE / DELETE / DROP / ALTER / CREATE / ATTACH / PRAGMA ` +
          `等任何写操作都不允许。请改写成一条纯 SELECT 查询。`,
        detail: `禁止词表：${FORBIDDEN.join(' / ')}`,
      }
    }
  }

  /* ---- 首 token 必须是 SELECT 或 WITH ---- */
  // ★ 放在禁用词检查【之后】：`DELETE/**/FROM t` 这种，先说「你用了禁止词 DELETE」
  //   比说「必须以 SELECT 开头」对模型更有用 —— 两条都会拒绝，但后者的
  //   建议（改成 SELECT 开头）会让它写出 `DELETE ... ` 换个位置再来一次。
  const first = tokens[0]?.toUpperCase()
  if (first !== 'SELECT' && first !== 'WITH') {
    return {
      ok: false,
      code: 'NOT_SELECT',
      message: `只允许查询，SQL 必须以 SELECT 或 WITH 开头。现在开头是「${tokens[0] ?? '（什么都没有）'}」。`,
    }
  }

  return { ok: true, sql: body }
}

/** 包在结果外的行数上限。返回 501 行就说明被截断了（见下面 wrapWithRowCap）。 */
export const ROW_CAP = 500

/**
 * 给 SQL 外面套一层行数上限。
 *
 * ★ 为什么要在 SQL 层面套，而不是等结果回来再 slice：
 *   56 万行的表上一条没写聚合的 SELECT，光是把结果搬进内存就可能让页面卡死。
 *   套在 SQL 里，SQLite 自己会在凑够 501 行时停下来。
 *
 * ★ 为什么取 501 而不是 500：
 *   这样「恰好 500 行」和「超过 500 行被截断」就区分得开 ——
 *   拿到 501 行才说明真的被截断了。少取一行会让这两种情况长得一模一样。
 */
export function wrapWithRowCap(sql: string): string {
  return `SELECT * FROM (\n${sql}\n) LIMIT ${ROW_CAP + 1}`
}

/**
 * 校验器拒绝时，附在理由后面的那句「你该怎么改」。
 *
 * ★ 单独抽成常量、而且抽到【校验器自己这个文件】里，是为了让页面文案和
 *   本机检查的断言读同一份。写两遍的话，改一处漏一处不会报错。
 *   （之前项目里吃过一次亏：同一句话在结论和洞察里各写一份，两边说法打架。）
 */
export const FORBIDDEN_KEYWORD_REJECTED_NOTE =
  '这条规则不是建议，是硬性的：本机的安全校验器只放行只读查询。' +
  '请把它改写成一条 SELECT 或 WITH 开头的查询，不要带分号，也不要带注释。'

/** 把一条 SQL 压缩成一行，日志和卡片里显示用。 */
export function oneLine(sql: string): string {
  return sql.replace(/\s+/g, ' ').trim()
}
