/**
 * 用量历史持久化（node:sqlite，零外部依赖）。
 *
 * 与 sync-store.js 同一套做法：懒打开、同步 API、WAL。
 *
 * 表结构：
 *   usage_records  每次请求一行，字段见 CREATE TABLE
 *   usage_archive  超出保留期的明细按「天 + 模型」聚合后落在这里
 *
 * 保留策略：明细默认保留 30 天。打开时修剪一次，之后每满 500 次写入再修剪一次
 * （计数触发，不挂定时器，空闲时零开销）。
 */

import { DatabaseSync } from 'node:sqlite'
import { statSync } from 'node:fs'

const DEFAULT_RETENTION_DAYS = 30
const TRIM_EVERY_WRITES = 500
const DEFAULT_PAGE_SIZE = 50
const MAX_PAGE_SIZE = 500

/** 本地日期 YYYY-MM-DD，按天聚合一列存好，查询不用每次算时区。 */
const dayOf = (ms) => {
  const d = new Date(ms)
  const pad = (n) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
}

const startOfToday = () => {
  const d = new Date()
  d.setHours(0, 0, 0, 0)
  return d.getTime()
}

/** 时间范围 → 起始毫秒（0 表示不限）。 */
export const rangeStart = (range) => {
  const today = startOfToday()
  switch (range) {
    case 'today': return today
    case '7d': return today - 6 * 86400000
    case '30d': return today - 29 * 86400000
    case 'all': return 0
    default: return today - 6 * 86400000
  }
}

export const RANGES = Object.freeze(['today', '7d', '30d', 'all'])

/** 把明细行映射成对外结构。 */
const toRecord = (row) => ({
  id: row.id,
  at: row.ts,
  day: row.day,
  provider: row.provider,
  model: row.model,
  input: row.input_tokens,
  output: row.output_tokens,
  cacheRead: row.cache_read_tokens,
  cacheWrite: row.cache_write_tokens,
  reasoning: row.reasoning_tokens,
  total: row.input_tokens + row.output_tokens,
  ok: row.ok === 1,
  ms: row.latency_ms,
  stream: row.stream === 1,
  effort: row.reasoning_effort || '',
  temperature: row.temperature,
})

/**
 * 打开（或创建）用量库。
 * @param {string} path SQLite 文件路径
 * @param {{ retentionDays?: number }} [options]
 */
