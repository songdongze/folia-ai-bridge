#!/usr/bin/env node
/**
 * 发布前的隐私检查。任何一条不通过就以非零状态退出，不要继续发布。
 *
 * 检查项：
 *   1. 源码里出现个人邮箱
 *   2. 源码里出现本机绝对路径（C:\Users、D:\...、AppData）
 *   3. 源码里出现真实凭据（sk-、ghp_、gho_、长串 Bearer）
 *   4. git 提交作者是个人邮箱（不是 noreply）
 *   5. 打包清单里有不该发的文件（.env、日志、node_modules）
 *
 * 用法：node scripts/privacy-check.mjs
 */

import { execFileSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')

/** 这些文件会被检查（源码 + 配置 + 文档）。 */
const CHECKED = [
  'index.js',
  'client.js',
  'stats.js',
  'sync-store.js',
  'sync-selftest.mjs',
  'package.json',
  'cordis.patch.yml',
  'README.md',
  'PUBLISHING.md',
  'LICENSE',
  'selftest.mjs',
  'bench.mjs',
  'probe-folia-theme.mjs',
  'locale/zh.json',
  'locale/en.json',
]

/** 出现即失败的模式。故意写得宽一点，宁可误报也不要漏。 */
const RULES = [
  {
    id: 'personal-email',
    label: '个人邮箱',
    // 允许 GitHub noreply 与示例地址
    pattern: /\b[\w.+-]+@(?!users\.noreply\.github\.com\b)[\w-]+\.(?:com|cn|net|org|io|me|dev)\b/gi,
    allow: [/@example\.(?:com|org)\b/i, /noreply\.github\.com\b/i],
  },
  {
    id: 'local-path',
    label: '本机绝对路径',
    pattern: /(?:[A-Za-z]:[\\/](?:Users|DONGZE|Folia|DeepSeek)[^\s'"`)]*)/g,
    allow: [/D:\\\\Folia\\\\folia-major/], // 上一行文档里的反例说明
  },
  {
    id: 'appdata',
    label: 'AppData / 用户目录痕迹',
    pattern: /AppData|C:\\\\Users\\\\|\/Users\/[A-Za-z0-9._-]+\//g,
    allow: [],
  },
  {
    id: 'secret',
    label: '疑似真实凭据',
    pattern: /\b(?:sk-[A-Za-z0-9]{16,}|gh[pousr]_[A-Za-z0-9]{20,}|Bearer\s+[A-Za-z0-9._-]{24,})\b/g,
    allow: [/Bearer\s+dsh\b/],
  },
]

const failures = []
const notes = []

const checkFile = (relative) => {
  let text
  try {
    text = readFileSync(join(ROOT, relative), 'utf8')
  } catch {
    notes.push(`跳过（读不到）：${relative}`)
    return
  }
  for (const rule of RULES) {
    const found = new Set()
    for (const match of text.matchAll(rule.pattern)) {
      const hit = match[0]
      if (rule.allow.some((re) => re.test(hit))) continue
      found.add(hit)
    }
    // local-path 那条对 README 里的说明文字豁免
    if (rule.id === 'local-path' && relative === 'README.md') continue
    for (const hit of found) failures.push(`${relative} 出现${rule.label}：${hit}`)
  }
}

for (const file of CHECKED) checkFile(file)

// 4. 提交作者
try {
  const authors = execFileSync('git', ['log', '--format=%an <%ae>'], { cwd: ROOT, encoding: 'utf8' })
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean)
  for (const author of authors) {
    if (!/users\.noreply\.github\.com>$/i.test(author)) {
      failures.push(`提交作者不是 noreply 地址：${author}`)
    }
  }
} catch {
  notes.push('读不到 git 历史（可能不是 git 仓库）')
}

// 5. 打包清单
try {
  // Windows 上 npm 是 .cmd，execFile 直接调会 ENOENT；改用 process.execPath 跑 npm-cli.js。
  const npmCli = join(dirname(process.execPath), 'node_modules', 'npm', 'bin', 'npm-cli.js')
  const pack = execFileSync(process.execPath, [npmCli, 'pack', '--dry-run', '--json'], {
    cwd: ROOT,
    encoding: 'utf8',
  })
  const entries = JSON.parse(pack)
  const files = (entries[0]?.files ?? []).map((f) => f.path)
  const forbidden = files.filter((f) => /(^|\/)(?:\.env|node_modules|\.git\/|.*\.log$)/.test(f))
  for (const f of forbidden) failures.push(`打包清单里有不该发的文件：${f}`)
  if (files.length > 0) notes.push(`打包 ${files.length} 个文件：${files.join(', ')}`)
} catch (error) {
  notes.push(`npm pack --dry-run 没跑成（${error.message.split('\n')[0]}）`)
}

console.log('=== 隐私检查 ===')
for (const note of notes) console.log(`· ${note}`)
if (failures.length === 0) {
  console.log('\n✓ 全部通过，可以发布')
  process.exit(0)
}
console.log(`\n✗ ${failures.length} 处需要处理：`)
for (const failure of failures) console.log(`  - ${failure}`)
process.exit(1)
