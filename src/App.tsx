import { useEffect, useMemo, useState } from 'react'
import {
  getRuntimeStatus,
  runLiveReview,
  runReplayReview,
} from './api/runtime'
import { BoundaryStrip } from './components/BoundaryStrip'
import { ExportCenter } from './components/ExportCenter'
import { InputWorkspace } from './components/InputWorkspace'
import { ProcessingWorkspace } from './components/ProcessingWorkspace'
import { ReviewWorkspace } from './components/ReviewWorkspace'
import { createDemoDataset } from './data/demoData'
import { buildExportArtifacts } from './domain/exports'
import { parseBomCsv, parseSupplierDocument } from './domain/importers'
import { overrideRunRecommendation, runQuoteReview } from './domain/quoteEngine'
import type {
  ApprovalState,
  AuditEntry,
  BatchDecision,
  DemoDataset,
  DemoPath,
  ImportResult,
  ProcessingState,
  ReviewItem,
  RuntimeStatus,
} from './domain/types'

type Stage = 'input' | 'processing' | 'review' | 'export'

const stageMeta: Array<{ id: Stage; index: string; label: string }> = [
  { id: 'input', index: '01', label: '原始资料' },
  { id: 'processing', index: '02', label: '归一处理' },
  { id: 'review', index: '03', label: '采购审核' },
  { id: 'export', index: '04', label: '审批导出' },
]

function auditEntry(action: string, subject: string, detail: string): AuditEntry {
  const timestamp = new Date().toISOString()
  return {
    id: `${timestamp}-${action}-${subject}`,
    timestamp,
    actor: '采购负责人（演示）',
    action,
    subject,
    detail,
  }
}

function initialAudit(dataset: DemoDataset): AuditEntry[] {
  return [
    {
      id: 'DEMO-LOAD-001',
      timestamp: `${dataset.policy.asOfDate}T09:29:50+08:00`,
      actor: '演示系统',
      action: '载入模拟测试集',
      subject: dataset.projectName,
      detail: `${dataset.bomLines.length} 行 BOM；${dataset.supplierDocuments.length} 家虚构供应商`,
    },
  ]
}

