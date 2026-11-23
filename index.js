/**
 * folia-ai-bridge —— 把 Harness 里配置好的模型暴露成 OpenAI 兼容接口，
 * 让 Folia 的「自定义兼容接口」用 DSH 的 AI 生成歌词主题。
 *
 * 对外路由：
 *   POST /v1/chat/completions  → 调 ctx.llm.stream，返回 chat.completion（支持 stream: true）
 *   GET  /v1/models            → 列出当前 provider 的模型（Folia「获取模型」用）
 *   GET  /folia-ai/status      → 自检
 *   GET  /folia-ai/overview    → 设置页用：状态 + 用量 + 模型目录 + 当前配置
 *   POST /folia-ai/config      → 设置页保存：provider / model / token 等
 *   POST /folia-ai/stats/reset → 清零用量
 *
 * 性能取向（热路径只有 /v1/chat/completions，其余是常数）：
 *   1. 空闲零开销：无常驻 interval、无事件订阅；唯一可能的定时器是请求超时扫描，
 *      有请求才建、最后一个结束就清掉。
 *   2. 配置在 apply 时归一化一次，热路径不做 String()/parseFloat()/正则编译。
 *   3. 模型元信息按 provider/model 缓存（成功与失败都缓存），一次连接只解析一次。
 *   4. 流式不逐 token 写：攒够 1KB 或 40ms 才 flush，结束强制 flush；
 *      文本用数组攒再一次性 join；res.write 背压时等 drain。
 *   5. 流式响应不留全文（客户端自己拼），只有非流式攒全文。
 *   6. 用量只进内存计数器，不落盘、不记请求内容，重启即清零。
 */

import { createCatalogue, createStats } from './stats.js'

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
    sendJson(res, 200, { status: await statusPayload(), stats: stats.snapshot(), providers })
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

  ctx.effect(() => ctx.webServer.register({ kind: 'exact', path: '/v1/chat/completions', handler: route(handleChat) }))
  ctx.effect(() => ctx.webServer.register({ kind: 'exact', path: '/v1/models', handler: route(handleModels) }))
  ctx.effect(() => ctx.webServer.register({ kind: 'exact', path: '/folia-ai/status', handler: route(handleStatus, false) }))
  ctx.effect(() => ctx.webServer.register({ kind: 'exact', path: '/folia-ai/overview', handler: route(handleOverview, false) }))
  ctx.effect(() => ctx.webServer.register({ kind: 'exact', path: '/folia-ai/config', handler: route(handleConfig, false) }))
  ctx.effect(() => ctx.webServer.register({ kind: 'exact', path: '/folia-ai/stats/reset', handler: route(handleStatsReset, false) }))

  log('info', '[folia-ai-bridge] OpenAI-compatible endpoint ready at /v1/chat/completions')
}
