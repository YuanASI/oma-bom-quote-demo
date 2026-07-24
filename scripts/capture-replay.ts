import { mkdir, writeFile } from 'node:fs/promises'
import type { ReplayPackage } from '../src/domain/types.js'
import {
  hashRawFiles,
  loadBundledRequest,
  projectPath,
} from '../server/fixture-loader.js'
import { hasLiveCredential, runLiveOmaWorkflow } from '../server/oma-runner.js'

if (!hasLiveCredential()) {
  console.error('缺少 DEEPSEEK_API_KEY；不能生成真实 OMA 离线回放。')
  process.exit(1)
}

const request = await loadBundledRequest()
const workflow = await runLiveOmaWorkflow(request)
if (!workflow.evidence.isLiveModelCall || !workflow.evidence.runId) {
  throw new Error('只有真实 OMA 模型运行才能生成正式回放包')
}
const quoteCount = workflow.output.supplierDocuments.reduce(
  (sum, document) => sum + document.quotes.length,
  0,
)
if (quoteCount !== 45 || workflow.evidence.validationIssues.length > 0) {
  throw new Error(
    `拒绝捕获不完整运行：报价 ${quoteCount}/45，证据问题 ${workflow.evidence.validationIssues.length}`,
  )
}

const replay: ReplayPackage = {
  schemaVersion: 1,
  dataLabel: '模拟数据',
  replayId: `REPLAY-${workflow.evidence.runId}`,
  captureKind: 'LIVE_OMA_CAPTURE',
  capturedAt: workflow.evidence.completedAt,
  provider: workflow.evidence.provider,
  model: workflow.evidence.model,
  liveRunId: workflow.evidence.runId,
  fixtureHashes: hashRawFiles(request),
  workflowOutput: workflow.output,
  ...(workflow.evidence.receipt ? { receipt: workflow.evidence.receipt } : {}),
  notice:
    '离线回放来自一次真实 OMA runTasks() + 模型 API 的模拟数据运行；本次打开回放时不调用模型。',
}

const output = projectPath('fixtures', 'replays', 'oma-demo-v1.json')
await mkdir(projectPath('fixtures', 'replays'), { recursive: true })
await writeFile(output, `${JSON.stringify(replay, null, 2)}\n`, 'utf8')
console.log(`Captured real OMA replay: ${output}`)
console.log(`runId=${workflow.evidence.runId}`)
console.log(`quotes=${quoteCount}`)
