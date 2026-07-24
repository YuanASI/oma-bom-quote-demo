import { applyModelReviewFindings, runQuoteReview } from '../src/domain/quoteEngine.js'
import { datasetFromRequest, loadBundledRequest } from '../server/fixture-loader.js'
import { hasLiveCredential, runLiveOmaWorkflow } from '../server/oma-runner.js'

if (!hasLiveCredential()) {
  console.error('缺少 DEEPSEEK_API_KEY；未执行真实 OMA provider E2E。')
  process.exit(1)
}

const request = await loadBundledRequest()
const workflow = await runLiveOmaWorkflow(request)
if (!workflow.evidence.isLiveModelCall) {
  throw new Error('E2E 没有记录真实模型调用')
}
if (workflow.evidence.receipt?.mode !== 'multi-agent') {
  throw new Error('ExecutionReceipt 未证明多 Agent 执行')
}
if ((workflow.evidence.receipt?.rolesExecuted.length ?? 0) < 6) {
  throw new Error('ExecutionReceipt 中执行角色不足 6 个')
}
const quoteCounts = workflow.output.supplierDocuments.map((document) => ({
  fileName: document.fileName,
  count: document.quotes.length,
}))
if (quoteCounts.some(({ count }) => count === 0)) {
  throw new Error(
    `至少一份供应商回复未产生任何经证据校验的报价：${quoteCounts
      .map(({ fileName, count }) => `${fileName}=${count}`)
      .join('，')}；${workflow.evidence.validationIssues.join('；')}`,
  )
}
const quoteCount = workflow.output.supplierDocuments.reduce(
  (sum, document) => sum + document.quotes.length,
  0,
)
if (quoteCount !== 45) {
  throw new Error(`真实模型只产出 ${quoteCount}/45 条经证据校验的报价`)
}
if (workflow.evidence.validationIssues.length > 0) {
  throw new Error(
    `真实模型仍有 ${workflow.evidence.validationIssues.length} 个证据校验问题：${workflow.evidence.validationIssues.join('；')}`,
  )
}

const dataset = datasetFromRequest(request, workflow.output.supplierDocuments)
const run = applyModelReviewFindings(
  runQuoteReview(dataset, workflow.evidence),
  workflow.output.bomFindings,
  workflow.output.evidenceFindings,
)
if (
  run.summary.matchedCount !== 16 ||
  run.summary.pendingCount !== 6 ||
  run.summary.noQuoteCount !== 2
) {
  throw new Error(
    `审核口径漂移：${run.summary.matchedCount} matched / ${run.summary.pendingCount} pending / ${run.summary.noQuoteCount} no quote`,
  )
}

console.log('Real OMA provider E2E passed.')
console.log(`runId=${workflow.evidence.runId}`)
console.log(`provider=${workflow.evidence.provider} model=${workflow.evidence.model}`)
console.log(`tasks=${workflow.evidence.taskCount}`)
console.log(`quotes=${quoteCount}`)
console.log(`durationMs=${workflow.evidence.receipt?.durationMs ?? 'unavailable'}`)
console.log(
  `tokens=${workflow.evidence.receipt?.totalTokens
    ? workflow.evidence.receipt.totalTokens.input + workflow.evidence.receipt.totalTokens.output
    : 'unavailable'}`,
)
console.log(
  `review=${run.summary.matchedCount} matched / ${run.summary.pendingCount} pending / ${run.summary.noQuoteCount} no quote`,
)
console.log(`validationIssues=${workflow.evidence.validationIssues.length}`)
