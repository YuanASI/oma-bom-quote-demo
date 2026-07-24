import { randomUUID } from 'node:crypto'
import {
  OpenMultiAgent,
  type AgentConfig,
  type LLMAdapter,
  type SupportedProvider,
  type TeamRunResult,
  type TraceEvent,
} from '@open-multi-agent/core'
import type {
  ExecutionReceiptSummary,
  LiveReviewRequest,
  ModelBomFinding,
  ModelEvidenceFinding,
  OmaWorkflowOutput,
  RunEvidence,
  SourceFormat,
  SupplierDocument,
  SupplierQuote,
} from '../src/domain/types.js'
import {
  bomAnalysisSchema,
  evidenceReviewSchema,
  supplierExtractionSchema,
  type BomAnalysis,
  type EvidenceReview,
  type SupplierExtraction,
} from './schemas.js'
import {
  bomAnalystPrompt,
  evidenceReviewerPrompt,
  sharedBoundaryPrompt,
  supplierReaderPrompt,
} from './prompts.js'

interface AdapterOverrides {
  bom?: LLMAdapter
  suppliers?: LLMAdapter[]
  evidence?: LLMAdapter
}

export interface OmaRunnerOptions {
  provider?: SupportedProvider
  model?: string
  apiKey?: string
  runId?: string
  now?: () => Date
  adapters?: AdapterOverrides
}

export interface OmaWorkflowResult {
  output: OmaWorkflowOutput
  evidence: RunEvidence
}

function sourceFormat(fileName: string): SourceFormat {
  const lower = fileName.toLowerCase()
  if (lower.endsWith('.json')) return 'JSON'
  if (lower.endsWith('.txt')) return 'EMAIL'
  return 'CSV'
}

function agentConfig(
  name: string,
  systemPrompt: string,
  outputSchema: AgentConfig['outputSchema'],
  provider: SupportedProvider,
  model: string,
  apiKey: string | undefined,
  adapter: LLMAdapter | undefined,
): AgentConfig {
  return {
    name,
    provider,
    model,
    ...(apiKey ? { apiKey } : {}),
    ...(adapter ? { adapter } : {}),
    systemPrompt: `${sharedBoundaryPrompt}\n\n${systemPrompt}`,
    outputSchema,
    maxTurns: 2,
    maxTokens: 12_000,
    timeoutMs: 45_000,
    callTimeoutMs: 40_000,
    temperature: 0.1,
    extraBody: {
      thinking: { type: 'disabled' },
    },
  }
}

function normalizedEvidence(value: string): string {
  return value.replace(/\s+/g, ' ').replaceAll(',', '').trim().toUpperCase()
}

function jsonObjectRanges(rawText: string): Array<{ start: number; end: number }> {
  const stack: number[] = []
  const ranges: Array<{ start: number; end: number }> = []
  let inString = false
  let escaped = false

  for (let index = 0; index < rawText.length; index += 1) {
    const character = rawText[index]
    if (inString) {
      if (escaped) {
        escaped = false
      } else if (character === '\\') {
        escaped = true
      } else if (character === '"') {
        inString = false
      }
      continue
    }

    if (character === '"') {
      inString = true
    } else if (character === '{') {
      stack.push(index)
    } else if (character === '}') {
      const start = stack.pop()
      if (start !== undefined) ranges.push({ start, end: index + 1 })
    }
  }

  return ranges
}

export function reconcileSourceExcerpt(
  quote: Pick<SupplierExtraction['quotes'][number], 'mpn' | 'unitPrice' | 'sourceExcerpt'>,
  rawText: string,
  format: SourceFormat,
): string {
  if (rawText.includes(quote.sourceExcerpt) || format !== 'JSON') {
    return quote.sourceExcerpt
  }

  const matches = jsonObjectRanges(rawText)
    .sort((left, right) => (left.end - left.start) - (right.end - right.start))
    .flatMap(({ start, end }) => {
      const excerpt = rawText.slice(start, end)
      try {
        const value = JSON.parse(excerpt) as { mpn?: unknown; unitPrice?: unknown }
        return value.mpn === quote.mpn && Number(value.unitPrice) === quote.unitPrice
          ? [excerpt]
          : []
      } catch {
        return []
      }
    })

  return matches.length === 1 ? matches[0] : quote.sourceExcerpt
}

