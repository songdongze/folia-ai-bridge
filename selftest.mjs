// 离线自测：假 ctx / llm / res 跑一遍 apply()，检查行为与「空闲零开销」不变量。
import { apply, inject, name } from './index.js'

const routes = new Map()
const fakeRes = () => ({
  statusCode: 0,
  headers: null,
  body: '',
  headersSent: false,
  writableEnded: false,
  writeHead(status, headers) { this.statusCode = status; this.headers = headers; this.headersSent = true },
  write(chunk) { this.body += chunk; return true },
  end(chunk) { if (chunk) this.body += chunk; this.writableEnded = true },
  on() {},
  once() {},
  off() {},
})

const streamOf = (chunks) => (async function* () { for (const c of chunks) yield c })()
const settle = (ms = 60) => new Promise((r) => setTimeout(r, ms))

const makeCtx = ({ chunks = [], providers = [{ id: 'deepseek-official', name: 'DeepSeek' }], selection = { provider: 'deepseek-official', model: 'deepseek-v4-flash' } } = {}) => {
  const calls = []
  let resolveCalls = 0
  let listCalls = 0
  const llm = {
    listProviders: () => providers,
    listModels: async (provider) => { listCalls += 1; return provider === 'deepseek-official' ? [{ id: 'deepseek-v4-flash', name: 'Flash' }] : [] },
    resolveModelInfo: async (provider, m) => {
      resolveCalls += 1
      if (provider !== 'deepseek-official' || m !== 'deepseek-v4-flash') throw new Error('unknown model')
      return { provider, id: m, reasoning: { efforts: [{ id: 'low' }, { id: 'high' }] } }
    },
    stream: (options) => { calls.push(options); return streamOf(chunks) },
  }
  const ctx = {
    logger: { info() {}, warn() {}, error() {} },
    get: (key) => (key === 'llm' ? llm : key === 'agentDefaultModel' ? { currentSelection: () => selection } : undefined),
    webServer: {
      getOrigin: () => 'http://127.0.0.1:13691',
      register: (route) => { routes.set(route.path, route.handler); return () => routes.delete(route.path) },
    },
    effect: (fn) => fn(),
  }
  return { ctx, calls, stats: () => ({ resolveCalls, listCalls }) }
}

const ok = []
const bad = []
const check = (label, condition, extra = '') => (condition ? ok : bad).push(`${label}${extra ? ` — ${extra}` : ''}`)

const post = (path, body, headers = {}) => {
  const req = { method: 'POST', url: path, headers: { 'content-type': 'application/json', ...headers }, async* [Symbol.asyncIterator]() { yield Buffer.from(JSON.stringify(body)) } }
  const res = fakeRes()
  routes.get(path)(req, res)
  return res
}

// 1) 非流式
{
  const { ctx, calls } = makeCtx({ chunks: [{ type: 'text-delta', index: 0, text: '{"light":' }, { type: 'text-delta', index: 0, text: '{} }' }, { type: 'usage', usage: { inputTokens: 11, outputTokens: 22 } }, { type: 'finish', reason: { kind: 'stop' } }] })
  apply(ctx, {})
  check('routes registered', routes.size === 6, [...routes.keys()].join(','))
  const res = post('/v1/chat/completions', {
    model: 'deepseek-v4-flash',
    messages: [{ role: 'system', content: 'SYSTEM A' }, { role: 'user', content: 'LYRICS' }],
    response_format: { type: 'json_object' },
    max_tokens: 8192,
  })
  await settle()
  const payload = JSON.parse(res.body)
  const call = calls[0]
  check('non-stream status 200', res.statusCode === 200, String(res.statusCode))
  check('non-stream content joined', payload.choices?.[0]?.message?.content === '{"light":{} }', JSON.stringify(payload.choices?.[0]?.message))
  check('usage mapped', payload.usage?.prompt_tokens === 11 && payload.usage?.completion_tokens === 22)
  check('system carries JSON instruction', call.system.includes('SYSTEM A') && call.system.includes('JSON object'))
  check('user text extracted', call.messages[0].content[0].text === 'LYRICS')
  check('maxTokens capped', call.maxTokens === 8192, String(call.maxTokens))
  check('effort auto→lowest', call.reasoningEffort === 'low', String(call.reasoningEffort))
  check('route from default selection', call.provider === 'deepseek-official' && call.model === 'deepseek-v4-flash')
  check('id/created/model at top level', payload.object === 'chat.completion' && typeof payload.id === 'string' && typeof payload.created === 'number' && payload.model === 'deepseek-v4-flash')
}

