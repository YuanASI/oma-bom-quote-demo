import type {
  AmbiguityCode,
  BomLine,
  DemoDataset,
  DemoPolicy,
  EvaluatedQuote,
  ModelBomFinding,
  ModelEvidenceFinding,
  NormalizedBomItem,
  QuoteRisk,
  ReviewItem,
  ReviewRun,
  RunEvidence,
  SupplierQuote,
} from './types.js'

interface NormalizationResult {
  canonicalMpn: string
  note?: string
  ambiguityCode?: AmbiguityCode
}

const ambiguityLabels: Record<AmbiguityCode, string> = {
  SUSPECTED_PACKAGING_SUFFIX: '客户料号疑似缺少包装后缀，需工程确认',
  UNCERTAIN_FINAL_CHARACTER: '客户料号末位不确定，需工程确认',
  MISSING_BRAND: '客户 BOM 缺少品牌，采购需核对来源',
  MISSING_CONNECTOR_SPEC: '连接器品牌及公母头规格不完整',
}

function compactMpn(value: string): string {
  return value.trim().toUpperCase().replace(/\s+/g, '')
}

export function normalizePartNumber(value: string): NormalizationResult {
  const compact = compactMpn(value)
  if (compact === 'STM32F103C8T6') {
    return {
      canonicalMpn: 'STM32F103C8T6',
      note: value !== compact ? '移除料号中的空格' : undefined,
    }
  }
  if (compact === 'AMS11173V3' || compact === 'AMS1117-3.3') {
    return {
      canonicalMpn: 'AMS1117-3.3',
      note: compact === 'AMS11173V3' ? '将 3V3 写法统一为 3.3' : undefined,
    }
  }
  if (compact === 'TPS62160DSG') {
    return {
      canonicalMpn: 'TPS62160DSGR',
      note: '按常见包装后缀补全为 TPS62160DSGR，仅供匹配',
      ambiguityCode: 'SUSPECTED_PACKAGING_SUFFIX',
    }
  }
  if (compact === 'GRM188R71C104KA01?') {
    return {
      canonicalMpn: 'GRM188R71C104KA01D',
      note: '以供应商回复中的 D 后缀暂作匹配',
      ambiguityCode: 'UNCERTAIN_FINAL_CHARACTER',
    }
  }
  return { canonicalMpn: compact }
}

function normalizeQuoteMpn(value: string): string {
  return normalizePartNumber(value).canonicalMpn
}

function mergeBomGroup(lines: BomLine[], index: number): NormalizedBomItem {
  const normalized = lines.map((line) => normalizePartNumber(line.partNumber))
  const notes = normalized.flatMap((result) => (result.note ? [result.note] : []))
  const ambiguityCodes = normalized.flatMap((result) =>
    result.ambiguityCode ? [result.ambiguityCode] : [],
  )
  const brand = lines.find((line) => line.brand.trim())?.brand ?? ''

  if (!brand) ambiguityCodes.push('MISSING_BRAND')
  if (normalized[0].canonicalMpn === 'PH2.0-4P') {
    ambiguityCodes.push('MISSING_CONNECTOR_SPEC')
  }
  if (lines.length > 1) {
    notes.push(`合并原 BOM 第 ${lines.map((line) => line.lineId).join('、')} 行，数量相加`)
  }

  return {
    id: `ITEM-${String(index + 1).padStart(2, '0')}`,
    canonicalMpn: normalized[0].canonicalMpn,
    brand,
    description: lines[0].description,
    quantity: lines.reduce((sum, line) => sum + line.quantity, 0),
    targetLeadDays: Math.min(...lines.map((line) => line.targetLeadDays)),
    targetUnitPriceCny: Math.min(
      ...lines.map((line) => line.targetUnitPriceCny ?? Number.POSITIVE_INFINITY),
    ),
    remarks: lines.map((line) => line.remarks).filter(Boolean),
    originalLines: lines,
    normalizationNotes: [...new Set(notes)],
    ambiguityCodes: [...new Set(ambiguityCodes)],
  }
}

export function normalizeBom(lines: BomLine[]): NormalizedBomItem[] {
  const groups = new Map<string, BomLine[]>()
  for (const line of lines) {
    const key = normalizePartNumber(line.partNumber).canonicalMpn
    groups.set(key, [...(groups.get(key) ?? []), line])
  }
  return [...groups.values()].map(mergeBomGroup)
}

