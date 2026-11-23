// 同步服务的离线自测：证书 / 分桶 hash / 增量语义，全部与官方实现对齐。
import { openStore, SCHEMA_VERSION } from './sync-store.js'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const ok = []
const bad = []
const check = (label, cond, extra = '') => (cond ? ok : bad).push(`${label}${extra ? ` — ${extra}` : ''}`)

// 与官方 app.ts 相同的参考实现，用来逐位比对
const hashSyncString = (value) => {
  let hash = 2166136261
  for (let i = 0; i < value.length; i += 1) {
    hash ^= value.charCodeAt(i)
    hash = Math.imul(hash, 16777619)
  }
  return hash >>> 0
}
const bucketOf = (fp) => hashSyncString(fp) % 256
const themeHash = (fp, at) => hashSyncString(`${fp}\u0000${at}`)

const dir = mkdtempSync(join(tmpdir(), 'folia-sync-test-'))
const store = openStore(join(dir, 'test.db'))

// 1) 初始状态
{
  const state = await store.state()
  check('初始 state', state.schemaVersion === SCHEMA_VERSION && state.themeCount === 0 && state.settingsUpdatedAt === null)
  const manifest = await store.manifest()
  check('manifest 有 256 个桶', manifest.buckets.length === 256 && manifest.bucketCount === 256)
  check('manifest 初始全空', manifest.buckets.every((b) => b.count === 0 && b.hash === '0'))
  check('空库读设置是 null', (await store.getSettings()) === null)
}

// 2) 设置读写 + 时间戳保护
{
  const at = '2026-01-01T00:00:00.000Z'
  const first = await store.putSettings({ schemaVersion: 1, updatedAt: at, data: { mode: 'dark' } })
  check('写设置 200', first.status === 200)
  const got = await store.getSettings()
  check('读回设置一致', got?.data?.mode === 'dark' && got.updatedAt === at)
  check('state 反映设置时间', (await store.state()).settingsUpdatedAt === at)

  const stale = await store.putSettings({ schemaVersion: 1, updatedAt: '2025-01-01T00:00:00.000Z', data: { mode: 'light' } })
  check('旧时间戳被接受但覆盖不变', stale.status === 200 && (await store.getSettings()).data.mode === 'dark')

  const invalid = await store.putSettings({ schemaVersion: 1, data: {} })
  check('缺 updatedAt 拒绝', invalid.status === 400 && invalid.body.error === 'invalid_settings')
  const badVersion = await store.putSettings({ schemaVersion: 99, updatedAt: at, data: {} })
  check('版本不符拒绝', badVersion.status === 400)
}

// 3) 主题写入：分桶与 hash 必须与参考实现逐位相同
{
  const themes = [
    { fingerprint: 'fp-alpha', updatedAt: '2026-01-01T00:00:00.000Z', theme: { a: 1 }, source: 'auto' },
    { fingerprint: 'fp-beta', updatedAt: '2026-01-01T00:00:01.000Z', theme: { b: 2 }, source: 'manual' },
    { fingerprint: 'fp-gamma', updatedAt: '2026-01-01T00:00:02.000Z', theme: { c: 3 }, source: 'edited' },
  ]
  const put = await store.putThemes(themes)
  check('写入 3 个主题', put.savedCount === 3)

  const manifest = await store.manifest()
  const expected = new Map()
  for (const t of themes) {
    const b = bucketOf(t.fingerprint)
    expected.set(b, (expected.get(b) ?? 0) ^ themeHash(t.fingerprint, t.updatedAt))
  }
  let hashMatch = true
  for (const [bucketId, hash] of expected) {
    const row = manifest.buckets[bucketId]
    if (Number(row.hash) !== (hash >>> 0)) hashMatch = false
  }
  check('桶 hash 与官方算法逐位一致', hashMatch)

  const totalCount = manifest.buckets.reduce((s, b) => s + b.count, 0)
  check('桶计数合计 = 3', totalCount === 3, String(totalCount))
  const state = await store.state()
  check('state.themeCount = 3', state.themeCount === 3)
  check('state.themesUpdatedAt 正确', state.themesUpdatedAt === '2026-01-01T00:00:02.000Z')
}

