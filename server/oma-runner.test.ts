import { describe, expect, it } from 'vitest'
import { applyModelReviewFindings, runQuoteReview } from '../src/domain/quoteEngine'
import {
  datasetFromRequest,
  loadBundledRequest,
} from './fixture-loader'
import { reconcileSourceExcerpt, runLiveOmaWorkflow } from './oma-runner'
import { fixtureRunnerOptions } from './test-fixtures'

describe('真实 OMA runTasks 结构的无网络验收', () => {
  it('通过 fixture adapter 执行六个角色并产出可追溯报价', async () => {
    const request = await loadBundledRequest()
    const workflow = await runLiveOmaWorkflow(
      request,
      await fixtureRunnerOptions(),
    )

    expect(workflow.evidence.isLiveModelCall).toBe(false)
    expect(workflow.evidence.receipt).toMatchObject({
      mode: 'multi-agent',
      independentReviewOccurred: true,
      partial: false,
    })
    expect(workflow.evidence.receipt?.rolesExecuted).toHaveLength(6)
    expect(workflow.output.supplierDocuments).toHaveLength(4)
    expect(
      workflow.output.supplierDocuments.reduce(
        (sum, document) => sum + document.quotes.length,
        0,
      ),
      workflow.evidence.validationIssues.join('\n'),
    ).toBe(45)
    expect(workflow.evidence.validationIssues).toEqual([])

    const dataset = datasetFromRequest(
      request,
      workflow.output.supplierDocuments,
    )
    const run = applyModelReviewFindings(
      runQuoteReview(dataset, workflow.evidence),
      workflow.output.bomFindings,
      workflow.output.evidenceFindings,
    )
    expect(run.mode).toBe('LIVE_OMA_MODEL')
    expect(run.summary.coverageRate).toBeCloseTo(22 / 24)
  })

  it('把独立复核的人审建议与精确来源校验问题分开记录', async () => {
    const request = await loadBundledRequest()
    const workflow = await runLiveOmaWorkflow(
      request,
      await fixtureRunnerOptions({
        decision: 'NEEDS_HUMAN_REVIEW',
        findings: [{
          supplierId: 'SUP-02',
          mpn: 'SN74AXC2T45DCUR',
          severity: 'critical',
          issue: '替代料尚未由工程确认',
        }],
      }),
    )

    expect(workflow.output.evidenceFindings).toEqual([{
      supplierId: 'SUP-02',
      mpn: 'SN74AXC2T45DCUR',
      severity: 'critical',
      issue: '替代料尚未由工程确认',
    }])
    expect(workflow.evidence.validationIssues).toEqual([])
  })

  it('把模型重排的 JSON 片段重新锚定到唯一连续原文', async () => {
    const request = await loadBundledRequest()
    const jsonSource = request.suppliers.find(
      (supplier) => supplier.fileName === 'supplier-03-lingfeng.json',
    )
    expect(jsonSource).toBeDefined()

    const excerpt = reconcileSourceExcerpt({
      mpn: 'STM32F103C8T6',
      unitPrice: 9.2,
      sourceExcerpt: '{"mpn":"STM32F103C8T6","unitPrice":9.2}',
    }, jsonSource!.rawText, 'JSON')

    expect(jsonSource!.rawText.includes(excerpt)).toBe(true)
    expect(excerpt).toContain('"mpn": "STM32F103C8T6"')
    expect(excerpt).toContain('"unitPrice": 9.2')
  })

  it('文档级模型备注不冒充精确来源校验失败', async () => {
    const request = await loadBundledRequest()
    const workflow = await runLiveOmaWorkflow(
      request,
      await fixtureRunnerOptions(
        undefined,
        ['所有数据均为模拟虚构，仅供演示。'],
      ),
    )

    expect(workflow.output.supplierDocuments[0].quotes).toHaveLength(17)
    expect(workflow.evidence.validationIssues).toEqual([])
  })
})
