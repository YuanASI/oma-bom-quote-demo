import { readdir, readFile } from 'node:fs/promises'
import { extname, join } from 'node:path'

const projectRoot = new URL('../', import.meta.url)
const runtimeRoot = new URL('../src/', import.meta.url)
const serverRoot = new URL('../server/', import.meta.url)
const fixtureRoot = new URL('../fixtures/', import.meta.url)
const forbiddenBrowserPatterns = [
  { label: 'XMLHttpRequest', expression: /\bXMLHttpRequest\b/ },
  { label: 'WebSocket', expression: /\bWebSocket\b/ },
  { label: 'EventSource', expression: /\bEventSource\b/ },
  { label: 'sendBeacon', expression: /\bsendBeacon\b/ },
  { label: 'remote URL', expression: /https?:\/\// },
  { label: 'browser-visible API key name', expression: /\bDEEPSEEK_API_KEY\b/ },
  { label: 'Vite-exposed secret prefix', expression: /\bVITE_[A-Z0-9_]*(?:KEY|TOKEN|SECRET)\b/ },
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

const browserFiles = (await walk(runtimeRoot)).filter((file) =>
  ['.ts', '.tsx', '.css'].includes(extname(file.pathname)),
)
const serverFiles = (await walk(serverRoot)).filter((file) =>
  ['.ts'].includes(extname(file.pathname)),
)
const violations = []

for (const file of browserFiles) {
  const content = await readFile(file, 'utf8')
  for (const pattern of forbiddenBrowserPatterns) {
    if (pattern.expression.test(content)) {
      violations.push(`${file.pathname}: ${pattern.label}`)
    }
  }
  const fetchCalls = content.match(/\bfetch\s*\(\s*['"`]([^'"`]+)/g) ?? []
  for (const call of fetchCalls) {
    if (!call.includes("'/api/") && !call.includes('"/api/') && !call.includes('`/api/')) {
      violations.push(`${file.pathname}: 浏览器 fetch 只能访问同源 /api/`)
    }
  }
}

for (const file of serverFiles) {
  const content = await readFile(file, 'utf8')
  const urls = content.match(/https?:\/\/[^\s'"`]+/gi) ?? []
  if (
    urls.some(
      (url) =>
        !url.startsWith('http://127.0.0.1') &&
        !url.startsWith('http://localhost'),
    )
  ) {
    violations.push(`${file.pathname}: 服务端不得硬编码模型之外的远程 URL`)
  }
  if (/\b(?:nodemailer|axios|got|undici)\b/.test(content)) {
    violations.push(`${file.pathname}: 不允许额外外联 SDK`)
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
const allowedRuntimeDependencies = new Set([
  '@open-multi-agent/core',
  'express',
  'react',
  'react-dom',
  'zod',
])
for (const dependency of runtimeDependencies) {
  if (!allowedRuntimeDependencies.has(dependency)) {
    violations.push(`package.json: 未批准的运行时依赖 ${dependency}`)
  }
}

if (violations.length) {
  console.error('运行边界检查失败：')
  violations.forEach((violation) => console.error(`- ${violation}`))
  process.exit(1)
}

console.log(
  `运行边界检查通过：${browserFiles.length} 个浏览器文件仅允许同源 /api；` +
  `${serverFiles.length} 个服务端文件无额外外联 SDK；${fixtureFiles.length} 个 fixture 均为模拟数据。`,
)
console.log(`项目根目录：${join(projectRoot.pathname)}`)
