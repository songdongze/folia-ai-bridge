/**
 * Folia 同步服务的存储层与业务逻辑。
 *
 * 与官方 folia-major/sync-server 协议完全一致（同样的表、字段、分桶与增量哈希语义），
 * 但去掉了 Hono 依赖：直接用 Node 24+ 内置的 node:sqlite，插件因此保持零依赖。
 *
 * 表结构：
 *   settings      视觉设置，单行（key='visual'）
 *   themes        每首歌的主题，fingerprint 主键
 *   theme_buckets 256 个分桶的摘要（count / hash / updated_at），供客户端增量比对
 *
 * 桶 hash 是「异或累加」：每个主题贡献 hashSyncString(fingerprint + \0 + updatedAt)，
 * 删除旧值、异或新值即可增量维护 —— 与官方实现逐位一致，客户端缓存的 manifest 才通用。
 */

import { DatabaseSync } from 'node:sqlite'

export const SCHEMA_VERSION = 1
const THEME_BUCKET_COUNT = 256
const MAX_THEME_BATCH_SIZE = 500
const MAX_BUCKET_REQUEST_SIZE = 32
const DEFAULT_LIST_LIMIT = 500
const MAX_LIST_LIMIT = 1000

const isRecord = (value) => Boolean(value) && typeof value === 'object' && !Array.isArray(value)

/** 与官方实现相同的 FNV-1a。 */
const hashSyncString = (value) => {
  let hash = 2166136261
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index)
    hash = Math.imul(hash, 16777619)
  }
  return hash >>> 0
}

const bucketIdOf = (fingerprint) => hashSyncString(fingerprint) % THEME_BUCKET_COUNT

/** 一个主题对桶 hash 的贡献值。 */
const themeHash = (fingerprint, updatedAt) => hashSyncString(`${fingerprint}\u0000${updatedAt}`)

const parseThemeInput = (value) => {
  if (!isRecord(value)
    || typeof value.fingerprint !== 'string'
    || !value.fingerprint
    || typeof value.updatedAt !== 'string'
    || !isRecord(value.theme)) {
    return null
  }
  const source = value.source === 'auto' || value.source === 'fallback' || value.source === 'edited'
    ? value.source
    : 'manual'
  return { fingerprint: value.fingerprint, theme: value.theme, updatedAt: value.updatedAt, source }
}

const mapThemeRow = (row) => ({
  fingerprint: row.fingerprint,
  theme: JSON.parse(row.theme_json),
  source: row.source,
  updatedAt: row.updated_at,
})

/**
 * 打开（必要时创建）同步数据库并保证表结构存在。
 * @param {string} path SQLite 文件路径
 */