function quoteEvidenceIssue(
  quote: SupplierExtraction['quotes'][number],
  rawText: string,
): string | undefined {
  const evidence = normalizedEvidence(quote.sourceExcerpt)
  const source = normalizedEvidence(rawText)
  if (!source.includes(evidence)) return 'sourceExcerpt 不是原文件中的连续原文'
  if (!evidence.includes(normalizedEvidence(quote.mpn))) return 'sourceExcerpt 未包含料号'
  if (!evidence.includes(String(quote.unitPrice))) return 'sourceExcerpt 未包含报价数字'
  if (quote.confidence < 0.7) return `模型置信度 ${quote.confidence.toFixed(2)} 低于 0.70`
  if (quote.unresolvedFields.length > 0) {
    return `仍有未解决字段：${quote.unresolvedFields.join('、')}`
  }
  return undefined
}

function evidenceLocator(
  rawText: string,
  excerpt: string,
  format: SourceFormat,
  fallback: string,
): string {
  const start = rawText.indexOf(excerpt)
  if (start < 0) return fallback
  const startLine = rawText.slice(0, start).split(/\r?\n/).length
  const endLine = startLine + excerpt.split(/\r?\n/).length - 1
  const prefix = format === 'EMAIL' ? '邮件正文' : format
  return endLine === startLine
    ? `${prefix} 第 ${startLine} 行`
    : `${prefix} 第 ${startLine}–${endLine} 行`
}

function extractionToDocument(
  extraction: SupplierExtraction,
  sourceFile: string,
  rawText: string,
  validationIssues: string[],
): SupplierDocument {
  const format = sourceFormat(sourceFile)
  const quotes: SupplierQuote[] = extraction.quotes.flatMap((quote, index) => {
    const sourceExcerpt = reconcileSourceExcerpt(quote, rawText, format)
    const issue = quoteEvidenceIssue({ ...quote, sourceExcerpt }, rawText)
    if (issue) {
      validationIssues.push(`${sourceFile} / ${quote.mpn}：${issue}`)
      return []
    }

    return [{
      id: `${extraction.supplier.id}-${index + 1}`,
      supplierId: extraction.supplier.id,
      supplierName: extraction.supplier.name,
      contact: extraction.supplier.contact,
      email: extraction.supplier.email,
      qualification: extraction.supplier.qualification,
      mpn: quote.mpn,
      brand: quote.brand,
      unitPrice: quote.unitPrice,
      currency: quote.currency,
      taxBasis: quote.taxBasis,
      moq: quote.moq,
      stock: quote.stock,
      leadDays: quote.leadDays,
      validUntil: quote.validUntil,
      dateCode: quote.dateCode,
      channelType: quote.channelType,
      alternateFor: quote.alternateFor || undefined,
      remark: quote.remark,
      dataLabel: '模拟数据' as const,
      sourceFile,
      sourceLocator: evidenceLocator(
        rawText,
        sourceExcerpt,
        format,
        quote.sourceLocator,
      ),
      rawEvidence: sourceExcerpt,
    }]
  })

  return {
    supplierId: extraction.supplier.id,
    supplierName: extraction.supplier.name,
    fileName: sourceFile,
    format,
    qualification: extraction.supplier.qualification,
    rawText,
    quotes,
  }
}

function unique(values: Array<string | undefined>): string[] {
  return [...new Set(values.filter((value): value is string => Boolean(value)))]
}

