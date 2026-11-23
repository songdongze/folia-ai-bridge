// 用 Folia 真实的主题提示词打一次桥接接口，校验返回的 JSON 是否符合 Folia 的 DualTheme 形状。
//
// 用法：
//   FOLIA_SRC=<Folia 源码目录> node probe-folia-theme.mjs
//   或 node probe-folia-theme.mjs <Folia 源码目录>
//   BRIDGE_URL / BRIDGE_TOKEN 可覆盖桥接地址与令牌。
//
// 需要一个正在运行的桥接（默认 http://127.0.0.1:13691），以及一份 Folia 源码，
// 用来读取它真实的主题生成提示词。

import { readFileSync } from 'node:fs'

const FOLIA_SRC = process.env.FOLIA_SRC || process.argv[2]
const BASE_URL = process.env.BRIDGE_URL || 'http://127.0.0.1:13691'
const TOKEN = process.env.BRIDGE_TOKEN || ''

if (!FOLIA_SRC) {
  console.error('请指定 Folia 源码目录：FOLIA_SRC=<目录> node probe-folia-theme.mjs')
  console.error('例如：FOLIA_SRC=./folia-major node probe-folia-theme.mjs')
  process.exit(2)
}

const promptPath = `${FOLIA_SRC.replace(/[\\/]+$/, '')}/src/utils/aiThemePrompts.ts`

let source
try {
  source = readFileSync(promptPath, 'utf8')
} catch {
  console.error(`读不到 Folia 的提示词文件：${promptPath}`)
  process.exit(2)
}

const marker = 'export const THEME_GENERATION_PROMPT_PREFIX = `'
const start = source.indexOf(marker) + marker.length
const end = source.indexOf('`;', start)
if (start < marker.length || end < 0) {
  console.error('这个版本的 aiThemePrompts.ts 里找不到 THEME_GENERATION_PROMPT_PREFIX')
  process.exit(2)
}

const systemPrompt = source.slice(start, end)
console.log('system prompt chars:', systemPrompt.length)

const lyrics = `雨夜的末班车载着最后一群人
车窗上的水痕把城市折成两半
我把耳机塞进耳朵
噪音一下子退到很远的地方
你说过要一起看的那场雪
到现在也没有落下
如果明天还是这样
我就把这条路走到底`

const body = {
  messages: [
    { role: 'system', content: systemPrompt },
    { role: 'user', content: `Pure instrumental: no\nSource snippet:\n${lyrics.slice(0, 2000)}` },
  ],
  response_format: { type: 'json_object' },
  max_tokens: 8192,
  temperature: 0.8,
}

const started = Date.now()
const response = await fetch(`${BASE_URL}/v1/chat/completions`, {
  method: 'POST',
  headers: {
    'Content-Type': 'application/json',
    ...(TOKEN ? { Authorization: `Bearer ${TOKEN}` } : {}),
  },
  body: JSON.stringify(body),
})
const raw = await response.text()
console.log('HTTP', response.status, `${Date.now() - started}ms`, 'bytes', raw.length)
if (!response.ok) {
  console.log(raw)
  process.exit(1)
}

const payload = JSON.parse(raw)
const content = payload.choices[0].message.content
console.log('model:', payload.model, '| finish:', payload.choices[0].finish_reason, '| usage:', JSON.stringify(payload.usage))

let theme
try {
  theme = JSON.parse(content.trim().replace(/^```(?:json)?\n/, '').replace(/\n```$/, ''))
} catch (error) {
  console.log('NOT JSON:', content.slice(0, 400))
  process.exit(1)
}

const required = ['name', 'description', 'backgroundColor', 'primaryColor', 'accentColor', 'secondaryColor', 'wordColors', 'lyricsIcons']
const hex = /^#[0-9a-fA-F]{6}$/
const problems = []
for (const mode of ['light', 'dark']) {
  const t = theme[mode]
  if (!t) { problems.push(`missing ${mode}`); continue }
  for (const key of required) if (t[key] === undefined) problems.push(`${mode}.${key} missing`)
  for (const key of ['backgroundColor', 'primaryColor', 'accentColor', 'secondaryColor']) {
    if (!hex.test(String(t[key] ?? ''))) problems.push(`${mode}.${key} not hex: ${t[key]}`)
  }
  if (!Array.isArray(t.wordColors) || t.wordColors.length < 3) problems.push(`${mode}.wordColors too short`)
  if (!Array.isArray(t.lyricsIcons) || t.lyricsIcons.length < 1) problems.push(`${mode}.lyricsIcons too short`)
}
console.log('\nlight:', theme.light?.name, '|', theme.light?.description)
console.log('dark :', theme.dark?.name, '|', theme.dark?.description)
console.log('words:', (theme.light?.wordColors ?? []).map((w) => w.word).join(','))
console.log('icons:', (theme.light?.lyricsIcons ?? []).join(','))
if (problems.length) {
  console.log('\nPROBLEMS:', problems)
  process.exitCode = 1
} else {
  console.log('\nTHEME SHAPE OK (Folia DualTheme)')
}
