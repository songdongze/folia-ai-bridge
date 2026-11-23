/**
 * Host 侧：用量统计（内存里，零落盘）+ 模型目录 + 运行期配置读写。
 * 统计只记计数器，不记请求内容，进程重启即清零。
 */

const MAX_MODELS_CACHE_MS = 60 * 1000
const MAX_RECENT = 20

/** Token 数按用途分桶的累加器。 */
const emptyUsage = () => ({ calls: 0, input: 0, output: 0, failed: 0 })

export function createStats() {
  const startedAt = Date.now()
  const totals = emptyUsage()
  /** provider\0model → { provider, model, calls, input, output, failed, lastAt } */
  const byModel = new Map()
  const recent = []

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
    record({ provider, model, input = 0, output = 0, ok = true, ms = 0, stream = false }) {
      const at = Date.now()
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
    },

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

    reset() {
      totals.calls = 0
      totals.input = 0
      totals.output = 0
      totals.failed = 0
      byModel.clear()
      recent.length = 0
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
