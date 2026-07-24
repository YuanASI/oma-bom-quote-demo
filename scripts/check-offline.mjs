import { readdir, readFile } from 'node:fs/promises'
import { extname, join } from 'node:path'

const projectRoot = new URL('../', import.meta.url)
const runtimeRoot = new URL('../src/', import.meta.url)
const fixtureRoot = new URL('../fixtures/', import.meta.url)
const forbiddenRuntimePatterns = [
  { label: 'fetch', expression: /\bfetch\s*\(/ },
  { label: 'XMLHttpRequest', expression: /\bXMLHttpRequest\b/ },
  { label: 'WebSocket', expression: /\bWebSocket\b/ },
  { label: 'EventSource', expression: /\bEventSource\b/ },
  { label: 'sendBeacon', expression: /\bsendBeacon\b/ },
  { label: 'remote URL', expression: /https?:\/\// },
]

async function walk(directoryUrl) {
  const entries = await readdir(directoryUrl, { withFileTypes: true })
  const files = []
  for (const entry of entries) {
    const child = new URL(`${entry.name}${entry.isDirectory() ? '/' : ''}`, directoryUrl)
    if (entry.isDirectory()) files.push(...(await walk(child)))
    else files.push(child)
  }
  return files
}

const runtimeFiles = (await walk(runtimeRoot)).filter((file) =>
  ['.ts', '.tsx', '.css'].includes(extname(file.pathname)),
)
const violations = []

for (const file of runtimeFiles) {
  const content = await readFile(file, 'utf8')
  for (const pattern of forbiddenRuntimePatterns) {
    if (pattern.expression.test(content)) {
      violations.push(`${file.pathname}: ${pattern.label}`)
    }
  }
}

const fixtureFiles = await walk(fixtureRoot)
for (const file of fixtureFiles) {
  const content = await readFile(file, 'utf8')
  if (!content.includes('模拟数据')) violations.push(`${file.pathname}: 缺少模拟数据标记`)
  const emailMatches = content.match(/[A-Z0-9._%+-]+@[A-Z0-9.-]+/gi) ?? []
  for (const email of emailMatches) {
    if (!email.endsWith('.invalid')) violations.push(`${file.pathname}: 非 .invalid 邮箱 ${email}`)
  }
}

const packageJson = JSON.parse(await readFile(new URL('../package.json', import.meta.url), 'utf8'))
const runtimeDependencies = Object.keys(packageJson.dependencies ?? {})
const allowedRuntimeDependencies = new Set(['react', 'react-dom'])
for (const dependency of runtimeDependencies) {
  if (!allowedRuntimeDependencies.has(dependency)) {
    violations.push(`package.json: 非必要运行时依赖 ${dependency}`)
  }
}

if (violations.length) {
  console.error('离线边界检查失败：')
  violations.forEach((violation) => console.error(`- ${violation}`))
  process.exit(1)
}

console.log(
  `离线边界检查通过：${runtimeFiles.length} 个运行时文件无网络调用；${fixtureFiles.length} 个 fixture 均标记为模拟数据。`,
)
console.log(`项目根目录：${join(projectRoot.pathname)}`)
