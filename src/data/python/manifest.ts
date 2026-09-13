/* ==========================================================================
   陈旧检查：这份 Python 结果，还是不是当前这份数据的？
   --------------------------------------------------------------------------
   ★ 这一节要解决的是**这个页面上唯一一种会静默出错的问题**。

   前五个页面的数字都是当场从 dataset.ts 算出来的，数据一变，页面跟着变，
   不存在"页面显示了一套旧数字"这种事。
   但这一页不一样：结果文件是**离线跑出来、写死在硬盘上**的。
   如果有人改了 dataset.ts 的随机种子、或者改了 analyze.py，却忘了重跑，
   页面会**理直气壮地**显示一套和数据对不上的旧数字 ——
   没有报错、没有脏字符、图表画得好好的，只是全错。

   一个作品集里最不能有的就是这种东西。所以这里主动查一次。

   查四件事：
     ① 种子 / 截止日 / 天数 和 DATASET_META 是否一致
     ② 四张表的行数是否一致
     ③ analyze.py 的指纹是否和结果文件里记的一致
     ④ 结果里有没有 NaN / Infinity（有的话页面会出现脏字符）

   任何一条不过，页面就挂红横幅，并把对账块藏起来。
   ★ 宁可不显示，也不显示错的。
   ========================================================================== */

import { DATASET_META, getDataset } from '../dataset'
import { PY_RESULTS } from './results.generated'
import type { PyManifest } from './types'

/**
 * analyze.py 的源码原文。
 *
 * ★ 为什么要用 `?raw` 把它整份引进来：
 *   页面上的「Python Code Viewer」要展示的就是这段代码本身。
 *   用 ?raw 引进来，展示的就是**磁盘上那一份**，
 *   而不是我在页面里另抄一遍——抄的那份迟早会和真跑的那份对不上。
 *
 * ★ 这段源码同时用来重算指纹：结果文件是哪个版本的脚本跑出来的，
 *   一比就知道。
 *
 * 代价：scripts/ 必须入库，不能被 gitignore。
 */
import analyzeSource from '../../../scripts/analyze.py?raw'

/**
 * FNV-1a 32 位校验和。
 *
 * ★ 为什么不用 SHA-256：
 *   这个看板要能在 file:// 下双击打开，而 file:// 不是安全上下文，
 *   浏览器的 crypto.subtle 在那里是 undefined —— SHA-256 根本算不了。
 *   所以换成一个几行就能手写、不依赖任何浏览器 API 的算法。
 *   它不防伪造，也不需要防：这里要抓的是「文件被改过」。
 *
 * ★ 为什么要先把 CRLF 换成 LF：
 *   analyze.py 在 Python 那边也是先归一换行符再算的。
 *   不归一的话，一个存成 CRLF 的编辑器、或者 git 改一次行尾，
 *   指纹就会变，页面弹出一个**假的**"脚本已过期"警告。
 *   假警告比没有警告更糟 —— 它会让人以后再也不信这个警告。
 */
export function fnv1a(text: string): string {
  let hash = 0x811c9dc5
  const bytes = new TextEncoder().encode(text.replace(/\r\n/g, '\n'))
  for (const byte of bytes) {
    hash ^= byte
    // 乘法用 Math.imul：普通的 * 在超过 2^53 之后会丢精度，
    // 算出来的结果每次都不一样
    hash = Math.imul(hash, 0x01000193) >>> 0
  }
  return hash.toString(16).padStart(8, '0')
}

/** 一条不一致。severity 用来决定页面怎么显示。 */
export interface FreshnessIssue {
  /** 哪个字段对不上 */
  field: string
  /** Python 结果里记的值 */
  py: string | number
  /** 当前项目里的真值 */
  actual: string | number
  /** 给读者看的一句话说明，说人话 */
  hint: string
}

export interface FreshnessReport {
  /** 全部通过才是 true */
  ok: boolean
  issues: FreshnessIssue[]
  /** 重算出来的脚本指纹，页面上直接展示，可自行核对 */
  computedHash: string
}

/** analyze.py 归一换行符之后的字符数。用来在页面上展示「这份脚本有多大」 */
export const ANALYZE_SOURCE_LINES = analyzeSource.split('\n').length