function currencyTaxRisk(quote: SupplierQuote): QuoteRisk[] {
  if (quote.currency === 'CNY' && quote.taxBasis === 'EXCLUDED') return []
  const scope =
    quote.currency === 'CNY'
      ? '含税价已按模拟 13% 税率还原为未税价'
      : `${quote.currency} 已按固定模拟汇率换算为 CNY 未税价`
  return [
    {
      code: 'CURRENCY_TAX_NORMALIZED',
      label: scope,
      severity: 'info',
      owner: '销售',
    },
  ]
}

function evaluateQuote(
  quote: SupplierQuote,
  bom: NormalizedBomItem,
  policy: DemoPolicy,
): EvaluatedQuote {
  const risks: QuoteRisk[] = [...currencyTaxRisk(quote)]

  if (quote.validUntil < policy.asOfDate) {
    risks.push({
      code: 'EXPIRED',
      label: `报价已于 ${quote.validUntil} 过期`,
      severity: 'critical',
      owner: '采购',
    })
  }
  if (quote.leadDays > bom.targetLeadDays) {
    risks.push({
      code: 'LATE_DELIVERY',
      label: `交期 ${quote.leadDays} 天，晚于目标 ${bom.targetLeadDays} 天`,
      severity: 'critical',
      owner: '采购',
    })
  }
  if (quote.stock < bom.quantity) {
    risks.push({
      code: 'INSUFFICIENT_STOCK',
      label: `库存 ${quote.stock}，无法覆盖需求 ${bom.quantity}`,
      severity: 'critical',
      owner: '采购',
    })
  }
  if (bom.quantity < quote.moq) {
    risks.push({
      code: 'BELOW_MOQ',
      label: `需求 ${bom.quantity} 低于 MOQ ${quote.moq}`,
      severity: 'critical',
      owner: '采购',
    })
  }
  if (quote.qualification === 'PENDING') {
    risks.push({
      code: 'QUALIFICATION_PENDING',
      label: '供应商资质待人工审核',
      severity: 'critical',
      owner: '采购',
    })
  }
  if (quote.alternateFor) {
    risks.push({
      code: 'ALTERNATE_UNCONFIRMED',
      label: `替代料 ${quote.mpn} 尚未由工程确认`,
      severity: 'critical',
      owner: '工程',
    })
  }

  const grossCny = quote.unitPrice * policy.fxToCny[quote.currency]
  const normalizedCostCny =
    quote.taxBasis === 'VAT_INCLUDED' ? grossCny / (1 + policy.cnyVatRate) : grossCny

  return {
    ...quote,
    canonicalMpn: normalizeQuoteMpn(quote.mpn),
    normalizedCostCny,
    risks,
    hardRiskCount: risks.filter((risk) => risk.severity === 'critical').length,
  }
}

function compareRecommendation(left: EvaluatedQuote, right: EvaluatedQuote): number {
  if (left.hardRiskCount !== right.hardRiskCount) {
    return left.hardRiskCount - right.hardRiskCount
  }
  if (left.normalizedCostCny !== right.normalizedCostCny) {
    return left.normalizedCostCny - right.normalizedCostCny
  }
  return left.leadDays - right.leadDays
}

function criticalAmbiguities(item: NormalizedBomItem): AmbiguityCode[] {
  return item.ambiguityCodes.filter((code) =>
    ['SUSPECTED_PACKAGING_SUFFIX', 'UNCERTAIN_FINAL_CHARACTER', 'MISSING_CONNECTOR_SPEC'].includes(
      code,
    ),
  )
}

function financials(
  bom: NormalizedBomItem,
  quote: EvaluatedQuote | undefined,
  policy: DemoPolicy,
): Pick<ReviewItem, 'grossMargin' | 'marginWarning' | 'suggestedCustomerUnitPriceCny'> {
  if (!quote) return {}
  const suggestedCustomerUnitPriceCny =
    bom.targetUnitPriceCny && Number.isFinite(bom.targetUnitPriceCny)
      ? bom.targetUnitPriceCny
      : quote.normalizedCostCny / 0.88
  const grossMargin =
    (suggestedCustomerUnitPriceCny - quote.normalizedCostCny) / suggestedCustomerUnitPriceCny

  let marginWarning: string | undefined
  if (grossMargin < 0) {
    marginWarning = `目标价低于归一化采购成本，预计毛利 ${formatPercent(grossMargin)}`
  } else if (grossMargin < policy.minimumGrossMargin) {
    marginWarning = `预计毛利 ${formatPercent(grossMargin)}，低于模拟阈值 ${formatPercent(
      policy.minimumGrossMargin,
    )}`
  }

  return { grossMargin, marginWarning, suggestedCustomerUnitPriceCny }
}

