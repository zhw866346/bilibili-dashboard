/**
 * 把 dataset.ts 里的四张表导出成 CSV。
 *
 * 为什么要有这一步：
 *   Python + Pandas 分析要读真实的 CSV 文件——就像真实工作里
 *   先从数据库导出数据、再拿 Python 处理一样。
 *   dataset.ts 是 TypeScript，Python 读不了，所以先用 Node 跑一遍它，落成 CSV。
 *
 * ★ dataset.ts 是唯一的数据源。这个脚本只做「格式转换」，不生成任何新数据。
 * ★ 布尔字段导出成 1 / 0，不是 true / false。
 *   这和 SQL 页建表时把 boolean 存成 INTEGER 1/0 是同一个口径
 *   （见 src/data/sql/engine.ts 的 lit()）。两边一致，对账才对得上。
 *
 * 用法：npm run data:export
 */

import { createJiti } from 'jiti'
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')

/** 每张表导出哪些列、按什么顺序。写死是为了让 CSV 的列顺序永远稳定。 */
const TABLES = [
  {
    csv: 'users',
    key: 'users',
    columns: ['user_id', 'age', 'gender', 'city', 'register_date', 'user_level'],
  },
  {
    csv: 'creators',
    key: 'creators',
    columns: ['up_id', 'creator_type', 'followers'],
  },
  {
    csv: 'videos',
    key: 'videos',
    columns: ['video_id', 'up_id', 'category', 'publish_date', 'duration'],
  },
  {
    csv: 'video_views',
    key: 'views',
    columns: [
      'user_id',
      'video_id',
      'date',
      'watch_seconds',
      'is_like',
      'is_favorite',
      'is_comment',
      'is_share',
    ],
  },
]

/** 抽样文件每个表最多写多少行。够看清「数据长什么样」，又不至于把仓库撑大。 */
const SAMPLE_ROWS = 1000

/**
 * 一个单元格转成 CSV 文本。
 * 按 RFC4180：只有含逗号、引号、换行时才加引号，内部的引号翻倍。
 */
function cell(value) {
  if (typeof value === 'boolean') return value ? '1' : '0'
  const text = String(value)
  return /[",\n\r]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text
}

/** 整张表转成 CSV 文本。用 \n 换行，不用 Windows 的 \r\n，免得 git diff 全是噪音。 */
function toCsv(columns, rows) {
  const header = columns.join(',')
  const body = rows.map((row) => columns.map((col) => cell(row[col])).join(','))
  return `${[header, ...body].join('\n')}\n`
}

/**
 * 写文件 + 回头数一遍行数。
 * 这一步不是走过场：万一写入逻辑漏了行，这里会当场炸掉，而不是等 Python 算出
 * 一套偏小的数字、再让人去猜哪里错了。
 */
function writeAndVerify(path, text, expectedRows, withBom) {
  writeFileSync(path, withBom ? `﻿${text}` : text, 'utf8')

  const written = readFileSync(path, 'utf8').replace(/^﻿/, '')
  const lineCount = written.split('\n').filter((line) => line.length > 0).length
  if (lineCount !== expectedRows + 1) {
    throw new Error(
      `${path} 写出来 ${lineCount - 1} 行，应该是 ${expectedRows} 行。导出逻辑有问题，已中止。`,
    )
  }
}

function main() {
  // 用 jiti 直接跑 TypeScript。不需要先编译，也不需要额外的构建步骤。
  const datasetPath = join(ROOT, 'src', 'data', 'dataset.ts')
  const jiti = createJiti(join(ROOT, 'scripts', 'export-data.mjs'))
  const datasetModule = jiti(datasetPath)
  const dataset = datasetModule.getDataset()
  const meta = datasetModule.DATASET_META

  // dataset.ts 自己是唯一数据源，这里的期望值全部从它读出来，不手写数字。
  const expected = {
    users: meta.userCount,
    creators: meta.creatorCount,
    videos: meta.videoCount,
  }

  mkdirSync(join(ROOT, 'data', 'csv'), { recursive: true })
  mkdirSync(join(ROOT, 'data', 'sample'), { recursive: true })

  console.log('')
  console.log(`数据源：src/data/dataset.ts（随机种子 ${meta.seed}，截止 ${meta.endDate}）`)
  console.log('')

  let totalRows = 0

  for (const table of TABLES) {
    const rows = dataset[table.key]

    // 先和 DATASET_META 对一遍。数字对不上说明数据生成或读取出了问题，
    // 这时候停下来比继续写 CSV 强。
    if (expected[table.csv] !== undefined && rows.length !== expected[table.csv]) {
      throw new Error(
        `${table.csv} 实际 ${rows.length} 行，DATASET_META 说是 ${expected[table.csv]} 行。已中止。`,
      )
    }

    const fullPath = join(ROOT, 'data', 'csv', `${table.csv}.csv`)
    writeAndVerify(fullPath, toCsv(table.columns, rows), rows.length, false)

    const sampleRows = rows.slice(0, Math.min(SAMPLE_ROWS, rows.length))
    const samplePath = join(ROOT, 'data', 'sample', `${table.csv}.csv`)
    // 抽样文件是给人用 Excel 双击看的，带 BOM 才不乱码；
    // 全量文件是给 pandas 读的，不能带 BOM。
    writeAndVerify(samplePath, toCsv(table.columns, sampleRows), sampleRows.length, true)

    totalRows += rows.length
    console.log(
      `  ${table.csv.padEnd(12)} 全量 ${String(rows.length).padStart(7)} 行` +
        `    抽样 ${String(sampleRows.length).padStart(4)} 行` +
        `    ${table.columns.length} 列`,
    )
  }

  console.log('')
  console.log(`  合计 ${totalRows.toLocaleString('en-US')} 行`)
  console.log('')
  console.log('  全量：data/csv/      （不进仓库，Python 读它）')
  console.log('  抽样：data/sample/   （进仓库，给人看）')
  console.log('')
}

main()
