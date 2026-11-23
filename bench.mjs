// 微基准：单独量 folia-ai-bridge 自身的处理开销（不含模型推理）。
import { apply } from './index.js'

const routes = new Map()
const mkRes = () => ({
  statusCode: 0, headers: null, body: '', headersSent: false, writableEnded: false,
  writeHead(s, h) { this.statusCode = s; this.headers = h; this.headersSent = true },
  write(c) { this.body += c; return true },
  end(c) { if (c) this.body += c; this.writableEnded = true },
  on() {}, once() {}, off() {},
})

const ctx = {
  logger: { info() {}, warn() {}, error() {} },
  get: (k) => k === 'llm'
    ? {
      listProviders: () => [{ id: 'p' }],
      listModels: async () => [{ id: 'm' }, { id: 'm2' }],
      resolveModelInfo: async () => ({ reasoning: { efforts: [{ id: 'low' }] } }),
      stream: () => (async function* () {
        for (let i = 0; i < 200; i += 1) yield { type: 'text-delta', text: '{"k":"v"},'.repeat(4) }
        yield { type: 'usage', usage: { inputTokens: 100, outputTokens: 800 } }
        yield { type: 'finish', reason: { kind: 'stop' } }
      })(),
    }
    : k === 'agentDefaultModel' ? { currentSelection: () => ({ provider: 'p', model: 'm' }) } : undefined,
  webServer: { getOrigin: () => 'http://h', register: (r) => { routes.set(r.path, r.handler); return () => {} } },
  effect: (f) => f(),
}

apply(ctx, {})

const post = async (path, body, headers = {}) => {
  const res = mkRes()
  const req = {
    method: 'POST', url: path, headers: { 'content-type': 'application/json', ...headers },
    async *[Symbol.asyncIterator]() { yield Buffer.from(JSON.stringify(body)) },
  }
  await routes.get(path)(req, res)
  return res
}

const measure = async (label, fn, iterations) => {
  for (let i = 0; i < 5; i += 1) await fn()
  const before = process.memoryUsage().heapUsed
  const t0 = process.hrtime.bigint()
  for (let i = 0; i < iterations; i += 1) await fn()
  const t1 = process.hrtime.bigint()
  const after = process.memoryUsage().heapUsed
  const perCall = Number(t1 - t0) / 1e6 / iterations
  console.log(`${label.padEnd(38)} ${perCall.toFixed(3)} ms/call   heap Δ ${((after - before) / 1024).toFixed(0)} KB`)
}

const chatBody = {
  model: 'm',
  messages: [{ role: 'system', content: 'S'.repeat(6000) }, { role: 'user', content: 'U'.repeat(2000) }],
  max_tokens: 8192,
  response_format: { type: 'json_object' },
}

await measure('非流式 /v1/chat/completions', () => post('/v1/chat/completions', chatBody), 300)
await measure('流式 /v1/chat/completions', () => post('/v1/chat/completions', { ...chatBody, stream: true }), 300)
await measure('/v1/models', () => routes.get('/v1/models')({ method: 'GET', url: '/v1/models', headers: {} }, mkRes()), 500)
await measure('/folia-ai/status', () => routes.get('/folia-ai/status')({ method: 'GET', url: '/folia-ai/status', headers: {} }, mkRes()), 500)
await measure('OPTIONS 预检', () => routes.get('/v1/chat/completions')({ method: 'OPTIONS', url: '/v1/chat/completions', headers: {} }, mkRes()), 500)

console.log('\n活跃定时器:', process.getActiveResourcesInfo().filter((r) => r === 'Timeout').length)