// 2) 流式 + 攒批
{
  const chunks = [{ type: 'text-delta', index: 0, text: 'a'.repeat(1500) }, { type: 'text-delta', index: 0, text: 'b'.repeat(10) }, { type: 'finish', reason: { kind: 'stop' } }]
  const { ctx } = makeCtx({ chunks })
  apply(ctx, {})
  const res = post('/v1/chat/completions', { messages: [{ role: 'user', content: 'hi' }], stream: true })
  await settle(120)
  const frames = res.body.split('\n\n').filter((f) => f.startsWith('data: {'))
  const deltas = frames.map((f) => JSON.parse(f.slice(6))).filter((p) => p.choices?.[0]?.delta?.content)
  check('stream content-type', String(res.headers?.['Content-Type']).startsWith('text/event-stream'))
  check('stream batched (1500+10 → 2 delta frames)', deltas.length === 2, `frames=${deltas.length}`)
  check('stream text preserved', deltas.map((p) => p.choices[0].delta.content).join('') === 'a'.repeat(1500) + 'b'.repeat(10))
  check('stream done marker', res.body.trimEnd().endsWith('data: [DONE]'))
  check('finish frame carries usage key', res.body.includes('"finish_reason":"stop"'))
}

// 3) token 校验 / 模型回落 / 空 messages
{
  const { ctx, stats } = makeCtx({ chunks: [{ type: 'text-delta', index: 0, text: 'x' }, { type: 'finish', reason: { kind: 'stop' } }] })
  apply(ctx, { token: 'secret' })
  const unauthorized = post('/v1/chat/completions', { messages: [{ role: 'user', content: 'hi' }] })
  await settle(20)
  check('token enforced', unauthorized.statusCode === 401, String(unauthorized.statusCode))

  const fallback = post('/v1/chat/completions', { model: 'gpt-5-nope', messages: [{ role: 'user', content: 'hi' }] }, { authorization: 'Bearer secret' })
  await settle()
  check('unknown model falls back', JSON.parse(fallback.body).model === 'deepseek-v4-flash')

  const again = post('/v1/chat/completions', { model: 'gpt-5-nope', messages: [{ role: 'user', content: 'hi' }] }, { authorization: 'Bearer secret' })
  await settle()
  check('failed model lookup cached (resolveModelInfo called once)', stats().resolveCalls <= 2, `resolveModelInfo=${stats().resolveCalls}`)

  const empty = post('/v1/chat/completions', { messages: [] }, { authorization: 'Bearer secret' })
  await settle(20)
  check('empty messages rejected', empty.statusCode === 400, String(empty.statusCode))
}

// 4) 模型报错
{
  const { ctx } = makeCtx({ chunks: [{ type: 'finish', reason: { kind: 'error', failure: { code: 'AUTH', message: 'bad key' } } }] })
  apply(ctx, {})
  const res = post('/v1/chat/completions', { messages: [{ role: 'user', content: 'hi' }] })
  await settle()
  check('failure → 502', res.statusCode === 502 && res.body.includes('bad key'), `${res.statusCode} ${res.body}`)

  const streamRes = post('/v1/chat/completions', { messages: [{ role: 'user', content: 'hi' }], stream: true })
  await settle(80)
  check('stream failure surfaces error frame', streamRes.body.includes('dsh_bridge_error') && streamRes.body.includes('bad key'))
}

// 5) /v1/models 与 status
{
  const { ctx } = makeCtx()
  apply(ctx, {})
  const models = fakeRes()
  await routes.get('/v1/models')({ method: 'GET', url: '/v1/models', headers: {} }, models)
  const list = JSON.parse(models.body)
  check('models deduped & listed', list.object === 'list' && list.data.filter((m) => m.id === 'deepseek-v4-flash').length === 1, models.body)

  const status = fakeRes()
  await routes.get('/folia-ai/status')({ method: 'GET', url: '/folia-ai/status', headers: {} }, status)
  const info = JSON.parse(status.body)
  check('status ok', info.ok === true && info.model === 'deepseek-v4-flash' && info.tokenRequired === false, status.body)
}

