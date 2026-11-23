/**
 * folia-ai-bridge —— 把 Harness 里的模型暴露成 OpenAI 兼容接口，并自带 Folia 同步服务。
 *
 * AI 接口：
 *   POST /v1/chat/completions  → 调 ctx.llm.stream，返回 chat.completion（支持 stream: true）
 *   GET  /v1/models            → 列出当前 provider 的模型（Folia「获取模型」用）
 *
 * 同步服务（协议与官方 folia-major/sync-server 一致）：
 *   GET  /health               → 健康检查
 *   GET  /state                → 设置/主题的更新时间与主题总数
 *   GET  /settings             → 视觉设置
 *   PUT  /settings             → 覆盖视觉设置
 *   GET  /themes/manifest      → 256 个分桶的摘要，客户端据此做增量比对
 *   POST /themes/get           → 按 fingerprint 批量取主题
 *   POST /themes/put           → 批量写主题
 *   POST /themes/bucket        → 按桶取主题（首次全量同步）
 *   POST /themes/list          → 分页列出主题
 *   GET  /                     → 同步状态看板（带 DASHBOARD_TOKEN 才能看）
 *
 * 设置页：
 *   GET  /folia-ai/status      → 自检
 *   GET  /folia-ai/overview    → 状态 + 用量 + 模型目录 + 同步统计
 *   POST /folia-ai/config      → 保存 provider / model / token / sync 开关
 *   POST /folia-ai/stats/reset → 清零用量
 *
 * 性能取向（热路径只有 /v1/chat/completions 与同步接口，其余是常数）：
 *   1. 空闲零开销：无常驻 interval、无事件订阅；唯一可能的定时器是请求超时扫描，
 *      有请求才建、最后一个结束就清掉。
 *   2. 配置在 apply 时归一化一次，热路径不做 String()/parseFloat()/正则编译。
 *   3. 模型元信息按 provider/model 缓存（成功与失败都缓存），一次连接只解析一次。
 *   4. 流式不逐 token 写：攒够 1KB 或 40ms 才 flush，结束强制 flush；
 *      文本用数组攒再一次性 join；res.write 背压时等 drain。
 *   5. 流式响应不留全文（客户端自己拼），只有非流式攒全文。
 *   6. 用量只进内存计数器，不落盘、不记请求内容，重启即清零。
 *   7. 同步库用 Node 内置 node:sqlite，零原生依赖；库文件按需懒打开，不用同步就不建。
 */

import { createCatalogue, createStats } from './stats.js'
import { openStore } from './sync-store.js'
import { mkdirSync } from 'node:fs'
import { dirname, join } from 'node:path'

export const name = 'folia-ai-bridge'
export const inject = ['webServer']

const DEFAULTS = Object.freeze({
  /** 空 = 不校验，Folia 里密钥随便填一个非空字符串即可；填了就要求 Bearer 与它一致。 */
  token: '',
  /** 空 = 用 DSH 默认模型所在的 provider。 */
  provider: '',
  /** 空 = 跟随 Folia 请求里的 model，落不到这个 provider 时回落到 DSH 默认模型。 */
  model: '',
  /** 'auto' = 取该模型最低的一档思考强度；'' = 不指定；其余按原值传。 */
  reasoningEffort: 'auto',
  /** 输出上限（Folia 主题请求自己带 max_tokens，取两者较小值）。 */
  maxTokens: 8192,
  temperature: 0.7,
  /** 同步服务开关。 */
  syncEnabled: true,
  /** Folia 里「Bearer Token」填的那个；空 = 同步接口不校验（只建议本机使用）。 */
  syncToken: '',
  /** 看板口令；空 = 关闭看板。 */
  dashboardToken: '',
  /** 同步库路径；空 = 放在 DSH 用户目录下。 */
  syncDbPath: '',
})

const BODY_LIMIT = 1024 * 1024
const REQUEST_TIMEOUT_MS = 5 * 60 * 1000
const SWEEP_MS = 5000
const FLUSH_CHARS = 1024
const FLUSH_MS = 40
const MODEL_CACHE_TTL_MS = 10 * 60 * 1000
const MODEL_CACHE_FAIL_TTL_MS = 60 * 1000
const MODEL_CACHE_MAX = 64