export function openUsageStore(path, options = {}) {
  const retentionDays = Number.isFinite(options.retentionDays) && options.retentionDays > 0
    ? Math.floor(options.retentionDays)
    : DEFAULT_RETENTION_DAYS

  const db = new DatabaseSync(path)
  db.exec('PRAGMA journal_mode = WAL')
  db.exec('PRAGMA synchronous = NORMAL')
  db.exec(`
    CREATE TABLE IF NOT EXISTS usage_records (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      ts INTEGER NOT NULL,
      day TEXT NOT NULL,
      provider TEXT NOT NULL,
      model TEXT NOT NULL,
      input_tokens INTEGER NOT NULL DEFAULT 0,
      output_tokens INTEGER NOT NULL DEFAULT 0,
      cache_read_tokens INTEGER NOT NULL DEFAULT 0,
      cache_write_tokens INTEGER NOT NULL DEFAULT 0,
      reasoning_tokens INTEGER NOT NULL DEFAULT 0,
      ok INTEGER NOT NULL DEFAULT 1,
      latency_ms INTEGER NOT NULL DEFAULT 0,
      stream INTEGER NOT NULL DEFAULT 0,
      reasoning_effort TEXT,
      temperature REAL
    );
    CREATE INDEX IF NOT EXISTS usage_records_ts ON usage_records (ts DESC);
    CREATE INDEX IF NOT EXISTS usage_records_day ON usage_records (day);
    CREATE INDEX IF NOT EXISTS usage_records_model ON usage_records (model);

    CREATE TABLE IF NOT EXISTS usage_archive (
      day TEXT NOT NULL,
      provider TEXT NOT NULL,
      model TEXT NOT NULL,
      calls INTEGER NOT NULL DEFAULT 0,
      failed INTEGER NOT NULL DEFAULT 0,
      input_tokens INTEGER NOT NULL DEFAULT 0,
      output_tokens INTEGER NOT NULL DEFAULT 0,
      PRIMARY KEY (day, provider, model)
    );
  `)

  const insert = db.prepare(`
    INSERT INTO usage_records
      (ts, day, provider, model, input_tokens, output_tokens, cache_read_tokens,
       cache_write_tokens, reasoning_tokens, ok, latency_ms, stream, reasoning_effort, temperature)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `)

  let writesSinceTrim = 0
  let closed = false

  /**
   * 把超出保留期的明细滚动进 usage_archive 再删除。
   * 失败只影响归档，不影响正常记录，所以整段包在 try 里。
   */
  const trim = () => {
    writesSinceTrim = 0
    const cutoffDay = dayOf(Date.now() - retentionDays * 86400000)
    try {
      const expired = db.prepare('SELECT COUNT(*) AS n FROM usage_records WHERE day < ?').get(cutoffDay)
      if (!expired || expired.n === 0) return 0

      db.exec('BEGIN')
      try {
        db.prepare(`
          INSERT INTO usage_archive (day, provider, model, calls, failed, input_tokens, output_tokens)
          SELECT day, provider, model, COUNT(*), SUM(CASE WHEN ok = 0 THEN 1 ELSE 0 END),
                 SUM(input_tokens), SUM(output_tokens)
          FROM usage_records WHERE day < ?
          GROUP BY day, provider, model
          ON CONFLICT(day, provider, model) DO UPDATE SET
            calls = usage_archive.calls + excluded.calls,
            failed = usage_archive.failed + excluded.failed,
            input_tokens = usage_archive.input_tokens + excluded.input_tokens,
            output_tokens = usage_archive.output_tokens + excluded.output_tokens
        `).run(cutoffDay)
        db.prepare('DELETE FROM usage_records WHERE day < ?').run(cutoffDay)
        db.exec('COMMIT')
      } catch (error) {
        db.exec('ROLLBACK')
        throw error
      }
      return expired.n
    } catch {
      return 0
    }
  }

  trim()

  return {
    /** 记一条。同步写，开销是一次 INSERT；每 500 次顺带修剪一次旧明细。 */
    record(entry) {
      if (closed) return
      const at = Number.isFinite(entry.at) ? entry.at : Date.now()
      insert.run(
        at,
        dayOf(at),
        String(entry.provider || '-'),
        String(entry.model || '-'),
        Math.max(0, Math.floor(entry.input || 0)),
        Math.max(0, Math.floor(entry.output || 0)),
        Math.max(0, Math.floor(entry.cacheRead || 0)),
        Math.max(0, Math.floor(entry.cacheWrite || 0)),
        Math.max(0, Math.floor(entry.reasoning || 0)),
        entry.ok === false ? 0 : 1,
        Math.max(0, Math.floor(entry.ms || 0)),
        entry.stream === true ? 1 : 0,
        entry.effort ? String(entry.effort) : null,
        Number.isFinite(entry.temperature) ? entry.temperature : null,
      )
      writesSinceTrim += 1
      if (writesSinceTrim >= TRIM_EVERY_WRITES) trim()
    },

    /** 时间范围内按模型聚合。 */
    byModel(range) {
      const from = rangeStart(range)
      return db.prepare(`
        SELECT provider, model,
               COUNT(*) AS calls,
               SUM(CASE WHEN ok = 0 THEN 1 ELSE 0 END) AS failed,
               SUM(input_tokens) AS input_tokens,
               SUM(output_tokens) AS output_tokens,
               SUM(cache_read_tokens) AS cache_read_tokens,
               SUM(cache_write_tokens) AS cache_write_tokens,
               SUM(reasoning_tokens) AS reasoning_tokens,
               SUM(latency_ms) AS latency_ms,
               MAX(ts) AS last_at
        FROM usage_records WHERE ts >= ?
        GROUP BY provider, model ORDER BY calls DESC
      `).all(from).map((row) => ({
        provider: row.provider,
        model: row.model,
        calls: row.calls,
        failed: row.failed,
        input: row.input_tokens,
        output: row.output_tokens,
        cacheRead: row.cache_read_tokens,
        cacheWrite: row.cache_write_tokens,
        reasoning: row.reasoning_tokens,
        total: row.input_tokens + row.output_tokens,
        avgMs: row.calls ? Math.round(row.latency_ms / row.calls) : 0,
        lastAt: row.last_at,
      }))
    },

    /** 时间范围内按天聚合（用于趋势图）。 */
    byDay(range, days = 30) {
      const from = Math.max(rangeStart(range), startOfToday() - (days - 1) * 86400000)
      const rows = db.prepare(`
        SELECT day,
               COUNT(*) AS calls,
               SUM(CASE WHEN ok = 0 THEN 1 ELSE 0 END) AS failed,
               SUM(input_tokens) AS input_tokens,
               SUM(output_tokens) AS output_tokens
        FROM usage_records WHERE ts >= ?
        GROUP BY day ORDER BY day ASC
      `).all(from)
      const map = new Map(rows.map((row) => [row.day, row]))
      // 补齐没有数据的日期，趋势图才不会断
      const out = []
      const span = range === 'today' ? 1 : days
      for (let i = span - 1; i >= 0; i -= 1) {
        const day = dayOf(startOfToday() - i * 86400000)
        const row = map.get(day)
        out.push({
          day,
          calls: row ? row.calls : 0,
          failed: row ? row.failed : 0,
          input: row ? row.input_tokens : 0,
          output: row ? row.output_tokens : 0,
          total: row ? row.input_tokens + row.output_tokens : 0,
        })
      }
      return out
    },

    /** 时间范围总计（含归档区，`all` 时才有意义）。 */
    totals(range) {
      const from = rangeStart(range)
      const live = db.prepare(`
        SELECT COUNT(*) AS calls,
               SUM(CASE WHEN ok = 0 THEN 1 ELSE 0 END) AS failed,
               SUM(input_tokens) AS input_tokens,
               SUM(output_tokens) AS output_tokens,
               SUM(cache_read_tokens) AS cache_read_tokens,
               SUM(cache_write_tokens) AS cache_write_tokens,
               SUM(reasoning_tokens) AS reasoning_tokens,
               SUM(latency_ms) AS latency_ms
        FROM usage_records WHERE ts >= ?
      `).get(from)
      let calls = live?.calls || 0
      let failed = live?.failed || 0
      let input = live?.input_tokens || 0
      let output = live?.output_tokens || 0
      if (range === 'all') {
        const archived = db.prepare(`
          SELECT SUM(calls) AS calls, SUM(failed) AS failed,
                 SUM(input_tokens) AS input_tokens, SUM(output_tokens) AS output_tokens
          FROM usage_archive
        `).get()
        calls += archived?.calls || 0
        failed += archived?.failed || 0
        input += archived?.input_tokens || 0
        output += archived?.output_tokens || 0
      }
      const latency = live?.latency_ms || 0
      return {
        calls,
        failed,
        input,
        output,
        cacheRead: live?.cache_read_tokens || 0,
        cacheWrite: live?.cache_write_tokens || 0,
        reasoning: live?.reasoning_tokens || 0,
        total: input + output,
        avgMs: calls ? Math.round(latency / calls) : 0,
        archivedCalls: range === 'all' ? (db.prepare('SELECT SUM(calls) AS n FROM usage_archive').get()?.n || 0) : 0,
      }
    },

    /** 明细分页，最新在前。 */
    list(range, { limit = DEFAULT_PAGE_SIZE, offset = 0 } = {}) {
      const size = Math.min(MAX_PAGE_SIZE, Math.max(1, Math.floor(limit) || DEFAULT_PAGE_SIZE))
      const skip = Math.max(0, Math.floor(offset) || 0)
      const rows = db.prepare(`
        SELECT * FROM usage_records WHERE ts >= ? ORDER BY ts DESC, id DESC LIMIT ? OFFSET ?
      `).all(rangeStart(range), size, skip)
      return rows.map(toRecord)
    },

    /** 导出用：一次取完，不分页。 */
    all(range) {
      return db.prepare(`
        SELECT * FROM usage_records WHERE ts >= ? ORDER BY ts DESC, id DESC
      `).all(rangeStart(range)).map(toRecord)
    },

    /** 只清内存统计改由 host 处理；这里清的是持久化明细与归档。 */
    clear() {
      const before = db.prepare('SELECT COUNT(*) AS n FROM usage_records').get()?.n || 0
      db.exec('DELETE FROM usage_records')
      db.exec('DELETE FROM usage_archive')
      db.exec('VACUUM')
      return before
    },

    /** 删掉多久以前的明细（保留归档语义不变，只清明细）。 */
    prune(beforeMs) {
      const day = dayOf(beforeMs)
      const n = db.prepare('SELECT COUNT(*) AS n FROM usage_records WHERE day < ?').get(day)?.n || 0
      if (n > 0) db.prepare('DELETE FROM usage_records WHERE day < ?').run(day)
      return n
    },

    sizeBytes() {
      try {
        return statSync(path).size
      } catch {
        return 0
      }
    },

    retentionDays,

    close() {
      if (closed) return
      closed = true
      try {
        db.close()
      } catch {
        // 关闭失败不影响进程退出
      }
    },
  }
}