// 6) OPTIONS 预检 + 插件元数据 + 空闲无定时器
{
  const { ctx } = makeCtx()
  apply(ctx, {})
  const res = fakeRes()
  await routes.get('/v1/chat/completions')({ method: 'OPTIONS', url: '/v1/chat/completions', headers: {} }, res)
  check('cors preflight 204', res.statusCode === 204 && res.headers['Access-Control-Allow-Origin'] === '*')

  const before = process.getActiveResourcesInfo().filter((r) => r === 'Timeout').length
  const idle = makeCtx()
  apply(idle.ctx, {})
  await settle(20)
  const after = process.getActiveResourcesInfo().filter((r) => r === 'Timeout').length
  check('no idle timers after apply', after <= before, `${before} → ${after}`)

  check('plugin metadata', name === 'folia-ai-bridge' && inject[0] === 'webServer')
}

// 7) 设置页：overview 统计累加、config 保存、stats 清零、跨站拒绝
{
  const { ctx } = makeCtx({ chunks: [{ type: 'text-delta', index: 0, text: 'hello' }, { type: 'usage', usage: { inputTokens: 300, outputTokens: 40 } }, { type: 'finish', reason: { kind: 'stop' } }] })
  const edits = []
  apply(ctx, {})
  // 注入 configEditor + fiber.entry，模拟已安装的插件行
  ctx.get = ((original) => (key) => (key === 'configEditor'
    ? { edit: async (entry, change) => { edits.push(change({ provider: '', model: '', token: '' })) } }
    : original(key)))(ctx.get)
  ctx.fiber = { entry: { id: 'folia-ai-bridge' } }

  await post('/v1/chat/completions', { messages: [{ role: 'user', content: 'one' }] })
  await settle()
  await post('/v1/chat/completions', { messages: [{ role: 'user', content: 'two' }], stream: true })
  await settle(80)

  const overview = fakeRes()
  await routes.get('/folia-ai/overview')({ method: 'GET', url: '/folia-ai/overview', headers: {} }, overview)
  const data = JSON.parse(overview.body)
  check('overview counts calls', data.stats.totals.calls === 2, String(data.stats.totals.calls))
  check('overview sums tokens', data.stats.totals.input === 600 && data.stats.totals.output === 80, JSON.stringify(data.stats.totals))
  check('overview groups by model', data.stats.models.length === 1 && data.stats.models[0].calls === 2)
  check('overview lists recent with stream flag', data.stats.recent.length === 2 && data.stats.recent[0].stream === true)
  check('overview lists providers', data.providers.length === 1 && data.providers[0].models[0].id === 'deepseek-v4-flash')
  check('overview exposes config capability', data.status.hasConfigEditor === true)

  const saved = await (async () => {
    const res = fakeRes()
    const body = JSON.stringify({ provider: 'deepseek-official', model: 'deepseek-v4-flash', maxTokens: 4096 })
    const req = { method: 'POST', url: '/folia-ai/config', headers: { 'content-type': 'application/json', host: '127.0.0.1:13691' }, async* [Symbol.asyncIterator]() { yield Buffer.from(body) } }
    await routes.get('/folia-ai/config')(req, res)
    return res
  })()
  check('config saves through editor', saved.statusCode === 200 && edits.length === 1 && edits[0].maxTokens === 4096, saved.body)

  const crossSite = await (async () => {
    const res = fakeRes()
    const req = { method: 'POST', url: '/folia-ai/config', headers: { 'content-type': 'application/json', host: '127.0.0.1:13691', origin: 'https://evil.example' }, async* [Symbol.asyncIterator]() { yield Buffer.from('{"model":"x"}') } }
    await routes.get('/folia-ai/config')(req, res)
    return res
  })()
  check('config refuses cross-site', crossSite.statusCode === 403, String(crossSite.statusCode))

  const reset = await (async () => {
    const res = fakeRes()
    const req = { method: 'POST', url: '/folia-ai/stats/reset', headers: { 'content-type': 'application/json', host: '127.0.0.1:13691' }, async* [Symbol.asyncIterator]() { yield Buffer.from('{}') } }
    await routes.get('/folia-ai/stats/reset')(req, res)
    return res
  })()
  check('stats reset clears totals', reset.statusCode === 200 && JSON.parse(reset.body).stats.totals.calls === 0)
}

console.log(`\n=== PASS ${ok.length} ===`)
for (const line of ok) console.log('  ✓ ' + line)
if (bad.length) {
  console.log(`\n=== FAIL ${bad.length} ===`)
  for (const line of bad) console.log('  ✗ ' + line)
  process.exitCode = 1
}