// 4) 按 fingerprint 取回
{
  const got = await store.getThemes(['fp-alpha', 'fp-nonexistent', 'fp-beta'])
  check('取回 2 个（跳过不存在的）', got.themes.length === 2)
  check('主题内容正确', got.themes.find((t) => t.fingerprint === 'fp-alpha')?.theme?.a === 1)
  check('空请求返回空', (await store.getThemes([])).themes.length === 0)
  check('超过批量上限拒绝', (await store.getThemes(Array.from({ length: 501 }, (_, i) => `x${i}`))).status === 400)
}

// 5) 更新同一主题：hash 应异或掉旧值、异或进新值
{
  const before = (await store.manifest()).buckets[bucketOf('fp-alpha')]
  const newAt = '2026-02-01T00:00:00.000Z'
  await store.putThemes([{ fingerprint: 'fp-alpha', updatedAt: newAt, theme: { a: 99 }, source: 'manual' }])
  const after = (await store.manifest()).buckets[bucketOf('fp-alpha')]

  const oldContribution = themeHash('fp-alpha', '2026-01-01T00:00:00.000Z')
  const newContribution = themeHash('fp-alpha', newAt)
  const expectedHash = (Number(before.hash) ^ oldContribution ^ newContribution) >>> 0
  check('更新后 hash 正确', Number(after.hash) === expectedHash, `${after.hash} vs ${expectedHash}`)
  check('更新不改变计数', after.count === before.count)

  const got = await store.getThemes(['fp-alpha'])
  check('主题内容已更新', got.themes[0].theme.a === 99 && got.themes[0].updatedAt === newAt)
}

// 6) 按桶拉取
{
  const b = bucketOf('fp-beta')
  const got = await store.listThemes([b], 100)
  check('按桶拉取拿到目标', got.themes.some((t) => t.fingerprint === 'fp-beta'))
  check('桶 id 越界被忽略', (await store.listThemes([999, -1], 10)).themes.length === 0)
  check('超过桶数上限拒绝', (await store.listThemes(Array.from({ length: 33 }, (_, i) => i), 10)).status === 400)
  const limited = await store.listThemes([bucketOf('fp-alpha'), bucketOf('fp-beta')], 1)
  check('limit 生效', limited.themes.length === 1)
}

// 7) 非法输入
{
  const bad1 = await store.putThemes([{ fingerprint: '', updatedAt: 'x', theme: {} }])
  check('空 fingerprint 拒绝', bad1.status === 400 && bad1.body.error === 'invalid_themes')
  const bad2 = await store.putThemes([{ fingerprint: 'z', updatedAt: 'x', theme: 'not-an-object' }])
  check('theme 非对象拒绝', bad2.status === 400)
  check('空数组返回 0', (await store.putThemes([])).savedCount === 0)
}

// 8) 看板摘要不含内容
{
  const dash = await store.dashboard()
  check('看板有统计字段', typeof dash.themeCount === 'number' && 'settingsUpdatedAt' in dash)
  check('看板不泄露主题内容', !JSON.stringify(dash).includes('fp-alpha'))
}

// 9) 重开后数据仍在（持久化）
{
  store.close()
  const reopened = openStore(join(dir, 'test.db'))
  const state = await reopened.state()
  check('重开后主题仍在', state.themeCount === 3)
  const got = await reopened.getThemes(['fp-alpha'])
  check('重开后内容正确', got.themes[0]?.theme?.a === 99)
  reopened.close()
}

rmSync(dir, { recursive: true, force: true })

console.log(`\n=== PASS ${ok.length} ===`)
for (const line of ok) console.log('  ✓ ' + line)
if (bad.length) {
  console.log(`\n=== FAIL ${bad.length} ===`)
  for (const line of bad) console.log('  ✗ ' + line)
  process.exitCode = 1
}
