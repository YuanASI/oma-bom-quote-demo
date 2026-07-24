import type {
  ApprovalState,
  AuditEntry,
  DemoDataset,
  ReviewItem,
  ReviewRun,
} from './types.js'
import { display } from './quoteEngine.js'

export interface ExportArtifact {
  id: 'customer_quote' | 'procurement_review' | 'exceptions' | 'audit'
  fileName: string
  label: string
  description: string
  mimeType: string
  content: string
  rowCount: number
}

function csvCell(value: unknown): string {
  const stringValue = String(value ?? '')
  if (!/[",\n]/.test(stringValue)) return stringValue
  return `"${stringValue.replaceAll('"', '""')}"`
}

function csv(rows: unknown[][]): string {
  return `\uFEFF${rows.map((row) => row.map(csvCell).join(',')).join('\n')}\n`
}

function statusLabel(item: ReviewItem): string {
  if (item.status === 'matched') return '已匹配'
  if (item.status === 'pending') return '待确认'
  return '无报价'
}

function customerQuoteRows(run: ReviewRun): unknown[][] {
  return [
    ['模拟数据 / 客户报价草稿 / 非正式报价 / 不构成交易承诺'],
    [
      '处理来源',
      run.mode === 'LIVE_OMA_MODEL'
        ? `本次真实 OMA + 模型 API；${run.runtime?.provider}/${run.runtime?.model}`
        : `离线回放；${run.runtime?.replayCaptureKind ?? '回放类型未知'}；本次未调用模型`,
    ],
    ['归一化料号', '品牌', '需求数量', '客户草稿单价 CNY', '预计交期', '状态', '对客备注'],
    ...run.items.map((item) => [
      item.bom.canonicalMpn,
      item.bom.brand || '待确认',
      item.bom.quantity,
      item.suggestedCustomerUnitPriceCny?.toFixed(4) ?? '',
      item.expectedLeadDays ? `${item.expectedLeadDays} 天` : '待补询',
      statusLabel(item),
      item.status === 'matched'
        ? '模拟报价草稿；下单前需复核库存、税费与有效期'
        : item.keyRisks.join('；'),
    ]),
  ]
}

function procurementRows(run: ReviewRun): unknown[][] {
  return [
    ['模拟数据 / 内部采购审核表 / 禁止直接下单'],
    [
      '处理来源',
      run.mode === 'LIVE_OMA_MODEL'
        ? `本次真实 OMA + 模型 API；执行标识 ${run.runtime?.runId ?? '—'}`
        : `离线回放；回放标识 ${run.runtime?.replayId ?? '—'}；本次未调用模型`,
    ],
    [
      '审核项',
      '归一化料号',
      '原 BOM 行',
      '需求数量',
      '推荐供应商',
      '归一化未税成本 CNY',
      '原币种单价',
      '库存',
      'MOQ',
      '交期',
      'Date Code',
      '渠道',
      '状态',
      '关键风险',
      '证据文件',
      '证据位置',
    ],
    ...run.items.map((item) => [
      item.bom.id,
      item.bom.canonicalMpn,
      item.bom.originalLines.map((line) => line.lineId).join('+'),
      item.bom.quantity,
      item.recommendation?.supplierName ?? '—',
      item.recommendation?.normalizedCostCny.toFixed(4) ?? '',
      item.recommendation
        ? `${item.recommendation.unitPrice} ${item.recommendation.currency} / ${item.recommendation.taxBasis}`
        : '',
      item.recommendation?.stock ?? '',
      item.recommendation?.moq ?? '',
      item.expectedLeadDays ? `${item.expectedLeadDays} 天` : '',
      item.recommendation?.dateCode ?? '',
      item.recommendation ? display.channel(item.recommendation.channelType) : '',
      statusLabel(item),
      item.keyRisks.join('；'),
      item.recommendation?.sourceFile ?? '',
      item.recommendation?.sourceLocator ?? '',
    ]),
  ]
}

function exceptionRows(run: ReviewRun, moreQuoteItemIds: Set<string>): unknown[][] {
  const exceptionItems = run.items.filter(
    (item) => item.status !== 'matched' || moreQuoteItemIds.has(item.bom.id) || item.marginWarning,
  )
  return [
    ['模拟数据 / 未解决异常清单 / 需人工关闭'],
    ['审核项', '料号', '异常类型', '责任角色', '建议下一步', '证据来源'],
    ...exceptionItems.map((item) => [
      item.bom.id,
      item.bom.canonicalMpn,
      moreQuoteItemIds.has(item.bom.id)
        ? `已标记补充询价；${item.keyRisks.join('；')}`
        : item.keyRisks.join('；') || statusLabel(item),
      item.confirmationOwners.join(' / ') || '采购',
      item.status === 'no_quote'
        ? '补充询价，不进入客户正式报价'
        : item.marginWarning
          ? '销售复核对客价格与毛利'
          : '核对风险后批准、改选或退回',
      item.recommendation
        ? `${item.recommendation.sourceFile} ${item.recommendation.sourceLocator}`
        : item.bom.originalLines[0].sourceFile,
    ]),
  ]
}

export function buildExportArtifacts(
  dataset: DemoDataset,
  run: ReviewRun,
  approval: ApprovalState,
  auditEntries: AuditEntry[],
  moreQuoteItemIds: Set<string>,
): ExportArtifact[] {
  const customerRows = customerQuoteRows(run)
  const procurementReviewRows = procurementRows(run)
  const exceptions = exceptionRows(run, moreQuoteItemIds)
  const auditPayload = {
    dataLabel: '模拟数据',
    notice:
      run.mode === 'LIVE_OMA_MODEL'
        ? '本记录来自真实 OMA 与模型 API 对模拟数据的处理，随后执行确定性业务规则；未连接 ERP、邮箱、报价库或供应商系统，未联系供应商，未执行下单。'
        : '本记录来自明确标注的离线回放；本次未调用模型。未连接 ERP、邮箱、报价库或供应商系统，未联系供应商，未执行下单。',
    customer: dataset.customerName,
    project: dataset.projectName,
    policy: dataset.policy,
    execution: run.runtime,
    approval,
    events: auditEntries,
  }

  return [
    {
      id: 'customer_quote',
      fileName: '01-客户报价草稿-模拟.csv',
      label: '客户报价草稿',
      description: '不含供应商成本；未解决项保留为待确认。',
      mimeType: 'text/csv;charset=utf-8',
      content: csv(customerRows),
      rowCount: run.items.length,
    },
    {
      id: 'procurement_review',
      fileName: '02-内部采购审核表-模拟.csv',
      label: '内部采购审核表',
      description: '包含归一化成本、推荐理由、风险与来源位置。',
      mimeType: 'text/csv;charset=utf-8',
      content: csv(procurementReviewRows),
      rowCount: run.items.length,
    },
    {
      id: 'exceptions',
      fileName: '03-未解决异常清单-模拟.csv',
      label: '未解决异常清单',
      description: '供采购、销售、工程逐项关闭，不触发外部动作。',
      mimeType: 'text/csv;charset=utf-8',
      content: csv(exceptions),
      rowCount: Math.max(0, exceptions.length - 2),
    },
    {
      id: 'audit',
      fileName: '04-审计记录-模拟.json',
      label: '简单审计记录',
      description: '记录处理模式、人工改选、审批动作与固定假设。',
      mimeType: 'application/json;charset=utf-8',
      content: `${JSON.stringify(auditPayload, null, 2)}\n`,
      rowCount: auditEntries.length,
    },
  ]
}

export function downloadArtifact(artifact: ExportArtifact): void {
  const blob = new Blob([artifact.content], { type: artifact.mimeType })
  const href = URL.createObjectURL(blob)
  const anchor = document.createElement('a')
  anchor.href = href
  anchor.download = artifact.fileName
  document.body.append(anchor)
  anchor.click()
  anchor.remove()
  URL.revokeObjectURL(href)
}

export function downloadRawFile(fileName: string, content: string): void {
  downloadArtifact({
    id: 'audit',
    fileName,
    label: fileName,
    description: '原始模拟文件',
    mimeType: fileName.endsWith('.json')
      ? 'application/json;charset=utf-8'
      : 'text/plain;charset=utf-8',
    content,
    rowCount: 0,
  })
}