function receiptSummary(
  result: TeamRunResult,
  trace: TraceEvent[],
): ExecutionReceiptSummary {
  const tasks = result.tasks ?? []
  const completedTasks = tasks.filter((task) => task.status === 'completed')
  const taskById = new Map(tasks.map((task) => [task.id, task]))
  const rolesExecuted = unique(completedTasks.map((task) => task.assignee))
  const taskTraceOrder = trace
    .filter((event) => event.type === 'task' && event.success)
    .sort((a, b) => a.endMs - b.endMs)
    .map((event) => event.agent)
  const executionOrder = unique(
    taskTraceOrder.length > 0
      ? taskTraceOrder
      : completedTasks
          .slice()
          .sort(
            (a, b) =>
              (a.metrics?.endMs ?? Number.MAX_SAFE_INTEGER) -
              (b.metrics?.endMs ?? Number.MAX_SAFE_INTEGER),
          )
          .map((task) => task.assignee),
  )
  const dependencyEdges = tasks.flatMap((task) =>
    task.dependsOn.map((dependencyId) => {
      const dependency = taskById.get(dependencyId)
      return {
        from: dependency?.assignee ?? dependency?.title ?? dependencyId,
        to: task.assignee ?? task.title,
      }
    }),
  )
  const independentRolesCount = unique(
    completedTasks
      .filter((task) => task.dependsOn.length === 0)
      .map((task) => task.assignee),
  ).length
  const independentReviewOccurred = completedTasks.some((task) => {
    if (task.dependsOn.length === 0 || !task.assignee) return false
    const dependencyAgents = new Set(
      task.dependsOn
        .map((dependencyId) => taskById.get(dependencyId)?.assignee)
        .filter(Boolean),
    )
    return !dependencyAgents.has(task.assignee)
  })
  const starts = trace.map((event) => event.startMs)
  const ends = trace.map((event) => event.endMs)
  const durationMs =
    starts.length > 0 ? Math.max(...ends) - Math.min(...starts) : undefined

  return {
    mode: rolesExecuted.length > 1 ? 'multi-agent' : 'single',
    rolesExecuted,
    executionOrder,
    dependencyEdges,
    independentRolesCount,
    independentReviewOccurred,
    totalTokens: {
      input: result.totalTokenUsage.input_tokens,
      output: result.totalTokenUsage.output_tokens,
    },
    ...(durationMs !== undefined ? { durationMs } : {}),
    partial: !result.success || completedTasks.length !== tasks.length,
  }
}

function findStructured<T>(
  result: Awaited<ReturnType<OpenMultiAgent['runTasks']>>,
  agentName: string,
  parse: (value: unknown) => T,
): T {
  const agentResult = result.agentResults.get(agentName)
  if (!agentResult?.success || agentResult.structured === undefined) {
    throw new Error(`OMA Agent ${agentName} 未返回可用的结构化结果`)
  }
  return parse(agentResult.structured)
}

export function hasLiveCredential(): boolean {
  return Boolean(process.env['DEEPSEEK_API_KEY']?.trim())
}

export function liveModelConfig(): { provider: SupportedProvider; model: string } {
  const configuredProvider = process.env['OMA_PROVIDER']?.trim() || 'deepseek'
  if (configuredProvider !== 'deepseek') {
    throw new Error(`本 Demo 当前仅允许 OMA_PROVIDER=deepseek，收到 ${configuredProvider}`)
  }
  return {
    provider: 'deepseek',
    model: process.env['OMA_MODEL']?.trim() || 'deepseek-v4-flash',
  }
}