const CORS = Object.freeze({
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, content-type',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
})
const JSON_HEADERS = Object.freeze({ 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', ...CORS })
const SSE_HEADERS = Object.freeze({
  'Content-Type': 'text/event-stream; charset=utf-8',
  'Cache-Control': 'no-store',
  Connection: 'keep-alive',
  'X-Accel-Buffering': 'no',
  ...CORS,
})

const JSON_INSTRUCTION = 'Return exactly one JSON object and nothing else: no markdown fences, no prose before or after it.'

const errorText = (error) => (error instanceof Error ? error.message || error.name : String(error ?? 'unknown error'))

const numberOr = (value, fallback) => {
  const parsed = typeof value === 'number' ? value : Number.parseFloat(String(value ?? '').trim())
  return Number.isFinite(parsed) ? parsed : fallback
}

const isJsonFormat = (format) => {
  const type = format && typeof format === 'object' ? format.type : undefined
  return type === 'json_object' || type === 'json_schema'
}

const textOfContent = (content) => {
  if (typeof content === 'string') return content
  if (!Array.isArray(content)) return ''
  let out = ''
  for (const part of content) {
    if (part && typeof part.text === 'string') out += part.text
  }
  return out
}

const splitMessages = (messages) => {
  let system = ''
  let text = ''
  for (const message of Array.isArray(messages) ? messages : []) {
    if (!message || typeof message !== 'object') continue
    const body = textOfContent(message.content).trim()
    if (!body) continue
    const role = message.role
    if (role === 'system' || role === 'developer') system = system ? `${system}\n\n${body}` : body
    else if (role === 'assistant') text = text ? `${text}\n\nAssistant: ${body}` : `Assistant: ${body}`
    else if (role === 'tool') text = text ? `${text}\n\nTool: ${body}` : `Tool: ${body}`
    else text = text ? `${text}\n\n${body}` : body
  }
  return { system, text }
}

/** POST 的同源校验：写配置的接口不能被别的站点跨站调用。 */
const sameOrigin = (req) => {
  const origin = req.headers.origin
  if (!origin) return true
  try {
    return new URL(origin).host === String(req.headers.host ?? '')
  } catch {
    return false
  }
}

export function apply(ctx, rawConfig = {}) {
  const raw = rawConfig && typeof rawConfig === 'object' ? rawConfig : {}

  const token = String(raw.token ?? DEFAULTS.token ?? '').trim()
  const fixedProvider = String(raw.provider ?? DEFAULTS.provider ?? '').trim()
  const fixedModel = String(raw.model ?? DEFAULTS.model ?? '').trim()
  const effortSetting = String(raw.reasoningEffort ?? DEFAULTS.reasoningEffort ?? '').trim()
  const maxTokensCap = Math.max(1, Math.floor(numberOr(raw.maxTokens, DEFAULTS.maxTokens)))
  const temperatureDefault = Math.min(2, Math.max(0, numberOr(raw.temperature, DEFAULTS.temperature)))
  const authPattern = token ? /^Bearer\s+(.+)$/i : null

  // ---- 同步服务配置（同样只解析一次） ----
  const syncEnabled = raw.syncEnabled !== false
  const syncToken = String(raw.syncToken ?? DEFAULTS.syncToken ?? '').trim()
  const dashboardToken = String(raw.dashboardToken ?? DEFAULTS.dashboardToken ?? '').trim()
  const syncDbPathSetting = String(raw.syncDbPath ?? DEFAULTS.syncDbPath ?? '').trim()
  const syncAuthPattern = syncToken ? /^Bearer\s+(.+)$/i : null

  const stats = createStats()
  const catalogue = createCatalogue()

  const log = (level, message) => {
    const logger = ctx.logger
    if (logger && typeof logger[level] === 'function') logger[level](message)
    else if (typeof console[level] === 'function') console[level](message)
  }

  const sendJson = (res, status, payload) => {
    if (res.writableEnded) return
    res.writeHead(status, JSON_HEADERS)
    res.end(JSON.stringify(payload))
  }

  const fail = (res, status, message) => sendJson(res, status, { error: message })

  const authorized = authPattern === null
    ? () => true
    : (req) => {
      const match = authPattern.exec(String(req.headers.authorization ?? '').trim())
      return Boolean(match) && match[1].trim() === token
    }

  const readJson = async (req) => {
    const chunks = []
    let size = 0
    for await (const chunk of req) {
      size += chunk.length
      if (size > BODY_LIMIT) throw new Error('request body is too large')
      chunks.push(chunk)
    }
    const text = Buffer.concat(chunks).toString('utf8').trim()
    if (!text) return {}
    const parsed = JSON.parse(text)
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
      throw new Error('request body must be a JSON object')
    }
    return parsed
  }

  const llmOf = () => {
    const llm = ctx.get('llm')
    if (!llm || typeof llm.stream !== 'function') {
      throw new Error('the Harness model service (llm) is unavailable in this profile')
    }
    return llm
  }

  const defaultSelection = () => {
    try {
      const selection = ctx.get('agentDefaultModel')?.currentSelection?.()
      return selection && selection.provider && selection.model
        ? { provider: selection.provider, model: selection.model }
        : undefined
    } catch {
      return undefined
    }
  }

  // ---- 模型元信息缓存 ----
  const modelCache = new Map()
  const cacheKey = (provider, model) => `${provider}\u0000${model}`

  const rememberModel = (provider, model, info) => {
    const key = cacheKey(provider, model)
    modelCache.delete(key)
    if (modelCache.size >= MODEL_CACHE_MAX) modelCache.delete(modelCache.keys().next().value)
    modelCache.set(key, { info, at: Date.now() })
    return info
  }

  const modelInfoOf = async (llm, provider, model) => {
    const cached = modelCache.get(cacheKey(provider, model))
    if (cached) {
      const ttl = cached.info ? MODEL_CACHE_TTL_MS : MODEL_CACHE_FAIL_TTL_MS
      if (Date.now() - cached.at < ttl) return cached.info
      modelCache.delete(cacheKey(provider, model))
    }
    if (typeof llm.resolveModelInfo !== 'function') return null
    try {
      return rememberModel(provider, model, (await llm.resolveModelInfo(provider, model)) ?? null)
    } catch {
      return rememberModel(provider, model, null)
    }
  }

  let providerFallback = null
  const firstSelection = async (llm) => {
    if (providerFallback && Date.now() - providerFallback.at < MODEL_CACHE_TTL_MS) return providerFallback.value
    let value
    const providers = typeof llm.listProviders === 'function' ? llm.listProviders() : []
    for (const entry of providers) {
      try {
        const models = await llm.listModels(entry.id)
        if (models && models.length) {
          value = { provider: entry.id, model: models[0].id }
          break
        }
      } catch {
        // 这个 provider 列不出来就换下一个
      }
    }
    providerFallback = { value, at: Date.now() }
    return value
  }

  const resolveRoute = async (llm, requestedModel) => {
    if (fixedProvider && fixedModel) return { provider: fixedProvider, model: fixedModel }
    const base = defaultSelection() ?? (await firstSelection(llm))
    if (!base) {
      throw new Error('no Harness model is configured: choose a default model in DSH, or set provider/model in this plugin config')
    }
    const provider = fixedProvider || base.provider
    if (fixedModel) return { provider, model: fixedModel }
    const asked = typeof requestedModel === 'string' ? requestedModel.trim() : ''
    if (asked && asked !== base.model) {
      if (await modelInfoOf(llm, provider, asked)) return { provider, model: asked }
    }
    return { provider, model: base.model }
  }

  const resolveEffort = async (llm, provider, model) => {
    if (effortSetting && effortSetting !== 'auto') return effortSetting
    if (effortSetting === '') return undefined
    const info = await modelInfoOf(llm, provider, model)
    return info?.reasoning?.efforts?.[0]?.id
  }

  // ---- 超时扫描：空闲不留定时器 ----
  const active = new Set()
  let sweepTimer = null

  const sweepAll = () => {
    const now = Date.now()
    for (const entry of active) {
      if (now - entry.at >= REQUEST_TIMEOUT_MS) {
        active.delete(entry)
        entry.controller.abort()
      }
    }
    if (active.size === 0 && sweepTimer !== null) {
      clearInterval(sweepTimer)
      sweepTimer = null
    }
  }

  const beginRequest = (res) => {
    const controller = new AbortController()
    const entry = { at: Date.now(), controller }
    active.add(entry)
    if (sweepTimer === null) {
      sweepTimer = setInterval(sweepAll, SWEEP_MS)
      sweepTimer.unref?.()
    }
    const onClose = () => controller.abort()
    res.on('close', onClose)
    return {
      signal: controller.signal,
      end: () => {
        active.delete(entry)
        res.off?.('close', onClose)
        if (active.size === 0 && sweepTimer !== null) {
          clearInterval(sweepTimer)
          sweepTimer = null
        }
      },
    }
  }

  ctx.effect(() => () => {
    if (sweepTimer !== null) clearInterval(sweepTimer)
    sweepTimer = null
    for (const entry of active) entry.controller.abort()
    active.clear()
  })

  // ---- SSE 写入器：攒批 + 背压 ----
  const openSse = (res, signal, meta) => {
    res.writeHead(200, SSE_HEADERS)
    const frame = (choices, extra) => `data: ${JSON.stringify({
      id: meta.id, object: 'chat.completion.chunk', created: meta.created, model: meta.model, choices, ...extra,
    })}\n\n`

    let parts = []
    let size = 0
    let lastFlush = Date.now()
    let blocked = false

    const write = async (payload) => {
      if (res.writableEnded) throw new Error('the client closed the connection')
      if (!blocked && res.write(payload)) return
      blocked = true
      await new Promise((resolve) => {
        const done = () => {
          res.off('drain', done)
          signal.removeEventListener('abort', done)
          blocked = false
          resolve()
        }
        res.once('drain', done)
        signal.addEventListener('abort', done, { once: true })
      })
      if (signal.aborted) throw new Error('the client closed the connection')
    }

    const flush = async () => {
      if (size === 0) return
      const content = parts.length === 1 ? parts[0] : parts.join('')
      parts = []
      size = 0
      lastFlush = Date.now()
      await write(frame([{ index: 0, delta: { content }, finish_reason: null }]))
    }

    return {
      start: () => write(frame([{ index: 0, delta: { role: 'assistant', content: '' }, finish_reason: null }])),
      push: async (text) => {
        parts.push(text)
        size += text.length
        if (size >= FLUSH_CHARS || Date.now() - lastFlush >= FLUSH_MS) await flush()
      },
      finish: async (payload) => {
        await flush()
        await write(frame([{ index: 0, delta: {}, finish_reason: 'stop' }], payload))
        if (!res.writableEnded) res.end('data: [DONE]\n\n')
      },
      error: async (message) => {
        await flush().catch(() => {})
        await write(`data: ${JSON.stringify({ error: { message, type: 'dsh_bridge_error' } })}\n\n`)
        if (!res.writableEnded) res.end('data: [DONE]\n\n')
      },
    }
  }

  const generate = async (llm, request, sink) => {
    const collected = sink === null ? [] : null
    let sawText = false
    let usage = null
    let failure = null

    for await (const chunk of llm.stream({
      provider: request.provider,
      model: request.model,
      messages: [{ role: 'user', content: [{ type: 'text', text: request.text }] }],
      ...(request.system ? { system: request.system } : {}),
      temperature: request.temperature,
      maxTokens: request.maxTokens,
      ...(request.reasoningEffort ? { reasoningEffort: request.reasoningEffort } : {}),
      signal: request.signal,
    })) {
      if (!chunk) continue
      switch (chunk.type) {
        case 'text-delta': {
          const text = chunk.text
          if (!text) break
          sawText = true
          if (collected) collected.push(text)
          else await sink(text)
          break
        }
        case 'usage':
          usage = chunk.usage ?? null
          break
        case 'finish': {
          const reason = chunk.reason ?? {}
          if (reason.kind === 'error' || reason.kind === 'aborted') {
            failure = reason.failure ?? { message: `the model request ${reason.kind}` }
          }
          break
        }
      }
    }

    if (failure) {
      const error = new Error(failure.message || 'the model request failed')
      error.code = failure.code
      throw error
    }
    if (collected === null) {
      if (!sawText) throw new Error('the model returned an empty answer')
      return { text: '', usage }
    }
    const text = collected.join('')
    if (!text.trim()) throw new Error('the model returned an empty answer')
    return { text, usage }
  }

  const usagePayload = (usage) => {
    const input = numberOr(usage?.inputTokens, 0)
    const output = numberOr(usage?.outputTokens, 0)
    return { prompt_tokens: input, completion_tokens: output, total_tokens: numberOr(usage?.totalTokens, input + output) }
  }

  const buildRequest = async (body) => {
    const llm = llmOf()
    const { system, text } = splitMessages(body.messages)
    if (!text) throw new Error('messages must contain at least one user message with text')
    const route = await resolveRoute(llm, body.model)
    const wanted = numberOr(body.max_tokens ?? body.max_completion_tokens, 0)
    return {
      llm,
      system: isJsonFormat(body.response_format) ? (system ? `${system}\n\n${JSON_INSTRUCTION}` : JSON_INSTRUCTION) : system,
      text,
      provider: route.provider,
      model: route.model,
      reasoningEffort: await resolveEffort(llm, route.provider, route.model),
      maxTokens: wanted > 0 ? Math.min(Math.ceil(wanted), maxTokensCap) : maxTokensCap,
      temperature: Math.min(2, Math.max(0, numberOr(body.temperature, temperatureDefault))),
    }
  }

  const handleChat = async (req, res) => {
    if (req.method !== 'POST') return fail(res, 405, 'use POST /v1/chat/completions')

    let body
    try {
      body = await readJson(req)
    } catch (error) {
      return fail(res, 400, errorText(error))
    }

    let request
    const startedAt = Date.now()
    try {
      request = await buildRequest(body)
    } catch (error) {
      stats.record({ provider: fixedProvider || '-', model: '-', ok: false, ms: Date.now() - startedAt, stream: body.stream === true })
      return fail(res, 400, errorText(error))
    }

    const meta = {
      id: `chatcmpl-dsh-${Date.now().toString(36)}`,
      created: Math.floor(Date.now() / 1000),
      model: request.model,
    }
    const abort = beginRequest(res)
    const streaming = body.stream === true
    const note = (ok, usage, error) => stats.record({
      provider: request.provider,
      model: request.model,
      input: numberOr(usage?.inputTokens, 0),
      output: numberOr(usage?.outputTokens, 0),
      ok,
      ms: Date.now() - startedAt,
      stream: streaming,
    })

    try {
      if (streaming) {
        const sse = openSse(res, abort.signal, meta)
        try {
          await sse.start()
          const result = await generate(request.llm, { ...request, signal: abort.signal }, (text) => sse.push(text))
          note(true, result.usage)
          if (!abort.signal.aborted) await sse.finish({ usage: usagePayload(result.usage) })
        } catch (error) {
          note(false, null, error)
          log('warn', `[folia-ai-bridge] stream failed: ${errorText(error)}`)
          await sse.error(errorText(error)).catch(() => {})
        }
        return
      }

      const result = await generate(request.llm, { ...request, signal: abort.signal }, null)
      note(true, result.usage)
      sendJson(res, 200, {
        ...meta,
        object: 'chat.completion',
        choices: [{ index: 0, message: { role: 'assistant', content: result.text }, finish_reason: 'stop' }],
        usage: usagePayload(result.usage),
      })
    } catch (error) {
      note(false, null, error)
      log('warn', `[folia-ai-bridge] request failed: ${errorText(error)}`)
      if (!res.headersSent) fail(res, 502, errorText(error))
      else if (!res.writableEnded) res.end()
    } finally {
      abort.end()
    }
  }

  const handleModels = async (req, res) => {
    const llm = llmOf()
    const base = defaultSelection()
    const provider = fixedProvider || base?.provider
    const ids = []
    const seen = new Set()
    const push = (id) => {
      const value = typeof id === 'string' ? id.trim() : ''
      if (value && !seen.has(value)) {
        seen.add(value)
        ids.push(value)
      }
    }
    if (provider) {
      try {
        for (const entry of await llm.listModels(provider)) push(entry.id)
      } catch {
        // 列不出来就只回固定/默认模型
      }
    }
    push(fixedModel)
    push(base?.model)
    sendJson(res, 200, {
      object: 'list',
      data: ids.map((id) => ({ id, object: 'model', created: 0, owned_by: 'deepseek-harness' })),
    })
  }

  const statusPayload = async () => {
    const llm = ctx.get('llm')
    const base = defaultSelection()
    let origin = ''
    try {
      origin = ctx.webServer.getOrigin()
    } catch {
      origin = ''
    }
    return {
      ok: Boolean(llm && typeof llm.stream === 'function'),
      endpoint: '/v1/chat/completions',
      origin,
      provider: fixedProvider || base?.provider || null,
      model: fixedModel || base?.model || null,
      defaultProvider: base?.provider ?? null,
      defaultModel: base?.model ?? null,
      reasoningEffort: effortSetting,
      tokenRequired: Boolean(token),
      maxTokens: maxTokensCap,
      temperature: temperatureDefault,
      llmProviders: typeof llm?.listProviders === 'function' ? llm.listProviders().map((entry) => ({ id: entry.id, name: entry.name || entry.id })) : [],
      hasConfigEditor: Boolean(ctx.get('configEditor')),
      syncEnabled,
      syncTokenRequired: Boolean(syncToken),
      dashboardEnabled: Boolean(dashboardToken),
      syncEndpoint: origin ? `${origin}` : null,
    }
  }

  const handleStatus = async (req, res) => sendJson(res, 200, await statusPayload())

  const handleOverview = async (req, res) => {
    const llm = ctx.get('llm')
    let providers = []
    if (llm && typeof llm.listProviders === 'function') {
      try {
        providers = (await catalogue.list(llm)).providers
      } catch {
        providers = []
      }
    }
    let sync = null
    if (syncEnabled) {
      try {
        const store = storeOf()
        sync = { enabled: true, ...(await store.dashboard()), dbPath: storePath, tokenRequired: Boolean(syncToken) }
      } catch (error) {
        sync = { enabled: true, error: errorText(error), dbPath: storePath }
      }
    } else {
      sync = { enabled: false }
    }
    sendJson(res, 200, { status: await statusPayload(), stats: stats.snapshot(), providers, sync })
  }

  const handleConfig = async (req, res) => {
    if (req.method !== 'POST') return fail(res, 405, 'use POST')
    if (!sameOrigin(req)) return fail(res, 403, 'cross-site request refused')
    const editor = ctx.get('configEditor')
    const entry = ctx.fiber?.entry
    if (!editor || !entry) return fail(res, 503, 'this profile cannot save plugin configuration')

    let body
    try {
      body = await readJson(req)
    } catch (error) {
      return fail(res, 400, errorText(error))
    }

    const patch = {}
    if (typeof body.provider === 'string') patch.provider = body.provider.trim()
    if (typeof body.model === 'string') patch.model = body.model.trim()
    if (typeof body.token === 'string') patch.token = body.token.trim()
    if (typeof body.reasoningEffort === 'string') patch.reasoningEffort = body.reasoningEffort.trim()
    if (body.maxTokens !== undefined) patch.maxTokens = Math.max(1, Math.floor(numberOr(body.maxTokens, DEFAULTS.maxTokens)))
    if (body.temperature !== undefined) patch.temperature = Math.min(2, Math.max(0, numberOr(body.temperature, DEFAULTS.temperature)))
    if (body.syncEnabled !== undefined) patch.syncEnabled = body.syncEnabled !== false
    if (typeof body.syncToken === 'string') patch.syncToken = body.syncToken.trim()
    if (typeof body.dashboardToken === 'string') patch.dashboardToken = body.dashboardToken.trim()
    if (Object.keys(patch).length === 0) return fail(res, 400, 'nothing to save')

    try {
      await editor.edit(entry, (current) => ({ ...current, ...patch }))
    } catch (error) {
      return fail(res, 400, errorText(error))
    }
    catalogue.invalidate()
    sendJson(res, 200, { ok: true, patched: Object.keys(patch) })
  }

  const handleStatsReset = async (req, res) => {
    if (req.method !== 'POST') return fail(res, 405, 'use POST')
    if (!sameOrigin(req)) return fail(res, 403, 'cross-site request refused')
    stats.reset()
    sendJson(res, 200, { ok: true, stats: stats.snapshot() })
  }

  const route = (handler, requireToken = true) => async (req, res) => {
    try {
      if (req.method === 'OPTIONS') {
        res.writeHead(204, CORS)
        res.end()
        return
      }
      if (requireToken && !authorized(req)) {
        return fail(res, 401, 'unauthorized: the Authorization header does not carry the configured bridge token')
      }
      await handler(req, res)
    } catch (error) {
      log('warn', `[folia-ai-bridge] ${req.method} ${req.url} failed: ${errorText(error)}`)
      if (!res.headersSent) fail(res, 500, errorText(error))
      else if (!res.writableEnded) res.end()
    }
  }

  // ---- 同步服务 ----
  /** 懒打开：不用同步就不建库、不占句柄。 */
  let store = null
  let storePath = ''

  /** 同步库默认位置：DSH_HOME（DSH 自己设的）→ 用户目录下的 .dsh。 */
  const defaultSyncDbPath = () => {
    const home = process.env.DSH_HOME || join(process.env.USERPROFILE || process.env.HOME || process.cwd(), '.dsh')
    return join(home, 'folia-sync', 'folia-sync.db')
  }

  const storeOf = () => {
    if (store) return store
    storePath = syncDbPathSetting || defaultSyncDbPath()
    try {
      mkdirSync(dirname(storePath), { recursive: true })
    } catch {
      // 目录已存在或无权限：让 openStore 自己报错
    }
    store = openStore(storePath)
    log('info', `[folia-ai-bridge] sync store opened at ${storePath}`)
    return store
  }

  const syncAuthorized = (req) => {
    if (syncAuthPattern === null) return true
    const match = syncAuthPattern.exec(String(req.headers.authorization ?? '').trim())
    return Boolean(match) && match[1].trim() === syncToken
  }

  const readBody = async (req) => {
    const chunks = []
    let size = 0
    for await (const chunk of req) {
      size += chunk.length
      if (size > BODY_LIMIT) throw new Error('request body is too large')
      chunks.push(chunk)
    }
    const text = Buffer.concat(chunks).toString('utf8').trim()
    if (!text) return null
    return JSON.parse(text)
  }

  /** 同步接口的统一外壳：CORS、鉴权、错误归一。 */
  const syncRoute = (handler, { needAuth = true } = {}) => async (req, res) => {
    try {
      if (req.method === 'OPTIONS') {
        res.writeHead(204, CORS)
        res.end()
        return
      }
      if (!syncEnabled) return fail(res, 503, 'the sync service is turned off in the plugin settings')
      if (needAuth && !syncAuthorized(req)) {
        return fail(res, 401, 'unauthorized: the Bearer token does not match syncToken')
      }
      const result = await handler(req)
      sendJson(res, result?.status ?? 200, result?.body ?? result)
    } catch (error) {
      log('warn', `[folia-ai-bridge] sync ${req.method} ${req.url} failed: ${errorText(error)}`)
      if (!res.headersSent) fail(res, 500, errorText(error))
      else if (!res.writableEnded) res.end()
    }
  }

  const dashboardPage = (state) => `<!doctype html>
<html lang="zh-CN"><head><meta charset="utf-8"><title>Folia 同步服务</title>
<meta name="viewport" content="width=device-width,initial-scale=1">
<style>
:root{color-scheme:light dark}
body{font:14px/1.6 system-ui,-apple-system,"Segoe UI",sans-serif;margin:0;padding:32px;background:#111;color:#eee}
h1{font-size:18px;margin:0 0 4px}
.sub{color:#888;margin-bottom:24px;font-size:13px}
.grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(150px,1fr));gap:12px;max-width:760px}
.card{background:#1b1b1b;border:1px solid #2a2a2a;border-radius:10px;padding:14px 16px}
.num{font-size:22px;font-weight:600;font-variant-numeric:tabular-nums}
.label{color:#888;font-size:12px}
.ok{color:#4ade80}
</style></head>
<body>
<h1>Folia 同步服务</h1>
<div class="sub"><span class="ok">●</span> 运行中 · 后端 folia-ai-bridge</div>
<div class="grid">
  <div class="card"><div class="num">${state.themeCount ?? 0}</div><div class="label">已同步主题</div></div>
  <div class="card"><div class="num">${state.settingsUpdatedAt ? '有' : '无'}</div><div class="label">视觉设置</div></div>
  <div class="card"><div class="num" style="font-size:13px;word-break:break-all">${state.themesUpdatedAt ?? '—'}</div><div class="label">主题更新时间</div></div>
  <div class="card"><div class="num" style="font-size:13px;word-break:break-all">${state.settingsUpdatedAt ?? '—'}</div><div class="label">设置更新时间</div></div>
</div>
</body></html>`

  const handleSyncHealth = async () => ({ ok: true, schemaVersion: 1, backend: 'folia-ai-bridge' })

  const handleSyncState = async () => storeOf().state()

  /** 同一路径按方法分流，保持官方协议（GET 读、PUT 写）。 */
  const handleSyncSettings = async (req) => {
    const method = (req.method ?? 'GET').toUpperCase()
    if (method === 'GET') return storeOf().getSettings()
    if (method === 'PUT' || method === 'POST') return storeOf().putSettings(await readBody(req))
    return { status: 405, body: { ok: false, error: 'use GET or PUT' } }
  }

  const handleSyncManifest = async () => storeOf().manifest()

  const handleSyncThemesGet = async (req) => {
    const body = await readBody(req)
    return storeOf().getThemes(body?.fingerprints)
  }

  const handleSyncThemesPut = async (req) => {
    const body = await readBody(req)
    return storeOf().putThemes(body?.themes)
  }

  const handleSyncThemesBucket = async (req) => {
    const body = await readBody(req)
    return storeOf().listThemes(body?.bucketIds, body?.limit)
  }

  const handleSyncThemesList = async (req) => {
    const body = await readBody(req)
    const limit = Math.min(Math.max(Number(body?.limit) || 500, 1), 1000)
    const all = []
    for (let start = 0; start < 256; start += 32) {
      const ids = Array.from({ length: 32 }, (_, i) => start + i)
      const page = await storeOf().listThemes(ids, 1000)
      all.push(...(page.themes ?? []))
    }
    const offset = Math.max(Number(body?.offset) || 0, 0)
    return { themes: all.slice(offset, offset + limit), total: all.length }
  }

  const handleSyncDashboard = async (req, res) => {
    const url = new URL(req.url ?? '/', 'http://dsh.internal')
    if (!dashboardToken) return fail(res, 404, 'dashboard is disabled (set dashboardToken in the plugin settings)')
    if (url.searchParams.get('token') !== dashboardToken) {
      return fail(res, 401, 'unauthorized: add ?token=<dashboardToken>')
    }
    const state = await storeOf().dashboard()
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' })
    res.end(dashboardPage(state))
  }

  ctx.effect(() => ctx.webServer.register({ kind: 'exact', path: '/v1/chat/completions', handler: route(handleChat) }))
  ctx.effect(() => ctx.webServer.register({ kind: 'exact', path: '/v1/models', handler: route(handleModels) }))
  ctx.effect(() => ctx.webServer.register({ kind: 'exact', path: '/folia-ai/status', handler: route(handleStatus, false) }))
  ctx.effect(() => ctx.webServer.register({ kind: 'exact', path: '/folia-ai/overview', handler: route(handleOverview, false) }))
  ctx.effect(() => ctx.webServer.register({ kind: 'exact', path: '/folia-ai/config', handler: route(handleConfig, false) }))
  ctx.effect(() => ctx.webServer.register({ kind: 'exact', path: '/folia-ai/stats/reset', handler: route(handleStatsReset, false) }))

  if (syncEnabled) {
    ctx.effect(() => ctx.webServer.register({ kind: 'exact', path: '/health', handler: syncRoute(handleSyncHealth, { needAuth: false }) }))
    ctx.effect(() => ctx.webServer.register({ kind: 'exact', path: '/state', handler: syncRoute(handleSyncState) }))
    ctx.effect(() => ctx.webServer.register({ kind: 'exact', path: '/settings', handler: syncRoute(handleSyncSettings) }))
    ctx.effect(() => ctx.webServer.register({ kind: 'exact', path: '/themes/manifest', handler: syncRoute(handleSyncManifest) }))
    ctx.effect(() => ctx.webServer.register({ kind: 'exact', path: '/themes/get', handler: syncRoute(handleSyncThemesGet) }))
    ctx.effect(() => ctx.webServer.register({ kind: 'exact', path: '/themes/put', handler: syncRoute(handleSyncThemesPut) }))
    ctx.effect(() => ctx.webServer.register({ kind: 'exact', path: '/themes/bucket', handler: syncRoute(handleSyncThemesBucket) }))
    ctx.effect(() => ctx.webServer.register({ kind: 'exact', path: '/themes/list', handler: syncRoute(handleSyncThemesList) }))
    ctx.effect(() => ctx.webServer.register({ kind: 'exact', path: '/', handler: syncRoute(handleSyncDashboard, { needAuth: false }) }))

    ctx.effect(() => () => {
      if (store) {
        try {
          store.close()
        } catch {
          // 关闭失败不影响卸载
        }
        store = null
      }
    })
  }

  log('info', `[folia-ai-bridge] ready · AI at /v1/chat/completions${syncEnabled ? ' · sync at /state, /themes/*' : ' · sync disabled'}`)
}
