// 用量历史存储的离线自测：不需要 DSH，直接对临时库跑。
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { openUsageStore, rangeStart } from './usage-store.js'
import { createStats } from './stats.js'

const ok = []
const bad = []
const check = (label, condition, extra = '') => (condition ? ok : bad).push(`${label}${extra ? ` — ${extra}` : ''}`)

const dir = mkdtempSync(join(tmpdir(), 'usage-test-'))
const dbPath = join(dir, 'usage.db')

try {
  const store = openUsageStore(dbPath, { retentionDays: 30 })

  const now = Date.now()
  const day = 86400000

  // 写入：今天 3 条、昨天 2 条、40 天前 1 条（应被归档）
  store.record({ at: now, provider: 'p', model: 'm1', input: 100, output: 50, ok: true, ms: 120, stream: false, effort: 'low', temperature: 0.7 })
  store.record({ at: now - 1000, provider: 'p', model: 'm1', input: 200, output: 80, ok: true, ms: 200, stream: true, effort: 'high' })
  store.record({ at: now - 2000, provider: 'p', model: 'm2', input: 50, output: 10, ok: false, ms: 30, stream: false })
  store.record({ at: now - day, provider: 'p', model: 'm1', input: 300, output: 90, ok: true, ms: 150 })
  store.record({ at: now - day, provider: 'p', model: 'm2', input: 70, output: 20, ok: true, ms: 90 })
  store.record({ at: now - 40 * day, provider: 'p', model: 'old', input: 999, output: 999, ok: true, ms: 10 })

  const todayTotals = store.totals('today')
  check('今日请求数=3', todayTotals.calls === 3, String(todayTotals.calls))
  check('今日 token 汇总', todayTotals.input === 350 && todayTotals.output === 140, JSON.stringify(todayTotals))

  const allTotals = store.totals('all')
  check('总计包含归档', allTotals.calls > todayTotals.calls, `${allTotals.calls} vs ${todayTotals.calls}`)

  const models = store.byModel('7d')
  check('按模型分组', models.length === 2, JSON.stringify(models.map((m) => m.model)))
  check('按模型降序', models[0].calls >= models[1].calls)

  const days = store.byDay('7d', 7)
  check('趋势补满 7 天', days.length === 7, String(days.length))
  check('趋势最后一天是今天', days.at(-1).calls === 3, JSON.stringify(days.at(-1)))

  const list = store.list('7d', { limit: 2 })
  check('分页限制生效', list.length === 2, String(list.length))
  check('最新在前', list[0].at >= list[1].at)
  check('明细字段完整', (
    typeof list[0].model === 'string'
    && typeof list[0].input === 'number'
    && typeof list[0].total === 'number'
    && typeof list[0].ok === 'boolean'
    && typeof list[0].ms === 'number'
  ), JSON.stringify(list[0]))

  const page2 = store.list('7d', { limit: 2, offset: 2 })
  check('分页 offset 生效', page2.length === 2 && page2[0].id !== list[0].id)

  check('文件大小可读', store.sizeBytes() > 0, String(store.sizeBytes()))
  store.close()

  // 重开：数据仍在（持久化核心）
  const reopened = openUsageStore(dbPath, { retentionDays: 30 })
  check('重开后数据仍在', reopened.totals('7d').calls === 5, String(reopened.totals('7d').calls))

  // 清空
  const removed = reopened.clear()
  check('清空返回删除条数', removed >= 5, String(removed))
  check('清空后为空', reopened.totals('all').calls === 0)
  reopened.close()
} finally {
  rmSync(dir, { recursive: true, force: true })
}

// createStats：内存 + 落盘双轨
{
  const dir2 = mkdtempSync(join(tmpdir(), 'stats-test-'))
  const dbPath = join(dir2, 'h.db')
  try {
    const stats = createStats({ dbPath: () => dbPath, persist: () => true, log: () => {} })
    stats.record({ provider: 'p', model: 'm', input: 10, output: 5, ok: true, ms: 40, usage: { cacheReadTokens: 7, reasoningTokens: 3 } })
    stats.record({ provider: 'p', model: 'm', input: 20, output: 8, ok: false, ms: 60 })

    const snap = stats.snapshot()
    check('内存快照累计', snap.totals.calls === 2 && snap.totals.failed === 1, JSON.stringify(snap.totals))

    const hist = stats.history('today')
    check('历史已落盘', hist.persisted === true && hist.totals.calls === 2, JSON.stringify(hist.totals))
    check('缓存 token 已记录', hist.totals.cacheRead === 7, String(hist.totals.cacheRead))
    check('推理 token 已记录', hist.totals.reasoning === 3, String(hist.totals.reasoning))

    const csv = stats.exportCsv('today')
    check('CSV 导出有表头', csv && csv.csv.split('\n')[0].startsWith('time,day,provider'), csv && csv.csv.slice(0, 40))
    check('CSV 行数正确', csv && csv.count === 2, String(csv && csv.count))

    stats.reset()
    check('reset 只清内存', stats.snapshot().totals.calls === 0 && stats.history('today').totals.calls === 2)

    const cleared = stats.clearHistory()
    check('clearHistory 清持久化', cleared === 2 && stats.history('today').totals.calls === 0, String(cleared))
    stats.close()

    // persist=false 时不落盘
    const off = createStats({ dbPath: () => dbPath, persist: () => false, log: () => {} })
    off.record({ provider: 'p', model: 'm', input: 1, output: 1, ok: true })
    check('关闭后不落盘', off.history('today').persisted === false && off.snapshot().totals.calls === 1)
    off.close()
  } finally {
    rmSync(dir2, { recursive: true, force: true })
  }
}

// rangeStart 边界
{
  const today = (() => { const d = new Date(); d.setHours(0, 0, 0, 0); return d.getTime() })()
  check('rangeStart today', rangeStart('today') === today)
  check('rangeStart 7d', rangeStart('7d') === today - 6 * 86400000)
  check('rangeStart all', rangeStart('all') === 0)
}

console.log(`\n=== PASS ${ok.length} ===`)
for (const line of ok) console.log('  ✓ ' + line)
if (bad.length) {
  console.log(`\n=== FAIL ${bad.length} ===`)
  for (const line of bad) console.log('  ✗ ' + line)
  process.exitCode = 1
}
