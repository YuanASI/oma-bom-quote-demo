export type Currency = 'CNY' | 'USD' | 'HKD'
export type TaxBasis = 'VAT_INCLUDED' | 'EXCLUDED'
export type ChannelType = 'AUTHORIZED' | 'INDEPENDENT' | 'BROKER' | 'SPOT'
export type Qualification = 'VERIFIED' | 'PENDING'
export type SourceFormat = 'CSV' | 'EMAIL' | 'JSON'

export interface DemoPolicy {
  asOfDate: string
  cnyVatRate: number
  fxToCny: Record<Currency, number>
  minimumGrossMargin: number
}

export interface BomLine {
  lineId: number
  partNumber: string
  brand: string
  description: string
  quantity: number
  targetLeadDays: number
  targetUnitPriceCny?: number
  remarks: string
  dataLabel: '模拟数据'
  sourceFile: string
  sourceLocator: string
}

export interface SupplierQuote {
  id: string
  supplierId: string
  supplierName: string
  contact: string
  email: string
  qualification: Qualification
  mpn: string
  brand: string
  unitPrice: number
  currency: Currency
  taxBasis: TaxBasis
  moq: number
  stock: number
  leadDays: number
  validUntil: string
  dateCode: string
  channelType: ChannelType
  alternateFor?: string
  remark: string
  dataLabel: '模拟数据'
  sourceFile: string
  sourceLocator: string
  rawEvidence: string
}

export interface SupplierDocument {
  supplierId: string
  supplierName: string
  fileName: string
  format: SourceFormat
  qualification: Qualification
  rawText: string
  quotes: SupplierQuote[]
}

export interface DemoDataset {
  customerName: string
  projectName: string
  bomFileName: string
  bomRawText: string
  bomLines: BomLine[]
  supplierDocuments: SupplierDocument[]
  policy: DemoPolicy
}

export type AmbiguityCode =
  | 'SUSPECTED_PACKAGING_SUFFIX'
  | 'UNCERTAIN_FINAL_CHARACTER'
  | 'MISSING_BRAND'
  | 'MISSING_CONNECTOR_SPEC'

export interface NormalizedBomItem {
  id: string
  canonicalMpn: string
  brand: string
  description: string
  quantity: number
  targetLeadDays: number
  targetUnitPriceCny?: number
  remarks: string[]
  originalLines: BomLine[]
  normalizationNotes: string[]
  ambiguityCodes: AmbiguityCode[]
}

export type RiskCode =
  | 'EXPIRED'
  | 'LATE_DELIVERY'
  | 'INSUFFICIENT_STOCK'
  | 'BELOW_MOQ'
  | 'QUALIFICATION_PENDING'
  | 'ALTERNATE_UNCONFIRMED'
  | 'CURRENCY_TAX_NORMALIZED'

export interface QuoteRisk {
  code: RiskCode
  label: string
  severity: 'critical' | 'warning' | 'info'
  owner: '采购' | '销售' | '工程'
}

export interface EvaluatedQuote extends SupplierQuote {
  canonicalMpn: string
  normalizedCostCny: number
  risks: QuoteRisk[]
  hardRiskCount: number
}

export type ReviewStatus = 'matched' | 'pending' | 'no_quote'

export interface ReviewItem {
  bom: NormalizedBomItem
  status: ReviewStatus
  recommendation?: EvaluatedQuote
  lowestQuote?: EvaluatedQuote
  alternatives: EvaluatedQuote[]
  recommendationReasons: string[]
  lowestNotRecommendedReason?: string
  keyRisks: string[]
  confirmationOwners: Array<'采购' | '销售' | '工程'>
  expectedLeadDays?: number
  grossMargin?: number
  marginWarning?: string
  suggestedCustomerUnitPriceCny?: number
}

export interface ReviewSummary {
  rawLineCount: number
  normalizedLineCount: number
  matchedCount: number
  pendingCount: number
  noQuoteCount: number
  coveredCount: number
  coverageRate: number
  duplicateGroups: number
  ambiguousCount: number
}

export type DemoExecutionMode =
  | 'DETERMINISTIC_RULES'
  | 'LIVE_OMA_MODEL'
  | 'OFFLINE_REPLAY'

export type ReplayCaptureKind = 'LIVE_OMA_CAPTURE' | 'FIXTURE_BASELINE'
export type DemoPath = 'live' | 'replay'
export type ProcessingStatus = 'idle' | 'running' | 'success' | 'error'

export interface ProcessingState {
  status: ProcessingStatus
  path: DemoPath
  error?: string
}

export interface ExecutionReceiptSummary {
  mode: 'single' | 'multi-agent'
  rolesExecuted: string[]
  executionOrder: string[]
  dependencyEdges: Array<{ from: string; to: string }>
  independentRolesCount: number
  independentReviewOccurred: boolean
  totalTokens?: { input: number; output: number }
  durationMs?: number
  partial: boolean
}

export interface RunEvidence {
  executionMode: Exclude<DemoExecutionMode, 'DETERMINISTIC_RULES'>
  isLiveModelCall: boolean
  provider: string
  model: string
  startedAt: string
  completedAt: string
  runId?: string
  replayId?: string
  replayCaptureKind?: ReplayCaptureKind
  taskCount: number
  validationIssues: string[]
  receipt?: ExecutionReceiptSummary
  notice: string
}

export interface ReviewRun {
  items: ReviewItem[]
  summary: ReviewSummary
  generatedAt: string
  mode: DemoExecutionMode
  runtime?: RunEvidence
}

export type BatchDecision = 'pending' | 'approved' | 'rejected' | 'needs_more_quotes'

export interface AuditEntry {
  id: string
  timestamp: string
  actor: string
  action: string
  subject: string
  detail: string
}

export interface ApprovalState {
  decision: BatchDecision
  note: string
  decidedAt?: string
}

export interface ImportResult {
  kind: 'bom' | 'supplier'
  fileName: string
  count: number
  message: string
}

export interface RuntimeStatus {
  service: 'ready'
  liveAvailable: boolean
  publicDemo: boolean
  customImportsAllowed: boolean
  provider: string
  model: string
  replay: {
    available: boolean
    replayId?: string
    captureKind?: ReplayCaptureKind
    capturedAt?: string
    provider?: string
    model?: string
    notice: string
  }
  notices: string[]
}

export interface RawDemoFile {
  fileName: string
  rawText: string
}

export interface LiveReviewRequest {
  dataLabel: '模拟数据'
  customerName: string
  projectName: string
  bom: RawDemoFile
  suppliers: RawDemoFile[]
  policy: DemoPolicy
}

export interface ModelBomFinding {
  originalPartNumber: string
  suggestedCanonicalMpn: string
  sourceLine: number
  issue: string
  requiresHumanReview: boolean
}

export interface ModelEvidenceFinding {
  supplierId: string
  mpn: string
  severity: 'info' | 'warning' | 'critical'
  issue: string
}

export interface OmaWorkflowOutput {
  supplierDocuments: SupplierDocument[]
  bomFindings: ModelBomFinding[]
  evidenceFindings: ModelEvidenceFinding[]
}

export interface ReplayPackage {
  schemaVersion: 1
  dataLabel: '模拟数据'
  replayId: string
  captureKind: ReplayCaptureKind
  capturedAt: string
  provider: string
  model: string
  liveRunId?: string
  fixtureHashes: Array<{ fileName: string; sha256: string }>
  workflowOutput?: OmaWorkflowOutput
  receipt?: ExecutionReceiptSummary
  notice: string
}

export interface ReviewExecutionResponse {
  run: ReviewRun
}