export async function runLiveOmaWorkflow(
  request: LiveReviewRequest,
  options: OmaRunnerOptions = {},
): Promise<OmaWorkflowResult> {
  const configured = liveModelConfig()
  const provider = options.provider ?? configured.provider
  const model = options.model ?? configured.model
  const apiKey = options.apiKey ?? process.env['DEEPSEEK_API_KEY']?.trim()
  const isFixtureAdapterRun = options.adapters !== undefined
  if (!apiKey && !isFixtureAdapterRun) {
    throw new Error('缺少 DEEPSEEK_API_KEY，实时 OMA 模式不可用')
  }

  const now = options.now ?? (() => new Date())
  const startedAt = now()
  const runId = options.runId ?? `bom-live-${randomUUID()}`
  const trace: TraceEvent[] = []

  const bomAgentName = 'bom-analyst'
  const evidenceAgentName = 'evidence-reviewer'
  const supplierAgentNames = request.suppliers.map(
    (_, index) => `supplier-reader-${String(index + 1).padStart(2, '0')}`,
  )

  const bomAgent = agentConfig(
    bomAgentName,
    bomAnalystPrompt,
    bomAnalysisSchema,
    provider,
    model,
    apiKey,
    options.adapters?.bom,
  )
  const supplierAgents = request.suppliers.map((file, index) =>
    agentConfig(
      supplierAgentNames[index],
      supplierReaderPrompt(file.fileName),
      supplierExtractionSchema,
      provider,
      model,
      apiKey,
      options.adapters?.suppliers?.[index],
    ),
  )
  const evidenceAgent = agentConfig(
    evidenceAgentName,
    evidenceReviewerPrompt,
    evidenceReviewSchema,
    provider,
    model,
    apiKey,
    options.adapters?.evidence,
  )

  const oma = new OpenMultiAgent({
    defaultProvider: provider,
    defaultModel: model,
    maxConcurrency: 5,
    maxTokenBudget: 120_000,
    onTrace: (event) => {
      trace.push(event)
    },
  })
  const team = oma.createTeam('bom-quote-review', {
    name: 'bom-quote-review',
    agents: [bomAgent, ...supplierAgents, evidenceAgent],
    maxConcurrency: 5,
  })

  const bomTitle = 'Review BOM normalization ambiguities'
  const supplierTitles = request.suppliers.map(
    (file, index) => `Extract supplier ${index + 1}: ${file.fileName}`,
  )
  const evidenceTitle = 'Review extracted quote evidence'

  const result = await oma.runTasks(team, [
    {
      title: bomTitle,
      description: `Review this simulated customer BOM and return only noteworthy normalization findings.\n\nSOURCE FILE: ${request.bom.fileName}\n\n${request.bom.rawText}`,
      assignee: bomAgentName,
      role: 'bom-analysis',
    },
    ...request.suppliers.map((file, index) => ({
      title: supplierTitles[index],
      description: `Extract every explicit quote from this simulated supplier response.\n\nSOURCE FILE: ${file.fileName}\n\n${file.rawText}`,
      assignee: supplierAgentNames[index],
      role: 'supplier-extraction',
    })),
    {
      title: evidenceTitle,
      description: 'Review all prerequisite extraction outputs for source support and human-review risks.',
      assignee: evidenceAgentName,
      role: 'evidence-review',
      dependsOn: [bomTitle, ...supplierTitles],
    },
  ], {
    runId,
    metadata: {
      demo: 'oma-bom-quote',
      data_label: 'simulated',
      workflow_version: 'live-oma-v1',
    },
    abortSignal: AbortSignal.timeout(60_000),
  })

  if (!result.success) {
    const failed = (result.tasks ?? [])
      .filter((task) => task.status === 'failed')
      .map((task) => task.title)
      .join('、')
    throw new Error(`OMA 实时流水线未完成${failed ? `：${failed}` : ''}`)
  }

  const bom = findStructured<BomAnalysis>(
    result,
    bomAgentName,
    (value) => bomAnalysisSchema.parse(value),
  )
  const extractions = supplierAgentNames.map((agentName) =>
    findStructured<SupplierExtraction>(
      result,
      agentName,
      (value) => supplierExtractionSchema.parse(value),
    ),
  )
  const evidence = findStructured<EvidenceReview>(
    result,
    evidenceAgentName,
    (value) => evidenceReviewSchema.parse(value),
  )

  const validationIssues: string[] = []
  const supplierDocuments = extractions.map((extraction, index) =>
    extractionToDocument(
      extraction,
      request.suppliers[index].fileName,
      request.suppliers[index].rawText,
      validationIssues,
    ),
  )
  const evidenceFindings: ModelEvidenceFinding[] = evidence.findings
  const bomFindings: ModelBomFinding[] = bom.findings
  const receipt = receiptSummary(result, trace)
  const completedAt = now()

  return {
    output: {
      supplierDocuments,
      bomFindings,
      evidenceFindings,
    },
    evidence: {
      executionMode: 'LIVE_OMA_MODEL',
      isLiveModelCall: !isFixtureAdapterRun,
      provider: isFixtureAdapterRun ? 'fixture-adapter' : provider,
      model: isFixtureAdapterRun ? 'fixture-oma-model' : model,
      startedAt: startedAt.toISOString(),
      completedAt: completedAt.toISOString(),
      runId,
      taskCount: (result.tasks ?? []).filter((task) => task.status === 'completed').length,
      validationIssues,
      receipt,
      notice: isFixtureAdapterRun
        ? '测试专用 OMA fixture adapter；未调用外部模型。'
        : '本次结果来自真实 OMA runTasks() 与模型 API；确定性报价规则随后在应用代码中执行。',
    },
  }
}
