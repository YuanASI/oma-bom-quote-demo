import { describe, expect, it } from 'vitest'
import { createDemoDataset } from '../data/demoData'
import {
  applyModelReviewFindings,
  normalizeBom,
  overrideRecommendation,
  overrideRunRecommendation,
  runQuoteReview,
} from './quoteEngine'

describe('离线 BOM 报价审核规则', () => {
  const dataset = createDemoDataset()
  const run = runQuoteReview(dataset)

  it('把 26 行原始 BOM 归一为 24 个采购项并保留覆盖口径', () => {
    expect(dataset.bomLines).toHaveLength(26)
    expect(normalizeBom(dataset.bomLines)).toHaveLength(24)
    expect(run.summary).toMatchObject({
      rawLineCount: 26,
      normalizedLineCount: 24,
      matchedCount: 16,
      pendingCount: 6,
      noQuoteCount: 2,
      coveredCount: 22,
      duplicateGroups: 2,
    })
    expect(run.summary.coverageRate).toBeCloseTo(22 / 24)
  })

  it('合并重复料号并保留原 BOM 行证据', () => {
    const stm = run.items.find((item) => item.bom.canonicalMpn === 'STM32F103C8T6')
    const ams = run.items.find((item) => item.bom.canonicalMpn === 'AMS1117-3.3')

    expect(stm?.bom.quantity).toBe(200)
    expect(stm?.bom.originalLines.map((line) => line.lineId)).toEqual([1, 2])
    expect(ams?.bom.quantity).toBe(800)
    expect(ams?.bom.originalLines.map((line) => line.lineId)).toEqual([3, 4])
  })

  it('最低价不满足交期或资质时推荐更安全的报价并解释差异', () => {
    const stm = run.items.find((item) => item.bom.canonicalMpn === 'STM32F103C8T6')

    expect(stm?.status).toBe('matched')
    expect(stm?.recommendation?.supplierId).toBe('SUP-01')
    expect(stm?.lowestQuote?.supplierId).toBe('SUP-03')
    expect(stm?.lowestNotRecommendedReason).toContain('供应商资质待人工审核')
  })

  it.each([
    ['SN74LVC2T45DCUR', '替代料'],
    ['W25Q64JVSSIQ', '无法覆盖需求'],
    ['TPS62160DSGR', '包装后缀'],
    ['USBLC6-2SC6', '过期'],
    ['GRM188R71C104KA01D', '末位不确定'],
    ['PH2.0-4P', 'MOQ'],
  ])('将 %s 保留为待确认并暴露 %s 风险', (mpn) => {
    const item = run.items.find((candidate) => candidate.bom.canonicalMpn === mpn)
    expect(item?.status).toBe('pending')
    expect(item?.keyRisks.length).toBeGreaterThan(0)
  })

  it('不为无报价项目编造供应商或价格', () => {
    const noQuoteItems = run.items.filter((item) => item.status === 'no_quote')
    expect(noQuoteItems.map((item) => item.bom.canonicalMpn)).toEqual([
      'NX3225SA-26.000M-STD-CSR-1',
      'CUS10S30,H3F',
    ])
    expect(noQuoteItems.every((item) => item.recommendation === undefined)).toBe(true)
  })

  it('固定汇率与税费口径可重复计算', () => {
    const stm = run.items.find((item) => item.bom.canonicalMpn === 'STM32F103C8T6')
    const yunfan = stm?.alternatives.find((quote) => quote.supplierId === 'SUP-01')
    const xinghe = stm?.alternatives.find((quote) => quote.supplierId === 'SUP-02')

    expect(yunfan?.normalizedCostCny).toBeCloseTo(11.19 / 1.13, 6)
    expect(xinghe?.normalizedCostCny).toBeCloseTo(1.2 * 7.2, 6)
  })

  it('人工改选后会按新报价重新计算风险，恢复原推荐时不丢失毛利提醒', () => {
    const stm = run.items.find((item) => item.bom.canonicalMpn === 'STM32F103C8T6')
    expect(stm).toBeDefined()

    const lateQuote = stm?.alternatives.find((quote) => quote.supplierId === 'SUP-02')
    const originalQuote = stm?.alternatives.find((quote) => quote.supplierId === 'SUP-01')
    expect(lateQuote).toBeDefined()
    expect(originalQuote).toBeDefined()

    const changed = overrideRecommendation(stm!, lateQuote!.id, dataset.policy)
    expect(changed.status).toBe('pending')
    expect(changed.keyRisks).toContain('交期 35 天，晚于目标 14 天')

    const restored = overrideRecommendation(changed, originalQuote!.id, dataset.policy)
    expect(restored.status).toBe('matched')
    expect(restored.marginWarning).toContain('低于模拟阈值')
    expect(restored.keyRisks).toContain(restored.marginWarning)
  })

  it('人工改选导致状态变化时同步更新批次汇总', () => {
    const stm = run.items.find((item) => item.bom.canonicalMpn === 'STM32F103C8T6')
    const lateQuote = stm?.alternatives.find((quote) => quote.supplierId === 'SUP-02')
    expect(stm).toBeDefined()
    expect(lateQuote).toBeDefined()

    const changed = overrideRunRecommendation(run, stm!.bom.id, lateQuote!.id, dataset.policy)
    expect(changed.summary).toMatchObject({
      matchedCount: 15,
      pendingCount: 7,
      noQuoteCount: 2,
      coveredCount: 22,
    })
    expect(changed.summary.coverageRate).toBeCloseTo(22 / 24)
  })

  it('模型复核建议不能直接改写确定性推荐或审核状态', () => {
    const before = run.items.find((item) => item.bom.canonicalMpn === 'LM358DR')
    const reviewed = applyModelReviewFindings(
      run,
      [{
        originalPartNumber: 'LM358DR',
        suggestedCanonicalMpn: 'LM358DR',
        sourceLine: 5,
        issue: '模型建议人工再次核对品牌',
        requiresHumanReview: true,
      }],
      [{
        supplierId: 'SUP-04',
        mpn: 'LM358DR',
        severity: 'critical',
        issue: '模型建议人工复核证据',
      }],
    )
    const after = reviewed.items.find((item) => item.bom.canonicalMpn === 'LM358DR')

    expect(after?.status).toBe(before?.status)
    expect(after?.recommendation?.id).toBe(before?.recommendation?.id)
    expect(after?.keyRisks.join('；')).toContain('OMA 证据复核建议')
    expect(reviewed.summary).toEqual(run.summary)
  })
})
