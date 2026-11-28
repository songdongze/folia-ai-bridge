/**
 * Host 侧：用量统计 + 模型目录 + 运行期配置读写。
 *
 * 双轨：
 *   内存计数器 —— 本次运行累计，重启清零（保持原有语义）
 *   持久化明细 —— 落盘 SQLite，重启不丢（由 usage-store.js 提供）
 *
 * 落盘失败不影响转发：写库异常只记一次日志，随后跳过。
 */

import { openUsageStore, RANGES, rangeStart } from './usage-store.js'

const MAX_MODELS_CACHE_MS = 60 * 1000
const MAX_RECENT = 20

/** Token 数按用途分桶的累加器。 */
const emptyUsage = () => ({ calls: 0, input: 0, output: 0, failed: 0 })

/**
 * @param {{ dbPath?: () => string, persist?: () => boolean, retentionDays?: number }} [options]
 *   dbPath/persist 用函数传入：库是懒打开的，配置改了要能拿到新值。
 */
export function createStats(options = {}) {
  const startedAt = Date.now()
  const totals = emptyUsage()
  /** provider\0model → { provider, model, calls, input, output, failed, lastAt } */
  const byModel = new Map()
  const recent = []

  /** 持久化库：懒打开；打开失败置为 false，不再重试直到重启插件。 */
  let store = null
  let storeFailed = false
  let persistWarned = false

  const log = options.log || (() => {})

  const storeOf = () => {
    if (store) return store
    if (storeFailed) return null
    if (options.persist && options.persist() === false) return null
    try {
      const path = options.dbPath ? options.dbPath() : ''
      if (!path) return null
      store = openUsageStore(path, { retentionDays: options.retentionDays })
      return store
    } catch (error) {
      storeFailed = true
      if (!persistWarned) {
        persistWarned = true
        log('warn', `[folia-ai-bridge] usage history store unavailable, keeping in-memory only: ${error?.message || error}`)
      }
      return null
    }
  }

  const bucket = (provider, model) => {
    const key = `${provider}\u0000${model}`
    let entry = byModel.get(key)
    if (!entry) {
      entry = { provider, model, calls: 0, input: 0, output: 0, failed: 0, lastAt: 0 }
      byModel.set(key, entry)
    }
    return entry
  }

  return {
    record({ provider, model, input = 0, output = 0, ok = true, ms = 0, stream = false, usage = null, effort = '', temperature = null, at = Date.now() }) {
      const entry = bucket(provider, model)
      for (const target of [totals, entry]) {
        target.calls += 1
        target.input += input
        target.output += output
        if (!ok) target.failed += 1
      }
      entry.lastAt = at
      recent.unshift({ at, provider, model, input, output, ok, ms, stream })
      if (recent.length > MAX_RECENT) recent.length = MAX_RECENT

      const db = storeOf()
      if (db) {
        try {
          db.record({
            at,
            provider,
            model,
            input,
            output,
            cacheRead: usage?.cacheReadTokens || 0,
            cacheWrite: usage?.cacheWriteTokens || 0,
            reasoning: usage?.reasoningTokens || 0,
            ok,
            ms,
            stream,
            effort,
            temperature,
          })
        } catch (error) {
          if (!persistWarned) {
            persistWarned = true
            log('warn', `[folia-ai-bridge] usage history write failed: ${error?.message || error}`)
          }
        }
      }
    },

    /** 内存快照（本次运行）。 */
    snapshot() {
      const models = [...byModel.values()].sort((a, b) => b.calls - a.calls)
      return {
        since: startedAt,
        uptimeMs: Date.now() - startedAt,
        totals: { ...totals },
        models,
        recent: [...recent],
      }
    },

    /** 只清本次运行的内存计数。 */
    reset() {
      totals.calls = 0
      totals.input = 0
      totals.output = 0
      totals.failed = 0
      byModel.clear()
      recent.length = 0
    },

    /** 持久化历史：多维度查询。 */
    history(range = '7d') {
      const valid = RANGES.includes(range) ? range : '7d'
      const db = storeOf()
      if (!db) {
        return {
          enabled: false,
          range: valid,
          persisted: false,
          totals: emptyUsage(),
          models: [],
          days: [],
          records: [],
          retentionDays: options.retentionDays || 30,
          sizeBytes: 0,
        }
      }
      return {
        enabled: true,
        persisted: true,
        range: valid,
        totals: db.totals(valid),
        models: db.byModel(valid),
        days: db.byDay(valid, 30),
        records: db.list(valid, { limit: 50 }),
        retentionDays: db.retentionDays,
        sizeBytes: db.sizeBytes(),
      }
    },

    historyPage(range = '7d', { limit = 50, offset = 0 } = {}) {
      const valid = RANGES.includes(range) ? range : '7d'
      const db = storeOf()
      if (!db) return { records: [], hasMore: false }
      const records = db.list(valid, { limit, offset })
      return { records, hasMore: records.length === Math.min(500, Math.max(1, limit)) }
    },

    /** 导出 CSV：一次取完范围内的所有明细。 */
    exportCsv(range = 'all') {
      const valid = RANGES.includes(range) ? range : 'all'
      const db = storeOf()
      if (!db) return null
      const rows = db.all(valid)
      const header = ['time', 'day', 'provider', 'model', 'input_tokens', 'output_tokens', 'total_tokens',
        'cache_read_tokens', 'cache_write_tokens', 'reasoning_tokens', 'status', 'latency_ms',
        'stream', 'reasoning_effort', 'temperature']
      const esc = (value) => {
        const text = value === null || value === undefined ? '' : String(value)
        return /[",\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text
      }
      const lines = [header.join(',')]
      for (const row of rows) {
        lines.push([
          new Date(row.at).toISOString(), row.day, row.provider, row.model,
          row.input, row.output, row.total, row.cacheRead, row.cacheWrite, row.reasoning,
          row.ok ? 'ok' : 'failed', row.ms, row.stream ? 'stream' : 'buffered',
          row.effort, row.temperature,
        ].map(esc).join(','))
      }
      return { csv: lines.join('\n'), count: rows.length }
    },

    /** 清空历史（明细 + 归档）。 */
    clearHistory() {
      const db = storeOf()
      if (!db) return 0
      return db.clear()
    },

    close() {
      if (store) {
        store.close()
        store = null
      }
    },
  }
}

/** 模型目录：探一次缓存一分钟，避免设置页每次打开都打 provider。 */
export function createCatalogue() {
  let cache = null
  return {
    invalidate() {
      cache = null
    },
    async list(llm) {
      if (cache && Date.now() - cache.at < MAX_MODELS_CACHE_MS) return cache.value
      const providers = []
      const all = typeof llm.listProviders === 'function' ? llm.listProviders() : []
      for (const entry of all) {
        let models = []
        try {
          models = (await llm.listModels(entry.id)).map((m) => ({ id: m.id, name: m.name || m.id }))
        } catch {
          models = []
        }
        providers.push({ id: entry.id, name: entry.name || entry.id, models })
      }
      const value = { providers, at: Date.now() }
      cache = value
      return value
    },
  }
}

export { RANGES, rangeStart }