function formatPercent(value: number): string {
  return `${(value * 100).toFixed(1)}%`
}

function buildReviewItem(
  bom: NormalizedBomItem,
  quotes: SupplierQuote[],
  policy: DemoPolicy,
): ReviewItem {
  const evaluated = quotes
    .filter((quote) => {
      const canonical = normalizeQuoteMpn(quote.mpn)
      const alternateFor = quote.alternateFor ? normalizeQuoteMpn(quote.alternateFor) : undefined
      return canonical === bom.canonicalMpn || alternateFor === bom.canonicalMpn
    })
    .map((quote) => evaluateQuote(quote, bom, policy))
    .sort(compareRecommendation)

  if (!evaluated.length) {
    const keyRisks = bom.ambiguityCodes.map((code) => ambiguityLabels[code])
    return {
      bom,
      status: 'no_quote',
      alternatives: [],
      recommendationReasons: ['四份模拟供应商回复中均未找到可匹配报价'],
      keyRisks: ['无法完全报价', ...keyRisks],
      confirmationOwners: ['采购'],
    }
  }

  const recommendation = evaluated[0]
  const lowestQuote = [...evaluated].sort(
    (left, right) => left.normalizedCostCny - right.normalizedCostCny,
  )[0]
  const hardAmbiguities = criticalAmbiguities(bom)
  const status =
    recommendation.hardRiskCount > 0 || hardAmbiguities.length > 0 ? 'pending' : 'matched'
  const criticalRisks = recommendation.risks
    .filter((risk) => risk.severity === 'critical')
    .map((risk) => risk.label)
  const ambiguityRisks = bom.ambiguityCodes.map((code) => ambiguityLabels[code])
  const recommendationReasons =
    recommendation.hardRiskCount === 0
      ? ['满足交期、库存、MOQ 与资质条件后，归一化成本最低', `渠道：${channelLabel(recommendation.channelType)}`]
      : ['当前没有完全合格报价；保留风险最少且可追溯的候选供人工处置']

  const lowestNotRecommendedReason =
    lowestQuote.id !== recommendation.id
      ? `最低价来自 ${lowestQuote.supplierName}，但未推荐：${lowestQuote.risks
          .filter((risk) => risk.severity === 'critical')
          .map((risk) => risk.label)
          .join('；')}`
      : undefined
  const owners = new Set<'采购' | '销售' | '工程'>()
  recommendation.risks
    .filter((risk) => risk.severity === 'critical')
    .forEach((risk) => owners.add(risk.owner))
  if (bom.ambiguityCodes.includes('MISSING_BRAND')) owners.add('采购')
  if (hardAmbiguities.length) owners.add('工程')

  const money = financials(bom, recommendation, policy)
  const keyRisks = [...criticalRisks, ...ambiguityRisks]
  if (money.marginWarning) keyRisks.push(money.marginWarning)

  return {
    bom,
    status,
    recommendation,
    lowestQuote,
    alternatives: evaluated,
    recommendationReasons,
    lowestNotRecommendedReason,
    keyRisks: [...new Set(keyRisks)],
    confirmationOwners: [...owners],
    expectedLeadDays: recommendation.leadDays,
    ...money,
  }
}

function channelLabel(channel: SupplierQuote['channelType']): string {
  return {
    AUTHORIZED: '授权渠道',
    INDEPENDENT: '独立分销',
    BROKER: '贸易商 / Broker',
    SPOT: '现货渠道',
  }[channel]
}

export function runQuoteReview(dataset: DemoDataset, runtime?: RunEvidence): ReviewRun {
  const normalizedBom = normalizeBom(dataset.bomLines)
  const allQuotes = dataset.supplierDocuments.flatMap((document) => document.quotes)
  const items = normalizedBom.map((bom) => buildReviewItem(bom, allQuotes, dataset.policy))
  const matchedCount = items.filter((item) => item.status === 'matched').length
  const pendingCount = items.filter((item) => item.status === 'pending').length
  const noQuoteCount = items.filter((item) => item.status === 'no_quote').length
  const coveredCount = matchedCount + pendingCount

  return {
    items,
    summary: {
      rawLineCount: dataset.bomLines.length,
      normalizedLineCount: normalizedBom.length,
      matchedCount,
      pendingCount,
      noQuoteCount,
      coveredCount,
      coverageRate: coveredCount / normalizedBom.length,
      duplicateGroups: normalizedBom.filter((item) => item.originalLines.length > 1).length,
      ambiguousCount: normalizedBom.filter((item) => item.ambiguityCodes.length > 0).length,
    },
    generatedAt: runtime?.completedAt ?? `${dataset.policy.asOfDate}T09:30:00+08:00`,
    mode: runtime?.executionMode ?? 'DETERMINISTIC_RULES',
    ...(runtime ? { runtime } : {}),
  }
}