export function openStore(path) {
  const db = new DatabaseSync(path)
  db.exec('PRAGMA journal_mode = WAL')
  db.exec('PRAGMA busy_timeout = 5000')

  db.exec(`
    CREATE TABLE IF NOT EXISTS settings (
      key TEXT PRIMARY KEY,
      value_json TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS themes (
      fingerprint TEXT PRIMARY KEY,
      bucket_id INTEGER NOT NULL,
      theme_json TEXT NOT NULL,
      source TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS theme_buckets (
      bucket_id INTEGER PRIMARY KEY,
      count INTEGER NOT NULL,
      hash TEXT NOT NULL,
      updated_at TEXT
    );
    CREATE INDEX IF NOT EXISTS idx_themes_updated_at ON themes(updated_at);
    CREATE INDEX IF NOT EXISTS idx_themes_bucket_id ON themes(bucket_id);
  `)

  const q = {
    settingsUpdatedAt: db.prepare("SELECT updated_at FROM settings WHERE key = 'visual'"),
    themesSummary: db.prepare('SELECT MAX(updated_at) AS themesUpdatedAt, SUM(count) AS themeCount FROM theme_buckets'),
    settingsValue: db.prepare("SELECT value_json FROM settings WHERE key = 'visual'"),
    buckets: db.prepare('SELECT bucket_id, count, hash, updated_at FROM theme_buckets'),
    bucketRow: db.prepare('SELECT count, hash, updated_at FROM theme_buckets WHERE bucket_id = ?'),
    oldTheme: db.prepare('SELECT updated_at FROM themes WHERE fingerprint = ?'),
    themeByFingerprint: db.prepare('SELECT fingerprint, theme_json, source, updated_at FROM themes WHERE fingerprint = ?'),
    themeByBucket: db.prepare('SELECT fingerprint, theme_json, source, updated_at FROM themes WHERE bucket_id = ?'),
    putSettings: db.prepare(`
      INSERT INTO settings (key, value_json, updated_at) VALUES ('visual', ?, ?)
      ON CONFLICT(key) DO UPDATE SET value_json = excluded.value_json, updated_at = excluded.updated_at
      WHERE excluded.updated_at >= settings.updated_at
    `),
    putTheme: db.prepare(`
      INSERT INTO themes (fingerprint, bucket_id, theme_json, source, updated_at) VALUES (?, ?, ?, ?, ?)
      ON CONFLICT(fingerprint) DO UPDATE SET
        bucket_id = excluded.bucket_id, theme_json = excluded.theme_json,
        source = excluded.source, updated_at = excluded.updated_at
      WHERE excluded.updated_at >= themes.updated_at
    `),
    putBucket: db.prepare(`
      INSERT INTO theme_buckets (bucket_id, count, hash, updated_at) VALUES (?, ?, ?, ?)
      ON CONFLICT(bucket_id) DO UPDATE SET count = excluded.count, hash = excluded.hash, updated_at = excluded.updated_at
    `),
  }

  const state = async () => {
    const settingsRow = q.settingsUpdatedAt.get()
    const themeRow = q.themesSummary.get()
    return {
      schemaVersion: SCHEMA_VERSION,
      settingsUpdatedAt: settingsRow ? settingsRow.updated_at : null,
      themesUpdatedAt: themeRow?.themesUpdatedAt ?? null,
      themeCount: Number(themeRow?.themeCount ?? 0) || 0,
    }
  }

  const getSettings = async () => {
    const row = q.settingsValue.get()
    return row ? JSON.parse(row.value_json) : null
  }

  const putSettings = async (body) => {
    if (!body || body.schemaVersion !== SCHEMA_VERSION || typeof body.updatedAt !== 'string' || !isRecord(body.data)) {
      return { status: 400, body: { ok: false, error: 'invalid_settings' } }
    }
    q.putSettings.run(JSON.stringify(body), body.updatedAt)
    return { status: 200, body: { ok: true } }
  }

  const manifest = async () => {
    const buckets = Array.from({ length: THEME_BUCKET_COUNT }, (_, bucketId) => ({
      bucketId, count: 0, hash: '0', updatedAt: null,
    }))
    for (const row of q.buckets.all()) {
      const id = row.bucket_id
      if (Number.isInteger(id) && id >= 0 && id < THEME_BUCKET_COUNT) {
        buckets[id] = { bucketId: id, count: Number(row.count), hash: row.hash, updatedAt: row.updated_at }
      }
    }
    return { schemaVersion: SCHEMA_VERSION, bucketCount: THEME_BUCKET_COUNT, buckets }
  }

  /** 批量取主题：客户端只会问它缺的那些 fingerprint。 */
  const getThemes = async (fingerprints) => {
    const wanted = Array.from(new Set((fingerprints ?? []).filter((v) => typeof v === 'string' && v)))
    if (wanted.length === 0) return { themes: [] }
    if (wanted.length > MAX_THEME_BATCH_SIZE) {
      return { status: 400, body: { ok: false, error: 'too_many_fingerprints' } }
    }
    const themes = []
    for (const fingerprint of wanted) {
      const row = q.themeByFingerprint.get(fingerprint)
      if (row) themes.push(mapThemeRow(row))
    }
    return { themes }
  }

  /**
   * 批量写主题：先按「旧值出、新值入」算出每个受影响桶的 count/hash 增量，
   * 事务内落库并更新桶摘要 —— 与官方实现的增量语义一致。
   */
  const putThemes = async (items) => {
    const parsed = Array.isArray(items) ? items.map(parseThemeInput) : []
    if (parsed.some((item) => item === null)) {
      return { status: 400, body: { ok: false, error: 'invalid_themes' } }
    }
    const themes = parsed
    if (themes.length === 0) return { savedCount: 0 }
    if (themes.length > MAX_THEME_BATCH_SIZE) {
      return { status: 400, body: { ok: false, error: 'invalid_themes' } }
    }

    const diffs = new Map()
    for (const theme of themes) {
      const bucketId = bucketIdOf(theme.fingerprint)
      let diff = diffs.get(bucketId)
      if (!diff) {
        diff = { countDelta: 0, hashDelta: 0, maxUpdatedAt: theme.updatedAt }
        diffs.set(bucketId, diff)
      }
      const oldRow = q.oldTheme.get(theme.fingerprint)
      if (!oldRow) {
        diff.countDelta += 1
        diff.hashDelta = (diff.hashDelta ^ themeHash(theme.fingerprint, theme.updatedAt)) >>> 0
      } else if (theme.updatedAt >= oldRow.updated_at) {
        diff.hashDelta = (diff.hashDelta ^ themeHash(theme.fingerprint, oldRow.updated_at)) >>> 0
        diff.hashDelta = (diff.hashDelta ^ themeHash(theme.fingerprint, theme.updatedAt)) >>> 0
      }
      if (Date.parse(theme.updatedAt) > Date.parse(diff.maxUpdatedAt)) diff.maxUpdatedAt = theme.updatedAt
    }

    db.exec('BEGIN IMMEDIATE')
    try {
      for (const theme of themes) {
        q.putTheme.run(
          theme.fingerprint,
          bucketIdOf(theme.fingerprint),
          JSON.stringify(theme.theme),
          theme.source,
          theme.updatedAt,
        )
      }
      for (const [bucketId, diff] of diffs) {
        const existing = q.bucketRow.get(bucketId)
        const count = (existing ? Number(existing.count) : 0) + diff.countDelta
        const hash = ((existing ? Number.parseInt(existing.hash, 10) || 0 : 0) ^ diff.hashDelta) >>> 0
        const updatedAt = existing && existing.updated_at && existing.updated_at > diff.maxUpdatedAt
          ? existing.updated_at
          : diff.maxUpdatedAt
        q.putBucket.run(bucketId, count, String(hash), updatedAt)
      }
      db.exec('COMMIT')
    } catch (error) {
      db.exec('ROLLBACK')
      throw error
    }

    return { savedCount: themes.length }
  }

  /** 按桶拉取主题（首次全量同步走这条）。 */
  const listThemes = async (bucketIds, limit) => {
    const ids = Array.from(new Set((bucketIds ?? []).filter((id) => Number.isInteger(id) && id >= 0 && id < THEME_BUCKET_COUNT)))
    if (ids.length === 0) return { themes: [] }
    if (ids.length > MAX_BUCKET_REQUEST_SIZE) {
      return { status: 400, body: { ok: false, error: 'too_many_buckets' } }
    }
    const cap = Math.min(Math.max(Number(limit) || DEFAULT_LIST_LIMIT, 1), MAX_LIST_LIMIT)
    const themes = []
    for (const bucketId of ids) {
      for (const row of q.themeByBucket.all(bucketId)) {
        themes.push(mapThemeRow(row))
        if (themes.length >= cap) break
      }
      if (themes.length >= cap) break
    }
    return { themes }
  }

  /** 看板用的摘要（不含任何主题内容）。 */
  const dashboard = async () => {
    const base = await state()
    const settings = await getSettings()
    return {
      ...base,
      backend: 'folia-ai-bridge',
      settingsKeys: settings && isRecord(settings.data) ? Object.keys(settings.data) : [],
    }
  }

  return {
    state,
    getSettings,
    putSettings,
    manifest,
    getThemes,
    putThemes,
    listThemes,
    dashboard,
    close: () => db.close(),
  }
}