function App() {
  const [dataset, setDataset] = useState<DemoDataset>(() => createDemoDataset())
  const [run, setRun] = useState(() => runQuoteReview(dataset))
  const [stage, setStage] = useState<Stage>('input')
  const [hasRun, setHasRun] = useState(false)
  const [runtimeStatus, setRuntimeStatus] = useState<RuntimeStatus>()
  const [runtimeError, setRuntimeError] = useState<string>()
  const [selectedPath, setSelectedPath] = useState<DemoPath>('live')
  const [processing, setProcessing] = useState<ProcessingState>({
    status: 'idle',
    path: 'live',
  })
  const [isBundledDataset, setIsBundledDataset] = useState(true)
  const [approval, setApproval] = useState<ApprovalState>({ decision: 'pending', note: '' })
  const [moreQuoteItemIds, setMoreQuoteItemIds] = useState<Set<string>>(() => new Set())
  const [auditEntries, setAuditEntries] = useState<AuditEntry[]>(() => initialAudit(dataset))
  const [importResults, setImportResults] = useState<ImportResult[]>([])

  useEffect(() => {
    let cancelled = false
    getRuntimeStatus()
      .then((status) => {
        if (cancelled) return
        setRuntimeStatus(status)
        setRuntimeError(undefined)
      })
      .catch((error: unknown) => {
        if (cancelled) return
        setRuntimeError(error instanceof Error ? error.message : '无法连接本地 Demo 服务')
      })
    return () => {
      cancelled = true
    }
  }, [])

  const artifacts = useMemo(
    () => buildExportArtifacts(dataset, run, approval, auditEntries, moreQuoteItemIds),
    [approval, auditEntries, dataset, moreQuoteItemIds, run],
  )

  async function executeRun(path: DemoPath) {
    setSelectedPath(path)
    setHasRun(false)
    setApproval({ decision: 'pending', note: '' })
    setMoreQuoteItemIds(new Set())
    setProcessing({ status: 'running', path })
    setStage('processing')
    setAuditEntries((current) => [
      ...current,
      auditEntry(
        path === 'live' ? '提交真实 OMA 审核' : '启动离线回放',
        dataset.projectName,
        path === 'live'
          ? '向本地服务提交明确标记为模拟的数据；失败不自动降级'
          : '读取内置回放包；本次不调用模型',
      ),
    ])

    try {
      const response = path === 'live'
        ? await runLiveReview(dataset)
        : await runReplayReview()
      const nextRun = response.run
      setRun(nextRun)
      setHasRun(true)
      setProcessing({ status: 'success', path })
      setAuditEntries((current) => [
        ...current,
        auditEntry(
          path === 'live' ? '真实 OMA 审核完成' : '离线回放完成',
          dataset.projectName,
          path === 'live'
            ? `${nextRun.runtime?.provider}/${nextRun.runtime?.model}；${nextRun.runtime?.receipt?.rolesExecuted.length ?? 0} 个角色；${nextRun.summary.rawLineCount} 行归一为 ${nextRun.summary.normalizedLineCount} 项`
            : `${nextRun.runtime?.replayCaptureKind ?? '未知回放类型'}；未发生本次模型调用`,
        ),
      ])
    } catch (error) {
      const message = error instanceof Error ? error.message : '本地执行失败'
      setProcessing({ status: 'error', path, error: message })
      setAuditEntries((current) => [
        ...current,
        auditEntry(
          path === 'live' ? '真实 OMA 审核失败' : '离线回放失败',
          dataset.projectName,
          `${message}；没有自动切换路径`,
        ),
      ])
    }
  }

  function startRun(path: DemoPath) {
    void executeRun(path)
  }

  async function importFiles(files: FileList) {
    let nextDataset = dataset
    const results: ImportResult[] = []

    for (const file of Array.from(files)) {
      try {
        const text = await file.text()
        if (!text.includes('模拟数据')) {
          throw new Error('文件必须明确包含“模拟数据”标记')
        }
        const isBom = file.name.toLowerCase().endsWith('.csv') && text.includes('line_id,part_number')

        if (isBom) {
          const bomLines = parseBomCsv(file.name, text)
          if (bomLines.length < 20 || bomLines.length > 30) {
            throw new Error('本 Demo 的 BOM 必须为 20–30 行')
          }
          nextDataset = {
            ...nextDataset,
            bomFileName: file.name,
            bomRawText: text,
            bomLines,
          }
          results.push({
            kind: 'bom',
            fileName: file.name,
            count: bomLines.length,
            message: `已在本地读取 ${file.name}：${bomLines.length} 行模拟 BOM`,
          })
        } else {
          const supplierDocument = parseSupplierDocument(file.name, text)
          const existingIndex = nextDataset.supplierDocuments.findIndex(
            (document) => document.supplierId === supplierDocument.supplierId,
          )
          const supplierDocuments = [...nextDataset.supplierDocuments]
          if (existingIndex >= 0) supplierDocuments[existingIndex] = supplierDocument
          else supplierDocuments.push(supplierDocument)
          nextDataset = { ...nextDataset, supplierDocuments }
          results.push({
            kind: 'supplier',
            fileName: file.name,
            count: supplierDocument.quotes.length,
            message: `已在本地读取 ${file.name}：${supplierDocument.quotes.length} 条模拟报价`,
          })
        }
      } catch (error) {
        results.push({
          kind: 'supplier',
          fileName: file.name,
          count: 0,
          message: `导入失败：${error instanceof Error ? error.message : '未知格式错误'}`,
        })
      }
    }

    setDataset(nextDataset)
    setIsBundledDataset(false)
    setImportResults((current) => [...current, ...results])
    setHasRun(false)
    setApproval({ decision: 'pending', note: '' })
    setProcessing({ status: 'idle', path: selectedPath })
    setStage('input')
  }

  function changeRecommendation(itemId: string, quoteId: string) {
    const item = run.items.find((candidate) => candidate.bom.id === itemId)
    const quote = item?.alternatives.find((candidate) => candidate.id === quoteId)
    if (!item || !quote) return

    setRun((current) =>
      overrideRunRecommendation(current, itemId, quoteId, dataset.policy),
    )
    setAuditEntries((current) => [
      ...current,
      auditEntry(
        '人工修改推荐',
        item.bom.canonicalMpn,
        `改为 ${quote.supplierName}；来源 ${quote.sourceFile} ${quote.sourceLocator}`,
      ),
    ])
  }

  function toggleMoreQuote(item: ReviewItem) {
    const wasMarked = moreQuoteItemIds.has(item.bom.id)
    setMoreQuoteItemIds((current) => {
      const next = new Set(current)
      if (next.has(item.bom.id)) next.delete(item.bom.id)
      else next.add(item.bom.id)
      return next
    })
    setAuditEntries((current) => [
      ...current,
      auditEntry(
        wasMarked ? '取消补充询价标记' : '标记补充询价',
        item.bom.canonicalMpn,
        '仅更新本地审核状态；未联系任何供应商',
      ),
    ])
  }

  function decideBatch(decision: Exclude<BatchDecision, 'pending'>, note: string) {
    const decidedAt = new Date().toISOString()
    setApproval({ decision, note, decidedAt })
    setAuditEntries((current) => [
      ...current,
      {
        ...auditEntry('负责人审批', dataset.projectName, `${decision}；备注：${note}`),
        timestamp: decidedAt,
      },
    ])
  }

  function resetDemo() {
    const freshDataset = createDemoDataset()
    setDataset(freshDataset)
    setRun(runQuoteReview(freshDataset))
    setStage('input')
    setHasRun(false)
    setSelectedPath('live')
    setProcessing({ status: 'idle', path: 'live' })
    setIsBundledDataset(true)
    setApproval({ decision: 'pending', note: '' })
    setMoreQuoteItemIds(new Set())
    setAuditEntries(initialAudit(freshDataset))
    setImportResults([])
  }

  function canNavigate(target: Stage): boolean {
    if (target === 'input') return true
    if (target === 'processing') return hasRun || processing.status !== 'idle'
    if (target === 'review') return hasRun
    return hasRun && approval.decision !== 'pending'
  }

  const completedRun = hasRun ? run : undefined
  const modeLabel = hasRun
    ? run.mode === 'LIVE_OMA_MODEL'
      ? '真实 OMA + 模型 API'
      : '离线回放（已标注）'
    : selectedPath === 'live'
      ? '真实 OMA + 模型 API'
      : '离线回放（已标注）'
  const headerStatus = hasRun
    ? run.runtime?.isLiveModelCall
      ? 'LIVE RESULT'
      : 'REPLAY RESULT'
    : selectedPath === 'replay'
      ? 'REPLAY READY'
      : runtimeStatus?.liveAvailable
        ? 'LIVE READY'
        : 'LIVE BLOCKED'

  return (
    <div className="app-shell">
      <BoundaryStrip
        selectedPath={selectedPath}
        runtimeStatus={runtimeStatus}
        completedRun={completedRun}
      />
      <header className="app-header">
        <div className="product-lockup">
          <span className="product-mark">
            <i />
            <i />
            <i />
          </span>
          <div>
            <p>电子料业务流程样板</p>
            <h1>BOM 报价审核台</h1>
          </div>
        </div>
        <div className="header-meta">
          <span className={`offline-badge ${selectedPath === 'live' ? 'live' : 'replay'}`}>
            <i /> {headerStatus}
          </span>
          <span>批次 DEMO-20260723-01</span>
          <button type="button" className="reset-button" onClick={resetDemo}>重置演示</button>
        </div>
      </header>

      <nav className="stage-nav" aria-label="演示流程">
        {stageMeta.map((item) => {
          const enabled = canNavigate(item.id)
          const active = stage === item.id
          return (
            <button
              type="button"
              className={active ? 'active' : ''}
              disabled={!enabled}
              onClick={() => enabled && setStage(item.id)}
              key={item.id}
            >
              <span>{item.index}</span>
              <strong>{item.label}</strong>
              {item.id !== 'export' && <i aria-hidden="true">→</i>}
            </button>
          )
        })}
        <div className="stage-mode">
          <span>处理模式</span>
          <strong>{modeLabel}</strong>
        </div>
      </nav>

      <main>
        {stage === 'input' && (
          <InputWorkspace
            dataset={dataset}
            importResults={importResults}
            runtimeStatus={runtimeStatus}
            runtimeError={runtimeError}
            selectedPath={selectedPath}
            isBundledDataset={isBundledDataset}
            customImportsAllowed={runtimeStatus?.customImportsAllowed === true}
            onImport={importFiles}
            onPathChange={setSelectedPath}
            onRun={startRun}
          />
        )}
        {stage === 'processing' && (
          <ProcessingWorkspace
            dataset={dataset}
            run={processing.status === 'success' ? run : undefined}
            state={processing}
            onContinue={() => setStage('review')}
            onRetry={() => {
              void executeRun(processing.path)
            }}
            onReplay={() => {
              void executeRun('replay')
            }}
            onBack={() => setStage('input')}
          />
        )}
        {stage === 'review' && (
          <ReviewWorkspace
            run={run}
            policy={dataset.policy}
            approval={approval}
            moreQuoteItemIds={moreQuoteItemIds}
            onOverride={changeRecommendation}
            onToggleMoreQuote={toggleMoreQuote}
            onDecision={decideBatch}
            onExport={() => setStage('export')}
          />
        )}
        {stage === 'export' && (
          <ExportCenter
            artifacts={artifacts}
            approval={approval}
            auditEntries={auditEntries}
          />
        )}
      </main>

      <footer className="app-footer">
        <p>
          <strong>全部为虚构模拟数据。</strong>
          当前未接入真实 ERP、报价库、邮箱或供应商系统；替代料不构成工程认证。
        </p>
        <p>Demo 证明流程与交付形态，不证明真实客户已获得收益。真实价值需用脱敏历史 BOM 回放验证。</p>
      </footer>
    </div>
  )
}

export default App