/** 供 Code Viewer 展示用的源码全文 */
export const ANALYZE_SOURCE = analyzeSource

/**
 * 检查结果文件是否已经过期。
 *
 * 这个函数只读、无副作用，可以随便在组件里调；
 * 但因为它要读整个数据集，调用方应该把它 memo 住，别在每次渲染时重跑。
 */
export function checkFreshness(): FreshnessReport {
  const manifest: PyManifest = PY_RESULTS.manifest
  const dataset = getDataset()
  const issues: FreshnessIssue[] = []

  const checkNum = (
    field: string,
    py: number,
    actual: number,
    hint: string,
  ): void => {
    if (py !== actual) issues.push({ field, py, actual, hint })
  }

  /* ① 输入指纹 ---------------------------------------------------------- */
  checkNum(
    'seed',
    manifest.seed,
    DATASET_META.seed,
    '数据生成用的随机种子变了。种子一变，全部数字都会变，必须重跑 Python。',
  )
  checkNum(
    'days',
    manifest.days,
    DATASET_META.days,
    '数据覆盖的天数变了。',
  )
  if (manifest.endDate !== DATASET_META.endDate) {
    issues.push({
      field: 'endDate',
      py: manifest.endDate,
      actual: DATASET_META.endDate,
      hint: '数据截止日变了，所有时间窗口都会跟着平移。',
    })
  }

  /* ② 四张表的行数 ------------------------------------------------------ */
  checkNum(
    'rowCounts.users',
    manifest.rowCounts?.users ?? -1,
    DATASET_META.userCount,
    '用户表行数对不上。',
  )
  checkNum(
    'rowCounts.videos',
    manifest.rowCounts?.videos ?? -1,
    DATASET_META.videoCount,
    '视频表行数对不上。',
  )
  checkNum(
    'rowCounts.creators',
    manifest.rowCounts?.creators ?? -1,
    DATASET_META.creatorCount,
    '创作者表行数对不上。',
  )
  checkNum(
    'rowCounts.video_views',
    manifest.rowCounts?.video_views ?? -1,
    dataset.views.length,
    '观看记录表行数对不上。这是最要紧的一处对不上。',
  )

  /* ③ 脚本指纹 ---------------------------------------------------------- */
  const computedHash = fnv1a(analyzeSource)
  if (manifest.analyzePyHash !== computedHash) {
    issues.push({
      field: 'analyzePyHash',
      py: manifest.analyzePyHash,
      actual: computedHash,
      hint:
        'analyze.py 的内容和生成这份结果时不一样。' +
        '页面上的数字来自旧版脚本，而下面的代码展示的是新版脚本——两者对不上。',
    })
  }

  /* ④ 结果本身是不是完整的 ---------------------------------------------- */
  /*
    NaN / Infinity 不需要在这里查：analyze.py 的 to_plain() 在写文件之前
    就会拦下非有限数值并直接报错。这是"由构造保证"，比事后检查更可靠。
    这里只做一件它保证不了的事：确认几大块结果都在、都不是空的。

    为什么不做成 JSON Schema 那么严格？因为类型层面已经由 types.ts 保证了
    （结构不对 `tsc` 就报错），这里只是兜住"生成中断、写了个半截文件"这种情况。
  */
  const sections: [string, unknown][] = [
    ['quality', PY_RESULTS.quality],
    ['activity', PY_RESULTS.activity],
    ['tiers', PY_RESULTS.tiers],
    ['content', PY_RESULTS.content],
    ['cross', PY_RESULTS.cross],
    ['trend', PY_RESULTS.trend],
    ['windows', PY_RESULTS.windows],
    ['snippets', PY_RESULTS.snippets],
  ]
  for (const [name, value] of sections) {
    const empty =
      value === undefined ||
      value === null ||
      (Array.isArray(value) && value.length === 0) ||
      (typeof value === 'object' && Object.keys(value as object).length === 0)
    if (empty) {
      issues.push({
        field: name,
        py: '(缺失或为空)',
        actual: '(应当有内容)',
        hint: `结果文件里的 ${name} 是空的，说明生成过程没跑完。重新跑一次 npm run data:refresh。`,
      })
    }
  }

  return { ok: issues.length === 0, issues, computedHash }
}