export function overrideRecommendation(
  item: ReviewItem,
  quoteId: string,
  policy: DemoPolicy,
): ReviewItem {
  const recommendation = item.alternatives.find((quote) => quote.id === quoteId)
  if (!recommendation) return item
  const money = financials(item.bom, recommendation, policy)
  const criticalRisks = recommendation.risks
    .filter((risk) => risk.severity === 'critical')
    .map((risk) => risk.label)
  const ambiguityRisks = item.bom.ambiguityCodes.map((code) => ambiguityLabels[code])
  const keyRisks = [...criticalRisks, ...ambiguityRisks]
  if (money.marginWarning) keyRisks.push(money.marginWarning)
  const owners = new Set<'采购' | '销售' | '工程'>()
  recommendation.risks
    .filter((risk) => risk.severity === 'critical')
    .forEach((risk) => owners.add(risk.owner))
  if (item.bom.ambiguityCodes.includes('MISSING_BRAND')) owners.add('采购')
  if (criticalAmbiguities(item.bom).length > 0) owners.add('工程')

  return {
    ...item,
    recommendation,
    status:
      recommendation.hardRiskCount > 0 || criticalAmbiguities(item.bom).length > 0
        ? 'pending'
        : 'matched',
    recommendationReasons: ['采购负责人已人工修改推荐', `原始证据：${recommendation.sourceFile}`],
    expectedLeadDays: recommendation.leadDays,
    keyRisks: [...new Set(keyRisks)],
    confirmationOwners: [...owners],
    ...money,
  }
}

export function overrideRunRecommendation(
  run: ReviewRun,
  itemId: string,
  quoteId: string,
  policy: DemoPolicy,
): ReviewRun {
  const items = run.items.map((item) =>
    item.bom.id === itemId ? overrideRecommendation(item, quoteId, policy) : item,
  )
  const matchedCount = items.filter((item) => item.status === 'matched').length
  const pendingCount = items.filter((item) => item.status === 'pending').length
  const noQuoteCount = items.filter((item) => item.status === 'no_quote').length
  const coveredCount = matchedCount + pendingCount

  return {
    ...run,
    items,
    summary: {
      ...run.summary,
      matchedCount,
      pendingCount,
      noQuoteCount,
      coveredCount,
      coverageRate: coveredCount / items.length,
    },
  }
}

export function applyModelReviewFindings(
  run: ReviewRun,
  bomFindings: ModelBomFinding[],
  evidenceFindings: ModelEvidenceFinding[],
): ReviewRun {
  const items = run.items.map((item) => {
    const bomIssues = bomFindings.filter((finding) => {
      const original = normalizePartNumber(finding.originalPartNumber).canonicalMpn
      const suggested = normalizePartNumber(finding.suggestedCanonicalMpn).canonicalMpn
      return original === item.bom.canonicalMpn || suggested === item.bom.canonicalMpn
    })
    const evidenceIssues = evidenceFindings.filter((finding) =>
      item.alternatives.some((quote) =>
        quote.supplierId === finding.supplierId &&
        normalizeQuoteMpn(finding.mpn) === quote.canonicalMpn,
      ),
    )
    const modelRisks = [
      ...bomIssues.map((finding) => `OMA 料号复核建议：${finding.issue}`),
      ...evidenceIssues.map((finding) => `OMA 证据复核建议：${finding.issue}`),
    ]
    if (modelRisks.length === 0) return item

    const needsEngineering = bomIssues.some((finding) => finding.requiresHumanReview)
    const needsProcurement = evidenceIssues.some((finding) => finding.severity !== 'info')
    const confirmationOwners = new Set(item.confirmationOwners)
    if (needsEngineering) confirmationOwners.add('工程')
    if (needsProcurement) confirmationOwners.add('采购')

    // Model findings are advisory evidence. Only deterministic application
    // rules may change the recommendation or review status.
    return {
      ...item,
      keyRisks: [...new Set([...item.keyRisks, ...modelRisks])],
      confirmationOwners: [...confirmationOwners],
    }
  })

  return {
    ...run,
    items,
  }
}

export const display = {
  money(value?: number): string {
    return value === undefined ? '—' : `¥${value.toFixed(value < 1 ? 4 : 2)}`
  },
  percent(value: number): string {
    return formatPercent(value)
  },
  channel: channelLabel,
}
